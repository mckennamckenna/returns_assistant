// Shared filtering utilities for active (non-archived, non-deleted) orders.
// Used by the dashboard, weekly digest, and daily reminder cron so the
// exclusion rule is defined once and tested once.

export const HARD_DELETE_DAYS = 30;

// Prisma where-clause fragment that excludes archived and soft-deleted orders.
// Spread this into any findMany where clause that should only see active orders.
export const activeOrderFilter = {
  archivedAt: null,
  deletedAt: null,
} as const;

// The cutoff date for the nightly hard-delete sweep: orders with deletedAt
// older than this timestamp are permanently removed.
export function hardDeleteCutoff(now: Date): Date {
  return new Date(now.getTime() - HARD_DELETE_DAYS * 24 * 60 * 60 * 1000);
}
