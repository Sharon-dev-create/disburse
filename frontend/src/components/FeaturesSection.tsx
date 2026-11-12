import Reveal from "./Reveal";

const CAPABILITIES = [
  ["01", "Campaign budgets", "Set an approved amount, then keep the balance in view."],
  ["02", "Clear accounting", "Distinguish funded, available, reserved, and settled amounts."],
  ["03", "Payout visibility", "Follow each contributor payment through its current status."],
  ["04", "Traceable activity", "Keep campaign and payout events easy to review."],
  ["05", "Deliberate execution", "Make payout decisions within a controlled workflow."],
];

export default function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-heading" className="relative overflow-hidden bg-canvas">
      <div className="mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
        <Reveal>
          <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:gap-16">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist sm:text-xs">Made for teams that move money</p>
              <h2 id="features-heading" className="mt-5 max-w-md text-4xl font-medium leading-[0.98] tracking-[-0.065em] text-ink sm:text-6xl">
                Clarity is part of the workflow.
              </h2>
              <p className="mt-5 max-w-sm text-sm leading-6 text-ink/65">
                Practical controls and a readable record, without losing sight of the people behind every payout.
              </p>
            </div>

            <div className="border-t border-hairline">
              {CAPABILITIES.map(([number, title, description], index) => (
                <article key={number} className="group grid grid-cols-[36px_minmax(0,1fr)] gap-x-3 border-b border-hairline py-5 sm:grid-cols-[48px_minmax(0,0.8fr)_minmax(0,1.2fr)] sm:items-center sm:gap-x-5 sm:py-6">
                  <span className="row-span-2 pt-1 font-mono text-[10px] text-mist sm:row-span-1">{number}</span>
                  <h3 className="text-base font-medium tracking-tight text-ink transition-transform group-hover:translate-x-1 sm:text-lg">{title}</h3>
                  <p className="col-start-2 mt-1 max-w-sm text-xs leading-5 text-ink/70 sm:col-start-auto sm:mt-0 sm:text-sm sm:leading-6">{description}</p>
                  {index === 0 ? <span className="sr-only">Core platform capability</span> : null}
                </article>
              ))}
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
