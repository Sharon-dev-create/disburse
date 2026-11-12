import Link from "next/link";
import { ArrowLeft, ArrowUpRight, CircleAlert } from "lucide-react";
import { notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import { PayoutReadinessBadge, RecipientStatusBadge } from "@/components/dashboard/RecipientStatusBadge";
import {
  demoRecipients,
  formatRecipientDate,
  getCampaignsForRecipient,
  getRecipientById,
} from "@/lib/recipient-demo-data";

export function generateStaticParams() {
  return demoRecipients.map(({ id }) => ({ recipientId: id }));
}

export default async function RecipientDetailsPage({
  params,
}: PageProps<"/dashboard/recipients/[recipientId]">) {
  const { recipientId } = await params;
  const recipient = getRecipientById(recipientId);
  if (!recipient) notFound();

  const campaigns = getCampaignsForRecipient(recipient);

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/recipients"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to recipients
        </Link>

        <div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Illustrative recipient</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">{recipient.fullName}</h1>
            <p className="mt-2 font-mono text-xs text-mist">{recipient.id} · Added {formatRecipientDate(recipient.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <RecipientStatusBadge status={recipient.status} />
            <PayoutReadinessBadge status={recipient.payoutReadiness} />
          </div>
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          This is frontend-only demonstration data. Address format checks do not verify ownership, and no payout or on-chain activity is represented.
        </p>

        {recipient.configurationIssues.length > 0 ? (
          <section aria-labelledby="configuration-issues-heading" className="mt-6 rounded-xl border border-[#e7c7b9] bg-[#f7ebe5] p-4">
            <div className="flex items-start gap-3">
              <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-alert" />
              <div>
                <h2 id="configuration-issues-heading" className="text-sm font-medium text-ink">Configuration needs review</h2>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-ink/70">
                  {recipient.configurationIssues.map((issue) => <li key={issue}>{issue}</li>)}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        <section aria-labelledby="recipient-identity-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
          <h2 id="recipient-identity-heading" className="text-base font-medium text-ink">Recipient identity and destination</h2>
          <dl className="mt-5 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-ink/65">Full name</dt>
              <dd className="mt-1 text-sm font-medium text-ink">{recipient.fullName}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/65">Email address</dt>
              <dd className="mt-1 break-all text-sm font-medium text-ink">
                <a className="underline decoration-hairline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest" href={`mailto:${recipient.email}`}>
                  {recipient.email}
                </a>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-ink/65">Destination network</dt>
              <dd className="mt-1 text-sm font-medium text-ink">{recipient.destinationNetwork}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/65">Preferred payout token</dt>
              <dd className="mt-1 text-sm font-medium text-ink">{recipient.preferredToken}</dd>
            </div>
            <div className="min-w-0 sm:col-span-2">
              <dt className="text-xs text-ink/65">Destination wallet/account address</dt>
              <dd className="mt-2 break-all rounded-lg border border-hairline bg-canvas p-3 font-mono text-xs leading-6 text-ink">
                {recipient.walletAddress || "Not provided"}
              </dd>
              <p className="mt-2 text-xs leading-5 text-ink/65">
                Displayed address is demo data. Format validation is not ownership or on-chain verification.
              </p>
            </div>
          </dl>
        </section>

        <section aria-labelledby="recipient-campaigns-heading" className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6">
          <h2 id="recipient-campaigns-heading" className="text-base font-medium text-ink">Associated campaigns</h2>
          {campaigns.length === 0 ? (
            <p className="mt-3 text-sm text-ink/65">No demo campaigns are associated with this recipient.</p>
          ) : (
            <ul className="mt-4 divide-y divide-hairline">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div>
                    <p className="text-sm font-medium text-ink">{campaign.name}</p>
                    <p className="mt-1 font-mono text-[10px] text-mist">{campaign.id}</p>
                  </div>
                  <Link
                    href={`/dashboard/campaigns/${campaign.id}`}
                    className="inline-flex min-h-10 items-center gap-1 text-xs font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                  >
                    View campaign <ArrowUpRight size={13} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="recipient-activity-heading" className="mt-8 rounded-2xl border border-hairline bg-sand p-5 sm:p-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Demo activity</p>
          <h2 id="recipient-activity-heading" className="mt-2 text-base font-medium text-ink">Recipient activity</h2>
          <p className="mt-3 text-sm leading-6 text-ink/65">
            Recipient-specific payout history is not included in this demo. No completed payouts, transaction hashes, or transfer results are represented.
          </p>
        </section>
      </div>
    </main>
  );
}
