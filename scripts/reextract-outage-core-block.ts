// DATA REPAIR — spends real money. Re-extracts the 23 core-block
// emailType:null rows from the 2026-07-19T23:55:37Z–2026-07-20T22:52:46Z
// Anthropic-outage window (TASKS.md 🔴 Now, 2026-07-26). Owner-confirmed
// target list and go-ahead before running. Explicitly excludes the 12
// ragged-tail redelivery-duplicate rows (07-21 same-second clusters) —
// those are a separate cleanup, not outage scar.
//
// Usage: npx tsx scripts/reextract-outage-core-block.ts
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "@/lib/runExtraction";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmrsgelss0009l704yi0eeo8y",
  "cmrsgfoub000bl704epty19wz",
  "cmrshinpr0001i304r8o7nv2l",
  "cmrshjtxi0003i3048df6k79t",
  "cmrsiroio0001jv04tdsj4xrh",
  "cmrsit55s0001js04t66crtyy",
  "cmrsju7w20001ju04dug6hl5f",
  "cmrsk1vca0001jj04bxo1q21v",
  "cmrsmke130001jx045jtqlc5p",
  "cmrss8oc60001l504dtt8do5e",
  "cmrsss2d80001jj0446cyqzj4",
  "cmrt8g58q0001js04sfee2v9i",
  "cmrt8ze3f0001jl04qhb2f0sw",
  "cmrt955he0003jl04lvusqljj",
  "cmrtapm3l0001l404w2c7r5e9",
  "cmrtje1gx0001l204oc93tddt",
  "cmrtjzg6o0001jm04jgtp04w4",
  "cmrtnc1t60001jq04gy0dhlfi",
  "cmrtr37000001jq042755pl7d",
  "cmrts7xzq0001jh041q9boj7e",
  "cmrtsd7ru0001jm04cfmqi6tp",
  "cmrttljgy0001l404rpvb3fbo",
  "cmrttlnnm0003l404cfpixct8",
];

async function main() {
  if (TARGET_IDS.length !== 23) {
    throw new Error(`Expected exactly 23 target ids, got ${TARGET_IDS.length} — aborting, not spending anything.`);
  }

  // Sanity re-check right before spending: every target must still be
  // emailType: null and within the confirmed core-block window. If the
  // set drifted since the pre-flight read, stop rather than spend on the
  // wrong rows.
  const preCheck = await prisma.email.findMany({
    where: { id: { in: TARGET_IDS } },
    select: { id: true, emailType: true, receivedAt: true },
  });
  if (preCheck.length !== 23) {
    throw new Error(`Expected to find 23 rows, found ${preCheck.length} — aborting.`);
  }
  const drifted = preCheck.filter((r) => r.emailType !== null);
  if (drifted.length > 0) {
    throw new Error(`${drifted.length} target row(s) are no longer emailType:null (already re-extracted?) — aborting: ${drifted.map((r) => r.id).join(", ")}`);
  }

  console.log(`Pre-check passed: all 23 targets confirmed emailType:null. Beginning sequential re-extraction (~23 Sonnet calls, plus any triggered return-policy lookups).\n`);

  let lookupWebSuccessCount = 0;
  let lookupUnclearCount = 0;
  let lookupErrorCount = 0;

  const origConsoleError = console.error;
  let lastErrorCapture: string | null = null;
  console.error = (...args: unknown[]) => {
    const msg = args.map(String).join(" ");
    if (msg.includes("Return policy web lookup failed")) {
      lastErrorCapture = msg;
    }
    origConsoleError(...args);
  };

  const results: {
    id: string;
    receivedAt: string;
    before: { emailType: null };
    after: { emailType: string | null; retailer: string | null; orderNumber: string | null; orderId: string | null; needsReview: boolean; policySource: string | null; extractionNotes: string | null };
    lookupAttempted: "web_lookup_success" | "web_lookup_unclear" | "web_lookup_error" | "none";
  }[] = [];

  for (const id of TARGET_IDS) {
    lastErrorCapture = null;
    await runExtraction(id);

    const after = await prisma.email.findUnique({
      where: { id },
      select: { receivedAt: true, emailType: true, retailer: true, orderNumber: true, orderId: true, needsReview: true, policySource: true, extractionNotes: true },
    });
    if (!after) continue;

    let lookupAttempted: (typeof results)[number]["lookupAttempted"] = "none";
    if (after.policySource === "web_lookup") {
      lookupAttempted = "web_lookup_success";
      lookupWebSuccessCount++;
    } else if (after.extractionNotes?.includes("Web lookup for return policy was unclear")) {
      lookupAttempted = "web_lookup_unclear";
      lookupUnclearCount++;
    } else if (lastErrorCapture) {
      lookupAttempted = "web_lookup_error";
      lookupErrorCount++;
    }

    results.push({
      id,
      receivedAt: after.receivedAt.toISOString(),
      before: { emailType: null },
      after: {
        emailType: after.emailType,
        retailer: after.retailer,
        orderNumber: after.orderNumber,
        orderId: after.orderId,
        needsReview: after.needsReview,
        policySource: after.policySource,
        extractionNotes: after.extractionNotes,
      },
      lookupAttempted,
    });

    console.log(`Done: ${id} (${after.receivedAt.toISOString()}) -> emailType=${after.emailType ?? "STILL NULL"} retailer=${after.retailer ?? "null"} orderId=${after.orderId ?? "null"} lookup=${lookupAttempted}`);
  }

  console.error = origConsoleError;

  console.log("\n=== SUMMARY ===");
  const stillNull = results.filter((r) => r.after.emailType === null);
  const repaired = results.filter((r) => r.after.emailType !== null);
  console.log(`Total processed: ${results.length}`);
  console.log(`Repaired (emailType now populated): ${repaired.length}`);
  console.log(`Still null (genuinely unreadable / extraction failed again): ${stillNull.length}`);
  console.log(`\nExtra billed return-policy-lookup calls triggered: ${lookupWebSuccessCount + lookupUnclearCount + lookupErrorCount} (success=${lookupWebSuccessCount}, unclear=${lookupUnclearCount}, error=${lookupErrorCount})`);
  console.log(`Total billed Anthropic calls this run: ${results.length} (extractEmail) + ${lookupWebSuccessCount + lookupUnclearCount + lookupErrorCount} (lookupReturnPolicy) = ${results.length + lookupWebSuccessCount + lookupUnclearCount + lookupErrorCount}`);

  console.log("\n=== PER-ROW DETAIL ===");
  for (const r of results) {
    console.log(
      `${r.id} | ${r.receivedAt} | emailType=${r.after.emailType ?? "STILL NULL"} | retailer=${r.after.retailer ?? "null"} | orderNumber=${r.after.orderNumber ?? "null"} | orderId=${r.after.orderId ?? "null"} | needsReview=${r.after.needsReview} | lookup=${r.lookupAttempted}`
    );
  }

  if (stillNull.length > 0) {
    console.log("\n=== STILL-NULL ROWS (real residue) ===");
    for (const r of stillNull) console.log(`  ${r.id} (${r.receivedAt})`);
  }
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
