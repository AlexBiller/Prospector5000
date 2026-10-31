'use strict';
// Connected mode against a local mock of the Devin v3 API.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmpDb, listen, mockServer, Client } = require('./helpers');

const KEY = 'cog_test_SECRET_key_0123456789abcdef';
const calls = [];
let sessionState = { status: 'running', status_detail: 'working' };
const mock = mockServer((req, res) => {
  calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: req.body ? JSON.parse(req.body) : null });
  if (req.url === '/shot.png') { res.setHeader('content-type', 'image/png'); return res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')); }
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== `Bearer ${KEY}`) { res.statusCode = 401; return res.end(JSON.stringify({ detail: 'bad key' })); }
  if (req.url === '/v3/self') return res.end(JSON.stringify({ principal_type: 'service_user', service_user_name: 'ptd-test' }));
  if (req.method === 'POST' && req.url === '/v3/organizations/org-test/sessions') {
    return res.end(JSON.stringify({ session_id: 'devin-abc', url: 'https://app.devin.ai/sessions/abc', status: 'new', acus_consumed: 0 }));
  }
  if (req.method === 'POST' && req.url === '/v3/organizations/org-test/sessions/devin-abc/messages') {
    return res.end(JSON.stringify({ session_id: 'devin-abc', url: 'https://app.devin.ai/sessions/abc', status: 'resuming', acus_consumed: 2.25, pull_requests: [] }));
  }
  if (req.method === 'GET' && req.url.startsWith('/v3/organizations/org-test/sessions/devin-abc/messages?first=100')) {
    return res.end(JSON.stringify(req.url.includes('after=c1')
      ? { items: [{ source: 'devin', message: '**Deploying** the demo to GitHub Pages\nDetails follow', created_at: 1793430300 }], has_next_page: false, end_cursor: null }
      : { items: [{ source: 'user', message: 'brief', created_at: 1793430000 }, { source: 'devin', message: 'Setting up the repo', created_at: 1793430100 }], has_next_page: true, end_cursor: 'c1' }));
  }
  if (req.method === 'GET' && req.url === '/v3/organizations/org-test/sessions/devin-abc') {
    return res.end(JSON.stringify({ session_id: 'devin-abc', url: 'https://app.devin.ai/sessions/abc', acus_consumed: 2.25, pull_requests: [], ...sessionState }));
  }
  res.statusCode = 404; res.end('{}');
});

test('connected build requires approval and ACU confirmation; key never leaks', async () => {
  const mport = await listen(mock);
  Object.assign(process.env, {
    OWNER_PASSWORD: 'pw2', SQLITE_PATH: tmpDb(), FORCE_HTTPS: '0', DEVIN_API_KEY: KEY, DEVIN_ORG_ID: 'org-test',
    DEVIN_API_BASE: `http://127.0.0.1:${mport}`, MAX_ACU_LIMIT: '40', DEVIN_POLL_SECONDS: '3600',
    ALLOW_PRIVATE_FETCH: '1', SCREENSHOT_SERVICE: '',
  });
  const dis = require('../src/research/disambiguate');
  dis.searchCompanies = async () => [
    { name: 'Mercury', domain: 'mercury.com', description: 'American fintech company', wikidata_id: 'Q1', cik: null },
    { name: 'Mercury Marine', domain: 'mercurymarine.com', description: 'marine engine manufacturer', wikidata_id: 'Q2', cik: null },
    { name: 'Mercury Records', domain: 'mercuryrecords.com', description: 'record label', wikidata_id: 'Q3', cik: null },
  ];
  const db = require('../src/db');
  const { app } = require('../src/server');
  await db.init();
  const server = app.listen(0);
  const base = `http://127.0.0.1:${server.address().port}`;
  const c = new Client(base);
  try {
    await c.login('pw2');
    const id = (await c.post('/accounts', { company: 'Mercury' })).location.split('/').pop();
    let page = (await c.get(`/accounts/${id}`)).text;
    for (const d of ['mercury.com', 'mercurymarine.com', 'mercuryrecords.com']) assert.ok(page.includes(d));
    assert.match(page, /mode-connected/);
    await c.post(`/accounts/${id}/confirm`, { choice: '0' });
    const acct = JSON.parse((await c.get(`/api/accounts/${id}`)).text);
    assert.strictEqual(acct.domain, 'mercury.com');
    assert.strictEqual(acct.status, 'researching');

    await c.post(`/accounts/${id}/findings`, { note_0: 'Expanding treasury and bill pay for startups', title_0: 'Treasury expansion' });
    const sessCallsBefore = calls.filter((x) => x.url.includes('/sessions')).length;
    assert.strictEqual(sessCallsBefore, 0, 'no session before approval');
    assert.strictEqual((await c.post(`/accounts/${id}/build/prepare`, { acu: '5' })).status, 303, 'prepare refused before approval');

    const cand = JSON.parse((await c.get(`/api/accounts/${id}`)).text).candidates[0];
    await c.post(`/accounts/${id}/approve`, { candidate_id: cand.id, title: 'Treasury demo', concept: 'A treasury dashboard demo that shows balances and bill pay with seeded data.', interactions: 'See balances\nMove funds\nPay a bill' });
    page = (await c.get(`/accounts/${id}`)).text;
    assert.match(page, /Build with Devin/);
    assert.strictEqual(calls.filter((x) => x.url.includes('/sessions')).length, 0, 'approval alone does not start a session');

    assert.strictEqual((await c.post(`/accounts/${id}/build/prepare`, { acu: '999' })).status, 400, 'cap above max rejected');
    const prep = await c.post(`/accounts/${id}/build/prepare`, { acu: '7' });
    assert.match(prep.text, /up to <strong>7 ACUs<\/strong>/);
    const token = prep.text.match(/name="token" value="([^"]+)"/)[1];
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token, acu: '7' })).status, 400, 'no ack -> refused');
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token, acu: '8', ack: 'yes' })).status, 400, 'tampered cap refused');
    assert.strictEqual(calls.filter((x) => x.url.includes('/sessions')).length, 0);

    const forged = token.replace(/\.[^.]+$/, '.AAAA');
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token: forged, acu: '7', ack: 'yes' })).status, 400, 'forged token refused');
    const [body, sig] = token.split('.');
    const bumped = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), acu: 8 })).toString('base64url');
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token: `${bumped}.${sig}`, acu: '8', ack: 'yes' })).status, 400, 'edited token payload refused');
    assert.strictEqual(calls.filter((x) => x.url.includes('/sessions')).length, 0);
    const ok = await c.post(`/accounts/${id}/build/confirm`, { token, acu: '7', ack: 'yes' });
    assert.strictEqual(ok.status, 303);
    const create = calls.find((x) => x.method === 'POST' && x.url.endsWith('/sessions'));
    assert.strictEqual(create.body.max_acu_limit, 7);
    assert.ok(create.body.structured_output_schema.properties.demo_url);
    assert.ok(create.body.structured_output_schema.properties.repo_url);
    assert.match(create.body.prompt, /Unofficial demo built with Devin - synthetic data/);
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token, acu: '7', ack: 'yes' })).status, 400, 'token single-use');
    const live = JSON.parse((await c.get(`/api/accounts/${id}/build`)).text);
    assert.strictEqual(live.status, 'building');
    assert.strictEqual(live.step, 'Deploying the demo to GitHub Pages');
    assert.ok(live.started_at);
    const livePage = (await c.get(`/accounts/${id}`)).text;
    assert.match(livePage, /data-elapsed-since="[^"]+"/);
    assert.match(livePage, /Deploying the demo to GitHub Pages/);
    assert.doesNotMatch(livePage, /http-equiv="refresh"/);

    page = (await c.get(`/accounts/${id}`)).text;
    assert.match(page, /Building/);
    assert.match(page, /devin-abc/);

    // Stopped build: continue the same session, or start over with a fresh confirmation.
    sessionState = { status: 'suspended', status_detail: 'out_of_quota' };
    await c.post(`/accounts/${id}/poll`);
    page = (await c.get(`/accounts/${id}`)).text;
    assert.match(page, /Continue build/);
    assert.match(page, /Start over/);
    assert.match(page, /out of ACUs/);
    assert.strictEqual((await c.post(`/accounts/${id}/build/continue`, {})).status, 400, 'continue needs ack');
    assert.strictEqual(calls.filter((x) => x.url.endsWith('/messages')).length, 0);
    assert.strictEqual((await c.post(`/accounts/${id}/build/continue`, { ack: 'yes' })).status, 303);
    const msg = calls.find((x) => x.method === 'POST' && x.url === '/v3/organizations/org-test/sessions/devin-abc/messages');
    assert.ok(msg && /demo_url/.test(msg.body.message));
    sessionState = { status: 'running', status_detail: 'working' };
    await c.post(`/accounts/${id}/poll`);
    let st = JSON.parse((await c.get(`/api/accounts/${id}`)).text);
    assert.strictEqual(st.status, 'building');
    assert.ok(!st.error, 'error cleared once running again');
    assert.ok(!/Continue build/.test((await c.get(`/accounts/${id}`)).text));

    sessionState = { status: 'running', status_detail: 'waiting_for_user' };
    await c.post(`/accounts/${id}/poll`);
    page = (await c.get(`/accounts/${id}`)).text;
    assert.match(page, /Devin is waiting for you/);
    assert.match(page, /Continue build/);
    assert.strictEqual((await c.post(`/accounts/${id}/build/continue`, { ack: 'yes' })).status, 303);
    assert.strictEqual(calls.filter((x) => x.url.endsWith('/messages')).length, 2, 'continue nudges a waiting session');

    sessionState = { status: 'error', status_detail: 'error' };
    await c.post(`/accounts/${id}/poll`);
    assert.strictEqual((await c.post(`/accounts/${id}/build/restart`, {})).status, 303);
    st = JSON.parse((await c.get(`/api/accounts/${id}`)).text);
    assert.strictEqual(st.status, 'brief_ready');
    assert.ok(!st.devin_session_id);
    assert.strictEqual(st.acus_consumed, 2.25);
    assert.strictEqual(calls.filter((x) => x.method === 'POST' && x.url.endsWith('/sessions')).length, 1, 'start over alone does not start a session');
    const prep2 = await c.post(`/accounts/${id}/build/prepare`, { acu: '5' });
    const token2 = prep2.text.match(/name="token" value="([^"]+)"/)[1];
    assert.strictEqual((await c.post(`/accounts/${id}/build/confirm`, { token: token2, acu: '5', ack: 'yes' })).status, 303);
    assert.strictEqual(calls.filter((x) => x.method === 'POST' && x.url.endsWith('/sessions')).length, 2);

    sessionState = { status: 'exit', status_detail: 'finished', created_at: 1793430000, updated_at: 1793430000 + 11 * 60, structured_output: { demo_url: 'https://mercury-demo.example', repo_url: 'https://github.com/x/mercury-demo', screenshot_url: `http://127.0.0.1:${mport}/shot.png` }, pull_requests: [{ pr_url: 'https://github.com/x/mercury-demo/pull/1' }] };
    await c.post(`/accounts/${id}/poll`);
    const done = JSON.parse((await c.get(`/api/accounts/${id}`)).text);
    assert.strictEqual(done.status, 'demo_live');
    assert.strictEqual(done.demo_url, 'https://mercury-demo.example/');
    assert.strictEqual(done.repo_url, 'https://github.com/x/mercury-demo');
    assert.strictEqual(done.acus_consumed, 4.5, 'earlier attempt ACUs are included');
    assert.strictEqual(done.devin_session_url, 'https://app.devin.ai/sessions/abc');
    assert.match((await c.get(`/accounts/${id}`)).text, /Build time: 11 minutes/);
    const pdf = await fetch(`${base}/accounts/${id}/report.pdf`, { headers: { cookie: c.cookie } });
    const pdfText = Buffer.from(await pdf.arrayBuffer()).toString('latin1');
    assert.match(pdfText, /\/Subtype \/Image/, 'demo screenshot embedded');
    assert.ok(calls.some((x) => x.url === '/shot.png'));

    page = (await c.get('/settings')).text;
    assert.match(page, /connected/);
    await c.post('/settings/test');
    await c.get('/static/app.js');
    await c.get('/api/status');

    for (const b of c.bodies) assert.ok(!b.includes(KEY) && !b.includes('SECRET_key'), 'key leaked in a response');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (['node_modules', '.git', 'data'].includes(e.name) ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(__dirname, '..'))) if (!f.endsWith('app-devin.test.js')) assert.ok(!fs.readFileSync(f, 'utf8').includes(KEY), f);
  } finally {
    server.close();
    mock.close();
  }
});
