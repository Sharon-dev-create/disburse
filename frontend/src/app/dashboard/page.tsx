import { ArrowUpRight, BadgeDollarSign, CircleCheck, Clock3, UsersRound, WalletCards } from "lucide-react";
import Link from "next/link";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import MetricCard from "@/components/dashboard/MetricCard";
import RecentActivity from "@/components/dashboard/RecentActivity";
import { demoRecipients, isRecipientPayoutReady } from "@/lib/recipient-demo-data";

const campaigns = [
  { name: "Community translation fund", id: "CAM-042", funded: "$12,400", used: 68, status: "Active" },
  { name: "Open source contributor pool", id: "CAM-041", funded: "$8,000", used: 44, status: "Active" },
  { name: "Design residency", id: "CAM-039", funded: "$4,800", used: 91, status: "Closing" },
];
const payoutReadyRecipients = demoRecipients.filter(isRecipientPayoutReady).length;

export default function DashboardPage() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div className="mb-7 flex flex-col justify-between gap-4 rounded-2xl bg-[#1f3328] px-5 py-5 text-canvas sm:flex-row sm:items-end sm:px-6">
          <div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-canvas/60">Demo data</p><p className="mt-1 max-w-xl text-sm leading-6 text-canvas/85">These figures illustrate a financial operations workflow. They do not represent live balances, payments, or settlement activity.</p></div>
          <span className="shrink-0 font-mono text-[10px] text-canvas/55">Updated just now</span>
        </div>

        <section aria-label="Key metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <MetricCard label="Funded balance" value="$25,200" detail="All campaign contributions received" icon={WalletCards} tone="forest" />
          <MetricCard label="Available balance" value="$9,180" detail="Funded, not reserved or settled" icon={BadgeDollarSign} />
          <MetricCard label="Reserved balance" value="$6,420" detail="Committed to payouts not yet settled" icon={Clock3} />
          <MetricCard label="Settled payouts" value="$9,600" detail="Payouts completed from funded balance" icon={CircleCheck} />
        </section>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.28fr)_minmax(20rem,0.72fr)]">
          <section id="campaigns" aria-labelledby="campaigns-heading" className="rounded-2xl border border-hairline bg-white">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6"><div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Demo campaigns</p><h2 id="campaigns-heading" className="mt-1 text-base font-medium tracking-tight text-ink">Campaign health</h2></div><a href="#recipients" className="inline-flex items-center gap-1 text-xs font-medium text-forest">View recipients <ArrowUpRight size={13} aria-hidden="true" /></a></div>
            <ul className="divide-y divide-hairline">
              {campaigns.map((campaign) => (
                <li key={campaign.id} className="px-5 py-5 sm:px-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-sm font-medium text-ink">{campaign.name}</p><p className="mt-1 font-mono text-[10px] text-mist">{campaign.id} · {campaign.funded} funded</p></div><span className={`rounded-full px-2.5 py-1 text-[10px] font-medium ${campaign.status === "Active" ? "bg-[#dce9d5] text-forest" : "bg-[#f1e8d2] text-[#765b24]"}`}>{campaign.status}</span></div><div className="mt-4 flex items-center gap-3"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-sand"><div className="h-full rounded-full bg-forest" style={{ width: `${campaign.used}%` }} /></div><span className="font-mono text-[10px] text-ink/60">{campaign.used}% allocated</span></div></li>
              ))}
            </ul>
          </section>
          <section id="recipients" aria-labelledby="recipients-heading" className="rounded-2xl border border-hairline bg-sand p-5 sm:p-6"><div className="flex size-10 items-center justify-center rounded-full bg-white text-forest"><UsersRound size={18} aria-hidden="true" /></div><p className="mt-6 text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Recipients</p><h2 id="recipients-heading" className="mt-2 text-xl font-medium tracking-[-0.04em] text-ink">{demoRecipients.length} illustrative recipients</h2><p className="mt-3 text-sm leading-6 text-ink/65">{payoutReadyRecipients} records pass basic format checks. Address ownership and payout eligibility are not verified.</p><Link href="/dashboard/recipients" className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-forest underline decoration-forest/30 underline-offset-4">View recipients <ArrowUpRight size={14} aria-hidden="true" /></Link></section>
        </div>

        <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1.28fr)_minmax(20rem,0.72fr)]"><RecentActivity /><section id="settlements" aria-labelledby="settlements-heading" className="rounded-2xl border border-hairline bg-white p-5 sm:p-6"><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Settlement status</p><h2 id="settlements-heading" className="mt-1 text-base font-medium tracking-tight text-ink">Controlled resolution</h2><div className="mt-6 space-y-4"><div className="flex justify-between border-b border-hairline pb-4 text-sm"><span className="text-ink/65">Verified settlements</span><span className="font-mono text-ink">42</span></div><div className="flex justify-between border-b border-hairline pb-4 text-sm"><span className="text-ink/65">Awaiting verification</span><span className="font-mono text-ink">3</span></div><div className="flex justify-between text-sm"><span className="text-ink/65">Manual review</span><span className="font-mono text-alert">1</span></div></div><p className="mt-6 text-xs leading-5 text-ink/55">Illustrative status only. No payment is automatically retried from this dashboard.</p></section></div>
      </div>
    </main>
  );
}
