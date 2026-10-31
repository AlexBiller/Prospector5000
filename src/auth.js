'use strict';
const crypto = require('crypto');
const config = require('./config');
const db = require('./db');

const COOKIE = '__Host-ptd_sid';
const WINDOW_MS = 15 * 60 * 1000;
const PER_IP_LIMIT = 5;
const GLOBAL_LIMIT = 30;

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const now = () => new Date().toISOString();

function passwordMatches(input) {
  if (!config.ownerPassword) return false;
  return crypto.timingSafeEqual(sha(input || ''), sha(config.ownerPassword));
}

const failures = new Map();
let globalFailures = [];
function prune(list) { const cut = Date.now() - WINDOW_MS; return list.filter((t) => t > cut); }

function loginBlocked(ip) {
  globalFailures = prune(globalFailures);
  const mine = prune(failures.get(ip) || []);
  failures.set(ip, mine);
  return mine.length >= PER_IP_LIMIT || globalFailures.length >= GLOBAL_LIMIT;
}
function recordFailure(ip) {
  const mine = prune(failures.get(ip) || []);
  mine.push(Date.now());
  failures.set(ip, mine);
  globalFailures.push(Date.now());
}
function clearFailures(ip) { failures.delete(ip); }

function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

async function createSession(res) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionDays * 86400000);
  await db.run('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)',
    [sha(token).toString('hex'), now(), expires.toISOString()]);
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${config.sessionDays * 86400}`);
}

async function destroySession(req, res) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (token) await db.run('DELETE FROM sessions WHERE token_hash = ?', [sha(token).toString('hex')]);
  res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
}

async function isAuthenticated(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token) return false;
  const row = await db.get('SELECT expires_at FROM sessions WHERE token_hash = ?', [sha(token).toString('hex')]);
  return !!row && row.expires_at > now();
}

async function requireAuth(req, res, next) {
  try {
    if (await isAuthenticated(req)) return next();
  } catch (e) {
    return next(e);
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'sign-in required' });
  return res.redirect(303, '/login');
}

module.exports = {
  COOKIE, passwordMatches, loginBlocked, recordFailure, clearFailures,
  createSession, destroySession, requireAuth, isAuthenticated, parseCookies,
};
