import { DISPLAY_STATUS_LABELS } from "@/lib/displayStatus";

// Neutral / Return-initiated tints from return-window-design-tokens.md §3.
// returned/refunded/kept aren't covered by the doc's status-tint table —
// left on their pre-existing colors.
const STATUS_STYLES: Record<string, string> = {
  ordered: "bg-[#EEEDEB] text-[#6E665C]",
  shipped: "bg-[#EEEDEB] text-[#6E665C]",
  return_requested: "bg-[#E7EBEF] text-[#4E5A68]",
  returned: "bg-green-100 text-green-700",
  refunded: "bg-purple-100 text-purple-700",
  kept: "bg-slate-100 text-slate-600",
};

export function DisplayStatusBadge({ status }: { status: string }) {
  const label = DISPLAY_STATUS_LABELS[status] ?? status;
  const style = STATUS_STYLES[status] ?? "bg-[#EEEDEB] text-[#6E665C]";
  return (
    <span className={`inline-block text-xs font-medium px-2 py-0.5 rounded ${style}`}>
      {label}
    </span>
  );
}
