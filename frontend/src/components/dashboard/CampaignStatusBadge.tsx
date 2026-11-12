import type { CampaignStatus } from "@/lib/campaign-demo-data";

const statusClasses: Record<CampaignStatus, string> = { Draft: "bg-sand text-ink/65", Approved: "bg-[#dce9d5] text-forest", Active: "bg-forest text-canvas", Paused: "bg-[#f1e8d2] text-[#765b24]", Completed: "bg-[#dce9d5] text-forest", Cancelled: "bg-[#f2ded5] text-alert" };
export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) { return <span className={`inline-flex rounded-full px-2.5 py-1 text-[10px] font-medium ${statusClasses[status]}`}>{status}</span>; }
