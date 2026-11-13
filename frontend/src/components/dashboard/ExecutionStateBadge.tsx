import {
  getExecutionStateLabel,
  type ExecutionJobState,
} from "@/lib/execution-api";

const STATE_CLASSES: Record<ExecutionJobState, string> = {
  Discovered: "bg-sand text-ink/70",
  Queued: "bg-sand text-ink/70",
  Leased: "bg-[#f1e8d2] text-[#765b24]",
  Preparing: "bg-[#f1e8d2] text-[#765b24]",
  SubmissionStarted: "bg-[#f1e8d2] text-[#765b24]",
  SubmissionUnknown: "bg-[#f2ded5] text-alert",
  Submitted: "bg-[#f1e8d2] text-[#765b24]",
  ConfirmationPending: "bg-[#f1e8d2] text-[#765b24]",
  VerificationPending: "bg-[#f1e8d2] text-[#765b24]",
  SettlementReady: "bg-[#f1e8d2] text-[#765b24]",
  SettlementSubmitted: "bg-[#f1e8d2] text-[#765b24]",
  Completed: "bg-[#dce9d5] text-forest",
  RetryableFailure: "bg-[#f2ded5] text-alert",
  ManualReview: "bg-[#f2ded5] text-alert",
  Abandoned: "bg-sand text-ink/70",
};

export default function ExecutionStateBadge({
  state,
}: {
  state: ExecutionJobState;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${STATE_CLASSES[state]}`}
    >
      {getExecutionStateLabel(state)}
    </span>
  );
}
