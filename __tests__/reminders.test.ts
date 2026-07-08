import { describe, it, expect } from "vitest";
import {
  reminderTypeForOrder,
  isEligibleForReminder,
  suppressForEstimatedDeadline,
  type OrderForReminder,
} from "../lib/reminders";

// ── Deadline reminders vs. user-reported displayStatus ───────────────────────
// Email-first principle: once the user tells us an order is "returned" or
// "refunded," no more emails about it — a deadline reminder at that point is
// a silent violation, since the user has already closed the loop themselves.
// "return_requested" is deliberately excluded: the window is still open and
// the package may not have shipped, so the reminder still matters.

describe("deadline reminders vs. displayStatus", () => {
  const today = new Date("2026-07-03T12:00:00.000Z");
  const sevenDaysOut = new Date("2026-07-10T12:00:00.000Z");

  function order(displayStatus: string, deadlineIsEstimated = false): OrderForReminder {
    return { returnDeadline: sevenDaysOut, status: "ordered", displayStatus, deadlineIsEstimated };
  }

  it("suppresses the reminder when displayStatus is 'returned'", () => {
    expect(isEligibleForReminder(order("returned"))).toBe(false);
    expect(reminderTypeForOrder(order("returned"), today)).toBe(null);
  });

  it("suppresses the reminder when displayStatus is 'refunded'", () => {
    expect(isEligibleForReminder(order("refunded"))).toBe(false);
    expect(reminderTypeForOrder(order("refunded"), today)).toBe(null);
  });

  it("still fires the reminder when displayStatus is 'return_requested'", () => {
    expect(isEligibleForReminder(order("return_requested"))).toBe(true);
    expect(reminderTypeForOrder(order("return_requested"), today)).toBe("7_day");
  });
});

// ── Estimated-deadline reminder suppression ──────────────────────────────────
// A carrier delay on an estimated deadline shouldn't cause false urgency on
// the two thresholds closest to it — see lib/extract.ts's computeDeadline
// fix for the Proenza Schouler bug this exists to prevent.
describe("estimated-deadline reminder suppression", () => {
  function orderAt(daysOut: number, deadlineIsEstimated: boolean): OrderForReminder {
    const today = new Date("2026-07-03T12:00:00.000Z");
    const deadline = new Date(today.getTime() + daysOut * 24 * 60 * 60 * 1000);
    return { returnDeadline: deadline, status: "ordered", displayStatus: "ordered", deadlineIsEstimated };
  }
  const today = new Date("2026-07-03T12:00:00.000Z");

  it("suppresses 1_day when the deadline is estimated", () => {
    expect(reminderTypeForOrder(orderAt(1, true), today)).toBe(null);
  });

  it("suppresses same_day when the deadline is estimated", () => {
    expect(reminderTypeForOrder(orderAt(0, true), today)).toBe(null);
  });

  it("still fires 7_day when the deadline is estimated", () => {
    expect(reminderTypeForOrder(orderAt(7, true), today)).toBe("7_day");
  });

  it("still fires 2_day when the deadline is estimated", () => {
    expect(reminderTypeForOrder(orderAt(2, true), today)).toBe("2_day");
  });

  it("fires 1_day normally when the deadline is confirmed, not estimated", () => {
    expect(reminderTypeForOrder(orderAt(1, false), today)).toBe("1_day");
  });

  it("fires same_day normally when the deadline is confirmed, not estimated", () => {
    expect(reminderTypeForOrder(orderAt(0, false), today)).toBe("same_day");
  });
});

describe("suppressForEstimatedDeadline", () => {
  it("passes through null unchanged", () => {
    expect(suppressForEstimatedDeadline(null, true)).toBe(null);
  });

  it("suppresses 1_day and same_day when estimated", () => {
    expect(suppressForEstimatedDeadline("1_day", true)).toBe(null);
    expect(suppressForEstimatedDeadline("same_day", true)).toBe(null);
  });

  it("leaves 7_day and 2_day untouched when estimated", () => {
    expect(suppressForEstimatedDeadline("7_day", true)).toBe("7_day");
    expect(suppressForEstimatedDeadline("2_day", true)).toBe("2_day");
  });

  it("leaves everything untouched when not estimated", () => {
    expect(suppressForEstimatedDeadline("1_day", false)).toBe("1_day");
    expect(suppressForEstimatedDeadline("same_day", false)).toBe("same_day");
  });
});
