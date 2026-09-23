-- Personal boarding cards and bus door readers replace per-booking QR passes.

ALTER TYPE "CheckInResult" ADD VALUE IF NOT EXISTS 'REJECTED_NO_BOOKING';

-- One reusable boarding code per student.
ALTER TABLE "student_profiles"
  ADD COLUMN "boardingCode" VARCHAR(32),
  ADD COLUMN "boardingCodeIssuedAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "student_profiles_boardingCode_key" ON "student_profiles"("boardingCode");

-- Give every existing student a code now: "UR" + 20 hex digits (80 random bits, taken from the
-- random parts of two v4 UUIDs), the same format the application generates.
UPDATE "student_profiles"
SET "boardingCode" = 'UR' || upper(
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 12) ||
      substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)
    ),
    "boardingCodeIssuedAt" = CURRENT_TIMESTAMP
WHERE "boardingCode" IS NULL;

-- Networked barcode readers mounted at bus doors.
CREATE TABLE "door_readers" (
  "id" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "busId" UUID NOT NULL,
  "keyHash" VARCHAR(128) NOT NULL,
  "keyPrefix" VARCHAR(16) NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastSeenAt" TIMESTAMPTZ(3),
  "revokedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "door_readers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "door_readers_keyHash_key" ON "door_readers"("keyHash");
CREATE INDEX "door_readers_busId_idx" ON "door_readers"("busId");
ALTER TABLE "door_readers"
  ADD CONSTRAINT "door_readers_busId_fkey" FOREIGN KEY ("busId") REFERENCES "buses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Check-ins can now come from a door reader instead of a signed-in staff member.
ALTER TABLE "check_ins"
  ALTER COLUMN "scannedById" DROP NOT NULL,
  ADD COLUMN "doorReaderId" UUID;
CREATE INDEX "check_ins_doorReaderId_checkedInAt_idx" ON "check_ins"("doorReaderId", "checkedInAt");
ALTER TABLE "check_ins"
  ADD CONSTRAINT "check_ins_doorReaderId_fkey" FOREIGN KEY ("doorReaderId") REFERENCES "door_readers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
