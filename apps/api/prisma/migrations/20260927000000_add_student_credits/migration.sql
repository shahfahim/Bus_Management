-- Prepaid student credits replace online card payments. Students pay the university office,
-- an administrator records the top-up, and bookings and passes are paid from the balance.

ALTER TYPE "PaymentMethodType" ADD VALUE IF NOT EXISTS 'CREDITS';

CREATE TYPE "CreditTransactionType" AS ENUM ('TOP_UP', 'BOOKING_PAYMENT', 'PASS_PURCHASE', 'REFUND', 'ADJUSTMENT');

ALTER TABLE "student_profiles"
  ADD COLUMN "creditBalance" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD CONSTRAINT "student_profiles_creditBalance_nonnegative" CHECK ("creditBalance" >= 0);

CREATE TABLE "credit_transactions" (
  "id" UUID NOT NULL,
  "studentId" UUID NOT NULL,
  "type" "CreditTransactionType" NOT NULL,
  "amount" DECIMAL(12,2) NOT NULL,
  "balanceAfter" DECIMAL(12,2) NOT NULL,
  "reference" VARCHAR(64),
  "note" TEXT,
  "paymentId" UUID,
  "createdById" UUID,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "credit_transactions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_transactions_amount_nonzero" CHECK ("amount" <> 0),
  CONSTRAINT "credit_transactions_balance_nonnegative" CHECK ("balanceAfter" >= 0)
);
CREATE INDEX "credit_transactions_studentId_createdAt_idx" ON "credit_transactions"("studentId", "createdAt" DESC);
CREATE INDEX "credit_transactions_type_createdAt_idx" ON "credit_transactions"("type", "createdAt");
CREATE INDEX "credit_transactions_paymentId_idx" ON "credit_transactions"("paymentId");
-- The same university money receipt can never be credited twice.
CREATE UNIQUE INDEX "credit_transactions_top_up_reference_key"
  ON "credit_transactions"(lower("reference")) WHERE "type" = 'TOP_UP';

ALTER TABLE "credit_transactions"
  ADD CONSTRAINT "credit_transactions_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "student_profiles"("userId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "credit_transactions_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "credit_transactions_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
