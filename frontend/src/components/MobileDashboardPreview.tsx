import { Home, Layers3, ReceiptText } from "lucide-react";

const PAYOUTS = [
  { initials: "AM", name: "Avery Morgan", detail: "Community research", amount: "$420.00", status: "Settled" },
  { initials: "JL", name: "Jordan Lee", detail: "Design contribution", amount: "$280.00", status: "Pending" },
  { initials: "SK", name: "Sam Kim", detail: "Campaign support", amount: "$160.00", status: "Settled" },
];

export default function MobileDashboardPreview() {
  return (
    <div className="relative mx-auto w-full max-w-[282px] overflow-hidden rounded-[2rem] border border-white/80 bg-white shadow-[0_12px_35px_rgba(36,39,34,0.07)]">
      <div className="px-5 pb-3 pt-5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-forest text-xs font-semibold text-canvas">
              D
            </span>
            <span className="text-sm font-semibold tracking-tight text-ink">Disburse</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-sand/70 px-2.5 py-1 text-[9px] font-medium text-ink/70">
            <span className="size-1.5 rounded-full bg-forest" />
            Demo preview
          </span>
        </div>
      </div>

      <div className="px-5 pb-4">
        <p className="text-xs font-medium text-ink/60">Good morning, Alex</p>
        <div className="mt-4 flex items-center justify-between">
          <h2 className="text-[17px] font-semibold tracking-tight text-ink">Overview</h2>
          <span className="rounded-md border border-hairline px-2 py-1 text-[9px] text-ink/60">This month</span>
        </div>

        <div className="mt-3 rounded-xl bg-forest p-4 text-canvas">
          <p className="text-[10px] text-canvas/75">Total funded <span className="text-canvas/60">· illustrative</span></p>
          <p className="mt-1 font-mono text-[25px] font-medium tracking-tight">$12,480.00</p>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-canvas/20 pt-3">
            <div>
              <p className="text-[9px] text-canvas/70">Available</p>
              <p className="mt-1 font-mono text-[13px]">$8,320.00</p>
            </div>
            <div>
              <p className="text-[9px] text-canvas/70">Reserved</p>
              <p className="mt-1 font-mono text-[13px]">$4,160.00</p>
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between">
          <h3 className="text-[13px] font-semibold text-ink">Recent payouts</h3>
          <span className="text-[10px] font-medium text-forest">View all</span>
        </div>

        <ul className="mt-2 divide-y divide-hairline">
          {PAYOUTS.map((payout) => (
            <li key={payout.name} className="flex items-center gap-2.5 py-3">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sand text-[9px] font-semibold text-ink/70">
                {payout.initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[10px] font-medium text-ink">{payout.name}</span>
                <span className="mt-0.5 block truncate text-[9px] text-ink/55">{payout.detail}</span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-[10px] text-ink">{payout.amount}</span>
                <span
                  className={`mt-0.5 block text-[8px] font-medium ${
                    payout.status === "Settled" ? "text-forest" : "text-ink/55"
                  }`}
                >
                  {payout.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <nav aria-label="Demo app navigation" className="grid grid-cols-3 border-t border-hairline bg-white px-3 py-2.5">
        <span className="flex flex-col items-center gap-1 text-forest">
          <Home size={14} aria-hidden="true" />
          <span className="text-[8px]">Home</span>
        </span>
        <span className="flex flex-col items-center gap-1 text-ink/45">
          <Layers3 size={14} aria-hidden="true" />
          <span className="text-[8px]">Campaigns</span>
        </span>
        <span className="flex flex-col items-center gap-1 text-ink/45">
          <ReceiptText size={14} aria-hidden="true" />
          <span className="text-[8px]">Activity</span>
        </span>
      </nav>
    </div>
  );
}
