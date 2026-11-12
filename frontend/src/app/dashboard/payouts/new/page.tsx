"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CircleAlert,
  Search,
} from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CampaignStatusBadge from "@/components/dashboard/CampaignStatusBadge";
import { PayoutReadinessBadge, RecipientStatusBadge } from "@/components/dashboard/RecipientStatusBadge";
import {
  demoCampaigns,
  formatUsd,
  getDemoCampaign,
  type Campaign,
} from "@/lib/campaign-demo-data";
import {
  formatTokenAmount,
  parseTokenAmount,
  wholeTokensToBaseUnits,
} from "@/lib/payout-demo-data";
import {
  demoRecipients,
  isRecipientPayoutReady,
  isRecipientNetwork,
  PAYOUT_TOKENS_BY_NETWORK,
  validateWalletAddress,
  type Recipient,
} from "@/lib/recipient-demo-data";

type WorkflowStep = 1 | 2 | 3 | 4 | 5;
type AmountErrors = {
  inputAmount?: string;
  expectedOutputAmount?: string;
};

const ACTIVE_CAMPAIGNS = demoCampaigns.filter((campaign) => campaign.status === "Active");
const DEMO_TOKEN_DECIMALS = 6;

const stepLabels = [
  "Campaign",
  "Recipient",
  "Configure",
  "Review",
  "Availability",
] as const;

function isDemoRecipientReady(recipient: Recipient): boolean {
  if (!isRecipientPayoutReady(recipient) || !isRecipientNetwork(recipient.destinationNetwork)) return false;
  return (
    PAYOUT_TOKENS_BY_NETWORK[recipient.destinationNetwork].includes(recipient.preferredToken) &&
    !validateWalletAddress(recipient.destinationNetwork, recipient.walletAddress)
  );
}

function getRemainingBudget(campaign: Campaign): bigint {
  const approved = wholeTokensToBaseUnits(campaign.accounting.approvedBudget, DEMO_TOKEN_DECIMALS);
  const reserved = wholeTokensToBaseUnits(campaign.accounting.reserved, DEMO_TOKEN_DECIMALS);
  const settled = wholeTokensToBaseUnits(campaign.accounting.settled, DEMO_TOKEN_DECIMALS);
  const committed = reserved + settled;
  return approved > committed ? approved - committed : BigInt(0);
}

export default function NewPayoutPage() {
  const [step, setStep] = useState<WorkflowStep>(1);
  const [campaignId, setCampaignId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [recipientSearch, setRecipientSearch] = useState("");
  const [inputAmount, setInputAmount] = useState("");
  const [expectedOutputAmount, setExpectedOutputAmount] = useState("");
  const [errors, setErrors] = useState<AmountErrors>({});

  const campaign = getDemoCampaign(campaignId);
  const selectedRecipient = demoRecipients.find((recipient) => recipient.id === recipientId);

  const recipientOptions = useMemo(() => {
    if (!campaign) return [];
    const normalizedQuery = recipientSearch.trim().toLowerCase();
    return demoRecipients.filter((recipient) => {
      const matchesCampaign = recipient.associatedCampaignIds.includes(campaign.id);
      const matchesReadiness = isDemoRecipientReady(recipient);
      const matchesSearch =
        !normalizedQuery ||
        recipient.fullName.toLowerCase().includes(normalizedQuery) ||
        recipient.email.toLowerCase().includes(normalizedQuery);
      return matchesCampaign && matchesReadiness && matchesSearch;
    });
  }, [campaign, recipientSearch]);

  const inputBaseUnits = parseTokenAmount(inputAmount, DEMO_TOKEN_DECIMALS);
  const expectedBaseUnits = parseTokenAmount(expectedOutputAmount, DEMO_TOKEN_DECIMALS);
  const availableBaseUnits = campaign
    ? wholeTokensToBaseUnits(campaign.accounting.available, DEMO_TOKEN_DECIMALS)
    : BigInt(0);
  const remainingBudget = campaign ? getRemainingBudget(campaign) : BigInt(0);
  const remainingAvailable = inputBaseUnits !== null && inputBaseUnits <= availableBaseUnits
    ? availableBaseUnits - inputBaseUnits
    : availableBaseUnits;
  const remainingBudgetAfterReservation = inputBaseUnits !== null && inputBaseUnits <= remainingBudget
    ? remainingBudget - inputBaseUnits
    : remainingBudget;

  const chooseCampaign = (id: string) => {
    setCampaignId(id);
    setRecipientId("");
    setInputAmount("");
    setExpectedOutputAmount("");
    setErrors({});
  };

  const reviewAmounts = () => {
    const next: AmountErrors = {};
    if (inputBaseUnits === null || inputBaseUnits <= BigInt(0)) {
      next.inputAmount = "Enter a positive amount with no more than six decimal places.";
    } else if (inputBaseUnits > availableBaseUnits) {
      next.inputAmount = "The proposed reservation exceeds this campaign's available balance.";
    } else if (inputBaseUnits > remainingBudget) {
      next.inputAmount = "The proposed reservation exceeds the remaining approved-budget ceiling.";
    }

    if (expectedBaseUnits === null || expectedBaseUnits <= BigInt(0)) {
      next.expectedOutputAmount = "Enter a positive illustrative output estimate with no more than six decimal places.";
    }

    setErrors(next);
    if (Object.keys(next).length > 0) {
      const firstInvalidField = next.inputAmount ? "payout-input-amount" : "payout-expected-output";
      document.getElementById(firstInvalidField)?.focus();
      return;
    }
    setStep(4);
  };

  const selectedRecipientIsReady = selectedRecipient ? isDemoRecipientReady(selectedRecipient) : false;
  const selectedRecipientMatchesCampaign = Boolean(
    campaign && selectedRecipient?.associatedCampaignIds.includes(campaign.id),
  );

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-5xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/payouts"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to payouts
        </Link>

        <div className="mt-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Frontend-only preview</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Create payout</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
            Review an illustrative payout proposal. No draft, reservation, authorization, quote, or transaction can be created here.
          </p>
        </div>

        <ol aria-label="Payout setup steps" className="mt-7 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {stepLabels.map((label, index) => {
            const number = (index + 1) as WorkflowStep;
            const current = number === step;
            const complete = number < step;
            return (
              <li
                key={label}
                aria-current={current ? "step" : undefined}
                className={`rounded-lg border px-3 py-2 text-xs ${
                  current ? "border-forest bg-forest text-canvas" : complete ? "border-[#dce9d5] bg-[#eff5eb] text-forest" : "border-hairline bg-white text-ink/65"
                }`}
              >
                <span className="font-mono">{number}.</span> {label}
              </li>
            );
          })}
        </ol>

        <p className="mt-5 rounded-xl border border-[#e7c7b9] bg-[#f7ebe5] px-4 py-3 text-xs leading-5 text-ink">
          <span className="font-medium text-alert">Live submission unavailable.</span>{" "}
          Contract reservation calls are not connected to this frontend. The execution library has no live enabled routes, API, signer, or transaction-status service.
        </p>

        {step === 1 ? (
          <section aria-labelledby="campaign-step-heading" className="mt-6 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Step 1 of 5</p>
            <h2 id="campaign-step-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Select an active campaign</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              Only active demo campaigns are selectable. Approved budget is a ceiling; funded and available balances are separate figures.
            </p>
            <ul className="mt-5 space-y-3">
              {ACTIVE_CAMPAIGNS.map((item) => (
                <li key={item.id}>
                  <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${campaignId === item.id ? "border-forest bg-[#eff5eb]" : "border-hairline hover:bg-canvas"}`}>
                    <span className="flex items-start gap-3">
                      <input
                        type="radio"
                        name="payout-campaign"
                        checked={campaignId === item.id}
                        onChange={() => chooseCampaign(item.id)}
                        className="mt-1 accent-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-medium text-ink">{item.name}</span>
                          <CampaignStatusBadge status={item.status} />
                        </span>
                        <span className="mt-1 block font-mono text-[10px] text-mist">{item.id} · {item.sourceNetwork} · {item.acceptedToken}</span>
                        <span className="mt-4 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3">
                          <span><span className="block text-ink/65">Approved budget</span><span className="mt-1 block font-mono text-ink">{formatUsd(item.accounting.approvedBudget)}</span></span>
                          <span><span className="block text-ink/65">Funded</span><span className="mt-1 block font-mono text-ink">{formatUsd(item.accounting.funded)}</span></span>
                          <span><span className="block text-ink/65">Available</span><span className="mt-1 block font-mono text-ink">{formatUsd(item.accounting.available)}</span></span>
                          <span><span className="block text-ink/65">Reserved</span><span className="mt-1 block font-mono text-ink">{formatUsd(item.accounting.reserved)}</span></span>
                          <span><span className="block text-ink/65">Settled</span><span className="mt-1 block font-mono text-ink">{formatUsd(item.accounting.settled)}</span></span>
                        </span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                disabled={!campaignId || campaign?.status !== "Active"}
                onClick={() => setStep(2)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-5 text-sm font-medium text-canvas disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
              >
                Select recipient <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : null}

        {step === 2 ? (
          <section aria-labelledby="recipient-step-heading" className="mt-6 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Step 2 of 5</p>
            <h2 id="recipient-step-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Select a payout-ready recipient</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              Only active recipients associated with {campaign?.name ?? "the selected campaign"} and passing local format checks are shown. Address ownership is not verified.
            </p>
            <div className="relative mt-5">
              <label htmlFor="payout-recipient-search" className="sr-only">Search recipients by name or email</label>
              <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
              <input
                id="payout-recipient-search"
                type="search"
                value={recipientSearch}
                onChange={(event) => setRecipientSearch(event.target.value)}
                placeholder="Search recipients"
                className="min-h-11 w-full rounded-lg border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
              />
            </div>
            {recipientOptions.length === 0 ? (
              <p className="mt-5 rounded-lg bg-sand p-4 text-sm leading-6 text-ink/70">
                No ready demo recipients are associated with this campaign and search.
              </p>
            ) : (
              <ul className="mt-4 space-y-3">
                {recipientOptions.map((recipient) => (
                  <li key={recipient.id}>
                    <label className={`block cursor-pointer rounded-xl border p-4 transition-colors ${recipientId === recipient.id ? "border-forest bg-[#eff5eb]" : "border-hairline hover:bg-canvas"}`}>
                      <span className="flex items-start gap-3">
                        <input
                          type="radio"
                          name="payout-recipient"
                          checked={recipientId === recipient.id}
                          onChange={() => setRecipientId(recipient.id)}
                          className="mt-1 accent-forest focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-ink">{recipient.fullName}</span>
                            <RecipientStatusBadge status={recipient.status} />
                            <PayoutReadinessBadge status={recipient.payoutReadiness} />
                          </span>
                          <span className="mt-1 block text-xs text-ink/65">{recipient.email} · {recipient.id}</span>
                          <span className="mt-3 block break-all font-mono text-xs text-ink">{recipient.walletAddress}</span>
                          <span className="mt-2 block text-xs text-ink/65">{recipient.destinationNetwork} · {recipient.preferredToken}</span>
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => setStep(1)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <ArrowLeft size={15} aria-hidden="true" /> Back
              </button>
              <button
                type="button"
                disabled={!selectedRecipient || !selectedRecipientIsReady || !selectedRecipientMatchesCampaign}
                onClick={() => setStep(3)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-5 text-sm font-medium text-canvas disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
              >
                Configure preview <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : null}

        {step === 3 && campaign && selectedRecipient ? (
          <section aria-labelledby="configure-step-heading" className="mt-6 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Step 3 of 5</p>
            <h2 id="configure-step-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Configure preview amounts</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              Source asset comes from the campaign. Destination details come from the selected recipient. No provider quote or supported live route is available.
            </p>
            <div className="mt-5 rounded-xl border border-[#e7c7b9] bg-[#f7ebe5] p-4 text-sm leading-6 text-ink">
              <div className="flex items-start gap-3">
                <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-alert" />
                <p><span className="font-medium text-alert">Preview only.</span> The execution service marks every network as disabled, has no configured asset routes, and only supports dry quotes. The estimate below is not a quote and cannot be submitted.</p>
              </div>
            </div>

            {Object.keys(errors).length > 0 ? (
              <p role="alert" className="mt-4 rounded-lg border border-alert/30 bg-[#f2ded5] p-3 text-sm text-alert">
                Please correct the amount fields before reviewing the preview.
              </p>
            ) : null}

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-hairline bg-canvas p-4">
                <p className="text-xs text-ink/65">Source asset</p>
                <p className="mt-2 text-sm font-medium text-ink">{campaign.sourceNetwork} · {campaign.acceptedToken}</p>
              </div>
              <div className="rounded-xl border border-hairline bg-canvas p-4">
                <p className="text-xs text-ink/65">Recipient destination</p>
                <p className="mt-2 break-all text-sm font-medium text-ink">{selectedRecipient.destinationNetwork} · {selectedRecipient.preferredToken}</p>
              </div>
              <div>
                <label htmlFor="payout-input-amount" className="block text-sm font-medium text-ink">Source input amount ({campaign.acceptedToken})</label>
                <input
                  id="payout-input-amount"
                  type="text"
                  inputMode="decimal"
                  value={inputAmount}
                  onChange={(event) => {
                    setInputAmount(event.target.value);
                    setErrors((current) => ({ ...current, inputAmount: undefined }));
                  }}
                  aria-invalid={Boolean(errors.inputAmount)}
                  aria-describedby={errors.inputAmount ? "payout-input-error" : "payout-input-help"}
                  placeholder="0.00"
                  className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-white px-3 font-mono text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                />
                {errors.inputAmount ? <p id="payout-input-error" className="mt-1.5 text-xs text-alert">{errors.inputAmount}</p> : <p id="payout-input-help" className="mt-1.5 text-xs text-ink/65">Demo precision: up to six decimal places.</p>}
              </div>
              <div>
                <label htmlFor="payout-expected-output" className="block text-sm font-medium text-ink">Expected output estimate ({selectedRecipient.preferredToken})</label>
                <input
                  id="payout-expected-output"
                  type="text"
                  inputMode="decimal"
                  value={expectedOutputAmount}
                  onChange={(event) => {
                    setExpectedOutputAmount(event.target.value);
                    setErrors((current) => ({ ...current, expectedOutputAmount: undefined }));
                  }}
                  aria-invalid={Boolean(errors.expectedOutputAmount)}
                  aria-describedby={errors.expectedOutputAmount ? "payout-output-error" : "payout-output-help"}
                  placeholder="0.00"
                  className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-white px-3 font-mono text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                />
                {errors.expectedOutputAmount ? <p id="payout-output-error" className="mt-1.5 text-xs text-alert">{errors.expectedOutputAmount}</p> : <p id="payout-output-help" className="mt-1.5 text-xs text-ink/65">Manually entered preview value; no quote is attached.</p>}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => setStep(2)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <ArrowLeft size={15} aria-hidden="true" /> Back
              </button>
              <button type="button" onClick={reviewAmounts} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-5 text-sm font-medium text-canvas focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest">
                Review proposal <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : null}

        {step === 4 && campaign && selectedRecipient && inputBaseUnits !== null && expectedBaseUnits !== null ? (
          <section aria-labelledby="review-step-heading" className="mt-6 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Step 4 of 5</p>
            <h2 id="review-step-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Review budget and destination</h2>
            <p className="mt-2 text-sm leading-6 text-ink/65">
              These calculations use illustrative frontend campaign data and exact integer base units. They are not an authoritative balance check.
            </p>

            <section aria-labelledby="review-campaign-balance-heading" className="mt-5 rounded-xl border border-hairline bg-canvas p-4">
              <h3 id="review-campaign-balance-heading" className="text-sm font-medium text-ink">{campaign.name} · {campaign.id}</h3>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 text-xs sm:grid-cols-3">
                <div><dt className="text-ink/65">Approved budget</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(wholeTokensToBaseUnits(campaign.accounting.approvedBudget, DEMO_TOKEN_DECIMALS))} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Funded balance</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(wholeTokensToBaseUnits(campaign.accounting.funded, DEMO_TOKEN_DECIMALS))} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Current available</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(availableBaseUnits)} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Existing reserved</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(wholeTokensToBaseUnits(campaign.accounting.reserved, DEMO_TOKEN_DECIMALS))} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Proposed reservation</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(inputBaseUnits)} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Available after proposal</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(remainingAvailable)} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Budget headroom after proposal</dt><dd className="mt-1 font-mono font-medium text-ink">{formatTokenAmount(remainingBudgetAfterReservation)} {campaign.acceptedToken}</dd></div>
              </dl>
            </section>

            <section aria-labelledby="review-recipient-heading" className="mt-4 rounded-xl border border-hairline bg-white p-4">
              <h3 id="review-recipient-heading" className="text-sm font-medium text-ink">Recipient destination</h3>
              <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                <div><dt className="text-ink/65">Recipient</dt><dd className="mt-1 font-medium text-ink">{selectedRecipient.fullName} · {selectedRecipient.id}</dd></div>
                <div><dt className="text-ink/65">Destination</dt><dd className="mt-1 font-medium text-ink">{selectedRecipient.destinationNetwork} · {selectedRecipient.preferredToken}</dd></div>
                <div className="sm:col-span-2"><dt className="text-ink/65">Wallet/account address</dt><dd className="mt-1 break-all font-mono text-ink">{selectedRecipient.walletAddress}</dd><dd className="mt-1 text-ink/65">Format only; ownership is not verified.</dd></div>
                <div><dt className="text-ink/65">Source</dt><dd className="mt-1 font-medium text-ink">{campaign.sourceNetwork} · {campaign.acceptedToken} · {formatTokenAmount(inputBaseUnits)} {campaign.acceptedToken}</dd></div>
                <div><dt className="text-ink/65">Expected output estimate</dt><dd className="mt-1 font-medium text-ink">{formatTokenAmount(expectedBaseUnits)} {selectedRecipient.preferredToken} · not quoted</dd></div>
              </dl>
            </section>

            <p className="mt-4 rounded-xl border border-[#e7c7b9] bg-[#f7ebe5] p-4 text-sm leading-6 text-ink">
              <span className="font-medium text-alert">No live route is enabled.</span> Budget checks here are illustrative only; they cannot reserve funds or enforce the contract’s concurrent-spend protections. No idempotency key will be issued because no backend request can be sent.
            </p>

            <div className="mt-6 flex flex-wrap justify-between gap-3">
              <button type="button" onClick={() => setStep(3)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <ArrowLeft size={15} aria-hidden="true" /> Edit proposal
              </button>
              <button type="button" onClick={() => setStep(5)} className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-5 text-sm font-medium text-canvas focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest">
                Continue to availability <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : null}

        {step === 5 ? (
          <section role="status" aria-labelledby="availability-heading" className="mt-6 rounded-2xl border border-[#e7c7b9] bg-[#f7ebe5] p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-alert">Step 5 of 5 · unavailable</p>
            <h2 id="availability-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Payout submission is not available</h2>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              This review stayed in the browser. No payout draft or contract reservation was created; no execution authorization, external transaction, refund, or settlement was requested or recorded.
            </p>
            <p className="mt-3 text-sm leading-6 text-ink/70">
              A live workflow requires an authenticated contract writer, an enabled and configured exact-output route, a server API with idempotency enforcement, transaction submission/status handling, and independent destination verification. Those integrations are not available in this repository.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button type="button" onClick={() => setStep(4)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline bg-white px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <ArrowLeft size={15} aria-hidden="true" /> Back to review
              </button>
              <Link href="/dashboard/payouts" className="inline-flex min-h-11 items-center rounded-full bg-forest px-4 text-sm font-medium text-canvas focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest">
                Return to payouts
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </main>
  );
}
