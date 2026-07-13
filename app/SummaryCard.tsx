import Link from "next/link";

// Single compact summary card replacing the old three stat boxes —
// return-window-design-tokens.md §6 Commit 2.
export function SummaryCard({ count, dollarAmount, href }: { count: number; dollarAmount: string; href: string }) {
  return (
    <div className="mb-[22px]">
      <div className="text-[11px] font-medium uppercase tracking-[1.5px] text-accent mb-2">
        Due in the next 7 days
      </div>
      <div className="bg-card border border-border rounded-2xl p-[18px] flex items-center gap-4 min-w-0">
        <span className="font-serif text-[34px] font-semibold text-ink leading-none shrink-0">{count}</span>
        <span className="w-px self-stretch bg-border shrink-0" />
        <span className="font-serif text-[25px] font-semibold text-ink leading-none truncate min-w-0">{dollarAmount}</span>
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
