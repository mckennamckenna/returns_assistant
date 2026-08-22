// Orphan linking-gap categorization + cross-user security cross-check
// (TASKS.md, 2026-08-04). READ-ONLY — no writes, no Anthropic calls.
// Does not import runExtraction/extractEmail.
//
// For each orphaned genuine-commerce email (orderId: null, emailType set,
// not "other"), classifies WHY it never linked:
//   1. no orderNumber extracted at all
//   2. orderNumber present, but no Order anywhere carries that number
//   3. a candidate order clearly exists (same user + retailer, closest date)
//      but the matcher never fired -- the fallback-matcher design input
//
// Also cross-checks every orphan's userId against ANY matching order's
// userId (not just same-user candidates) to catch the cross-user
// mis-forward exposure class (HISTORY.md 2026-07-28 Wayfair/On finding)
// rather than assuming same-user.
//
// Usage: npx tsx scripts/census-orphan-linking-gap.ts
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const DATE_WINDOW_DAYS = 90;

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24);
}

async function main() {
  console.log("ORPHAN LINKING-GAP CENSUS — READ ONLY. Zero writes, zero Anthropic calls.\n");

  const orphans = await prisma.email.findMany({
    where: {
      orderId: null,
      emailType: { not: null, notIn: ["other"] },
      junkedAt: null,
    },
    select: {
      id: true,
      userId: true,
      receivedAt: true,
      emailType: true,
      retailer: true,
      orderNumber: true,
      subject: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Orphaned genuine-commerce set: ${orphans.length}\n`);

  const bucket1NoOrderNumber: typeof orphans = [];
  const bucket2NoMatchingOrder: typeof orphans = [];
  const bucket3CandidateExists: { email: (typeof orphans)[number]; orderId: string; days: number }[] = [];
  const crossUserFlags: { emailId: string; emailUserId: string; matchOrderId: string; matchUserId: string; reason: string }[] = [];

  for (const e of orphans) {
    // --- Cross-user check FIRST, unscoped by userId: does an order with
    // this exact orderNumber exist for a DIFFERENT user?
    if (e.orderNumber) {
      const anyOrderWithNumber = await prisma.order.findMany({
        where: { orderNumber: { equals: e.orderNumber, mode: "insensitive" }, deletedAt: null },
        select: { id: true, userId: true, retailer: true, orderDate: true },
      });
      const otherUserMatch = anyOrderWithNumber.find((o) => o.userId !== e.userId);
      if (otherUserMatch) {
        crossUserFlags.push({
          emailId: e.id,
          emailUserId: e.userId,
          matchOrderId: otherUserMatch.id,
          matchUserId: otherUserMatch.userId,
          reason: `orderNumber ${e.orderNumber} matches an order belonging to a different userId`,
        });
      }
      const sameUserMatch = anyOrderWithNumber.find((o) => o.userId === e.userId);
      if (sameUserMatch) {
        // orderNumber matches an order for the SAME user — this email
        // shouldn't be orphaned; anomaly, not a linking-gap bucket.
        console.log(`ANOMALY: ${e.id} has orderNumber ${e.orderNumber} matching same-user Order ${sameUserMatch.id} but orderId is still null — matcher should have caught this.`);
        continue;
      }
    }

    // --- Candidate-order search, same user + same retailer (insensitive),
    // closest by date -- what a fallback matcher would need to fire.
    let candidate: { id: string; orderDate: Date | null; createdAt: Date } | null = null;
    if (e.retailer) {
      const sameUserSameRetailer = await prisma.order.findMany({
        where: { userId: e.userId, retailer: { equals: e.retailer, mode: "insensitive" }, deletedAt: null },
        select: { id: true, orderDate: true, createdAt: true },
      });
      if (sameUserSameRetailer.length > 0) {
        // Closest by date to the orphan email's receivedAt (orderDate if
        // present, else createdAt as a proxy).
        const withDist = sameUserSameRetailer.map((o) => ({
          o,
          dist: daysBetween(o.orderDate ?? o.createdAt, e.receivedAt),
        }));
        withDist.sort((a, b) => a.dist - b.dist);
        if (withDist[0].dist <= DATE_WINDOW_DAYS) {
          candidate = withDist[0].o;
          bucket3CandidateExists.push({ email: e, orderId: candidate.id, days: withDist[0].dist });
          continue;
        }
      }
    }

    // --- No candidate found. Split remaining by orderNumber presence.
    if (!e.orderNumber) {
      bucket1NoOrderNumber.push(e);
    } else {
      bucket2NoMatchingOrder.push(e);
    }
  }

  console.log("=== BUCKET 1: no orderNumber extracted at all ===");
  console.log(`Count: ${bucket1NoOrderNumber.length}`);
  for (const e of bucket1NoOrderNumber) {
    console.log(`  ${e.id} | ${e.receivedAt.toISOString()} | type=${e.emailType} | retailer=${e.retailer ?? "null"}`);
  }

  console.log("\n=== BUCKET 2: orderNumber present, no order anywhere carries it ===");
  console.log(`Count: ${bucket2NoMatchingOrder.length}`);
  for (const e of bucket2NoMatchingOrder) {
    console.log(`  ${e.id} | ${e.receivedAt.toISOString()} | type=${e.emailType} | retailer=${e.retailer ?? "null"} | orderNumber=${e.orderNumber}`);
  }

  console.log("\n=== BUCKET 3: candidate order exists (same user + retailer, within " + DATE_WINDOW_DAYS + "d) — FALLBACK-MATCHER DESIGN INPUT ===");
  console.log(`Count: ${bucket3CandidateExists.length}`);
  const retailerCounts = new Map<string, number>();
  for (const c of bucket3CandidateExists) {
    const r = c.email.retailer ?? "unknown";
    retailerCounts.set(r, (retailerCounts.get(r) ?? 0) + 1);
    console.log(
      `  ${c.email.id} | ${c.email.receivedAt.toISOString()} | type=${c.email.emailType} | retailer=${c.email.retailer} | candidateOrder=${c.orderId} | dateDist=${c.days.toFixed(1)}d`,
    );
  }
  console.log("\nRetailer breakdown of Bucket 3:");
  for (const [r, n] of [...retailerCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${r}: ${n}`);
  }

  console.log("\n=== CROSS-USER SECURITY FLAGS (separate from linking-gap buckets) ===");
  console.log(`Count: ${crossUserFlags.length}`);
  for (const f of crossUserFlags) {
    console.log(`  EMAIL ${f.emailId} (userId=${f.emailUserId}) vs ORDER ${f.matchOrderId} (userId=${f.matchUserId}) — ${f.reason}`);
  }

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
