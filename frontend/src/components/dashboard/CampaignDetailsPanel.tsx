import type {
  CampaignDetails,
  ExecutionDataResult,
} from "@/lib/execution-api-shared";
import ExecutionAccountingPanel from "./ExecutionAccountingPanel";

export default function CampaignDetailsPanel({
  campaignId,
  result,
}: {
  campaignId: string;
  result: ExecutionDataResult<CampaignDetails> | null;
}) {
  if (!result)
    return <ExecutionAccountingPanel campaignId={campaignId} result={null} />;
  if (result.kind === "error")
    return (
      <section
        role="status"
        className="rounded-2xl border border-hairline bg-white p-6"
      >
        <h2 className="text-lg font-medium">Campaign details unavailable</h2>
        <p className="mt-3 text-sm text-alert">{result.error.message}</p>
        <p className="mt-2 text-sm text-mist">
          No campaign data is assumed when a verified read fails.
        </p>
      </section>
    );
  const c = result.data;
  return (
    <section aria-labelledby="campaign-details-heading" className="space-y-5">
      <article className="rounded-2xl border border-hairline bg-white p-6">
        <p className="text-xs uppercase tracking-widest text-forest">
          Live campaign · {c.id}
        </p>
        <h2 id="campaign-details-heading" className="mt-2 text-xl font-medium">
          {c.title}
        </h2>
        <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt>Lifecycle status</dt>
            <dd className="mt-1 font-medium text-forest">{c.status}</dd>
          </div>
          <div>
            <dt>Campaign ID</dt>
            <dd className="mt-1 font-mono">{c.id}</dd>
          </div>
          <div>
            <dt>Funding token</dt>
            <dd className="mt-1 break-all font-mono text-xs">{c.tokenId}</dd>
          </div>
          <div>
            <dt>Creator</dt>
            <dd className="mt-1 break-all font-mono text-xs">{c.creatorId}</dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-mist">
          Funding does not automatically activate a campaign. This interface
          cannot approve, fund or execute payouts.
        </p>
      </article>
      <ExecutionAccountingPanel
        campaignId={campaignId}
        result={{ kind: "success", data: c.accounting }}
      />
    </section>
  );
}
