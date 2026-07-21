import { daysUntil } from "@/lib/reminders";
import { DISPLAY_STATUS_LABELS } from "@/lib/displayStatus";

// Strict, case-insensitive match on the retailer field — same signal already
// used in scripts/backfill-amazon-orderdate.ts. Deliberately narrow (per
// AMAZON_HANDLING.md 2.4): Zappos, Whole Foods, and other marketplace-adjacent
// retailers must NOT match here.
export function isAmazonOrder(retailer: string | null): boolean {
  return (retailer ?? "").toLowerCase().includes("amazon");
}

export type AmazonOrderLike = {
  displayStatus: string;
  deliveredAt: Date | null;
  estimatedDeliveryDate: Date | null;
  returnDeadline: Date | null;
};

// AMAZON_HANDLING.md O7: displayStatus alone can't distinguish "in transit"
// from "delivered, decision pending" — both derive to "shipped". This is the
// resolution: deliveredAt (not displayStatus) is what actually means
// "delivered." A manually-advanced return_requested/returned always takes
// priority over the delivered-countdown reading, since the user has already
// acted past the point a days-left count is still the relevant fact.
export function isDeliveredDecisionPending(order: AmazonOrderLike): boolean {
  return order.deliveredAt !== null && order.displayStatus !== "return_requested" && order.displayStatus !== "returned";
}

export function amazonRowLabel(order: AmazonOrderLike, now: Date): string {
  if (order.displayStatus === "return_requested" || order.displayStatus === "returned") {
    return DISPLAY_STATUS_LABELS[order.displayStatus];
  }

  if (order.deliveredAt) {
    if (!order.returnDeadline) return "Delivered";
    const days = daysUntil(order.returnDeadline, now);
    if (days < 0) return "Expired";
    return `${days} day${days === 1 ? "" : "s"} left`;
  }

  if (order.estimatedDeliveryDate) {
    return `Arrives ${order.estimatedDeliveryDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
  }

  return DISPLAY_STATUS_LABELS[order.displayStatus] ?? order.displayStatus;
}

type Bucket = "delivered" | "in_transit" | "ordered" | "return_started" | "awaiting_refund";

const BUCKET_LABEL: Record<Bucket, string> = {
  delivered: "delivered",
  in_transit: "in transit",
  ordered: "ordered",
  return_started: "return started",
  awaiting_refund: "awaiting refund",
};

const BUCKET_ORDER: Bucket[] = ["delivered", "in_transit", "ordered", "return_started", "awaiting_refund"];

function bucketFor(order: AmazonOrderLike): Bucket {
  if (order.displayStatus === "returned") return "awaiting_refund";
  if (order.displayStatus === "return_requested") return "return_started";
  if (order.deliveredAt) return "delivered";
  if (order.displayStatus === "shipped") return "in_transit";
  return "ordered";
}

// e.g. "4 delivered · 2 in transit · 1 ordered" — only non-empty buckets
// shown, in a fixed priority order so the summary reads consistently.
export function amazonComposition(orders: AmazonOrderLike[]): string {
  const counts: Record<Bucket, number> = {
    delivered: 0,
    in_transit: 0,
    ordered: 0,
    return_started: 0,
    awaiting_refund: 0,
  };
  for (const order of orders) counts[bucketFor(order)]++;

  return BUCKET_ORDER.filter((bucket) => counts[bucket] > 0)
    .map((bucket) => `${counts[bucket]} ${BUCKET_LABEL[bucket]}`)
    .join(" · ");
}

// Nulls sort last — a missing deadline isn't "soonest," it's unknown.
export function compareNullableDate(a: Date | null, b: Date | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return a.getTime() - b.getTime();
}

// The earliest actionable deadline among "active" children — delivered,
// decision-pending orders only (AMAZON_HANDLING.md 1.3/2.2: awaiting-refund
// contributes no deadline, not-yet-delivered has no clock running yet, and
// return_requested's own drop-off/label deadline isn't tracked as a distinct
// field in the current schema, so it's excluded from this calculation too —
// a deliberate v1 simplification, flagged in TASKS.md).
export function earliestAmazonDeadline(orders: AmazonOrderLike[]): Date | null {
  const deadlines = orders
    .filter(isDeliveredDecisionPending)
    .map((o) => o.returnDeadline)
    .filter((d): d is Date => d !== null);
  if (deadlines.length === 0) return null;
  return deadlines.reduce((earliest, d) => (d < earliest ? d : earliest));
}
