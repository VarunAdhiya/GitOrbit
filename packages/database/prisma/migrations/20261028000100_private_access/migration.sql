-- All access is through the trusted Express API/worker database role.
-- No browser connects to the Supabase Data API. No permissive anon policies.
ALTER TABLE "repositories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "issues" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "profile_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "issue_programs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ingestion_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_cursors" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "repositories", "issues", "skills", "user_profiles", "profile_skills", "programs", "issue_programs", "ingestion_runs", "sync_cursors" FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON TABLE "repositories", "issues", "skills", "user_profiles", "profile_skills", "programs", "issue_programs", "ingestion_runs", "sync_cursors" FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON TABLE "repositories", "issues", "skills", "user_profiles", "profile_skills", "programs", "issue_programs", "ingestion_runs", "sync_cursors" FROM authenticated;
  END IF;
END $$;
ALTER TABLE "issues" ADD CONSTRAINT "issues_state_check" CHECK (state IN ('open', 'closed', 'unavailable'));
ALTER TABLE "issues" ADD CONSTRAINT "issues_difficulty_check" CHECK (difficulty IN ('beginner', 'intermediate', 'advanced', 'unknown'));
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_confidence_check" CHECK (confidence >= 0 AND confidence <= 1);
ALTER TABLE "profile_skills" ADD CONSTRAINT "profile_skills_source_check" CHECK (source IN ('extracted', 'user'));
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_experience_check" CHECK (experience_level IN ('beginner', 'intermediate', 'advanced', 'unknown'));
CREATE INDEX "issues_fresh_open_partial_idx" ON "issues" ("updated_at_source" DESC, "id") WHERE state = 'open' AND stale = false;
