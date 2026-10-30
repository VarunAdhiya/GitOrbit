-- AlterTable
ALTER TABLE "user_profiles" ADD COLUMN     "auth_user_id" UUID,
ALTER COLUMN "anonymous_session_id" DROP NOT NULL,
ALTER COLUMN "expires_at" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_auth_user_id_key" ON "user_profiles"("auth_user_id");

-- Each profile has exactly one owner. Guest credentials cannot access account profiles.
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_owner_check" CHECK (
  ("auth_user_id" IS NULL AND "anonymous_session_id" IS NOT NULL AND "expires_at" IS NOT NULL)
  OR
  ("auth_user_id" IS NOT NULL AND "anonymous_session_id" IS NULL AND "expires_at" IS NULL)
);
