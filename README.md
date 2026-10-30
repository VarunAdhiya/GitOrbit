# GitOrbit

An open-source opportunity discovery app built from the specification below.

**Deploy:** [Vercel deployment guide](docs/DEPLOYMENT.md) covers the website, API, ingestion worker, Supabase, and hosted Redis.

**Start here:** [Setup and running instructions](docs/SETUP.md) · [Architecture and API](docs/ARCHITECTURE.md) · [Verification results](docs/VERIFICATION.md)

```sh
npm ci
cp .env.example .env
docker compose up -d postgres redis
npm run db:generate
npm run db:migrate
# Add GITHUB_TOKEN and optional LLM_API_KEY to .env, then:
npm run dev
```

Open http://localhost:3000. Web, API, and BullMQ workers run as separate processes. The catalog is populated by real GitHub ingestion, not sample data. Use `npm run ingestion:trigger -- discover-issues --backfill` to enqueue the initial backfill. See the setup guide for Supabase, privacy, AI configuration, and testing.

The UI defaults to dark mode with a persistent theme toggle. **Google sign-in is required** to upload a resume, create or manage a profile, and get personalized recommendations. Visitors can browse public opportunities without signing in. Follow [Google sign-in setup](docs/SETUP.md#google-sign-in) to enable the Supabase provider and configure both OAuth redirects. These additions extend the original MVP specification below.

---

# Original project specification: OpenSource Match — AI-Powered Open-Source Opportunity Discovery Platform

You are a senior full-stack engineer and software architect. Build a production-quality, open-source web application called **OpenSource Match**.

## 1. Product Vision

Build a platform that helps developers discover relevant open-source contribution opportunities based on their resume, technical skills, experience, and interests.

Users should be able to:

1. Upload a PDF resume and automatically extract technical skills and experience.
2. Discover active open-source repositories and their available contribution issues.
3. Receive personalized, ranked recommendations based on skills, experience, and interests.
4. Filter opportunities by programming language, difficulty, project activity, repository, and program.

The platform must automatically discover and synchronize open-source opportunities from GitHub using background ingestion workers.

**Important architectural requirement:** Use BullMQ, Redis, and dedicated background workers from the beginning. Do not replace them with basic cron scripts.

No GitHub login or user authentication is required for the MVP.

## 2. Technology Stack

Use the following technologies:

**Frontend**
- Next.js with TypeScript and App Router
- Tailwind CSS
- Modern, responsive UI
- Accessible and reusable components

**Backend**
- Node.js with TypeScript
- Express.js
- Prisma ORM
- Zod for request and response validation

**Database**
- Supabase PostgreSQL
- Proper relational schema, indexes, and migrations

**Background Processing**
- Redis
- BullMQ
- Dedicated Node.js worker process
- Repeatable scheduled ingestion
- Retries, exponential backoff, and failed-job monitoring

**External Integrations**
- GitHub REST API for repository and issue discovery
- GitHub GraphQL API only where it provides a clear advantage
- Configurable LLM provider for resume skill extraction
- PDF text extraction library

**Deployment**
- Docker and Docker Compose for local services
- Separate processes for frontend, API, and workers
- Environment-based configuration

Use current stable compatible package versions. Do not introduce unnecessary microservices or infrastructure.

## 3. Feature One — Resume Upload and Skill Extraction

Create a resume upload interface where users can upload PDF files.

### Functional requirements

1. Support PDF resumes only.
2. Validate file type and maximum file size.
3. Extract text from the PDF on the backend.
4. Send extracted text to an LLM using structured output.
5. Identify:
   - Programming languages
   - Frameworks and libraries
   - Databases
   - Cloud and DevOps tools
   - Software development domains
   - Professional and project experience
   - Approximate experience level
6. Return a normalized JSON profile.
7. Display detected skills as editable tags.
8. Allow users to add, remove, or correct skills.
9. Allow users to specify interests, preferred programming languages, and desired issue difficulty.
10. Continue to personalized recommendations.

Example structured result:

```json
{
  "programmingLanguages": ["JavaScript", "TypeScript", "Python"],
  "frameworks": ["React", "Next.js", "Express"],
  "databases": ["PostgreSQL", "MongoDB"],
  "tools": ["Docker", "Git", "AWS"],
  "domains": ["Frontend", "Backend"],
  "experienceLevel": "intermediate",
  "interests": ["Web Development", "Developer Tools"]
}
```

Do not fabricate skills or experience that are absent from the resume. Clearly distinguish extracted evidence from inferred proficiency.

Use Zod schemas to validate LLM output.

Support text-based PDFs initially. If a PDF is scanned and contains no extractable text, return a helpful error rather than silently processing an empty document.

**Privacy requirements:**
- Do not permanently store raw resumes by default.
- Do not log resume contents or personally identifying information.
- Minimize retention of extracted resume text.
- Clearly communicate when resume content is sent to an external AI provider.
- Use a session-scoped identifier for anonymous recommendations.
- Provide a way to delete the active profile.

## 4. Feature Two — Open-Source Opportunity Discovery

Build an automated discovery system that fetches open-source repositories and contribution issues from GitHub.

### GitHub API integration

Use GitHub REST APIs to discover:

- Open issues labeled `good first issue`
- Open issues labeled `help wanted`
- Recently created issues
- Recently updated issues
- Active open-source repositories
- Repository programming languages
- Repository topics and descriptions
- Stars, forks, and last push date
- Issue labels, creation date, and update date
- Repository contribution documentation, where available

Use authenticated GitHub API requests through a server-side token.

Example issue search:

```http
GET https://api.github.com/search/issues?q=is:issue+is:open+label:"good first issue"+language:javascript
```

Implement additional search strategies for Python, Java, TypeScript, Go, Rust, C++, and other configurable languages.

### Important discovery requirements

- Only recommend currently open issues based on the latest available synchronized data.
- Distinguish repository creation date, repository activity, issue creation date, and issue update date.
- Do not assume that a recently updated issue is newly created.
- Do not assume a repository's primary language is the exact skill required by every issue.
- Distinguish individual contribution issues from entire repositories.
- Do not include pull requests in issue search results.
- Deduplicate issues across search queries.
- Handle GitHub pagination, search-result limits, rate limits, and secondary throttling.
- Use GitHub's rate-limit headers to schedule retries appropriately.
- Store the source URL and last synchronization time for every opportunity.
- Track whether an issue is open, closed, assigned, or potentially already being worked on where the source provides sufficient evidence.
- Refresh issues periodically so outdated recommendations are removed or flagged.

Design a provider abstraction so GitLab, GSoC, Outreachy, and other sources can be integrated in future releases without rewriting the ingestion pipeline.

For the MVP, implement GitHub fully. Do not scrape external websites unnecessarily.

## 5. Feature Three — BullMQ + Redis + Background Workers

This is a mandatory component of the MVP.

Build an independent ingestion system using BullMQ and Redis.

### Required components

**Scheduler**

Periodically enqueue ingestion and synchronization jobs.

Use BullMQ's supported modern scheduling APIs for the installed version.

**Redis**

Use Redis to store BullMQ job queues, execution states, retry metadata, and scheduling information.

PostgreSQL must remain the permanent source of truth for repository and issue data.

**Workers**

Create dedicated worker processes to execute the following jobs:

1. `discover-repositories`
2. `discover-issues`
3. `sync-repository-metadata`
4. `refresh-issue-status`
5. `cleanup-stale-opportunities`

### Ingestion workflow

```text
BullMQ Scheduler
       |
       v
Redis Job Queues
       |
       v
Background Ingestion Workers
       |
       v
GitHub REST API
       |
       v
Validate / Normalize / Deduplicate
       |
       v
Prisma
       |
       v
Supabase PostgreSQL
```

### Worker requirements

- Implement retries with backoff and retry limits.
- Handle GitHub API rate limits without aggressively retrying.
- Use configurable worker concurrency.
- Support graceful shutdown.
- Ensure idempotent processing.
- Avoid duplicate records using database uniqueness constraints.
- Track job failures and ingestion health.
- Log job execution using structured logging.
- Prevent overlapping bulk synchronization runs where necessary.
- Use incremental synchronization rather than repeatedly fetching the entire catalog.
- Support initial backfill and ongoing refresh as separate workflows.
- Avoid loading excessively large result sets into memory.
- Configure Redis connection handling appropriately for BullMQ workers.

Provide scripts to:
- Start the API
- Start the frontend
- Start background workers
- Initialize recurring ingestion schedules
- Trigger ingestion manually for development

Add a minimal protected administrative endpoint or CLI command to inspect ingestion health and manually enqueue jobs.

## 6. Feature Four — Personalized Recommendation Engine

After resume analysis, match the user's skills and preferences with available open-source issues.

Implement rule-based ranking in the MVP.

Use these initial weights:

```text
Skill Compatibility       40%
Difficulty Compatibility  25%
Repository Activity       20%
Interest Compatibility   15%
```

Each subscore must be normalized between 0 and 100.

### Skill compatibility

Compare extracted programming languages, frameworks, databases, and tools with repository and issue metadata.

Do not treat repository primary language as proof of issue-specific requirements.

### Difficulty compatibility

Estimate difficulty using:
- Issue labels
- Issue description and scope
- Repository contribution guidance
- User experience level

If information is insufficient, return `unknown` rather than inventing a difficulty level.

### Repository activity

Evaluate:
- Recent commits or pushes
- Recent issue and PR activity
- Available maintainer responsiveness signals
- Repository archival status

Avoid penalizing healthy but infrequently updated repositories solely due to age.

### Interest compatibility

Compare user-selected interests with repository topics, categories, and issue descriptions.

### Recommendation response

Return:
- Overall match score
- Skill-match score
- Difficulty
- Repository activity summary
- Matching skills
- Missing or uncertain prerequisites
- Short explanation of why the issue is recommended
- Direct GitHub issue URL

Initially generate explanations deterministically using structured metadata. Do not require LLM calls for every recommendation.

Build the matching module so semantic search and pgvector can be added later.

## 7. Feature Five — Search and Advanced Filters

Build a discovery page with:

- Keyword search
- Programming language filter
- Framework or skill filter where data is available
- Difficulty: Beginner, Intermediate, Advanced, Unknown
- Repository activity filter
- Repository/project filter
- Program filter
- Recently created issues
- Recently updated issues
- Highest match score
- Pagination

**Program filtering:** Implement the data model and UI capability, but only show actual program options when verified program-specific records exist. Do not present ordinary GitHub repositories as GSoC or Outreachy opportunities without evidence.

Support two discovery modes:

**Explore All**

Browse available opportunities without uploading a resume.

**Recommended For You**

Upload a resume, verify skills, and receive personalized matches.

## 8. Database Design

Create a normalized Prisma schema covering at least:

**repositories**
- id
- source
- external_id
- owner
- name
- description
- primary_language
- stars
- forks
- topics
- archived
- last_pushed_at
- last_synced_at
- created_at
- updated_at

**issues**
- id
- repository_id
- external_id
- issue_number
- title
- description
- source_url
- labels
- state
- assigned
- difficulty
- created_at_source
- updated_at_source
- last_synced_at

**skills**
- id
- name
- category
- normalized_name

**user_profiles**
- id
- anonymous_session_id
- experience_level
- interests
- created_at
- expires_at

**profile_skills**
- profile_id
- skill_id
- confidence
- source

**programs**
- id
- name
- source_url
- metadata

**ingestion_runs**
- id
- job_type
- source
- status
- processed_count
- failed_count
- started_at
- finished_at
- error_summary

Add appropriate indexes, unique constraints, and relations.

Use source-specific external IDs for reliable deduplication.

Handle anonymous-session expiration and profile deletion.

Do not store unnecessary raw resume contents.

## 9. Frontend Pages

Build the following pages:

**Landing Page**
- Clear product description
- Resume upload call-to-action
- Explore opportunities without resume
- Explanation of how matching works

**Resume Analysis Page**
- Drag-and-drop PDF upload
- Validation and extraction states
- Detected skills and experience
- Editable skills and interests
- Continue to recommendations

**Opportunity Discovery Page**
- Search and filter panel
- Repository and issue cards
- Sorting options
- Pagination
- Last updated information
- Links to GitHub

**Personalized Recommendations Page**
- Ranked opportunity cards
- Match score
- Matched skills
- Difficulty
- Project activity
- Explanation of recommendation
- Link to original GitHub issue

**Opportunity Detail Page**
- Repository overview
- Issue description
- Required or relevant skills
- Difficulty and activity indicators
- Contribution guidelines link, if available
- Open issue on GitHub action

Build a clean, modern developer-focused interface that works well on desktop and mobile.

Include loading states, empty states, error states, and accessible controls.

## 10. API Design

Implement versioned REST endpoints such as:

```http
POST   /api/v1/resumes/analyze
GET    /api/v1/profiles/:id
PATCH  /api/v1/profiles/:id
DELETE /api/v1/profiles/:id

GET    /api/v1/opportunities
GET    /api/v1/opportunities/:id
GET    /api/v1/recommendations

GET    /api/v1/health
GET    /api/v1/admin/ingestion
POST   /api/v1/admin/ingestion/trigger
```

Secure anonymous profile access using unguessable session credentials, not just publicly accessible profile IDs.

Secure administrative endpoints with server-side authentication and authorization.

Validate all request inputs, bound pagination limits, and use consistent API error responses.

## 11. Security and Reliability

Implement:
- Environment-variable validation
- Secure handling of GitHub and LLM API credentials
- PDF file-type and file-size validation
- Resource limits for PDF processing
- File-upload and API rate limiting
- Safe text handling and LLM output validation
- Protection against prompt injection from resumes and GitHub issue descriptions
- No execution of downloaded repository code
- Sanitization of externally sourced content
- Structured logging without sensitive resume contents
- Idempotent database writes
- Proper database migrations
- Worker error handling
- Job retry and dead-job inspection
- Graceful process shutdown

Use bounded, parameterized database queries through Prisma.

## 12. Project Structure

Use a maintainable monorepo:

```text
opensource-match/
├── apps/
│   ├── web/
│   ├── api/
│   └── worker/
├── packages/
│   ├── database/
│   ├── shared/
│   └── matching/
├── docker-compose.yml
├── .env.example
├── README.md
└── package.json
```

Shared packages should contain database access, TypeScript types, Zod schemas, and recommendation logic where appropriate.

Avoid circular dependencies between apps and workers.

## 13. Testing Requirements

Write tests for:
- Resume extraction validation
- Skill normalization
- Recommendation scoring
- Filtering and pagination
- GitHub API response normalization
- Duplicate issue handling
- Worker retries and idempotency
- Issue closure synchronization
- Anonymous profile access control

Mock external GitHub and LLM APIs in automated tests.

Include an integration test demonstrating:

```text
GitHub API mock
    → BullMQ ingestion job
    → Worker processing
    → PostgreSQL records
    → Opportunity API
    → Personalized recommendation
```

## 14. Delivery Expectations

Do not stop at producing architecture diagrams or placeholder components.

Implement functional, connected features.

Follow this sequence:

1. Inspect the existing repository, if any, and preserve existing working functionality.
2. Set up the monorepo and development environment where necessary.
3. Design the Prisma schema and migrations.
4. Configure Redis and BullMQ.
5. Implement GitHub ingestion workers.
6. Build discovery and filtering APIs.
7. Implement PDF resume extraction and structured skill analysis.
8. Implement rule-based recommendation scoring.
9. Build and integrate frontend pages.
10. Add tests, error handling, and documentation.
11. Run available builds, linting, and tests.
12. Document any unresolved issues or environment limitations.

Provide:
- Working source code
- Database schema and migrations
- Docker Compose configuration
- `.env.example` without actual secrets
- Setup instructions
- Worker execution instructions
- GitHub API configuration instructions
- LLM provider configuration instructions
- Testing instructions
- A brief architectural overview

**Do not fabricate successful tests, completed integrations, or API responses.**

If external credentials are missing, implement the integration with environment-based configuration, use mocks for tests, and clearly document what is needed to enable live operation.

## 15. Non-Goals for MVP

Do not implement:
- GitHub OAuth login
- Mandatory user registration
- Contribution or pull-request tracking
- Maintainer portals
- Automated code modifications
- Automatic pull-request submissions
- Complex agent-based workflows
- Semantic embeddings or vector databases
- Full GitLab integration
- GSoC or Outreachy scraping pipelines unless explicitly requested later

Focus on delivering a reliable, fully working MVP with the four core product features and the required background ingestion infrastructure.

**Primary success criterion:** A developer should be able to upload a PDF resume, review their extracted skills, and discover a ranked list of relevant, actionable open-source issues. The opportunity catalog must be automatically populated and maintained by BullMQ workers using Redis and GitHub APIs.
