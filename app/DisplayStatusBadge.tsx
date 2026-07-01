import { DISPLAY_STATUS_LABELS } from "@/lib/displayStatus";

const STATUS_STYLES: Record<string, string> = {
  ordered: "bg-stone-100 text-stone-600",
  shipped: "bg-blue-100 text-blue-700",
  return_requested: "bg-amber-100 text-amber-700",
  returned: "bg-green-100 text-green-700",
  refunded: "bg-purple-100 text-purple-700",
};

export function DisplayStatusBadge({ status }: { status: string }) {
  const label = DISPLAY_STATUS_LABELS[status] ?? status;
  const style = STATUS_STYLES[status] ?? "bg-stone-100 text-stone-600";
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${style}`}>
      {label}
    </span>
  );
}
