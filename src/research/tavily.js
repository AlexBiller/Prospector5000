'use strict';
const config = require('../config');
const S = require('./sources');

async function search(body) {
  const res = await fetch(`${config.research.tavilyBase}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.research.tavilyKey}` },
    body: JSON.stringify({ max_results: 5, include_raw_content: true, ...body }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`search provider returned HTTP ${res.status}`);
  return (await res.json()).results || [];
}

async function tavilySources(account, log) {
  const name = account.name;
  const d = account.domain;
  const queries = [
    { q: { query: `${name} announces`, topic: 'news', days: 365 }, type: 'news' },
    { q: { query: `${name} product launch` }, type: 'launch' },
    ...(d ? [
      { q: { query: `${name} blog`, include_domains: [d] }, type: 'blog' },
      { q: { query: `${name} engineering`, include_domains: [d] }, type: 'blog' },
    ] : []),
  ];
  const results = [];
  for (const { q, type } of queries) {
    try {
      (await search(q)).forEach((r) => results.push({ ...r, qtype: type }));
    } catch (e) {
      log(`Search "${q.query}" failed: ${e.message}`);
    }
  }
  const seen = new Set();
  const unique = results.filter((r) => r.url && !seen.has(r.url) && seen.add(r.url)).slice(0, 12);
  const out = await S.mapLimit(unique, 4, async (r) => {
    const type = S.onDomain(r.url, d) ? (r.qtype === 'news' ? 'press' : r.qtype) : r.qtype === 'launch' ? 'news' : r.qtype;
    try {
      const s = await S.pageSource(r.url, { type, title: r.title, date: r.published_date });
      if (!s.date && r.published_date) s.date = require('./extract').toIsoDate(r.published_date);
      return s;
    } catch {
      // The provider fetched the page for us; use its raw copy.
      const text = r.raw_content || r.content;
      return text ? { url: r.url, title: r.title, date: require('./extract').toIsoDate(r.published_date), type, text: String(text).slice(0, 200000) } : null;
    }
  });
  log(`Search provider: ${out.length} page(s) fetched from ${unique.length} result(s).`);
  return out;
}

module.exports = { tavilySources, search };
