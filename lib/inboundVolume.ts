import { prisma } from "@/lib/db";

export const INBOUND_FLOOD_WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const INBOUND_FLOOD_THRESHOLD = 15; // tunable

export function windowCutoff(now: Date, windowMs: number = INBOUND_FLOOD_WINDOW_MS): Date {
  return new Date(now.getTime() - windowMs);
}

// Atomically increments a user's rolling inbound-volume counter, resetting
// the window if it's gone stale. Two guarded UPDATE statements instead of
// read-then-write — Postgres serializes concurrent UPDATEs to the same row,
// so this can't lose an increment under concurrent webhook calls (which is
// exactly when a real flood produces the highest concurrency). Returns the
// resulting count so the caller can check it against the threshold.
export async function recordInboundArrival(userId: string, now: Date = new Date()): Promise<number> {
  const cutoff = windowCutoff(now);

  const incremented = await prisma.user.updateMany({
    where: { id: userId, inboundWindowStart: { gte: cutoff } },
    data: { inboundWindowCount: { increment: 1 } },
  });

  if (incremented.count === 0) {
    // Window was null or stale — reset it. Two concurrent requests can both
    // land here and both reset; bounded to the narrow window-reset instant,
    // self-corrects on the very next message either way.
    await prisma.user.updateMany({
      where: { id: userId, OR: [{ inboundWindowStart: null }, { inboundWindowStart: { lt: cutoff } }] },
      data: { inboundWindowStart: now, inboundWindowCount: 1 },
    });
  }

  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { inboundWindowCount: true } });
  return current.inboundWindowCount;
}
