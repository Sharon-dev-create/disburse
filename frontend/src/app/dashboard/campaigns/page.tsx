import { Suspense } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import LiveContractOverview from "@/components/dashboard/LiveContractOverview";
import ExecutionAccountingPanel from "@/components/dashboard/ExecutionAccountingPanel";
import { loadExecutionData } from "@/lib/execution-api-server";
async function CampaignsContent() {
  const result = await loadExecutionData((client) =>
    client.getContractStatus(),
  );
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl space-y-7 px-5 py-7 sm:px-8">
        <h1 className="text-3xl font-medium">Campaigns</h1>
        <LiveContractOverview result={result} />
        <ExecutionAccountingPanel campaignId="" result={null} />
      </div>
    </main>
  );
}
export default function CampaignsPage() {
  return (
    <Suspense
      fallback={
        <p className="p-6" role="status">
          Loading campaigns…
        </p>
      }
    >
      <CampaignsContent />
    </Suspense>
  );
}
