import Link from "next/link";
import type {
  ContractStatus,
  ExecutionDataResult,
} from "@/lib/execution-api-shared";

export default function LiveContractOverview({
  result,
}: {
  result: ExecutionDataResult<ContractStatus>;
}) {
  if (result.kind === "error")
    return (
      <section
        role="status"
        className="rounded-2xl border border-hairline bg-white p-6"
      >
        <h2 className="text-lg font-medium">Contract data unavailable</h2>
        <p className="mt-2 text-sm text-alert">{result.error.message}</p>
        <p className="mt-2 text-sm text-mist">
          Counts and balances are not assumed when the API cannot be verified.
        </p>
      </section>
    );
  const s = result.data;
  return (
    <section
      className="rounded-2xl border border-hairline bg-white p-6"
      aria-labelledby="contract-status-heading"
    >
      <p className="text-xs uppercase tracking-widest text-forest">
        Live contract · read-only
      </p>
      <h2
        id="contract-status-heading"
        className="mt-2 break-all text-xl font-medium"
      >
        {s.contractId}
      </h2>
      <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2">
        <div>
          <dt>Network</dt>
          <dd>NEAR {s.networkId}</dd>
        </div>
        <div>
          <dt>Pause status</dt>
          <dd>{s.paused ? "Paused" : "Active (unpaused)"}</dd>
        </div>
        <div>
          <dt>Campaign count</dt>
          <dd>{s.campaignCount}</dd>
        </div>
        <div>
          <dt>Payout count</dt>
          <dd>{s.payoutCount ?? "Total unavailable from contract views"}</dd>
        </div>
      </dl>
      <p className="mt-4 break-all font-mono text-xs text-mist">
        Code hash: {s.codeHash}
      </p>
      {s.campaignCount === "0" ? (
        <p className="mt-5 text-sm">No campaigns currently exist.</p>
      ) : (
        <p className="mt-5 text-sm">
          Campaigns exist. Read accounting by numeric ID; a complete campaign
          directory is not available here.
        </p>
      )}
      {s.payoutCount === "0" ? (
        <p className="mt-2 text-sm">
          No on-chain payout records. This follows from the verified zero
          campaign count; there is no payout-count view.
        </p>
      ) : null}
      <div className="mt-5 flex flex-wrap gap-4 text-sm text-forest">
        <Link href="/dashboard/campaigns">View campaigns</Link>
        <Link href="/dashboard/payouts">View payouts</Link>
      </div>
      <p className="mt-5 text-sm text-mist">
        Creation, funding, execution, retries and refunds are unavailable in
        this read-only interface.
      </p>
      <div className="mt-3 flex flex-wrap gap-3">
        {[
          "Create Campaign",
          "Fund Campaign",
          "Execute Payout",
          "Retry",
          "Refund",
        ].map((label) => (
          <button
            key={label}
            type="button"
            disabled
            className="rounded-full border border-hairline px-3 py-2 text-xs text-mist disabled:cursor-not-allowed disabled:opacity-60"
          >
            {label}
          </button>
        ))}
      </div>
    </section>
  );
}
