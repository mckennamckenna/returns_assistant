// Owner recalls 7/21/2026 having serious issues, possibly an API outage.
// READ-ONLY, no fixes. Cross-checking against the already-documented
// 07-19->07-20 Anthropic credit outage and the already-documented
// "same-second redelivery cluster" bug (ACE VISALIA RSC x6, GLOBAL-E NL
// B.V. x6) found in TASKS.md ~line 1501-1509, 1592-1608.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("READ-ONLY. Zero writes, zero Anthropic calls.\n");

  const dayStart = new Date("2026-07-21T00:00:00.000Z");
  const dayEnd = new Date("2026-07-22T00:00:00.000Z");

  // ==================== 2. All Emails on 2026-07-21 ====================
  console.log("########## 2. Emails with receivedAt on 2026-07-21 ##########\n");

  const dayEmails = await prisma.email.findMany({
    where: { receivedAt: { gte: dayStart, lt: dayEnd } },
    select: {
      id: true, receivedAt: true, extractedAt: true, emailType: true, retailer: true,
      forwardType: true, anchorDate: true, messageId: true, needsReview: true, junkedAt: true,
    },
    orderBy: { receivedAt: "asc" },
  });
  console.log(`Total Emails received on 2026-07-21: ${dayEmails.length}`);

  // Hourly distribution
  const byHour = new Map<number, number>();
  for (const e of dayEmails) {
    const h = e.receivedAt.getUTCHours();
    byHour.set(h, (byHour.get(h) ?? 0) + 1);
  }
  console.log("\nHourly distribution (UTC):");
  for (let h = 0; h < 24; h++) {
    const count = byHour.get(h) ?? 0;
    if (count > 0) console.log(`  ${String(h).padStart(2, "0")}:00 — ${count}`);
  }

  // forwardType/anchorDate null-rate on this day vs. a clean baseline day
  // to check whether nullness here is incident-specific or just rollout timing
  // (ANCHOR_DATE_RESOLVER.md shipped 2026-07-25 -- expect 100% null pre-that,
  // regardless of any incident).
  const forwardTypeNullCount = dayEmails.filter((e) => e.forwardType == null).length;
  console.log(`\nforwardType IS NULL on 07-21: ${forwardTypeNullCount} of ${dayEmails.length} (${((forwardTypeNullCount / dayEmails.length) * 100).toFixed(0)}%)`);

  const laterDayStart = new Date("2026-07-27T00:00:00.000Z");
  const laterDayEnd = new Date("2026-07-28T00:00:00.000Z");
  const laterDayEmails = await prisma.email.findMany({
    where: { receivedAt: { gte: laterDayStart, lt: laterDayEnd } },
    select: { forwardType: true },
  });
  const laterNullCount = laterDayEmails.filter((e) => e.forwardType == null).length;
  console.log(`Baseline check, 2026-07-27 (post ANCHOR_DATE_RESOLVER.md ship date 07-25): forwardType IS NULL on ${laterNullCount} of ${laterDayEmails.length}`);
  console.log("(If 07-21 is ~100% null and 07-27 is mostly non-null, forwardType nullness is a ROLLOUT-TIMING artifact, not an incident signal on its own.)");

  // The real signal: extraction never completing.
  const extractedAtNullOnDay = dayEmails.filter((e) => e.extractedAt == null);
  console.log(`\nextractedAt IS NULL on 07-21 (extraction never completed, any reason): ${extractedAtNullOnDay.length} of ${dayEmails.length}`);
  console.log("Distribution of THESE across the day (is it isolated to 17:36:09, or spread out?):");
  const stuckByMinute = new Map<string, number>();
  for (const e of extractedAtNullOnDay) {
    const key = e.receivedAt.toISOString().slice(11, 16); // HH:MM
    stuckByMinute.set(key, (stuckByMinute.get(key) ?? 0) + 1);
  }
  for (const [time, count] of [...stuckByMinute.entries()].sort()) {
    console.log(`  ${time} UTC: ${count} row(s) never extracted`);
  }

  const emailTypeNullOnDay = dayEmails.filter((e) => e.emailType == null);
  console.log(`\nemailType IS NULL on 07-21 (superset -- includes attempted-but-failed): ${emailTypeNullOnDay.length} of ${dayEmails.length}`);

  // messageId null-rate this day (dedup feature shipped 07-26, expect ~100% null)
  const messageIdNullOnDay = dayEmails.filter((e) => e.messageId == null).length;
  console.log(`\nmessageId IS NULL on 07-21 (dedup feature shipped 07-26, expected ~100% pre-that): ${messageIdNullOnDay} of ${dayEmails.length}`);

  // Same-second (or same-minute) duplicate clusters -- the "redelivery" signature
  console.log("\n--- Same-timestamp clusters on 07-21 (candidate redelivery duplicates) ---");
  const byTimestamp = new Map<string, typeof dayEmails>();
  for (const e of dayEmails) {
    const key = e.receivedAt.toISOString();
    if (!byTimestamp.has(key)) byTimestamp.set(key, []);
    byTimestamp.get(key)!.push(e);
  }
  let clusterCount = 0;
  let clusteredRowCount = 0;
  for (const [ts, rows] of byTimestamp) {
    if (rows.length > 1) {
      clusterCount++;
      clusteredRowCount += rows.length;
      const extractedCount = rows.filter((r) => r.extractedAt != null).length;
      console.log(`  ${ts}: ${rows.length} rows, ${extractedCount} successfully extracted, ${rows.length - extractedCount} never extracted`);
    }
  }
  console.log(`\nTotal same-timestamp clusters on 07-21: ${clusterCount}, covering ${clusteredRowCount} of ${dayEmails.length} rows`);

  // ==================== 3. DiscardLog on 2026-07-21 ====================
  console.log("\n\n########## 3. DiscardLog rows on 2026-07-21 ##########\n");

  const dayDiscards = await prisma.discardLog.findMany({
    where: { occurredAt: { gte: dayStart, lt: dayEnd } },
    orderBy: { occurredAt: "asc" },
  });
  console.log(`Total DiscardLog rows on 2026-07-21: ${dayDiscards.length}`);

  const byReason = new Map<string, number>();
  for (const d of dayDiscards) byReason.set(d.reason, (byReason.get(d.reason) ?? 0) + 1);
  console.log("By reason:");
  for (const [reason, count] of byReason) console.log(`  ${reason}: ${count}`);

  const discardByHour = new Map<number, number>();
  for (const d of dayDiscards) {
    const h = d.occurredAt.getUTCHours();
    discardByHour.set(h, (discardByHour.get(h) ?? 0) + 1);
  }
  console.log("\nHourly distribution (UTC):");
  for (let h = 0; h < 24; h++) {
    const count = discardByHour.get(h) ?? 0;
    if (count > 0) console.log(`  ${String(h).padStart(2, "0")}:00 — ${count}`);
  }

  // Baseline comparison -- an adjacent, apparently-quiet day
  const baselineStart = new Date("2026-07-15T00:00:00.000Z");
  const baselineEnd = new Date("2026-07-16T00:00:00.000Z");
  const baselineDiscards = await prisma.discardLog.count({ where: { occurredAt: { gte: baselineStart, lt: baselineEnd } } });
  const baselineEmails = await prisma.email.count({ where: { receivedAt: { gte: baselineStart, lt: baselineEnd } } });
  console.log(`\nBaseline comparison, 2026-07-15 (a day not implicated in any known incident): ${baselineDiscards} DiscardLog rows, ${baselineEmails} Emails received.`);
  console.log(`07-21 for comparison: ${dayDiscards.length} DiscardLog rows, ${dayEmails.length} Emails received.`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
