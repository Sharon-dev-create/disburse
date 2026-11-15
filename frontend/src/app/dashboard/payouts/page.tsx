import { Suspense } from "react";
import Link from "next/link";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import LiveContractOverview from "@/components/dashboard/LiveContractOverview";
import { loadExecutionData } from "@/lib/execution-api-server";
async function PayoutsContent({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard/payouts">["searchParams"];
}) {
  const params = await searchParams;
  const id = typeof params.campaignId === "string" ? params.campaignId : "";
  const [status, result] = await Promise.all([
    loadExecutionData((client) => client.getContractStatus()),
    id ? loadExecutionData((client) => client.getCampaignPayouts(id)) : null,
  ]);
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl space-y-7 px-5 py-7 sm:px-8">
        <h1 className="text-3xl font-medium">Payouts</h1>
        <LiveContractOverview result={status} />
        <section className="rounded-2xl border border-hairline bg-white p-6">
          <h2>Persisted execution records by campaign</h2>
          <form method="get" className="mt-4 flex gap-3">
            <label>
              Numeric campaign ID{" "}
              <input
                name="campaignId"
                defaultValue={id}
                pattern="(?:0|[1-9][0-9]{0,19})"
                className="rounded border p-2"
              />
            </label>
            <button type="submit">Load</button>
          </form>
          {result?.kind === "error" ? (
            <p role="status" className="mt-4 text-alert">
              {result.error.message}
            </p>
          ) : result?.kind === "success" ? (
            result.data.jobs.length ? (
              <ul>
                {result.data.jobs.map((job) => (
                  <li key={job.jobId}>
                    <Link href={`/dashboard/payouts/${job.payoutId}`}>
                      Payout {job.payoutId}: {job.state}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-4">
                No persisted execution records for this campaign.
              </p>
            )
          ) : null}
          <p className="mt-4 text-xs text-mist">
            Persisted jobs are operational records, not proof of settlement or
            destination delivery.
          </p>
        </section>
      </div>
    </main>
  );
}
export default function PayoutsPage({
  searchParams,
}: PageProps<"/dashboard/payouts">) {
  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading payouts…
        </p>
      }
    >
      <PayoutsContent searchParams={searchParams} />
    </Suspense>
  );
}
