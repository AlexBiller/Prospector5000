'use strict';
const fs = require('fs');
const path = require('path');
const { html, raw, safeUrl } = require('./html');
const { TYPE_LABEL } = require('./research/candidates');
const { DEMO_LABEL, MAX_INTERACTIONS } = require('./brief');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'style.css'), 'utf8');

const STATUS = {
  confirming: 'Confirming company', researching: 'Researching', awaiting_approval: 'Awaiting approval',
  brief_ready: 'Brief ready', building: 'Building', demo_live: 'Demo live',
};
const statusBadge = (s) => html`<span class="badge st-${s}">${STATUS[s] || s}</span>`;
const modeBadge = (m) => html`<span class="badge mode-${m}">${m}</span>`;
const ext = (u, label) => { const s = safeUrl(u); return s ? html`<a href="${s}" target="_blank" rel="noopener noreferrer nofollow">${label || s}</a>` : html`<span class="muted">-</span>`; };
const day = (iso) => (iso ? String(iso).slice(0, 10) : '');

function layout({ title, body, nonce, authed = true, refresh }) {
  return html`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="same-origin">${refresh ? html`<meta http-equiv="refresh" content="${refresh}">` : ''}
<title>${title} · Prospector5000</title>${authed ? html`<link rel="stylesheet" href="/static/style.css">` : html`<style nonce="${nonce}">${raw(CSS)}</style>`}</head>
<body><header class="top"><a class="brand" href="/">Prospector5000</a>${authed ? html`<nav><a href="/">Dashboard</a><a href="/settings">Settings</a>
<form method="post" action="/logout" class="inline"><button class="link">Sign out</button></form></nav>` : ''}</header>
<main>${body}</main>${authed ? html`<script src="/static/app.js"></script>` : ''}</body></html>`.toString();
}

function loginPage({ nonce, error }) {
  return layout({ title: 'Sign in', nonce, authed: false, body: html`<section class="card narrow"><h1>Sign in</h1>
${error ? html`<p class="error">${error}</p>` : ''}
<form method="post" action="/login"><label>Owner password<input type="password" name="password" autocomplete="current-password" required autofocus></label>
<button class="primary">Sign in</button></form></section>` });
}

function dashboard({ accounts, devinConnected }) {
  const rows = accounts.map((a) => html`<tr>
<td><a href="/accounts/${a.id}"><strong>${a.name || a.query_name}</strong></a><div class="muted small">${a.domain || 'unconfirmed'}</div></td>
<td>${statusBadge(a.status)}${a.error ? html`<div class="error small">needs attention</div>` : ''}</td><td>${modeBadge(a.mode)}</td>
<td>${(a.proposal && a.proposal.title) || html`<span class="muted">-</span>`}</td>
<td>${ext(a.demo_url, 'Demo')}</td><td>${ext(a.repo_url, 'Repo')}</td>
<td>${a.acus_consumed != null ? Number(a.acus_consumed).toFixed(1) : html`<span class="muted">-</span>`}</td>
<td class="small">${day(a.created_at)}</td><td class="small notes">${a.notes || ''}</td></tr>`);
  return html`<section class="card"><h1>New account</h1>
<form method="post" action="/accounts" class="row"><input name="company" placeholder="Company name, e.g. Ramp" required maxlength="100">
<button class="primary">Find company</button></form>
<p class="muted small">Devin API: ${devinConnected ? 'configured (builds run automatically)' : 'not configured (manual copy-paste flow)'}.</p></section>
<section class="card"><h2>Accounts</h2>${accounts.length ? html`<div class="scroll"><table><thead><tr><th>Company</th><th>Status</th><th>Mode</th><th>Approved project</th><th>Demo</th><th>Repo</th><th>ACUs</th><th>Date</th><th>Notes</th></tr></thead>
<tbody>${rows}</tbody></table></div>` : html`<p class="muted">No accounts yet.</p>`}</section>`;
}

function flagsView(c) {
  const f = c.flags || {};
  return html`${f.stale ? html`<span class="flag stale" title="Older than 12 months">Older than 12 months: lead, not proof</span>` : ''}
${f.date_unknown ? html`<span class="flag warn">Date unknown</span>` : ''}
${f.embedded_instructions ? html`<span class="flag danger" title="The page contains text addressed to an AI or agent. It was treated as data and excluded.">Embedded instructions detected (ignored)</span>` : ''}
${c.origin === 'fetched' && !f.excerpt_verified ? html`<span class="flag warn">Excerpt not verified</span>` : ''}
${f.fetch_failed ? html`<span class="flag warn">Page could not be fetched; evidence is your note</span>` : ''}`;
}

function candidateCard(a, c, { selectable }) {
  return html`<article class="cand ${c.recommended ? 'recommended' : ''} ${c.flags && c.flags.stale ? 'is-stale' : ''}">
<div class="cand-head">${c.recommended ? html`<span class="badge rec">Recommended</span>` : ''}<span class="badge type">${TYPE_LABEL[c.source_type] || c.source_type}</span>
<span class="date ${c.flags && c.flags.stale ? 'stale' : ''}">${c.source_date || 'date unknown'}</span>${flagsView(c)}</div>
<h3>${c.title}</h3><p>${c.summary}</p>
<p class="small"><strong>Why it fits a demo:</strong> ${c.relevance}</p>
<blockquote class="excerpt"><span class="muted small">${c.origin === 'manual' ? 'Your note' : 'Excerpt from source'}:</span> ${c.excerpt}</blockquote>
<p class="small">Source: ${c.source_url ? ext(c.source_url, c.source_title || c.source_url) : html`<span class="muted">manual entry (no URL)</span>`} · ${c.origin}</p>
${selectable ? html`<a class="button" href="/accounts/${a.id}/propose?candidate=${c.id}">Use this project</a>` : ''}</article>`;
}

function manualFindingsForm(a) {
  const row = (i) => html`<div class="finding"><input name="url_${i}" placeholder="https://… (optional)" maxlength="2000">
<input name="date_${i}" type="date" title="Source date (optional)"><input name="title_${i}" placeholder="Short title (optional)" maxlength="140">
<textarea name="note_${i}" rows="2" placeholder="What does this show they are building or prioritizing?" maxlength="1000"></textarea></div>`;
  return html`<details class="card-inner" ${a.status === 'researching' ? 'open' : ''}><summary>Add findings manually</summary>
<form method="post" action="/accounts/${a.id}/findings">${[0, 1, 2].map(row)}
<p class="muted small">URLs are fetched (public pages only) so the excerpt comes from the page; if a page cannot be fetched, your note is used and labeled as such.</p>
<button>Add findings</button></form></details>`;
}

function accountPage({ a, candidates, events, research, devinOn, error, flash }) {
  const cand = candidates.find((c) => c.id === a.approved_candidate_id);
  const sections = [];
  sections.push(html`<section class="card"><div class="title-row"><h1>${a.name || a.query_name}</h1>${statusBadge(a.status)} ${modeBadge(a.mode)}</div>
${a.domain ? html`<p><strong>${a.domain}</strong> · ${a.description || ''}</p>` : html`<p class="muted">Searched for "${a.query_name}"</p>`}
${error ? html`<p class="error">${error}</p>` : ''}${flash ? html`<p class="flash">${flash}</p>` : ''}${a.error ? html`<p class="error">${a.error}</p>` : ''}</section>`);

  if (a.status === 'confirming') {
    const opts = a.disambiguation || [];
    sections.push(html`<section class="card"><h2>1. Which company do you mean?</h2>
${opts.length ? html`<form method="post" action="/accounts/${a.id}/confirm">${opts.map((o, i) => html`<label class="choice"><input type="radio" name="choice" value="${i}" ${i === 0 ? 'required' : ''}>
<span><strong>${o.name}</strong> · ${o.domain}<br><span class="muted small">${o.description || 'no description'}</span></span></label>`)}
<button class="primary">Confirm company</button></form>` : html`<p class="muted">No matching companies were found in Wikidata.</p>`}
<details ${opts.length ? '' : 'open'}><summary>Not listed? Enter it yourself</summary><form method="post" action="/accounts/${a.id}/confirm" class="row">
<input type="hidden" name="choice" value="manual"><input name="name" placeholder="Company name" required maxlength="100" value="${a.query_name}">
<input name="domain" placeholder="domain.com" required maxlength="100" pattern="[A-Za-z0-9.-]+\\.[A-Za-z]{2,}"><button>Use this company</button></form></details></section>`);
  }

  if (a.status !== 'confirming') {
    const running = a.research_state === 'running';
    sections.push(html`<section class="card"><h2>2. Research</h2>
${research.available ? html`<p class="small muted">Provider: ${research.label}</p>` : html`<p class="warn-box">Automated research is unavailable: no research provider is configured on the server. Add findings manually below; they go through the same review and approval.</p>`}
${running ? html`<p class="flash">Researching public sources… this page refreshes automatically.</p>` : ''}
${a.research_message ? html`<p>${a.research_message}</p>` : ''}
${research.available && !running && ['researching', 'awaiting_approval'].includes(a.status) ? html`<form method="post" action="/accounts/${a.id}/research"><button>${candidates.some((c) => c.origin === 'fetched') ? 'Re-run research' : 'Run research'}</button></form>` : ''}
${['researching', 'awaiting_approval'].includes(a.status) ? manualFindingsForm(a) : ''}</section>`);
  }

  if (candidates.length && ['awaiting_approval', 'researching'].includes(a.status)) {
    sections.push(html`<section class="card"><h2>3. Choose a project</h2><p class="muted small">Nothing is built, sent or spent until you approve a proposal.</p>
${candidates.map((c) => candidateCard(a, c, { selectable: true }))}
<p><a class="button" href="/accounts/${a.id}/propose?candidate=own">Use my own idea instead</a></p></section>`);
  } else if (['awaiting_approval', 'researching'].includes(a.status) && a.status === 'awaiting_approval') {
    sections.push(html`<section class="card"><p><a class="button" href="/accounts/${a.id}/propose?candidate=own">Use my own idea</a></p></section>`);
  }

  if (a.brief) {
    sections.push(html`<section class="card"><h2>4. Approved proposal &amp; build brief</h2>
${cand ? html`<p class="small">Based on: ${cand.title} (${cand.source_date || 'date unknown'})</p>` : html`<p class="small">Based on your own idea.</p>`}
<pre id="brief" class="brief">${a.brief}</pre>
<div class="row"><button type="button" class="copy" data-copy="brief">Copy brief</button>
${['brief_ready'].includes(a.status) ? html`<a class="button" href="/accounts/${a.id}/propose?edit=1">Edit proposal</a><a class="button" href="/accounts/${a.id}/propose?candidate=own">Replace with my own idea</a>
<form method="post" action="/accounts/${a.id}/reopen" class="inline"><button class="link">Choose a different candidate</button></form>` : ''}</div></section>`);
  }

  if (a.status === 'brief_ready') {
    sections.push(devinOn
      ? html`<section class="card"><h2>5. Build with Devin</h2><form method="post" action="/accounts/${a.id}/build/prepare" class="row">
<label>Max ACUs for this build <input type="number" name="acu" min="1" max="${a._maxAcu}" value="${a.acu_limit || a._defaultAcu}" required></label>
<button class="primary">Build with Devin…</button></form><p class="muted small">You will be asked to confirm the ACU cap before anything starts.</p>
${manualLinksForm(a, true)}</section>`
      : html`<section class="card"><h2>5. Build (manual)</h2><p>The Devin API is not connected. Copy the brief above, paste it into a new Devin session, then paste the demo and repo links here.</p>
${manualLinksForm(a, false)}</section>`);
  }

  if (a.devin_session_id) {
    sections.push(html`<section class="card"><h2>Devin session</h2><dl class="kv">
<dt>Session</dt><dd>${ext(a.devin_session_url, a.devin_session_id)}</dd>
<dt>Status</dt><dd>${a.devin_status || 'unknown'}${a.devin_status_detail ? ` (${a.devin_status_detail})` : ''}</dd>
<dt>ACU cap</dt><dd>${a.acu_limit}</dd><dt>ACUs consumed</dt><dd>${a.acus_consumed != null ? Number(a.acus_consumed).toFixed(2) : '-'}</dd>
<dt>Pull request</dt><dd>${ext(a.pr_url)}</dd><dt>Last checked</dt><dd>${a.last_polled_at || '-'}</dd></dl>
${a.status === 'building' ? html`<form method="post" action="/accounts/${a.id}/poll"><button>Check now</button></form>${manualLinksForm(a, true)}` : ''}</section>`);
  }

  if (a.status === 'demo_live') {
    sections.push(html`<section class="card live"><h2>Demo live</h2><p>Demo: ${ext(a.demo_url)}</p><p>Repo: ${ext(a.repo_url)}</p>
<p class="muted small">Demos are untrusted output and open in a new tab without referrer; they never receive this app's cookies or keys.</p></section>`);
  }

  sections.push(html`<section class="card"><h2>Notes</h2><form method="post" action="/accounts/${a.id}/notes"><textarea name="notes" rows="3" maxlength="5000">${a.notes || ''}</textarea><button>Save notes</button></form></section>
<section class="card"><details><summary>Activity</summary><ul class="events">${events.map((e) => html`<li><span class="muted small">${e.at.replace('T', ' ').slice(0, 19)}</span> ${e.message}</li>`)}</ul></details>
<form method="post" action="/accounts/${a.id}/delete" class="danger-zone"><label class="small"><input type="checkbox" name="confirm" value="yes" required> Delete this account</label><button class="link danger">Delete</button></form></section>`);

  return html`${sections}`;
}

function manualLinksForm(a, collapsed) {
  const form = html`<form method="post" action="/accounts/${a.id}/links" class="grid2"><label>Demo URL<input name="demo_url" type="url" required placeholder="https://…" value="${a.demo_url || ''}"></label>
<label>Repo URL<input name="repo_url" type="url" required placeholder="https://github.com/…" value="${a.repo_url || ''}"></label>
<label>ACUs used (optional)<input name="acus" type="number" step="0.1" min="0" value="${a.acus_consumed != null ? a.acus_consumed : ''}"></label><div><button>Save links &amp; mark Demo live</button></div></form>`;
  return collapsed ? html`<details><summary>Paste links manually instead</summary>${form}</details>` : form;
}

function proposePage({ a, cand, proposal, errors }) {
  return html`<section class="card"><p><a href="/accounts/${a.id}">← ${a.name}</a></p><h1>${cand ? 'Review and edit the proposal' : 'Your own idea'}</h1>
${cand ? candidateCard(a, cand, { selectable: false }) : ''}
${errors && errors.length ? html`<ul class="error">${errors.map((e) => html`<li>${e}</li>`)}</ul>` : ''}
<form method="post" action="/accounts/${a.id}/approve"><input type="hidden" name="candidate_id" value="${cand ? cand.id : ''}">
<label>Proposal title<input name="title" required maxlength="120" value="${proposal.title}"></label>
<label>Demo concept (one paragraph)<textarea name="concept" rows="6" required maxlength="1500">${proposal.concept}</textarea></label>
<label>Core interactions (one per line, at most ${MAX_INTERACTIONS})<textarea name="interactions" rows="5" required>${(proposal.interactions || []).join('\n')}</textarea></label>
<p class="muted small">The brief always adds fixed guardrails: synthetic seeded data only, the visible label "${DEMO_LABEL}", no real customer data or credentials, no access to the prospect's private systems, a public repo plus a deployed URL, and none of your credentials or internal information.</p>
<button class="primary">Approve and generate brief</button></form></section>`;
}

function buildConfirmPage({ a, acu, token }) {
  return html`<section class="card narrow"><h1>Confirm build</h1>
<p class="big">This starts a Devin session for <strong>${a.name}</strong> that can spend up to <strong>${acu} ACUs</strong> (paid compute credits).</p>
<p>Project: ${a.proposal && a.proposal.title}</p>
<form method="post" action="/accounts/${a.id}/build/confirm"><input type="hidden" name="token" value="${token}"><input type="hidden" name="acu" value="${acu}">
<label class="choice"><input type="checkbox" name="ack" value="yes" required> <span>I understand this can spend up to ${acu} ACUs.</span></label>
<div class="row"><button class="primary">Spend up to ${acu} ACUs and build</button><a class="button" href="/accounts/${a.id}">Cancel</a></div></form></section>`;
}

function settingsPage({ devin, research, llm, dbDialect, contact }) {
  const yes = (b) => (b ? html`<span class="badge ok">connected</span>` : html`<span class="badge off">not connected</span>`);
  return html`<section class="card"><h1>Settings</h1><p class="muted small">Keys are read from server-side environment variables and are never displayed.</p>
<h2>Devin API</h2><p>${yes(devin.connected)} ${devin.principal ? html`<span class="muted small">as ${devin.principal}</span>` : ''}</p>${devin.reason ? html`<p class="muted">${devin.reason}</p>` : ''}
<form method="post" action="/settings/test"><button>Test connection</button></form>
<p class="small muted">Set DEVIN_API_KEY and DEVIN_ORG_ID on the server to enable automatic builds.</p>
<h2>Research provider</h2><p>${research.available ? html`<span class="badge ok">available</span> ${research.label}` : html`<span class="badge off">unavailable</span> Set TAVILY_API_KEY, or RESEARCH_PROVIDER=public, to enable automated research.`}</p>
<h2>Model (optional)</h2><p>${llm ? html`<span class="badge ok">configured</span> used to summarize fetched sources; every excerpt is verified against the page` : html`<span class="badge off">not configured</span> candidates are extracted heuristically`}</p>
<h2>Storage</h2><p>${dbDialect === 'pg' ? 'Postgres (DATABASE_URL)' : 'SQLite (local file)'}</p>
<h2>Contact for research user agent</h2><p>${contact ? 'set' : 'not set (CONTACT_EMAIL); SEC EDGAR may refuse requests without it'}</p></section>`;
}

function errorPage(msg) { return html`<section class="card"><h1>Something went wrong</h1><p>${msg}</p><p><a href="/">Back to dashboard</a></p></section>`; }

module.exports = { layout, loginPage, dashboard, accountPage, proposePage, buildConfirmPage, settingsPage, errorPage, STATUS };
