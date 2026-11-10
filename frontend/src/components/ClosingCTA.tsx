import { ArrowUpRight } from "lucide-react";
import { APP_HREF } from "@/lib/site";
import Reveal from "./Reveal";

export default function ClosingCTA() {
  return (
    <section id="get-started" aria-labelledby="closing-heading" className="relative overflow-hidden bg-sand">
      <div aria-hidden="true" className="closing-rule absolute inset-x-0 top-0 h-20" />
      <Reveal>
        <div className="relative mx-auto max-w-7xl px-5 py-20 sm:px-8 sm:py-28">
          <div className="grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-mist sm:text-xs">Bring the picture together</p>
              <h2 id="closing-heading" aria-label="Payments should be clear. Control should be yours." className="mt-5 max-w-5xl text-4xl font-medium leading-[0.94] tracking-[-0.07em] text-ink sm:text-6xl lg:text-[5.5rem]">
                Payments should be clear.
                <br />
                <span className="text-forest">Control should be yours.</span>
              </h2>
            </div>
            <a
              href={APP_HREF}
              className="group inline-flex min-h-12 w-fit items-center gap-3 rounded-full bg-forest px-5 text-sm font-medium text-canvas transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
            >
              Launch Disburse
              <ArrowUpRight size={16} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
            </a>
          </div>
          <div className="mt-12 flex items-center justify-between border-t border-ink/15 pt-4 text-[10px] uppercase tracking-[0.13em] text-ink/50">
            <span>Campaign funding & contributor payouts</span>
            <span className="font-mono tracking-normal">Disburse&nbsp; / &nbsp;02</span>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
