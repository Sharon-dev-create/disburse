import { ArrowUpRight, Check } from "lucide-react";
import { CTA_HREF } from "@/lib/site";
import PhoneMockup from "./PhoneMockup";

export default function HeroSection() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden border-b border-hairline"
    >
      <div className="mx-auto grid w-full max-w-6xl gap-14 px-5 pb-16 pt-12 sm:px-8 sm:pb-20 sm:pt-16 lg:grid-cols-[1.02fr_0.98fr] lg:items-center lg:gap-8 lg:pb-28 lg:pt-20">
        {/* Product messaging */}
        <div className="max-w-xl">
          <p
            className="anim-enter flex items-center gap-2.5 text-[12px] font-medium uppercase tracking-[0.16em] text-mist"
            style={{ animationDelay: "60ms" }}
          >
            <span aria-hidden="true" className="size-1.5 rounded-full bg-forest" />
            Simpler campaign payments
          </p>

          <h1
            id="hero-heading"
            className="anim-enter mt-6 text-[clamp(2.5rem,5vw,3.75rem)] font-medium leading-[1.04] tracking-[-0.03em] text-ink"
            style={{ animationDelay: "140ms" }}
          >
            Move money with <span className="text-forest">confidence.</span>
          </h1>

          <p
            className="anim-enter mt-6 max-w-md text-lg leading-relaxed text-ink/70"
            style={{ animationDelay: "220ms" }}
          >
            Manage campaign funding, control budgets and track every payout in
            one place.
          </p>

          <div
            className="anim-enter mt-9 flex flex-wrap items-center gap-x-6 gap-y-4"
            style={{ animationDelay: "300ms" }}
          >
            <a
              href={CTA_HREF}
              className="group inline-flex items-center gap-2 rounded-lg bg-forest px-6 py-3.5 text-[15px] font-medium text-canvas transition-colors hover:bg-forest-deep"
            >
              Get started
              <ArrowUpRight
                className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
            </a>
            <p className="flex items-center gap-2 text-sm text-ink/70">
              <Check className="size-4 shrink-0 text-forest" aria-hidden="true" />
              Built for transparent, controlled payouts.
            </p>
          </div>
        </div>

        {/* Smartphone product preview */}
        <div className="relative flex justify-center lg:justify-end">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-8 right-[-5%] hidden w-[80%] rounded-[2.5rem] bg-sand lg:block"
          />
          <PhoneMockup />
        </div>
      </div>
    </section>
  );
}
