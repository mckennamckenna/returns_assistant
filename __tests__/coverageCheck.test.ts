import { describe, it, expect } from "vitest";
import { scheduledRunWeekStart, COVERAGE_CHECK_CRON_DAY_UTC, COVERAGE_CHECK_CRON_HOUR_UTC } from "../lib/coverageCheck";

// ── The reported incident, reproduced directly ──────────────────────────────
// Jun 27, 2026 (Saturday) was an off-schedule force/test send. Jul 3, 2026
// (Friday) was the real scheduled run, 6 days later. The old rolling-7-day
// lookback (now - 7 days) computed from the Jul 3 run landed on Jun 26,
// and Jun 27 >= Jun 26 — so the force send's Reminder row incorrectly
// counted as "recent" and skipped the real run.

describe("the reported Jun 27 / Jul 3 incident", () => {
  const jul3RealRun = new Date("2026-07-03T16:00:00.000Z"); // the scheduled Friday run
  const jun27ForceSend = new Date("2026-06-27T18:00:00.000Z"); // off-schedule Saturday

  it("confirms the dates as reported: Jun 27 is a Saturday, Jul 3 is a Friday, 6 days apart", () => {
    expect(jun27ForceSend.getUTCDay()).toBe(6); // Saturday
    expect(jul3RealRun.getUTCDay()).toBe(COVERAGE_CHECK_CRON_DAY_UTC); // Friday
    const diffDays = (jul3RealRun.getTime() - jun27ForceSend.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeLessThan(7);
  });

  it("reproduces the bug under the OLD rolling-7-day lookback", () => {
    const oldLookbackStart = new Date(jul3RealRun.getTime() - 7 * 24 * 60 * 60 * 1000);
    // Jun 27 falls inside [oldLookbackStart, jul3RealRun] — the bug.
    expect(jun27ForceSend.getTime()).toBeGreaterThanOrEqual(oldLookbackStart.getTime());
  });

  it("closes the bug under the NEW scheduled-run-week boundary", () => {
    const dedupWindowStart = scheduledRunWeekStart(jul3RealRun);
    // The boundary for the Jul 3 run is Jul 3 itself (this week's own
    // scheduled instant) — strictly after the off-schedule Jun 27 send, so
    // it would no longer match a `sentAt: { gte: dedupWindowStart }` query.
    expect(dedupWindowStart.toISOString()).toBe("2026-07-03T16:00:00.000Z");
    expect(jun27ForceSend.getTime()).toBeLessThan(dedupWindowStart.getTime());
  });
});

// ── scheduledRunWeekStart — general correctness ─────────────────────────────

describe("scheduledRunWeekStart", () => {
  it("returns today's own scheduled instant when invoked exactly at the scheduled time", () => {
    const now = new Date("2026-07-03T16:00:00.000Z"); // a Friday
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("returns today's own scheduled instant when invoked after the scheduled hour, same day", () => {
    const now = new Date("2026-07-03T20:00:00.000Z");
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("steps back a full week when invoked on the scheduled day but BEFORE the scheduled hour", () => {
    const now = new Date("2026-07-03T10:00:00.000Z"); // Friday morning, before 16:00 UTC
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-06-26T16:00:00.000Z");
  });

  it("returns the most recent past scheduled day for a mid-week invocation", () => {
    const now = new Date("2026-07-08T12:00:00.000Z"); // the following Wednesday
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("returns the most recent past scheduled day the day before it recurs", () => {
    const now = new Date("2026-07-09T12:00:00.000Z"); // Thursday, day before next Friday
    expect(scheduledRunWeekStart(now).toISOString()).toBe("2026-07-03T16:00:00.000Z");
  });

  it("is idempotent across repeated same-day invocations (double-fire / retry safe)", () => {
    const first = new Date("2026-07-03T16:00:01.000Z");
    const second = new Date("2026-07-03T16:05:00.000Z");
    expect(scheduledRunWeekStart(first).getTime()).toBe(scheduledRunWeekStart(second).getTime());
  });

  it("uses the configured cron hour", () => {
    const now = new Date("2026-07-03T16:00:00.000Z");
    expect(scheduledRunWeekStart(now).getUTCHours()).toBe(COVERAGE_CHECK_CRON_HOUR_UTC);
  });
});
