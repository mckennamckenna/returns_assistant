// READ-ONLY. Zero billed calls. Checks whether a specific H&M email
// (owner-referenced: 7/22/2026, 9:12:43 AM) was part of the cousin
// census from the 2026-08-23/24 H&M sweep work.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Search a window around the given local time, since receivedAt is
  // stored in UTC and the owner's timestamp is presumably local.
  const candidates = await prisma.email.findMany({
    where: {
      retailer: "H&M",
      receivedAt: {
        gte: new Date("2026-07-22T00:00:00Z"),
        lt: new Date("2026-07-23T00:00:00Z"),
      },
    },
    select: {
      id: true,
      emailType: true,
      subject: true,
      receivedAt: true,
      orderNumber: true,
      orderId: true,
      textBody: true,
      htmlBody: true,
    },
  });

  console.log(`Found ${candidates.length} H&M email(s) received 2026-07-22 (UTC day window):`);
  for (const c of candidates) {
    console.log({
      id: c.id,
      emailType: c.emailType,
      subject: c.subject,
      receivedAt: c.receivedAt,
      receivedAtLocal: c.receivedAt.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }),
      orderNumber: c.orderNumber,
      orderId: c.orderId,
      hasTextBody: c.textBody !== null,
      hasHtmlBody: c.htmlBody !== null,
      textBodyRawLength: c.textBody?.length ?? 0,
    });
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());
