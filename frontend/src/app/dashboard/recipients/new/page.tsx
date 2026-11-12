"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, CheckCircle2 } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import {
  DESTINATION_NETWORKS,
  PAYOUT_TOKENS_BY_NETWORK,
  findRecipientByAddress,
  findRecipientByEmail,
  isRecipientNetwork,
  validateWalletAddress,
} from "@/lib/recipient-demo-data";
import { demoCampaigns } from "@/lib/campaign-demo-data";

type RecipientDraft = {
  fullName: string;
  email: string;
  destinationNetwork: string;
  walletAddress: string;
  preferredToken: string;
  associatedCampaignIds: string[];
};

type DraftField = keyof RecipientDraft;
type DraftErrors = Partial<Record<DraftField, string>>;
type FormStep = "edit" | "review" | "confirmed";

const initialDraft: RecipientDraft = {
  fullName: "",
  email: "",
  destinationNetwork: "",
  walletAddress: "",
  preferredToken: "",
  associatedCampaignIds: [],
};
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export default function NewRecipientPage() {
  const [draft, setDraft] = useState<RecipientDraft>(initialDraft);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [step, setStep] = useState<FormStep>("edit");

  const update = (field: Exclude<DraftField, "associatedCampaignIds">, value: string) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setStep("edit");
  };

  const toggleCampaign = (campaignId: string) => {
    setDraft((current) => ({
      ...current,
      associatedCampaignIds: current.associatedCampaignIds.includes(campaignId)
        ? current.associatedCampaignIds.filter((id) => id !== campaignId)
        : [...current.associatedCampaignIds, campaignId],
    }));
    setErrors((current) => ({ ...current, associatedCampaignIds: undefined }));
  };

  const validate = (): DraftErrors => {
    const next: DraftErrors = {};
    const trimmedEmail = draft.email.trim();
    const network = isRecipientNetwork(draft.destinationNetwork)
      ? draft.destinationNetwork
      : undefined;

    if (!draft.fullName.trim()) next.fullName = "Enter the recipient's full name.";

    if (!trimmedEmail) {
      next.email = "Enter an email address.";
    } else if (!EMAIL_PATTERN.test(trimmedEmail)) {
      next.email = "Enter a valid email address, such as name@example.com.";
    } else if (findRecipientByEmail(trimmedEmail)) {
      next.email = "A demo recipient already uses this email address.";
    }

    if (!network) {
      next.destinationNetwork = "Select a supported destination network.";
      next.preferredToken = "Select a destination network before choosing a supported token.";
    } else {
      if (!PAYOUT_TOKENS_BY_NETWORK[network].includes(draft.preferredToken)) {
        next.preferredToken = `Select a supported token for ${network}.`;
      }
    }

    if (!draft.walletAddress.trim()) {
      next.walletAddress = "Enter a destination wallet/account address.";
    } else if (!network) {
      next.walletAddress = "Select a destination network before validating this address.";
    } else {
      const addressError = validateWalletAddress(network, draft.walletAddress);
      if (addressError) {
        next.walletAddress = addressError;
      } else if (findRecipientByAddress(network, draft.walletAddress)) {
        next.walletAddress = `A demo recipient already uses this address on ${network}.`;
      }
    }

    if (draft.associatedCampaignIds.length === 0) {
      next.associatedCampaignIds = "Select at least one associated campaign.";
    }

    return next;
  };

  const reviewDraft = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = validate();
    setErrors(next);

    const invalidField = (
      ["fullName", "email", "destinationNetwork", "walletAddress", "preferredToken", "associatedCampaignIds"] as const
    ).find((field) => next[field]);

    if (invalidField) {
      const fieldId = invalidField === "associatedCampaignIds"
        ? `campaign-${demoCampaigns[0].id}`
        : `recipient-${invalidField}`;
      document.getElementById(fieldId)?.focus();
      return;
    }

    setStep("review");
  };

  const confirmDemo = () => setStep("confirmed");

  const selectedCampaigns = demoCampaigns.filter((campaign) =>
    draft.associatedCampaignIds.includes(campaign.id),
  );
  const network = isRecipientNetwork(draft.destinationNetwork)
    ? draft.destinationNetwork
    : undefined;

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/recipients"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to recipients
        </Link>

        <div className="mt-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Frontend-only demo</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">
            {step === "confirmed" ? "Recipient review complete" : "Add a recipient"}
          </h1>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            Review recipient configuration without connecting a wallet or initiating a transfer.
          </p>
        </div>

        {step === "confirmed" ? (
          <section role="status" className="mt-8 rounded-2xl border border-[#dce9d5] bg-[#eff5eb] p-5 sm:p-6">
            <div className="flex items-start gap-3">
              <CheckCircle2 size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-forest" />
              <div>
                <h2 className="text-base font-medium text-ink">Demo recipient configuration reviewed</h2>
                <p className="mt-2 text-sm leading-6 text-ink/70">
                  {draft.fullName.trim()} was reviewed in this browser view. The recipient was not saved to the directory or backend. No address ownership or on-chain verification was performed, and no funds moved.
                </p>
                <div className="mt-5 flex flex-wrap gap-3">
                  <Link href="/dashboard/recipients" className="inline-flex min-h-10 items-center rounded-full bg-forest px-4 text-sm font-medium text-canvas focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest">
                    Return to recipients
                  </Link>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(initialDraft);
                      setErrors({});
                      setStep("edit");
                    }}
                    className="inline-flex min-h-10 items-center rounded-full border border-hairline bg-white px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                  >
                    Review another demo recipient
                  </button>
                </div>
              </div>
            </div>
          </section>
        ) : step === "review" ? (
          <section aria-labelledby="recipient-review-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Review before confirmation</p>
            <h2 id="recipient-review-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">
              Confirm recipient details
            </h2>
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div><dt className="text-xs text-ink/65">Full name</dt><dd className="mt-1 text-sm font-medium text-ink">{draft.fullName.trim()}</dd></div>
              <div><dt className="text-xs text-ink/65">Email address</dt><dd className="mt-1 break-all text-sm font-medium text-ink">{draft.email.trim()}</dd></div>
              <div><dt className="text-xs text-ink/65">Destination network</dt><dd className="mt-1 text-sm font-medium text-ink">{draft.destinationNetwork}</dd></div>
              <div><dt className="text-xs text-ink/65">Preferred payout token</dt><dd className="mt-1 text-sm font-medium text-ink">{draft.preferredToken}</dd></div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-xs text-ink/65">Destination wallet/account address</dt>
                <dd className="mt-1 break-all rounded-lg border border-hairline bg-canvas p-3 font-mono text-xs leading-6 text-ink">{draft.walletAddress.trim()}</dd>
                <p className="mt-2 text-xs leading-5 text-ink/65">Format validation is not ownership verification.</p>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-xs text-ink/65">Associated campaigns</dt>
                <dd className="mt-1 text-sm font-medium text-ink">
                  {selectedCampaigns.map((campaign) => `${campaign.name} (${campaign.id})`).join(", ")}
                </dd>
              </div>
            </dl>
            <p className="mt-6 rounded-xl border border-hairline bg-sand p-4 text-xs leading-5 text-ink/70">
              Confirming only displays a frontend demonstration. This profile will not be persisted and no wallet, contract, or transfer will be used.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setStep("edit")}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-hairline px-4 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
              >
                <ArrowLeft size={15} aria-hidden="true" />
                Edit details
              </button>
              <button
                type="button"
                onClick={confirmDemo}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
              >
                Confirm demo recipient
                <ArrowRight size={15} aria-hidden="true" />
              </button>
            </div>
          </section>
        ) : (
          <>
            {Object.keys(errors).length > 0 ? (
              <div role="alert" className="mt-6 rounded-xl border border-alert/30 bg-[#f2ded5] p-4 text-sm text-alert">
                Please correct the highlighted fields before reviewing the recipient.
              </div>
            ) : null}

            <form onSubmit={reviewDraft} noValidate className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="space-y-6">
                <fieldset className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
                  <legend className="px-1 text-base font-medium text-ink">Recipient information</legend>
                  <label htmlFor="recipient-fullName" className="mt-4 block text-sm font-medium text-ink">
                    Full name <span className="text-alert">*</span>
                  </label>
                  <input
                    id="recipient-fullName"
                    autoComplete="name"
                    value={draft.fullName}
                    onChange={(event) => update("fullName", event.target.value)}
                    aria-invalid={Boolean(errors.fullName)}
                    aria-describedby={errors.fullName ? "recipient-fullName-error" : undefined}
                    className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                  />
                  {errors.fullName ? <p id="recipient-fullName-error" className="mt-1.5 text-xs text-alert">{errors.fullName}</p> : null}

                  <label htmlFor="recipient-email" className="mt-5 block text-sm font-medium text-ink">
                    Email address <span className="text-alert">*</span>
                  </label>
                  <input
                    id="recipient-email"
                    type="email"
                    autoComplete="email"
                    value={draft.email}
                    onChange={(event) => update("email", event.target.value)}
                    aria-invalid={Boolean(errors.email)}
                    aria-describedby={errors.email ? "recipient-email-error" : undefined}
                    className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                  />
                  {errors.email ? <p id="recipient-email-error" className="mt-1.5 text-xs text-alert">{errors.email}</p> : null}
                </fieldset>

                <fieldset className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
                  <legend className="px-1 text-base font-medium text-ink">Destination configuration</legend>
                  <div className="mt-4 grid gap-5 sm:grid-cols-2">
                    <div>
                      <label htmlFor="recipient-destinationNetwork" className="block text-sm font-medium text-ink">
                        Destination network <span className="text-alert">*</span>
                      </label>
                      <select
                        id="recipient-destinationNetwork"
                        value={draft.destinationNetwork}
                        onChange={(event) => {
                          setDraft((current) => ({
                            ...current,
                            destinationNetwork: event.target.value,
                            preferredToken: "",
                          }));
                          setErrors((current) => ({
                            ...current,
                            destinationNetwork: undefined,
                            preferredToken: undefined,
                            walletAddress: undefined,
                          }));
                        }}
                        aria-invalid={Boolean(errors.destinationNetwork)}
                        aria-describedby={errors.destinationNetwork ? "recipient-destinationNetwork-error" : undefined}
                        className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                      >
                        <option value="">Select network</option>
                        {DESTINATION_NETWORKS.map((item) => <option key={item} value={item}>{item}</option>)}
                      </select>
                      {errors.destinationNetwork ? <p id="recipient-destinationNetwork-error" className="mt-1.5 text-xs text-alert">{errors.destinationNetwork}</p> : null}
                    </div>

                    <div>
                      <label htmlFor="recipient-preferredToken" className="block text-sm font-medium text-ink">
                        Preferred payout token <span className="text-alert">*</span>
                      </label>
                      <select
                        id="recipient-preferredToken"
                        value={draft.preferredToken}
                        onChange={(event) => update("preferredToken", event.target.value)}
                        disabled={!network}
                        aria-invalid={Boolean(errors.preferredToken)}
                        aria-describedby={errors.preferredToken ? "recipient-preferredToken-error" : "recipient-token-help"}
                        className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        <option value="">{network ? "Select token" : "Select a network first"}</option>
                        {network ? PAYOUT_TOKENS_BY_NETWORK[network].map((token) => <option key={token} value={token}>{token}</option>) : null}
                      </select>
                      {errors.preferredToken ? <p id="recipient-preferredToken-error" className="mt-1.5 text-xs text-alert">{errors.preferredToken}</p> : null}
                      <p id="recipient-token-help" className="mt-1.5 text-xs text-ink/65">Only demo-supported network/token combinations are selectable.</p>
                    </div>
                  </div>

                  <label htmlFor="recipient-walletAddress" className="mt-5 block text-sm font-medium text-ink">
                    Destination wallet/account address <span className="text-alert">*</span>
                  </label>
                  <input
                    id="recipient-walletAddress"
                    autoComplete="off"
                    spellCheck={false}
                    value={draft.walletAddress}
                    onChange={(event) => update("walletAddress", event.target.value)}
                    aria-invalid={Boolean(errors.walletAddress)}
                    aria-describedby={errors.walletAddress ? "recipient-walletAddress-error" : "recipient-address-help"}
                    placeholder={network === "NEAR" ? "name.near" : "0x…"}
                    className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 font-mono text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                  />
                  {errors.walletAddress ? (
                    <p id="recipient-walletAddress-error" className="mt-1.5 text-xs text-alert">{errors.walletAddress}</p>
                  ) : (
                    <p id="recipient-address-help" className="mt-1.5 text-xs leading-5 text-ink/65">
                      Address format is checked for the selected network. This does not verify address ownership or on-chain state.
                    </p>
                  )}
                </fieldset>

                <fieldset
                  aria-invalid={Boolean(errors.associatedCampaignIds)}
                  aria-describedby={errors.associatedCampaignIds ? "recipient-associatedCampaignIds-error" : undefined}
                  className="rounded-2xl border border-hairline bg-white p-5 sm:p-6"
                >
                  <legend className="px-1 text-base font-medium text-ink">Associated campaigns <span className="text-alert">*</span></legend>
                  <p className="mt-2 text-xs text-ink/65">Choose one or more illustrative campaigns for this recipient profile.</p>
                  <div className="mt-4 grid gap-2 sm:grid-cols-2">
                    {demoCampaigns.map((campaign) => (
                      <label key={campaign.id} htmlFor={`campaign-${campaign.id}`} className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink focus-within:ring-2 focus-within:ring-forest/30">
                        <input
                          id={`campaign-${campaign.id}`}
                          type="checkbox"
                          checked={draft.associatedCampaignIds.includes(campaign.id)}
                          onChange={() => toggleCampaign(campaign.id)}
                          aria-invalid={Boolean(errors.associatedCampaignIds)}
                          aria-describedby={errors.associatedCampaignIds ? "recipient-associatedCampaignIds-error" : undefined}
                          className="mt-0.5 size-4 accent-forest"
                        />
                        <span className="min-w-0">
                          <span className="block text-xs font-medium">{campaign.name}</span>
                          <span className="mt-0.5 block font-mono text-[10px] text-mist">{campaign.id}</span>
                        </span>
                      </label>
                    ))}
                  </div>
                  {errors.associatedCampaignIds ? <p id="recipient-associatedCampaignIds-error" className="mt-2 text-xs text-alert">{errors.associatedCampaignIds}</p> : null}
                </fieldset>
              </div>

              <aside className="h-fit rounded-2xl border border-hairline bg-sand p-5 sm:p-6">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Review</p>
                <h2 className="mt-2 text-base font-medium text-ink">Recipient summary</h2>
                <dl className="mt-5 space-y-4 text-sm">
                  <div><dt className="text-ink/65">Name</dt><dd className="mt-1 break-words font-medium text-ink">{draft.fullName.trim() || "Not set"}</dd></div>
                  <div><dt className="text-ink/65">Email</dt><dd className="mt-1 break-all font-medium text-ink">{draft.email.trim() || "Not set"}</dd></div>
                  <div><dt className="text-ink/65">Destination</dt><dd className="mt-1 font-medium text-ink">{draft.destinationNetwork || "Not selected"}{draft.preferredToken ? ` · ${draft.preferredToken}` : ""}</dd></div>
                  <div><dt className="text-ink/65">Associated campaigns</dt><dd className="mt-1 font-medium text-ink">{draft.associatedCampaignIds.length || "None selected"}</dd></div>
                </dl>
                <button
                  type="submit"
                  className="mt-6 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
                >
                  Review recipient <ArrowRight size={15} aria-hidden="true" />
                </button>
                <p className="mt-3 text-xs leading-5 text-ink/65">
                  Confirmation is a frontend-only demonstration and is not saved to this directory.
                </p>
              </aside>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
