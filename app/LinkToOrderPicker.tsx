"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { linkEmailToOrderAction, createOrderFromEmailAction } from "./actions";
import { formatCalendarDateShort } from "@/lib/dateDisplay";
import { createNewOrderEscapeHatchLabel, runCreateNewOrderEscapeHatch } from "@/lib/shipmentUnlinkedPicker";

function formatOrderTotal(total: number | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD" }).format(total);
  } catch {
    return `$${total}`;
  }
}

export interface LinkablePickerOrder {
  id: string;
  retailer: string | null;
  orderNumber: string | null;
  orderDate: Date | null;
  orderTotal: number | null;
}

// CARD_SPEC.md Part 3 — "Link to order" is a manual picker in v1: the user
// scrolls the full order list themselves and taps the target. Deliberately
// dumb, no auto-suggestion/search this pass — sidesteps the "squirrelly
// sender" problem entirely, since a human eyeballing the list doesn't care
// what the sender string said.
//
// showCreateNewEscapeHatch (TASKS.md 🔴 Now, shipment_unlinked ticket,
// Stage 4 Part 4b, 2026-08-31) — the picker's list here is still the full,
// unfiltered active-order list (retailer-filtering was scoped for this
// ticket and then deferred, see 👀 Watching), so a shipment_unlinked row
// (a delivery/shipping_confirmation/order_confirmation email with a known
// retailer but no order number) can easily have no correct order to pick
// from the list even when candidates exist. Without an escape hatch here,
// that's a dead end — the row's only other actions are Archive and More
// info, neither of which resolves it.
//
// Rendered as a pinned-first LIST ITEM, not a separate button below the
// list (owner decision 2026-08-31, correcting the first pass of this
// build) — "none of these, it's actually a new order" is a valid answer
// to the picker's own question ("which order is this?"), not a different
// question, so it belongs inside the same list the real candidates render
// in. Wired to the same createOrderFromEmailAction the real_purchase_
// no_record "Start a new order" button uses (NeedsReviewRowActions.tsx),
// same confirm-step copy, so the two "create a new order" entry points
// behave identically. Visibility/copy/click-orchestration logic lives in
// lib/shipmentUnlinkedPicker.ts, not inline here, so it's unit-testable
// without a component-rendering harness (none exists in this repo yet).
export function LinkToOrderPicker({
  emailId,
  orders,
  showCreateNewEscapeHatch = false,
  retailer = null,
  className = "",
}: {
  emailId: string;
  orders: LinkablePickerOrder[];
  showCreateNewEscapeHatch?: boolean;
  retailer?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handlePick(orderId: string) {
    setPending(true);
    try {
      await linkEmailToOrderAction(emailId, orderId);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  async function handleCreateNew() {
    setPending(true);
    try {
      // Same confirm copy as NeedsReviewRowActions.tsx's create_new_order
      // path — one user-facing "create a new order" action, two entry
      // points, identical behavior either way.
      const created = await runCreateNewOrderEscapeHatch(
        emailId,
        () => window.confirm("Create a new order from this email?"),
        createOrderFromEmailAction,
      );
      if (created) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} className={className}>
        Merge with existing order
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-72 max-h-80 overflow-y-auto bg-card border border-border rounded-lg shadow-lg p-2 flex flex-col gap-1">
            <p className="text-xs text-muted px-2 py-1">Which order is this?</p>
            {showCreateNewEscapeHatch && (
              <button
                type="button"
                onClick={handleCreateNew}
                disabled={pending}
                className="text-left text-sm text-secondary hover:bg-page rounded px-2 py-1.5 disabled:opacity-50 mb-1 pb-2 border-b border-border"
              >
                {createNewOrderEscapeHatchLabel(retailer)}
              </button>
            )}
            {orders.length === 0 && !showCreateNewEscapeHatch && (
              <p className="text-xs text-muted px-2 py-1">No orders to link to yet.</p>
            )}
            {orders.map((order) => (
              <button
                key={order.id}
                type="button"
                onClick={() => handlePick(order.id)}
                disabled={pending}
                className="text-left text-sm text-ink hover:bg-page rounded px-2 py-1.5 disabled:opacity-50"
              >
                <span className="block truncate">{order.retailer ?? "Unknown retailer"}</span>
                <span className="block text-xs text-muted truncate">
                  {order.orderNumber ? `#${order.orderNumber}` : ""}
                  {order.orderNumber && order.orderDate ? " · " : ""}
                  {/* lib/dateDisplay.ts — reads the UTC calendar-date
                      components (TASKS.md 2026-08-27); also normalizes this
                      from the locale-numeric "8/22/2026" it used to render
                      to match every other calendar-date site in the app. */}
                  {order.orderDate ? formatCalendarDateShort(order.orderDate) : ""}
                  {(order.orderNumber || order.orderDate) && formatOrderTotal(order.orderTotal) ? " · " : ""}
                  {formatOrderTotal(order.orderTotal) ?? ""}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
