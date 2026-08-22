// Amazon return-window-default + grocery-exclusion — Step 0 census.
// READ-ONLY — no writes, no Anthropic calls. Subject is plaintext on Email;
// fromEmail/fromName are encrypted (lib/crypto.ts), decrypted here in JS only
// where sender text is needed for the Fresh search.
//
// Usage: npx tsx scripts/census-amazon-grocery-scope.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { isAmazonOrder } from "../lib/amazonBundle";

const prisma = new PrismaClient();

const WHOLE_FOODS_SUBJECT = "your whole foods market order has been received";

async function main() {
  console.log("=== STEP 0.1 — isAmazonOrder scope ===");
  console.log(isAmazonOrder.toString());

  console.log("\n=== STEP 0.2 — Whole Foods subject signal ===");
  const allEmails = await prisma.email.findMany({
    select: { id: true, subject: true, retailer: true, orderId: true, orderNumber: true, emailType: true, needsReview: true },
  });
  const wholeFoods = allEmails.filter((e) => (e.subject ?? "").toLowerCase().includes(WHOLE_FOODS_SUBJECT));
  console.log(`Emails matching "${WHOLE_FOODS_SUBJECT}": ${wholeFoods.length}`);
  for (const e of wholeFoods) {
    console.log(
      `  id=${e.id} retailer=${e.retailer ?? "null"} isAmazonOrder(retailer)=${isAmazonOrder(e.retailer)} orderId=${e.orderId ?? "null"} emailType=${e.emailType ?? "null"} needsReview=${e.needsReview}`,
    );
  }

  console.log("\n=== STEP 0.3 — Amazon Fresh search ===");
  const all = await prisma.email.findMany({
    select: { id: true, subject: true, fromEmail: true, fromName: true, retailer: true, extractionNotes: true, emailType: true },
  });
  const freshCandidates = all.filter((e) => {
    const subj = (e.subject ?? "").toLowerCase();
    const notes = (e.extractionNotes ?? "").toLowerCase();
    const retailer = (e.retailer ?? "").toLowerCase();
    let fromEmailPlain = "";
    let fromNamePlain = "";
    try {
      fromEmailPlain = decrypt(e.fromEmail).toLowerCase();
    } catch {
      fromEmailPlain = "";
    }
    try {
      fromNamePlain = e.fromName ? decrypt(e.fromName).toLowerCase() : "";
    } catch {
      fromNamePlain = "";
    }
    const hay = `${subj} ${notes} ${retailer} ${fromEmailPlain} ${fromNamePlain}`;
    return hay.includes("fresh") || hay.includes("grocery") || hay.includes("produce") || hay.includes("perishable");
  });
  console.log(`Emails matching fresh/grocery/produce/perishable anywhere (subject/notes/retailer/sender): ${freshCandidates.length}`);
  for (const e of freshCandidates) {
    console.log(`  id=${e.id} subject=${e.subject ?? "null"} retailer=${e.retailer ?? "null"} emailType=${e.emailType ?? "null"}`);
    if (e.extractionNotes) console.log(`    notes: ${e.extractionNotes}`);
  }

  console.log("\n=== STEP 0.4 — three-way split of flagged Amazon population ===");
  // "Flagged Amazon population" = Order rows where isAmazonOrder(retailer)
  // and needsReview is true (the symptom this task targets: needsReview was
  // set because returnWindowDays/returnDeadline never resolved).
  const orders = await prisma.order.findMany({
    where: { needsReview: true },
    include: { emails: { select: { subject: true, orderNumber: true, extractionNotes: true, emailType: true } } },
  });
  const flaggedAmazon = orders.filter((o) => isAmazonOrder(o.retailer));
  console.log(`Total needsReview=true orders (all retailers): ${orders.length}`);
  console.log(`Of those, isAmazonOrder(retailer) matches: ${flaggedAmazon.length}`);

  const grocery = flaggedAmazon.filter((o) =>
    o.emails.some((e) => (e.subject ?? "").toLowerCase().includes(WHOLE_FOODS_SUBJECT)),
  );

  // Format-break heuristic (no owner-confirmed signature exists yet per
  // TASKS.md 2026-08-08 update — this is the best available proxy, flagged
  // as such in the report, not asserted as ground truth):
  // - every merge-relevant field blank (retailer/orderNumber/orderDate/orderTotal all null on the Order), or
  // - more than one distinct non-null orderNumber across the Order's linked emails (bundle/merge artifact), or
  // - extractionNotes on any linked email mentioning multiple order numbers.
  const nonGrocery = flaggedAmazon.filter((o) => !grocery.includes(o));
  const formatBreak = nonGrocery.filter((o) => {
    const allBlank = o.retailer == null && o.orderNumber == null && o.orderDate == null && o.orderTotal == null;
    const distinctOrderNumbers = new Set(o.emails.map((e) => e.orderNumber).filter((n): n is string => n != null));
    const multiOrderNote = o.emails.some((e) => /multiple order|order numbers?/i.test(e.extractionNotes ?? ""));
    return allBlank || distinctOrderNumbers.size > 1 || multiOrderNote;
  });
  const clean = nonGrocery.filter((o) => !formatBreak.includes(o));

  console.log(`\n(a) clean, no-window general Amazon — eligible for 30-day default: ${clean.length}`);
  for (const o of clean) {
    console.log(
      `  id=${o.id} retailer=${o.retailer} orderNumber=${o.orderNumber ?? "null"} orderDate=${o.orderDate?.toISOString() ?? "null"} orderTotal=${o.orderTotal ?? "null"} returnWindowDays=${o.returnWindowDays ?? "null"} policySource=${o.policySource ?? "null"} returnDeadline=${o.returnDeadline?.toISOString() ?? "null"}`,
    );
  }

  console.log(`\n(b) grocery (Whole Foods subject match) — eligible for exclusion: ${grocery.length}`);
  for (const o of grocery) {
    console.log(`  id=${o.id} retailer=${o.retailer} subjects=${o.emails.map((e) => e.subject).join(" | ")}`);
  }

  console.log(`\n(c) format-break / held aside — untouched by either rule: ${formatBreak.length}`);
  for (const o of formatBreak) {
    const distinctOrderNumbers = new Set(o.emails.map((e) => e.orderNumber).filter((n): n is string => n != null));
    console.log(
      `  id=${o.id} retailer=${o.retailer ?? "null"} orderNumber=${o.orderNumber ?? "null"} orderDate=${o.orderDate?.toISOString() ?? "null"} orderTotal=${o.orderTotal ?? "null"} distinctLinkedOrderNumbers=${distinctOrderNumbers.size} emailSubjects=${o.emails.map((e) => e.subject).join(" | ")}`,
    );
    for (const e of o.emails) {
      if (e.extractionNotes) console.log(`      note: ${e.extractionNotes}`);
    }
  }

  console.log(`\nReconciliation: (a)+(b)+(c) = ${clean.length + grocery.length + formatBreak.length}, flagged Amazon total = ${flaggedAmazon.length}`);

  console.log("\nDone. Zero writes, zero Anthropic calls.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
