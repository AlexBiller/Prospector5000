'use strict';
// Prospect-facing PDF in Cognition's visual style. Contains only public evidence, the approved demo and its cost;
// never the owner's notes, the internal build brief, or flagged/unverified evidence.
const PDFDocument = require('pdfkit');
const config = require('./config');
const O = require('./research/opportunity');
const X = require('./research/extract');

const C = { bg: '#f7f6f5', ink: '#191919', muted: '#626870', accent: '#2200ff', gold: '#b9a07a', rule: '#dcdad6' };
const CP1252 = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
const pdfText = (s) => String(s == null ? '' : s).replace(/[\u2010-\u2012]/g, '-').replace(/[\u00a0\u2009\u202f]/g, ' ')
  .replace(/./gu, (ch) => (ch.charCodeAt(0) < 256 || CP1252.includes(ch) ? ch : ''));
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const money = (n) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function usable(c) {
  const f = c.flags || {};
  if (!c.source_url || f.embedded_instructions || f.fetch_failed) return false;
  if (c.origin === 'fetched' && f.excerpt_verified === false) return false;
  return !X.looksLikeInstructions(`${c.title} ${c.summary}`);
}

function buildReportModel(a, candidates, { rate = config.report.acuPriceUsd, contact = config.report.contact, now = new Date() } = {}) {
  const approved = candidates.find((c) => c.id === a.approved_candidate_id);
  const pool = candidates.filter(usable).map((c) => ({ c, cats: O.forCandidate(c) }))
    .sort((x, y) => (x.c.id === a.approved_candidate_id ? -1 : 0) - (y.c.id === a.approved_candidate_id ? -1 : 0)
      || (x.c.flags && x.c.flags.stale ? 1 : 0) - (y.c.flags && y.c.flags.stale ? 1 : 0)
      || O.strength(y.cats) - O.strength(x.cats) || (y.c.score || 0) - (x.c.score || 0));
  const opportunities = pool.slice(0, 5).map(({ c, cats }) => ({
    category: cats[0] ? cats[0].label : 'Engineering priority',
    title: c.title, summary: c.summary, url: c.source_url, source: hostOf(c.source_url), date: c.source_date || null,
    stale: !!(c.flags && c.flags.stale), pitch: cats[0] ? cats[0].pitch : 'Devin can take on well-scoped engineering work here and deliver reviewed pull requests.',
  }));
  const areas = [];
  pool.forEach(({ cats }) => cats.slice(0, 2).forEach((k) => { if (!areas.some((x) => x.key === k.key)) areas.push(k); }));
  const acus = a.acus_consumed != null && Number.isFinite(Number(a.acus_consumed)) ? Number(a.acus_consumed) : null;
  const name = a.name || a.query_name;
  const areaNames = areas.slice(0, 3).map((x) => x.label.toLowerCase());
  const summary = opportunities.length
    ? `We reviewed public, dated sources about ${name} and found ${opportunities.length} active engineering ${opportunities.length === 1 ? 'priority' : 'priorities'} where Devin could make an immediate impact${areaNames.length ? `, especially in ${areaNames.length > 1 ? `${areaNames.slice(0, -1).join(', ')} and ${areaNames.slice(-1)}` : areaNames[0]}` : ''}. To make it concrete, Devin built a working alpha demo.`
    : `We prepared a working alpha demo to show how Devin could support ${name}'s engineering team.`;
  return {
    company: name, domain: a.domain || null, date: now.toISOString().slice(0, 10),
    headline: `How Devin can accelerate ${name}'s engineering priorities`,
    summary, opportunities, areas: areas.slice(0, 4),
    demo: a.proposal && a.proposal.title ? {
      title: a.proposal.title, concept: a.proposal.concept, interactions: a.proposal.interactions || [],
      demo_url: a.demo_url || null, repo_url: a.repo_url || null, basedOn: approved ? approved.title : null,
    } : null,
    cost: acus != null ? { acus, rate, usd: Math.round(acus * rate * 100) / 100 } : null,
    contact: contact || null,
  };
}

function renderPdf(model) {
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 64, bottom: 72, left: 60, right: 60 }, bufferPages: true,
    info: { Title: pdfText(model.headline), Author: 'Cognition', Subject: `Prepared for ${pdfText(model.company)}` } });
  const chunks = [];
  doc.on('data', (b) => chunks.push(b));
  const done = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));
  const W = doc.page.width - 120;
  const paint = () => { doc.save().rect(0, 0, doc.page.width, doc.page.height).fill(C.bg).restore(); doc.x = 60; doc.y = 64; };
  paint();
  doc.on('pageAdded', paint);
  const ensure = (h) => { if (doc.y + h > doc.page.height - 90) doc.addPage(); };
  const label = (t, color = C.gold) => { ensure(40); doc.moveDown(0.8).font('Helvetica-Bold').fontSize(8.5).fillColor(color).text(pdfText(t).toUpperCase(), { characterSpacing: 1.6 }).moveDown(0.35); };
  const body = (t, o = {}) => doc.font(o.font || 'Times-Roman').fontSize(o.size || 11).fillColor(o.color || C.ink).text(pdfText(t), { lineGap: 2.5, ...o.opts });
  const link = (t, url) => doc.font('Helvetica').fontSize(9.5).fillColor(C.accent).text(pdfText(t), { link: url, underline: true });

  doc.font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text('COGNITION', 60, 52, { characterSpacing: 3.5 });
  doc.font('Helvetica').fontSize(9).fillColor(C.muted).text(pdfText(`Prepared for ${model.company} · ${model.date}`), 60, 54, { width: W, align: 'right' });
  doc.moveTo(60, 74).lineTo(60 + W, 74).lineWidth(0.6).strokeColor(C.rule).stroke();
  doc.x = 60; doc.y = 100;
  doc.font('Helvetica').fontSize(25).fillColor(C.ink).text(pdfText(model.headline), { width: W * 0.9, lineGap: 2 });
  doc.moveDown(0.6);
  body(model.summary, { size: 12.5 });

  if (model.areas.length) {
    label('Where Devin can help');
    model.areas.forEach((x) => {
      ensure(48);
      doc.font('Helvetica-Bold').fontSize(10.5).fillColor(C.ink).text(pdfText(x.label));
      body(x.pitch, { size: 10.5, color: C.muted });
      doc.moveDown(0.35);
    });
  }

  if (model.opportunities.length) {
    label('What we found');
    model.opportunities.forEach((o, i) => {
      ensure(110);
      if (i) { doc.moveTo(60, doc.y).lineTo(60 + W, doc.y).lineWidth(0.4).strokeColor(C.rule).stroke(); doc.moveDown(0.6); }
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(C.accent).text(pdfText(o.category).toUpperCase(), { characterSpacing: 1.2 });
      doc.moveDown(0.2).font('Helvetica-Bold').fontSize(12).fillColor(C.ink).text(pdfText(o.title), { lineGap: 1 });
      doc.moveDown(0.15);
      body(o.summary, { size: 10.5 });
      doc.moveDown(0.15);
      body(`How Devin helps: ${o.pitch}`, { size: 10.5, font: 'Times-Italic', color: C.ink });
      doc.moveDown(0.15);
      link(`${o.source}${o.date ? ` · ${o.date}` : ''}${o.stale ? ' · older than 12 months (lead, not confirmation)' : ''}`, o.url);
      doc.moveDown(0.6);
    });
  }

  if (model.demo) {
    label('The alpha demo Devin built');
    doc.font('Helvetica-Bold').fontSize(13).fillColor(C.ink).text(pdfText(model.demo.title));
    doc.moveDown(0.25);
    body(model.demo.concept, { size: 10.5 });
    doc.moveDown(0.3);
    model.demo.interactions.forEach((t) => { ensure(20); body(`•  ${t}`, { size: 10.5, opts: { indent: 8 } }); });
    doc.moveDown(0.4);
    if (model.demo.demo_url) { doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text('Live demo  ', { continued: true }); link(model.demo.demo_url, model.demo.demo_url); }
    if (model.demo.repo_url) { doc.font('Helvetica-Bold').fontSize(9.5).fillColor(C.ink).text('Source code  ', { continued: true }); link(model.demo.repo_url, model.demo.repo_url); }
    if (!model.demo.demo_url) body('The demo is being built; links will follow.', { size: 10, color: C.muted });
    doc.moveDown(0.2);
    body('Unofficial demo built with Devin using synthetic data only. It does not use or access any of your systems or data.', { size: 9, color: C.muted });
  }

  label('What this alpha cost');
  ensure(70);
  if (model.cost) {
    doc.font('Helvetica').fontSize(30).fillColor(C.ink).text(money(model.cost.usd));
    body(`${model.cost.acus.toLocaleString('en-US', { maximumFractionDigits: 2 })} ACUs at ${money(model.cost.rate)} per ACU. ACUs (Agent Compute Units) measure the work Devin does; this demo was built autonomously, end to end.`, { size: 10.5, color: C.muted });
  } else {
    body('Not recorded yet. The cost appears here once the build reports the ACUs it used.', { size: 10.5, color: C.muted });
  }

  label('About Devin');
  body("Devin is Cognition's autonomous AI software engineer. It works in your existing repositories and tools: it plans the task, writes and tests the code, and opens pull requests for your engineers to review. Teams run many Devin sessions in parallel to land migrations, remediate vulnerabilities, clear backlogs and raise test coverage.", { size: 10.5 });
  label('Next step');
  body(`Let's pick one of the priorities above and scope a pilot with your team.${model.contact ? ` Contact: ${model.contact}` : ''}`, { size: 10.5 });

  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Helvetica').fontSize(7.5).fillColor(C.muted)
      .text('Sources are public and dated; items older than 12 months are leads, not confirmation of current plans. Prepared by Cognition.', 60, doc.page.height - 48, { width: W - 40, lineBreak: false })
      .text(`${i + 1} / ${range.count}`, 60, doc.page.height - 48, { width: W, align: 'right', lineBreak: false });
    doc.page.margins.bottom = bottom;
  }
  doc.end();
  return done;
}

module.exports = { buildReportModel, renderPdf, pdfText };
