import { describe, it, expect } from "vitest";
import { autoArchiveCutoff, autoArchiveOrderWhere, AUTO_ARCHIVE_GRACE_DAYS } from "../lib/autoArchive";
import { activeOrderFilter } from "../lib/orderFilters";

// ── autoArchiveCutoff ────────────────────────────────────────────────────────
// The nightly cron silently archives orders whose returnDeadline is older
// than AUTO_ARCHIVE_GRACE_DAYS. These tests verify the cutoff calculation so
// a misconfigured constant can't silently archive too much or too little.

describe("autoArchiveCutoff", () => {
  it(`returns exactly ${AUTO_ARCHIVE_GRACE_DAYS} days before the given date`, () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const cutoff = autoArchiveCutoff(now);
    const expectedMs = now.getTime() - AUTO_ARCHIVE_GRACE_DAYS * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it("does NOT touch an order whose deadline passed less than 14 days ago", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const cutoff = autoArchiveCutoff(now);
    // 5 days ago — should survive
    const deadline5DaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000);
    // Survives if returnDeadline > cutoff (Prisma: returnDeadline: { lte: cutoff } misses it)
    expect(deadline5DaysAgo.getTime()).toBeGreaterThan(cutoff.getTime());
  });

  it("includes an order whose deadline passed more than 14 days ago", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const cutoff = autoArchiveCutoff(now);
    const deadline30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(deadline30DaysAgo.getTime()).toBeLessThan(cutoff.getTime());
  });

  it("includes an order whose deadline passed exactly 14 days ago (boundary — eligible)", () => {
    const now = new Date("2026-07-10T12:00:00.000Z");
    const cutoff = autoArchiveCutoff(now);
    const deadlineExactly14DaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    // lte: cutoff → exactly-at-boundary is included
    expect(deadlineExactly14DaysAgo.getTime()).toBeLessThanOrEqual(cutoff.getTime());
  });
});

// ── autoArchiveOrderWhere ─────────────────────────────────────────────────────
// Scoped to ordered/shipped/delivered/return_requested only — "returned" is
// deliberately excluded (the user already acted; tracked separately by
// refund check-in), and "refunded"/"kept" already auto-archive on their own
// transitions so they'd never match activeOrderFilter here anyway.
// returnDeadline: null orders are excluded automatically by the lte filter —
// no explicit guard. "delivered" is included deliberately (added alongside
// the AquaTru "Shipped forever" fix, lib/displayStatus.ts): a
// delivered-but-unactioned order that misses its window is exactly the
// silent-miss case this sweep exists to catch — without this, adding
// "delivered" as a displayStatus value would have silently exempted those
// orders from ever being swept.

describe("autoArchiveOrderWhere", () => {
  const now = new Date("2026-07-10T12:00:00.000Z");

  it("spreads activeOrderFilter (excludes already-archived/deleted orders)", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.archivedAt).toBe(activeOrderFilter.archivedAt);
    expect(where.deletedAt).toBe(activeOrderFilter.deletedAt);
  });

  it("scopes displayStatus to ordered, shipped, delivered, and return_requested only", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.displayStatus).toEqual({ in: ["ordered", "shipped", "delivered", "return_requested"] });
  });

  it("includes 'delivered' in the scoped statuses — a delivered order past its window must still be swept", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.displayStatus.in).toContain("delivered");
  });

  it("does NOT include 'returned' in the scoped statuses", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.displayStatus.in).not.toContain("returned");
  });

  it("does NOT include 'refunded' or 'kept' in the scoped statuses", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.displayStatus.in).not.toContain("refunded");
    expect(where.displayStatus.in).not.toContain("kept");
  });

  it("filters returnDeadline by lte the cutoff", () => {
    const where = autoArchiveOrderWhere(now);
    expect(where.returnDeadline).toEqual({ lte: autoArchiveCutoff(now) });
  });
});
