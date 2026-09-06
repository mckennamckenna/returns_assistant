// Diagnostic: blast-radius census for the retry-trigger proxy-signal
// failure surfaced by the 2026-09-06 Gap extraction diagnostic
// (docs/audits/2026-09-06-gap-extraction-diagnostic.md). TASKS.md 🔴 Now,
// 2026-09-06.
//
// Confirmed mechanism (Gap diagnostic): extractEmailIdentity's two-pass
// retry (efd4f43) gates solely on `orderNumber == null` after pass 1. When
// orderNumber is supplied by a non-body source (e.g. the subject line) even
// though the body pass 1 actually used was thin/boilerplate, the gate is
// satisfied before the body ever mattered, the retry never fires, and every
// body-content-dependent field (orderDate, orderTotal, lineItems,
// returnWindowDays) comes back null.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Prisma reads + the
// app's own decrypt() helper (spot-check only, to read subject/body context
// and extractionNotes — extractionNotes itself is NOT encrypted, but
// textBody/subject inspection needs decrypt() for textBody).
//
// Usage: npx tsx scripts/audits/retry-trigger-blast-radius-census.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";

const prisma = new PrismaClient();

const RETRY_NOTE = "Order number recovered from alternate body source on retry";

async function main() {
  // Baseline population: order_confirmation is the type where
  // orderDate/orderTotal/lineItems/returnWindowDays are all expected to be
  // present when extraction works — scoping here avoids false-flagging
  // shipping_confirmation/return_label/delivery/refund rows that never
  // carry those fields regardless of this bug.
  const baseline = await prisma.email.count({
    where: { emailType: "order_confirmation" },
  });

  // Pattern match: gate-signal field present (orderNumber), every
  // body-content-dependent field null. lineItems is a Json? column —
  // Prisma can't express "null or []" in one where-clause cleanly for Json,
  // so fetch orderNumber-present/other-fields-null candidates first and
  // filter lineItems in JS.
  const candidates = await prisma.email.findMany({
    where: {
      emailType: "order_confirmation",
      orderNumber: { not: null },
      orderDate: null,
      orderTotal: null,
      returnWindowDays: null,
    },
    select: {
      id: true,
      subject: true,
      retailer: true,
      retailerSource: true,
      needsReview: true,
      extractionNotes: true,
      textBody: true,
      lineItems: true,
    },
  });

  const matched = candidates.filter((c) => {
    const li = c.lineItems;
    return li == null || (Array.isArray(li) && li.length === 0);
  });

  console.log(`Baseline population (emailType=order_confirmation): ${baseline}`);
  console.log(`Pattern-matched rows (orderNumber present, all body-dependent fields null): ${matched.length}`);

  // Retailer breakdown of the matched set.
  const byRetailer = new Map<string, number>();
  for (const m of matched) {
    const key = m.retailer ?? "(null)";
    byRetailer.set(key, (byRetailer.get(key) ?? 0) + 1);
  }
  console.log("\nRetailer breakdown (matched set):");
  for (const [retailer, count] of [...byRetailer.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${retailer}: ${count}`);
  }

  // retailerSource breakdown, supporting color only (not a claim of a
  // confirmed retailer-gated variant of the mechanism).
  const bySource = new Map<string, number>();
  for (const m of matched) {
    const key = m.retailerSource ?? "(null)";
    bySource.set(key, (bySource.get(key) ?? 0) + 1);
  }
  console.log("\nretailerSource breakdown (matched set, supporting color only):");
  for (const [src, count] of [...bySource.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${src}: ${count}`);
  }

  // Split by needsReview.
  const flagged = matched.filter((m) => m.needsReview);
  const silent = matched.filter((m) => !m.needsReview);
  console.log(`\nneedsReview=true (flagged): ${flagged.length}`);
  console.log(`needsReview=false (SILENT SLICE): ${silent.length}`);

  const silentByRetailer = new Map<string, number>();
  for (const m of silent) {
    const key = m.retailer ?? "(null)";
    silentByRetailer.set(key, (silentByRetailer.get(key) ?? 0) + 1);
  }
  console.log("\nSilent-slice retailer breakdown:");
  for (const [retailer, count] of [...silentByRetailer.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${retailer}: ${count}`);
  }

  // Spot-check: up to 5 rows, prefer non-Gap first, include extractionNotes
  // inspection per the owner's Addition 1.
  const nonGap = matched.filter((m) => m.retailer !== "Gap");
  const gap = matched.filter((m) => m.retailer === "Gap");
  const spotCheckPool = [...nonGap, ...gap].slice(0, 5);

  console.log(`\n=== SPOT-CHECK (${spotCheckPool.length} rows) ===`);
  for (const row of spotCheckPool) {
    const text = row.textBody ? decrypt(row.textBody) : "";
    const notes = row.extractionNotes ?? "";
    const mentionsSubjectOrNonBodySource = /subject line|sender|from name|from email|branding|customer service address/i.test(notes);
    const hasRetryNote = notes.includes(RETRY_NOTE);

    let verdict: string;
    if (hasRetryNote) {
      verdict = "RETRY FIRED — does not match the confirmed no-retry mechanism (exclude)";
    } else if (mentionsSubjectOrNonBodySource) {
      verdict = "MECHANISM CONFIRMED — notes indicate non-body source supplied orderNumber, no retry-recovery note present";
    } else {
      verdict = "SHAPE-MATCH, MECHANISM UNCONFIRMED — notes don't clearly attribute orderNumber to a non-body source";
    }

    console.log(`\n--- id=${row.id} retailer=${row.retailer} retailerSource=${row.retailerSource} needsReview=${row.needsReview} ---`);
    console.log("subject:", row.subject);
    console.log("textBody char count:", text.length);
    console.log("textBody first 300 chars:", JSON.stringify(text.slice(0, 300)));
    console.log("extractionNotes:", JSON.stringify(notes));
    console.log("VERDICT:", verdict);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
