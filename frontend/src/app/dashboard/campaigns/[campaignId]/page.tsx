import Link from "next/link";
import { ArrowLeft, CircleDollarSign } from "lucide-react";
import { notFound } from "next/navigation";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CampaignStatusBadge from "@/components/dashboard/CampaignStatusBadge";
import ExecutionAccountingPanel from "@/components/dashboard/ExecutionAccountingPanel";
import { loadExecutionData } from "@/lib/execution-api-server";
import { campaignStatusDescription, campaignStatuses, formatCampaignDate, formatUsd, getDemoCampaign } from "@/lib/campaign-demo-data";

export default async function CampaignDetailPage({ params }: PageProps<"/dashboard/campaigns/[campaignId]">) {
  const { campaignId } = await params;
  if (isContractCampaignId(campaignId)) {
    const result = await loadExecutionData((client) =>
      client.getCampaignAccounting(campaignId),
    );
    return (
      <main className="min-w-0 flex-1">
        <DashboardHeader showTitle={false} />
        <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
          <Link href="/dashboard/campaigns" className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4">
            <ArrowLeft size={15} aria-hidden="true" />Back to campaigns
          </Link>
          <p className="mt-6 text-[10px] font-medium uppercase tracking-[0.16em] text-forest">Configured contract campaign</p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Campaign {campaignId}</h1>
          <p className="mt-2 text-sm leading-6 text-ink/65">
            This page reads current accounting from the execution service. No campaign title or lifecycle data is available through the current read API.
          </p>
          <div className="mt-8">
            <ExecutionAccountingPanel campaignId={campaignId} result={result} />
          </div>
        </div>
      </main>
    );
  }
  const campaign = getDemoCampaign(campaignId);
  if (!campaign) notFound();
  const { accounting } = campaign;
  const balances = [["Funded", accounting.funded, "Tokens received by this campaign."], ["Available", accounting.available, "Funded tokens not reserved or settled."], ["Reserved", accounting.reserved, "Committed to pending payouts; not settled."], ["Settled", accounting.settled, "Successfully verified as paid."]] as const;
  return <main className="min-w-0 flex-1"><DashboardHeader showTitle={false} /><div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10"><Link href="/dashboard/campaigns" className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"><ArrowLeft size={15} aria-hidden="true" />Back to campaigns</Link><div className="mt-6 flex flex-col justify-between gap-5 sm:flex-row sm:items-start"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Illustrative campaign</p><h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">{campaign.name}</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">{campaign.description}</p><p className="mt-3 font-mono text-xs text-mist">{campaign.id} · Created {formatCampaignDate(campaign.createdAt, { month: "long", day: "numeric", year: "numeric" })}</p></div><CampaignStatusBadge status={campaign.status} /></div><p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">This is frontend-only demo data. It is not an authoritative campaign, funding, or settlement record.</p>
    <section className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6" aria-labelledby="overview-heading"><h2 id="overview-heading" className="text-base font-medium text-ink">Campaign overview</h2><dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4"><div><dt className="text-xs text-ink/55">Source network</dt><dd className="mt-1 text-sm font-medium text-ink">{campaign.sourceNetwork}</dd></div><div><dt className="text-xs text-ink/55">Accepted token</dt><dd className="mt-1 text-sm font-medium text-ink">{campaign.acceptedToken}</dd></div><div><dt className="text-xs text-ink/55">Approved budget</dt><dd className="mt-1 font-mono text-sm font-medium text-ink">{formatUsd(accounting.approvedBudget)}</dd></div><div><dt className="text-xs text-ink/55">Lifecycle</dt><dd className="mt-1"><CampaignStatusBadge status={campaign.status} /></dd></div></dl></section>
    <section className="mt-8" aria-labelledby="accounting-heading"><div className="flex items-center gap-3"><span className="flex size-8 items-center justify-center rounded-full bg-sand text-forest"><CircleDollarSign size={16} aria-hidden="true" /></span><div><h2 id="accounting-heading" className="text-base font-medium text-ink">Accounting breakdown</h2><p className="text-xs text-ink/55">Funded = available + reserved + settled</p></div></div><div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{balances.map(([label, amount, detail]) => <article key={label} className="rounded-2xl border border-hairline bg-white p-5"><p className="text-xs font-medium text-ink/65">{label}</p><p className="mt-5 font-mono text-2xl font-medium tracking-[-0.05em] text-ink">{formatUsd(amount)}</p><p className="mt-2 text-xs leading-5 text-ink/55">{detail}</p></article>)}</div></section>
    <div className="mt-8 grid gap-8 lg:grid-cols-[.75fr_1.25fr]"><section className="rounded-2xl border border-hairline bg-sand p-5 sm:p-6" aria-labelledby="lifecycle-heading"><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Lifecycle</p><h2 id="lifecycle-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">{campaign.status}</h2><p className="mt-3 text-sm leading-6 text-ink/65">{campaignStatusDescription[campaign.status]}</p><p className="mt-5 text-xs leading-5 text-ink/65">Possible lifecycle statuses</p><ul className="mt-2 flex flex-wrap gap-2" aria-label="Possible campaign statuses">{campaignStatuses.map((status) => <li key={status}><CampaignStatusBadge status={status} /></li>)}</ul><p className="mt-5 text-xs leading-5 text-ink/65">Lifecycle transitions are not available in this frontend demo.</p></section><section className="rounded-2xl border border-hairline bg-white p-5 sm:p-6" aria-labelledby="activity-heading"><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Demo activity</p><h2 id="activity-heading" className="mt-1 text-base font-medium text-ink">Campaign record</h2><ol className="mt-5 space-y-5">{campaign.activity.map((event) => <li key={`${event.date}-${event.title}`} className="border-l border-hairline pl-4"><p className="text-xs font-medium text-ink">{event.title}</p><p className="mt-1 text-sm leading-6 text-ink/65">{event.description}</p><p className="mt-1.5 font-mono text-[10px] text-mist">{event.date}</p></li>)}</ol></section></div>
  </div></main>;
}

function isContractCampaignId(value: string): boolean {
  return (
    /^(?:0|[1-9]\d{0,19})$/.test(value) &&
    BigInt(value) <= (1n << 64n) - 1n
  );
}
