'use strict';
const db = require('./db');

const now = () => new Date().toISOString();
const JSON_FIELDS = ['disambiguation', 'proposal'];
const ACCOUNT_FIELDS = new Set(['name', 'domain', 'description', 'wikidata_id', 'cik', 'status', 'mode', 'disambiguation',
  'research_state', 'research_message', 'research_provider', 'proposal', 'approved_candidate_id', 'brief', 'acu_limit',
  'devin_session_id', 'devin_session_url', 'devin_status', 'devin_status_detail', 'demo_url', 'repo_url', 'pr_url',
  'acus_consumed', 'prior_acus', 'notes', 'error', 'last_polled_at', 'screenshot_url', 'build_started_at', 'build_finished_at']);

function parseAccount(r) {
  if (!r) return null;
  for (const f of JSON_FIELDS) { try { r[f] = r[f] ? JSON.parse(r[f]) : null; } catch { r[f] = null; } }
  return r;
}
function parseCandidate(r) {
  if (!r) return null;
  try { r.flags = r.flags ? JSON.parse(r.flags) : {}; } catch { r.flags = {}; }
  r.recommended = !!r.recommended;
  return r;
}

async function createAccount(queryName, mode) {
  const t = now();
  const r = await db.run('INSERT INTO accounts (query_name, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?) RETURNING id',
    [queryName, 'confirming', mode, t, t]);
  return r.rows[0].id;
}

const getAccount = async (id) => parseAccount(await db.get('SELECT * FROM accounts WHERE id = ?', [id]));
const listAccounts = async () => (await db.all('SELECT * FROM accounts ORDER BY updated_at DESC')).map(parseAccount);

async function updateAccount(id, fields) {
  const keys = Object.keys(fields).filter((k) => ACCOUNT_FIELDS.has(k));
  if (!keys.length) return;
  const vals = keys.map((k) => (JSON_FIELDS.includes(k) && fields[k] !== null ? JSON.stringify(fields[k]) : fields[k]));
  await db.run(`UPDATE accounts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`, [...vals, now(), id]);
}

const deleteAccount = async (id) => {
  await db.run('DELETE FROM candidates WHERE account_id = ?', [id]);
  await db.run('DELETE FROM events WHERE account_id = ?', [id]);
  await db.run('DELETE FROM screenshots WHERE account_id = ?', [id]);
  await db.run('DELETE FROM accounts WHERE id = ?', [id]);
};

const addEvent = (id, message) => db.run('INSERT INTO events (account_id, at, message) VALUES (?, ?, ?)', [id, now(), String(message).slice(0, 2000)]);
const listEvents = (id) => db.all('SELECT * FROM events WHERE account_id = ? ORDER BY id DESC LIMIT 50', [id]);

async function insertCandidates(accountId, cands) {
  const t = now();
  for (const c of cands) {
    await db.run(`INSERT INTO candidates (account_id, title, summary, source_url, source_title, source_date, source_type, relevance, excerpt, origin, score, flags, recommended, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [accountId, c.title, c.summary, c.source_url, c.source_title, c.source_date, c.source_type, c.relevance, c.excerpt, c.origin, c.score, JSON.stringify(c.flags || {}), c.recommended ? 1 : 0, t]);
  }
}

async function replaceFetchedCandidates(accountId, cands) {
  await db.run("DELETE FROM candidates WHERE account_id = ? AND origin = 'fetched'", [accountId]);
  if (cands.some((c) => c.recommended)) await db.run('UPDATE candidates SET recommended = 0 WHERE account_id = ?', [accountId]);
  await insertCandidates(accountId, cands);
}

const listCandidates = async (accountId) => (await db.all('SELECT * FROM candidates WHERE account_id = ? ORDER BY recommended DESC, score DESC, id ASC', [accountId])).map(parseCandidate);
const getCandidate = async (accountId, cid) => parseCandidate(await db.get('SELECT * FROM candidates WHERE account_id = ? AND id = ?', [accountId, cid]));

// Demo screenshots live in their own table so account listings and polling don't load the image.
const getScreenshot = async (id) => {
  const r = await db.get('SELECT image FROM screenshots WHERE account_id = ?', [id]);
  return r ? Buffer.from(r.image, 'base64') : null;
};
const saveScreenshot = (id, buf) => db.run(
  'INSERT INTO screenshots (account_id, image, created_at) VALUES (?, ?, ?) ON CONFLICT (account_id) DO UPDATE SET image = excluded.image, created_at = excluded.created_at',
  [id, buf.toString('base64'), now()]);
const deleteScreenshot = (id) => db.run('DELETE FROM screenshots WHERE account_id = ?', [id]);

module.exports = { getScreenshot, saveScreenshot, deleteScreenshot, createAccount, getAccount, listAccounts, updateAccount, deleteAccount, addEvent, listEvents, insertCandidates, replaceFetchedCandidates, listCandidates, getCandidate };
