ALTER TYPE "LedgerType" ADD VALUE 'DEPOSIT_REVERSED';
CREATE TYPE "EvmFundingState" AS ENUM ('CREATED','AUTHORIZED','SIGNED','BROADCAST','CONFIRMING','CONFIRMED','REJECTED','FAILED','UNKNOWN','REORGED');

CREATE TABLE "EvmNonceCursor" (
  "id" TEXT NOT NULL,
  "chainId" BIGINT NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "nextNonce" BIGINT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvmNonceCursor_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evm_nonce_cursor_nonnegative" CHECK ("nextNonce" >= 0)
);
CREATE UNIQUE INDEX "EvmNonceCursor_chainId_sourceAddress_key" ON "EvmNonceCursor"("chainId", "sourceAddress");

CREATE TABLE "EvmFundingOperation" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "payoutId" TEXT NOT NULL,
  "attemptId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "chainId" BIGINT NOT NULL,
  "sourceAssetId" TEXT NOT NULL,
  "sourceChain" TEXT NOT NULL,
  "sourceAddress" TEXT NOT NULL,
  "tokenAddress" TEXT NOT NULL,
  "tokenAmount" BIGINT NOT NULL,
  "tokenDecimals" INTEGER NOT NULL,
  "destinationAddress" TEXT NOT NULL,
  "quoteExpiresAt" TIMESTAMP(3) NOT NULL,
  "nonce" BIGINT NOT NULL,
  "gasLimit" BIGINT NOT NULL,
  "maxFeePerGas" BIGINT NOT NULL,
  "maxPriorityFeePerGas" BIGINT NOT NULL,
  "maxGasLimit" BIGINT NOT NULL,
  "maxFeePerGasCap" BIGINT NOT NULL,
  "maxPriorityFeePerGasCap" BIGINT NOT NULL,
  "maxNativeGasCost" BIGINT NOT NULL,
  "txHash" TEXT,
  "signedTxCiphertext" TEXT,
  "signedTxIv" TEXT,
  "signedTxAuthTag" TEXT,
  "state" "EvmFundingState" NOT NULL DEFAULT 'CREATED',
  "failureReason" TEXT,
  "lastObservedBlock" BIGINT,
  "lastObservedBlockHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "authorizedAt" TIMESTAMP(3),
  "signedAt" TIMESTAMP(3),
  "broadcastAt" TIMESTAMP(3),
  "confirmedAt" TIMESTAMP(3),
  "reconciledAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EvmFundingOperation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "evm_funding_amount_positive" CHECK ("tokenAmount" > 0),
  CONSTRAINT "evm_funding_fee_fields_nonnegative" CHECK ("gasLimit" > 0 AND "maxGasLimit" >= "gasLimit" AND "maxFeePerGas" >= 0 AND "maxPriorityFeePerGas" >= 0 AND "maxFeePerGasCap" >= "maxFeePerGas" AND "maxPriorityFeePerGasCap" >= "maxPriorityFeePerGas" AND "maxNativeGasCost" >= 0),
  CONSTRAINT "evm_funding_nonce_nonnegative" CHECK ("nonce" >= 0),
  CONSTRAINT "evm_funding_decimals_valid" CHECK ("tokenDecimals" BETWEEN 0 AND 30),
  CONSTRAINT "evm_funding_ciphertext_complete" CHECK (("signedTxCiphertext" IS NULL AND "signedTxIv" IS NULL AND "signedTxAuthTag" IS NULL) OR ("signedTxCiphertext" IS NOT NULL AND "signedTxIv" IS NOT NULL AND "signedTxAuthTag" IS NOT NULL))
);
CREATE UNIQUE INDEX "EvmFundingOperation_reservationId_key" ON "EvmFundingOperation"("reservationId");
CREATE UNIQUE INDEX "EvmFundingOperation_idempotencyKey_key" ON "EvmFundingOperation"("idempotencyKey");
CREATE UNIQUE INDEX "EvmFundingOperation_chainId_sourceAddress_nonce_key" ON "EvmFundingOperation"("chainId", "sourceAddress", "nonce");
CREATE INDEX "EvmFundingOperation_campaignId_state_createdAt_idx" ON "EvmFundingOperation"("campaignId", "state", "createdAt");
CREATE INDEX "EvmFundingOperation_payoutId_attemptId_idx" ON "EvmFundingOperation"("payoutId", "attemptId");
CREATE INDEX "EvmFundingOperation_txHash_idx" ON "EvmFundingOperation"("txHash");

ALTER TABLE "EvmFundingOperation" ADD CONSTRAINT "EvmFundingOperation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvmFundingOperation" ADD CONSTRAINT "EvmFundingOperation_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvmFundingOperation" ADD CONSTRAINT "EvmFundingOperation_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EvmFundingOperation" ADD CONSTRAINT "EvmFundingOperation_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
