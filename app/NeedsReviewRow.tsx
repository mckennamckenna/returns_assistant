import Link from "next/link";
import { needsReviewAction, NEEDS_REVIEW_ACTION_LABELS } from "@/lib/needsReviewActions";
import type { NeedsReviewRowData } from "@/lib/needsReviewRows";
import { NeedsReviewRowActions } from "./NeedsReviewRowActions";
import { LinkToOrderPicker, type LinkablePickerOrder } from "./LinkToOrderPicker";
import { shouldShowCreateNewEscapeHatch } from "@/lib/shipmentUnlinkedPicker";
import { formatCalendarDateShort } from "@/lib/dateDisplay";

function formatCurrency(total: number | null, currency: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

const actionButtonClass = "text-xs font-medium rounded-lg px-2.5 py-1 bg-ink text-page hover:bg-ink/90 disabled:opacity-50 whitespace-nowrap";
const linkButtonClass = "text-xs font-medium text-secondary underline hover:text-ink whitespace-nowrap";

// CARD_SPEC.md Part 3 — one row = one 2x2: Slot 1 retailer, Slot 2
// date · amount, Slot 3 why (full sentence), Slot 4 action (registry).
// Left column (slot 1 above slot 2) and right column (slot 3, with slot 4
// beneath it) — same skeleton as the single-order card and the Amazon
// bundle rows. Slot 4 is ALWAYS visible (Q10, corrected 2026-08-21): the
// bucket's collapse/expand toggle governs how many rows render, never
// whether an individual rendered row's action shows — gating it behind a
// second tap was the two-tap-friction bug the correction fixed. This
// component no longer takes an `expanded` prop at all as a result.
//
// [2026-08-24 amendment D] Slot 4's control set is {presumed primary
// action, Archive, optional More info} for email-kind rows — Archive is
// now a standing control alongside the primary action, not something a
// row only gets via its resolved reasonId. More info renders only when
// the primary action isn't already view_detail (rendering it again would
// duplicate the primary). Order-kind rows are unchanged (still degrade to
// View detail alone) — amendment D's "primary action from the routing
// tree" ties to NEEDS_REVIEW_ROUTING_DESIGN.md §2, which is scoped to
// email-kind rows only; order-kind routing is a separate, deferred
// decision (lib/needsReviewActions.ts:43-44, untouched this session).
export function NeedsReviewRow({
  row,
  linkablePickerOrders,
}: {
  row: NeedsReviewRowData;
  linkablePickerOrders: LinkablePickerOrder[];
}) {
  const detailHref = row.kind === "order" ? `/orders/${row.id}` : `/emails/${row.id}`;
  const action = needsReviewAction({ kind: row.kind, reasonId: row.reasonId });
  const isDegrade = action.id === "view_detail";
  const amountText = formatCurrency(row.amount, row.currency);
  const dateAmount = [
    // lib/dateDisplay.ts — reads the UTC calendar-date components
    // (TASKS.md 2026-08-27). row.date is orderDate for order-kind rows, a
    // calendar date subject to the same rollback bug the rest of the app
    // was fixed for.
    row.date ? formatCalendarDateShort(row.date) : null,
    amountText,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="border-t border-amber-200 pt-3 first:border-t-0 first:pt-0">
      {/* Slots 1-3 — this Link can't also hold slot 4 (interactive controls
          can't nest inside an anchor), so slot 4 renders just below it,
          outside the Link, always. */}
      <Link href={detailHref} className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink truncate">{row.retailer ?? row.carrier ?? "Unknown retailer"}</p>
          {dateAmount && <p className="text-xs text-muted truncate">{dateAmount}</p>}
        </div>
        <div className="min-w-0 flex-1 text-right">
          <p className="text-xs text-amber-800">{row.why}</p>
        </div>
      </Link>

      <div className="flex items-center justify-end gap-2 mt-2">
        {/* CARD_SPEC.md Part 3 amendment D: {primary, Archive, optional
            More info}. A mapped row (primary exists) renders [primary +
            Archive + More info], three controls. A degrade row (primary is
            already view_detail) renders [Archive + View detail], two
            controls — More info is omitted rather than duplicating the
            primary. Archive is email-kind only (see comment above). */}
        {!isDegrade &&
          (action.id === "link_to_order" && row.kind === "email" ? (
            <LinkToOrderPicker
              emailId={row.id}
              orders={linkablePickerOrders}
              showCreateNewEscapeHatch={shouldShowCreateNewEscapeHatch(row.reasonId)}
              retailer={row.retailer}
              className={linkButtonClass}
            />
          ) : (
            <NeedsReviewRowActions emailId={row.id} actionId={action.id} label={action.label} className={actionButtonClass} />
          ))}
        {row.kind === "email" && (
          <NeedsReviewRowActions
            emailId={row.id}
            actionId="not_a_purchase"
            label={NEEDS_REVIEW_ACTION_LABELS.not_a_purchase}
            className={linkButtonClass}
          />
        )}
        <Link href={detailHref} className={isDegrade ? actionButtonClass : linkButtonClass}>
          {NEEDS_REVIEW_ACTION_LABELS.view_detail}
        </Link>
      </div>
    </div>
  );
}
