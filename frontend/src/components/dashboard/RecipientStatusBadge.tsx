import type { PayoutReadiness, RecipientStatus } from "@/lib/recipient-demo-data";

const RECIPIENT_STATUS_CLASSES: Record<RecipientStatus, string> = {
  Active: "bg-[#dce9d5] text-forest",
  Invited: "bg-[#f1e8d2] text-[#765b24]",
  Inactive: "bg-sand text-ink/70",
};

const READINESS_CLASSES: Record<PayoutReadiness, string> = {
  Ready: "bg-[#dce9d5] text-forest",
  "Needs attention": "bg-[#f1e8d2] text-[#765b24]",
  Incomplete: "bg-[#f2ded5] text-alert",
};

export function RecipientStatusBadge({ status }: { status: RecipientStatus }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${RECIPIENT_STATUS_CLASSES[status]}`}>
      {status}
    </span>
  );
}

export function PayoutReadinessBadge({ status }: { status: PayoutReadiness }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${READINESS_CLASSES[status]}`}>
      {status}
    </span>
  );
}
