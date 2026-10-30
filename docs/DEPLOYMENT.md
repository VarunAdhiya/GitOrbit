# Deploy GitOrbit to Vercel

## Current release

Published on 2026-10-30 at **https://gitorbit-ruddy.vercel.app** from the local working tree, deployment `dpl_EeUbMj6FNqNMnniwUDtRHhpXchxJ`. The `ingestion` daemon is running in `dub1`; Upstash `gitorbit-redis` is connected on the free plan with automatic upgrades disabled.

Verified against the public deployment: website pages and API health return 200; Supabase and Redis are healthy; Python filtering and descending repository stars/forks work; unsigned profile access and resume uploads return 401; the browser renders the dark catalog and profile sign-in gate without JavaScript errors. Google OAuth initialization succeeds and sets a Secure cookie. Completing Google sign-in and the authenticated save/analysis flow still requires the account owner's browser and the Supabase redirect configuration below.

This was a CLI deployment. Local changes have not been committed or pushed, and Git-based automatic deployment has not been configured.

GitOrbit deploys from the **repository root** using `vercel.json`:

| Component                            | Deployment                        |
| ------------------------------------ | --------------------------------- |
| Next.js website                      | `web` Vercel Service              |
| Express API, including PDF parsing   | `api` container Service           |
| Continuous BullMQ ingestion          | `ingestion` Vercel Daemon         |
| PostgreSQL and Google authentication | Existing Supabase project         |
| Redis queues and API rate limits     | Hosted Redis with TCP/TLS support |

`/api/*` routes directly to Express; other paths go to Next.js. Both share one HTTPS origin, so authentication cookies work without a separate public backend domain. Docker Compose remains for local development; Vercel builds `Dockerfile.backend` for the API and worker. Next.js is built using its native framework integration.

## Account and infrastructure

Use Node.js 24 and link the correct project before deploying:

```sh
vercel link --project gitorbit --scope varun-1ff0
vercel project inspect
```

The configured project is `varun-1ff0/gitorbit`; its assigned production domain is `https://gitorbit-ruddy.vercel.app`. A domain assignment alone does not mean a working deployment has been promoted.

Provision Redis in the Vercel Marketplace or connect an existing hosted database. The prepared free Upstash configuration is:

```sh
vercel integration add upstash/upstash-kv --name gitorbit-redis --plan free --metadata primaryRegion=dub1 --metadata eviction=false --metadata autoUpgrade=false --environment production --no-env-pull --scope varun-1ff0
```

The account owner must accept the integration's terms when Vercel prompts. Use the **TCP TLS connection URL** (`rediss://...`) as `REDIS_URL`, not the REST endpoint. BullMQ requires eviction disabled. Keep automatic billing upgrades disabled unless deliberately choosing a paid plan. Do not use the local Docker Redis address in production.

## Production environment variables

Set these on the Vercel project's **Production** environment. Store credentials as Secret variables. Never prefix server credentials with `NEXT_PUBLIC_` or paste them into committed files.

| Variable                                         | Value                                                             |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| `DATABASE_URL`                                   | Existing Supabase PostgreSQL pooler connection string             |
| `REDIS_URL`                                      | Hosted Redis TLS URL                                              |
| `SUPABASE_URL`                                   | Existing Supabase project URL                                     |
| `SUPABASE_PUBLISHABLE_KEY`                       | Existing Supabase publishable key                                 |
| `GITHUB_TOKEN`                                   | Token for public repository ingestion                             |
| `LLM_API_KEY`                                    | Resume-analysis provider key                                      |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_PROVIDER_NAME` | Same provider configuration as the local API                      |
| `WEB_ORIGIN`                                     | `https://gitorbit-ruddy.vercel.app` (no trailing slash)           |
| `NODE_ENV`                                       | `production`                                                      |
| `PORT`                                           | `4000`                                                            |
| `TRUST_PROXY_HOPS`                               | `1` for Vercel's direct ingress; review when adding another proxy |
| `WORKER_CONCURRENCY`                             | `2`                                                               |

`DIRECT_URL` is only needed in the environment running Prisma migrations. Run `npm run db:migrate` against the intended Supabase database before releasing schema changes. Do not run migrations in every container startup. The existing database can be reused without re-importing all issues.

Keep preview deployments separate from production credentials and data. The worker only runs after a production deployment is promoted; Vercel does not run daemons in previews. `.vercelignore` excludes local credentials and generated files; `.dockerignore` also excludes them from local container builds.

## Google login

In Supabase **Authentication → URL Configuration**:

- Set Site URL to `https://gitorbit-ruddy.vercel.app`.
- Add `https://gitorbit-ruddy.vercel.app/api/v1/auth/callback` to Redirect URLs.
- Keep `http://localhost:3000/api/v1/auth/callback` if local development is still needed.

Keep the Google provider enabled with the existing Google Client ID and Secret. Google's authorized redirect URI remains `https://<supabase-project-ref>.supabase.co/auth/v1/callback`; it is different from the application callback above. Test Google sign-in on the final production domain after promotion.

## Release and verify

```sh
npm run typecheck
npm run lint
npm test
vercel deploy --prod --skip-domain --scope varun-1ff0
```

Inspect the resulting deployment and its build logs. Use `vercel curl` for protected deployment checks, without disabling deployment protection. Before promoting, verify `/api/v1/health` returns 200 and the catalog loads with data. Then:

```sh
vercel promote <deployment-url> --scope varun-1ff0
```

Verify the production website, language filters, stars/forks sorts, Google login, profile saving, and resume analysis. Confirm ingestion logs show the worker ready and successful jobs. A successful website build alone does not verify database, Redis, authentication, or ingestion.

## Free-tier limits

Vercel Services, container Functions, and Daemons are currently beta features. [Daemon quotas](https://vercel.com/docs/daemons/limits) on Hobby include 420 GB-hours of provisioned memory and 5 active CPU-hours per month, shared across the team. This configuration uses one 1 GiB worker: continuous operation consumes the memory quota in approximately **17.5 days**, possibly sooner if the CPU allowance is exhausted. Vercel stops Hobby daemons when the quota is reached; existing opportunities remain in Supabase but automatic updates stop. A continuously operating production deployment needs an appropriate plan or a separately designed scheduled ingestion strategy.

Upstash's free command allowance also applies. [BullMQ polls Redis even when idle](https://upstash.com/docs/redis/integrations/bullmq), so monitor usage; a fixed plan may fit a continuously running worker better. No paid plan or automatic upgrade is enabled by this configuration.

Vercel Functions have a [4.5 MB request limit](https://vercel.com/docs/functions/limitations#request-body-size). GitOrbit limits PDFs to **4 MB on Vercel**, leaving room for multipart headers; local deployments retain the 5 MB limit. The API supplies the limit displayed by the upload form.
