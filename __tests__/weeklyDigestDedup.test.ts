import { describe, it, expect } from "vitest";
import { scheduledRunWeekStart, WEEKLY_DIGEST_CRON_DAY_UTC, WEEKLY_DIGEST_CRON_HOUR_UTC } from "../lib/weeklyDigestDedup";

// ── A same-week test-send-vs-real-run scenario, mirroring the reported
// weekly-coverage incident (commit 9163d0b) on the Sunday schedule ─────────
// Jun 29, 2026 (Monday) stands in for an off-schedule force/test send.
// Jul 5, 2026 (Sunday) is the real scheduled run, 6 days later — inside the
// old rolling-7-day lookback computed from Jul 5.

describe("a same-week test-send-vs-real-run scenario (weekly-digest)", () => {
  const jul5RealRun = new Date("2026-07-05T16:00:00.000Z"); // the scheduled Sunday run
  const jun29ForceSend = new Date("2026-06-29T12:00:00.000Z"); // off-schedule Monday

  it("sets up the scenario: Jun 29 is a Monday, Jul 5 is a Sunday, 6 days apart", () => {
    expect(jun29ForceSend.getUTCDay()).toBe(1); // Monday
    expect(jul5RealRun.getUTCDay()).toBe(WEEKLY_DIGEST_CRON_DAY_UTC); // Sunday
    const diffDays = (jul5RealRun.getTime() - jun29ForceSend.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeLessThan(7);
  });

  it("would have dropped the user under the OLD rolling-7-day lookback", () => {
    const oldLookbackStart = new Date(jul5RealRun.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Jun 29 falls inside [oldLookbackStart, jul5RealRun] — the bug.
    expect(jun29ForceSend.getTime()).toBeGreaterThanOrEqual(oldLookbackStart.getTime());
  });

  it("no longer drops the user under the NEW scheduled-run-week boundary", () => {
    const dedupWindowStart = scheduledRunWeekStart(jul5RealRun);
    // The boundary for the Jul 5 run is Jul 5 itself (this week's own
    // scheduled instant) — strictly after the off-schedule Jun 29 send, so
    // it would no longer match a `sentAt: { gte: dedupWindowStart }` query.
    expect(dedupWindowStart.toISOString()).toBe("2026-07-05T16:00:00.000Z");
    expect(jun29ForceSend.getTime()).toBeLessThan(dedupWindowStart.getTime());
  });
});

// ── scheduledRunWeekStart — general correctness (Sunday schedule) ───────────

describe("scheduledRunWeekStart (weekly-digest)", () => {
  it("returns today's own scheduled instant when invoked exactly at the scheduled time", () => {
    const now = new Date("2026-07-05T16:00:00.000Z"); // a Sunday
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-05T16:00:00.000Z");
  });

  it("returns today's own scheduled instant when invoked after the scheduled hour, same day", () => {
    const now = new Date("2026-07-05T20:00:00.000Z");
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-05T16:00:00.000Z");
  });

  it("steps back a full week when invoked on the scheduled day but BEFORE the scheduled hour", () => {
    const now = new Date("2026-07-05T10:00:00.000Z"); // Sunday morning, before 16:00 UTC
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-06-28T16:00:00.000Z");
  });

  it("returns the most recent past scheduled day for a mid-week invocation", () => {
    const now = new Date("2026-07-08T12:00:00.000Z"); // the following Wednesday
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-05T16:00:00.000Z");
  });

  it("is idempotent across repeated same-day invocations (double-fire / retry safe)", () => {
    const first = new Date("2026-07-05T16:00:01.000Z");
    const second = new Date("2026-07-05T16:05:00.000Z");
    expect(scheduledRunWeekStart(first).getTime()).toBe(scheduledRunWeekStart(second).getTime());
  });

  it("uses the configured cron hour", () => {
    const now = new Date("2026-07-05T16:00:00.000Z");
    expect(scheduledRunWeekStart(now).getUTCHours()).toBe(WEEKLY_DIGEST_CRON_HOUR_UTC);
  });
});
