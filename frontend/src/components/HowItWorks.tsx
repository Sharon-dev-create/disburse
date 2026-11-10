import { ArrowDownToLine, CircleDollarSign, ClipboardList } from "lucide-react";
import Reveal from "./Reveal";

const STEPS = [
  {
    number: "01",
    title: "Create a campaign",
    description: "Set up a campaign and define its approved budget.",
    icon: ClipboardList,
  },
  {
    number: "02",
    title: "Fund and manage",
    description: "Track incoming funds and control available and reserved balances.",
    icon: CircleDollarSign,
  },
  {
    number: "03",
    title: "Execute payouts",
    description: "Monitor payout progress and see the outcome of every payment.",
    icon: ArrowDownToLine,
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="border-b border-hairline">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal>
          <div className="max-w-xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-mist">A clearer workflow</p>
            <h2 id="how-heading" className="mt-4 text-3xl font-medium tracking-[-0.03em] text-ink sm:text-[2.5rem]">
              From campaign to payout.
            </h2>
            <p className="mt-4 max-w-lg text-base leading-7 text-ink/65">
              Keep every step visible, from setting a budget to understanding each payout outcome.
            </p>
          </div>
        </Reveal>

        <div className="mt-12 grid gap-8 sm:grid-cols-3 sm:gap-6">
          {STEPS.map(({ number, title, description, icon: Icon }, index) => (
            <Reveal key={number} delay={index * 100}>
              <article className="h-full border-t border-hairline pt-5">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-mist">{number}</span>
                  <Icon size={19} strokeWidth={1.6} className="text-forest" aria-hidden="true" />
                </div>
                <h3 className="mt-6 text-lg font-medium tracking-tight text-ink">{title}</h3>
                <p className="mt-2 max-w-xs text-sm leading-6 text-ink/65">{description}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
