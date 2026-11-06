ALTER TABLE "Reservation" ADD COLUMN "remainingAmount" BIGINT NOT NULL DEFAULT 0;
UPDATE "Reservation" SET "remainingAmount" = CASE WHEN "status" = 'ACTIVE' THEN "amount" ELSE 0 END;

ALTER TABLE "Attempt" ADD COLUMN "providerStatus" TEXT;
ALTER TABLE "Attempt" ADD COLUMN "providerStatusUpdatedAt" TIMESTAMP(3);
ALTER TABLE "Attempt" ADD COLUMN "providerDepositedAmount" BIGINT;

ALTER TABLE "LedgerEntry" ADD COLUMN "attemptId" TEXT;

UPDATE "LedgerEntry" l SET "attemptId" = r."attemptId"
FROM "Reservation" r
WHERE l."attemptId" IS NULL
  AND r."attemptId" IS NOT NULL
  AND l."externalRef" IN ('reserve:' || r."id", 'release:' || r."id");

UPDATE "LedgerEntry" l SET "attemptId" = a."id"
FROM "Attempt" a
JOIN "Payout" p ON p."id" = a."payoutId"
WHERE l."attemptId" IS NULL
  AND l."payoutId" = p."id"
  AND a."quoteId" IS NOT NULL
  AND l."externalRef" LIKE 'provider:' || a."quoteId" || ':%';

ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_attemptId_fkey"
  FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "LedgerEntry_campaignId_attemptId_type_idx" ON "LedgerEntry"("campaignId", "attemptId", "type");
CREATE INDEX "Reservation_campaignId_status_idx" ON "Reservation"("campaignId", "status");
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_remaining_range" CHECK ("remainingAmount" >= 0 AND "remainingAmount" <= "amount");
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_status_valid" CHECK ("status" IN ('ACTIVE', 'RELEASED'));
ALTER TABLE "Attempt" ADD CONSTRAINT "attempt_provider_deposit_nonnegative" CHECK ("providerDepositedAmount" IS NULL OR "providerDepositedAmount" >= 0);
