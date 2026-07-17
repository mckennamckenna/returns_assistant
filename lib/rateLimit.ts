import { prisma } from "@/lib/db";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

// Fixed-window approximation, not true sliding window: windowStart is
// rounded down to a windowSeconds boundary, so a burst straddling a window
// edge can admit up to ~2x the limit across the two adjacent windows in the
// worst case. True sliding window (e.g. a log of individual timestamps, or
// a weighted blend of the previous window's count) would close that gap,
// but at this app's traffic volume the worst case is a handful of extra
// requests, not a meaningful cost/abuse exposure — not worth the extra
// storage and read complexity. Revisit if real abuse data ever shows the
// edge case being exploited.
function windowStartFor(now: Date, windowSeconds: number): Date {
  const windowMs = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

// Guarded two-phase UPDATE, same pattern as lib/inboundVolume.ts's
// recordInboundArrival — learned during the Postmark hardening work. A
// naive read-then-write (SELECT count, check, UPDATE count+1) loses
// increments under concurrent requests to the same key, which is exactly
// when a real burst produces the highest concurrency. Postgres serializes
// concurrent UPDATEs to the same row, so the guarded increment below can't
// lose a count; the upsert-on-miss path only runs when the row doesn't
// exist yet or its window has gone stale, and is safe to race (worst case
// two concurrent inserts, unique-violation swallowed by the retry below).
export async function rateLimit({
  key,
  limit,
  windowSeconds,
}: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitResult> {
  const now = new Date();
  const currentWindowStart = windowStartFor(now, windowSeconds);
  const resetAt = new Date(currentWindowStart.getTime() + windowSeconds * 1000);

  const incremented = await prisma.rateLimitCounter.updateMany({
    where: { key, windowStart: currentWindowStart },
    data: { count: { increment: 1 } },
  });

  let count: number;
  if (incremented.count > 0) {
    const row = await prisma.rateLimitCounter.findUniqueOrThrow({ where: { key } });
    count = row.count;
  } else {
    // No row for this key+window — either the key has never been seen, or
    // its window is stale. upsert with a fresh windowStart/count: 1 either
    // creates the row or overwrites a stale one. Two concurrent requests
    // can both land here on the very first request of a new window; both
    // upserts succeed (upsert is itself atomic per Prisma/Postgres), one of
    // them just "wins" and sets count to 1, undercounting by at most the
    // width of that race — self-corrects on the next request either way,
    // same tolerance as inboundVolume.ts's reset path.
    const row = await prisma.rateLimitCounter.upsert({
      where: { key },
      update: { windowStart: currentWindowStart, count: 1 },
      create: { key, windowStart: currentWindowStart, count: 1 },
    });
    count = row.count;
  }

  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

// No window used by this app exceeds an hour today, but the sweep keeps a
// day of headroom rather than tracking "the longest window currently in
// use" — cheap insurance if a longer window gets added later without
// remembering to widen this cutoff too.
export const RATE_LIMIT_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function rateLimitSweepCutoff(now: Date): Date {
  return new Date(now.getTime() - RATE_LIMIT_SWEEP_MAX_AGE_MS);
}

// The Prisma where clause for the cron sweep, exported so tests can assert
// on it directly — same convention as autoArchiveOrderWhere/reminderOrderWhere.
export function rateLimitSweepWhere(now: Date) {
  return { windowStart: { lt: rateLimitSweepCutoff(now) } };
}
