// Diagnostic: Gap order confirmation (#1RYJR48, forwarded 2026-09-02) —
// extraction came back nearly-blank despite the viewer showing full order
// data. TASKS.md 🔴 Now, 2026-09-06.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Prisma reads + the
// app's own decrypt() helper + resolveBodyText/resolveBodyTextWithAlternate
// (called read-only, exactly as production calls them — output never
// written anywhere here) + string inspection.
//
// Usage: npx tsx scripts/audits/gap-extraction-diagnostic.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";
import { resolveBodyText, resolveBodyTextWithAlternate } from "../../lib/emailBodyText";

const prisma = new PrismaClient();

const EFD4F43_DEPLOY = new Date("2026-08-23T09:35:26-07:00");

async function main() {
  const candidates = await prisma.email.findMany({
    where: {
      receivedAt: { gte: new Date("2026-09-02T00:00:00Z"), lt: new Date("2026-09-03T00:00:00Z") },
      needsReview: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Candidates (2026-09-02, needsReview=true): ${candidates.length}`);

  let target: (typeof candidates)[number] | null = null;
  let targetText = "";
  let targetHtml = "";

  for (const c of candidates) {
    const t = c.textBody ? decrypt(c.textBody) : "";
    const h = c.htmlBody ? decrypt(c.htmlBody) : "";
    const subj = c.subject ?? "";
    if (t.includes("1RYJR48") || h.includes("1RYJR48") || subj.includes("1RYJR48")) {
      target = c;
      targetText = t;
      targetHtml = h;
      break;
    }
  }

  if (!target) {
    console.log("No candidate matched '1RYJR48' in subject/textBody/htmlBody. Listing candidates for manual review:");
    for (const c of candidates) {
      console.log(`  id=${c.id} subject=${JSON.stringify(c.subject)} retailer=${c.retailer} needsReview=${c.needsReview} extractedAt=${c.extractedAt}`);
    }
    return;
  }

  console.log("\n=== MATCH ===");
  console.log("id:", target.id);
  console.log("subject:", target.subject);
  console.log("retailer:", target.retailer, "| carrier:", target.carrier);
  console.log("emailType:", target.emailType, "| confidence:", target.confidence, "| needsReview:", target.needsReview);
  console.log("orderNumber:", target.orderNumber, "| orderDate:", target.orderDate);

  // --- STEP 0: chronology ---
  console.log("\n=== STEP 0: chronology ===");
  console.log("email.extractedAt:", target.extractedAt?.toISOString() ?? null);
  console.log("efd4f43 deploy (H&M two-pass retry):", EFD4F43_DEPLOY.toISOString());
  if (target.extractedAt) {
    console.log("extraction ran AFTER efd4f43 deploy:", target.extractedAt.getTime() > EFD4F43_DEPLOY.getTime());
  }

  // --- STEP 1: raw stored fields ---
  console.log("\n=== STEP 1: raw stored fields ===");
  console.log("textBody char count:", targetText.length);
  console.log("textBody first 500 chars:", JSON.stringify(targetText.slice(0, 500)));
  console.log("htmlBody char count:", targetHtml.length);
  console.log("htmlBody first 500 chars:", JSON.stringify(targetHtml.slice(0, 500)));

  // --- STEP 2: resolveBodyText branch (source-inspection, confirmed by running) ---
  console.log("\n=== STEP 2: resolveBodyText() output ===");
  const primaryOnly = resolveBodyText(targetText || null, targetHtml || null);
  console.log("resolveBodyText output char count:", primaryOnly?.length ?? null);
  console.log("resolveBodyText output first 500 chars:", JSON.stringify(primaryOnly?.slice(0, 500) ?? null));

  // --- STEP 3: resolveBodyTextWithAlternate ---
  console.log("\n=== STEP 3: resolveBodyTextWithAlternate() output ===");
  const { primary, alternate } = resolveBodyTextWithAlternate(targetText || null, targetHtml || null);
  console.log("primary char count:", primary?.length ?? null);
  console.log("primary first 500 chars:", JSON.stringify(primary?.slice(0, 500) ?? null));
  console.log("alternate char count:", alternate?.length ?? null);
  console.log("alternate first 500 chars:", JSON.stringify(alternate?.slice(0, 500) ?? null));
  console.log("alternate is null (no retry candidate offered):", alternate === null);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
