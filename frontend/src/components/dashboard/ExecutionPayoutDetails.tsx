import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import ContractStateBadge from "@/components/dashboard/ContractStateBadge";
import ExecutionStateBadge from "@/components/dashboard/ExecutionStateBadge";
import {
  formatAtomicAmount,
  formatTokenIdentity,
} from "@/lib/execution-api-shared";
import type {
  ContractPayout,
  ExecutionDataResult,
  PersistedExecutionJob,
} from "@/lib/execution-api-shared";

type Props = {
  payoutId: string;
  contractResult: ExecutionDataResult<ContractPayout>;
  executionResult: ExecutionDataResult<PersistedExecutionJob> | null;
};

export default function ExecutionPayoutDetails({
  payoutId,
  contractResult,
  executionResult,
}: Props) {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-6xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <Link
          href="/dashboard/payouts"
          className="inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to payouts
        </Link>

        {contractResult.kind === "error" ? (
          <section
            role="status"
            className="mt-8 rounded-2xl border border-[#f2ded5] bg-white p-6"
          >
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-alert">
              {contractResult.error.kind === "not-found"
                ? "Payout not found"
                : "Payout data unavailable"}
            </p>
            <h1 className="mt-2 break-all font-mono text-2xl font-medium text-ink">
              {payoutId}
            </h1>
            <p className="mt-3 text-sm leading-6 text-ink/65">
              {contractResult.error.message}
            </p>
          </section>
        ) : (
          <PayoutRecord
            payout={contractResult.data}
            executionResult={executionResult}
          />
        )}
      </div>
    </main>
  );
}

function PayoutRecord({
  payout,
  executionResult,
}: {
  payout: ContractPayout;
  executionResult: ExecutionDataResult<PersistedExecutionJob> | null;
}) {
  const job =
    executionResult?.kind === "success" ? executionResult.data : null;
  const executionError =
    executionResult?.kind === "error" ? executionResult.error : null;

  return (
    <>
      <div className="mt-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-forest">
            Current contract payout
          </p>
          <h1 className="mt-2 break-all font-mono text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">
            {payout.id}
          </h1>
          <p className="mt-2 text-sm text-ink/65">
            Campaign{" "}
            <Link
              href={`/dashboard/campaigns/${payout.campaignId}`}
              className="font-mono text-forest underline decoration-forest/30 underline-offset-4"
            >
              {payout.campaignId}
            </Link>
          </p>
        </div>
        <ContractStateBadge status={payout.status} />
      </div>

      <p className="mt-6 rounded-xl border border-[#f1e8d2] bg-[#fbf7ed] px-4 py-3 text-xs leading-5 text-[#765b24]">
        Contract state and persisted execution state are separate records. The
        execution service does not independently verify destination-chain
        delivery; a “Completed” job is not proof of settlement.
      </p>

      <section
        aria-labelledby="contract-state-heading"
        className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              Contract state
            </p>
            <h2 id="contract-state-heading" className="mt-1 text-base font-medium text-ink">
              Latest configured contract read
            </h2>
          </div>
          <ContractStateBadge status={payout.status} />
        </div>
        <dl className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <dt className="text-xs text-ink/65">Source input</dt>
            <dd className="mt-1 font-mono text-sm font-medium text-ink">
              {formatAtomicAmount(
                payout.source.atomicAmount,
                payout.source.decimals,
              )}{" "}
              {formatTokenIdentity(payout.source.token)}
            </dd>
            <dd className="mt-1 text-xs text-ink/55">
              {payout.source.networkId}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/65">Destination</dt>
            <dd className="mt-1 break-all font-mono text-xs leading-5 text-ink">
              {payout.destination.recipientAddress}
            </dd>
            <dd className="mt-1 text-xs text-ink/55">
              {payout.destination.networkId}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-ink/65">Expected output</dt>
            <dd className="mt-1 font-mono text-sm font-medium text-ink">
              {formatAtomicAmount(
                payout.destination.expectedAtomicAmount,
                payout.destination.decimals,
              )}{" "}
              {formatTokenIdentity(payout.destination.token)}
            </dd>
            <dd className="mt-1 text-xs text-ink/55">
              Expected amount only; no quote or verified output is exposed.
            </dd>
          </div>
          {payout.executionReference ? (
            <div>
              <dt className="text-xs text-ink/65">Contract execution reference</dt>
              <dd className="mt-1 break-all font-mono text-xs text-ink">
                {payout.executionReference}
              </dd>
            </div>
          ) : null}
          {payout.settlementEvidenceReference ? (
            <div>
              <dt className="text-xs text-ink/65">Settlement evidence reference</dt>
              <dd className="mt-1 break-all font-mono text-xs text-ink">
                {payout.settlementEvidenceReference}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section
        aria-labelledby="execution-state-heading"
        className="mt-8 rounded-2xl border border-hairline bg-white p-5 sm:p-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
              PostgreSQL job record
            </p>
            <h2 id="execution-state-heading" className="mt-1 text-base font-medium text-ink">
              Execution state
            </h2>
          </div>
          {job ? <ExecutionStateBadge state={job.state} /> : null}
        </div>

        {executionError?.kind === "not-found" ? (
          <p className="mt-5 rounded-xl border border-dashed border-hairline bg-canvas px-4 py-4 text-sm leading-6 text-ink/65">
            No persisted execution job has been discovered for this contract
            payout.
          </p>
        ) : executionError ? (
          <p
            role="status"
            className="mt-5 rounded-xl border border-[#f2ded5] bg-[#fbf2ee] px-4 py-4 text-sm leading-6 text-alert"
          >
            {executionError.message}
          </p>
        ) : job ? (
          <>
            <p className="mt-4 text-xs leading-5 text-ink/65">
              The job’s saved contract status is{" "}
              <strong className="font-medium text-ink">
                {job.observedContractStatus}
              </strong>{" "}
              from discovery; the current contract read above is authoritative
              for present contract state.
            </p>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <dt className="text-xs text-ink/65">Job ID</dt>
                <dd className="mt-1 font-mono text-xs text-ink">{job.jobId}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink/65">Recorded attempts</dt>
                <dd className="mt-1 font-mono text-xs text-ink">
                  {job.attemptCount}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink/65">Created</dt>
                <dd className="mt-1 font-mono text-[10px] text-ink">
                  <time dateTime={job.createdAt}>{job.createdAt}</time>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink/65">Updated</dt>
                <dd className="mt-1 font-mono text-[10px] text-ink">
                  <time dateTime={job.updatedAt}>{job.updatedAt}</time>
                </dd>
              </div>
              {job.leaseExpiresAt ? (
                <div>
                  <dt className="text-xs text-ink/65">Persisted lease expiry</dt>
                  <dd className="mt-1 font-mono text-[10px] text-ink">
                    <time dateTime={job.leaseExpiresAt}>
                      {job.leaseExpiresAt}
                    </time>
                  </dd>
                </div>
              ) : null}
              {job.failureCode ? (
                <div>
                  <dt className="text-xs text-ink/65">Failure code</dt>
                  <dd className="mt-1 font-mono text-xs text-alert">
                    {job.failureCode}
                  </dd>
                </div>
              ) : null}
            </dl>
            {job.attempts.length > 0 ? (
              <ol className="mt-6 space-y-3 border-t border-hairline pt-4">
                {job.attempts.map((attempt) => (
                  <li
                    key={attempt.sequence}
                    className="flex flex-wrap justify-between gap-2 text-xs"
                  >
                    <span className="text-ink">
                      Attempt {attempt.sequence} · {attempt.phase} ·{" "}
                      {attempt.outcome}
                    </span>
                    <time
                      dateTime={attempt.startedAt}
                      className="font-mono text-[10px] text-mist"
                    >
                      {attempt.startedAt}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-5 text-xs text-ink/55">
                No execution attempts are recorded.
              </p>
            )}
          </>
        ) : (
          <p
            role="status"
            className="mt-5 rounded-xl border border-[#f2ded5] bg-[#fbf2ee] px-4 py-4 text-sm leading-6 text-alert"
          >
            Execution state was not requested.
          </p>
        )}
      </section>

      <p className="mt-6 text-xs leading-5 text-ink/55">
        This read-only view does not expose transaction hashes, recipient
        ownership verification, actual destination output, or independent
        settlement evidence.
      </p>
    </>
  );
}
