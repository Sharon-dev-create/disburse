ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_budget_positive" CHECK ("budget" > 0);
ALTER TABLE "Campaign" ADD CONSTRAINT "campaign_decimals_valid" CHECK ("decimals" BETWEEN 0 AND 30);
ALTER TABLE "Payout" ADD CONSTRAINT "payout_promised_positive" CHECK ("promisedAmount" > 0);
ALTER TABLE "Payout" ADD CONSTRAINT "payout_exposure_nonnegative" CHECK ("activeExposure" >= 0);
ALTER TABLE "Attempt" ADD CONSTRAINT "attempt_max_input_positive" CHECK ("maxAmountIn" IS NULL OR "maxAmountIn" > 0);
ALTER TABLE "Reservation" ADD CONSTRAINT "reservation_amount_positive" CHECK ("amount" > 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_amount_nonnegative" CHECK ("amount" >= 0);
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "ledger_direction_valid" CHECK ("direction" IN ('IN','OUT'));
