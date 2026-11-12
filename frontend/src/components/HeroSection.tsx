import { ArrowDown, ArrowUpRight } from "lucide-react";
import { CTA_HREF } from "@/lib/site";
import PhoneMockup from "./PhoneMockup";

export default function HeroSection() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="hero-section relative isolate overflow-hidden bg-forest text-canvas"
    >
      <div aria-hidden="true" className="hero-grain pointer-events-none absolute inset-0 opacity-30" />
      <div className="relative mx-auto grid min-h-[720px] max-w-7xl items-center gap-8 px-5 pb-12 pt-16 sm:px-8 sm:pb-16 lg:min-h-[760px] lg:grid-cols-[1.08fr_0.92fr] lg:gap-0 lg:pb-20 lg:pt-12">
        <div className="relative z-10 min-w-0 pb-2 lg:pb-10">
          <p className="anim-enter flex items-center gap-3 text-[10px] font-medium uppercase tracking-[0.2em] text-canvas sm:text-xs">
            <span aria-hidden="true" className="h-px w-8 bg-canvas/55" />
            Financial operations, made clear
          </p>

          <h1
            id="hero-heading"
            aria-label="Move money with confidence."
            className="hero-heading anim-enter mt-7 max-w-[780px] text-[clamp(3.55rem,8vw,7.6rem)] font-semibold leading-[0.86] tracking-[-0.075em] text-canvas"
            style={{ animationDelay: "100ms" }}
          >
            Move money
            <br />
            with <span className="font-medium italic text-[#d7e3bd]">confidence.</span>
          </h1>

          <p
            className="anim-enter mt-7 max-w-[430px] text-base leading-7 text-canvas sm:mt-9 sm:text-lg sm:leading-8"
            style={{ animationDelay: "180ms" }}
          >
            Manage campaign funding, protect budgets, and follow every payout from reservation to settlement.
          </p>

          <div className="anim-enter mt-8 flex flex-wrap items-center gap-x-7 gap-y-4" style={{ animationDelay: "260ms" }}>
            <a
              href={CTA_HREF}
              className="group inline-flex min-h-12 items-center gap-3 rounded-full bg-canvas px-5 text-sm font-medium text-forest transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-canvas"
            >
              Get started
              <ArrowUpRight size={16} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
            <a
              href="#how-it-works"
              className="inline-flex min-h-12 items-center gap-2 text-sm text-canvas underline decoration-canvas/35 underline-offset-4 transition-colors hover:text-canvas"
            >
              Explore how it works
              <ArrowDown size={14} aria-hidden="true" />
            </a>
          </div>

          <div className="mt-14 hidden items-center gap-5 text-[10px] font-medium uppercase tracking-[0.16em] text-canvas sm:flex lg:mt-20">
            <span>Funding</span>
            <span aria-hidden="true" className="h-px w-8 bg-canvas/30" />
            <span>Budgets</span>
            <span aria-hidden="true" className="h-px w-8 bg-canvas/30" />
            <span>Payouts</span>
          </div>
        </div>

        <div className="hero-device-stage relative mx-auto flex w-full max-w-[520px] items-center justify-center py-4 lg:min-h-[640px] lg:py-0">
          <div aria-hidden="true" className="hero-device-orbit absolute inset-0" />
          <div aria-hidden="true" className="absolute left-[3%] top-[15%] z-20 hidden -rotate-6 border border-forest/10 bg-canvas px-4 py-3 text-forest shadow-[0_12px_35px_rgba(12,40,26,0.12)] sm:block">
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-ink/70">Campaign funding</p>
            <p className="mt-1 font-mono text-lg font-medium">$24,800</p>
            <p className="mt-0.5 text-[10px] text-forest">Illustrative demo</p>
          </div>
          <div className="relative z-10 w-[min(100%,324px)] rotate-[2deg]">
            <PhoneMockup />
          </div>
          <div aria-hidden="true" className="absolute bottom-[13%] right-[-1%] z-20 hidden rotate-3 border border-white/15 bg-[#1d5b42] px-4 py-3 text-canvas shadow-[0_16px_40px_rgba(12,40,26,0.16)] sm:block">
            <p className="text-[9px] font-medium uppercase tracking-[0.14em] text-canvas">Payout activity</p>
            <p className="mt-1 text-sm font-medium">Every step, accounted for.</p>
          </div>
        </div>

        <div className="col-span-full flex items-center justify-between border-t border-canvas/20 pt-4 text-[10px] font-medium uppercase tracking-[0.13em] text-canvas sm:text-[11px] lg:mt-[-22px]">
          <span>Campaigns to contributors</span>
          <span className="font-mono tracking-normal">A clearer way to move funds&nbsp; / &nbsp;01</span>
        </div>
      </div>
      <div aria-hidden="true" className="hero-bridge relative z-10 mx-auto -mb-12 h-24 max-w-7xl px-5 sm:px-8">
        <div className="hero-bridge-shape h-full w-full" />
      </div>
    </section>
  );
}
