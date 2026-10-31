'use strict';
const X = require('./extract');

const TYPE_LABEL = {
  news: 'News article', press: 'Press release', blog: 'Company blog post', launch: 'Product launch',
  job: 'Open job posting', filing: 'SEC filing', web: 'Web page', manual: 'Your finding',
};
const TYPE_WEIGHT = { press: 1.1, launch: 1.1, blog: 1.0, filing: 0.9, job: 0.85, news: 0.8, web: 0.6, manual: 1.2 };

function relevanceText(src, kws) {
  const when = src.date ? ` (${src.date})` : '';
  let base;
  switch (src.type) {
    case 'job': base = `Open role${when}: companies hire where they are investing, so a demo of a workflow this team would own is timely.`; break;
    case 'filing': base = `Stated in an SEC filing${when}. Filings describe strategy the company has committed to publicly.`; break;
    case 'blog': base = `Published on the company's own site${when}, so it describes work they chose to highlight.`; break;
    case 'press': base = `Announcement from the company${when}. A demo that extends it connects to something they are actively promoting.`; break;
    case 'launch': base = `Product launch${when}. A demo that builds on it connects to something they are actively promoting.`; break;
    case 'news': base = `Third-party coverage${when}. Useful context, but confirm it against a primary source.`; break;
    case 'manual': base = 'Added by you.'; break;
    default: base = `Public web page${when}.`;
  }
  if (kws.length) base += ` Signals: ${kws.join(', ')}.`;
  if (X.isStale(src.date)) base += ' Older than 12 months: treat as a lead, not proof of current direction.';
  return base;
}

function scoreFor(src, bestSentenceScore, injected) {
  const age = X.ageDays(src.date);
  const recency = age === null ? 0.3 : age <= 90 ? 1 : age <= 180 ? 0.8 : age <= 365 ? 0.5 : -1;
  return (TYPE_WEIGHT[src.type] || 0.6) + recency + Math.min(Math.max(bestSentenceScore, 0), 4) * 0.4 - (injected ? 2 : 0);
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
  return finalize(src, { excerpt: best[0].s, summary, bestScore: best[0].score, injected, usableText: usable.join(' ') }, companyName);
}

function finalize(src, { title, summary, excerpt, bestScore = 1, injected = false, usableText = '', relevance, origin, extraFlags }, companyName) {
  let t = title || X.cleanTitle(src.title);
  if (!t || X.looksLikeInstructions(t)) t = X.shorten(excerpt, 90);
  const kws = [...new Set(X.matchedKeywords(usableText || `${summary} ${excerpt}`))].slice(0, 5);
  return {
    title: X.shorten(t, 140),
    summary: X.shorten(summary, 400),
    excerpt,
    source_url: src.url || null,
    source_title: src.title ? X.shorten(X.looksLikeInstructions(src.title) ? '(title withheld: instruction-like text)' : src.title, 200) : null,
    source_date: src.date || null,
    source_type: src.type,
    relevance: relevance || relevanceText(src, kws),
    origin: origin || 'fetched',
    score: Math.round(scoreFor(src, bestScore, injected) * 100) / 100,
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
