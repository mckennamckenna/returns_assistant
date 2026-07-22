// Nightly sweep: silently archive orders whose return window closed
// AUTO_ARCHIVE_GRACE_DAYS ago or more, with no user action taken. Scoped to
// "ordered"/"shipped"/"delivered"/"return_requested" only — deliberately
// excludes "returned": that means the user already acted (shipped it back),
// so there's no missed window to sweep, and it's already tracked separately
// by the refund check-in cron (lib/refundCheckin.ts). "refunded" and "kept"
// are already auto-archived on their own transitions, so they'd never match
// activeOrderFilter here anyway. "delivered" is included deliberately: it's
// evidence about the package, not a user decision (lib/displayStatus.ts) —
// a delivered-but-unactioned order that misses its window is exactly the
// silent-miss case this sweep exists to catch, same as "shipped".
//
// Pure helpers, mirroring lib/orderFilters.ts's hardDeleteCutoff /
// reminderOrderWhere shape — unit-testable without a DB.
import { activeOrderFilter } from "@/lib/orderFilters";

export const AUTO_ARCHIVE_GRACE_DAYS = 14;

const NON_TERMINAL_STATUSES = ["ordered", "shipped", "delivered", "return_requested"];

// The cutoff date for the sweep: orders whose returnDeadline is on or before
// this date are eligible.
export function autoArchiveCutoff(now: Date): Date {
  return new Date(now.getTime() - AUTO_ARCHIVE_GRACE_DAYS * 24 * 60 * 60 * 1000);
}

// The Prisma where clause for the nightly auto-archive sweep. Exported so
// tests can assert on it directly, same convention as reminderOrderWhere()
// and refundCheckinOrderWhere(). returnDeadline: null orders are excluded
// automatically — Prisma's `lte` never matches null, so an order with no
// computed deadline is never touched by this sweep, no explicit guard needed.
export function autoArchiveOrderWhere(now: Date) {
  return {
    ...activeOrderFilter,
    displayStatus: { in: NON_TERMINAL_STATUSES },
    returnDeadline: { lte: autoArchiveCutoff(now) },
  };
}
