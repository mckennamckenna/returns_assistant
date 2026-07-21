// The weekly-coverage cron fires every Friday at 16:00 UTC (vercel.json).
// Dedup keys off "has this user already been sent a coverage check since
// this week's scheduled run," not a rolling 7-day lookback from the exact
// invocation instant — a rolling window silently absorbs anything that
// fires off the exact weekly cadence (a force/test send, a late retry),
// which is exactly how an off-schedule Jun 27 (Saturday) force send
// suppressed the real Jul 3 (Friday) scheduled run: 6 days apart, inside a
// 7-day trailing window computed from Jul 3.
export const COVERAGE_CHECK_CRON_DAY_UTC = 5; // Friday (0 = Sunday, per Date#getUTCDay)
export const COVERAGE_CHECK_CRON_HOUR_UTC = 16;

// Returns the most recent scheduled-run instant (this week's Friday 16:00
// UTC) at or before `now`. Pure — takes `now` as a parameter, no Date.now()
// or DB access inside, so it's testable without mocks.
export function scheduledRunWeekStart(now: Date): Date {
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), COVERAGE_CHECK_CRON_HOUR_UTC, 0, 0, 0),
  );
  const daysSinceScheduledDay = (d.getUTCDay() - COVERAGE_CHECK_CRON_DAY_UTC + 7) % 7;
  d.setUTCDate(d.getUTCDate() - daysSinceScheduledDay);
  // If that landed on today but still in the future (before this week's
  // scheduled hour has actually happened), the relevant boundary is last
  // week's run instead — this week's hasn't occurred yet.
  if (d.getTime() > now.getTime()) {
    d.setUTCDate(d.getUTCDate() - 7);
  }
  return d;
}
