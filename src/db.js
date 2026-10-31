'use strict';
const fs = require('fs');
const path = require('path');
const config = require('./config');

let impl = null;

const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};
const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));

function schema(dialect) {
  const id = dialect === 'pg' ? 'id SERIAL PRIMARY KEY' : 'id INTEGER PRIMARY KEY AUTOINCREMENT';
  const real = dialect === 'pg' ? 'DOUBLE PRECISION' : 'REAL';
  return [
    `CREATE TABLE IF NOT EXISTS accounts (
      ${id},
      query_name TEXT NOT NULL,
      name TEXT, domain TEXT, description TEXT, wikidata_id TEXT, cik TEXT,
      status TEXT NOT NULL,
      mode TEXT NOT NULL,
      disambiguation TEXT,
      research_state TEXT, research_message TEXT, research_provider TEXT,
      proposal TEXT, approved_candidate_id INTEGER, brief TEXT, acu_limit INTEGER,
      devin_session_id TEXT, devin_session_url TEXT, devin_status TEXT, devin_status_detail TEXT,
      demo_url TEXT, repo_url TEXT, pr_url TEXT, acus_consumed ${real},
      notes TEXT, error TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_polled_at TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS candidates (
      ${id},
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      title TEXT NOT NULL, summary TEXT, source_url TEXT, source_title TEXT, source_date TEXT,
      source_type TEXT, relevance TEXT, excerpt TEXT, origin TEXT NOT NULL,
      score ${real}, flags TEXT, recommended INTEGER DEFAULT 0, created_at TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS candidates_account ON candidates(account_id)`,
    `CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, created_at TEXT NOT NULL, expires_at TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      ${id},
      account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
      at TEXT NOT NULL, message TEXT NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS events_account ON events(account_id)`,
  ];
}

async function init() {
  if (impl) return impl;
  if (config.databaseUrl) {
    const { Pool } = require('pg');
    const pool = new Pool({ connectionString: config.databaseUrl.replace(/([?&])sslmode=(?:require|prefer|verify-ca)\b/, '$1sslmode=verify-full'), max: 5 });
    impl = {
      dialect: 'pg',
      all: async (sql, p = []) => (await pool.query(toPg(sql), clean(p))).rows,
      get: async (sql, p = []) => (await pool.query(toPg(sql), clean(p))).rows[0],
      run: async (sql, p = []) => {
        const r = await pool.query(toPg(sql), clean(p));
        return { rows: r.rows, changes: r.rowCount };
      },
      close: () => pool.end(),
    };
  } else {
    const { DatabaseSync } = require('node:sqlite');
    fs.mkdirSync(path.dirname(config.sqlitePath), { recursive: true });
    const db = new DatabaseSync(config.sqlitePath);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const plain = (r) => (r ? { ...r } : r);
    impl = {
      dialect: 'sqlite',
      all: async (sql, p = []) => db.prepare(sql).all(...clean(p)).map(plain),
      get: async (sql, p = []) => plain(db.prepare(sql).get(...clean(p))),
      run: async (sql, p = []) => {
        const st = db.prepare(sql);
        if (/\breturning\b/i.test(sql)) {
          const rows = st.all(...clean(p)).map(plain);
          return { rows, changes: rows.length };
        }
        const r = st.run(...clean(p));
        return { rows: [], changes: Number(r.changes) };
      },
      close: async () => db.close(),
    };
  }
  for (const stmt of schema(impl.dialect)) await impl.run(stmt);
  // Additive column migrations for databases created by earlier versions.
  const real = impl.dialect === 'pg' ? 'DOUBLE PRECISION' : 'REAL';
  for (const [col, type] of [['prior_acus', real]]) {
    const exists = impl.dialect === 'pg'
      ? await impl.get("SELECT 1 FROM information_schema.columns WHERE table_name = 'accounts' AND column_name = ?", [col])
      : (await impl.all('PRAGMA table_info(accounts)')).some((c) => c.name === col);
    if (!exists) await impl.run(`ALTER TABLE accounts ADD COLUMN ${col} ${type}`);
  }
  return impl;
}

const db = {
  init,
  get dialect() { return impl && impl.dialect; },
  all: (...a) => impl.all(...a),
  get: (...a) => impl.get(...a),
  run: (...a) => impl.run(...a),
  close: () => (impl ? impl.close() : undefined),
};

module.exports = db;
