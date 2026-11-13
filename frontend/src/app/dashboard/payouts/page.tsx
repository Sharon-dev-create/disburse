import PayoutDirectory from "@/components/dashboard/PayoutDirectory";
import { loadExecutionData } from "@/lib/execution-api-server";

export default async function PayoutsPage({
  searchParams,
}: PageProps<"/dashboard/payouts">) {
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
