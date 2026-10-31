'use strict';
const config = require('./config');
const { safeUrl } = require('./html');

class DevinError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const configured = () => !!(config.devin.apiKey && config.devin.orgId);

function redact(s) {
  let out = String(s || '');
  if (config.devin.apiKey) out = out.split(config.devin.apiKey).join('[redacted]');
  return out.replace(/(apk|cog)_[A-Za-z0-9_\-]{8,}/g, '[redacted]');
}

async function call(method, path, body) {
  if (!config.devin.apiKey) throw new DevinError(0, 'Devin API key is not configured');
  let res;
  try {
    res = await fetch(`${config.devin.base}${path}`, {
      method,
      headers: { authorization: `Bearer ${config.devin.apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch (e) {
    throw new DevinError(0, redact(`could not reach the Devin API: ${e.message}`));
  }
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const detail = data && (typeof data.detail === 'string' ? data.detail : data.title || JSON.stringify(data.detail || data));
    throw new DevinError(res.status, redact(`Devin API ${res.status}: ${String(detail || text).slice(0, 300)}`));
  }
  return data;
}

const orgPath = (p = '') => `/v3/organizations/${encodeURIComponent(config.devin.orgId)}${p}`;

async function testConnection() {
  if (!config.devin.apiKey) return { connected: false, reason: 'DEVIN_API_KEY is not set' };
  if (!config.devin.orgId) return { connected: false, reason: 'DEVIN_ORG_ID is not set' };
  try {
    const self = await call('GET', '/v3/self');
    const orgMismatch = self && self.org_id && self.org_id !== config.devin.orgId;
    return {
      connected: !orgMismatch,
      principal: (self && self.principal_type) || 'unknown',
      reason: orgMismatch ? 'The key belongs to a different organization than DEVIN_ORG_ID' : null,
    };
  } catch (e) {
    return { connected: false, reason: e.status === 401 || e.status === 403 ? 'The key was rejected' : e.message };
  }
}

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    demo_url: { type: 'string', description: 'Public URL of the deployed demo' },
    repo_url: { type: 'string', description: 'URL of the public GitHub repository' },
    notes: { type: 'string', description: 'Anything the requester should know' },
  },
  required: ['demo_url', 'repo_url'],
  additionalProperties: false,
};

async function createSession({ prompt, maxAcu, title }) {
  return call('POST', orgPath('/sessions'), {
    prompt,
    title,
    max_acu_limit: maxAcu,
    structured_output_schema: OUTPUT_SCHEMA,
    tags: ['prospector5000'],
  });
}

const getSession = (devinId) => call('GET', orgPath(`/sessions/${encodeURIComponent(devinId)}`));
// Resumes a suspended session (POST /v3/organizations/{org_id}/sessions/{devin_id}/messages).
const sendMessage = (devinId, message) => call('POST', orgPath(`/sessions/${encodeURIComponent(devinId)}/messages`), { message });

const FAILED_DETAILS = new Set(['usage_limit_exceeded', 'out_of_credits', 'out_of_quota', 'no_quota_allocation', 'payment_declined',
  'org_usage_limit_exceeded', 'user_usage_limit_exceeded', 'total_session_limit_exceeded', 'contract_expired', 'error']);

function repoFromPr(prUrl) {
  const m = String(prUrl || '').match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

// Turns a session payload into the fields we store. Session output is untrusted: only
// http(s) URLs are kept.
function interpretSession(s) {
  const so = (s && s.structured_output) || {};
  const pr = s && Array.isArray(s.pull_requests) && s.pull_requests[0];
  const prUrl = pr ? safeUrl(pr.pr_url || pr.url) : null;
  const demoUrl = safeUrl(so.demo_url);
  const repoUrl = safeUrl(so.repo_url) || repoFromPr(prUrl);
  const finished = s.status === 'exit' || s.status_detail === 'finished';
  const failed = s.status === 'error' || (s.status === 'suspended' && FAILED_DETAILS.has(s.status_detail));
  return {
    devin_status: s.status || null,
    devin_status_detail: s.status_detail || null,
    devin_session_url: safeUrl(s.url),
    acus_consumed: typeof s.acus_consumed === 'number' ? s.acus_consumed : null,
    pr_url: prUrl,
    demo_url: demoUrl,
    repo_url: repoUrl,
    finished,
    failed,
    live: finished && !!demoUrl && !!repoUrl,
  };
}

module.exports = { configured, testConnection, createSession, getSession, sendMessage, interpretSession, redact, DevinError, OUTPUT_SCHEMA };
