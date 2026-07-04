import { describe, it, expect } from "vitest";
import { reminderTypeForOrder, isEligibleForReminder, type OrderForReminder } from "../lib/reminders";

// ── Deadline reminders vs. user-reported displayStatus ───────────────────────
// Email-first principle: once the user tells us an order is "returned" or
// "refunded," no more emails about it — a deadline reminder at that point is
// a silent violation, since the user has already closed the loop themselves.
// "return_requested" is deliberately excluded: the window is still open and
// the package may not have shipped, so the reminder still matters.

describe("deadline reminders vs. displayStatus", () => {
  const today = new Date("2026-07-03T12:00:00.000Z");
  const sevenDaysOut = new Date("2026-07-10T12:00:00.000Z");

  function order(displayStatus: string): OrderForReminder {
    return { returnDeadline: sevenDaysOut, status: "ordered", displayStatus };
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
