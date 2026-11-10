import { ArrowDownRight } from "lucide-react";
import Reveal from "./Reveal";

const STEPS = [
  {
    number: "01",
    title: "Create & approve",
    description: "Shape a campaign around a clear purpose and an approved budget.",
    cue: "Set the guardrails",
  },
  {
    number: "02",
    title: "Fund & manage",
    description: "See what came in, what is available, and what is reserved.",
    cue: "Keep funds in view",
  },
  {
    number: "03",
    title: "Execute & track",
    description: "Follow contributor payouts and understand each outcome.",
    cue: "Close the loop",
  },
];

export default function HowItWorks() {
  return (
    <section id="how-it-works" aria-labelledby="how-heading" className="relative bg-canvas">
      <div className="mx-auto max-w-7xl px-5 pb-20 pt-24 sm:px-8 sm:pb-28 sm:pt-32">
        <Reveal>
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist sm:text-xs">
              A campaign, clearly accounted for
            </p>
            <h2 id="how-heading" className="max-w-3xl text-3xl font-medium leading-[1.05] tracking-[-0.055em] text-ink sm:text-5xl lg:justify-self-end">
              From a budget decision to a payout you can follow.
            </h2>
          </div>
        </Reveal>

        <div className="relative mt-14 grid border-t border-hairline md:mt-20 md:grid-cols-3">
          {STEPS.map((step, index) => (
            <Reveal key={step.number} delay={index * 100} className="h-full">
              <article className={`relative flex h-full flex-col border-b border-hairline py-5 md:border-b-0 md:px-6 md:py-7 ${index > 0 ? "md:border-l" : "md:pl-0"} ${index === 2 ? "md:pr-0" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs text-mist">{step.number} <span className="ml-1 text-[10px]">/ 03</span></span>
                  <ArrowDownRight size={17} strokeWidth={1.5} className="text-forest" aria-hidden="true" />
                </div>
                <h3 className="mt-8 text-xl font-medium tracking-[-0.035em] text-ink sm:text-2xl">{step.title}</h3>
                <p className="mt-2 max-w-[280px] text-sm leading-6 text-ink/65">{step.description}</p>
                <p className="mt-8 border-t border-hairline pt-3 text-[10px] font-medium uppercase tracking-[0.13em] text-forest">{step.cue}</p>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
