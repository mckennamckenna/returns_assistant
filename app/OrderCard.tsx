import Link from "next/link";
import type { Order } from "@prisma/client";
import { DisplayStatusBadge } from "./DisplayStatusBadge";
import { DaysLeftChip } from "./DaysLeftChip";
import { RetailerAvatar } from "./RetailerAvatar";
import { OrderActionsMenu } from "./OrderActionsMenu";
import { StartReturnButton } from "./StartReturnButton";
import { MarkRefundedButton } from "./MarkRefundedButton";
import { markReturnedAction, markKeptAction } from "./actions";
import { KEPT_WARNING_CAPTION } from "@/lib/displayStatus";
import { isClosingSoon } from "@/lib/alerts";
import { truncateOrderNumber } from "@/lib/orderNumberDisplay";
import { getVisibleActions } from "@/lib/orderActions";

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

function QrIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v3M14 20h3M20 20v.01" />
    </svg>
  );
}

// The redesigned order card, used for every order at every breakpoint —
// return-window-design-tokens.md §6 Commit 2. Action row is status-driven
// (see the Commit 2 plan's mapping table) since the doc's anatomy prose
// describes one fixed two-button pair, but the underlying status machine
// (lib/displayStatus.ts) has more states than that.
export function OrderCard({ order, now }: { order: Order; now: Date }) {
  const { canStartReturn, canMarkReturned, canKeep, canMarkRefunded } = getVisibleActions(order, now);
  const itemSummaryText = itemSummary(order.lineItems);
  const atRisk = isClosingSoon(order, now);
  // "Confirmed" means the retailer's email explicitly stated the return
  // window/deadline (policySource === "stated_in_email") — everything else
  // (web_lookup, user_supplied, null) stays hedged. Deliberately independent
  // of deadlineIsEstimated, which tracks a different kind of uncertainty
  // (whether the delivery-date anchor used to compute the deadline was
  // itself confirmed) and stays wired to reminder-suppression logic
  // (lib/reminders.ts) untouched by this display-only distinction.
  const deadlineConfirmed = order.policySource === "stated_in_email";

  return (
    <div className="bg-card border border-border rounded-2xl p-[18px]">
      <div className="flex items-start gap-3">
        <Link href={`/orders/${order.id}`} className="flex items-start gap-3 flex-1 min-w-0">
          <RetailerAvatar name={order.retailer || "?"} />
          <div className="min-w-0">
            <div className="text-lg font-medium text-ink truncate">{order.retailer || "Unknown retailer"}</div>
            {(order.orderNumber || itemSummaryText) && (
              <div className="text-xs text-muted truncate">
                {order.orderNumber && (
                  <span title={order.orderNumber} aria-label={`Order number ${order.orderNumber}`}>
                    #{truncateOrderNumber(order.orderNumber)}
                  </span>
                )}
                {order.orderNumber && itemSummaryText && " · "}
                {itemSummaryText}
              </div>
            )}
            <div className="mt-1"><DisplayStatusBadge status={order.displayStatus} /></div>
          </div>
        </Link>
        <DaysLeftChip returnDeadline={order.returnDeadline} isEstimated={!deadlineConfirmed} />
      </div>

      <div className="flex items-baseline justify-between flex-wrap gap-x-2 gap-y-1 mt-3">
        <span className="font-serif text-[27px] font-semibold text-ink">
          {formatCurrency(order.orderTotal, order.orderCurrency)}
          {atRisk && <span className="font-sans text-xs font-medium text-accent ml-1.5 align-middle">at risk</span>}
        </span>
        <span className="text-[13px] text-muted">
          Return by {formatDate(order.returnDeadline)}
        </span>
      </div>
      {order.orderTotal == null && (
        <p className="text-xs text-muted mt-1">Forward your order confirmation to add the total</p>
      )}

      <div className="flex items-center gap-2 mt-3">
        {canStartReturn && (
          <StartReturnButton
            orderId={order.id}
            returnPortalUrl={order.returnPortalUrl}
            className="flex-1 min-w-0 truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90 disabled:opacity-50 md:flex-none md:w-auto"
          />
        )}
        {canMarkReturned && (
          <form action={markReturnedAction.bind(null, order.id)} className="flex-1 min-w-0 md:flex-none">
            <button type="submit" className="w-full md:w-auto truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90">
              Mark as returned
            </button>
          </form>
        )}
        {canMarkRefunded && (
          <MarkRefundedButton
            orderId={order.id}
            className="flex-1 min-w-0 truncate bg-ink text-page text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-ink/90 text-center md:flex-none md:w-auto"
          />
        )}
        {canKeep && (
          <form action={markKeptAction.bind(null, order.id)} className="flex-1 min-w-0 md:flex-none">
            <button type="submit" className="w-full md:w-auto truncate border border-border text-ink text-sm font-medium rounded-lg px-4 md:px-6 py-2 hover:bg-page">
              Keeping it
            </button>
          </form>
        )}
        <OrderActionsMenu
          orderId={order.id}
          isArchived={order.archivedAt !== null}
          trackingUrl={order.trackingNumber && order.trackingUrl ? order.trackingUrl : null}
          returnTrackingUrl={order.returnTrackingNumber && order.returnTrackingUrl ? order.returnTrackingUrl : null}
          className="md:ml-auto"
        />
      </div>
      {canKeep && <p className="text-[10px] text-muted mt-1">{KEPT_WARNING_CAPTION}</p>}

      {order.displayStatus === "return_requested" && (
        <button
          type="button"
          disabled
          className="w-full flex items-center justify-center gap-2 bg-page text-muted text-xs font-medium rounded-lg px-4 py-2 mt-2 cursor-default"
        >
          <QrIcon />
          View QR code
          <span className="text-[10px] uppercase tracking-wide bg-border text-muted px-1.5 py-0.5 rounded-full">Soon</span>
        </button>
      )}
    </div>
  );
}
