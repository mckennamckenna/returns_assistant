export type ReminderType = "7_day" | "2_day" | "1_day" | "same_day";

const DAYS_BEFORE_DEADLINE: Record<ReminderType, number> = {
  "7_day": 7,
  "2_day": 2,
  "1_day": 1,
  same_day: 0,
};

// Statuses where reminding is pointless or actively wrong: the order is
// already done, the window is already gone, or the user already started
// the return.
const SKIP_STATUSES = ["completed", "expired", "return_started"];

// User-facing statuses where a deadline reminder is a silent violation of
// the email-first principle: the user has told us this is finished
// (returned) or fully closed out (refunded), so no more emails should
// follow. Deliberately NOT "return_requested" — the window is still open
// and the package may not have shipped yet, so the reminder still matters.
const SKIP_DISPLAY_STATUSES = ["returned", "refunded"];

export interface OrderForReminder {
  returnDeadline: Date | null;
  status: string;
  displayStatus: string;
}

// Calendar-day difference, ignoring time-of-day — a deadline of "today at
// 11pm UTC" should still count as 0 days away at any point during today,
// not flicker between 0 and 1 depending on what time the cron runs.
export function daysUntil(deadline: Date, today: Date): number {
  const deadlineUTC = Date.UTC(deadline.getUTCFullYear(), deadline.getUTCMonth(), deadline.getUTCDate());
  const todayUTC = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((deadlineUTC - todayUTC) / (24 * 60 * 60 * 1000));
}

// Status/deadline eligibility only — independent of which day it is, so
// callers (like the cron route's ?force=true test path) can check "would
// this order ever get a reminder" without also requiring an exact day match.
export function isEligibleForReminder(order: OrderForReminder): order is OrderForReminder & { returnDeadline: Date } {
  if (SKIP_STATUSES.includes(order.status)) return false;
  if (SKIP_DISPLAY_STATUSES.includes(order.displayStatus)) return false;
  // Covers "needsReview with no confirmed deadline" — can't remind about a
  // deadline we don't have, regardless of why it's missing.
  return order.returnDeadline != null;
}

// Pure function: given an order and "today," returns which reminder
// (if any) should fire today. No DB access, no sending — callers are
// responsible for checking the Reminder table for duplicates and for
// actually sending the email.
export function reminderTypeForOrder(order: OrderForReminder, today: Date = new Date()): ReminderType | null {
  if (!isEligibleForReminder(order)) return null;

  const days = daysUntil(order.returnDeadline, today);
  const match = (Object.entries(DAYS_BEFORE_DEADLINE) as [ReminderType, number][]).find(
    ([, daysBefore]) => daysBefore === days,
  );

  return match ? match[0] : null;
}
