import { CircleDollarSign } from "lucide-react";
import Link from "next/link";
import DashboardHeader from "@/components/dashboard/DashboardHeader";

export default function CampaignsPage() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
            Configured contract state
          </p>
          <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">
            Campaigns
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
            Campaigns are read from the configured NEAR Testnet contract through
            the read-only execution service when a numeric campaign ID is known.
          </p>
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          Read-only demo: contract{" "}
          <span className="font-mono">disburse-topg.testnet</span> is paused.
          No campaigns, payouts, funding actions, or transactions are created by
          this interface.
        </p>

        <section
          className="mt-8 overflow-hidden rounded-2xl border border-hairline bg-white"
          aria-labelledby="campaign-list-heading"
        >
          <div className="flex items-center gap-3 border-b border-hairline px-5 py-4 sm:px-6">
            <span className="flex size-8 items-center justify-center rounded-full bg-sand text-forest">
              <CircleDollarSign size={16} aria-hidden="true" />
            </span>
            <div>
              <h2 id="campaign-list-heading" className="text-base font-medium text-ink">
                Campaign list
              </h2>
              <p className="text-xs text-ink/65">Live contract-backed records</p>
            </div>
          </div>

          <div className="px-6 py-14 text-center">
            <p className="text-sm font-medium text-ink">
              No campaigns currently exist
            </p>
            <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              The configured deployed contract{" "}
              <span className="font-mono">disburse-topg.testnet</span> has zero
              campaigns at this time. Because the contract is paused and this is
              a read-only demo, no campaign records are created or funded here.
            </p>
            <p className="mt-4 text-sm text-ink/65">
              You can check a specific numeric campaign ID from the{" "}
              <Link
                href="/dashboard"
                className="font-medium text-forest underline decoration-forest/30 underline-offset-4"
              >
                dashboard overview
              </Link>
              ; missing IDs return a not-found response from the execution
              service.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
