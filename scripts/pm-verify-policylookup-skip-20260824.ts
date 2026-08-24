// Live verification of the widened lookupReturnPolicy skip fix (TASKS.md
// 2026-08-24), post-deploy. Runs runExtraction() -- the exact same
// production code path the manual re-extract action and inbound webhook
// use -- on ONE targeted email that links to an existing order whose
// returnWindowDays is already resolved. Captures stdout to check whether
// a "policy_lookup" AnthropicCallSite event fires (it shouldn't, post-fix).
// WRITES to this one Email/Order row (a real re-extraction, not a
// simulation) -- cost disclosed upfront: ~1 billed Sonnet call expected
// (primary extraction only; the policy lookup this call previously made,
// ~2 total pre-fix, should no longer fire). Small chance of +1 if the
// narrow orderNumber-retry gate fires unexpectedly.
// Usage: npx tsx scripts/pm-verify-policylookup-skip-20260824.ts <emailId>
import { PrismaClient } from "@prisma/client";
import { runExtraction } from "../lib/runExtraction";

const prisma = new PrismaClient();

async function main() {
  const emailId = process.argv[2];
  if (!emailId) {
    console.error("Usage: npx tsx scripts/pm-verify-policylookup-skip-20260824.ts <emailId>");
    process.exitCode = 1;
    return;
  }

  const before = await prisma.email.findUnique({
    where: { id: emailId },
    select: { id: true, retailer: true, orderNumber: true, orderId: true, policySource: true, emailType: true },
  });
  if (!before) {
    console.error("No email found for id", emailId);
    process.exitCode = 1;
    return;
  }
  const orderBefore = before.orderId
    ? await prisma.order.findUnique({ where: { id: before.orderId }, select: { returnWindowDays: true, policySource: true } })
    : null;

  console.log("BEFORE:", JSON.stringify({ email: before, order: orderBefore }, null, 2));
  console.log("\n--- running runExtraction (real re-extraction, real write) ---\n");

  await runExtraction(emailId);

  const after = await prisma.email.findUnique({
    where: { id: emailId },
    select: { id: true, retailer: true, orderNumber: true, orderId: true, policySource: true, emailType: true, needsReview: true },
  });
  const orderAfter = after?.orderId
    ? await prisma.order.findUnique({ where: { id: after.orderId }, select: { returnWindowDays: true, policySource: true } })
    : null;

  console.log("\nAFTER:", JSON.stringify({ email: after, order: orderAfter }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
