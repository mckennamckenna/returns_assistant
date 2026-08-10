import type { OrderCardChip, OrderCardChipTone } from "@/lib/orderCardState";

// CARD_SPEC.md Part 1 — "the payoff": slots 3 and 4 read from one state
// machine, so there is exactly one chip per order, never two independently-
// sourced badges rendered side by side (that's how "Kept" + a live countdown
// could show at once). Tones carry over the exact colors the two retired
// components (DisplayStatusBadge/DaysLeftChip) used for the same states, so
// this is a structural change, not a visual one.
const TONE_STYLES: Record<OrderCardChipTone, string> = {
  neutral: "bg-[#EEEDEB] text-[#6E665C]",
  urgent: "bg-red-100 text-red-700",
  warning: "bg-[#F4EBD8] text-accent",
  safe: "bg-[#E9F0E4] text-[#5E7052]",
  progress: "bg-[#E7EBEF] text-[#4E5A68]",
  positive: "bg-green-100 text-green-700",
  kept: "bg-slate-100 text-slate-600",
  refunded: "bg-purple-100 text-purple-700",
};

export function OrderStateChip({
  chip,
  formatAmount,
}: {
  chip: OrderCardChip;
  // Currency formatting stays with the caller (it already knows
  // order.orderCurrency) — this component only decides tone/asterisk.
  formatAmount?: (total: number) => string;
}) {
  return (
    <span className={`inline-block text-xs font-medium px-2.5 py-1 rounded-full ${TONE_STYLES[chip.tone]}`}>
      {chip.label}
      {chip.amount && formatAmount && (
        <>
          {" · "}
          {formatAmount(chip.amount.total)}
          {chip.amount.asterisked && "*"}
        </>
      )}
    </span>
  );
}
