# Architecture

```text
Next.js App Router :3000
    │ same-origin /api proxy; private HttpOnly session cookie
    ▼
Express :4000 ─── Zod validation ─── Prisma 7 / pg adapter ─── Supabase PostgreSQL
    │                                         ▲
    ├── PDF child process → structured AI      │ permanent source of truth
    ├── deterministic matching                │
    └── protected ingestion administration    │
                 │                            │
                 ▼                            │
         BullMQ 6 + Redis ─── dedicated worker ─── GitHub REST provider
                 ▲                 │
          Job Schedulers            └── normalize / deduplicate / refresh
```

## Package boundaries

- `apps/web`: public landing and client workspace. No database, GitHub, or AI keys.
- `apps/api`: versioned REST, session ownership, rate limits, PDF extraction, account authentication, catalog queries, ranking.
- `apps/worker`: durable schedules, independent ingestion process, provider abstraction, distributed leases, retry/health bookkeeping, operational CLI.
- `packages/database`: normalized Prisma schema, generated migrations, singleton-per-process client factory. Relation/FK indexes, unique source IDs, GIN array indexes and a partial open-issue index. RLS denies public Data API access.
- `packages/shared`: environment/input schemas, normalized skill vocabulary, serializable response types, BullMQ connection helpers.
- `packages/matching`: pure deterministic scorer independent of persistence and the UI. All subscores stay in [0,100].

## REST

| Method           | Path                              | Access / purpose                                                    |
| ---------------- | --------------------------------- | ------------------------------------------------------------------- |
| GET              | `/api/v1/config`                  | Public analysis availability and upload configuration               |
| POST             | `/api/v1/resumes/analyze`         | Sign-in required; multipart `resume`, saved to account              |
| POST             | `/api/v1/profiles`                | Sign-in required; creates or updates own account profile            |
| GET              | `/api/v1/profiles/current`        | Sign-in required; own profile or `200 null` when absent             |
| GET/PATCH/DELETE | `/api/v1/profiles/:id`            | Verified sign-in AND account ownership, not UUID alone              |
| GET              | `/api/v1/opportunities`           | Validated filters and stable pagination; open/fresh/unarchived only |
| GET              | `/api/v1/opportunities/facets`    | Languages, issue skills, repositories and verified programs         |
| GET              | `/api/v1/opportunities/:id`       | Details; stale or closed issue explicitly flagged                   |
| GET              | `/api/v1/recommendations`         | Private profile, ranked results and score explanations              |
| GET              | `/api/v1/health`                  | Checks PostgreSQL and Redis                                         |
| GET              | `/api/v1/admin/ingestion`         | Bearer administrator token; schedules/runs/dead jobs                |
| POST             | `/api/v1/admin/ingestion/trigger` | Bearer administrator token; bounded validated job                   |

Filters: `q`, `language`, `skill`, `difficulty`, `activity=month|quarter|any`, `repository`, `program` (UUID), `available=true|false`, `sort=updated|created|match|stars|forks`, `page=1..1000`, `limit=1..30`. The language selector matches the repository's primary language, case-insensitively, consistent with the language displayed on cards. Language facets contain primary languages only. Repository selections use exact `owner/name`; plain text repository searches still support partial owner/name matches. Preferred profile languages focus recommendations unless an explicit language filter overrides them.

Stars/forks sort descending across all filtered results in PostgreSQL before pagination, breaking ties by issue update time and ID. `match` is only available on recommendations and ranks the latest 1,000 filtered issues by weighted score, then update time and ID. The ranking limit is displayed above results; popularity sorts are not limited to this candidate window. Changing a filter or sort resets pagination and keeps other selected filters.

Recommendation skill scoring ignores Git in both profiles and issue requirements, including match explanations and missing-prerequisite lists. Git mentions do not increase or dilute a skill score. Other technical skills and repository-language context continue to contribute normally.

Errors use `{ "error": { "code": "...", "message": "...", "fields": [] } }`. `fields` is optional and contains names only, never input values. JSON bodies are limited to 64 KB; uploads have separate multipart limits.

## Data correctness and operational behavior

Google sign-in uses Supabase Auth through Express. `/api/v1/auth/google` starts PKCE, `/api/v1/auth/callback` exchanges and verifies the code, `/api/v1/auth/session` returns only display identity, and `/api/v1/auth/sign-out` revokes the current refresh session and clears cookies. A fresh server client per request reads/writes HttpOnly cookies and calls `getUser()` before private profile operations. No auth tokens are exposed to client JavaScript.

All profile, resume, and recommendation API routes require a verified Supabase user; unsigned requests return `401 AUTH_REQUIRED` before PDF parsing or profile access. There is no provider consent checkbox or `X-Resume-Consent` header requirement. Public discovery remains available without sign-in.

For backward compatibility, the database retains two ownership modes: an expiring hashed guest credential, or a unique verified Supabase user UUID with no expiry. An ownership constraint prevents both modes from being active at once. Account queries always include that UUID; guest queries require an unclaimed profile and a valid expiry. Sign-in claims a valid guest profile only if the account has no saved profile. RLS and revoked Data API grants keep tables private; authentication does not grant direct browser access to the database. Prisma's migration history table is also private.

The frontend defaults to a neutral charcoal dark theme with white controls and amber accents. `data-theme` controls shared CSS tokens; a small pre-paint script restores the local preference. Theme state contains no auth data.

Search discovery uses source IDs, not URLs/titles, for deduplication. Issue descriptions stay untrusted data and render as escaped text. The API records creation, update and sync timestamps separately. `good first issue` is evidence of beginner scope; `help wanted` alone is not. Technical terms mentioned in an issue are distinguished from the repository language list.

Discovery writes incrementally, so partial progress survives network errors. The saved search cursor advances only after every partition succeeds; replay uses unique upserts. Bulk metadata/status refresh paginates by ID with a fixed cutoff and bounded batches. Disappeared issues become unavailable; closed issues are stored for accurate detail views but removed from recommendations. Date-based freshness checks make stale records undiscoverable even if cleanup has stopped.

Queue jobs and API rate-limit keys live in Redis; repository/issue data, profiles, runs and cursors live in PostgreSQL. Workers use unlimited Redis reconnect retries, while producers fail promptly. Shared rate reservations protect the GitHub token across worker replicas. Admin diagnostics and structured worker logs expose failures without logging personal resume content.

## Extension points

Implement `OpportunityProvider` for a future source, returning the normalized `RepositoryRecord` and `DiscoveredIssue` DTOs, and reuse queue processing/upserts. The current adapter is GitHub-only by design. Source-specific response shapes and URL parsing remain inside the adapter. Add a semantic matcher behind the pure matching package later without changing the profile/session model. Verified program associations carry explicit evidence URLs.
