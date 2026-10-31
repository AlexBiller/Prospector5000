'use strict';
const { fetchJson } = require('../net');

const API = 'https://www.wikidata.org/w/api.php';
// Industry, HQ, employees, stock exchange, SEC CIK, revenue, parent org, legal form, founded-by.
const COMPANY_SIGNALS = ['P452', 'P159', 'P1128', 'P414', 'P5531', 'P2139', 'P749', 'P1454', 'P112'];
const EXCLUDE_P31 = new Set(['Q5', 'Q4167410', 'Q13406463', 'Q215380', 'Q482994', 'Q7889']);

function claimValues(ent, prop) {
  return ((ent.claims || {})[prop] || [])
    .filter((c) => c.rank !== 'deprecated')
    .map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value)
    .filter(Boolean);
}

const norm = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '');

// Wikidata increasingly stores names only under the language-neutral "mul" label, not "en".
function textOf(map, fallback = '') {
  const m = map || {};
  const v = m.en || m.mul;
  return (v && v.value) || fallback;
}

function namesOf(e) {
  const aliases = e.aliases || {};
  return [textOf(e.labels), ...[...(aliases.en || []), ...(aliases.mul || [])].map((a) => a.value)].filter(Boolean);
}

// Full-text search also returns companies that merely mention the query (e.g. a social link),
// so a candidate must match the query by name, alias or domain.
function isRelevant(query, names, domain) {
  const q = norm(query);
  if (!q) return false;
  const host = norm(String(domain || '').split('.').slice(0, -1).join('.'));
  return names.some((n) => { const x = norm(n); return x && (x.includes(q) || (x.length >= 4 && q.includes(x))); })
    || (host && (host.includes(q) || (host.length >= 4 && q.includes(host))));
}

function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return null; }
}

async function searchCompanies(query) {
  const q = String(query || '').trim().slice(0, 100);
  if (!q) return [];
  const cirrus = (extra) => fetchJson(`${API}?action=query&list=search&format=json&srlimit=12&srsearch=${encodeURIComponent(`${q} haswbstatement:P856 ${extra}`)}`).catch(() => null);
  const [byIndustry, byHq, prefix] = await Promise.all([
    cirrus('haswbstatement:P452'),
    cirrus('haswbstatement:P159'),
    fetchJson(`${API}?action=wbsearchentities&format=json&language=en&uselang=en&type=item&limit=15&search=${encodeURIComponent(q)}`).catch(() => null),
  ]);
  const ids = [];
  const searchLabel = {};
  const add = (id) => { if (id && !ids.includes(id)) ids.push(id); };
  ((prefix && prefix.search) || []).forEach((r) => { add(r.id); if (r.label) searchLabel[r.id] = r.label; });
  [byIndustry, byHq].forEach((r) => ((r && r.query && r.query.search) || []).forEach((x) => add(x.title)));
  if (!ids.length) return [];
  // Large entities (e.g. Meta) can exceed the fetch size cap, so fetch in small batches and skip any that fail.
  const batches = [];
  for (let i = 0; i < Math.min(ids.length, 40); i += 8) batches.push(ids.slice(i, i + 8));
  const parts = await Promise.all(batches.map((b) => fetchJson(`${API}?action=wbgetentities&format=json&languages=en|mul&props=labels|aliases|descriptions|claims|sitelinks&ids=${b.join('|')}`, { maxBytes: 4000000 }).catch(() => null)));
  const ents = { entities: Object.assign({}, ...parts.map((x) => (x && x.entities) || {})) };
  const out = [];
  const seenDomains = new Set();
  for (const id of ids) {
    const e = ents.entities && ents.entities[id];
    if (!e || e.missing !== undefined) continue;
    const p31 = claimValues(e, 'P31').map((v) => v.id);
    if (p31.some((x) => EXCLUDE_P31.has(x))) continue;
    if (!COMPANY_SIGNALS.some((prop) => claimValues(e, prop).length)) continue;
    const site = claimValues(e, 'P856')[0];
    const domain = site && domainOf(site);
    if (!domain || seenDomains.has(domain)) continue;
    const label = textOf(e.labels, searchLabel[id] || '');
    if (!label || !isRelevant(q, [label, ...namesOf(e)], domain)) continue;
    seenDomains.add(domain);
    const description = textOf(e.descriptions);
    const cik = claimValues(e, 'P5531')[0] || null;
    const sitelinks = Object.keys(e.sitelinks || {}).length;
    const nameMatch = label.toLowerCase() === q.toLowerCase() ? 2 : label.toLowerCase().startsWith(q.toLowerCase()) ? 1 : 0;
    out.push({ name: label, domain, description, wikidata_id: id, cik, _rank: nameMatch * 30 + Math.min(sitelinks, 99) });
  }
  return out.sort((a, b) => b._rank - a._rank).slice(0, 5).map(({ _rank, ...c }) => c);
}

module.exports = { searchCompanies, domainOf, isRelevant, textOf };
