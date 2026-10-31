# Prospector5000

A private web app that turns account research into a tailored, Devin-built product demo you can send to a prospect.

**Flow:** company name → confirm the right company (2-5 matches) → research public evidence → review evidence-backed project candidates → approve or edit a proposal (or use your own idea) → a constrained build brief → **Build with Devin** (with an explicit ACU-cap confirmation) or **Copy brief** → track status, ACUs, demo URL, repo URL and PR.

Nothing is built, sent or spent until you approve it.

## Running locally

```bash
npm ci
OWNER_PASSWORD=dev FORCE_HTTPS=0 npm start   # http://localhost:3000
npm test
```

Requires Node 22.13+ (uses the built-in `node:sqlite` when `DATABASE_URL` is not set). The session cookie is `Secure`; browsers accept it on `http://localhost`.

## Configuration

All configuration is server-side environment variables. See [`.env.example`](.env.example).

| Variable | Purpose |
| --- | --- |
| `OWNER_PASSWORD` | Required. The single sign-in password. |
| `DATABASE_URL` | Postgres connection string. Without it, a SQLite file in `./data` is used (fine locally, not on ephemeral hosts). |
| `DEVIN_API_KEY`, `DEVIN_ORG_ID` | Enable **Build with Devin** through `POST /v3/organizations/{org_id}/sessions`. Without them the app shows **Copy brief** and you paste links back in by hand. |
| `DEFAULT_ACU_LIMIT`, `MAX_ACU_LIMIT` | Default and maximum per-build `max_acu_limit`. |
| `TAVILY_API_KEY` | Research through Tavily search. |
| `RESEARCH_PROVIDER=public` | Keyless research: GDELT news, the company's own feeds/sitemap, Hacker News launch posts, public Greenhouse/Lever/Ashby job boards, SEC EDGAR filings. |
| `CONTACT_EMAIL` | Included in the research User-Agent (SEC EDGAR asks for one). |
| `OPENAI_API_KEY` | Optional model to summarize fetched sources. Every excerpt it returns is checked verbatim against the fetched page. |

With no research provider configured, the app says research is unavailable and you can paste findings (URLs plus notes) manually. They go through the same candidate and approval UI.

## How evidence is handled

- Every candidate traces to a fetched page or to your manual entry, with source URL, source date, why it is relevant, and the exact excerpt it relies on. Excerpts are verified against the page text.
- Sources older than 12 months are flagged as leads, not proof of current direction. Undated sources are flagged too.
- When evidence is thin, the app says so instead of filling gaps.
- Fetched pages are untrusted data. Instruction-like text ("ignore previous instructions…") is never used as evidence, is flagged on the candidate, and never reaches the brief. If a model is configured, sources are passed in clearly delimited, size-capped blocks and anything it returns that is not verbatim from a source is discarded.
- Fetching only reaches public hosts (private, loopback and link-local addresses are refused, including after redirects), with timeouts and size limits.

## Security

- Every page, static asset and API route requires sign-in. Login attempts are rate limited.
- Sessions are random tokens stored hashed; the cookie is `HttpOnly; Secure; SameSite=Strict`. State-changing requests must also be same-origin.
- `DEVIN_API_KEY` and other keys are only read server-side. They never appear in pages, API responses, logs or the repo (the test suite checks this).
- Starting a build requires an approved brief that contains all guardrails, plus a second confirmation of the ACU cap using a single-use token bound to the brief and the cap.
- Devin's structured output is treated as untrusted: only `http(s)` URLs are stored and they open in a new tab with no referrer.

## Deploying on Render

`render.yaml` describes a Node web service (`npm ci` / `npm start`). Set `OWNER_PASSWORD` and `DATABASE_URL` (e.g. a free Neon Postgres database), plus any optional keys. Note that Render's free plan sleeps after inactivity; the first request after that takes about a minute. Data lives in Postgres, so it survives restarts and redeploys.

## Devin opportunities and the prospect PDF

Research is tuned for Cognition sales: sources are classified into Devin-fit categories (migration and modernization, security and vulnerabilities, AI initiatives, testing and reliability, engineering capacity, data and platform work) and rank above generic news. Security advisories come from the NVD CVE API (keyless), and engineering hiring volume comes from the public job board.

Each account has a **Download PDF** button that produces a Cognition-styled one-pager for the prospect: the opportunities found (with dated sources), where Devin helps, the approved alpha demo with its links, and what the alpha cost (`ACUs used × ACU_PRICE_USD`, default 2.25). Set `REPORT_CONTACT` to print a contact line. The PDF never includes your notes, the internal build brief, or flagged/unverified evidence.
