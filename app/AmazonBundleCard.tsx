"use client";

import { useState } from "react";
import Link from "next/link";
import type { Order } from "@prisma/client";
import { RetailerAvatar } from "./RetailerAvatar";
import { ArchiveOrderButton } from "./ArchiveOrderButton";
import { DaysLeftChip } from "./DaysLeftChip";
import {
  amazonComposition,
  amazonRowLabel,
  compareNullableDate,
  earliestAmazonDeadline,
  isDeliveredDecisionPending,
} from "@/lib/amazonBundle";

function formatCurrency(total: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(total);
  } catch {
    return `$${total}`;
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

// v1, awareness-only (AMAZON_HANDLING.md) — a folder card, not a single-order
// card. Collapsed bottom-right is a deadline summary, never an action; the
// expanded rows are read-only except for Archive, which is allowed since it
// hides an order rather than deciding a return outcome.
export function AmazonBundleCard({ orders, now }: { orders: Order[]; now: Date }) {
  const [expanded, setExpanded] = useState(false);

  const bundleTotal = orders.reduce((sum, o) => sum + (o.orderTotal ?? 0), 0);
  const currency = orders.find((o) => o.orderCurrency)?.orderCurrency ?? "USD";
  const composition = amazonComposition(orders);
  const earliestDeadline = earliestAmazonDeadline(orders);

  const deliveredRows = orders
    .filter(isDeliveredDecisionPending)
    .sort((a, b) => compareNullableDate(a.returnDeadline, b.returnDeadline))
    .slice(0, 5);

  return (
    <div className="bg-card border border-border rounded-2xl p-[18px] mb-4">
      <div className="flex items-center gap-3">
        <RetailerAvatar name="Amazon" />
        <div className="min-w-0 flex-1">
          <div className="text-lg font-medium text-ink truncate">Amazon</div>
          <div className="text-xs text-muted truncate">
            {orders.length} order{orders.length === 1 ? "" : "s"} · {formatCurrency(bundleTotal, currency)}
          </div>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <DaysLeftChip returnDeadline={earliestDeadline} isEstimated={false} />
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse Amazon orders" : "Expand Amazon orders"}
            className="text-muted text-xs px-1"
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {composition && <p className="text-xs text-muted mt-2 ml-[60px]">{composition}</p>}

      {expanded && (
        <div className="mt-4 flex flex-col gap-3">
          {deliveredRows.length === 0 ? (
            <p className="text-sm text-secondary">No delivered orders awaiting a decision right now.</p>
          ) : (
            deliveredRows.map((order) => (
              <div
                key={order.id}
                className="flex items-center justify-between gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0"
              >
                <Link href={`/orders/${order.id}`} className="min-w-0 flex-1">
                  <p className="text-sm text-ink truncate">{itemSummary(order.lineItems) ?? order.orderNumber ?? "Order"}</p>
                  <p className="text-xs text-muted">{formatCurrency(order.orderTotal ?? 0, order.orderCurrency ?? "USD")}</p>
                </Link>
                <span className="text-xs text-muted whitespace-nowrap">{amazonRowLabel(order, now)}</span>
                <ArchiveOrderButton orderId={order.id} isArchived={false} className="text-xs text-muted underline whitespace-nowrap" />
              </div>
            ))
          )}

          <div className="flex items-center gap-4 pt-3 border-t border-border">
            <Link href="/amazon" className="text-sm font-medium text-ink underline">
              View all {orders.length} order{orders.length === 1 ? "" : "s"}
            </Link>
            <a href="https://www.amazon.com" target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-ink underline">
              Go to Amazon
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
