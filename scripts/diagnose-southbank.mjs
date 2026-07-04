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
  const emails = await prisma.email.findMany({
    where: {
      OR: [
        { subject: { contains: "southbank", mode: "insensitive" } },
        { retailer: { contains: "southbank", mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      subject: true,
      retailer: true,
      emailType: true,
      orderId: true,
      textBody: true,
      htmlBody: true,
      receivedAt: true,
    },
  });

  console.log(`Found ${emails.length} Southbank-related email(s)`);
  for (const e of emails) {
    console.log(`\n  emailId: ${e.id}`);
    console.log(`  subject: ${e.subject}`);
    console.log(`  retailer: ${e.retailer}`);
    console.log(`  emailType: ${e.emailType}`);
    console.log(`  orderId: ${e.orderId}`);
    console.log(`  receivedAt: ${e.receivedAt.toISOString()}`);
    const tb = decrypt(e.textBody);
    const hb = decrypt(e.htmlBody);
    console.log(`  textBody chars: ${tb?.length ?? 0}, htmlBody chars: ${hb?.length ?? 0}`);
    console.log(`  --- textBody preview ---`);
    console.log(`  ${(tb ?? "(none)").slice(0, 400).replace(/\n+/g, " ")}`);
  }
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
