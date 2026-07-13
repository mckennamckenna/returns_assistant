type Accent = "rose" | "amber" | "sage";

const ACCENT_BORDER: Record<Accent, string> = {
  rose: "border-t-rose-500",
  amber: "border-t-amber-500",
  sage: "border-t-sage",
};

export function StatCard({
  label,
  value,
  sublabel,
  accent,
}: {
  label: string;
  value: string;
  sublabel?: string;
  accent: Accent;
}) {
  return (
    <div className={`bg-card border border-border ${ACCENT_BORDER[accent]} border-t-[3px] rounded-xl p-6`}>
      <div className="text-sm text-secondary">{label}</div>
      <div className="font-serif text-3xl text-ink mt-1">{value}</div>
      {sublabel && <div className="text-xs text-muted mt-1">{sublabel}</div>}
    </div>
  );
}
