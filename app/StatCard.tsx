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
    <div className={`bg-white border border-stone-200 ${ACCENT_BORDER[accent]} border-t-[3px] rounded-xl p-6`}>
      <div className="text-sm text-stone-500">{label}</div>
      <div className="font-playfair text-3xl text-stone-800 mt-1">{value}</div>
      {sublabel && <div className="text-xs text-stone-400 mt-1">{sublabel}</div>}
    </div>
  );
}
