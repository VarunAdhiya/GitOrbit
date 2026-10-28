# Run GitOrbit

GitOrbit implements the OpenSource Match specification in the original README. It has no login, GitHub OAuth, or browser-accessible database credentials.

## Prerequisites

- Node.js 24 LTS (minimum 22.16), npm 11 recommended.
- PostgreSQL 18 locally, or a Supabase PostgreSQL project.
- Redis 6.2+ (Compose uses 7.4), with `maxmemory-policy noeviction`.
- A server-side GitHub token for ingestion.
- An OpenAI-compatible AI endpoint with strict JSON-schema Chat Completions support for resume analysis. Manual profile creation works without it.

## Quick start

```sh
npm ci
cp .env.example .env
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
```

PowerShell: use `Copy-Item .env.example .env` instead of `cp` if preferred. Add `GITHUB_TOKEN` to `.env`. Add `LLM_API_KEY` to enable PDF analysis. Then start the three separate processes:

```sh
npm run dev
```

Open **http://localhost:3000**. Express runs at http://localhost:4000. The frontend proxies `/api` to Express so anonymous cookies stay same-origin. Set `API_INTERNAL_URL` in `apps/web/.env.local` when developing with a non-default API address; Next reads its own workspace env file. In Docker, the internal URL is set at image build time.

You can also run these in separate terminals:

```sh
npm run dev:web
npm run dev:api
npm run dev:worker
```

The worker initializes all recurring schedules at startup. For an initial 90-day issue backfill:

```sh
npm run ingestion:trigger -- discover-issues --backfill
npm run ingestion:trigger -- discover-repositories
npm run ingestion:health
```

The catalog starts empty. **No sample issues or fabricated API data are loaded.** GitHub requests are shared-rate-limited to approximately 28/minute across worker instances; large backfills take time. Once an issue is imported, it appears immediately in discovery. The landing page can run with only `npm run dev:web`; catalog/profile operations require Express, PostgreSQL and Redis.

## Supabase PostgreSQL

1. Choose/create your project in Supabase yourself; this repository does not provision paid infrastructure.
2. Follow [Supabase's Prisma connection guide](https://supabase.com/docs/guides/database/prisma). Copy the direct or **session-mode pooler** connection string for a trusted server-only role into `DATABASE_URL`. URL-encode the password. Never use a browser/public `NEXT_PUBLIC_` variable for it.
3. Set `DIRECT_URL` to a direct connection or session-mode pooler suitable for migrations. Don't use the transaction-mode pooler for migration operations. For IPv4-only environments, use the session pooler.
4. Apply `npm run db:migrate`. Prisma 7 uses the `@prisma/adapter-pg` driver and an eight-connection pool per process. Keep the sum of API/worker pools within your database connection budget.
5. The migration enables RLS on all application tables and revokes `PUBLIC`, `anon` and `authenticated` access. **There are intentionally no public policies.** Only Express and workers access the database using the migration/table-owner role (or a deliberately configured trusted backend role). Do not grant a frontend database role access to profiles. Review Supabase security advisors after deploying migrations.

For hosted Supabase, don't run the local Postgres container. Start only Redis (`docker compose up -d redis`) and run the app processes on the host with your configured URLs. The full local Compose profile intentionally uses its local Postgres container; do not assume it uses hosted URLs.

## GitHub

Set `GITHUB_TOKEN` to a fine-grained token capable of reading public repository metadata and issues; no write permissions are needed. Keep it server-side. `GITHUB_LANGUAGES` controls language searches. GitOrbit requests only `api.github.com`, never executes downloaded code, and stores canonical GitHub URLs. It uses REST search, repository/language/community-profile endpoints and individual issue refreshes.

- Incremental discovery runs every 30 minutes, with a persisted per-language/label cursor and five-minute overlap.
- Initial incremental runs look back seven days; explicit backfills look back 90 days.
- Repository discovery runs every six hours and takes up to 300 recently active repositories per language. This is a bounded discovery sample, not a claim of complete GitHub coverage.
- Issue search splits time windows when results exceed 1,000 or are incomplete. Cursor advancement happens only on a complete query. An irreducibly saturated window fails visibly rather than silently dropping results.
- Repository metadata refresh runs hourly in batches of 25. Open issue status refresh runs every ten minutes in batches of 50.
- Issues older than `STALE_HOURS` since synchronization are excluded immediately by API queries, independently of cleanup. Archived repositories are excluded. Closed/deleted issues are removed from results at refresh.
- Assignment and in-progress labels are surfaced; neither is a guarantee about who is working on an issue.

## Resume analysis and privacy

Configure `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL`, and `LLM_PROVIDER_NAME`. The default is the OpenAI-compatible `/v1/chat/completions` API. The chosen provider/model must support `response_format: json_schema` with strict structured output. A compatible self-hosted provider can be used; this is not an Anthropic-native adapter.

The UI names the provider and requires consent before upload. The API accepts one PDF up to 5 MB and 20 pages. Parsing runs in a killable child process with a 192 MB V8 heap limit and a 15-second timeout. PDFium/native allocations are additionally bounded by the deployment container's memory limit; set container memory limits appropriate to your deployment. A Redis lease permits at most three concurrent analyses across API instances. The provider request has a 45-second timeout.

The PDF buffer is wiped after processing. Raw PDF bytes and full resume text are never written to the database or logs. Text exists transiently in process memory and is sent to the explicitly disclosed provider; its retention policy applies. Zod checks the response and each skill must have an exact evidence excerpt that mentions that skill. Unsupported skill claims are dropped. Experience level remains an explicitly marked inference until the user confirms it. Up to six short experience excerpts are retained in the expiring profile to explain that inference.

Profiles use a random 256-bit HttpOnly, SameSite=Lax session cookie. Only its SHA-256 hash is stored. The cookie is browser-session scoped; the database profile also expires after 24 hours by default. All access checks expiry. Cleanup runs hourly, deleting expired profiles and cascading profile skills. A successful new analysis replaces the active profile and revokes its old credential atomically. Delete is immediate. Skills themselves are a shared, non-personal vocabulary and can remain after profile deletion.

Cookies are Secure in production. Set `WEB_ORIGIN` to an HTTPS origin and configure the reverse proxy so frontend `/api` requests reach Express. Mutating profile requests require an allowed Origin (when supplied) and a custom header to prevent cross-origin form submissions. The API uses Redis-backed rate limiting: 120 requests/minute/IP and 6 resume uploads/hour/IP. Set `TRUST_PROXY_HOPS` only for a known proxy topology.

## Workers and administration

```sh
npm run ingestion:schedule
npm run ingestion:trigger -- refresh-issue-status
npm run ingestion:trigger -- sync-repository-metadata
npm run ingestion:trigger -- cleanup-stale-opportunities
npm run ingestion:health
```

The CLI requires access to the server environment; it doesn't need `ADMIN_TOKEN`. Optional HTTP administration uses `Authorization: Bearer <ADMIN_TOKEN>`; generate at least 32 random characters. Admin HTTP routes deny all access when unset. `GET /api/v1/admin/ingestion` returns counts, schedules, runs and the last 20 failed jobs. `POST /api/v1/admin/ingestion/trigger` accepts `{ "type": "discover-issues", "mode": "backfill" }`.

Retries use five attempts with exponential backoff (5s base). Primary/secondary GitHub limits delay the whole worker queue using BullMQ's manual rate limit API. Distributed renewable leases prevent overlapping jobs, and database uniqueness constraints make replays idempotent. Check failed jobs and `ingestion_runs` after outages. Queue failures retain diagnostic reasons; HTTP/request logs never contain resume text, cookies, keys, or request bodies. Workers finish active work on SIGTERM; allow a long enough deployment grace period for in-flight searches.

## Build and full local containers

```sh
npm run build
docker compose --profile app up --build
```

The `migrate` service completes before the API and worker start. Web, API and worker are separate containers. Full Compose is for **local development** and uses HTTP/session cookies, loopback-bound ports and development database credentials. Production needs HTTPS, managed secrets, strong database/Redis authentication, backups, container resource limits, and appropriately sized connection pools. Never expose the development Postgres/Redis ports publicly.

## Tests

```sh
npm test
npm run lint
npm run typecheck
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/API tests mock external APIs. PDF tests generate and extract real PDFs. Browser tests run the production Next build on port 3100, mock API responses, and exercise navigation, filters, upload consent, skill editing, recommendations, deletion, outages and mobile layouts. Screenshots are written under ignored `tmp/screenshots`.

Real queue/database integration uses **explicit isolated test services**:

```sh
docker compose -f docker-compose.test.yml up -d --wait
```

PowerShell:

```powershell
$env:DATABASE_URL='postgresql://gitorbit:gitorbit@localhost:55432/gitorbit_test'
$env:DIRECT_URL=$env:DATABASE_URL
$env:TEST_DATABASE_URL=$env:DATABASE_URL
$env:TEST_REDIS_URL='redis://localhost:56379/1'
npm run db:migrate
npm run test:integration
docker compose -f docker-compose.test.yml down
```

For bash, use `export NAME=value` for the same variables. Integration tests skip explicitly when test URLs aren't supplied, and refuse a database name without `test`. They run actual BullMQ jobs against actual Redis and PostgreSQL, with mocked GitHub responses and mocked resume services. They cover transient retries, duplicates, issue closure, profile ownership, ranking, and cascading deletion. The CI workflow runs this suite with PostgreSQL/Redis services; no external credentials are required.

## MVP boundaries

- Only GitHub is implemented. Provider abstraction supports future sources; no scraping is done.
- Programs appear only after verified Program + IssueProgram records with evidence are added through trusted administration. Ordinary issues are never presented as GSoC/Outreachy opportunities.
- Match ranking is deterministic (40/25/20/15). For bounded request cost, the MVP ranks the 1,000 most recently updated issues matching the filters. Both the response and UI disclose when this limit applies. Narrow filters for a more focused set. Future semantic ranking can replace the matching package.
- Difficulty relies on explicit maintainer labels, otherwise `unknown`; scope and guidance are presented for human review. Language overlap is repository context, not proof of issue-specific requirements. Maintainer response-time data is not invented.
- Facets are bounded to 1,000 repositories/issues and 100 verified programs per request.
- Scanned PDFs/OCR are not supported. Raw resumes are not retained for later reprocessing.
- GitHub search indexes and issue state can change between synchronization and contribution. Check GitHub before starting.
