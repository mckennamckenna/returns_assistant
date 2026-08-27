"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { linkEmailToOrderAction } from "./actions";
import { formatCalendarDateShort } from "@/lib/dateDisplay";

export interface LinkablePickerOrder {
  id: string;
  retailer: string | null;
  orderNumber: string | null;
  orderDate: Date | null;
}

// CARD_SPEC.md Part 3 — "Link to order" is a manual picker in v1: the user
// scrolls the full order list themselves and taps the target. Deliberately
// dumb, no auto-suggestion/search this pass — sidesteps the "squirrelly
// sender" problem entirely, since a human eyeballing the list doesn't care
// what the sender string said.
export function LinkToOrderPicker({
  emailId,
  orders,
  className = "",
}: {
  emailId: string;
  orders: LinkablePickerOrder[];
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
            {orders.length === 0 && <p className="text-xs text-muted px-2 py-1">No orders to link to yet.</p>}
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
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
