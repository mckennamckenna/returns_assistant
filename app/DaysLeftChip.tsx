import { daysUntil } from "@/lib/reminders";

export function DaysLeftChip({
  returnDeadline,
  isEstimated = false,
}: {
  returnDeadline: Date | null;
  isEstimated?: boolean;
}) {
  if (!returnDeadline) {
    return <span className="inline-block text-xs font-medium text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full">—</span>;
  }

  const days = daysUntil(returnDeadline, new Date());
  const estSuffix = isEstimated ? " (est.)" : "";

  if (days < 0) {
    return (
      <span className="inline-block text-xs font-medium text-stone-500 bg-stone-100 px-2.5 py-1 rounded-full">
        Expired
      </span>
    );
  }

  if (days <= 2) {
    return (
      <span className="inline-block text-xs font-medium text-red-700 bg-red-100 px-2.5 py-1 rounded-full">
        {days} day{days === 1 ? "" : "s"} left{estSuffix}
      </span>
    );
  }

  if (days <= 7) {
    return (
      <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
        {days} days left{estSuffix}
      </span>
    );
  }

  return (
    <span className="inline-block text-xs font-medium text-green-700 bg-green-100 px-2.5 py-1 rounded-full">
      {days} days left{estSuffix}
    </span>
  );
}
