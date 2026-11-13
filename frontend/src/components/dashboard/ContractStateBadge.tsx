import {
  getContractStatusLabel,
  type ContractPayoutStatus,
} from "@/lib/execution-api-shared";

const STATUS_CLASSES: Record<ContractPayoutStatus, string> = {
  Created: "bg-sand text-ink/70",
  Authorized: "bg-sand text-ink/70",
  Reserved: "bg-[#f1e8d2] text-[#765b24]",
  Executing: "bg-[#f1e8d2] text-[#765b24]",
  PendingVerification: "bg-[#f1e8d2] text-[#765b24]",
  Succeeded: "bg-[#dce9d5] text-forest",
  Failed: "bg-[#f2ded5] text-alert",
  RefundPending: "bg-[#f2ded5] text-alert",
  Refunded: "bg-sand text-ink/70",
  ManualReview: "bg-[#f2ded5] text-alert",
  ReservationReleased: "bg-sand text-ink/70",
};

export default function ContractStateBadge({
  status,
}: {
  status: ContractPayoutStatus;
}) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${STATUS_CLASSES[status]}`}
    >
      {getContractStatusLabel(status)}
    </span>
  );
}
