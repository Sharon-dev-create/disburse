ALTER TYPE "LedgerType" ADD VALUE 'PROVIDER_SETTLEMENT_REPORTED';
ALTER TYPE "LedgerType" ADD VALUE 'PROVIDER_REFUND_REPORTED';
ALTER TYPE "LedgerType" ADD VALUE 'RECIPIENT_OUTPUT_VERIFIED';
CREATE TYPE "RecipientOutputState" AS ENUM ('NOT_CHECKED','PENDING','VERIFIED','MISMATCH','MANUAL_REVIEW');
CREATE TYPE "PayoutWorkState" AS ENUM ('READY','LEASED','DONE','MANUAL_REVIEW');

ALTER TABLE "Payout"
  ADD COLUMN "idempotencyKey" TEXT,
  ADD COLUMN "recipientOutputState" "RecipientOutputState" NOT NULL DEFAULT 'NOT_CHECKED',
  ADD COLUMN "recipientOutputTxHash" TEXT,
  ADD COLUMN "recipientOutputBlockHash" TEXT,
  ADD COLUMN "recipientOutputVerifiedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "Payout_idempotencyKey_key" ON "Payout"("idempotencyKey");

ALTER TABLE "EvmFundingOperation" ADD COLUMN "quoteId" TEXT;
ALTER TABLE "EvmFundingOperation" ADD COLUMN "destinationMemo" TEXT;
UPDATE "EvmFundingOperation" o SET "quoteId"=a."quoteId" FROM "Attempt" a WHERE a."id"=o."attemptId" AND o."quoteId" IS NULL;
UPDATE "EvmFundingOperation" SET "quoteId"='legacy:' || "id" WHERE "quoteId" IS NULL;
ALTER TABLE "EvmFundingOperation" ALTER COLUMN "quoteId" SET NOT NULL;

CREATE TABLE "PayoutWorkItem" (
  "id" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "kind" TEXT NOT NULL DEFAULT 'SINGLE_PAYOUT',
  "payload" JSONB NOT NULL,
  "state" "PayoutWorkState" NOT NULL DEFAULT 'READY',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 12,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseUntil" TIMESTAMP(3),
  "lockToken" TEXT,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayoutWorkItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payout_work_attempts_valid" CHECK ("attempts" >= 0 AND "maxAttempts" > 0)
);
CREATE UNIQUE INDEX "PayoutWorkItem_payoutId_kind_key" ON "PayoutWorkItem"("payoutId","kind");
CREATE INDEX "PayoutWorkItem_state_availableAt_idx" ON "PayoutWorkItem"("state","availableAt");
CREATE INDEX "PayoutWorkItem_leaseUntil_idx" ON "PayoutWorkItem"("leaseUntil");
ALTER TABLE "PayoutWorkItem" ADD CONSTRAINT "PayoutWorkItem_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
