import { ArrowUpRight } from "lucide-react";
import Reveal from "./Reveal";

const PAYOUTS = [
  { reference: "PAY-2038", recipient: "Avery Morgan", purpose: "Community research", amount: "$420.00", status: "Settled" },
  { reference: "PAY-2039", recipient: "Jordan Lee", purpose: "Design contribution", amount: "$280.00", status: "Pending" },
  { reference: "PAY-2040", recipient: "Sam Kim", purpose: "Campaign support", amount: "$160.00", status: "Failed" },
  { reference: "PAY-2041", recipient: "Taylor Reed", purpose: "Workshop facilitation", amount: "$340.00", status: "Refunded" },
  { reference: "PAY-2042", recipient: "Casey Patel", purpose: "Research stipend", amount: "$195.00", status: "Retry eligible" },
];

const STATUS_CLASSES: Record<string, string> = {
  Settled: "bg-[#dce9d5] text-[#246b50]",
  Pending: "bg-[#f1e8d2] text-[#765b24]",
  Failed: "bg-[#f2ded5] text-[#90452e]",
  Refunded: "bg-[#e6e2d9] text-[#5b5b54]",
  "Retry eligible": "border border-[#cbd9bb] text-[#dce9d5]",
};

export default function PayoutTransparencySection() {
  return (
    <section id="payouts" aria-labelledby="payouts-heading" className="relative overflow-hidden bg-[#1f3328] text-canvas">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="grid gap-9 lg:grid-cols-[0.72fr_1.28fr] lg:items-start lg:gap-16">
            <div className="lg:sticky lg:top-28">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-canvas/55 sm:text-xs">The full story, not just the send</p>
              <h2 id="payouts-heading" className="mt-5 max-w-md text-4xl font-medium leading-[0.98] tracking-[-0.065em] sm:text-6xl">
                Know where each payout stands.
              </h2>
              <p className="mt-6 max-w-sm text-sm leading-6 text-canvas/70 sm:text-base sm:leading-7">
                From waiting on a result to resolving an exception, keep payout activity legible for your team.
              </p>
              <p className="mt-8 border-l border-canvas/30 pl-4 text-xs leading-5 text-canvas/60">
                Example activity only. A failed payout is not automatically resubmitted; retry eligibility depends on review.
              </p>
            </div>

            <div className="min-w-0">
              <div className="flex items-end justify-between border-b border-canvas/20 pb-3 text-[9px] font-medium uppercase tracking-[0.15em] text-canvas/45">
                <span>Illustrative activity</span>
                <span className="font-mono tracking-normal">Recent&nbsp; / &nbsp;05</span>
              </div>
              <div className="hidden grid-cols-[1.25fr_0.9fr_0.7fr_auto] gap-3 py-3 text-[9px] font-medium uppercase tracking-[0.13em] text-canvas/45 sm:grid">
                <span>Contributor</span>
                <span>Campaign</span>
                <span>Amount</span>
                <span className="text-right">Status</span>
              </div>
              <ul>
                {PAYOUTS.map((payout, index) => (
                  <li key={payout.reference} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-t border-canvas/15 py-4 sm:grid-cols-[1.25fr_0.9fr_0.7fr_auto] sm:gap-3 sm:py-5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-canvas">{payout.recipient}</p>
                      <p className="mt-1 font-mono text-[9px] text-canvas/45">{payout.reference}</p>
                    </div>
                    <p className="hidden truncate text-xs text-canvas/65 sm:block">{payout.purpose}</p>
                    <p className="font-mono text-xs tabular-nums text-canvas/85">{payout.amount}</p>
                    <span className={`justify-self-end rounded-full px-2.5 py-1 text-[9px] font-medium ${STATUS_CLASSES[payout.status]} ${payout.status === "Retry eligible" ? "bg-transparent" : ""}`}>
                      {payout.status}
                    </span>
                    <p className="col-span-2 -mt-1 truncate text-[10px] text-canvas/45 sm:hidden">{payout.purpose}</p>
                    {index === 4 ? (
                      <span className="sr-only">Retry eligibility is shown as a review state and does not indicate automatic resubmission.</span>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-5 flex items-center justify-between border-t border-canvas/20 pt-4 text-[10px] text-canvas/55">
                <span>Every status is part of the record.</span>
                <span aria-hidden="true" className="flex size-8 items-center justify-center rounded-full border border-canvas/25">
                  <ArrowUpRight size={14} />
                </span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
