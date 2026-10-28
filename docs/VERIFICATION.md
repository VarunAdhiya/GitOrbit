# Verification record

Verified locally on **29 October 2026**, using Node.js 24.19.0 on Windows and isolated Docker PostgreSQL 18 / Redis 7.4 services.

| Check                                              | Result                                                              |
| -------------------------------------------------- | ------------------------------------------------------------------- |
| `npm run build`                                    | Passed; production Next.js routes built and Prisma client generated |
| `npm run typecheck`                                | Passed for API, worker, packages, tests and web                     |
| `npm run lint`                                     | Passed                                                              |
| `npm test`                                         | 63 tests passed                                                     |
| `npm run test:integration` with explicit test URLs | 1 complete pipeline test passed against real PostgreSQL and Redis   |
| `npx playwright test`                              | 6 browser tests passed against the production frontend              |
| Database migrations                                | Both applied successfully to a fresh PostgreSQL 18 test database    |
| RLS verification                                   | All nine application tables confirmed RLS-enabled                   |
| Compose configuration                              | Validated with `docker compose config --no-env-resolution --quiet`  |
| Source whitespace check                            | `git diff --check` passed                                           |

## What the tests actually exercise

- Genuine generated text PDFs are extracted in the bounded subprocess. Empty/scanned PDFs, oversized uploads and excessive page counts fail with useful errors.
- Mocked LLM responses are schema-validated and checked against source evidence; fabricated skills and unsupported experience claims are rejected.
- A mocked GitHub REST API returns a transient failure and duplicate issues. A real BullMQ worker retries through Redis, writes to PostgreSQL, exposes the issue through Express, and produces a personalized recommendation.
- Private anonymous session cookies protect profile reads and updates. Profile deletion cascades to profile skills; expired profiles deny access and are deleted by cleanup.
- Direct issue closure refresh removes an opportunity from discovery. A subsequent stale search result cannot reopen it.
- Browser journeys cover landing → discovery → filters/reset → issue details, manual profile creation → recommendations → deletion, upload consent → extracted skill editing, retryable API errors, and mobile layouts at 390px without horizontal overflow.
- Axe checks pass WCAG 2 A/AA and 2.1 AA automated rules for landing, discovery, profile and detail screens. This is an automated check, not a claim of complete accessibility certification.
- Screenshots were visually reviewed at desktop and mobile widths. Test fixtures exist only under `tests`; the application has no fabricated catalog fallback.

## Not verified live

No real GitHub or AI-provider credentials were supplied, and no hosted Supabase project was selected. Those integrations are implemented but were tested with mocked external responses and local PostgreSQL, not live credentials. No cloud deployment was created. Application Docker images were not built as part of this verification; Compose's database/Redis test services were run successfully.

See [SETUP.md](SETUP.md) for activation steps and the explicitly documented ranking, discovery, PDF and program-data limits.
