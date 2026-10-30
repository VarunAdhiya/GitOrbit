# Verification record

Verified locally on **29 October 2026**, using Node.js 24.19.0 on Windows and isolated Docker PostgreSQL 18 / Redis 7.4 services.

| Check                                              | Result                                                                       |
| -------------------------------------------------- | ---------------------------------------------------------------------------- |
| `npm run build`                                    | Passed; production Next.js routes built and Prisma client generated          |
| `npm run typecheck`                                | Passed for API, worker, packages, tests and web                              |
| `npm run lint`                                     | Passed                                                                       |
| `npm test`                                         | 119 tests passed, including OAuth, ownership, empty profiles and Groq errors |
| `npm run test:integration` with explicit test URLs | 4 tests passed against real PostgreSQL and Redis, including 80-skill saves   |
| `npx playwright test`                              | 15 browser tests passed against the production frontend                      |
| Database migrations                                | All four applied to the test database and configured Supabase project        |
| RLS verification                                   | Nine application tables and internal migration history are RLS-enabled       |
| Scheduler and health CLI                           | Five real BullMQ schedules initialized and inspected in isolated Redis       |
| Compose configuration                              | Validated with `docker compose config --no-env-resolution --quiet`           |
| Source whitespace check                            | `git diff --check` passed                                                    |

## What the tests actually exercise

- Genuine generated text PDFs are extracted in the bounded subprocess. Empty/scanned PDFs, oversized uploads and excessive page counts fail with useful errors.
- Mocked LLM responses are schema-validated and checked against source evidence; fabricated skills and unsupported experience claims are rejected.
- A mocked GitHub REST API returns a transient failure and duplicate issues. A real BullMQ worker retries through Redis, writes to PostgreSQL, exposes the issue through Express, and produces a personalized recommendation.
- Private anonymous session cookies protect profile reads and updates. Profile deletion cascades to profile skills; expired profiles deny access and are deleted by cleanup.
- Auth tests exercise the actual Supabase SSR client's PKCE challenge/verifier exchange against a mocked Auth server, HttpOnly cookies, callback errors and safe redirects, CSRF enforcement, session display, disabled-provider handling and sign-out. No live Google login is claimed by these tests.
- Real database tests verify guest-to-account transfer, credential revocation, cross-account read/update/delete denial, saved-profile precedence and retention through cleanup.
- Direct issue closure refresh removes an opportunity from discovery. A subsequent stale search result cannot reopen it.
- Browser journeys cover landing → discovery → filters/reset → issue details, manual profile creation → recommendations → deletion, upload consent → extracted skill editing, retryable API errors, and mobile layouts at 390px without horizontal overflow.
- Axe checks pass WCAG 2 A/AA and 2.1 AA automated rules in both themes for landing, discovery, profile, detail and sign-in screens. Browser tests also verify dark-by-default behavior with a light OS preference, persisted theme selection, OAuth error/retry UI and sign-out. This is an automated check, not a claim of complete accessibility certification.
- Screenshots were visually reviewed at desktop and mobile widths. Test fixtures exist only under `tests`; the application has no fabricated catalog fallback.

## Live startup verification (29 October 2026)

- Follow-up reproduced the resume rejection with a 4,422-character, 40-skill synthetic resume: Groq returned HTTP 400 with `json_validate_failed`. Tuned GPT-OSS extraction to low reasoning effort and concise evidence; regeneration after that specific failure retains strict JSON schema and local evidence validation. Verified the exact longer fixture succeeds, a simulated first rejection followed by a live Groq regeneration extracts all 40 skills, and its two-page PDF completes through the running frontend proxy (201, 40 skills, about 5 seconds), followed by recommendations (200) and diagnostic-profile deletion (204). Subsequently verified the user-supplied PDF: extraction read 4,686 characters; live Groq analysis succeeded on its first attempt. Upload through the running frontend proxy returned 201 with 7 validated skills, current-profile read returned 200, and recommendations returned 200 with 12 items. Deleted the temporary diagnostic profile (204); no resume text or personal filename was added to this record.

- Rechecked the reported resume-analysis outage: configured Groq credentials and model responded successfully, including a complete synthetic PDF upload through the running frontend proxy (201), saved-profile read (200), recommendations (200), and facets (200). The diagnostic profile was deleted (204). The original provider failure was not reproducible; no claim is made about its exact cause.
- Added one retry for transient provider network/body-read failures and HTTP 500/502/503/504 under a shared 45-second deadline. Provider 400/404/422 and timeouts now have distinct errors; logs contain status/failure categories without resume text or credentials. Browser GET requests retry temporary network/gateway failures once; mutations, rate limits, authorization errors, and canceled requests are not replayed. Regression checks cover recovery, retry limits, and cancellation.

- Reproduced a profile-save transaction timeout (`P2028`) with 40 skills against hosted Supabase. Replaced per-skill writes with bulk vocabulary/link inserts inside the same transaction. Rollback-only probes then completed 40 skills in 2.4 seconds and 80 skills in 1.8 seconds; timings vary with network latency. No probe data was retained.
- The current-profile endpoint returns `200 null` for a missing guest/account profile; explicit profile-ID access still enforces ownership, and database outages still return 503. Confirmed the running frontend proxy returns the new empty state and healthy database/Redis status.

- Corrected password URL encoding in the local, ignored environment file and applied both existing migrations to the configured Supabase database. Confirmed all nine application tables have RLS enabled.
- Fixed the API's Redis startup race by waiting for readiness before constructing the rate limiters. Unit tests cover delayed readiness, connection errors, closure and timeout without leaking connection details.
- Confirmed HTTP 200 from health and catalog endpoints through the frontend proxy. A real browser loaded `/explore`, received the catalog response and reported no page errors.
- Retried the five failed startup jobs; all five completed. Live GitHub ingestion then began populating the Supabase catalog (three repositories and six issues observed during verification; ingestion continues in the background).

## Not verified live

The Google provider is still disabled in the configured Supabase project. Its Auth URL and publishable key are configured locally, and the live API returns `GOOGLE_NOT_CONFIGURED` as expected. A real consent/login requires the Google Client ID/Secret and the two redirect configurations documented in SETUP. Supabase security advisors report only the intentional informational "RLS enabled, no policy" findings for private tables; the public migration-history warning was fixed.

AI-provider calls still use mocked responses in tests; no real resume was sent to Groq. No cloud deployment was created. Application Docker images were not built as part of this verification; Compose's database/Redis test services were run successfully.

See [SETUP.md](SETUP.md) for activation steps and the explicitly documented ranking, discovery, PDF and program-data limits.

## Filtering and sorting verification (30 October 2026)

- Added descending repository-star and fork sorting across all filtered results before pagination. Explicit language selection matches primary language, aligning with card labels. Exact repository selections include owner to avoid collisions.
- Integration tests cover mixed-language repositories, combined filters, explicit language overriding profile preferences, page ordering for both popularity sorts, match sorting, exact repository selection, and primary-language facets. Browser checks verify sort controls preserve filters, reset pagination, and persist in the URL after reload.
- Live frontend-proxy checks returned 200 for both Python popularity sorts. All 30 items in each response had Python as primary language, and star/fork counts were monotonically descending. Build, typecheck, lint, unit/API tests, isolated database integration tests, and browser journeys passed.

## Account-only profiles (30 October 2026)

- Verified sign-in is required before profile, resume, and recommendation API routes execute. Old guest cookies cannot authorize access. Public opportunity browsing remains available.
- Signed-out profile pages render a sign-in prompt without a file input or skill editor; the editor mounts only after identity verification. Removed the provider consent checkbox, branding, and consent-header requirement. Authenticated uploads still enforce CSRF, PDF validation, rate limits, and account ownership.
- Live proxy checks return 401 AUTH_REQUIRED for unsigned profile reads/creation, resume analysis, and recommendations; public opportunities return 200. Account integration tests successfully upload, save, edit, recommend, and delete without a consent header. Browser checks cover blocked guest access, signed-in creation and upload, both themes, and mobile widths. Reviewed the sign-in prompt and signed-in profile screenshots; mobile has no horizontal overflow.
