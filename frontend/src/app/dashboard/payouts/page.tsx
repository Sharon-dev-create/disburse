import { Suspense } from "react";
import PayoutDirectory from "@/components/dashboard/PayoutDirectory";
import { loadExecutionData } from "@/lib/execution-api-server";

async function PayoutsContent({
  searchParams,
}: {
  searchParams: PageProps<"/dashboard/payouts">["searchParams"];
}) {
  const params = await searchParams;
  const campaignId =
    typeof params.campaignId === "string" ? params.campaignId : "";
  const result = campaignId
    ? await loadExecutionData((client) =>
        client.getCampaignPayouts(campaignId),
      )
    : null;

  return <PayoutDirectory campaignId={campaignId} result={result} />;
}

export default function PayoutsPage({
  searchParams,
}: PageProps<"/dashboard/payouts">) {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-mist">Loading payouts…</div>}>
      <PayoutsContent searchParams={searchParams} />
    </Suspense>
  );
}
