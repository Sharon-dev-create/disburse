import { ArrowUpRight, CircleCheck, CircleDashed, Clock3 } from "lucide-react";
import Reveal from "./Reveal";

const BALANCES = [
  { label: "Total funded", amount: "$28,400", note: "Contributions received", icon: CircleCheck },
  { label: "Available", amount: "$11,400", note: "Not currently reserved", icon: CircleDashed },
  { label: "Reserved", amount: "$8,200", note: "Set aside for payouts", icon: Clock3 },
  { label: "Settled", amount: "$8,800", note: "Payouts completed", icon: CircleCheck },
];

export default function FinancialControlSection() {
  return (
    <section aria-labelledby="control-heading" className="relative overflow-hidden bg-sand">
      <div aria-hidden="true" className="absolute inset-y-0 right-0 hidden w-[33%] border-l border-ink/5 lg:block" />
      <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="grid gap-11 lg:grid-cols-[0.82fr_1.18fr] lg:items-center lg:gap-16">
            <div className="relative z-10">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist sm:text-xs">Money, with context</p>
              <h2 id="control-heading" className="mt-5 max-w-lg text-4xl font-medium leading-[0.98] tracking-[-0.065em] text-ink sm:text-6xl">
                Every balance has a reason.
              </h2>
              <p className="mt-6 max-w-md text-base leading-7 text-ink/70">
                A campaign view that separates incoming funds from what is free to allocate, already set aside, or paid out.
              </p>
              <a href="#payouts" className="group mt-7 inline-flex items-center gap-2 text-sm font-medium text-forest">
                See payout activity
                <ArrowUpRight size={15} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </a>
            </div>

            <div className="relative bg-canvas px-5 py-5 shadow-[0_24px_70px_rgba(55,51,39,0.08)] sm:px-8 sm:py-7">
              <div className="flex flex-wrap items-start justify-between gap-4 border-b border-hairline pb-5">
                <div>
                  <p className="text-[9px] font-medium uppercase tracking-[0.16em] text-mist">Illustrative campaign</p>
                  <h3 className="mt-2 text-lg font-medium tracking-tight text-ink">Community fund</h3>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-hairline px-2.5 py-1 text-[9px] text-ink/60">
                  <span className="size-1.5 rounded-full bg-forest" />
                  Demo figures
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4">
                {BALANCES.map(({ label, amount, note, icon: Icon }, index) => (
                  <div key={label} className={`py-5 ${index % 2 === 1 ? "pl-4 sm:pl-5" : "pr-4 sm:pr-5"} ${index >= 2 ? "border-t border-hairline" : ""} ${index % 2 === 1 ? "border-l border-hairline" : ""} sm:border-t-0 sm:py-7 sm:first:pl-0 sm:last:pr-0 ${index > 0 ? "sm:border-l sm:pl-5" : ""}`}>
                    <div className="flex items-center gap-1.5 text-ink/55">
                      <Icon size={13} strokeWidth={1.6} aria-hidden="true" />
                      <span className="text-[10px] font-medium">{label}</span>
                    </div>
                    <p className="mt-2 font-mono text-xl font-medium tracking-[-0.06em] text-ink sm:text-[1.7rem]">{amount}</p>
                    <p className="mt-1 text-[9px] leading-4 text-ink/50">{note}</p>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-hairline pt-4">
                <p className="text-[10px] leading-4 text-ink/55">Sample figures shown for illustration only.</p>
                <span className="shrink-0 font-mono text-[9px] text-mist">CAM-042</span>
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
