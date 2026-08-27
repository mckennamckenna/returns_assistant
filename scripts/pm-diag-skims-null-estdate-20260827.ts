import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";
import { resolveBodyText } from "../lib/emailBodyText";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findUnique({
    where: { id: "cmsz67s5m0003l904dnwsw1jl" },
  });
  console.log("=== Order ===");
  console.log(order);

  console.log("\n=== Linked Emails ===");
  const emails = await prisma.email.findMany({
    where: { orderId: order?.id },
    orderBy: { receivedAt: "asc" },
  });
  for (const e of emails) {
    const dec = decryptEmailContent(e as any);
    console.log({
      id: e.id,
      emailType: e.emailType,
      subject: dec.subject,
      receivedAt: e.receivedAt,
      extractedAt: e.extractedAt,
      deliveryDate: e.deliveryDate,
      forwardType: e.forwardType,
      anchorDate: e.anchorDate,
      needsReview: e.needsReview,
    });
  }

  const deliveryEmail = emails.find((e) => e.emailType === "delivery");
  if (deliveryEmail) {
    const dec = decryptEmailContent(deliveryEmail as any);
    const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
    console.log("\n=== Delivery email body preview (first 1500 chars) ===");
    console.log(bodyText?.slice(0, 1500));
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
