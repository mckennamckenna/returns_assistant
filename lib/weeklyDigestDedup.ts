// The weekly-digest cron fires every Sunday at 16:00 UTC (vercel.json).
// Mirrors lib/coverageCheck.ts's fix for the identical bug in
// weekly-coverage (commit 9163d0b, TASKS.md 2026-07-20). Dedup keys off
// "has this user already been sent a digest since this week's scheduled
// run," not a rolling 7-day lookback from the exact invocation instant —
// a rolling window is exactly what let an off-schedule force/test send
// suppress a real scheduled run days later in the weekly-coverage incident.
//
// Deliberately duplicated from lib/coverageCheck.ts rather than shared —
// flagged as tech debt in TASKS.md's Known Issues. The two routes' dedup
// logic (and this date-math helper) could be unified in a future pass.
export const WEEKLY_DIGEST_CRON_DAY_UTC = 0; // Sunday (0 = Sunday, per Date#getUTCDay)
export const WEEKLY_DIGEST_CRON_HOUR_UTC = 16;

// Returns the most recent scheduled-run instant (this week's Sunday 16:00
// UTC) at or before `now`. Pure — takes `now` as a parameter, no
// Date.now() or DB access inside, so it's testable without mocks.
export function scheduledRunWeekStart(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), WEEKLY_DIGEST_CRON_HOUR_UTC, 0, 0, 0),
  );
  const daysSinceScheduledDay = (d.getUTCDay() - WEEKLY_DIGEST_CRON_DAY_UTC + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceScheduledDay);
  // If that landed on today but still in the future (before this week's
  // scheduled hour has actually happened), the relevant boundary is last
  // week's run instead — this week's hasn't occurred yet.
  if (d.getTime() > now.getTime()) {
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return d;
}
