import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default function PayoutNotFound() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-4xl px-5 py-12 sm:px-8 sm:py-16 lg:px-10">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Payout unavailable</p>
        <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Payout not found</h1>
        <p className="mt-3 max-w-xl text-sm leading-6 text-ink/65">
          This ID is not included in the illustrative payout records. No live payout directory is connected.
        </p>
        <Link
          href="/dashboard/payouts"
          className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          Back to payouts
        </Link>
      </div>
    </main>
  );
}
