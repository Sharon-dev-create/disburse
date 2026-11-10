import { Activity, BadgeCheck, CircleDollarSign, Eye, LockKeyhole } from "lucide-react";
import Reveal from "./Reveal";

const FEATURES = [
  {
    title: "Campaign budget control",
    description: "Set approved budgets and keep available funds in view.",
    icon: CircleDollarSign,
  },
  {
    title: "Transparent accounting",
    description: "Understand what is funded, reserved, and ready to allocate.",
    icon: Eye,
  },
  {
    title: "Payout tracking",
    description: "Follow each payout through pending, settled, or failed states.",
    icon: Activity,
  },
  {
    title: "Traceable activity",
    description: "Keep a clear record of campaign and payout activity.",
    icon: BadgeCheck,
  },
  {
    title: "Controlled execution",
    description: "Make payout decisions within a deliberate operational workflow.",
    icon: LockKeyhole,
  },
];

export default function FeaturesSection() {
  return (
    <section id="features" aria-labelledby="features-heading" className="bg-white/55">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-8 sm:py-24">
        <Reveal>
          <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
            <div className="max-w-xl">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-mist">Built for clarity</p>
              <h2 id="features-heading" className="mt-4 text-3xl font-medium tracking-[-0.03em] text-ink sm:text-[2.5rem]">
                Financial operations, in focus.
              </h2>
            </div>
            <p className="max-w-sm text-sm leading-6 text-ink/65">
              The detail your team needs to manage campaign money with care.
            </p>
          </div>
        </Reveal>

        <div className="mt-11 grid gap-x-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ title, description, icon: Icon }, index) => (
            <Reveal key={title} delay={index * 60}>
              <article className="flex gap-4 border-t border-hairline py-5">
                <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-sand/70 text-forest">
                  <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-sm font-semibold text-ink">{title}</h3>
                  <p className="mt-1.5 max-w-xs text-sm leading-5 text-ink/65">{description}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
