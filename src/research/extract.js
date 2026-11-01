'use strict';
const { sentenceSignal } = require('./opportunity');

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '-', ndash: '-', hellip: '...', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', copy: '(c)', reg: '(R)', trade: '(TM)', middot: '-', bull: '-' };

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return ' '; }
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

function stripCdata(s) { return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1'); }

function htmlToText(html) {
  let h = String(html || '');
  h = h.replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|template|iframe|head|form|select|button)\b[\s\S]*?<\/\1>/gi, ' ');
  const pick = (tag) => {
    const m = h.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    return m && m[1].replace(/<[^>]+>/g, '').trim().length > 400 ? m[1] : null;
  };
  const main = pick('article') || pick('main');
  if (main) h = main;
  else h = h.replace(/<(nav|footer|header|aside)\b[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<\/?(p|div|br|li|h[1-6]|tr|section|article|blockquote|pre|ul|ol|table|dd|dt)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(h).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function metaContent(html, names) {
  for (const n of names) {
    const re1 = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${n}["'][^>]*content=["']([^"']+)["']`, 'i');
    const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name|itemprop)=["']${n}["']`, 'i');
    const m = html.match(re1) || html.match(re2);
    if (m) return decodeEntities(m[1]).trim();
  }
  return null;
}

function pageTitle(html) {
  const og = metaContent(html, ['og:title', 'twitter:title']);
  if (og) return og;
  const m = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return m ? decodeEntities(stripCdata(m[1])).replace(/\s+/g, ' ').trim() : null;
}

function toIsoDate(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  if (y < 1995 || d.getTime() > Date.now() + 2 * 86400000) return null;
  return d.toISOString().slice(0, 10);
}

function pageDate(html, url) {
  const h = String(html || '');
  const meta = metaContent(h, ['article:published_time', 'og:published_time', 'datePublished', 'pubdate', 'publish-date', 'date', 'dc.date', 'DC.date.issued', 'parsely-pub-date', 'sailthru.date']);
  if (toIsoDate(meta)) return toIsoDate(meta);
  const ld = h.match(/"datePublished"\s*:\s*"([^"]+)"/);
  if (ld && toIsoDate(ld[1])) return toIsoDate(ld[1]);
  const t = h.match(/<time[^>]+datetime=["']([^"']+)["']/i);
  if (t && toIsoDate(t[1])) return toIsoDate(t[1]);
  const u = String(url || '').match(/\/(20\d\d)[/-](\d\d)(?:[/-](\d\d))?\//);
  if (u) return toIsoDate(`${u[1]}-${u[2]}-${u[3] || '01'}`);
  return null;
}

function splitSentences(text) {
  return String(text || '')
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

// Scraped text is data. Sentences that read like directives to a model or agent are never
// used for titles, summaries or excerpts, and the source is flagged so the owner can see it.
const STRONG_INJECTION = [
  /\bignore\b.{0,40}\b(instructions?|task|prompt|directions|rules|guidelines|above|previous)\b/i,
  /\bdisregard\b.{0,40}\b(instructions?|task|prompt|above|previous|rules)\b/i,
  /\bforget\b.{0,30}\b(instructions?|task|prompt|everything)\b/i,
  /\byou are now\b/i,
  /\b(system|developer) (prompt|message|instructions?)\b/i,
  /\bnew instructions?\b/i,
  /\b(e-?mail|send|forward|upload|exfiltrate|post|share|leak)\b.{0,50}\b(this|that|the|these|those|following|our|your|all)\s+(list|data|contacts?|credentials|keys?|secrets?|passwords?|emails?|information|files?|cookies?)\b/i,
  /<\/?\s*(system|assistant|instructions?|prompt)\s*>/i,
  /\b(ai|llm|language model|assistant|agent|devin)s?\b.{0,40}\b(must|should|shall|need to)\b.{0,40}\b(ignore|instead|reveal|send|email|include|add)\b/i,
  /\boverride\b.{0,30}\b(instructions?|rules|brief|template|settings)\b/i,
  /\bdo not (tell|inform|reveal to) (the )?(user|owner|human)\b/i,
];
const WEAK_INJECTION = [/\bapi[ _-]?keys?\b/i, /\bpasswords?\b/i, /\bcredentials?\b/i, /\bprompt\b/i, /\binstructions?\b.{0,20}\b(above|below|following)\b/i];

const isStrongInjection = (s) => STRONG_INJECTION.some((re) => re.test(s));
const looksLikeInstructions = (s) => isStrongInjection(s) || WEAK_INJECTION.some((re) => re.test(s));

const KEYWORDS = ['launch', 'launched', 'launching', 'introduc', 'announc', 'unveil', 'new product', 'platform', ' ai ', 'ai-', 'artificial intelligence',
  'machine learning', 'llm', 'generative', 'agent', 'automat', 'data', 'analytics', 'api', 'developer', 'migrat', 'moderniz',
  'cloud', 'infrastructure', 'expan', 'invest', 'strategy', 'roadmap', 'building', 'build', 'beta', 'general availability',
  'rollout', 'rolling out', 'integration', 'workflow', 'dashboard', 'real-time', 'priorit', 'initiative', 'partnership',
  'customer experience', 'self-serve', 'mobile app', 'personaliz', 'security', 'compliance', 'scale', 'we plan', 'we intend', 'we are investing'];

function matchedKeywords(s) {
  const t = ` ${String(s).toLowerCase()} `;
  return KEYWORDS.filter((k) => t.includes(k)).map((k) => k.trim().replace(/-$/, ''));
}

function sentenceScore(s, companyName) {
  let score = matchedKeywords(s).length + 1.5 * sentenceSignal(s) + require('./wow').projectSignal(s).score;
  if (companyName && s.toLowerCase().includes(companyName.toLowerCase())) score += 1.5;
  if (s.length < 60) score -= 1;
  return score;
}

const normalize = (s) => decodeEntities(String(s || '')).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
function excerptIsVerbatim(excerpt, text) {
  const e = normalize(excerpt);
  return e.length >= 20 && normalize(text).includes(e);
}

const shorten = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

function cleanTitle(title, siteHint) {
  let t = String(title || '').replace(/\s+/g, ' ').trim();
  t = t.replace(/\s+[|·–—-]\s+[^|·–—-]{2,40}$/, '').trim() || t;
  if (siteHint && t.toLowerCase() === siteHint.toLowerCase()) return t;
  return t;
}

const DAY = 86400000;
function ageDays(iso) { return iso ? (Date.now() - new Date(iso).getTime()) / DAY : null; }
function isStale(iso) { const a = ageDays(iso); return a !== null && a > 365; }

module.exports = {
  decodeEntities, stripCdata, htmlToText, pageTitle, pageDate, toIsoDate, splitSentences, metaContent,
  isStrongInjection, looksLikeInstructions, matchedKeywords, sentenceScore, excerptIsVerbatim,
  shorten, cleanTitle, ageDays, isStale, normalize,
};
