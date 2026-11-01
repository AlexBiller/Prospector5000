'use strict';
const X = require('./extract');
const O = require('./opportunity');
const W = require('./wow');

const TYPE_LABEL = {
  news: 'News article', press: 'Press release', blog: 'Company blog post', launch: 'Product launch',
  job: 'Open job posting', filing: 'SEC filing', security: 'Security advisory (CVE)', study: 'Published security study or incident', web: 'Web page', manual: 'Your finding',
};
const TYPE_WEIGHT = { press: 1.1, launch: 1.1, blog: 1.0, filing: 0.9, job: 0.7, security: 1.1, study: 1.3, news: 0.8, web: 0.6, manual: 1.2 };
// Roles and summaries that rarely point to a specific project.
const NON_ENG_JOB = /\b(product manager|program manager|partnerships?|business development|activation|account (?:executive|manager)|sales|marketing|recruit\w*|designer|customer success|operations manager|counsel|finance)\b/i;
const HIRING_SUMMARY = /\bis hiring \d+ engineers\b/i;

function relevanceText(src, kws, wowText) {
  const when = src.date ? ` (${src.date})` : '';
  let base;
  switch (src.type) {
    case 'job': base = `Open role${when}: companies hire where they are investing, so a demo of a workflow this team would own is timely.`; break;
    case 'security': base = `Published vulnerability affecting this company's products${when}. Remediation work like this is a direct fit for Devin.`; break;
    case 'study': base = `Published write-up of a security event involving this company${when}. A demo that safely reproduces and fixes the same class of flaw is concrete and memorable.`; break;
    case 'filing': base = `Stated in an SEC filing${when}. Filings describe strategy the company has committed to publicly.`; break;
    case 'blog': base = `Published on the company's own site${when}, so it describes work they chose to highlight.`; break;
    case 'press': base = `Announcement from the company${when}. A demo that extends it connects to something they are actively promoting.`; break;
    case 'launch': base = `Product launch${when}. A demo that builds on it connects to something they are actively promoting.`; break;
    case 'news': base = `Third-party coverage${when}. Useful context, but confirm it against a primary source.`; break;
    case 'manual': base = 'Added by you.'; break;
    default: base = `Public web page${when}.`;
  }
  const wow = W.projectSignal(wowText || '', { securityEvents: src.type !== 'job' });
  if (wow.reasons.length) base += ` Why it could wow: ${wow.reasons.join(', ')}.`;
  if (kws.length) base += ` Signals: ${kws.join(', ')}.`;
  if (X.isStale(src.date)) base += ' Older than 12 months: treat as a lead, not proof of current direction.';
  return base;
}

// Opportunities where Devin / Cognition can help (migrations, security, AI, capacity...) rank above generic news.
function opportunityBoost(text, type) {
  const s = O.strength(O.classify(text, type));
  return s ? Math.min(2, s * 0.35) : -0.8;
}

// Specific, large projects and published security events outrank generic signals.
function wowAdjust(src, wowText) {
  const title = String(src.title || '');
  let adj = Math.min(2.5, W.projectSignal(wowText, { securityEvents: src.type !== 'job' }).score);
  if (src.type === 'job' && HIRING_SUMMARY.test(title)) adj -= 1;
  else if (src.type === 'job' && NON_ENG_JOB.test(title)) adj -= 1.5;
  return adj;
}

function scoreFor(src, bestSentenceScore, injected, oppText, wowText) {
  const age = X.ageDays(src.date);
  const recency = age === null ? 0.3 : age <= 90 ? 1 : age <= 180 ? 0.8 : age <= 365 ? 0.5 : -1;
  return (TYPE_WEIGHT[src.type] || 0.6) + recency + Math.min(Math.max(bestSentenceScore, 0), 4) * 0.3
    + opportunityBoost(oppText, src.type) + wowAdjust(src, wowText || oppText) - (injected ? 2 : 0);
}

function flagsFor(src, injected, extra = {}) {
  return {
    stale: X.isStale(src.date),
    date_unknown: !src.date,
    embedded_instructions: injected,
    ...extra,
  };
}

// Builds a candidate purely from text that was actually fetched. Returns null when the page
// has nothing usable rather than padding it out.
function fromSource(src, companyName) {
  const all = X.splitSentences(src.text);
  const injected = all.some(X.isStrongInjection) || X.isStrongInjection(src.title || '');
  const usable = all.filter((s) => s.length >= 40 && s.length <= 400 && !X.looksLikeInstructions(s));
  if (!usable.length) return null;
  const scored = usable.map((s, i) => ({ s, i, score: X.sentenceScore(s, companyName) }));
  const best = [...scored].sort((a, b) => b.score - a.score || a.i - b.i);
  if (best[0].score <= 0 && src.type !== 'job' && src.type !== 'manual') return null;
  const summary = X.shorten(best.slice(0, 3).sort((a, b) => a.i - b.i).slice(0, 2).map((x) => x.s).join(' '), 360);
  const keyText = best.slice(0, 3).map((x) => x.s).join(' ');
  return finalize(src, { excerpt: best[0].s, summary, bestScore: best[0].score, injected, usableText: usable.join(' '), keyText }, companyName);
}

function finalize(src, { title, summary, excerpt, bestScore = 1, injected = false, usableText = '', keyText, relevance, origin, extraFlags }, companyName) {
  let t = title || X.cleanTitle(src.title);
  if (!t || X.looksLikeInstructions(t)) t = X.shorten(excerpt, 90);
  const kws = [...new Set(X.matchedKeywords(usableText || `${summary} ${excerpt}`))].slice(0, 5);
  // Only the strongest sentences count, so boilerplate on long pages (job ads, footers) cannot inflate the signal.
  const wowText = `${t}. ${keyText || `${summary} ${excerpt}`}`;
  return {
    title: X.shorten(t, 140),
    summary: X.shorten(summary, 400),
    excerpt,
    source_url: src.url || null,
    source_title: src.title ? X.shorten(X.looksLikeInstructions(src.title) ? '(title withheld: instruction-like text)' : src.title, 200) : null,
    source_date: src.date || null,
    source_type: src.type,
    relevance: relevance || relevanceText(src, kws, wowText),
    origin: origin || 'fetched',
    score: Math.round(scoreFor(src, bestScore, injected, `${t} ${summary} ${excerpt}`, wowText) * 100) / 100,
    flags: flagsFor(src, injected, { excerpt_verified: src.text ? X.excerptIsVerbatim(excerpt, src.text) : false, ...(extraFlags || {}) }),
    recommended: false,
  };
}

function rank(cands) {
  const seen = new Set();
  const out = cands.filter((c) => {
    const key = (c.source_url || '').replace(/[#?].*$/, '').replace(/\/$/, '') || `${c.title}|${c.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => b.score - a.score);
  // Diversity: each further candidate of the same source type ranks a little lower, so one
  // prolific source (e.g. a large job board) cannot crowd out launches and announcements.
  const seenType = {};
  out.forEach((c) => { c._adj = c.score - 0.45 * (seenType[c.source_type] || 0); seenType[c.source_type] = (seenType[c.source_type] || 0) + 1; });
  out.sort((a, b) => b._adj - a._adj).forEach((c) => { delete c._adj; });
  const rec = out.find((c) => !c.flags.stale && !c.flags.embedded_instructions && (c.flags.excerpt_verified || c.origin !== 'fetched'));
  if (rec) rec.recommended = true;
  return out;
}

function evidenceMessage(cands) {
  if (!cands.length) return 'No usable evidence was found. Add findings manually, or try again later.';
  const current = cands.filter((c) => !c.flags.stale && !c.flags.date_unknown).length;
  const parts = [`${cands.length} candidate${cands.length === 1 ? '' : 's'} from ${new Set(cands.map((c) => c.source_type)).size} source type(s); ${current} dated within the last 12 months.`];
  if (current < 3) parts.push('Evidence is thin: weigh the recommendation accordingly and consider adding your own findings.');
  if (!cands.some((c) => c.recommended)) parts.push('No candidate is recent and clean enough to recommend.');
  return parts.join(' ');
}

module.exports = { fromSource, finalize, rank, evidenceMessage, TYPE_LABEL };
