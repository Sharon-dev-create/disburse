import { ArrowUpRight } from "lucide-react";
import { CTA_HREF } from "@/lib/site";
import { Wordmark } from "./Wordmark";

const NAV_LINKS = [
  { href: "#features", label: "Features" },
  { href: "#how-it-works", label: "How it works" },
];

export default function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-hairline bg-canvas">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-5 sm:px-8"
      >
        <a
          href="#top"
          aria-label="Disburse — home"
          className="transition-opacity hover:opacity-80"
        >
          <Wordmark />
        </a>

        <div className="hidden items-center gap-9 sm:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-ink/70 transition-colors hover:text-ink"
            >
              {link.label}
            </a>
          ))}
          <a
            href={CTA_HREF}
            className="group inline-flex items-center gap-1.5 rounded-lg bg-forest px-4 py-2 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep"
          >
            Launch App
            <ArrowUpRight
              className="size-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
          </a>
        </div>

        <a
          href={CTA_HREF}
          className="group inline-flex items-center gap-1 rounded-lg bg-forest px-3.5 py-2 text-[13px] font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest sm:hidden"
        >
          Launch App
          <ArrowUpRight
            className="size-3.5 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            aria-hidden="true"
          />
        </a>
      </nav>
    </header>
  );
}
