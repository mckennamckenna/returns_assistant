import { daysUntil } from "@/lib/reminders";

// Number always renders Ink (return-window-design-tokens.md §2 — "Days-left
// number" color token is Ink regardless of tint), only the pill background
// and "days left" label take the per-state tint color.
function Pill({ bg, labelColor, days, estSuffix }: { bg: string; labelColor: string; days: number; estSuffix: string }) {
  return (
    <span className={`inline-flex items-baseline gap-1 text-xs font-medium px-2.5 py-1 rounded-full ${bg}`}>
      <span className="font-serif text-ink">{days}</span>
      <span className={labelColor}>
        day{days === 1 ? "" : "s"} left{estSuffix}
      </span>
    </span>
  );
}

export function DaysLeftChip({
  returnDeadline,
  isEstimated = false,
}: {
  returnDeadline: Date | null;
  isEstimated?: boolean;
}) {
  if (!returnDeadline) {
    return <span className="inline-block text-xs font-medium text-muted bg-page px-2.5 py-1 rounded-full">—</span>;
  }

  const days = daysUntil(returnDeadline, new Date());
  const estSuffix = isEstimated ? " (est.)" : "";

  if (days < 0) {
    return (
      <span className="inline-block text-xs font-medium text-muted bg-page px-2.5 py-1 rounded-full">
        Expired
      </span>
    );
  }

  // ≤2-day urgency tint isn't in the design doc's status-tint table —
  // left on its original red, only the number/label split applied.
  if (days <= 2) {
    return <Pill bg="bg-red-100" labelColor="text-red-700" days={days} estSuffix={estSuffix} />;
  }

  // Closing soon (≤7 days) — return-window-design-tokens.md §3
  if (days <= 7) {
    return <Pill bg="bg-[#F4EBD8]" labelColor="text-[#9A7A45]" days={days} estSuffix={estSuffix} />;
  }

  // Safe (>7 days) — return-window-design-tokens.md §3
  return <Pill bg="bg-[#E9F0E4]" labelColor="text-[#5E7052]" days={days} estSuffix={estSuffix} />;
}
