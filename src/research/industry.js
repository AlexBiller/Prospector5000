'use strict';
// Cognition customer stories (devin.ai/customers), tagged by industry and opportunity category,
// used as proof points when a prospect's own public evidence is thin.
const BASE = 'https://devin.ai/customers/';
const STORIES = [
  ['rohlikgroup', 'Rohlik Group', ['retail'], ['ai', 'data', 'staffing'], 'How Rohlik doubled its engineering output as an agent-driven grocery company'],
  ['gumroad', 'Gumroad', ['retail'], ['staffing', 'quality'], "How Devin Became Gumroad's #1 Contributor with 1,500+ Merged PRs"],
  ['nubank', 'Nubank', ['finance'], ['migration', 'quality'], 'How Nubank refactors millions of lines of code to improve engineering efficiency with Devin'],
  ['angellist', 'AngelList', ['finance'], ['migration', 'data'], 'How AngelList Completed a Redshift-to-Snowflake Migration 5.2x Faster with Devin'],
  ['itau', 'Itaú', ['finance'], ['staffing', 'security'], 'How Itaú Deployed AI Across the SDLC at Global-Finance Scale'],
  ['ramp', 'Ramp', ['finance'], ['quality', 'staffing'], 'Devin fixes tens of thousands of hours of technical debt at Ramp'],
  ['fefundinfo', 'FE fundinfo', ['finance'], ['staffing', 'migration'], 'How FE fundinfo Scaled Eng Capacity with AI-Driven Automation Across 1,800 Repos'],
  ['ripple', 'Ripple Treasury', ['finance'], ['quality'], 'How Ripple Treasury automated bug triage and tripled resolution speed with Devin'],
  ['ebanx', 'EBANX', ['finance'], ['staffing'], 'How EBANX writes 92% of its merged PRs with Devin'],
  ['hippo', 'Hippo', ['finance'], ['staffing'], 'Building the Future of Insurance with Hippo'],
  ['geaerospace', 'GE Aerospace', ['industrial'], ['migration', 'staffing'], 'How GE Aerospace uses Devin to invent the future of flight'],
  ['rvtech', 'RV Tech (Rivian and VW)', ['industrial'], ['quality'], "How Rivian and VW's joint venture 10x'ed testing velocity for software-defined vehicles"],
  ['evinova', 'Evinova', ['healthcare'], ['quality'], 'How Evinova wrote documentation 8x faster for regulated healthcare software'],
  ['compiledhealth', 'Compiled Health', ['healthcare'], ['ai'], 'How Compiled Health uses Devin to make the standard of care executable'],
  ['latent', 'Latent Health', ['healthcare'], ['ai', 'staffing'], 'How Latent Health gets medications to patients faster with Devin'],
  ['comarch', 'Comarch', ['software'], ['migration'], 'How Comarch is rebuilding a 20-year-old, 10-million-line ERP system with Devin'],
  ['access-group', 'The Access Group', ['software'], ['staffing'], "How The Access Group 5x'd engineering output across 250 products and 2,000+ engineers"],
  ['modal', 'Modal', ['software'], ['quality'], 'How Modal uses Devin to investigate 80% of its incidents before an engineer opens the thread'],
  ['airbyte', 'Airbyte', ['software'], ['data'], 'How Airbyte uses Devin to keep 700+ connectors running'],
  ['litera', 'Litera', ['legal'], ['quality'], 'With Devin, Litera cut regression cycles by 90%, delivering new products to customers faster than ever'],
  ['finch', 'Finch Legal', ['legal'], ['staffing'], 'How Finch Legal Merged 3,000 PRs with Devin, Saving 20 Months of Engineering Time'],
  ['linktree', 'Linktree', ['media'], ['data'], 'Linktree expands social media platform coverage and ships new features with Devin'],
  ['wpp-enterprise-solutions', 'WPP Enterprise Solutions', ['media', 'services'], ['staffing'], 'How WPP won a competitive three-year renewal by proving 30-40% efficiency gains with Devin'],
  ['endava', 'Endava', ['services'], ['staffing'], 'How Endava Is Scaling AI-Native Delivery with Devin'],
].map(([slug, company, industries, categories, headline]) => ({ slug, company, industries, categories, headline, url: BASE + slug }));

const INDUSTRIES = [
  ['retail', 'retail', /\b(retail\w*|apparel|clothing|fashion|grocer\w*|supermarkets?|department stores?|e-?commerce|footwear|home improvement|furniture|restaurants?|consumer goods)\b/i, (s) => s >= 5200 && s < 6000],
  ['finance', 'financial services', /\b(banks?|banking|financial|fintech|payments?|insurance|insurer|brokerage|asset management|lending|cryptocurrenc\w*|crypto)\b/i, (s) => s >= 6000 && s < 6800],
  ['healthcare', 'healthcare', /\b(health\w*|pharma\w*|medical|hospitals?|biotech\w*|life sciences)\b/i, (s) => (s >= 8000 && s < 8100) || (s >= 2830 && s < 2840) || (s >= 3840 && s < 3860)],
  ['industrial', 'industrial and automotive', /\b(aerospace|automotive|automakers?|vehicles?|manufactur\w*|industrial|airlines?|logistics|shipping)\b/i, (s) => s >= 2000 && s < 4000],
  ['legal', 'legal', /\b(law firms?|legal)\b/i, () => false],
  ['media', 'media and advertising', /\b(media|advertising|entertainment|social network\w*|publish\w*|streaming)\b/i, (s) => (s >= 2700 && s < 2800) || (s >= 4800 && s < 4900) || (s >= 7810 && s < 7820)],
  ['software', 'software', /\b(software|technology|internet|cloud|saas|computing)\b/i, (s) => s >= 7370 && s < 7380],
];

function industryOf(text, sic) {
  const n = parseInt(sic, 10);
  const hit = INDUSTRIES.find(([, , re]) => re.test(String(text || ''))) || (n ? INDUSTRIES.find(([, , , f]) => f(n)) : null);
  return hit ? { key: hit[0], label: hit[1] } : null;
}

function storiesFor(industry, category) {
  const key = industry && (industry.key || industry);
  const inInd = STORIES.filter((s) => key && s.industries.includes(key));
  const byCat = (list) => list.filter((s) => category && s.categories.includes(category));
  return [...new Set([...byCat(inInd), ...inInd, ...(inInd.length ? [] : byCat(STORIES))])];
}

const storyByUrl = (url) => STORIES.find((s) => s.url === String(url || '').replace(/\/$/, '')) || null;

module.exports = { STORIES, industryOf, storiesFor, storyByUrl };
