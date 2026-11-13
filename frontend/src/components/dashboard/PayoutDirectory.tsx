"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, Search } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import PayoutStatusBadge from "@/components/dashboard/PayoutStatusBadge";
import { demoCampaigns, getDemoCampaign } from "@/lib/campaign-demo-data";
import {
  CONTRACT_PAYOUT_STATUSES,
  demoPayouts,
  formatPayoutDate,
  formatTokenAmount,
  getPayoutDisplayStatus,
  getPayoutRecipient,
  payoutReservedAmount,
  type ContractPayoutStatus,
} from "@/lib/payout-demo-data";
import { DESTINATION_NETWORKS } from "@/lib/recipient-demo-data";
import { formatAtomicAmount } from "@/lib/execution-api-shared";
import {
  getContractStatusLabel,
  type CampaignPayoutList,
  type ExecutionDataResult,
} from "@/lib/execution-api-shared";
import ExecutionStateBadge from "@/components/dashboard/ExecutionStateBadge";

type StatusFilter = "All statuses" | ContractPayoutStatus;
type SortOrder = "newest" | "oldest";
type Props = {
  campaignId: string;
  result: ExecutionDataResult<CampaignPayoutList> | null;
};

const NETWORKS = ["NEAR", ...DESTINATION_NETWORKS.filter((network) => network !== "NEAR")];

const metrics = [
  {
    label: "Total payouts",
    value: `${demoPayouts.length}`,
    detail: "Illustrative records only",
  },
  {
    label: "Reserved amount",
    value: `${formatTokenAmount(payoutReservedAmount())} USDC`,
    detail: "Illustrative reservation snapshots",
  },
  {
    label: "Processing payouts",
    value: "Unavailable",
    detail: "Demo records have no persisted execution state",
  },
  {
    label: "Successfully settled",
    value: "Unavailable",
    detail: "No independent settlement data is connected",
  },
  {
    label: "Failed or refunded",
    value: `${demoPayouts.filter((payout) => ["Failed", "RefundPending", "Refunded"].includes(payout.status)).length} demo`,
    detail: "A failed record may still hold its reservation",
  },
];

function PayoutSummary({ payoutId }: { payoutId: string }) {
  const payout = demoPayouts.find((item) => item.id === payoutId);
  if (!payout) return null;
  const campaign = getDemoCampaign(payout.campaignId);
  const recipient = getPayoutRecipient(payout);

  return (
    <>
      <p className="font-medium text-ink">{campaign?.name ?? payout.campaignId}</p>
      <p className="mt-1 text-xs text-ink/65">{recipient?.fullName ?? payout.recipientId}</p>
    </>
  );
}

export default function PayoutDirectory({ campaignId, result }: Props) {
  const [query, setQuery] = useState("");
  const [campaignId, setCampaignId] = useState("All campaigns");
  const [network, setNetwork] = useState("All networks");
  const [status, setStatus] = useState<StatusFilter>("All statuses");
  const [sortOrder, setSortOrder] = useState<SortOrder>("newest");

  const filteredPayouts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = demoPayouts.filter((payout) => {
      const campaign = getDemoCampaign(payout.campaignId);
      const recipient = getPayoutRecipient(payout);
      const matchesQuery =
        !normalizedQuery ||
        payout.id.toLowerCase().includes(normalizedQuery) ||
        payout.campaignId.toLowerCase().includes(normalizedQuery) ||
        campaign?.name.toLowerCase().includes(normalizedQuery) ||
        payout.recipientId.toLowerCase().includes(normalizedQuery) ||
        recipient?.fullName.toLowerCase().includes(normalizedQuery);
      return (
        matchesQuery &&
        (campaignId === "All campaigns" || payout.campaignId === campaignId) &&
        (network === "All networks" || payout.destinationNetwork === network) &&
        (status === "All statuses" || payout.status === status)
      );
    });

    return filtered.sort((left, right) => {
      if (!left.createdAt && !right.createdAt) return 0;
      if (!left.createdAt) return 1;
      if (!right.createdAt) return -1;
      const difference = Date.parse(left.createdAt) - Date.parse(right.createdAt);
      return sortOrder === "newest" ? -difference : difference;
    });
  }, [campaignId, network, query, sortOrder, status]);

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <section
          aria-labelledby="persisted-payouts-heading"
          className="rounded-2xl border border-hairline bg-white p-5 sm:p-6"
        >
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-forest">
                Execution service · persisted jobs
              </p>
              <h1 id="persisted-payouts-heading" className="mt-1 text-xl font-medium text-ink">
                Payout records
              </h1>
              <p className="mt-1 text-xs leading-5 text-ink/65">
                PostgreSQL job snapshots for a real numeric campaign ID. Contract state is shown only as observed when the job was discovered.
              </p>
            </div>
            <form action="/dashboard/payouts" method="get" className="flex gap-2">
              <label className="sr-only" htmlFor="persisted-campaign-id">
                Numeric campaign ID
              </label>
              <input
                id="persisted-campaign-id"
                name="campaignId"
                inputMode="numeric"
                pattern="(?:0|[1-9][0-9]{0,19})"
                maxLength={20}
                defaultValue={campaignId}
                placeholder="Campaign ID"
                className="min-h-10 w-36 rounded-lg border border-hairline bg-canvas px-3 font-mono text-xs text-ink"
              />
              <button
                type="submit"
                className="min-h-10 rounded-full bg-forest px-4 text-xs font-medium text-canvas hover:bg-forest-deep"
              >
                Load
              </button>
            </form>
          </div>

          {!campaignId ? (
            <p className="mt-5 rounded-xl border border-dashed border-hairline bg-canvas px-4 py-4 text-sm leading-6 text-ink/65">
              Enter a numeric campaign ID to look up persisted payout jobs. Demo campaign IDs are not contract IDs.
            </p>
          ) : result?.kind === "error" ? (
            <p role="status" className="mt-5 rounded-xl border border-[#f2ded5] bg-[#fbf2ee] px-4 py-4 text-sm leading-6 text-alert">
              {result.error.message}
            </p>
          ) : result?.kind === "success" && result.data.jobs.length === 0 ? (
            <p className="mt-5 rounded-xl border border-dashed border-hairline bg-canvas px-4 py-4 text-sm leading-6 text-ink/65">
              No persisted execution jobs were found for campaign {campaignId}.
            </p>
          ) : result?.kind === "success" ? (
            <>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[760px] border-collapse text-left">
                  <caption className="sr-only">Persisted execution jobs for campaign {campaignId}</caption>
                  <thead className="border-b border-hairline bg-canvas text-[9px] font-medium uppercase tracking-[0.12em] text-mist">
                    <tr>
                      <th scope="col" className="px-3 py-3">Payout</th>
                      <th scope="col" className="px-3 py-3">Source amount</th>
                      <th scope="col" className="px-3 py-3">Execution state</th>
                      <th scope="col" className="px-3 py-3">Contract snapshot</th>
                      <th scope="col" className="px-3 py-3">Created</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline text-xs text-ink">
                    {result.data.jobs.map((job) => (
                      <tr key={job.jobId}>
                        <td className="px-3 py-4">
                          <Link
                            href={`/dashboard/payouts/${job.payoutId}`}
                            className="font-mono font-medium text-forest underline decoration-forest/30 underline-offset-4"
                          >
                            {job.payoutId}
                          </Link>
                          <p className="mt-1 text-[10px] text-mist">Job {job.jobId}</p>
                        </td>
                        <td className="px-3 py-4 font-mono tabular-nums">
                          {formatAtomicAmount(job.source.atomicAmount, job.source.decimals)} {job.source.tokenId}
                        </td>
                        <td className="px-3 py-4"><ExecutionStateBadge state={job.state} /></td>
                        <td className="px-3 py-4 text-xs text-ink/65">
                          {getContractStatusLabel(job.observedContractStatus)} at discovery
                        </td>
                        <td className="px-3 py-4 font-mono text-[10px] text-ink/65">
                          <time dateTime={job.createdAt}>{job.createdAt}</time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.data.truncated ? (
                <p role="status" className="mt-3 text-xs text-alert">
                  Showing the most recent 100 records; additional jobs exist for this campaign.
                </p>
              ) : null}
              <p className="mt-3 text-xs leading-5 text-ink/55">
                Persisted job state is operational data, not proof of destination-chain delivery. Open a payout for its current contract status.
              </p>
            </>
          ) : null}
        </section>

        <div className="mt-10 flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Presentation-only examples</p>
            <h2 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Demo payout data</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              Review illustrative payout states without initiating a reservation, transaction, or settlement.
            </p>
          </div>
          <Link
            href="/dashboard/payouts/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
          >
            Create payout
            <ArrowUpRight size={15} aria-hidden="true" />
          </Link>
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          The records below are separate frontend fixtures, not contract or execution-service data. They are never combined with persisted jobs.
        </p>

        <section aria-label="Payout summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {metrics.map((metric) => (
            <article key={metric.label} className="rounded-xl border border-hairline bg-white p-4">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-mist">{metric.label}</h2>
              <p className="mt-3 font-mono text-lg font-medium tracking-[-0.04em] tabular-nums text-ink">{metric.value}</p>
              <p className="mt-2 text-xs leading-5 text-ink/65">{metric.detail}</p>
            </article>
          ))}
        </section>

        <section aria-labelledby="payout-directory-heading" className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white">
          <div className="border-b border-hairline px-5 py-5 sm:px-6">
            <h2 id="payout-directory-heading" className="text-base font-medium text-ink">Payout directory</h2>
            <p className="mt-1 text-xs text-ink/65">
              Contract status and execution status are separate; execution details are unavailable in this demo.
            </p>
            <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="relative md:col-span-2 xl:col-span-1">
                <label htmlFor="payout-search" className="sr-only">Search payouts by ID, campaign, or recipient</label>
                <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mist" />
                <input
                  id="payout-search"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search ID, campaign, recipient"
                  className="min-h-11 w-full rounded-lg border border-hairline bg-canvas pl-9 pr-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                />
              </div>
              <div>
                <label htmlFor="payout-campaign-filter" className="sr-only">Filter by campaign</label>
                <select
                  id="payout-campaign-filter"
                  value={campaignId}
                  onChange={(event) => setCampaignId(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                >
                  <option>All campaigns</option>
                  {demoCampaigns.map((campaign) => <option key={campaign.id} value={campaign.id}>{campaign.name}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="payout-network-filter" className="sr-only">Filter by destination network</label>
                <select
                  id="payout-network-filter"
                  value={network}
                  onChange={(event) => setNetwork(event.target.value)}
                  className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                >
                  <option>All networks</option>
                  {NETWORKS.map((item) => <option key={item}>{item}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="payout-status-filter" className="sr-only">Filter by contract payout status</label>
                <select
                  id="payout-status-filter"
                  value={status}
                  onChange={(event) => setStatus(event.target.value as StatusFilter)}
                  className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                >
                  <option>All statuses</option>
                  {CONTRACT_PAYOUT_STATUSES.map((item) => <option key={item} value={item}>{getPayoutDisplayStatus(item)}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="payout-sort-order" className="sr-only">Sort by creation date</label>
                <select
                  id="payout-sort-order"
                  value={sortOrder}
                  onChange={(event) => setSortOrder(event.target.value as SortOrder)}
                  className="min-h-11 w-full rounded-lg border border-hairline bg-white px-3 text-sm text-ink outline-none focus:border-forest focus:ring-2 focus:ring-forest/20"
                >
                  <option value="newest">Newest first</option>
                  <option value="oldest">Oldest first</option>
                </select>
              </div>
            </div>
            <p aria-live="polite" className="mt-3 text-xs text-ink/65">
              Showing {filteredPayouts.length} of {demoPayouts.length} illustrative payouts. Creation dates are not recorded.
            </p>
          </div>

          {filteredPayouts.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <h3 className="text-sm font-medium text-ink">No payouts match these filters</h3>
              <p className="mt-2 text-sm text-ink/65">Try another payout ID, campaign, recipient, network, or status.</p>
            </div>
          ) : (
            <>
              <div className="hidden overflow-x-auto xl:block">
                <table className="w-full min-w-[1180px] border-collapse text-left">
                  <caption className="sr-only">Illustrative payout states; no live payout information</caption>
                  <thead className="border-b border-hairline bg-canvas text-[9px] font-medium uppercase tracking-[0.12em] text-mist">
                    <tr>
                      <th scope="col" className="px-5 py-3">Payout</th>
                      <th scope="col" className="px-3 py-3">Campaign / recipient</th>
                      <th scope="col" className="px-3 py-3">Source amount</th>
                      <th scope="col" className="px-3 py-3">Expected output</th>
                      <th scope="col" className="px-3 py-3">Destination network</th>
                      <th scope="col" className="px-3 py-3">Contract status</th>
                      <th scope="col" className="px-3 py-3">Execution status</th>
                      <th scope="col" className="px-3 py-3">Created</th>
                      <th scope="col" className="px-5 py-3">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline text-xs">
                    {filteredPayouts.map((payout) => (
                      <tr key={payout.id}>
                        <th scope="row" className="px-5 py-4 font-mono font-medium text-ink">{payout.id}</th>
                        <td className="px-3 py-4"><PayoutSummary payoutId={payout.id} /></td>
                        <td className="px-3 py-4 font-mono tabular-nums text-ink">{payout.sourceNetwork} · {formatTokenAmount(payout.inputAmount)} {payout.sourceToken}</td>
                        <td className="px-3 py-4 text-ink/65">Not quoted · {payout.destinationToken}</td>
                        <td className="px-3 py-4 text-ink">{payout.destinationNetwork}</td>
                        <td className="px-3 py-4"><PayoutStatusBadge status={payout.status} /></td>
                        <td className="px-3 py-4 text-ink/65">Not connected</td>
                        <td className="px-3 py-4 text-ink/65">{formatPayoutDate(payout.createdAt)}</td>
                        <td className="px-5 py-4">
                          <Link
                            href={`/dashboard/payouts/${payout.id}`}
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
                {filteredPayouts.map((payout) => {
                  const campaign = getDemoCampaign(payout.campaignId);
                  const recipient = getPayoutRecipient(payout);
                  return (
                    <li key={payout.id} className="px-5 py-5 sm:px-6">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="break-all font-mono text-xs font-medium text-ink">{payout.id}</h3>
                          <p className="mt-1 text-sm font-medium text-ink">{campaign?.name ?? payout.campaignId}</p>
                          <p className="mt-1 text-xs text-ink/65">{recipient?.fullName ?? payout.recipientId}</p>
                        </div>
                        <PayoutStatusBadge status={payout.status} />
                      </div>
                      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:grid-cols-3">
                        <div><dt className="text-ink/65">Source amount</dt><dd className="mt-1 font-mono font-medium text-ink">{payout.sourceNetwork} · {formatTokenAmount(payout.inputAmount)} {payout.sourceToken}</dd></div>
                        <div><dt className="text-ink/65">Expected output</dt><dd className="mt-1 font-medium text-ink">Not quoted · {payout.destinationToken}</dd></div>
                        <div><dt className="text-ink/65">Destination network</dt><dd className="mt-1 font-medium text-ink">{payout.destinationNetwork}</dd></div>
                        <div><dt className="text-ink/65">Execution status</dt><dd className="mt-1 font-medium text-ink">Not connected</dd></div>
                        <div><dt className="text-ink/65">Created</dt><dd className="mt-1 font-medium text-ink">{formatPayoutDate(payout.createdAt)}</dd></div>
                      </dl>
                      <Link
                        href={`/dashboard/payouts/${payout.id}`}
                        className="mt-4 inline-flex min-h-10 items-center gap-1 text-xs font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
                      >
                        View payout details <ArrowUpRight size={13} aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
