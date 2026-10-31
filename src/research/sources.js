'use strict';
const { fetchText, fetchJson } = require('../net');
const X = require('./extract');
const O = require('./opportunity');

async function mapLimit(items, limit, fn) {
  const out = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try { out[idx] = await fn(items[idx], idx); } catch { out[idx] = null; }
    }
  });
  await Promise.all(workers);
  return out.filter(Boolean);
}

// Fetches one page and turns it into a source record. The text field is what candidates
// and excerpts are checked against, so it always comes from this fetch.
async function pageSource(url, { type, title, date, maxBytes } = {}) {
  const r = await fetchText(url, { maxBytes: maxBytes || 1500000, timeoutMs: 12000 });
  const isHtml = /html|xml/i.test(r.contentType) || /^\s*</.test(r.text);
  const text = isHtml ? X.htmlToText(r.text) : r.text;
  return {
    url: r.url,
    title: (isHtml && X.pageTitle(r.text)) || title || r.url,
    date: (isHtml && X.pageDate(r.text, r.url)) || X.toIsoDate(date) || null,
    type,
    text: text.slice(0, 200000),
  };
}

const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const onDomain = (u, domain) => { const h = hostOf(u); return !!domain && (h === domain || h.endsWith(`.${domain}`)); };
const mentions = (text, name) => String(text || '').toLowerCase().includes(String(name || '').toLowerCase());

/* ---------- news: GDELT DOC API ---------- */
async function gdeltNews(account, log) {
  const q = `"${account.name}" sourcelang:english`;
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=artlist&format=json&maxrecords=30&timespan=3months&sort=hybridrel`;
  let data;
  for (let attempt = 0; attempt < 3 && !data; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 6000 * attempt));
    try { data = JSON.parse((await fetchText(url, { timeoutMs: 20000 })).text); } catch { /* rate-limited; retry */ }
  }
  if (!data) { log('News search (GDELT) is rate-limited or unavailable right now.'); return []; }
  const seen = new Set();
  const picks = (data.articles || []).filter((a) => {
    if (!mentions(a.title, account.name) || seen.has(a.domain)) return false;
    seen.add(a.domain);
    return true;
  }).slice(0, 6);
  const out = await mapLimit(picks, 3, async (a) => {
    const d = a.seendate ? `${a.seendate.slice(0, 4)}-${a.seendate.slice(4, 6)}-${a.seendate.slice(6, 8)}` : null;
    const s = await pageSource(a.url, { type: onDomain(a.url, account.domain) ? 'press' : 'news', title: a.title, date: d });
    if (!s.date) s.date = X.toIsoDate(d);
    return mentions(s.text, account.name) ? s : null;
  });
  log(`News: ${out.length} article(s) fetched.`);
  return out;
}

/* ---------- launches: Hacker News (Algolia) links to the company's own site ---------- */
async function hnLaunches(account, log) {
  if (!account.domain) return [];
  const since = Math.floor(Date.now() / 1000) - 2 * 365 * 86400;
  const data = await fetchJson(`https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(account.name)}&tags=story&hitsPerPage=50&numericFilters=created_at_i>${since}`);
  const seen = new Set();
  const hits = (data.hits || []).filter((h) => h.url && onDomain(h.url, account.domain) && !seen.has(h.url) && seen.add(h.url)).slice(0, 4);
  const out = await mapLimit(hits, 3, (h) => pageSource(h.url, {
    type: /launch|introduc|announc|now available|show hn|unveil|release/i.test(h.title) ? 'launch' : 'blog',
    title: h.title, date: h.created_at,
  }));
  log(`Launch posts: ${out.length} page(s) fetched.`);
  return out;
}

/* ---------- company blog / newsroom feeds ---------- */
function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<(item|entry)\b[\s\S]*?<\/\1>/gi) || [];
  for (const b of blocks.slice(0, 40)) {
    const tag = (t) => { const m = b.match(new RegExp(`<${t}\\b[^>]*>([\\s\\S]*?)<\\/${t}>`, 'i')); return m ? X.decodeEntities(X.stripCdata(m[1])).trim() : null; };
    let link = tag('link');
    if (!link || /^</.test(link)) { const m = b.match(/<link\b[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : null; }
    items.push({ title: tag('title'), link, date: X.toIsoDate(tag('pubDate') || tag('published') || tag('updated') || tag('dc:date')), description: tag('description') || tag('summary') || tag('content') });
  }
  return items.filter((i) => i.link && /^https?:/i.test(i.link));
}

// Fallback when a site has no feed: recent blog/news/press URLs from its sitemap.
const POST_PATH = /\/(blog|news|newsroom|press|press-releases|engineering|changelog|announcements|updates|stories)\/[^/?#]+/i;
async function sitemapPosts(domain) {
  const locs = async (u) => {
    const r = await fetchText(u, { timeoutMs: 8000, maxBytes: 5000000 });
    return [...r.text.matchAll(/<(?:url|sitemap)>([\s\S]*?)<\/(?:url|sitemap)>/gi)].map((m) => ({
      loc: X.decodeEntities(((m[1].match(/<loc>\s*([^<\s]+)\s*<\/loc>/i) || [])[1]) || ''),
      lastmod: X.toIsoDate(((m[1].match(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i) || [])[1]) || ''),
      isIndex: /^\s*<sitemap>/i.test(m[0]),
    })).filter((x) => x.loc);
  };
  let entries = [];
  const roots = [`https://${domain}/sitemap.xml`, `https://www.${domain}/sitemap.xml`];
  try {
    const robots = await fetchText(`https://${domain}/robots.txt`, { timeoutMs: 6000, maxBytes: 200000 });
    for (const m of robots.text.matchAll(/^\s*sitemap:\s*(\S+)/gim)) roots.unshift(m[1]);
  } catch { /* no robots.txt */ }
  for (const u of [...new Set(roots)].slice(0, 4)) {
    try { entries = await locs(u); } catch { /* try next */ }
    if (entries.length) break;
  }
  const subs = entries.filter((e) => e.isIndex || /\.xml(\.gz)?$/i.test(e.loc));
  if (subs.length) {
    const unlocalized = (e) => !/\/[a-z]{2}-[a-z]{2,4}\//i.test(e.loc);
    const pick = subs.filter((e) => /blog|news|press|post|article|resource/i.test(e.loc)).sort((a, b) => unlocalized(b) - unlocalized(a)).slice(0, 3);
    const more = await mapLimit(pick.length ? pick : subs.slice(0, 2), 3, (e) => locs(e.loc));
    entries = entries.concat(more.flat());
  }
  const path = (u) => { try { return new URL(u, `https://${domain}`).pathname; } catch { return ''; } };
  return entries
    .filter((e) => !/\.xml(\.gz)?$/i.test(e.loc) && onDomain(e.loc, domain) && POST_PATH.test(path(e.loc))
      && !/^\/[a-z]{2}(-[a-z]{2,4})?\//i.test(path(e.loc).replace(/^\/(en|en-us)\//i, '/'))
      && !/\/(topic|topics|tag|tags|category|categories|author|authors|page)\//i.test(path(e.loc)))
    .sort((a, b) => String(b.lastmod || '').localeCompare(String(a.lastmod || '')))
    .slice(0, 8)
    .map((e) => ({ link: e.loc, title: null, date: null, description: '', feed: 'sitemap' }));
}

// Last resort: post links listed on the company's own blog/newsroom index pages.
async function indexPagePosts(domain) {
  const pages = await mapLimit(['/blog', '/news', '/newsroom', '/press'], 4, (p) => fetchText(`https://${domain}${p}`, { timeoutMs: 8000, maxBytes: 3000000 }));
  const links = [];
  for (const pg of pages) {
    for (const m of pg.text.matchAll(/<a\b[^>]*href=["']([^"'#]+)["']/gi)) {
      let u;
      try { u = new URL(X.decodeEntities(m[1]), pg.url); } catch { continue; }
      if (onDomain(u.href, domain) && POST_PATH.test(u.pathname) && !/\/(topic|topics|tag|tags|category|categories|author|authors|page)\//i.test(u.pathname)
        && u.pathname.split('/').filter(Boolean).length >= 2) links.push(`${u.origin}${u.pathname}`);
    }
  }
  return [...new Set(links)].slice(0, 6).map((link) => ({ link, title: null, date: null, description: '', feed: 'index' }));
}

async function companyFeeds(account, log) {
  if (!account.domain) return [];
  let d = account.domain;
  const feedUrls = new Set();
  try {
    const home = await fetchText(`https://${d}/`, { timeoutMs: 8000, maxBytes: 800000 });
    d = new URL(home.url).hostname.replace(/^www\./, '');
    for (const m of home.text.matchAll(/<link\b[^>]*type=["']application\/(?:rss|atom)\+xml["'][^>]*>/gi)) {
      const href = m[0].match(/href=["']([^"']+)["']/i);
      if (href) feedUrls.add(new URL(X.decodeEntities(href[1]), home.url).href);
    }
  } catch { /* homepage blocked or down */ }
  ['/blog/rss.xml', '/blog/feed', '/blog/feed.xml', '/feed', '/rss.xml', '/atom.xml', '/blog/index.xml', '/news/rss.xml', '/newsroom/rss.xml', '/press/rss.xml']
    .forEach((p) => feedUrls.add(`https://${d}${p}`));
  [`https://blog.${d}/feed`, `https://blog.${d}/rss.xml`, `https://engineering.${d}/feed`].forEach((u) => feedUrls.add(u));

  const items = [];
  const www = `www.${d}`;
  [...feedUrls].filter((u) => hostOf(u) === d).forEach((u) => feedUrls.add(u.replace(`//${d}/`, `//${www}/`)));
  const tried = await mapLimit([...feedUrls].slice(0, 24), 6, async (u) => {
    const r = await fetchText(u, { timeoutMs: 7000, maxBytes: 2000000 });
    if (!/<(rss|feed|rdf)\b/i.test(r.text.slice(0, 2000))) return null;
    return parseFeed(r.text).map((it) => ({ ...it, feed: u }));
  });
  const seen = new Set();
  tried.flat().forEach((it) => { if (!seen.has(it.link)) { seen.add(it.link); items.push(it); } });
  if (!items.length) {
    for (const it of await sitemapPosts(d)) if (!seen.has(it.link)) { seen.add(it.link); items.push(it); }
  }
  if (!items.length) {
    for (const it of await indexPagePosts(d)) if (!seen.has(it.link)) { seen.add(it.link); items.push(it); }
  }
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  // Among recent posts, prefer ones that point at migrations, security, AI and similar engineering work.
  const top = items.slice(0, 15).map((it, i) => ({ it, i, k: O.strength(O.classify(`${it.title || ''} ${it.link} ${it.description || ''}`.slice(0, 2000))) }))
    .sort((a, b) => (b.k > 0) - (a.k > 0) || b.k - a.k || a.i - b.i).slice(0, 6).map((x) => x.it);
  const out = await mapLimit(top, 3, async (it) => {
    const type = /press|newsroom|\/news\//i.test(it.link + it.feed) ? 'press' : 'blog';
    try {
      const s = await pageSource(it.link, { type, title: it.title, date: it.date });
      if (!s.date) s.date = it.date;
      return s;
    } catch {
      // Fall back to the feed entry itself, which was fetched from the company's feed.
      return it.description ? { url: it.link, title: it.title, date: it.date, type, text: X.htmlToText(it.description) } : null;
    }
  });
  log(`Company blog/newsroom: ${out.length} post(s) from ${new Set(top.map((t) => t.feed)).size} feed(s).`);
  return out;
}

/* ---------- open roles: Greenhouse, Lever, Ashby public job boards ---------- */
const JOB_SIGNAL = /\b(ai|ml|machine learning|llm|genai|agents?|data platform|platform|infrastructure|api|developer|sdk|mobile|ios|android|automation|integrations?|software engineer|product engineer|forward deployed|migrations?|moderniz\w*|legacy|security|appsec|devops|sre|site reliability|cloud|test|qa|quality)\b/i;
const BUILD_TEAM = /\b(engineering|research|ai|ml|data|platform|security|infrastructure)\b/i;
const ENG_ROLE = /\b(engineer\w*|developer|sre|devops|architect|programmer|scientist)\b/i;
const BOARD_URL = { Greenhouse: (s) => `https://boards.greenhouse.io/${s}`, Lever: (s) => `https://jobs.lever.co/${s}`, Ashby: (s) => `https://jobs.ashbyhq.com/${s}` };

async function jobBoards(account, log) {
  const root = (account.domain || '').split('.')[0];
  const nameSlug = String(account.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const slugs = [...new Set([root, nameSlug, String(account.name || '').toLowerCase().trim().replace(/\s+/g, '-')].filter(Boolean))];
  let jobs = null;
  let board = null;
  let board_url = null;
  for (const slug of slugs) {
    const attempts = [
      ['Greenhouse', async () => (await fetchJson(`https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(slug)}/jobs?content=true`, { maxBytes: 8000000, timeoutMs: 15000 })).jobs.map((j) => ({
        title: j.title, url: j.absolute_url, date: j.first_published || j.updated_at,
        team: (j.departments || []).map((x) => x.name).join(', '), text: X.htmlToText(X.decodeEntities(j.content || '')),
      }))],
      ['Lever', async () => (await fetchJson(`https://api.lever.co/v0/postings/${encodeURIComponent(slug)}?mode=json`, { maxBytes: 8000000, timeoutMs: 15000 })).map((j) => ({
        title: j.text, url: j.hostedUrl, date: j.createdAt ? new Date(j.createdAt).toISOString() : null,
        team: (j.categories && (j.categories.team || j.categories.department)) || '', text: j.descriptionPlain || X.htmlToText(j.description || ''),
      }))],
      ['Ashby', async () => (await fetchJson(`https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(slug)}`, { maxBytes: 8000000, timeoutMs: 15000 })).jobs.map((j) => ({
        title: j.title, url: j.jobUrl, date: j.publishedAt, team: j.department || j.team || '', text: j.descriptionPlain || X.htmlToText(j.descriptionHtml || ''),
      }))],
    ];
    // A slug can exist on several boards (often a stale one); use the largest.
    const found = await Promise.all(attempts.map(async ([name, fn]) => {
      try { const list = await fn(); return Array.isArray(list) && list.length ? { name, list } : null; } catch { return null; }
    }));
    const best = found.filter(Boolean).sort((a, b) => b.list.length - a.list.length)[0];
    if (best) { jobs = best.list; board = `${best.name} (${slug})`; board_url = BOARD_URL[best.name](encodeURIComponent(slug)); }
    if (jobs) break;
  }
  if (!jobs) { log('Job postings: no public Greenhouse, Lever or Ashby board found.'); return []; }
  const byTeam = new Map();
  jobs.filter((j) => j.url && j.title)
    .map((j) => ({ ...j, s: (JOB_SIGNAL.test(j.title) ? 2 : 0) + (BUILD_TEAM.test(j.team) ? 2 : 0) + (JOB_SIGNAL.test(j.team) ? 1 : 0)
      + Math.min(3, O.strength(O.classify(`${j.title}. ${String(j.text).slice(0, 4000)}`)) * 0.3) }))
    .filter((j) => j.s > 0)
    .sort((a, b) => b.s - a.s || String(b.date || '').localeCompare(String(a.date || '')))
    .forEach((j) => { if (!byTeam.has(j.team || j.title)) byTeam.set(j.team || j.title, j); });
  const picks = [...byTeam.values()].slice(0, 5);
  log(`Job postings: ${jobs.length} open role(s) on ${board}; using ${picks.length}.`);
  const out = picks.map((j) => ({
    url: j.url, title: `${j.title}${j.team ? ` (${j.team})` : ''}`, date: X.toIsoDate(j.date), type: 'job',
    text: `${j.title}.\n${j.text}`.slice(0, 60000),
  }));
  const summary = staffingSummary(account, jobs, board.split(' ')[0], board_url);
  if (summary) out.unshift(summary);
  return out;
}

// Engineering hiring volume, computed from the public board listing itself.
function staffingSummary(account, jobs, boardName, url) {
  const eng = jobs.filter((j) => ENG_ROLE.test(j.title) || /engineering/i.test(j.team || ''));
  if (eng.length < 3) return null;
  const teams = new Map();
  eng.forEach((j) => { const t = j.team || 'Unspecified team'; teams.set(t, (teams.get(t) || 0) + 1); });
  const topTeams = [...teams.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, n]) => `${t} (${n})`).join(', ');
  const newest = eng.map((j) => X.toIsoDate(j.date)).filter(Boolean).sort().pop() || null;
  const text = `${account.name} lists ${jobs.length} open roles on its public ${boardName} job board, ${eng.length} of them engineering roles. `
    + `Engineering hiring is concentrated in ${topTeams}. `
    + `Sample engineering openings: ${eng.slice(0, 6).map((j) => j.title).join('; ')}.`;
  return { url, title: `${account.name} is hiring ${eng.length} engineers`, date: newest, type: 'job', text };
}

/* ---------- security: NVD CVEs that name the company as the product vendor ---------- */
function parseNvd(data, account) {
  const slug = String(account.name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
  const root = (account.domain || '').split('.')[0].toLowerCase();
  const nameRe = new RegExp(`\\b${String(account.name || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  return (data.vulnerabilities || []).map((v) => v.cve).filter((c) => {
    if (!c || !c.id) return false;
    const vendors = JSON.stringify(c.configurations || []).match(/cpe:2\.3:[aoh]:([^:]+):/g) || [];
    const vendorHit = vendors.some((m) => { const vnd = m.split(':')[3]; return vnd === slug || vnd === root; });
    const desc = ((c.descriptions || []).find((d) => d.lang === 'en') || {}).value || '';
    return vendorHit || (!vendors.length && nameRe.test(desc));
  }).map((c) => {
    const desc = ((c.descriptions || []).find((d) => d.lang === 'en') || {}).value || '';
    const m = c.metrics || {};
    const metric = [...(m.cvssMetricV40 || []), ...(m.cvssMetricV31 || []), ...(m.cvssMetricV30 || [])][0];
    const sev = metric && metric.cvssData ? ` CVSS ${metric.cvssData.baseScore} (${metric.cvssData.baseSeverity}).` : '';
    return {
      url: `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(c.id)}`, title: `${c.id}: security vulnerability in ${account.name} software`,
      date: X.toIsoDate(c.published), type: 'security', text: `${c.id} security vulnerability. ${desc.replace(/\s+/g, ' ')}${sev}`.slice(0, 20000),
    };
  }).sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

async function nvdCves(account, log) {
  if (!account.name) return [];
  const end = new Date();
  const start = new Date(end.getTime() - 119 * 86400000);
  const iso = (d) => d.toISOString().replace('Z', '');
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=${encodeURIComponent(account.name)}&pubStartDate=${iso(start)}&pubEndDate=${iso(end)}&resultsPerPage=200`;
  let data;
  try { data = await fetchJson(url, { timeoutMs: 20000, maxBytes: 8000000 }); } catch (e) { log(`Security advisories (NVD) unavailable right now: ${e.message}`); return []; }
  const all = parseNvd(data, account);
  log(all.length ? `Security advisories: ${all.length} CVE(s) for ${account.name} products in the last 120 days; using ${Math.min(all.length, 3)}.` : 'Security advisories: no recent CVEs name this company as the vendor.');
  return all.slice(0, 3);
}

/* ---------- SEC EDGAR filings (10-K / 20-F / S-1 / F-1) ---------- */
async function secFilings(account, log) {
  if (!account.cik) { log('SEC filings: no SEC CIK on record for this company (likely private).'); return []; }
  const cik = String(account.cik).replace(/\D/g, '').padStart(10, '0');
  const sub = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { maxBytes: 5000000 });
  const r = sub.filings && sub.filings.recent;
  if (!r) return [];
  const wanted = ['10-K', '20-F', 'S-1', 'F-1'];
  const picks = [];
  for (let i = 0; i < r.form.length && picks.length < 2; i++) {
    if (wanted.includes(r.form[i]) && !picks.some((p) => p.form === r.form[i])) {
      picks.push({ form: r.form[i], date: r.filingDate[i], acc: r.accessionNumber[i].replace(/-/g, ''), doc: r.primaryDocument[i] });
    }
  }
  const out = await mapLimit(picks, 2, async (p) => {
    const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${p.acc}/${p.doc}`;
    const res = await fetchText(url, { maxBytes: 8000000, timeoutMs: 30000 });
    let text = X.htmlToText(res.text);
    const hits = [...text.matchAll(/item\s*1\.?\s*business/gi)];
    const start = hits.length > 1 ? hits[1].index : hits.length ? hits[0].index : 0;
    text = text.slice(start, start + 60000);
    return { url, title: `${sub.name || account.name} ${p.form} filed ${p.date}`, date: p.date, type: 'filing', text };
  });
  log(`SEC filings: ${out.length} filing(s) fetched.`);
  return out;
}

module.exports = { pageSource, gdeltNews, hnLaunches, companyFeeds, jobBoards, nvdCves, parseNvd, staffingSummary, secFilings, parseFeed, mapLimit, onDomain, hostOf };
