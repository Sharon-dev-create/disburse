import { Bell, ChevronDown } from "lucide-react";

export default function DashboardHeader() {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline bg-canvas px-5 py-5 sm:px-8 lg:px-10">
      <div>
        <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.16em] text-mist">
          <span>Workspace</span><span aria-hidden="true">/</span><span>Cedar Collective</span>
          <span className="rounded-full bg-[#dce9d5] px-2 py-0.5 text-[9px] tracking-[0.1em] text-forest">Demo</span>
        </div>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.04em] text-ink sm:text-3xl">Financial overview</h1>
      </div>
      <div className="flex items-center gap-2">
        <button type="button" aria-label="View notifications" className="inline-flex size-10 items-center justify-center rounded-full border border-hairline bg-white text-ink/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
          <Bell size={17} aria-hidden="true" />
        </button>
        <button type="button" className="flex min-h-10 items-center gap-2 rounded-full border border-hairline bg-white py-1 pl-1 pr-3 text-sm font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
          <span className="flex size-8 items-center justify-center rounded-full bg-forest text-[10px] text-canvas">CC</span>
          <span className="hidden sm:block">Cedar Collective</span><ChevronDown size={14} aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
