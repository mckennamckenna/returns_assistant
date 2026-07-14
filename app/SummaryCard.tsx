import Link from "next/link";

// Single compact summary card replacing the old three stat boxes —
// return-window-design-tokens.md §6 Commit 2.
//
// singleOrderRetailer: only passed (and only rendered) when count === 1 — a
// bare "1 | $640.87" reads as decontextualized with nothing else on the card
// to anchor it to. At count > 1 there's no single retailer to name, and the
// dollar figure is already understood as an aggregate, so no context is
// added there. See TRUST_AUDIT.md item 6 — the OrderCard's own "at risk"
// label is deliberately left alone: the retailer name is already the card's
// header right above it, so repeating it there would be redundant, not
// clarifying.
export function SummaryCard({
  count,
  dollarAmount,
  href,
  singleOrderRetailer,
}: {
  count: number;
  dollarAmount: string;
  href: string;
  singleOrderRetailer?: string | null;
}) {
  return (
    <div className="mb-8">
      <div className="text-[11px] font-medium uppercase tracking-[1.5px] text-accent mb-2">
        Due in the next 7 days
      </div>
      <div className="bg-card border border-border rounded-2xl p-[18px] flex items-center gap-4 min-w-0">
        <span className="font-serif text-[34px] font-semibold text-ink leading-none shrink-0">{count}</span>
        <span className="w-px self-stretch bg-border shrink-0" />
        <span className="min-w-0 truncate">
          {count === 1 && singleOrderRetailer && (
            <span className="block text-xs text-muted truncate">{singleOrderRetailer}</span>
          )}
          <span className="font-serif text-[25px] font-semibold text-ink leading-none block truncate">{dollarAmount}</span>
        </span>
        <Link
          href={href}
          className="ml-auto shrink-0 bg-ink text-page text-sm font-medium rounded-lg px-3 py-2 hover:bg-ink/90"
        >
          View all →
        </Link>
      </div>
    </div>
  );
}
