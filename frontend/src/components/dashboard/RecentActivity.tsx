const activity = [
  { initials: "AM", name: "Avery Morgan", campaign: "Community research", amount: "$420.00", status: "Settled", tone: "settled" },
  { initials: "JL", name: "Jordan Lee", campaign: "Design contribution", amount: "$280.00", status: "Verifying", tone: "review" },
  { initials: "SK", name: "Sam Kim", campaign: "Campaign support", amount: "$160.00", status: "Reserved", tone: "reserved" },
  { initials: "TR", name: "Taylor Reed", campaign: "Workshop facilitation", amount: "$340.00", status: "Review needed", tone: "review" },
];

const statusClasses: Record<string, string> = {
  settled: "bg-[#dce9d5] text-forest",
  review: "bg-[#f1e8d2] text-[#765b24]",
  reserved: "bg-sand text-ink/65",
};

export default function RecentActivity() {
  return (
    <section id="payouts" aria-labelledby="recent-payouts-heading" className="rounded-2xl border border-hairline bg-white">
      <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-4 sm:px-6">
        <div><p className="text-[10px] font-medium uppercase tracking-[0.16em] text-mist">Illustrative activity</p><h2 id="recent-payouts-heading" className="mt-1 text-base font-medium tracking-tight text-ink">Recent payouts</h2></div>
        <a href="#settlements" className="text-xs font-medium text-forest underline decoration-forest/30 underline-offset-4">View settlements</a>
      </div>
      <ul className="divide-y divide-hairline">
        {activity.map((item) => (
          <li key={item.name} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-4 sm:px-6">
            <span className="flex size-9 items-center justify-center rounded-full bg-sand text-[10px] font-medium text-ink/70">{item.initials}</span>
            <div className="min-w-0"><p className="truncate text-sm font-medium text-ink">{item.name}</p><p className="mt-0.5 truncate text-xs text-ink/55">{item.campaign}</p></div>
            <div className="text-right"><p className="font-mono text-xs tabular-nums text-ink">{item.amount}</p><span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[9px] font-medium ${statusClasses[item.tone]}`}>{item.status}</span></div>
          </li>
        ))}
      </ul>
    </section>
  );
}
