-- These columns were added to the Prisma schema without a migration, so a database built only
-- from migrations lacked them. IF NOT EXISTS keeps this a no-op where they were already added.
ALTER TABLE "student_profiles" ADD COLUMN IF NOT EXISTS "verificationDocumentUrl" TEXT;
ALTER TABLE "trip_schedules" ADD COLUMN IF NOT EXISTS "fareAmount" INTEGER NOT NULL DEFAULT 0;
