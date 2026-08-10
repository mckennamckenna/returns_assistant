import { daysUntil } from "./reminders";
import { DISPLAY_STATUS_LABELS } from "./displayStatus";

// CARD_SPEC.md Part 2 — the single order state machine. Slots 3 (chip) and
// 4 (action) are a pure function of this state; no other code path may
// compute them independently (that's what produced the "Kept + countdown"
// and AquaTru "Shipped forever" bugs — two facts about the same order,
// computed separately, disagreeing at runtime).
export type OrderCardState =
  | "awaiting_delivery"
  | "returnable"
  | "return_started"
  | "awaiting_refund"
  | "kept"
  | "complete";

export interface OrderCardStateInput {
  deliveredAt: Date | null;
  displayStatus: string;
}

// Reads displayStatus for every rung except the awaiting_delivery/returnable
// split, which reads deliveredAt directly — O7: "delivered" means
// deliveredAt !== null, never displayStatus alone. Checking the terminal/
// manual-decision rungs (kept/refunded/returned/return_requested) by literal
// string equality first, before ever consulting deliveredAt, is what makes
// an unarchived Kept order return to its terminal chip instead of a
// recomputed countdown — deliveredAt is never even examined once
// displayStatus says the user already decided.
export function computeOrderCardState(order: OrderCardStateInput): OrderCardState {
  if (order.displayStatus === "kept") return "kept";
  if (order.displayStatus === "refunded") return "complete";
  if (order.displayStatus === "returned") return "awaiting_refund";
  if (order.displayStatus === "return_requested") return "return_started";
  return order.deliveredAt !== null ? "returnable" : "awaiting_delivery";
}

export type OrderCardChipTone =
  | "neutral"
  | "urgent"
  | "warning"
  | "safe"
  | "progress"
  | "positive"
  | "kept"
  | "refunded";

export interface OrderCardChip {
  label: string;
  tone: OrderCardChipTone;
  // Set only in the awaiting_refund state when orderTotal is known. Part 5
  // Q5: the order total is a ceiling, not a confirmed partial-return amount
  // — multi-item orders MUST asterisk it, single-item orders may omit the
  // asterisk since there's no ambiguity about what was returned.
  amount?: { total: number; asterisked: boolean };
}

interface LineItem {
  name: string;
  price: number | null;
  quantity: number | null;
}

function isLineItemArray(value: unknown): value is LineItem[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "name" in item);
}

export function isMultiItemOrder(lineItems: unknown): boolean {
  return isLineItemArray(lineItems) && lineItems.length > 1;
}

// The mandatory gloss for an asterisked awaiting-refund amount (Part 5 Q5).
export const REFUND_AMOUNT_FOOTNOTE =
  "Full order total — we don't track which items were returned, so your refund may be less.";

export interface OrderCardChipInput {
  state: OrderCardState;
  displayStatus: string;
  estimatedDeliveryDate: Date | null;
  returnDeadline: Date | null;
  orderTotal: number | null;
  lineItems: unknown;
  now: Date;
}

// Exact copy from CARD_SPEC.md Part 2 + Part 5 Q5. One function, one call
// site per card — see app/OrderCard.tsx and the order detail page.
export function orderCardChip(input: OrderCardChipInput): OrderCardChip {
  switch (input.state) {
    case "awaiting_delivery": {
      if (input.estimatedDeliveryDate) {
        return {
          label: `Arrives ${input.estimatedDeliveryDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
          tone: "neutral",
        };
      }
      return { label: DISPLAY_STATUS_LABELS[input.displayStatus] ?? input.displayStatus, tone: "neutral" };
    }
    case "returnable": {
      if (!input.returnDeadline) return { label: "—", tone: "neutral" };
      const days = daysUntil(input.returnDeadline, input.now);
      const label = days < 0 ? "Expired" : `${days} day${days === 1 ? "" : "s"} left`;
      const tone: OrderCardChipTone = days < 0 ? "neutral" : days <= 2 ? "urgent" : days <= 7 ? "warning" : "safe";
      return { label, tone };
    }
    case "return_started":
      return { label: "Return requested", tone: "progress" };
    case "awaiting_refund": {
      if (input.orderTotal == null) return { label: "Refund pending", tone: "positive" };
      const asterisked = isMultiItemOrder(input.lineItems);
      return { label: "Refund pending", tone: "positive", amount: { total: input.orderTotal, asterisked } };
    }
    case "kept":
      return { label: "Kept", tone: "kept" };
    case "complete":
      return { label: "Refunded", tone: "refunded" };
  }
}

export type OrderCardActionId = "keep" | "start_return" | "mark_returned" | "mark_refunded";

export interface OrderCardActionSpec {
  id: OrderCardActionId;
  label: string;
}

// One row per state, exactly per CARD_SPEC.md Part 2's table — "Keep" and
// "Start Return" render as two separate buttons (mobile audit #4: never one
// ambiguous control), and both terminal states get no action (auto-archived
// the moment they're entered).
const ACTIONS_BY_STATE: Record<OrderCardState, OrderCardActionSpec[]> = {
  awaiting_delivery: [{ id: "keep", label: "Keep" }],
  returnable: [
    { id: "keep", label: "Keep" },
    { id: "start_return", label: "Start Return" },
  ],
  return_started: [{ id: "mark_returned", label: "Dropped it off?" }],
  awaiting_refund: [{ id: "mark_refunded", label: "Refund received?" }],
  kept: [],
  complete: [],
};

export function orderCardActions(state: OrderCardState): OrderCardActionSpec[] {
  return ACTIONS_BY_STATE[state];
}
