import { Suspense } from "react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import LiveContractOverview from "@/components/dashboard/LiveContractOverview";
import CampaignDetailsPanel from "@/components/dashboard/CampaignDetailsPanel";
import { loadCampaignOverview } from "@/lib/execution-api-server";

async function DashboardContent({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard">["searchParams"];
}) {
  const params = await searchParams;
  const requestedId =
    typeof params.campaignId === "string" ? params.campaignId : "";
  const { status, campaignId, campaign } =
    await loadCampaignOverview(requestedId);
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader />
      <div className="mx-auto max-w-7xl space-y-7 px-5 py-7 sm:px-8">
        <LiveContractOverview result={status} />
        <CampaignDetailsPanel campaignId={campaignId} result={campaign} />
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
