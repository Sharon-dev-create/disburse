import Link from "next/link";
import { Plus } from "lucide-react";
import DashboardHeader from "@/components/dashboard/DashboardHeader";
import RecipientDirectory from "@/components/dashboard/RecipientDirectory";
import {
  demoRecipients,
  isRecipientPayoutReady,
  needsRecipientAttention,
} from "@/lib/recipient-demo-data";

const activeCount = demoRecipients.filter((recipient) => recipient.status === "Active").length;
const readyCount = demoRecipients.filter(isRecipientPayoutReady).length;
const attentionCount = demoRecipients.filter(needsRecipientAttention).length;

const metrics = [
  { label: "Total recipients", value: demoRecipients.length },
  { label: "Active recipients", value: activeCount },
  { label: "Payout-ready (demo check)", value: readyCount },
  { label: "Require attention", value: attentionCount },
];

export default function RecipientsPage() {
  return (
    <main className="min-w-0 flex-1">
      <DashboardHeader showTitle={false} />
      <div className="mx-auto max-w-7xl px-5 py-7 sm:px-8 sm:py-10 lg:px-10">
        <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Demo directory</p>
            <h1 className="mt-2 text-3xl font-medium tracking-[-0.05em] text-ink">Recipients</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-ink/65">
              Review recipient contact details and destination configuration. No payout is initiated from this directory.
            </p>
          </div>
          <Link
            href="/dashboard/recipients/new"
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-forest px-4 text-sm font-medium text-canvas transition-colors hover:bg-forest-deep focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-forest"
          >
            <Plus size={16} aria-hidden="true" />
            Add recipient
          </Link>
        </div>

        <p className="mt-6 rounded-xl border border-[#dce9d5] bg-[#eff5eb] px-4 py-3 text-xs leading-5 text-forest">
          These {demoRecipients.length} records are illustrative frontend data. “Payout-ready” is only a format/configuration check; it does not verify address ownership or payout eligibility.
        </p>

        <section aria-label="Recipient summary" className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map(({ label, value }) => (
            <article key={label} className="rounded-xl border border-hairline bg-white p-4">
              <h2 className="text-[10px] font-medium uppercase tracking-[0.12em] text-mist">{label}</h2>
              <p className="mt-3 font-mono text-xl font-medium tracking-[-0.05em] tabular-nums text-ink">{value}</p>
            </article>
          ))}
        </section>

        <RecipientDirectory />
      </div>
    </main>
  );
}
