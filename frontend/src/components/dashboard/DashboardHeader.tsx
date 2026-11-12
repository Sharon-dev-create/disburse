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
      <p className="rounded-full border border-hairline bg-white px-3 py-2 text-xs text-ink/60">
        Illustrative workspace
      </p>
    </header>
  );
}
