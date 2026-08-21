"use client";

import { useState } from "react";
import Link from "next/link";
import { NeedsReviewRow } from "./NeedsReviewRow";
import type { NeedsReviewRowData } from "@/lib/needsReviewRows";
import type { LinkablePickerOrder } from "./LinkToOrderPicker";

// CARD_SPEC.md Part 3 — the needs-review bucket. Structurally the Amazon
// bundle's container pattern (app/AmazonBundleCard.tsx): header 2x2,
// collapses to a summary, expands to a row list, overflows past the same
// inline limit (CARD_SPEC.md Part 5 Q2 — reused from
// app/AmazonBundleCard.tsx's `.slice(0, 5)`, not a second invented number).
const INLINE_OVERFLOW_LIMIT = 5;

export function NeedsReviewBucket({
  rows,
  linkablePickerOrders,
}: {
  rows: NeedsReviewRowData[];
  linkablePickerOrders: LinkablePickerOrder[];
}) {
  const [expanded, setExpanded] = useState(false);

  if (rows.length === 0) return null;

  const visibleRows = rows.slice(0, INLINE_OVERFLOW_LIMIT);
  const hasOverflow = rows.length > INLINE_OVERFLOW_LIMIT;

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-[18px] mb-4">
      {/* Header 2x2: Slot 1 "Needs review", Slot 2 count, Slot 3 the orange
          attention treatment (the whole card, per the existing panel's
          convention), Slot 4 expand/collapse — a DISCRETE corner button, same
          shape as app/AmazonBundleCard.tsx's header, not the whole header
          wrapped in one button (2026-08-21 layout fix: slots 1-2 are inert
          text, only the icon on the right is interactive). */}
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-lg font-medium text-amber-900 truncate">Needs review</div>
          <div className="text-xs text-amber-700 truncate">
            {rows.length} item{rows.length === 1 ? "" : "s"}
          </div>
        </div>
        <div className="shrink-0">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse needs review" : "Expand needs review"}
            className="text-amber-700 text-xs px-1"
          >
            {expanded ? "▴" : "▾"}
          </button>
        </div>
      </div>

      {/* Collapsed = compact stack of rows, slots 1-3 only (identity + why,
          no buttons). Expanded = each row reveals its slot-4 action. */}
      <div className="mt-4 flex flex-col gap-3">
        {visibleRows.map((row) => (
          <NeedsReviewRow key={`${row.kind}-${row.id}`} row={row} expanded={expanded} linkablePickerOrders={linkablePickerOrders} />
        ))}
      </div>

      {expanded && hasOverflow && (
        <div className="mt-3 pt-3 border-t border-amber-200">
          <Link href="/needs-review" className="text-sm font-medium text-amber-900 underline">
            View all {rows.length} →
          </Link>
        </div>
      )}
    </div>
  );
}
