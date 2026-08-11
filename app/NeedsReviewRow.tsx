import Link from "next/link";
import { needsReviewAction } from "@/lib/needsReviewActions";
import type { NeedsReviewRowData } from "@/lib/needsReviewRows";
import { NeedsReviewRowActions } from "./NeedsReviewRowActions";
import { LinkToOrderPicker, type LinkablePickerOrder } from "./LinkToOrderPicker";

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
// date · amount, Slot 3 why (free text), Slot 4 action (registry). Collapsed
// callers pass expanded=false and only slots 1-3 render (no buttons);
// expanded reveals slot 4 — same collapse contract as the bundle header.
export function NeedsReviewRow({
  row,
  expanded,
  linkablePickerOrders,
}: {
  row: NeedsReviewRowData;
  expanded: boolean;
  linkablePickerOrders: LinkablePickerOrder[];
}) {
  const detailHref = row.kind === "order" ? `/orders/${row.id}` : `/emails/${row.id}`;
  const action = needsReviewAction({ kind: row.kind, hasRetailer: row.retailer != null });
  const amountText = formatCurrency(row.amount, row.currency);
  const dateAmount = [
    row.date ? row.date.toLocaleDateString(undefined, { month: "numeric", day: "numeric" }) : null,
    amountText,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="flex items-center justify-between gap-3 border-t border-amber-200 pt-3 first:border-t-0 first:pt-0">
      <Link href={detailHref} className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink truncate">{row.retailer ?? "Unknown retailer"}</p>
        {dateAmount && <p className="text-xs text-muted truncate">{dateAmount}</p>}
        <p className="text-xs text-amber-800 truncate">{row.why}</p>
      </Link>
      {expanded && (
        <div className="shrink-0 flex items-center gap-2">
          {action.id === "view_detail" ? (
            <Link href={detailHref} className={actionButtonClass}>
              {action.label}
            </Link>
          ) : (
            <NeedsReviewRowActions emailId={row.id} actionId={action.id} label={action.label} className={actionButtonClass} />
          )}
          {row.kind === "email" && (
            <LinkToOrderPicker emailId={row.id} orders={linkablePickerOrders} className={linkButtonClass} />
          )}
        </div>
      )}
    </div>
  );
}
