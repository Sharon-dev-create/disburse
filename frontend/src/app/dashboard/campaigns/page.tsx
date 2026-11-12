import Link from "next/link";
import { ArrowUpRight, CircleDollarSign, Plus } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import CampaignStatusBadge from "@/components/dashboard/CampaignStatusBadge";
import { campaignTotals, demoCampaigns, formatCampaignDate, formatUsd } from "@/lib/campaign-demo-data";

const totals = campaignTotals();
const metrics = [
  ["Total approved budget", totals.approvedBudget],
  ["Total funded", totals.funded],
  ["Total available", totals.available],
  ["Total reserved", totals.reserved],
  ["Total settled", totals.settled],
] as const;

export default function CampaignsPage() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Demo data</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Campaigns</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              Review illustrative campaign budgets, funding, and payout accounting in one place.
            </p>
          </div>
          <Link
            href="/dashboard/campaigns/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
          >
            <Plus size={16} aria-hidden="true" />
            Create campaign
          </Link>
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          All figures are illustrative frontend demo data. They are not authoritative campaign or on-chain financial records.
        </p>

        <section aria-label="Campaign accounting summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map(([label, amount]) => (
            <article key={label} className="rounded-xl border border-hairline bg-white p-4">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-mist">{label}</h2>
              <p className="mt-3 font-mono text-xl font-medium tracking-[-0.05em] tabular-nums text-ink">
                {formatUsd(amount)}
              </p>
            </article>
          ))}
        </section>

        <section className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white" aria-labelledby="campaign-list-heading">
          <div className="flex items-center gap-3 border-b border-hairline px-5 py-4 sm:px-6">
            <span className="flex size-8 items-center justify-center rounded-full bg-sand text-forest">
              <CircleDollarSign size={16} aria-hidden="true" />
            </span>
            <div>
              <h2 id="campaign-list-heading" className="text-base font-medium text-ink">All demo campaigns</h2>
              <p className="text-xs text-ink/65">{demoCampaigns.length} illustrative records</p>
            </div>
          </div>

          {demoCampaigns.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <p className="text-sm font-medium text-ink">No demo campaigns yet</p>
              <p className="mt-2 text-sm text-ink/65">Create a frontend-only demo campaign to preview this view.</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[1080px] border-collapse text-left">
                  <caption className="sr-only">Illustrative campaign budgets and accounting</caption>
                  <thead className="border-b border-hairline bg-canvas text-[9px] font-medium uppercase tracking-[0.12em] text-mist">
                    <tr>
                      <th scope="col" className="px-5 py-3">Campaign</th>
                      <th scope="col" className="px-3 py-3">Source network</th>
                      <th scope="col" className="px-3 py-3">Accepted token</th>
                      <th scope="col" className="px-3 py-3">Approved budget</th>
                      <th scope="col" className="px-3 py-3">Funded</th>
                      <th scope="col" className="px-3 py-3">Available</th>
                      <th scope="col" className="px-3 py-3">Reserved</th>
                      <th scope="col" className="px-3 py-3">Settled</th>
                      <th scope="col" className="px-3 py-3">Status</th>
                      <th scope="col" className="px-5 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline text-xs text-ink">
                    {demoCampaigns.map((campaign) => (
                      <tr key={campaign.id}>
                        <th scope="row" className="px-5 py-4 font-normal">
                          <span className="block font-medium text-ink">{campaign.name}</span>
                          <span className="mt-1 block font-mono text-[10px] text-mist">
                            {campaign.id} · {formatCampaignDate(campaign.createdAt)}
                          </span>
                        </th>
                        <td className="px-3 py-4">{campaign.sourceNetwork}</td>
                        <td className="px-3 py-4">{campaign.acceptedToken}</td>
                        <td className="px-3 py-4 font-mono tabular-nums">{formatUsd(campaign.accounting.approvedBudget)}</td>
                        <td className="px-3 py-4 font-mono tabular-nums">{formatUsd(campaign.accounting.funded)}</td>
                        <td className="px-3 py-4 font-mono tabular-nums">{formatUsd(campaign.accounting.available)}</td>
                        <td className="px-3 py-4 font-mono tabular-nums">{formatUsd(campaign.accounting.reserved)}</td>
                        <td className="px-3 py-4 font-mono tabular-nums">{formatUsd(campaign.accounting.settled)}</td>
                        <td className="px-3 py-4"><CampaignStatusBadge status={campaign.status} /></td>
                        <td className="px-5 py-4">
                          <Link
                            href={`/dashboard/campaigns/${campaign.id}`}
                            className="inline-flex items-center gap-1 font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                          >
                            Details <ArrowUpRight size={13} aria-hidden="true" />
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <ul className="divide-y divide-hairline xl:hidden">
                {demoCampaigns.map((campaign) => (
                  <li key={campaign.id} className="px-5 py-5 sm:px-6">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <h3 className="text-sm font-medium text-ink">{campaign.name}</h3>
                        <p className="mt-1 font-mono text-[10px] text-mist">
                          {campaign.id} · {formatCampaignDate(campaign.createdAt)}
                        </p>
                      </div>
                      <CampaignStatusBadge status={campaign.status} />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                      <div><dt className="text-ink/65">Source network</dt><dd className="mt-1 font-medium text-ink">{campaign.sourceNetwork}</dd></div>
                      <div><dt className="text-ink/65">Accepted token</dt><dd className="mt-1 font-medium text-ink">{campaign.acceptedToken}</dd></div>
                      <div><dt className="text-ink/65">Approved budget</dt><dd className="mt-1 font-mono font-medium text-ink">{formatUsd(campaign.accounting.approvedBudget)}</dd></div>
                      <div><dt className="text-ink/65">Funded</dt><dd className="mt-1 font-mono font-medium text-ink">{formatUsd(campaign.accounting.funded)}</dd></div>
                      <div><dt className="text-ink/65">Available</dt><dd className="mt-1 font-mono font-medium text-ink">{formatUsd(campaign.accounting.available)}</dd></div>
                      <div><dt className="text-ink/65">Reserved</dt><dd className="mt-1 font-mono font-medium text-ink">{formatUsd(campaign.accounting.reserved)}</dd></div>
                      <div><dt className="text-ink/65">Settled</dt><dd className="mt-1 font-mono font-medium text-ink">{formatUsd(campaign.accounting.settled)}</dd></div>
                    </dl>
                    <Link
                      href={`/dashboard/campaigns/${campaign.id}`}
                      className="mt-4 inline-flex min-h-10 items-center gap-1 text-xs font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                    >
                      View campaign details <ArrowUpRight size={13} aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
