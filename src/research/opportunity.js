'use strict';
// Where Devin / Cognition can help: categories of engineering work a source can point to.
const CATEGORIES = [
  {
    key: 'migration', label: 'Migration & modernization', weight: 1.3,
    re: /\b(migrat\w*|moderniz\w*|legacy|mainframes?|cobol|monoliths?|monolithic|microservices?|re-?platform\w*|re-?architect\w*|rewrit\w*|upgrad\w*|end[- ]of[- ]life|deprecat\w*|cloud[- ]native|kubernetes|tech(?:nical)? debt|port(?:ing|ed)? (?:to|from))\b/gi,
    pitch: 'Devin runs large migrations in parallel: it upgrades frameworks and languages, breaks up monoliths and moves workloads, one reviewed pull request at a time.',
  },
  {
    key: 'security', label: 'Security & vulnerabilities', weight: 1.3,
    re: /\b(vulnerabilit\w*|cve-\d{4}-\d+|security (?:advisory|advisories|patch\w*|incidents?|flaws?|issues?|fix\w*|updates?)|breach\w*|exploit\w*|zero[- ]days?|remediat\w*|appsec|application security|penetration test\w*|soc ?2|compliance|secure coding|dependency (?:updates?|upgrades?)|supply[- ]chain (?:attack|security)\w*)\b/gi,
    pitch: 'Devin triages scanner findings and CVEs, writes and tests the fixes, and opens remediation pull requests across many repositories to burn down the vulnerability backlog.',
  },
  {
    key: 'ai', label: 'AI initiatives', weight: 1.0,
    re: /\b(ai|artificial intelligence|machine learning|ml|llms?|genai|generative|agents?|agentic|copilots?|large language models?|rag)\b/gi,
    pitch: 'Devin prototypes and ships AI features end to end, from data plumbing and evaluations to integration, tests and deployment.',
  },
  {
    key: 'quality', label: 'Testing & reliability', weight: 1.0,
    re: /\b(test coverage|unit tests?|integration tests?|end-to-end tests?|flaky|ci\/cd|continuous integration|reliability|observability|refactor\w*|code quality|bugs?|on-?call|outages?)\b/gi,
    pitch: 'Devin raises test coverage, fixes flaky tests and bugs, and hardens CI pipelines so teams can ship with confidence.',
  },
  {
    key: 'staffing', label: 'Engineering capacity', weight: 0.8,
    re: /\b(hiring|join our team|open roles?|headcount|backlogs?|software engineers?|engineering teams?|scal(?:e|ing) (?:our|the) (?:engineering|team)|contractors?|outsourc\w*|developer productivity|velocity)\b/gi,
    pitch: 'Devin adds engineering capacity without hiring lead time: teams hand it well-scoped backlog tickets and review its pull requests.',
  },
  {
    key: 'data', label: 'Data & platform engineering', weight: 0.7,
    re: /\b(data (?:pipelines?|platforms?|warehouses?|lakes?|infrastructure|engineering)|etl|elt|snowflake|databricks|dbt|airflow|spark|internal tools?|platform engineering|developer platforms?|apis?|sdks?|integrations?)\b/gi,
    pitch: 'Devin builds and maintains pipelines, integrations, SDKs and internal tools against the stack a team already runs.',
  },
];
const BY_KEY = Object.fromEntries(CATEGORIES.map((c) => [c.key, c]));
const TYPE_DEFAULT = { job: 'staffing', security: 'security' };

const hits = (re, text) => (String(text || '').match(re) || []).length;

// Returns the matching categories, strongest first.
function classify(text, sourceType) {
  const out = CATEGORIES.map((c) => ({ key: c.key, label: c.label, pitch: c.pitch, hits: hits(c.re, text), weight: c.weight }))
    .filter((c) => c.hits > 0);
  const forced = TYPE_DEFAULT[sourceType];
  if (forced && !out.some((c) => c.key === forced)) out.push({ ...BY_KEY[forced], hits: 1 });
  return out.sort((a, b) => b.weight * Math.min(b.hits, 3) - a.weight * Math.min(a.hits, 3))
    .map(({ key, label, pitch, hits: h, weight }) => ({ key, label, pitch, hits: h, weight }));
}

const strength = (cats) => cats.reduce((s, c) => s + c.weight * Math.min(c.hits, 3), 0);
const forCandidate = (c) => classify([c.title, c.summary, c.excerpt].join(' '), c.source_type);
// Opportunity signal in one sentence, used to pick excerpts.
const sentenceSignal = (s) => strength(classify(s));

module.exports = { CATEGORIES, BY_KEY, classify, strength, forCandidate, sentenceSignal };
