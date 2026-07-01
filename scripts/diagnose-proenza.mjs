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
  // 1. Find all Proenza orders
  const orders = await prisma.order.findMany({
    where: { retailer: { contains: "proenza", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
  });

  console.log(`\n=== Proenza Orders (${orders.length}) ===`);
  for (const o of orders) {
    console.log(`  id: ${o.id}`);
    console.log(`  retailer: ${o.retailer}`);
    console.log(`  orderNumber: ${o.orderNumber}`);
    console.log(`  createdAt: ${o.createdAt.toISOString()}`);
    console.log(`  status: ${o.status}`);
    console.log(`  returnDeadline: ${o.returnDeadline}`);

    // 2. Linked emails
    const emails = await prisma.email.findMany({
      where: { orderId: o.id },
      orderBy: { receivedAt: "asc" },
    });

    console.log(`  Linked emails (${emails.length}):`);
    for (const e of emails) {
      const raw = e.extractionRaw;
      console.log(`    - emailId: ${e.id}`);
      console.log(`      subject: ${e.subject}`);
      console.log(`      emailType: ${e.emailType}`);
      console.log(`      email.orderNumber (col): ${e.orderNumber}`);
      console.log(`      extractionRaw.orderNumber: ${raw?.orderNumber ?? "(absent)"}`);
      console.log(`      orderId: ${e.orderId}`);
      console.log(`      receivedAt: ${e.receivedAt.toISOString()}`);
    }
    console.log();
  }

  // 3. Orphaned Proenza-ish emails not linked to any of the above orders
  const linkedOrderIds = orders.map(o => o.id);
  const orphaned = await prisma.email.findMany({
    where: {
      orderId: linkedOrderIds.length
        ? { notIn: linkedOrderIds }
        : undefined,
      OR: [
        { subject: { contains: "proenza", mode: "insensitive" } },
        { orderNumber: { contains: "86864" } },
      ],
    },
  });
  if (orphaned.length) {
    console.log(`=== Orphaned Proenza-ish emails (${orphaned.length}) ===`);
    for (const e of orphaned) {
      console.log(`  emailId: ${e.id}  subject: ${e.subject}  emailType: ${e.emailType}  orderNumber: ${e.orderNumber}  orderId: ${e.orderId}`);
    }
    console.log();
  }

  // 4. Decrypt and search for "86864" in all Proenza-related emails
  const allEmails = await prisma.email.findMany({
    where: {
      OR: [
        { orderId: { in: linkedOrderIds } },
        { subject: { contains: "proenza", mode: "insensitive" } },
        { orderNumber: { contains: "86864" } },
      ],
    },
    select: { id: true, subject: true, emailType: true, orderNumber: true, orderId: true, textBody: true, htmlBody: true, extractionRaw: true },
  });

  console.log(`=== Body search for "86864" across ${allEmails.length} Proenza-related email(s) ===`);
  for (const e of allEmails) {
    const tb = decrypt(e.textBody) ?? "";
    const hb = decrypt(e.htmlBody) ?? "";
    const inText = tb.includes("86864");
    const inHtml = hb.includes("86864");
    console.log(`  emailId: ${e.id}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  emailType: ${e.emailType}`);
    console.log(`  email.orderNumber (col): ${e.orderNumber}`);
    console.log(`  extractionRaw.orderNumber: ${e.extractionRaw?.orderNumber ?? "null"}`);
    console.log(`  orderId: ${e.orderId}`);
    console.log(`  "86864" in textBody: ${inText} (textBody chars: ${tb.length})`);
    console.log(`  "86864" in htmlBody: ${inHtml} (htmlBody chars: ${hb.length})`);
    for (const [label, body] of [["textBody", tb], ["htmlBody", hb]]) {
      const idx = body.indexOf("86864");
      if (idx !== -1) {
        const ctx = body.slice(Math.max(0, idx - 120), idx + 250);
        console.log(`  --- context in ${label} ---`);
        console.log(`  ...${ctx.replace(/\n+/g, " ")}...`);
      }
    }
    console.log();
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
