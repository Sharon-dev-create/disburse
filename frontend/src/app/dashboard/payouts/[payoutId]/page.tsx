import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PayoutStatusBadge from "@/components/dashboard/PayoutStatusBadge";
import { getDemoCampaign, formatUsd } from "@/lib/campaign-demo-data";
import {
  demoPayouts,
  formatPayoutDate,
  formatTokenAmount,
  getDemoPayout,
} from "@/lib/payout-demo-data";
import { getRecipientById } from "@/lib/recipient-demo-data";

export function generateStaticParams() {
  return demoPayouts.map(({ id }) => ({ payoutId: id }));
}

export default async function PayoutDetailsPage({
  params,
}: PageProps<"/dashboard/payouts/[payoutId]">) {
  const { payoutId } = await params;
  const payout = getDemoPayout(payoutId);
  if (!payout) notFound();

  const campaign = getDemoCampaign(payout.campaignId);
  const recipient = getRecipientById(payout.recipientId);
  if (!campaign || !recipient) notFound();

  const payoutAmount = (value: string | null) =>
    value === null ? "Not recorded" : `${formatTokenAmount(value)} ${payout.destinationToken}`;

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/payouts"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to payouts
        </Link>

        <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Illustrative payout · not a contract ID</p>
            <h1 className="mt-2 break-all font-mono text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">{payout.id}</h1>
            <p className="mt-2 text-sm text-ink/65">Creation date: {formatPayoutDate(payout.createdAt)}</p>
          </div>
          <PayoutStatusBadge status={payout.status} />
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          Static UI demonstration only. This record has no contract payout ID, execution-service job, transaction reference, quote, authorization, timestamp, or recorded event.
        </p>

        <section aria-labelledby="payout-overview-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
          <h2 id="payout-overview-heading" className="text-base font-medium text-ink">Payout overview</h2>
          <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="text-xs text-ink/65">Campaign</dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                <Link href={`/dashboard/campaigns/${campaign.id}`} className="underline decoration-hairline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                  {campaign.name} · {campaign.id} <ArrowUpRight size={13} className="inline" aria-hidden="true" />
                </Link>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink/65">Recipient</dt>
              <dd className="mt-1 text-sm font-medium text-ink">
                <Link href={`/dashboard/recipients/${recipient.id}`} className="underline decoration-hairline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                  {recipient.fullName} · {recipient.id} <ArrowUpRight size={13} className="inline" aria-hidden="true" />
                </Link>
              </dd>
            </div>
            <div><dt className="text-xs text-ink/65">Destination</dt><dd className="mt-1 text-sm font-medium text-ink">{payout.destinationNetwork} · {payout.destinationToken}</dd></div>
            <div><dt className="text-xs text-ink/65">Destination address</dt><dd className="mt-1 break-all font-mono text-xs leading-5 text-ink">{recipient.walletAddress || "Not provided"}</dd></div>
            <div><dt className="text-xs text-ink/65">Expected output</dt><dd className="mt-1 text-sm font-medium text-ink">{payoutAmount(payout.expectedOutputAmount)} · no quote attached</dd></div>
            <div><dt className="text-xs text-ink/65">Actual verified output</dt><dd className="mt-1 text-sm font-medium text-ink">Not verified</dd></div>
          </dl>
        </section>

        <section aria-labelledby="payout-lifecycle-heading" className="mt-8 grid gap-8 lg:grid-cols-2">
          <div className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Contract state</p>
            <h2 id="payout-lifecycle-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">{payout.status}</h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              This status is an illustrative contract-state example only. No live contract read was performed.
            </p>
            <div className="mt-5 border-t border-hairline pt-4">
              <p className="text-xs font-medium text-ink">Execution-service state</p>
              <p className="mt-1 text-sm text-ink/65">Unavailable — there is no execution API or connected worker.</p>
            </div>
            {payout.status === "Failed" ? (
              <p className="mt-4 rounded-lg bg-[#f7ebe5] p-3 text-xs leading-5 text-ink/70">
                A contract payout marked Failed can still hold its reservation. A verifier recovery transition is required to release it; this frontend cannot request that transition.
              </p>
            ) : null}
          </div>
          <div className="rounded-2xl border border-hairline bg-sand p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Settlement</p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">Not verified</h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              No destination evidence or verified output is present. A source deposit, quote, or submitted destination transaction alone would not prove settlement.
            </p>
            <dl className="mt-5 space-y-3 text-xs">
              <div><dt className="text-ink/65">Evidence source</dt><dd className="mt-1 font-medium text-ink">{payout.settlementVerification.evidenceSource ?? "Not available"}</dd></div>
              <div><dt className="text-ink/65">Verified output</dt><dd className="mt-1 font-medium text-ink">{payout.settlementVerification.verifiedOutputAmount ?? "Not available"}</dd></div>
              <div><dt className="text-ink/65">Failure reason</dt><dd className="mt-1 font-medium text-ink">{payout.failureReason ?? "Not recorded"}</dd></div>
              <div><dt className="text-ink/65">Refund amount</dt><dd className="mt-1 font-medium text-ink">{payout.refundAmount ? `${formatTokenAmount(payout.refundAmount)} ${payout.sourceToken}` : "Not recorded"}</dd></div>
            </dl>
          </div>
        </section>

        <section aria-labelledby="payout-accounting-heading" className="mt-8">
          <h2 id="payout-accounting-heading" className="text-base font-medium text-ink">Financial breakdown</h2>
          <p className="mt-1 text-xs text-ink/65">Illustrative values only; no live balance or settlement impact is available.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <article className="rounded-xl border border-hairline bg-white p-4"><h3 className="text-xs text-ink/65">Source input</h3><p className="mt-3 font-mono text-lg font-medium text-ink">{formatTokenAmount(payout.inputAmount)} {payout.sourceToken}</p><p className="mt-2 text-xs text-ink/65">{payout.sourceNetwork}</p></article>
            <article className="rounded-xl border border-hairline bg-white p-4"><h3 className="text-xs text-ink/65">Currently reserved</h3><p className="mt-3 font-mono text-lg font-medium text-ink">{formatTokenAmount(payout.reservedAmount)} {payout.sourceToken}</p><p className="mt-2 text-xs text-ink/65">Not settled</p></article>
            <article className="rounded-xl border border-hairline bg-white p-4"><h3 className="text-xs text-ink/65">Expected output</h3><p className="mt-3 font-mono text-lg font-medium text-ink">{payout.expectedOutputAmount ? `${formatTokenAmount(payout.expectedOutputAmount)} ${payout.destinationToken}` : "Not quoted"}</p><p className="mt-2 text-xs text-ink/65">No provider quote is recorded</p></article>
            <article className="rounded-xl border border-hairline bg-white p-4"><h3 className="text-xs text-ink/65">Verified actual output</h3><p className="mt-3 font-mono text-lg font-medium text-ink">Not verified</p><p className="mt-2 text-xs text-ink/65">No settlement evidence</p></article>
          </div>
          <p className="mt-3 text-xs text-ink/65">Campaign approved budget: {formatUsd(campaign.accounting.approvedBudget)} · demo campaign value only.</p>
        </section>

        <section aria-labelledby="payout-references-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
          <h2 id="payout-references-heading" className="text-base font-medium text-ink">References and retry</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div><dt className="text-xs text-ink/65">Contract payout ID</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.contractPayoutId ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-ink/65">Quote ID</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.quoteId ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-ink/65">Execution authorization ID</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.executionAuthorizationId ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-ink/65">Idempotency key</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.idempotencyKey ?? "Not available"}</dd></div>
            <div><dt className="text-xs text-ink/65">Source transaction</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.sourceTransactionHash ?? "Not recorded"}</dd></div>
            <div><dt className="text-xs text-ink/65">Destination transaction</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.destinationTransactionHash ?? "Not recorded"}</dd></div>
            <div><dt className="text-xs text-ink/65">Refund transaction</dt><dd className="mt-1 font-mono text-xs text-ink">{payout.refundTransactionHash ?? "Not recorded"}</dd></div>
            <div><dt className="text-xs text-ink/65">Retry</dt><dd className="mt-1 text-xs font-medium text-ink">Unavailable — {payout.retryInformation.reason}</dd></div>
          </dl>
        </section>

        <section aria-labelledby="payout-activity-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
          <div className="flex items-start gap-3">
            <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-mist" />
            <div>
              <h2 id="payout-activity-heading" className="text-base font-medium text-ink">Execution timeline</h2>
              {payout.activity.length === 0 ? (
                <p className="mt-2 text-sm leading-6 text-ink/65">
                  No recorded lifecycle events or timestamps are available for this illustrative record. No events have been invented for this view.
                </p>
              ) : (
                <ol className="mt-4 space-y-4">
                  {payout.activity.map((event) => (
                    <li key={event.id} className="border-l border-hairline pl-4">
                      <p className="text-xs font-medium text-ink">{event.title}</p>
                      <p className="mt-1 text-sm leading-6 text-ink/65">{event.description}</p>
                      <p className="mt-1 font-mono text-[10px] text-mist">{formatPayoutDate(event.occurredAt)} · {event.source}</p>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
