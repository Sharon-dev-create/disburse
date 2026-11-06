CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT','APPROVED','REJECTED','COMPLETED');
CREATE TYPE "PayoutStatus" AS ENUM ('CREATED','QUOTED','RESERVED','COMMITTED','AWAITING_DEPOSIT','PROCESSING','SUCCESS','FAILED','EXPIRED','REFUND_PENDING','REFUNDED','UNKNOWN');
CREATE TYPE "LedgerType" AS ENUM ('BUDGET_APPROVED','RESERVED','RELEASED','DEPOSIT_OBSERVED','SETTLEMENT_CONFIRMED','REFUND_INITIATED','REFUND_CONFIRMED','FAILED','ADJUSTMENT');

CREATE TABLE "Campaign" (
  "id" TEXT PRIMARY KEY, "idempotencyKey" TEXT NOT NULL UNIQUE, "budget" BIGINT NOT NULL,
  "assetId" TEXT NOT NULL, "decimals" INTEGER NOT NULL, "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "Payout" (
  "id" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "recipientId" TEXT NOT NULL, "recipientAddress" TEXT NOT NULL,
  "promisedAmount" BIGINT NOT NULL, "outputAssetId" TEXT NOT NULL, "outputChain" TEXT NOT NULL,
  "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED', "activeExposure" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payout_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Attempt" (
  "id" TEXT PRIMARY KEY, "payoutId" TEXT NOT NULL, "attemptNo" INTEGER NOT NULL, "quoteId" TEXT UNIQUE,
  "maxAmountIn" BIGINT, "inputAssetId" TEXT, "inputChain" TEXT, "outputAmount" BIGINT, "expiresAt" TIMESTAMP(3),
  "depositAddress" TEXT, "depositMemo" TEXT, "status" "PayoutStatus" NOT NULL DEFAULT 'CREATED', "providerJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Attempt_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "PayoutEvent" (
  "id" TEXT PRIMARY KEY, "payoutId" TEXT NOT NULL, "fromStatus" "PayoutStatus", "toStatus" "PayoutStatus" NOT NULL,
  "note" TEXT NOT NULL, "providerRef" TEXT, "txHash" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayoutEvent_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "Reservation" (
  "id" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "payoutId" TEXT NOT NULL UNIQUE, "amount" BIGINT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE', "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "releasedAt" TIMESTAMP(3),
  CONSTRAINT "Reservation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "Reservation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "LedgerEntry" (
  "id" TEXT PRIMARY KEY, "campaignId" TEXT NOT NULL, "payoutId" TEXT, "type" "LedgerType" NOT NULL,
  "amount" BIGINT NOT NULL, "assetId" TEXT NOT NULL, "externalRef" TEXT UNIQUE, "reason" TEXT, "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LedgerEntry_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "LedgerEntry_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "Payout_campaignId_recipientId_key" ON "Payout"("campaignId","recipientId");
CREATE UNIQUE INDEX "Attempt_payoutId_attemptNo_key" ON "Attempt"("payoutId","attemptNo");
CREATE INDEX "LedgerEntry_campaignId_createdAt_idx" ON "LedgerEntry"("campaignId","createdAt");
