'use strict';
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const config = require('./config');
const db = require('./db');
const auth = require('./auth');
const store = require('./store');
const views = require('./views');
const devin = require('./devin');
const brief = require('./brief');
const research = require('./research');
const report = require('./report');
const { searchCompanies, domainOf } = require('./research/disambiguate');
const llm = require('./research/llm');
const { safeUrl } = require('./html');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self'; style-src 'self' 'nonce-${res.locals.nonce}'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

app.use((req, res, next) => {
  if (config.forceHttps && !req.secure) return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
  next();
});

app.use(express.urlencoded({ extended: false, limit: '100kb' }));
app.use(express.json({ limit: '100kb' }));

// Same-origin check for state-changing requests (on top of SameSite=Strict cookies).
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const site = req.get('sec-fetch-site');
  if (site) return site === 'same-origin' ? next() : res.status(403).send('Cross-origin request blocked');
  const origin = req.get('origin');
  const src = origin && origin !== 'null' ? origin : req.get('referer');
  try {
    if (src && new URL(src).host === req.get('host')) return next();
  } catch { /* fall through */ }
  return res.status(403).send('Cross-origin request blocked');
});

const send = (res, page, opts = {}) => res.send(views.layout({ nonce: res.locals.nonce, ...opts, body: page }));

app.get('/login', async (req, res) => {
  if (await auth.isAuthenticated(req)) return res.redirect(303, '/');
  res.send(views.loginPage({ nonce: res.locals.nonce }));
});

app.post('/login', async (req, res, next) => {
  try {
    const ip = req.ip;
    if (auth.loginBlocked(ip)) return res.status(429).send(views.loginPage({ nonce: res.locals.nonce, error: 'Too many attempts. Try again in 15 minutes.' }));
    await new Promise((r) => setTimeout(r, 300));
    if (!config.ownerPassword) return res.status(503).send(views.loginPage({ nonce: res.locals.nonce, error: 'OWNER_PASSWORD is not set on the server.' }));
    if (!auth.passwordMatches(req.body.password)) {
      auth.recordFailure(ip);
      return res.status(401).send(views.loginPage({ nonce: res.locals.nonce, error: 'Wrong password.' }));
    }
    auth.clearFailures(ip);
    await auth.createSession(res);
    res.redirect(303, '/');
  } catch (e) { next(e); }
});

// Everything below requires sign-in: pages, API routes and static assets.
app.use(auth.requireAuth);
app.use('/static', express.static(path.join(__dirname, '..', 'public'), { index: false, maxAge: 0 }));

app.post('/logout', async (req, res) => { await auth.destroySession(req, res); res.redirect(303, '/login'); });

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const loadAccount = async (req, res) => {
  const a = await store.getAccount(Number(req.params.id));
  if (!a) { res.status(404); send(res, views.errorPage('Account not found.'), { title: 'Not found' }); return null; }
  return a;
};

app.get('/', wrap(async (req, res) => {
  send(res, views.dashboard({ accounts: await store.listAccounts(), devinConnected: devin.configured() }), { title: 'Dashboard' });
}));

app.post('/accounts', wrap(async (req, res) => {
  const company = String(req.body.company || '').trim().slice(0, 100);
  if (!company) return res.redirect(303, '/');
  const id = await store.createAccount(company, devin.configured() ? 'connected' : 'manual');
  let matches = [];
  try { matches = await searchCompanies(company); } catch (e) { await store.addEvent(id, `Company lookup failed: ${e.message}`); }
  await store.updateAccount(id, { disambiguation: matches });
  await store.addEvent(id, `Searched for "${company}": ${matches.length} candidate match(es).`);
  res.redirect(303, `/accounts/${id}`);
}));

const researchJobs = new Set();
async function startResearch(a) {
  if (researchJobs.has(a.id)) return;
  researchJobs.add(a.id);
  await store.updateAccount(a.id, { research_state: 'running', research_provider: research.providerStatus().name, error: null });
  await store.addEvent(a.id, 'Research started.');
  (async () => {
    try {
      const out = await research.runResearch(a);
      await store.replaceFetchedCandidates(a.id, out.candidates);
      const total = (await store.listCandidates(a.id)).length;
      const cur = await store.getAccount(a.id);
      await store.updateAccount(a.id, {
        research_state: 'done',
        research_message: out.message,
        status: total && cur.status === 'researching' ? 'awaiting_approval' : cur.status,
      });
      await store.addEvent(a.id, `Research finished. ${out.log.join(' ')}`);
    } catch (e) {
      await store.updateAccount(a.id, { research_state: 'failed', research_message: `Research failed: ${e.message}. You can add findings manually.` });
      await store.addEvent(a.id, `Research failed: ${e.message}`);
    } finally {
      researchJobs.delete(a.id);
    }
  })();
}

app.post('/accounts/:id/confirm', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (a.status !== 'confirming') return res.redirect(303, `/accounts/${a.id}`);
  let pick;
  if (req.body.choice === 'manual') {
    const domain = domainOf(`https://${String(req.body.domain || '').trim().replace(/^https?:\/\//, '')}`);
    const name = String(req.body.name || '').trim().slice(0, 100);
    if (!domain || !domain.includes('.') || !name) return res.redirect(303, `/accounts/${a.id}`);
    pick = { name, domain, description: 'Entered manually', wikidata_id: null, cik: null };
  } else {
    pick = (a.disambiguation || [])[Number(req.body.choice)];
    if (!pick) return res.redirect(303, `/accounts/${a.id}`);
  }
  await store.updateAccount(a.id, { name: pick.name, domain: pick.domain, description: pick.description, wikidata_id: pick.wikidata_id, cik: pick.cik, status: 'researching', research_state: 'idle' });
  await store.addEvent(a.id, `Confirmed company: ${pick.name} (${pick.domain}).`);
  if (research.providerStatus().available) await startResearch(await store.getAccount(a.id));
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/research', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (research.providerStatus().available && ['researching', 'awaiting_approval'].includes(a.status)) await startResearch(a);
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/findings', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (!['researching', 'awaiting_approval'].includes(a.status)) return res.redirect(303, `/accounts/${a.id}`);
  const rows = [0, 1, 2, 3, 4].map((i) => ({ url: req.body[`url_${i}`], date: req.body[`date_${i}`], title: req.body[`title_${i}`], note: req.body[`note_${i}`] }))
    .filter((r) => (r.url && r.url.trim()) || (r.note && r.note.trim()));
  if (rows.length) {
    const cands = await research.manualCandidates(a, rows);
    await store.insertCandidates(a.id, cands);
    await store.updateAccount(a.id, { status: 'awaiting_approval' });
    await store.addEvent(a.id, `Added ${cands.length} manual finding(s).`);
  }
  res.redirect(303, `/accounts/${a.id}`);
}));

app.get('/accounts/:id/propose', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (!['awaiting_approval', 'brief_ready', 'researching'].includes(a.status)) return res.redirect(303, `/accounts/${a.id}`);
  let cand = null;
  let proposal;
  if (req.query.edit && a.proposal) {
    cand = a.approved_candidate_id ? await store.getCandidate(a.id, a.approved_candidate_id) : null;
    proposal = a.proposal;
  } else if (req.query.candidate && req.query.candidate !== 'own') {
    cand = await store.getCandidate(a.id, Number(req.query.candidate));
    if (!cand) return res.redirect(303, `/accounts/${a.id}`);
    proposal = brief.defaultProposal(a, cand);
  } else {
    proposal = brief.defaultProposal(a, null);
  }
  send(res, views.proposePage({ a, cand, proposal }), { title: 'Proposal' });
}));

app.post('/accounts/:id/approve', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (!['awaiting_approval', 'brief_ready', 'researching'].includes(a.status)) return res.redirect(303, `/accounts/${a.id}`);
  const cand = req.body.candidate_id ? await store.getCandidate(a.id, Number(req.body.candidate_id)) : null;
  const proposal = brief.normalizeProposal(req.body);
  const errors = brief.validateProposal(proposal);
  if (errors.length) return send(res.status(400), views.proposePage({ a, cand, proposal, errors }), { title: 'Proposal' });
  const text = brief.buildBrief(a, proposal, cand);
  await store.updateAccount(a.id, { proposal, approved_candidate_id: cand ? cand.id : null, brief: text, status: 'brief_ready', error: null });
  await store.addEvent(a.id, `Approved proposal "${proposal.title}"${cand ? ` based on candidate #${cand.id}` : ' (own idea)'}; brief generated.`);
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/reopen', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (a.status === 'brief_ready') {
    await store.updateAccount(a.id, { status: 'awaiting_approval', brief: null });
    await store.addEvent(a.id, 'Brief withdrawn; choosing a different project.');
  }
  res.redirect(303, `/accounts/${a.id}`);
}));

// Two-step build: prepare issues a short-lived signed token bound to the account, ACU cap and brief;
// confirm requires that token plus an explicit acknowledgement. Tokens are HMAC-signed (not held in memory)
// so they survive restarts, redeploys and free-tier sleep; single use is enforced by the account status.
const briefHash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const parseAcu = (v) => { const n = parseInt(v, 10); return Number.isInteger(n) && n >= 1 && n <= config.devin.maxAcu ? n : null; };
const TOKEN_TTL_MS = 30 * 60000;
const tokenKey = crypto.createHash('sha256').update(`p5k-build|${process.env.BUILD_TOKEN_SECRET || ''}|${config.ownerPassword || ''}|${process.env.DATABASE_URL || ''}`).digest();
const signBuild = (payload) => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${crypto.createHmac('sha256', tokenKey).update(body).digest('base64url')}`;
};
function readBuild(token) {
  const [body, sig] = String(token || '').split('.');
  if (!body || !sig) return null;
  const want = crypto.createHmac('sha256', tokenKey).update(body).digest();
  const got = Buffer.from(sig, 'base64url');
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try { return JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { return null; }
}
const usedTokens = new Set();

app.post('/accounts/:id/build/prepare', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (a.status !== 'brief_ready' || !devin.configured()) return res.redirect(303, `/accounts/${a.id}`);
  const acu = parseAcu(req.body.acu);
  if (!acu) return send(res.status(400), views.errorPage(`ACU cap must be a whole number between 1 and ${config.devin.maxAcu}.`), { title: 'Invalid ACU cap' });
  const token = signBuild({ id: a.id, acu, hash: briefHash(a.brief), exp: Date.now() + TOKEN_TTL_MS, n: crypto.randomBytes(9).toString('base64url') });
  send(res, views.buildConfirmPage({ a, acu, token }), { title: 'Confirm build' });
}));

const buildsInFlight = new Set();
app.post('/accounts/:id/build/confirm', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  const t = readBuild(req.body.token);
  const acu = parseAcu(req.body.acu);
  const notStarted = (why) => send(res.status(400), views.errorPage(`Build not started: ${why} Nothing was spent.`, { backHref: `/accounts/${a.id}`, backLabel: 'Back to this account' }), { title: 'Not started' });
  if (a.status === 'building' || a.devin_session_id || buildsInFlight.has(a.id)) return notStarted('a Devin build for this account has already started.');
  if (a.status !== 'brief_ready') return notStarted('this account has no approved brief.');
  if (!devin.configured()) return notStarted('the Devin API is not connected.');
  if (!t || String(t.id) !== String(a.id) || usedTokens.has(req.body.token)) return notStarted('the confirmation link is invalid or was already used. Click "Build with Devin" again.');
  if (t.exp <= Date.now()) return notStarted('the confirmation expired (30 minutes). Click "Build with Devin" again.');
  if (t.acu !== acu) return notStarted('the ACU cap does not match what you confirmed.');
  if (t.hash !== briefHash(a.brief)) return notStarted('the brief changed after you prepared the build. Review it and click "Build with Devin" again.');
  if (req.body.ack !== 'yes') return notStarted('the acknowledgement box was not ticked.');
  usedTokens.add(req.body.token);
  const missing = brief.missingClauses(a.brief);
  if (missing.length) return send(res.status(400), views.errorPage('Build not started: the brief is missing required guardrails.'), { title: 'Not started' });
  buildsInFlight.add(a.id);
  try {
    const s = await devin.createSession({ prompt: a.brief, maxAcu: acu, title: `Prospect demo: ${a.name}` });
    const info = devin.interpretSession(s);
    await store.updateAccount(a.id, {
      status: 'building', mode: 'connected', acu_limit: acu, devin_session_id: s.session_id,
      devin_session_url: info.devin_session_url, devin_status: info.devin_status, error: null,
    });
    await store.addEvent(a.id, `Devin session ${s.session_id} created with an ACU cap of ${acu}.`);
  } catch (e) {
    await store.updateAccount(a.id, { error: `Could not start the Devin session: ${devin.redact(e.message)}` });
    await store.addEvent(a.id, `Devin session creation failed: ${devin.redact(e.message)}`);
  } finally {
    buildsInFlight.delete(a.id);
  }
  res.redirect(303, `/accounts/${a.id}`);
}));

async function pollAccount(a) {
  if (!a.devin_session_id || a.status !== 'building' || !devin.configured()) return;
  try {
    const info = devin.interpretSession(await devin.getSession(a.devin_session_id));
    const fields = {
      devin_status: info.devin_status, devin_status_detail: info.devin_status_detail, last_polled_at: new Date().toISOString(),
      ...(info.devin_session_url ? { devin_session_url: info.devin_session_url } : {}),
      ...(info.acus_consumed != null ? { acus_consumed: info.acus_consumed } : {}),
      ...(info.pr_url ? { pr_url: info.pr_url } : {}),
      ...(info.demo_url ? { demo_url: info.demo_url } : {}),
      ...(info.repo_url ? { repo_url: info.repo_url } : {}),
    };
    if (info.live) {
      fields.status = 'demo_live';
      fields.error = null;
      await store.addEvent(a.id, 'Devin finished: demo is live.');
    } else if (info.finished) {
      fields.error = 'The Devin session finished without reporting both demo_url and repo_url. Check the session and paste the links manually.';
    } else if (info.failed) {
      fields.error = `The Devin session stopped (${info.devin_status}${info.devin_status_detail ? `: ${info.devin_status_detail}` : ''}). Check the session; you can paste links manually.`;
    }
    await store.updateAccount(a.id, fields);
  } catch (e) {
    await store.updateAccount(a.id, { last_polled_at: new Date().toISOString(), error: `Status check failed: ${devin.redact(e.message)}` });
  }
}

app.post('/accounts/:id/poll', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  await pollAccount(a);
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/links', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (!['brief_ready', 'building', 'demo_live'].includes(a.status)) return res.redirect(303, `/accounts/${a.id}`);
  const demoUrl = safeUrl(req.body.demo_url);
  const repoUrl = safeUrl(req.body.repo_url);
  if (!demoUrl || !repoUrl) return send(res.status(400), views.errorPage('Both links must be valid http(s) URLs.'), { title: 'Invalid links' });
  const acus = req.body.acus !== undefined && req.body.acus !== '' && Number.isFinite(Number(req.body.acus)) ? Number(req.body.acus) : a.acus_consumed;
  await store.updateAccount(a.id, { demo_url: demoUrl, repo_url: repoUrl, acus_consumed: acus, status: 'demo_live', error: null, mode: a.devin_session_id ? a.mode : 'manual' });
  await store.addEvent(a.id, 'Demo and repo links saved manually.');
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/notes', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  await store.updateAccount(a.id, { notes: String(req.body.notes || '').slice(0, 5000) });
  res.redirect(303, `/accounts/${a.id}`);
}));

app.post('/accounts/:id/delete', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  if (req.body.confirm === 'yes') await store.deleteAccount(a.id);
  res.redirect(303, '/');
}));

app.get('/accounts/:id/report.pdf', wrap(async (req, res) => {
  const a = await loadAccount(req, res);
  if (!a) return;
  const candidates = await store.listCandidates(a.id);
  if (a.status === 'confirming' || (!candidates.length && !a.proposal)) {
    return send(res.status(400), views.errorPage('Run research or approve a proposal before downloading the PDF.'), { title: 'Not ready' });
  }
  const pdf = await report.renderPdf(report.buildReportModel(a, candidates));
  const slug = String(a.name || 'prospect').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'prospect';
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="Cognition-${slug}-Devin-opportunities.pdf"`);
  res.send(pdf);
}));

app.get('/accounts/:id', wrap(async (req, res) => {
  let a = await loadAccount(req, res);
  if (!a) return;
  if (a.status === 'building' && (!a.last_polled_at || Date.now() - new Date(a.last_polled_at).getTime() > 15000)) {
    await pollAccount(a);
    a = await store.getAccount(a.id);
  }
  a._maxAcu = config.devin.maxAcu;
  a._defaultAcu = config.devin.defaultAcu;
  a._acuRate = config.report.acuPriceUsd;
  const page = views.accountPage({
    a, candidates: await store.listCandidates(a.id), events: await store.listEvents(a.id),
    research: research.providerStatus(), devinOn: devin.configured(),
  });
  send(res, page, { title: a.name || a.query_name, refresh: a.research_state === 'running' ? 5 : a.status === 'building' ? 30 : null });
}));

let connCache = null;
async function connection(force) {
  if (force || !connCache || Date.now() - connCache.at > 60000) connCache = { at: Date.now(), v: await devin.testConnection() };
  return connCache.v;
}
const settingsView = async (force) => views.settingsPage({
  devin: await connection(force), research: research.providerStatus(), llm: llm.configured(), dbDialect: db.dialect, contact: !!config.contactEmail, acuRate: config.report.acuPriceUsd, reportContact: !!config.report.contact,
});
app.get('/settings', wrap(async (req, res) => send(res, await settingsView(false), { title: 'Settings' })));
app.post('/settings/test', wrap(async (req, res) => send(res, await settingsView(true), { title: 'Settings' })));

// JSON API (sign-in required like everything else). Contains no secrets.
const publicAccount = (a) => {
  const { _maxAcu, _defaultAcu, ...rest } = a;
  return rest;
};
app.get('/api/accounts', wrap(async (req, res) => res.json((await store.listAccounts()).map(publicAccount))));
app.get('/api/accounts/:id', wrap(async (req, res) => {
  const a = await store.getAccount(Number(req.params.id));
  if (!a) return res.status(404).json({ error: 'not found' });
  res.json({ ...publicAccount(a), candidates: await store.listCandidates(a.id) });
}));
app.get('/api/status', wrap(async (req, res) => {
  const c = await connection(false);
  res.json({ devin: { connected: c.connected }, research: { available: research.providerStatus().available }, llm: { configured: llm.configured() } });
}));

app.use((req, res) => { res.status(404); send(res, views.errorPage('Page not found.'), { title: 'Not found' }); });
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(`[error] ${req.method} ${req.path}: ${devin.redact(err && err.message)}`);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'internal error' });
  res.status(500);
  send(res, views.errorPage('Internal error.'), { title: 'Error' });
});

async function pollAll() {
  if (!devin.configured()) return;
  const building = (await store.listAccounts()).filter((a) => a.status === 'building' && a.devin_session_id);
  for (const a of building) await pollAccount(a);
}

async function main() {
  await db.init();
  // Research jobs do not survive a restart; mark any that were interrupted.
  for (const a of await store.listAccounts()) {
    if (a.research_state === 'running') await store.updateAccount(a.id, { research_state: 'failed', research_message: 'Research was interrupted by a restart. Run it again or add findings manually.' });
  }
  if (!config.ownerPassword) console.warn('[warn] OWNER_PASSWORD is not set: nobody can sign in.');
  app.listen(config.port, () => console.log(`Prospector5000 listening on :${config.port} (${db.dialect})`));
  setInterval(() => pollAll().catch((e) => console.error(`[poll] ${devin.redact(e.message)}`)), config.devin.pollSeconds * 1000).unref();
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { app, main };
