import { PrismaClient } from "@prisma/client";
import { createDecipheriv } from "crypto";

const prisma = new PrismaClient();

function decrypt(text) {
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length !== 3) return text;
  const [ivHex, authTagHex, cipherHex] = parts;
  const key = Buffer.from(process.env.ENCRYPTION_KEY, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const cipher = createDecipheriv("aes-256-gcm", key, iv);
  cipher.setAuthTag(authTag);
  const dec = Buffer.concat([cipher.update(Buffer.from(cipherHex, "hex")), cipher.final()]);
  return dec.toString("utf8");
}

async function main() {
  console.log("=== All 'refund' emailType rows ===");
  const refundEmails = await prisma.email.findMany({
    where: { emailType: "refund" },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true, subject: true, retailer: true, orderNumber: true, orderId: true,
      orderTotal: true, lineItems: true, receivedAt: true, textBody: true, htmlBody: true,
      needsReview: true, userId: true,
    },
  });

  for (const e of refundEmails) {
    console.log(`\n  emailId: ${e.id}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  retailer: ${e.retailer}`);
    console.log(`  orderNumber: ${e.orderNumber}`);
    console.log(`  orderId: ${e.orderId}`);
    console.log(`  orderTotal: ${e.orderTotal}`);
    console.log(`  lineItems: ${JSON.stringify(e.lineItems)}`);
    console.log(`  needsReview: ${e.needsReview}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);

    if (e.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: e.orderId },
        select: { retailer: true, orderNumber: true, displayStatus: true, returnedAt: true, archivedAt: true },
      });
      console.log(`  linked order: retailer=${order?.retailer}, orderNumber=${order?.orderNumber}, displayStatus=${order?.displayStatus}, returnedAt=${order?.returnedAt}, archivedAt=${order?.archivedAt}`);

      const siblingEmails = await prisma.email.findMany({
        where: { orderId: e.orderId },
        select: { emailType: true, receivedAt: true },
        orderBy: { receivedAt: "asc" },
      });
      console.log(`  sibling email types on this order: ${siblingEmails.map(s => s.emailType).join(", ")}`);
    } else {
      console.log("  ORPHANED — not linked to any order");
      // find candidate orders by retailer, same user
      const candidates = await prisma.order.findMany({
        where: { userId: e.userId, retailer: { equals: e.retailer ?? undefined, mode: "insensitive" } },
        select: { id: true, orderNumber: true, orderTotal: true, lineItems: true, displayStatus: true, createdAt: true },
      });
      console.log(`  candidate orders for retailer "${e.retailer}":`);
      for (const c of candidates) {
        console.log(`    - ${c.id} #${c.orderNumber} total=${c.orderTotal} status=${c.displayStatus} createdAt=${c.createdAt.toISOString()} lineItems=${JSON.stringify(c.lineItems)}`);
      }
    }

    const tb = decrypt(e.textBody);
    console.log(`  --- textBody preview (first 500 chars) ---`);
    console.log(`  ${(tb ?? "(none)").slice(0, 500).replace(/\n+/g, " ")}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
