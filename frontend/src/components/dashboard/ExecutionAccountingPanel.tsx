import {
  formatAtomicAmount,
  type CampaignAccounting,
  type ExecutionDataResult,
} from "@/lib/execution-api-shared";

type Props = {
  campaignId: string;
  result: ExecutionDataResult<CampaignAccounting> | null;
};

const BALANCE_FIELDS = [
  ["Budget", "budget"],
  ["Funded", "funded"],
  ["Reserved", "reserved"],
  ["Spent / settled", "spent"],
  ["Available", "available"],
] as const;

export default function ExecutionAccountingPanel({
  campaignId,
  result,
}: Props) {
  const accounting = result?.kind === "success" ? result.data : null;

  return (
    <section
      aria-labelledby="execution-accounting-heading"
      className="rounded-2xl border border-hairline bg-white p-5 sm:p-6"
    >
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-forest">
            Execution service · persisted contract accounting
          </p>
          <h2
            id="execution-accounting-heading"
            className="mt-1 text-lg font-medium tracking-tight text-ink"
          >
            Campaign accounting
          </h2>
        </div>
        <form action="/dashboard" method="get" className="flex gap-2">
          <label className="sr-only" htmlFor="accounting-campaign-id">
            Numeric campaign ID
          </label>
          <input
            id="accounting-campaign-id"
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
          Enter a numeric campaign ID to read its current accounting from the
          configured contract. Demo campaign IDs are not contract IDs.
        </p>
      ) : result?.kind === "error" ? (
        <p
          role="status"
          className="mt-5 rounded-xl border border-[#f2ded5] bg-[#fbf2ee] px-4 py-4 text-sm leading-6 text-alert"
        >
          {result.error.message}
        </p>
      ) : accounting ? (
        <>
          <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {BALANCE_FIELDS.map(([label, field]) => (
              <div
                key={field}
                className="rounded-xl border border-hairline bg-canvas p-4"
              >
                <dt className="text-[10px] font-medium uppercase tracking-[0.12em] text-mist">
                  {label}
                </dt>
                <dd className="mt-3 break-all font-mono text-lg font-medium tabular-nums text-ink">
                  {formatAtomicAmount(
                    accounting[field],
                    accounting.tokenDecimals,
                  )}{" "}
                  <span className="text-xs font-normal text-mist">
                    {accounting.tokenId}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs leading-5 text-ink/55">
            Live contract accounting for campaign {accounting.campaignId}.
            Amounts use the funding token’s NEP-141 decimal precision. Available
            = funded − reserved − spent; this read is not a block-coherent
            execution authorization.
          </p>
        </>
      ) : null}
    </section>
  );
}
