import type { LucideIcon } from "lucide-react";

type MetricCardProps = {
  label: string;
  value: string;
  detail: string;
  icon: LucideIcon;
  tone?: "forest" | "neutral";
};

export default function MetricCard({ label, value, detail, icon: Icon, tone = "neutral" }: MetricCardProps) {
  const highlighted = tone === "forest";
  return (
    <article className={`rounded-2xl border p-5 ${highlighted ? "border-forest bg-forest text-canvas" : "border-hairline bg-white text-ink"}`}>
      <div className="flex items-start justify-between gap-3">
        <p className={`text-xs font-medium ${highlighted ? "text-canvas/75" : "text-ink/65"}`}>{label}</p>
        <span className={`flex size-8 items-center justify-center rounded-full ${highlighted ? "bg-canvas/15" : "bg-sand text-forest"}`}><Icon size={15} aria-hidden="true" /></span>
      </div>
      <p className="mt-7 font-mono text-2xl font-medium tracking-[-0.06em] tabular-nums sm:text-3xl">{value}</p>
      <p className={`mt-2 text-xs ${highlighted ? "text-canvas/70" : "text-ink/55"}`}>{detail}</p>
    </article>
  );
}
