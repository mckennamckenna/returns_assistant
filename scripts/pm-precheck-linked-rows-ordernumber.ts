// NO WRITES. Owner-approved pre-check (not a sweep) for the 4 cousin
// rows that are already linked to a parent order via some other signal
// (not Email.orderNumber matching) — TASKS.md follow-up to the
// 2026-08-23 H&M return_label fix. Runs extractEmail() directly (the
// same function runExtraction() calls) but never calls prisma.email.update
// or linkEmailToOrder — purely reports what orderNumber the fix would
// recover, compared against the orderNumber already on the order each
// row is currently linked to. Owner reviews per row before authorizing
// any write.
//
// BILLED CALLS — run as-is, owner-approved despite the higher-than-
// estimated cost: up to 3 per row (primary extraction, retry, and very
// likely a policy web-search lookup, since these are "refund" emails
// that rarely restate policy terms in-body and the model has no memory
// of the return window already stored on the row from a prior run).
// ~12 total across 4 rows. The policy-lookup result is discarded (no
// write happens) — known, accepted waste, same shape already logged in
// TASKS.md 🐛 Bugs → Infra/reliability.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { resolveBodyTextWithAlternate } from "@/lib/emailBodyText";
import { extractEmail } from "@/lib/extract";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmr1pp9tj0001jp04wgicru7d", // H&M refund
  "cmsdp8slh0001l90426f5df6x", // Chan Luu refund
  "cmshq51zz0001l804w8wr2w8l", // H&M refund
  "cmsj2nbsq0001l704wab4rll6", // H&M refund
];

async function main() {
  for (const id of TARGET_IDS) {
    const e = await prisma.email.findUnique({ where: { id } });
    if (!e) {
      console.log(id, "NOT FOUND");
      continue;
    }

    const currentOrder = e.orderId ? await prisma.order.findUnique({ where: { id: e.orderId } }) : null;

    const textBody = e.textBody ? decrypt(e.textBody) : null;
    const htmlBody = e.htmlBody ? decrypt(e.htmlBody) : null;
    const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);

    if (!primary) {
      console.log(id, "— no primary body, skipping");
      continue;
    }

    const result = await extractEmail(primary, e.subject ?? null, id, alternate);

    const recovered = result.orderNumber;
    const currentOrderNumber = currentOrder?.orderNumber ?? null;
    console.log({
      id,
      retailer: e.retailer,
      emailType: e.emailType,
      recoveredOrderNumber: recovered,
      currentlyLinkedOrderId: e.orderId,
      currentlyLinkedOrderNumber: currentOrderNumber,
      match: recovered != null && currentOrderNumber != null ? recovered === currentOrderNumber : "n/a — one side null",
    });
  }
}

main().finally(() => prisma.$disconnect());
