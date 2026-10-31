'use strict';
const config = require('../config');
const S = require('./sources');
const C = require('./candidates');
const X = require('./extract');
const llm = require('./llm');
const { tavilySources } = require('./tavily');

function providerStatus() {
  const p = config.research.provider;
  if (p === 'public') return { available: true, name: 'public', label: 'Public sources (GDELT news, company feeds, HN launches, job boards, SEC EDGAR)' };
  if (config.research.tavilyKey && (!p || p === 'tavily')) return { available: true, name: 'tavily', label: 'Tavily search + public job boards and SEC EDGAR' };
  return { available: false, name: null, label: 'Not configured' };
}

async function gather(account, log) {
  const status = providerStatus();
  const tasks = status.name === 'tavily'
    ? [tavilySources, S.jobBoards, S.secFilings]
    : [S.gdeltNews, S.hnLaunches, S.companyFeeds, S.jobBoards, S.secFilings];
  const settled = await Promise.allSettled(tasks.map((t) => t(account, log)));
  settled.forEach((r, i) => { if (r.status === 'rejected') log(`${tasks[i].name} failed: ${r.reason && r.reason.message}`); });
  const seen = new Set();
  return settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
    .filter((s) => s && s.text && s.url && !seen.has(s.url) && seen.add(s.url))
    .slice(0, config.research.maxSources);
}

function heuristicCandidates(account, sources) {
  return sources.map((s) => C.fromSource(s, account.name)).filter(Boolean);
}

async function candidatesFromSources(account, sources, log) {
  if (llm.configured() && sources.length) {
    try {
      const picks = await llm.synthesize(account, sources);
      if (picks.length) {
        log(`Model proposed ${picks.length} candidate(s); all excerpts verified against fetched pages.`);
        const injected = new Set(sources.filter((s) => X.splitSentences(s.text).some(X.isStrongInjection)).map((s) => s.url));
        return picks.map((p) => C.finalize(p.src, {
          title: p.title, summary: p.summary, excerpt: p.excerpt, bestScore: X.sentenceScore(p.excerpt, account.name),
          injected: injected.has(p.src.url),
          relevance: undefined,
        }, account.name)).map((c, i) => (picks[i].why ? { ...c, relevance: `${picks[i].why} ${c.relevance}` } : c));
      }
      log('Model found no verifiable candidates; falling back to extraction.');
    } catch (e) {
      log(`Model step failed (${e.message}); falling back to extraction.`);
    }
  }
  return heuristicCandidates(account, sources);
}

async function runResearch(account) {
  const lines = [];
  const log = (m) => lines.push(m);
  const sources = await gather(account, log);
  const cands = C.rank(await candidatesFromSources(account, sources, log));
  return { candidates: cands, message: C.evidenceMessage(cands), log: lines };
}

// Manual findings: each row is a URL and/or a note. URLs are fetched when possible so the
// excerpt can come from the page; otherwise the owner's own note is the evidence.
async function manualCandidates(account, rows) {
  const out = [];
  for (const row of rows) {
    const note = String(row.note || '').trim().slice(0, 1000);
    const url = String(row.url || '').trim();
    const userDate = X.toIsoDate(row.date);
    if (!note && !url) continue;
    let src = null;
    let fetchError = null;
    if (url) {
      try { src = await S.pageSource(url, { type: 'manual' }); } catch (e) { fetchError = e.message; }
    }
    if (src) {
      if (userDate) src.date = userDate;
      const built = C.fromSource(src, account.name);
      const noteWords = note.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
      const sentences = X.splitSentences(src.text).filter((s) => s.length >= 40 && s.length <= 400 && !X.looksLikeInstructions(s));
      const byNote = sentences.map((s) => ({ s, k: noteWords.filter((w) => s.toLowerCase().includes(w)).length + X.sentenceScore(s, account.name) / 10 }))
        .sort((a, b) => b.k - a.k)[0];
      const excerpt = (byNote && byNote.s) || (built && built.excerpt) || note;
      const injected = X.splitSentences(`${src.text} ${note}`).some(X.isStrongInjection);
      out.push(C.finalize(src, {
        title: String(row.title || '').trim() || null,
        summary: note || (built && built.summary) || X.shorten(excerpt, 300),
        excerpt, injected, bestScore: 2, origin: 'manual+fetched', usableText: sentences.join(' '),
      }, account.name));
    } else {
      const pseudo = { url: url || null, title: row.title || null, date: userDate, type: 'manual', text: '' };
      out.push(C.finalize(pseudo, {
        title: String(row.title || '').trim() || X.shorten(note, 90),
        summary: note, excerpt: note, bestScore: 2, origin: 'manual',
        injected: X.splitSentences(note).some(X.looksLikeInstructions),
        extraFlags: url ? { fetch_failed: fetchError || true } : {},
      }, account.name));
    }
  }
  return out;
}

module.exports = { providerStatus, runResearch, manualCandidates, gather, candidatesFromSources };
