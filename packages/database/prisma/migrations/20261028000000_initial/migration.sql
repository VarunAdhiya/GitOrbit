-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "repositories" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github',
    "external_id" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "source_url" TEXT NOT NULL,
    "primary_language" TEXT,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stars" INTEGER NOT NULL DEFAULT 0,
    "forks" INTEGER NOT NULL DEFAULT 0,
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "contribution_url" TEXT,
    "created_at_source" TIMESTAMPTZ(3) NOT NULL,
    "last_pushed_at" TIMESTAMPTZ(3),
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issues" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github',
    "external_id" TEXT NOT NULL,
    "repository_id" UUID NOT NULL,
    "issue_number" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "source_url" TEXT NOT NULL,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "state" TEXT NOT NULL DEFAULT 'open',
    "assigned" BOOLEAN NOT NULL DEFAULT false,
    "in_progress" BOOLEAN NOT NULL DEFAULT false,
    "difficulty" TEXT NOT NULL DEFAULT 'unknown',
    "difficulty_evidence" TEXT NOT NULL DEFAULT '',
    "relevant_skills" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at_source" TIMESTAMPTZ(3) NOT NULL,
    "updated_at_source" TIMESTAMPTZ(3) NOT NULL,
    "last_synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stale" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "issues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "skills" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "normalized_name" TEXT NOT NULL,

    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "anonymous_session_id" TEXT NOT NULL,
    "experience_level" TEXT NOT NULL DEFAULT 'unknown',
    "experience_inferred" BOOLEAN NOT NULL DEFAULT true,
    "experience_summary" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferred_languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "desired_difficulty" TEXT NOT NULL DEFAULT 'any',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "profile_skills" (
    "profile_id" UUID NOT NULL,
    "skill_id" UUID NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "profile_skills_pkey" PRIMARY KEY ("profile_id","skill_id")
);

-- CreateTable
CREATE TABLE "programs" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "source_url" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "verified_at" TIMESTAMPTZ(3),

    CONSTRAINT "programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_programs" (
    "issue_id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "evidence_url" TEXT NOT NULL,

    CONSTRAINT "issue_programs_pkey" PRIMARY KEY ("issue_id","program_id")
);

-- CreateTable
CREATE TABLE "ingestion_runs" (
    "id" UUID NOT NULL,
    "job_id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'github',
    "status" TEXT NOT NULL,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "error_summary" TEXT,

    CONSTRAINT "ingestion_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_cursors" (
    "key" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "sync_cursors_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "repositories_archived_last_pushed_at_idx" ON "repositories"("archived", "last_pushed_at");

-- CreateIndex
CREATE INDEX "repositories_last_synced_at_id_idx" ON "repositories"("last_synced_at", "id");

-- CreateIndex
CREATE INDEX "repositories_primary_language_idx" ON "repositories"("primary_language");

-- CreateIndex
CREATE INDEX "repositories_topics_idx" ON "repositories" USING GIN ("topics");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_source_external_id_key" ON "repositories"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_source_owner_name_key" ON "repositories"("source", "owner", "name");

-- CreateIndex
CREATE INDEX "issues_state_stale_updated_at_source_id_idx" ON "issues"("state", "stale", "updated_at_source", "id");

-- CreateIndex
CREATE INDEX "issues_state_stale_created_at_source_id_idx" ON "issues"("state", "stale", "created_at_source", "id");

-- CreateIndex
CREATE INDEX "issues_state_last_synced_at_id_idx" ON "issues"("state", "last_synced_at", "id");

-- CreateIndex
CREATE INDEX "issues_difficulty_idx" ON "issues"("difficulty");

-- CreateIndex
CREATE INDEX "issues_labels_idx" ON "issues" USING GIN ("labels");

-- CreateIndex
CREATE INDEX "issues_relevant_skills_idx" ON "issues" USING GIN ("relevant_skills");

-- CreateIndex
CREATE UNIQUE INDEX "issues_source_external_id_key" ON "issues"("source", "external_id");

-- CreateIndex
CREATE UNIQUE INDEX "issues_repository_id_issue_number_key" ON "issues"("repository_id", "issue_number");

-- CreateIndex
CREATE UNIQUE INDEX "skills_normalized_name_key" ON "skills"("normalized_name");

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_anonymous_session_id_key" ON "user_profiles"("anonymous_session_id");

-- CreateIndex
CREATE INDEX "user_profiles_expires_at_idx" ON "user_profiles"("expires_at");

-- CreateIndex
CREATE INDEX "profile_skills_skill_id_idx" ON "profile_skills"("skill_id");

-- CreateIndex
CREATE UNIQUE INDEX "programs_name_key" ON "programs"("name");

-- CreateIndex
CREATE INDEX "issue_programs_program_id_idx" ON "issue_programs"("program_id");

-- CreateIndex
CREATE INDEX "ingestion_runs_started_at_idx" ON "ingestion_runs"("started_at");

-- CreateIndex
CREATE INDEX "ingestion_runs_job_type_status_finished_at_idx" ON "ingestion_runs"("job_type", "status", "finished_at");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_repository_id_fkey" FOREIGN KEY ("repository_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "user_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_skill_id_fkey" FOREIGN KEY ("skill_id") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_programs" ADD CONSTRAINT "issue_programs_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_programs" ADD CONSTRAINT "issue_programs_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
