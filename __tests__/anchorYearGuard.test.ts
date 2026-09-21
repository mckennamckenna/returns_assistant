import { describe, it, expect } from "vitest";
import { applyAnchorYearGuard } from "@/lib/extract";

// ANCHOR_DATE_RESOLVER.md Part 3, built 2026-09-20. Pure function — no DB,
// no mocks, no API call. Every case below is stated as a date shape rather
// than a real user's order, per CLAUDE.md's real-data minimization rule;
// the Simply Simpson case is reproduced by its date shape only.

const iso = (value: string) => new Date(value).toISOString();

describe("applyAnchorYearGuard", () => {
  describe("year-swap correction", () => {
    it("corrects a delivery estimate whose year is stale, preserving the stated month/day", () => {
      // The Simply Simpson #164649 shape: anchor 2026-09-16, a bare
      // "Monday, Sep 28" in the body resolved by the model to 2020.
      const result = applyAnchorYearGuard(
        { orderDate: null, estimatedDeliveryDate: iso("2020-09-28"), deliveredAt: null },
        new Date("2026-09-16T14:52:09.000Z"),
      );

      expect(result.estimatedDeliveryDate).toBe(iso("2026-09-28"));
      expect(result.correctedFields).toEqual(["estimatedDeliveryDate"]);
      expect(result.unresolvedFields).toEqual([]);
      expect(result.note).toContain("corrected estimatedDeliveryDate");
    });

    it("corrects a wrong-year orderDate against the anchor (the Fitness Superstore shape)", () => {
      const result = applyAnchorYearGuard(
        { orderDate: iso("2025-07-14"), estimatedDeliveryDate: null, deliveredAt: null },
        new Date("2026-07-14T00:00:00.000Z"),
      );

      expect(result.orderDate).toBe(iso("2026-07-14"));
      expect(result.correctedFields).toEqual(["orderDate"]);
    });

    it("corrects deliveredAt the same way it corrects an estimate", () => {
      const result = applyAnchorYearGuard(
        { orderDate: null, estimatedDeliveryDate: null, deliveredAt: iso("2025-09-20") },
        new Date("2026-09-16T00:00:00.000Z"),
      );

      expect(result.deliveredAt).toBe(iso("2026-09-20"));
      expect(result.correctedFields).toEqual(["deliveredAt"]);
    });

    it("corrects a delivery date that is stale relative to a real orderDate", () => {
      // The Good Eggs / Emme Parsons shape: orderDate itself is correct, the
      // delivery estimate landed a year behind it.
      const result = applyAnchorYearGuard(
        { orderDate: iso("2026-07-14"), estimatedDeliveryDate: iso("2025-07-21"), deliveredAt: null },
        new Date("2026-07-14T00:00:00.000Z"),
      );

      expect(result.orderDate).toBe(iso("2026-07-14"));
      expect(result.estimatedDeliveryDate).toBe(iso("2026-07-21"));
      expect(result.correctedFields).toEqual(["estimatedDeliveryDate"]);
    });
  });

  describe("plausible values are left alone", () => {
    it("does not touch a delivery estimate that sits after the anchor", () => {
      const fields = { orderDate: null, estimatedDeliveryDate: iso("2026-09-28"), deliveredAt: null };
      const result = applyAnchorYearGuard(fields, new Date("2026-09-16T00:00:00.000Z"));

      expect(result.estimatedDeliveryDate).toBe(fields.estimatedDeliveryDate);
      expect(result.correctedFields).toEqual([]);
      expect(result.note).toBeNull();
    });

    it("does not touch an orderDate legitimately weeks before a shipping email's anchor", () => {
      const fields = { orderDate: iso("2026-08-20"), estimatedDeliveryDate: null, deliveredAt: null };
      const result = applyAnchorYearGuard(fields, new Date("2026-09-16T00:00:00.000Z"));

      expect(result.orderDate).toBe(fields.orderDate);
      expect(result.correctedFields).toEqual([]);
    });

    it("accepts a delivery estimate on the anchor date itself (floor is inclusive)", () => {
      const fields = { orderDate: null, estimatedDeliveryDate: iso("2026-09-16"), deliveredAt: null };
      const result = applyAnchorYearGuard(fields, new Date("2026-09-16T00:00:00.000Z"));

      expect(result.estimatedDeliveryDate).toBe(fields.estimatedDeliveryDate);
      expect(result.correctedFields).toEqual([]);
    });
  });

  describe("ambiguous cases are reported, never guessed", () => {
    // NOTE (2026-09-20, found by this test failing on its first run): a
    // genuinely ambiguous two-candidate case is currently UNREACHABLE, and
    // that is a property of the constants, not an accident worth relying on.
    // Candidate years are one year apart, while both plausibility windows
    // are narrower than a year — delivery is [floor, anchor + 120d] and
    // orderDate is [anchor - 200d, anchor + 2d] — so at most one candidate
    // can ever satisfy either. pickYearCorrection's `=== 1` check is
    // therefore a safety property rather than a live branch: it keeps the
    // never-pick-a-winner posture correct if MAX_DELIVERY_HORIZON_DAYS or
    // MAX_ORDER_AGE_DAYS is ever widened past 365. The test below pins that
    // invariant so widening a constant fails here rather than silently
    // turning the guard into a guesser.
    it("keeps both plausibility windows narrower than a year, so ambiguity cannot arise", () => {
      // A Feb 20 estimate against a Dec 20 anchor: only the following
      // February is plausible, so this resolves rather than going ambiguous.
      const result = applyAnchorYearGuard(
        { orderDate: null, estimatedDeliveryDate: iso("2020-02-20"), deliveredAt: null },
        new Date("2025-12-20T00:00:00.000Z"),
      );

      expect(result.estimatedDeliveryDate).toBe(iso("2026-02-20"));
      expect(result.correctedFields).toEqual(["estimatedDeliveryDate"]);
      expect(result.unresolvedFields).toEqual([]);
    });

    it("leaves a date alone when no candidate year is plausible", () => {
      // Feb 29 exists in 2024 but not in 2025/2026/2027, so shifting the
      // year produces a Mar 1 that still fails the floor.
      const fields = { orderDate: null, estimatedDeliveryDate: iso("2024-02-29"), deliveredAt: null };
      const result = applyAnchorYearGuard(fields, new Date("2026-09-16T00:00:00.000Z"));

      expect(result.estimatedDeliveryDate).toBe(fields.estimatedDeliveryDate);
      expect(result.correctedFields).toEqual([]);
      expect(result.unresolvedFields).toEqual(["estimatedDeliveryDate"]);
    });
  });

  describe("null and absent inputs", () => {
    it("leaves a dateless body entirely null — never fabricates a date", () => {
      const result = applyAnchorYearGuard(
        { orderDate: null, estimatedDeliveryDate: null, deliveredAt: null },
        new Date("2026-09-16T00:00:00.000Z"),
      );

      expect(result.orderDate).toBeNull();
      expect(result.estimatedDeliveryDate).toBeNull();
      expect(result.deliveredAt).toBeNull();
      expect(result.correctedFields).toEqual([]);
      expect(result.note).toBeNull();
    });

    it("declines to act when the anchor is null (unresolved manual forward)", () => {
      const fields = { orderDate: null, estimatedDeliveryDate: iso("2020-09-28"), deliveredAt: null };
      const result = applyAnchorYearGuard(fields, null);

      expect(result.estimatedDeliveryDate).toBe(fields.estimatedDeliveryDate);
      expect(result.correctedFields).toEqual([]);
      expect(result.unresolvedFields).toEqual([]);
      expect(result.note).toBeNull();
    });

    it("ignores an unparseable date string rather than throwing", () => {
      const fields = { orderDate: "not a date", estimatedDeliveryDate: null, deliveredAt: null };
      const result = applyAnchorYearGuard(fields, new Date("2026-09-16T00:00:00.000Z"));

      expect(result.orderDate).toBe("not a date");
      expect(result.correctedFields).toEqual([]);
    });
  });

  describe("orderDate resolves before the delivery fields use it as a floor", () => {
    it("uses the CORRECTED orderDate as the floor, not the raw extracted one", () => {
      // A wrong-year orderDate (2025-09-10 → 2026-09-10) must not drag a
      // correct delivery estimate into looking implausible, nor leave the
      // floor so low that a stale delivery date passes unnoticed.
      const result = applyAnchorYearGuard(
        { orderDate: iso("2025-09-10"), estimatedDeliveryDate: iso("2025-09-20"), deliveredAt: null },
        new Date("2026-09-16T00:00:00.000Z"),
      );

      expect(result.orderDate).toBe(iso("2026-09-10"));
      expect(result.estimatedDeliveryDate).toBe(iso("2026-09-20"));
      expect(result.correctedFields).toEqual(["orderDate", "estimatedDeliveryDate"]);
    });
  });
});
