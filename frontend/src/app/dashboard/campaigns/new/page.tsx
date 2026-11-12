"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2 } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { formatUsd } from "@/lib/campaign-demo-data";

type FormState = {
  name: string;
  description: string;
  network: string;
  token: string;
  budget: string;
};

type FormErrors = Partial<Record<keyof FormState, string>>;
const initialForm: FormState = { name: "", description: "", network: "", token: "", budget: "" };
const amountPattern = /^\d*(\.\d{0,2})?$/;

export default function NewCampaignPage() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const update = (key: keyof FormState, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
    setSubmitted(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next: FormErrors = {};
    const budget = Number(form.budget);

    if (!form.name.trim()) next.name = "Enter a campaign name.";
    if (!form.budget || !Number.isFinite(budget) || budget <= 0) {
      next.budget = "Enter a positive budget amount with no more than two decimal places.";
    }
    if (!form.network) next.network = "Select a source network.";
    if (!form.token) next.token = "Select an accepted token.";

    setErrors(next);
    if (Object.keys(next).length > 0) {
      setSubmitted(false);
      const firstInvalidField = (["name", "network", "token", "budget"] as const)
        .find((field) => next[field]);
      if (firstInvalidField) {
        const fieldId = {
          name: "campaign-name",
          network: "campaign-network",
          token: "campaign-token",
          budget: "campaign-budget",
        }[firstInvalidField];
        document.getElementById(fieldId)?.focus();
      }
      return;
    }

    setSubmitted(true);
  };

  const parsedBudget = Number(form.budget);
  const reviewBudget = Number.isFinite(parsedBudget) && parsedBudget > 0
    ? formatUsd(parsedBudget)
    : "Not set";

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-4xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/campaigns"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to campaigns
        </Link>

        <div className="mt-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Frontend-only demo</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Create a campaign</h1>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            Preview a campaign configuration without creating a contract record, approving a budget, or moving funds.
          </p>
        </div>

        {submitted ? (
          <div role="status" className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] p-4 text-sm leading-6 text-forest">
            <CheckCircle2 className="mr-2 inline size-4" aria-hidden="true" />
            <strong>Demo configuration reviewed.</strong> This campaign exists only in this browser view. Nothing was created on-chain, no funds moved, and no data was sent to a backend.
          </div>
        ) : null}

        {Object.keys(errors).length > 0 ? (
          <div role="alert" className="mt-6 rounded-xl border border-alert/30 bg-[#f2ded5] p-4 text-sm text-alert">
            Please correct the highlighted campaign fields before reviewing the demo configuration.
          </div>
        ) : null}

        <form onSubmit={submit} noValidate className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="space-y-6">
            <fieldset className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
              <legend className="px-1 text-base font-medium text-ink">Campaign information</legend>
              <label className="mt-4 block text-sm font-medium text-ink" htmlFor="campaign-name">
                Campaign name <span className="text-alert">*</span>
              </label>
              <input
                id="campaign-name"
                required
                value={form.name}
                onChange={(event) => update("name", event.target.value)}
                aria-invalid={Boolean(errors.name)}
                aria-describedby={errors.name ? "campaign-name-error" : undefined}
                className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
              />
              {errors.name ? <p id="campaign-name-error" className="mt-1.5 text-xs text-alert">{errors.name}</p> : null}

              <label className="mt-5 block text-sm font-medium text-ink" htmlFor="campaign-description">
                Description <span className="font-normal text-ink/65">(optional)</span>
              </label>
              <textarea
                id="campaign-description"
                rows={4}
                value={form.description}
                onChange={(event) => update("description", event.target.value)}
                className="mt-2 w-full rounded-lg border border-hairline bg-canvas px-3 py-2.5 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
              />
            </fieldset>

            <fieldset className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
              <legend className="px-1 text-base font-medium text-ink">Funding configuration</legend>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-ink" htmlFor="campaign-network">
                    Source network <span className="text-alert">*</span>
                  </label>
                  <select
                    id="campaign-network"
                    required
                    value={form.network}
                    onChange={(event) => update("network", event.target.value)}
                    aria-invalid={Boolean(errors.network)}
                    aria-describedby={errors.network ? "campaign-network-error" : undefined}
                    className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                  >
                    <option value="">Select network</option>
                    <option value="NEAR">NEAR</option>
                  </select>
                  {errors.network ? <p id="campaign-network-error" className="mt-1.5 text-xs text-alert">{errors.network}</p> : null}
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink" htmlFor="campaign-token">
                    Accepted token <span className="text-alert">*</span>
                  </label>
                  <select
                    id="campaign-token"
                    required
                    value={form.token}
                    onChange={(event) => update("token", event.target.value)}
                    aria-invalid={Boolean(errors.token)}
                    aria-describedby={errors.token ? "campaign-token-error" : undefined}
                    className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                  >
                    <option value="">Select token</option>
                    <option value="USDC">USDC</option>
                  </select>
                  {errors.token ? <p id="campaign-token-error" className="mt-1.5 text-xs text-alert">{errors.token}</p> : null}
                </div>
              </div>

              <label className="mt-5 block text-sm font-medium text-ink" htmlFor="campaign-budget">
                Approved budget <span className="text-alert">*</span>
              </label>
              <input
                id="campaign-budget"
                type="text"
                inputMode="decimal"
                pattern="[0-9]+([.][0-9]{1,2})?"
                maxLength={15}
                required
                value={form.budget}
                onChange={(event) => {
                  const { value } = event.target;
                  if (amountPattern.test(value)) update("budget", value);
                }}
                aria-invalid={Boolean(errors.budget)}
                aria-describedby={errors.budget ? "campaign-budget-error" : "campaign-budget-help"}
                placeholder="0.00"
                className="mt-2 min-h-11 w-full rounded-lg border border-hairline bg-canvas px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
              />
              {errors.budget ? (
                <p id="campaign-budget-error" className="mt-1.5 text-xs text-alert">{errors.budget}</p>
              ) : (
                <p id="campaign-budget-help" className="mt-1.5 text-xs text-ink/65">
                  A demo spending ceiling. It is not a funded balance.
                </p>
              )}
            </fieldset>
          </div>

          <aside className="h-fit rounded-2xl border border-hairline bg-sand p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Review</p>
            <h2 className="mt-2 text-base font-medium text-ink">Demo configuration</h2>
            <dl className="mt-5 space-y-4 text-sm">
              <div>
                <dt className="text-ink/65">Name</dt>
                <dd className="mt-1 font-medium text-ink">{form.name.trim() || "Not set"}</dd>
              </div>
              <div>
                <dt className="text-ink/65">Description</dt>
                <dd className="mt-1 font-medium text-ink">{form.description.trim() || "Not provided"}</dd>
              </div>
              <div>
                <dt className="text-ink/65">Source</dt>
                <dd className="mt-1 font-medium text-ink">
                  {form.network || "Not selected"}{form.token ? ` · ${form.token}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-ink/65">Approved budget</dt>
                <dd className="mt-1 font-mono font-medium text-ink">{reviewBudget}</dd>
              </div>
            </dl>
            <button
              type="submit"
              className="mt-6 min-h-11 w-full rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
            >
              Create demo campaign
            </button>
            <p className="mt-3 text-xs leading-5 text-ink/65">
              Submission only confirms this frontend demonstration. It does not persist data or create a blockchain campaign.
            </p>
          </aside>
        </form>
      </div>
    </main>
  );
}
