// READ-ONLY. 0 billed Anthropic calls, 0 writes (findFirst/findUnique only).
// Follow-up triage on the owner's three 2026-08-22 PM-review findings:
// (1) Caroline's RealReal $7,921.75 — owner says it's the SUM of recommended
//     items in the email, not the purchased item. Check lineItems + body for
//     a "recommended"/"you may also like" section.
// (2) mckenna's H&M return_label orphan (id set via PM_DIAG_EMAIL_ID) that
//     surfaced in the real 2026-08-21 Friday digest — owner thinks it's a
//     linking issue. Check its own orderNumber and compare against mckenna's
//     existing H&M orders.
// (3) mckenna's unknown-retailer shipping_confirmation
//     (id set via PM_DIAG_EMAIL_ID_2) from the same digest — check whether
//     the retailer name is actually recoverable from the body.
// Ownership-scoped: Caroline's row checked against her own userId; mckenna's
// two rows checked against his own userId. User emails and row ids are read
// from PM_DIAG_USER_EMAIL / PM_DIAG_USER_EMAIL_2 / PM_DIAG_ORDER_ID /
// PM_DIAG_EMAIL_ID / PM_DIAG_EMAIL_ID_2 — see fail-fast checks below.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();

if (!process.env.PM_DIAG_USER_EMAIL) {
  console.error("Set PM_DIAG_USER_EMAIL before running (mckenna's account)");
  process.exit(1);
}
if (!process.env.PM_DIAG_USER_EMAIL_2) {
  console.error("Set PM_DIAG_USER_EMAIL_2 before running (Caroline's account)");
  process.exit(1);
}
if (!process.env.PM_DIAG_ORDER_ID) {
  console.error("Set PM_DIAG_ORDER_ID before running (Caroline's RealReal order)");
  process.exit(1);
}
if (!process.env.PM_DIAG_EMAIL_ID) {
  console.error("Set PM_DIAG_EMAIL_ID before running (mckenna's H&M return_label orphan)");
  process.exit(1);
}
if (!process.env.PM_DIAG_EMAIL_ID_2) {
  console.error("Set PM_DIAG_EMAIL_ID_2 before running (mckenna's unknown-retailer shipping_confirmation)");
  process.exit(1);
}
const USER_EMAIL: string = process.env.PM_DIAG_USER_EMAIL;
const CAROLINE_EMAIL: string = process.env.PM_DIAG_USER_EMAIL_2;
const CAROLINE_ORDER_ID: string = process.env.PM_DIAG_ORDER_ID;
const HM_EMAIL_ID: string = process.env.PM_DIAG_EMAIL_ID;
const UNKNOWN_RETAILER_EMAIL_ID: string = process.env.PM_DIAG_EMAIL_ID_2;

function snippet(body: string | null, label: string) {
  if (!body) return `(no ${label})`;
  const plain = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return plain.slice(0, 4000);
}

async function part1_caroline() {
  console.log("\n\n========== PART 1 — Caroline's RealReal $7,921.75 ==========");
  const owner = await prisma.user.findFirst({ where: { email: CAROLINE_EMAIL } });
  if (!owner) return console.log("Caroline not found.");

  const order = await prisma.order.findUnique({
    where: { id: CAROLINE_ORDER_ID },
    include: { emails: true },
  });
  if (!order || order.userId !== owner.id) return console.log("Order not found or ownership mismatch.");

  console.log("Order-level lineItems:", JSON.stringify(order.lineItems));
  console.log("Order-level orderTotal:", order.orderTotal);

  for (const e of order.emails) {
    console.log(`\n--- Email ${e.id} (${e.emailType}) "${e.subject}" ---`);
    console.log("Email-level lineItems:", JSON.stringify(e.lineItems));
    console.log("Email-level orderTotal:", e.orderTotal);
    console.log("extractionNotes:", e.extractionNotes ?? "(none)");
    const html = e.htmlBody ? decrypt(e.htmlBody) : null;
    const text = e.textBody ? decrypt(e.textBody) : null;
    const body = snippet(html, "htmlBody") !== "(no htmlBody)" ? snippet(html, "htmlBody") : snippet(text, "textBody");
    const hasRecommended = /recommend|you (might|may) also like|inspired by|picked for you|more (like|from)/i.test(body);
    console.log(`Body contains a "recommended items" style section: ${hasRecommended}`);
    console.log("Body snippet (first 4000 chars, tags stripped):\n" + body);
  }
}

async function part2_hm_link(ownerId: string) {
  console.log("\n\n========== PART 2 — mckenna's H&M return_label orphan (Fri 8/21 digest) ==========");
  const email = await prisma.email.findUnique({ where: { id: HM_EMAIL_ID } });
  if (!email || email.userId !== ownerId) return console.log("Email not found or ownership mismatch.");

  console.log({
    id: email.id,
    emailType: email.emailType,
    orderId: email.orderId,
    orderNumber: email.orderNumber,
    retailer: email.retailer,
    receivedAt: email.receivedAt,
    extractionNotes: email.extractionNotes,
    lineItems: email.lineItems,
  });
  const html = email.htmlBody ? decrypt(email.htmlBody) : null;
  const text = email.textBody ? decrypt(email.textBody) : null;
  const body = snippet(html, "htmlBody") !== "(no htmlBody)" ? snippet(html, "htmlBody") : snippet(text, "textBody");
  console.log("\nBody snippet (first 4000 chars, tags stripped):\n" + body);

  console.log("\n--- mckenna's existing H&M orders (candidates to relink to) ---");
  const hmOrders = await prisma.order.findMany({
    where: { userId: ownerId, retailer: { contains: "H&M", mode: "insensitive" } },
    select: { id: true, orderNumber: true, orderTotal: true, orderDate: true, status: true, displayStatus: true, returnedAt: true, keptAt: true },
  });
  console.log(hmOrders);
}

async function part3_unknown_retailer(ownerId: string) {
  console.log("\n\n========== PART 3 — mckenna's unknown-retailer shipping_confirmation (Fri 8/21 digest) ==========");
  const email = await prisma.email.findUnique({ where: { id: UNKNOWN_RETAILER_EMAIL_ID } });
  if (!email || email.userId !== ownerId) return console.log("Email not found or ownership mismatch.");

  const fromEmail = email.fromEmail ? decrypt(email.fromEmail) : null;
  const fromName = email.fromName ? decrypt(email.fromName) : null;
  console.log({
    id: email.id,
    emailType: email.emailType,
    orderId: email.orderId,
    orderNumber: email.orderNumber,
    retailer: email.retailer,
    subject: email.subject,
    fromEmail,
    fromName,
    extractionNotes: email.extractionNotes,
    confidence: email.confidence,
  });
  const html = email.htmlBody ? decrypt(email.htmlBody) : null;
  const text = email.textBody ? decrypt(email.textBody) : null;
  const body = snippet(html, "htmlBody") !== "(no htmlBody)" ? snippet(html, "htmlBody") : snippet(text, "textBody");
  console.log("\nBody snippet (first 4000 chars, tags stripped):\n" + body);
}

async function main() {
  await part1_caroline();

  const mckenna = await prisma.user.findFirst({ where: { email: USER_EMAIL } });
  if (!mckenna) return console.log("mckenna not found.");
  await part2_hm_link(mckenna.id);
  await part3_unknown_retailer(mckenna.id);

  console.log("\n\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
