'use strict';
const dns = require('dns').promises;
const net = require('net');
const config = require('./config');

const UA = () => `Prospect-to-Demo/1.0 (+https://github.com/AlexBiller/prospect-to-demo${config.contactEmail ? `; ${config.contactEmail}` : ''})`;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19));
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') ||
    v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
}

async function assertPublicUrl(u) {
  const url = new URL(u);
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('only http(s) URLs can be fetched');
  if (url.username || url.password) throw new Error('URLs with credentials are not fetched');
  if (config.allowPrivateFetch) return url;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
  if (!addrs.length || addrs.some(isPrivateIp)) throw new Error('refusing to fetch a private or local address');
  return url;
}

async function readCapped(res, maxBytes) {
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) {
      chunks.push(value.slice(0, value.length - (size - maxBytes)));
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

// Fetches a public URL with SSRF checks on every redirect hop, a timeout and a size cap.
async function fetchText(u, { maxBytes = 1500000, timeoutMs = 12000, headers = {}, method = 'GET', body } = {}) {
  let url = u;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicUrl(url);
    const res = await fetch(url, {
      method,
      body,
      redirect: 'manual',
      headers: { 'user-agent': UA(), accept: 'text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8', ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(res.status)) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error(`redirect without location (${res.status})`);
      url = new URL(loc, url).href;
      continue;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { url, status: res.status, contentType: res.headers.get('content-type') || '', text: await readCapped(res, maxBytes) };
  }
  throw new Error('too many redirects');
}

async function fetchJson(u, opts = {}) {
  const r = await fetchText(u, { ...opts, headers: { accept: 'application/json', ...(opts.headers || {}) } });
  return JSON.parse(r.text);
}

module.exports = { fetchText, fetchJson, assertPublicUrl, isPrivateIp, UA };
