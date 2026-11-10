import {
  ArrowDownRight,
  ArrowRight,
  Check,
  CircleCheck,
  Clock3,
  FileCheck2,
  LockKeyhole,
} from "lucide-react";
import Reveal from "./Reveal";

type WalkthroughStep = {
  number: string;
  title: string;
  description: string;
  explanation: string;
  caption: string;
  Visual: () => React.JSX.Element;
};

function CampaignSetupVisual() {
  return (
    <div className="relative mx-auto w-full max-w-[500px]">
      <div className="absolute -left-3 top-12 z-10 hidden -rotate-6 items-center gap-2 border border-hairline bg-canvas px-3 py-2 text-[10px] text-ink shadow-sm sm:flex">
        <span className="flex size-5 items-center justify-center rounded-full bg-[#dce9d5] text-forest">
          <Check size={12} aria-hidden="true" />
        </span>
        Budget approved
      </div>
      <div className="border border-hairline bg-white shadow-[0_20px_55px_rgba(36,39,34,0.07)]">
        <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-5">
          <span className="flex items-center gap-2 text-[11px] font-medium text-ink">
            <FileCheck2 size={14} className="text-forest" aria-hidden="true" />
            New campaign
          </span>
          <span className="font-mono text-[9px] text-mist">DRAFT · 01</span>
        </div>
        <div className="p-4 sm:p-5">
          <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-mist">Campaign purpose</p>
          <p className="mt-1.5 text-sm font-medium text-ink">Community translation fund</p>
          <p className="mt-1 text-[10px] leading-4 text-ink/55">
            Support contributors translating community resources.
          </p>

          <div className="mt-5 grid grid-cols-[1fr_auto] items-end gap-3 border-t border-hairline pt-4">
            <div>
              <p className="text-[9px] font-medium uppercase tracking-[0.12em] text-mist">Approved budget</p>
              <p className="mt-1 font-mono text-[24px] font-medium tracking-[-0.06em] text-ink sm:text-[30px]">$10,000</p>
            </div>
            <span className="mb-1 inline-flex items-center gap-1.5 border border-hairline px-2 py-1 text-[9px] text-ink/60">
              <LockKeyhole size={10} aria-hidden="true" />
              Limit set
            </span>
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-hairline pt-3">
            <span className="text-[9px] text-ink/55">Illustrative campaign setup</span>
            <span className="flex items-center gap-1 text-[9px] font-medium text-forest">
              Ready for review <ArrowRight size={11} aria-hidden="true" />
            </span>
          </div>
        </div>
      </div>
      <p className="mt-2 text-right font-mono text-[8px] uppercase tracking-[0.12em] text-mist">
        Product illustration · sample values
      </p>
    </div>
  );
}

function FundingLedgerVisual() {
  return (
    <div className="mx-auto w-full max-w-[500px] border border-hairline bg-white shadow-[0_20px_55px_rgba(36,39,34,0.07)]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-5">
        <span className="text-[11px] font-medium text-ink">Community translation fund</span>
        <span className="border border-hairline px-2 py-1 text-[9px] text-mist">DEMO</span>
      </div>
      <div className="p-4 sm:p-5">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-mist">Total funded</p>
            <p className="mt-1 font-mono text-[27px] font-medium tracking-[-0.06em] text-ink sm:text-[34px]">$8,400</p>
          </div>
          <p className="mb-1 text-right text-[9px] leading-4 text-ink/55">of $10,000<br />approved budget</p>
        </div>

        <div aria-hidden="true" className="mt-4 flex h-2 overflow-hidden bg-sand">
          <span className="h-full w-[71.4%] bg-forest" />
          <span className="h-full flex-1 bg-[#c4c0b4]" />
        </div>
        <div className="mt-2 flex justify-between text-[8px] text-ink/50">
          <span>Available</span>
          <span>Reserved</span>
        </div>

        <div className="mt-5 grid grid-cols-2 border-y border-hairline">
          <div className="py-3 pr-3">
            <p className="text-[9px] text-ink/55">Available to allocate</p>
            <p className="mt-1 font-mono text-lg font-medium text-forest">$6,000</p>
          </div>
          <div className="border-l border-hairline py-3 pl-3">
            <p className="text-[9px] text-ink/55">Reserved for payouts</p>
            <p className="mt-1 font-mono text-lg font-medium text-ink">$2,400</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-2 text-[9px] leading-4 text-ink/55">
          <CircleCheck size={12} className="shrink-0 text-forest" aria-hidden="true" />
          $6,000 available + $2,400 reserved = $8,400 funded
        </div>
      </div>
      <p className="border-t border-hairline px-4 py-2 font-mono text-[8px] uppercase tracking-[0.12em] text-mist sm:px-5">
        Product illustration · sample values
      </p>
    </div>
  );
}

function PayoutTrackingVisual() {
  const payouts = [
    { name: "Avery Morgan", detail: "Community research", amount: "$420.00", status: "Settled", className: "bg-[#dce9d5] text-forest", icon: CircleCheck },
    { name: "Jordan Lee", detail: "Design contribution", amount: "$280.00", status: "Pending", className: "bg-[#f1e8d2] text-[#765b24]", icon: Clock3 },
    { name: "Sam Kim", detail: "Campaign support", amount: "$160.00", status: "Needs review", className: "bg-[#f2ded5] text-[#90452e]", icon: ArrowDownRight },
  ];

  return (
    <div className="mx-auto w-full max-w-[500px] border border-hairline bg-white shadow-[0_20px_55px_rgba(36,39,34,0.07)]">
      <div className="flex items-center justify-between border-b border-hairline px-4 py-3 sm:px-5">
        <div>
          <p className="text-[11px] font-medium text-ink">Contributor payouts</p>
          <p className="mt-0.5 text-[9px] text-ink/50">Community translation fund</p>
        </div>
        <span className="font-mono text-[9px] text-mist">3 EXAMPLES</span>
      </div>
      <ul className="divide-y divide-hairline px-4 sm:px-5">
        {payouts.map((payout) => {
          const Icon = payout.icon;

          return (
            <li key={payout.name} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 py-3.5">
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-medium text-ink">{payout.name}</span>
                <span className="mt-0.5 block truncate text-[9px] text-ink/50">{payout.detail}</span>
              </span>
              <span className="text-right">
                <span className="block font-mono text-[10px] tabular-nums text-ink">{payout.amount}</span>
                <span className={`mt-1 inline-flex items-center gap-1 px-2 py-0.5 text-[8px] font-medium ${payout.className}`}>
                  <Icon size={9} aria-hidden="true" />
                  {payout.status}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-start gap-2 border-t border-hairline bg-canvas px-4 py-3 sm:px-5">
        <ArrowDownRight size={12} className="mt-0.5 shrink-0 text-[#90452e]" aria-hidden="true" />
        <p className="text-[9px] leading-4 text-ink/60">
          An issue is surfaced for review. A failed payout is not automatically retried.
        </p>
      </div>
      <p className="border-t border-hairline px-4 py-2 font-mono text-[8px] uppercase tracking-[0.12em] text-mist sm:px-5">
        Product illustration · sample activity
      </p>
    </div>
  );
}

const STEPS: WalkthroughStep[] = [
  {
    number: "01",
    title: "Create a campaign with clear guardrails.",
    description:
      "Start with the purpose: who the campaign supports and what the funding is for. Then set an approved budget before money is allocated.",
    explanation:
      "A defined budget gives your team a shared limit to work within and a clear point of reference as funding and payouts progress.",
    caption:
      "A campaign begins with its purpose and approved budget. The example shown is illustrative.",
    Visual: CampaignSetupVisual,
  },
  {
    number: "02",
    title: "Know what is funded, available, and reserved.",
    description:
      "As campaign funds come in, distinguish the total funded from the portion still available to allocate and the portion already reserved for payouts.",
    explanation:
      "In this illustrative example, $8,400 is funded: $6,000 remains available and $2,400 is reserved. Reserved funds are not counted as available.",
    caption:
      "The sample figures reconcile: $6,000 available plus $2,400 reserved equals $8,400 funded.",
    Visual: FundingLedgerVisual,
  },
  {
    number: "03",
    title: "Follow each payout to its outcome.",
    description:
      "Review contributor, amount, and payout status together. Pending, settled, and items needing review each tell your team something different.",
    explanation:
      "Keep exceptions visible and decide what to do next based on their state. A failed payment is not automatically retried; eligibility requires review.",
    caption:
      "A sample activity list shows settled, pending, and review states—not live payout data.",
    Visual: PayoutTrackingVisual,
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
            <h2
              id="how-heading"
              className="max-w-3xl text-3xl font-medium leading-[1.05] tracking-[-0.055em] text-ink sm:text-5xl lg:justify-self-end"
            >
              From a budget decision to a payout you can follow.
            </h2>
          </div>
          <p className="mt-5 max-w-2xl text-sm leading-6 text-ink/65 sm:text-base sm:leading-7 lg:ml-[40%]">
            Three connected steps help your team understand how a campaign moves from an approved plan to a clearly tracked payment.
          </p>
        </Reveal>

        <div className="mt-14 border-t border-hairline md:mt-20">
          {STEPS.map((step, index) => {
            const reverse = index === 1;
            const Visual = step.Visual;

            return (
              <Reveal key={step.number} delay={index * 80}>
                <article className="grid gap-7 border-b border-hairline py-8 sm:py-10 md:grid-cols-2 md:items-center md:gap-10 lg:gap-20">
                  <div className={`order-1 ${reverse ? "md:order-2" : ""}`}>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-xs text-mist">{step.number} <span className="ml-1 text-[10px]">/ 03</span></span>
                      <span aria-hidden="true" className="h-px w-8 bg-hairline" />
                      <span className="text-[9px] font-medium uppercase tracking-[0.14em] text-forest">{step.number === "01" ? "Set the plan" : step.number === "02" ? "Manage the funds" : "Track the outcome"}</span>
                    </div>
                    <h3 className="mt-5 max-w-lg text-2xl font-medium leading-[1.08] tracking-[-0.045em] text-ink sm:text-3xl">
                      {step.title}
                    </h3>
                    <p className="mt-4 max-w-lg text-sm leading-6 text-ink/70 sm:text-base sm:leading-7">
                      {step.description}
                    </p>
                    <div className="mt-5 max-w-lg border-l-2 border-forest/25 pl-4">
                      <p className="text-[9px] font-medium uppercase tracking-[0.13em] text-mist">Why it matters</p>
                      <p className="mt-1.5 text-xs leading-5 text-ink/65 sm:text-sm sm:leading-6">
                        {step.explanation}
                      </p>
                    </div>
                  </div>

                  <figure className={`order-2 min-w-0 ${reverse ? "md:order-1" : ""}`}>
                    <div className={`relative flex min-h-[260px] items-center overflow-hidden px-4 py-8 sm:min-h-[320px] sm:px-8 ${index === 1 ? "bg-[#e9e6db]" : index === 2 ? "bg-[#e7e9e1]" : "bg-sand/60"}`}>
                      <div aria-hidden="true" className="absolute inset-0 opacity-35" style={{ backgroundImage: "radial-gradient(#898b84 0.55px, transparent 0.7px)", backgroundSize: "8px 8px" }} />
                      <div className="relative z-10 w-full">
                        <Visual />
                      </div>
                    </div>
                    <figcaption className="mt-3 flex gap-2 text-[10px] leading-4 text-ink/55 sm:text-xs sm:leading-5">
                      <span aria-hidden="true" className="mt-0.5 shrink-0 font-mono text-forest">FIG {step.number}</span>
                      <span>{step.caption}</span>
                    </figcaption>
                  </figure>
                </article>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
