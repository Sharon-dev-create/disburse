import { ArrowUpRight } from "lucide-react";
import { APP_HREF } from "@/lib/site";
import Reveal from "./Reveal";

export default function ClosingCTA() {
  return (
    <section id="get-started" aria-labelledby="closing-heading" className="border-y border-hairline bg-sand/55">
      <Reveal>
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 px-5 py-16 sm:px-8 sm:py-20 md:flex-row md:items-center">
          <div className="max-w-2xl">
            <p className="text-xs font-medium uppercase tracking-[0.16em] text-mist">A better way to move money</p>
            <h2 id="closing-heading" className="mt-4 text-3xl font-medium leading-tight tracking-[-0.03em] text-ink sm:text-[2.6rem]">
              Payments should be clear. Control should be yours.
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-ink/65">
              Bring campaign funding and contributor payouts into one transparent workflow.
            </p>
          </div>
          <a
            href={APP_HREF}
            className="group inline-flex shrink-0 items-center gap-2 rounded-lg bg-forest px-5 py-3 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
          >
            Launch Disburse
            <ArrowUpRight size={16} aria-hidden="true" className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
          </a>
        </div>
      </Reveal>
    </section>
  );
}
