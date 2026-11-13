import { Suspense } from "react";
import Link from "next/link";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import ExecutionAccountingPanel from "@/components/dashboard/ExecutionAccountingPanel";
import { loadExecutionData } from "@/lib/execution-api-server";

async function DashboardContent({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard">["searchParams"];
}) {
  const params = await searchParams;
  const campaignId =
    typeof params.campaignId === "string" ? params.campaignId : "";
  const accountingResult = campaignId
    ? await loadExecutionData((client) =>
        client.getCampaignAccounting(campaignId),
      )
    : null;

  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div className="mb-7 rounded-2xl bg-[#1f3328] px-5 py-5 text-canvas sm:px-6">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-canvas/60">
            Read-only demo
          </p>
          <h1 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-canvas">
            NEAR Testnet · disburse-topg.testnet
          </h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-canvas/85">
            This dashboard is connected to the configured read-only execution
            service and NEAR Testnet contract. The deployed contract is paused
            and currently has no campaigns or on-chain payout records. No live
            balances, transfers, settlements, or destination-chain delivery are
            implied.
          </p>
        </div>

        <ExecutionAccountingPanel
          campaignId={campaignId}
          result={accountingResult}
        />

        <section
          aria-labelledby="live-state-heading"
          className="mt-8 grid gap-6 xl:grid-cols-3"
        >
          <article className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              Campaigns
            </p>
            <h2
              id="live-state-heading"
              className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink"
            >
              No campaigns on contract
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              The configured deployed contract currently has zero campaigns.
              Numeric campaign IDs can be checked via contract-backed reads, but
              none are expected to exist in this demo state.
            </p>
            <Link
              href="/dashboard/campaigns"
              className="mt-5 inline-flex text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4"
            >
              View campaigns
            </Link>
          </article>

          <article className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              Payouts
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">
              No live payout records
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              There are no on-chain payouts for the current contract state. Any
              persisted execution jobs, if present for a queried campaign, are
              operational records only and not proof of destination-chain
              delivery or settlement.
            </p>
            <Link
              href="/dashboard/payouts"
              className="mt-5 inline-flex text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4"
            >
              View payouts
            </Link>
          </article>

          <article className="rounded-2xl border border-hairline bg-white p-5 sm:p-6">
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              Recipients
            </p>
            <h2 className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">
              No recipient records
            </h2>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              No recipient records are available in this read-only demo state.
              Displayed addresses or formats, if shown elsewhere, are not
              ownership verification and do not imply completed or eligible
              payouts.
            </p>
            <Link
              href="/dashboard/recipients"
              className="mt-5 inline-flex text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4"
            >
              View recipients
            </Link>
          </article>
        </section>

        <section
          aria-labelledby="demo-status-heading"
          className="mt-8 rounded-2xl border border-hairline bg-sand p-5 sm:p-6"
        >
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
            Demo status
          </p>
          <h2
            id="demo-status-heading"
            className="mt-1 text-base font-medium text-ink"
          >
            Honest read-only state
          </h2>
          <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-hairline bg-white p-4">
              <dt className="text-ink/65">Network</dt>
              <dd className="mt-1 font-medium text-ink">NEAR Testnet</dd>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-4">
              <dt className="text-ink/65">Contract</dt>
              <dd className="mt-1 break-all font-mono text-xs font-medium text-ink">
                disburse-topg.testnet
              </dd>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-4">
              <dt className="text-ink/65">Contract state</dt>
              <dd className="mt-1 font-medium text-ink">Paused (read-only)</dd>
            </div>
            <div className="rounded-xl border border-hairline bg-white p-4">
              <dt className="text-ink/65">Live aggregate counts</dt>
              <dd className="mt-1 font-medium text-ink">
                Not available from current read-only API
              </dd>
            </div>
          </dl>
          <p className="mt-5 text-xs leading-5 text-ink/55">
            Contract accounting can be loaded by numeric campaign ID above.
            Persisted execution jobs and contract state are separate; this
            interface does not perform transfers, retries, or settlement
            verification.
          </p>
        </section>
      </div>
    </main>
  );
}

export default function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  return (
    <Suspense
      fallback={<div className="p-6 text-sm text-mist">Loading dashboard…</div>}
    >
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}
