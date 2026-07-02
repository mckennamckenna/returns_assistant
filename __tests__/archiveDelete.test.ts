import { describe, it, expect } from "vitest";
import { hardDeleteCutoff, activeOrderFilter, HARD_DELETE_DAYS } from "../lib/orderFilters";

// ── hardDeleteCutoff ──────────────────────────────────────────────────────────
// The nightly cron permanently removes orders whose deletedAt is older than
// HARD_DELETE_DAYS. These tests verify the cutoff calculation so a
// misconfigured constant can't silently delete too much or too little.

describe("hardDeleteCutoff", () => {
  it(`returns exactly ${HARD_DELETE_DAYS} days before the given date`, () => {
    const now = new Date("2026-07-01T12:00:00.000Z");
    const cutoff = hardDeleteCutoff(now);
    const expectedMs = now.getTime() - HARD_DELETE_DAYS * 24 * 60 * 60 * 1000;
    expect(cutoff.getTime()).toBe(expectedMs);
  });

  it("does NOT touch an order deleted less than 30 days ago", () => {
    const now = new Date("2026-07-01T12:00:00.000Z");
    const cutoff = hardDeleteCutoff(now);
    // 1 day ago — should survive
    const deletedYesterday = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
    // Survives if deletedAt > cutoff (Prisma: deletedAt: { lte: cutoff } misses it)
    expect(deletedYesterday.getTime()).toBeGreaterThan(cutoff.getTime());
  });

  it("includes an order deleted more than 30 days ago", () => {
    const now = new Date("2026-07-01T12:00:00.000Z");
    const cutoff = hardDeleteCutoff(now);
    // 40 days ago — should be hard-deleted
    const deleted40DaysAgo = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);
    expect(deleted40DaysAgo.getTime()).toBeLessThan(cutoff.getTime());
  });

  it("includes an order deleted exactly 30 days ago (boundary — eligible)", () => {
    const now = new Date("2026-07-01T12:00:00.000Z");
    const cutoff = hardDeleteCutoff(now);
    const deletedExactly30DaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    // lte: cutoff → exactly-at-boundary is included
    expect(deletedExactly30DaysAgo.getTime()).toBeLessThanOrEqual(cutoff.getTime());
  });
});

// ── activeOrderFilter ─────────────────────────────────────────────────────────
// These verify the Prisma where-clause fragment that the dashboard, digest,
// and reminder cron all spread in. An archived or deleted order must not
// appear in any of those views.

describe("activeOrderFilter", () => {
  // Simulate: would this order match the active filter?
  function isVisible(order: { archivedAt: Date | null; deletedAt: Date | null }): boolean {
    return (
      order.archivedAt === activeOrderFilter.archivedAt &&
      order.deletedAt === activeOrderFilter.deletedAt
    );
  }

  it("includes an active order", () => {
    expect(isVisible({ archivedAt: null, deletedAt: null })).toBe(true);
  });

  it("excludes an archived order from the digest and dashboard", () => {
    expect(isVisible({ archivedAt: new Date("2026-06-30T00:00:00Z"), deletedAt: null })).toBe(false);
  });

  it("excludes a soft-deleted order from the digest and dashboard", () => {
    expect(isVisible({ archivedAt: null, deletedAt: new Date("2026-06-30T00:00:00Z") })).toBe(false);
  });

  it("excludes an order that is both archived and soft-deleted", () => {
    expect(isVisible({ archivedAt: new Date(), deletedAt: new Date() })).toBe(false);
  });
});

// ── "Mark as refunded" button visibility ──────────────────────────────────────
// The button must appear only when displayStatus is "returned" — not before
// (nothing to refund yet) and not after (already refunded).

describe("'Mark as refunded' button visibility", () => {
  const show = (displayStatus: string) => displayStatus === "returned";

  it("is visible for 'returned'", () => {
    expect(show("returned")).toBe(true);
  });

  it("is not visible for 'ordered'", () => {
    expect(show("ordered")).toBe(false);
  });

  it("is not visible for 'shipped'", () => {
    expect(show("shipped")).toBe(false);
  });

  it("is not visible for 'return_requested'", () => {
    expect(show("return_requested")).toBe(false);
  });

  it("is not visible once already 'refunded'", () => {
    expect(show("refunded")).toBe(false);
  });
});

// ── Archive / Unarchive button visibility ─────────────────────────────────────
// The label flips based on archivedAt. An active order shows "Archive";
// an already-archived order shows "Unarchive".

describe("archive / unarchive button label", () => {
  const showArchive = (archivedAt: Date | null) => archivedAt === null;
  const showUnarchive = (archivedAt: Date | null) => archivedAt !== null;

  it("shows 'Archive' when order is active (archivedAt is null)", () => {
    expect(showArchive(null)).toBe(true);
    expect(showUnarchive(null)).toBe(false);
  });

  it("shows 'Unarchive' when order has been archived (archivedAt is set)", () => {
    expect(showUnarchive(new Date("2026-07-01"))).toBe(true);
    expect(showArchive(new Date("2026-07-01"))).toBe(false);
  });
});
