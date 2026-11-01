'use strict';
// "Wow" signals: a concrete, large project tied to the company's business (a named from→to
// migration, signs of scale or multi-quarter effort) or a published security event.
const TECH = String.raw`[A-Z][\w.+#-]*(?:\s(?:Native|[A-Z][\w.+#-]*))?`;
const PAIR_RES = [
  new RegExp(String.raw`\b(?:replac\w*|rewrit\w*|migrat\w*|port\w*|mov\w*|convert\w*|transition\w*|switch\w*)\s+(?:(?:our|the|its|their|existing|legacy|current|entire|whole)\s+)*(${TECH})\s+(?:(?:apps?|codebase|stack|services?|platform|monolith|systems?|clients?|backend|frontend)\s+)?(?:with|to|into|onto|for)\s+(?:(?:a|new|modern|fully)\s+)*(?:native\s+)?(${TECH}(?:(?:,\s|\s(?:and|&)\s)${TECH})?)`),
  new RegExp(String.raw`\bfrom\s+(${TECH})\s+to\s+(?:native\s+)?(${TECH}(?:(?:,\s|\s(?:and|&)\s)${TECH})?)`),
];
const STOP = /^(?:The|Our|This|A|An|We|It|Its|They|Their|All|Every|Each|New|More|Data|Customers?|Users?|People|Teams?)$/;
const SCALE = /\b(millions? of|billions? of|hundreds of|thousands of|every (?:core )?(?:surface|service|team|repo\w*|product|screen|customer)|multi-?year|multi-?quarter|company-?wide|org(?:anization)?-?wide|across (?:all|the entire|our entire|every)|\d[\d,.]*\+?\s?(?:k|m|million|billion)?\s?(?:lines of code|services|repositories|repos|microservices|engineers|customers|users|endpoints|applications))\b/gi;
const EFFORT = /\b(we(?:'re| are) (?:replacing|rebuilding|migrating|moving|rewriting|modernizing)|this team is|lead(?:ing)? the|own(?:ing)? the|overhaul\w*|rebuild\w*|re-?architect\w*|ground[- ]up|from scratch|recurring migration|large-?scale|at scale)\b/gi;
const SEC_EVENT = /\b(post-?mortem|incident (?:report|review|response)|root cause|breach\w*|disclos\w*|threat (?:report|research|intelligence)|security research\w*|actively exploited|exploited in the wild|known exploited|ransomware|data exposure|leak(?:ed|s)?|compromis\w*|attackers?|unauthorized access)\b/gi;

const count = (re, t) => (String(t || '').match(re) || []).length;

function migrationPair(text) {
  for (const re of PAIR_RES) {
    for (const m of String(text || '').matchAll(new RegExp(re.source, 'g'))) {
      const from = m[1].trim();
      const to = m[2].trim();
      if (!STOP.test(from.split(' ')[0]) && !STOP.test(to.split(' ')[0]) && from.toLowerCase() !== to.toLowerCase()) return { from, to };
    }
  }
  return null;
}

function projectSignal(text, { securityEvents = true } = {}) {
  const migration = migrationPair(text);
  const scale = count(SCALE, text);
  const effort = count(EFFORT, text);
  const secEvent = securityEvents ? count(SEC_EVENT, text) : 0;
  const reasons = [];
  if (migration) reasons.push(`a named migration (${migration.from} to ${migration.to})`);
  if (scale) reasons.push('large scale');
  if (effort) reasons.push('a multi-quarter engineering effort');
  if (secEvent) reasons.push('a published security event');
  const score = (migration ? 1.5 : 0) + 0.5 * Math.min(scale, 3) + 0.3 * Math.min(effort, 3) + 0.6 * Math.min(secEvent, 3);
  return { score, reasons, migration };
}

module.exports = { projectSignal, migrationPair };
