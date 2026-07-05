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
  const orders = await prisma.order.findMany({
    where: { retailer: { contains: "amazon", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`=== Amazon Orders (${orders.length}) ===`);
  for (const o of orders) {
    console.log(`\n  orderId: ${o.id}`);
    console.log(`  orderNumber: ${o.orderNumber}`);
    console.log(`  orderDate: ${o.orderDate}`);
    console.log(`  deliveryDate: ${o.deliveryDate}`);
    console.log(`  returnDeadline: ${o.returnDeadline}  deadlineIsEstimated: ${o.deadlineIsEstimated}`);

    const emails = await prisma.email.findMany({
      where: { orderId: o.id },
      orderBy: { receivedAt: "asc" },
      select: { id: true, subject: true, emailType: true, orderDate: true, textBody: true, htmlBody: true, receivedAt: true },
    });
    console.log(`  Linked emails (${emails.length}):`);
    for (const e of emails) {
      const tb = decrypt(e.textBody);
      const hb = decrypt(e.htmlBody);
      const hasTextDateLine = /^(?:>\s*)*Date:\s*(.+)$/m.test(tb ?? "");
      const hasHtmlDateLine = /^(?:>\s*)*Date:\s*(.+)$/m.test(hb ?? "");
      console.log(`    - emailId: ${e.id}`);
      console.log(`      subject: ${e.subject}`);
      console.log(`      emailType: ${e.emailType}`);
      console.log(`      email.orderDate (extracted): ${e.orderDate}`);
      console.log(`      receivedAt: ${e.receivedAt.toISOString()}`);
      console.log(`      forwarded-header Date: line present in textBody: ${hasTextDateLine}, htmlBody: ${hasHtmlDateLine}`);
    }
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
