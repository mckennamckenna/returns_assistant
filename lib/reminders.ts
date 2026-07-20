export type ReminderType = "7_day" | "2_day" | "1_day" | "same_day";

const DAYS_BEFORE_DEADLINE: Record<ReminderType, number> = {
  "7_day": 7,
  "2_day": 2,
  "1_day": 1,
  same_day: 0,
};

// Statuses where reminding is pointless or actively wrong: the order is
// already done, the window is already gone, or the user already started
// the return. "refund_pending" is return_started's own successor (same
// underlying event — a return_label was received — just further along in
// processing, see RETURN_PROCESSING_DAYS in lib/linkOrder.ts) and needs the
// same suppression; omitting it let a deadline reminder fire on an order
// that already has a return label filed, once status recomputed past the
// 14-day mark.
const SKIP_STATUSES = ["completed", "expired", "return_started", "refund_pending"];

// User-facing statuses where a deadline reminder is a silent violation of
// the email-first principle: the user has told us this is finished
// (returned) or fully closed out (refunded), so no more emails should
// follow. Deliberately NOT "return_requested" — the window is still open
// and the package may not have shipped yet, so the reminder still matters.
// "kept" also stops reminders — a manual, terminal decision, same as
// refunded — but relies on this explicit check same as the other two:
// auto-archiving alone (which "kept" also does) is a redundant second layer
// via reminderOrderWhere()'s activeOrderFilter, not the actual mechanism.
const SKIP_DISPLAY_STATUSES = ["returned", "refunded", "kept"];

export interface OrderForReminder {
  returnDeadline: Date | null;
  status: string;
  displayStatus: string;
  deadlineIsEstimated: boolean;
}

// A carrier delay on an estimated deadline shouldn't cause false urgency
// on the two threshold types closest to it — 7_day/2_day still carry
// enough headroom to absorb a few days' slip, but 1_day/same_day would be
// confidently wrong if the estimate is off. Shared by the normal
// reminderTypeForOrder path and the cron route's ?force=true test path,
// so a forced test send can't bypass the same rule a real run respects.
export function suppressForEstimatedDeadline(
  reminderType: ReminderType | null,
  deadlineIsEstimated: boolean,
): ReminderType | null {
  if (!reminderType) return null;
  if (deadlineIsEstimated && (reminderType === "1_day" || reminderType === "same_day")) {
    return null;
  }
  return reminderType;
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

  return suppressForEstimatedDeadline(match ? match[0] : null, order.deadlineIsEstimated);
}
