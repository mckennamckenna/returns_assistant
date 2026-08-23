// READ-ONLY. Zero billed calls. Diagnostic for cmt0uxvz70001ic0468kxgkjp
// (Laundry Sauce) not recovering orderNumber despite the retry firing —
// TASKS.md follow-up sweep to the 2026-08-23 H&M fix.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { resolveBodyTextWithAlternate } from "@/lib/emailBodyText";

const prisma = new PrismaClient();
const ID = "cmt0uxvz70001ic0468kxgkjp";

async function main() {
  const e = await prisma.email.findUnique({ where: { id: ID } });
  if (!e) return console.log("not found");

  console.log({
    id: e.id,
    retailer: e.retailer,
    emailType: e.emailType,
    subject: e.subject,
    orderNumber: e.orderNumber,
    orderId: e.orderId,
    needsReview: e.needsReview,
    extractionNotes: e.extractionNotes,
  });

  const textBody = e.textBody ? decrypt(e.textBody) : null;
  const htmlBody = e.htmlBody ? decrypt(e.htmlBody) : null;
  const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);

  console.log("\nprimary length:", primary?.length ?? 0);
  console.log("alternate length:", alternate?.length ?? 0);
  console.log("\n=== primary body (first 800 chars) ===");
  console.log(primary?.slice(0, 800));
  console.log("\n=== alternate body (first 800 chars) ===");
  console.log(alternate?.slice(0, 800));

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());
