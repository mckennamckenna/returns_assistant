// A null/unknown returnWindowStartsFrom defaults to orderDate in
// computeDeadline() (lib/extract.ts) — deadlineIsEstimated is set true for
// that exact branch because the anchor CHOICE is the assumption, not the
// date itself. Deliberately not using deadlineIsEstimated as the signal
// here: it also goes true for a confirmed "delivery_date" anchor whenever
// the delivery date itself is a carrier ETA or shipping-buffer guess (see
// OrderCard.tsx's deadlineConfirmed comment), which would wrongly hedge a
// confirmed anchor's label. startsFrom === null is the exact 1:1 signal for
// "the anchor itself is unconfirmed."
export function returnWindowFromLabel(startsFrom: string | null): string {
  if (startsFrom === "order_date") return "from order date";
  if (startsFrom === "delivery_date") return "from delivery date";
  return "from purchase (est.)";
}
