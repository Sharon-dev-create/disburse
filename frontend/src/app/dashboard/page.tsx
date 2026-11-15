import { Suspense } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import LiveContractOverview from "@/components/dashboard/LiveContractOverview";
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
  const [status, accounting] = await Promise.all([
    loadExecutionData((client) => client.getContractStatus()),
    campaignId
      ? loadExecutionData((client) => client.getCampaignAccounting(campaignId))
      : null,
  ]);
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader />
      <div className="mx-auto max-w-7xl space-y-7 px-5 py-7 sm:px-8">
        <LiveContractOverview result={status} />
        <ExecutionAccountingPanel campaignId={campaignId} result={accounting} />
      </div>
    </main>
  );
}
export default function DashboardPage({
  searchParams,
}: PageProps<"/dashboard">) {
  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading contract data…
        </p>
      }
    >
      <DashboardContent searchParams={searchParams} />
    </Suspense>
  );
}
