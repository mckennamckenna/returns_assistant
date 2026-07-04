import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { isCommerceEmail } from "../lib/classify";

const prisma = new PrismaClient();

async function main() {
  const email = await prisma.email.findFirst({
    where: { subject: { contains: "southbank", mode: "insensitive" } },
    select: { id: true, subject: true, textBody: true, htmlBody: true },
  });

  if (!email) {
    console.log("No Southbank email found.");
    return;
  }

  const textBody = email.textBody ? decrypt(email.textBody) : undefined;
  const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : undefined;

  const result = await isCommerceEmail(textBody, htmlBody);
  console.log(`emailId: ${email.id}`);
  console.log(`subject: ${email.subject}`);
  console.log(`isCommerceEmail (with fix) => ${result ? "COMMERCE (still passes gate — fix did NOT work)" : "NOT_COMMERCE (correctly excluded)"}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
