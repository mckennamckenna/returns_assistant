"use client";

import { useState } from "react";
import Link from "next/link";
import type { Order } from "@prisma/client";
import { RetailerAvatar } from "./RetailerAvatar";
import { OrderStateChip } from "./OrderStateChip";
import { ArchiveOrDeletePrompt } from "./ArchiveOrDeletePrompt";
import { StartReturnButton } from "./StartReturnButton";
import { MarkRefundedButton } from "./MarkRefundedButton";
import { markReturnedAction, markKeptAction } from "./actions";
import { KEPT_WARNING_CAPTION } from "@/lib/displayStatus";
import { truncateOrderNumber } from "@/lib/orderNumberDisplay";
import { computeOrderCardState, orderCardChip, orderCardActions, REFUND_AMOUNT_FOOTNOTE } from "@/lib/orderCardState";

// CARD_SPEC.md Part 5 Q2 — reuse the Amazon bundle's inline-overflow limit
// (app/AmazonBundleCard.tsx's `.slice(0, 5)`), don't invent a second number.
const LINE_ITEM_OVERFLOW_LIMIT = 5;

// Exactly the Order fields this component reads — lets callers with a
// trimmed `select` (e.g. lib/alerts.ts's getAlertOrders) satisfy this prop
// without fetching the whole row. A full `Order` object still satisfies
// this type structurally, so callers that do fetch full rows (the main
// dashboard list) are unaffected.
export type OrderCardOrder = Pick<
  Order,
  | "id"
  | "retailer"
  | "orderNumber"
  | "displayStatus"
  | "deliveredAt"
  | "estimatedDeliveryDate"
  | "returnDeadline"
  | "orderTotal"
  | "orderCurrency"
  | "lineItems"
  | "returnCarrier"
  | "returnPortalUrl"
  | "archivedAt"
  | "trackingNumber"
  | "trackingUrl"
  | "returnTrackingNumber"
  | "returnTrackingUrl"
>;

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(total: number | null, currency: string | null): string {
  if (total == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

interface LineItem {
  name: string;
  price: number | null;
  quantity: number | null;
}

function isLineItemArray(value: unknown): value is LineItem[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "name" in item);
}

function itemSummary(lineItems: unknown): string | null {
  if (!isLineItemArray(lineItems) || lineItems.length === 0) return null;
  const [first, ...rest] = lineItems;
  return rest.length > 0 ? `${first.name} +${rest.length} more` : first.name;
}

// Slot 2 (context) per CARD_SPEC.md Part 2's table — it's state-driven too,
// not just slots 3/4: return_started swaps to the return-carrier line, kept/
// complete drop context entirely, everything else shows items · price.
function slotTwoContext(order: OrderCardOrder, itemSummaryText: string | null): string | null {
  const state = computeOrderCardState(order);
  switch (state) {
    case "return_started":
      return order.returnCarrier ? `${order.returnCarrier} QR code` : "QR code";
    case "kept":
    case "complete":
      return null;
    default:
      return itemSummaryText;
  }
}

// The redesigned order card, used for every order at every breakpoint —
// return-window-design-tokens.md §6 Commit 2. Slots 3 (chip) and 4 (action)
// are a pure function of computeOrderCardState() (lib/orderCardState.ts,
// CARD_SPEC.md Part 2) — no other code path computes them, which is the
// structural fix for the "Kept + countdown" class of bug.
export function OrderCard({ order, now }: { order: OrderCardOrder; now: Date }) {
  const [expanded, setExpanded] = useState(false);

  const state = computeOrderCardState(order);
  const chip = orderCardChip({
    state,
    displayStatus: order.displayStatus,
    estimatedDeliveryDate: order.estimatedDeliveryDate,
    returnDeadline: order.returnDeadline,
    orderTotal: order.orderTotal,
    lineItems: order.lineItems,
    now,
  });
  const actions = orderCardActions(state).map((a) => a.id);
  const showKeep = actions.includes("keep");
  const showStartReturn = actions.includes("start_return");
  const showMarkReturned = actions.includes("mark_returned");
  const showMarkRefunded = actions.includes("mark_refunded");
  const hasAnyAction = showKeep || showStartReturn || showMarkReturned || showMarkRefunded;

  const itemSummaryText = itemSummary(order.lineItems);
  const contextText = slotTwoContext(order, itemSummaryText);
  const lineItems: LineItem[] = isLineItemArray(order.lineItems) ? order.lineItems : [];
  const visibleLineItems = lineItems.slice(0, LINE_ITEM_OVERFLOW_LIMIT);
  const hasOverflow = lineItems.length > LINE_ITEM_OVERFLOW_LIMIT;

  return (
    <div className="bg-card border border-border rounded-2xl p-[18px]">
      {/* Slot 1 (identity) + Slot 3 (chip) on top; Slot 2 (context) below on
          mobile, inline on desktop. Same underlying data at every
          breakpoint — layout-only split, same as before. */}
      <div className="md:hidden flex items-start gap-3">
        <Link href={`/orders/${order.id}`} className="flex items-start gap-3 flex-1 min-w-0">
          <RetailerAvatar name={order.retailer || "?"} />
          <div className="min-w-0">
            <div className="text-lg font-medium text-ink truncate">{order.retailer || "Unknown retailer"}</div>
            {(order.orderNumber || contextText) && (
              <div className="text-xs text-muted truncate">
                {order.orderNumber && (
                  <span title={order.orderNumber} aria-label={`Order number ${order.orderNumber}`}>
                    #{truncateOrderNumber(order.orderNumber)}
                  </span>
                )}
                {order.orderNumber && contextText && " · "}
                {contextText}
              </div>
            )}
          </div>
        </Link>
        <OrderStateChip
          chip={chip}
          formatAmount={(total) => formatCurrency(total, order.orderCurrency)}
        />
      </div>

      <div className="hidden md:block">
        <div className="flex items-center gap-3">
          <RetailerAvatar name={order.retailer || "?"} />
          <Link href={`/orders/${order.id}`} className="min-w-0 flex-1 flex items-center gap-2">
            <span className="text-lg font-medium text-ink truncate shrink-0 max-w-[45%]">
              {order.retailer || "Unknown retailer"}
            </span>
            {order.orderNumber && (
              <span
                className="text-xs text-muted truncate"
                title={order.orderNumber}
                aria-label={`Order number ${order.orderNumber}`}
              >
                · #{truncateOrderNumber(order.orderNumber)}
              </span>
            )}
          </Link>
          <div className="shrink-0">
            <OrderStateChip
              chip={chip}
              formatAmount={(total) => formatCurrency(total, order.orderCurrency)}
            />
          </div>
        </div>
        {contextText && <p className="text-xs text-muted truncate mt-1 ml-[60px]">{contextText}</p>}
      </div>

      {chip.amount?.asterisked && (
        <p className="text-[10px] text-muted mt-1">{REFUND_AMOUNT_FOOTNOTE}</p>
      )}

      {/* Price display — shown whenever slot 2 is "items · price" per the
          Part 2 table (awaiting_delivery / returnable / awaiting_refund).
          "Return by" only where the deadline is still the actionable fact —
          Part 5 Q5: awaiting_refund keeps price visible ("the price is
          what's being refunded") without a return-by date, since the return
          has already happened. */}
      {(state === "awaiting_delivery" || state === "returnable" || state === "awaiting_refund") && (
        <div className="flex items-baseline justify-between flex-wrap gap-x-2 gap-y-1 mt-3">
          <span className="font-serif text-[27px] font-semibold text-ink">
            {formatCurrency(order.orderTotal, order.orderCurrency)}
          </span>
          {(state === "awaiting_delivery" || state === "returnable") && (
            <span className="text-[13px] text-muted">Return by {formatDate(order.returnDeadline)}</span>
          )}
        </div>
      )}
      {order.orderTotal == null && state !== "kept" && state !== "complete" && (
        <p className="text-xs text-muted mt-1">Forward your order confirmation to add the total</p>
      )}

      {/* Slot 4 (action) — pure function of state, per computeOrderCardState
          above. Only one row of primary actions can ever render. */}
      {hasAnyAction && (
        <div className="flex items-center gap-2 mt-4">
          {showStartReturn && (
            <StartReturnButton
              orderId={order.id}
              returnPortalUrl={order.returnPortalUrl}
              className="flex-1 min-w-0 truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90 disabled:opacity-50 md:flex-none md:w-auto"
            />
          )}
          {showMarkReturned && (
            <form action={markReturnedAction.bind(null, order.id)} className="flex-1 min-w-0 md:flex-none">
              <button type="submit" className="w-full md:w-auto truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90">
                Dropped it off?
              </button>
            </form>
          )}
          {showMarkRefunded && (
            <MarkRefundedButton
              orderId={order.id}
              className="flex-1 min-w-0 truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90 text-center md:flex-none md:w-auto"
            />
          )}
          {showKeep && (
            <form action={markKeptAction.bind(null, order.id)} className="flex-1 min-w-0 md:flex-none flex flex-col items-start gap-1">
              <button type="submit" className="w-full md:w-auto truncate border border-border text-ink text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-page">
                Keep
              </button>
              <p className="text-[10px] text-muted">{KEPT_WARNING_CAPTION}</p>
            </form>
          )}
        </div>
      )}

      {/* CARD_SPEC.md Part 5 Q7 — no "⋯", no glyph, no swipe/gesture. The
          collapsed row is unchanged above; expand reveals per-item lines and
          exactly two secondary controls: "more info" + "Archive" (the row
          stays four controls, not five). */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse order details" : "Expand order details"}
        className="w-full text-center text-muted text-xs py-1 mt-2 hover:text-ink"
      >
        {expanded ? "▴" : "▾"}
      </button>

      {expanded && (
        <div className="mt-2 flex flex-col gap-3 border-t border-border pt-3">
          {visibleLineItems.length > 0 && (
            <ul className="flex flex-col gap-1">
              {visibleLineItems.map((item, i) => (
                <li key={i} className="flex justify-between gap-2 text-sm">
                  <span className="truncate text-ink">
                    {item.name}
                    {item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : ""}
                  </span>
                  <span className="text-secondary whitespace-nowrap">
                    {item.price != null ? formatCurrency(item.price, order.orderCurrency) : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {hasOverflow && (
            <Link href={`/orders/${order.id}`} className="text-sm font-medium text-ink underline">
              View all {lineItems.length} items
            </Link>
          )}
          {(order.trackingNumber && order.trackingUrl) && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-secondary underline"
            >
              Track package
            </a>
          )}
          {(order.returnTrackingNumber && order.returnTrackingUrl) && (
            <a
              href={order.returnTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-secondary underline"
            >
              Track your return
            </a>
          )}
          <div className="flex items-center gap-4">
            <Link href={`/orders/${order.id}`} className="text-sm font-medium text-ink underline">
              more info
            </Link>
            <ArchiveOrDeletePrompt
              orderId={order.id}
              isArchived={order.archivedAt !== null}
              className="text-sm font-medium text-ink underline"
            />
          </div>
        </div>
      )}
    </div>
  );
}
