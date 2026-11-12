import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default function CampaignNotFound() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-3xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Campaign unavailable</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Campaign not found</h1>
        <p className="mt-3 text-sm leading-6 text-ink/65">
          This campaign ID is not included in the illustrative demo records.
        </p>
        <Link
          href="/dashboard/campaigns"
          className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to campaigns
        </Link>
      </div>
    </main>
  );
}
