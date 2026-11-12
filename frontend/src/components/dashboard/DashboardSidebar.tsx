"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CircleDollarSign,
  LayoutDashboard,
  Menu,
  X,
} from "lucide-react";
import { Wordmark } from "@/components/Wordmark";

const navigation = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/dashboard/campaigns", label: "Campaigns", icon: CircleDollarSign },
];

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Dashboard navigation" className="space-y-1">
      {navigation.map(({ href, label, icon: Icon }) => {
        const active = href === "/dashboard" ? pathname === href : pathname.startsWith(href);
        return <Link
          key={label}
          href={href}
          onClick={onNavigate}
          aria-current={active ? "page" : undefined}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
            active
              ? "bg-forest text-canvas shadow-sm"
              : "text-ink/70 hover:bg-sand hover:text-ink"
          }`}
        >
          <Icon size={17} aria-hidden="true" />
          {label}
        </Link>;
      })}
    </nav>
  );
}

export default function DashboardSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-hairline bg-canvas px-4 py-6 lg:flex">
        <Link href="/" aria-label="Disburse home" className="px-3 focus-visible:rounded-sm focus-visible:outline-2 focus-visible:outline-forest">
          <Wordmark size="sm" />
        </Link>
        <div className="mt-9"><Navigation /></div>
        <div className="mt-auto rounded-xl border border-hairline bg-white p-4">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Workspace</p>
          <p className="mt-1 text-sm font-medium text-ink">Cedar Collective</p>
          <p className="mt-2 text-xs leading-5 text-ink/60">Demo workspace with illustrative financial data.</p>
        </div>
      </aside>

      <div className="sticky top-0 z-40 flex h-16 items-center justify-between border-b border-hairline bg-canvas/95 px-5 backdrop-blur lg:hidden">
        <Link href="/" aria-label="Disburse home"><Wordmark size="sm" /></Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls="dashboard-mobile-menu"
          onClick={() => setOpen(true)}
          className="inline-flex size-10 items-center justify-center rounded-lg border border-hairline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest"
        >
          <Menu size={19} aria-hidden="true" /><span className="sr-only">Open navigation</span>
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden" id="dashboard-mobile-menu">
          <button type="button" aria-label="Close navigation" onClick={() => setOpen(false)} className="absolute inset-0 bg-ink/25" />
          <aside className="relative flex h-full w-[min(20rem,86vw)] flex-col bg-canvas px-5 py-6 shadow-2xl">
            <div className="flex items-center justify-between">
              <Link href="/" onClick={() => setOpen(false)} aria-label="Disburse home"><Wordmark size="sm" /></Link>
              <button type="button" onClick={() => setOpen(false)} className="inline-flex size-10 items-center justify-center rounded-lg border border-hairline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
                <X size={19} aria-hidden="true" /><span className="sr-only">Close navigation</span>
              </button>
            </div>
            <div className="mt-9"><Navigation onNavigate={() => setOpen(false)} /></div>
            <p className="mt-auto rounded-xl bg-sand p-4 text-xs leading-5 text-ink/65">Cedar Collective is a demo workspace. All data shown is illustrative.</p>
          </aside>
        </div>
      ) : null}
    </>
  );
}
