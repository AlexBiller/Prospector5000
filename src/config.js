'use strict';
const path = require('path');

const env = process.env;
const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

module.exports = {
  port: int(env.PORT, 3000),
  production: env.NODE_ENV === 'production',
  forceHttps: env.FORCE_HTTPS ? env.FORCE_HTTPS === '1' : env.NODE_ENV === 'production',
  ownerPassword: env.OWNER_PASSWORD || '',
  databaseUrl: env.DATABASE_URL || '',
  sqlitePath: env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'app.db'),
  sessionDays: int(env.SESSION_DAYS, 7),
  contactEmail: env.CONTACT_EMAIL || '',
  allowPrivateFetch: env.ALLOW_PRIVATE_FETCH === '1',
  devin: {
    apiKey: env.DEVIN_API_KEY || '',
    orgId: env.DEVIN_ORG_ID || '',
    base: (env.DEVIN_API_BASE || 'https://api.devin.ai').replace(/\/$/, ''),
    defaultAcu: int(env.DEFAULT_ACU_LIMIT, 10),
    maxAcu: int(env.MAX_ACU_LIMIT, 50),
    pollSeconds: int(env.DEVIN_POLL_SECONDS, 30),
  },
  research: {
    provider: (env.RESEARCH_PROVIDER || '').toLowerCase(),
    tavilyKey: env.TAVILY_API_KEY || '',
    tavilyBase: (env.TAVILY_API_BASE || 'https://api.tavily.com').replace(/\/$/, ''),
    maxSources: int(env.RESEARCH_MAX_SOURCES, 18),
  },
  llm: {
    apiKey: env.OPENAI_API_KEY || '',
    base: (env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, ''),
    model: env.OPENAI_MODEL || 'gpt-4o-mini',
  },
  // Hard caps on how much scraped text can enter any prompt.
  promptCaps: { perSource: 3000, total: 20000 },
};
