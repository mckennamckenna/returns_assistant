import { PrismaClient } from "@prisma/client";
import { decryptEmailContent, decryptRawJson } from "../lib/emailEncryption";
import { resolveBodyText } from "../lib/emailBodyText";
import { classifyForwardType, resolveAnchorDate, type RawHeader } from "../lib/forwardResolver";

const prisma = new PrismaClient();

function getHeaders(rawJsonDecrypted: string): RawHeader[] | null {
  try {
    return (decryptRawJson(rawJsonDecrypted) as any)?.Headers ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const flagged = [
    { retailer: "MANGO", orderNumber: "F4VLSF" },
    { retailer: "Ruti", orderNumber: "424051" },
    { retailer: "Bettervits USA", orderNumber: "444466" },
    { retailer: "H&M", orderNumber: "66993117803" },
    { retailer: "Sidekick", orderNumber: "SK213978" },
    { retailer: "Tuckernuck", orderNumber: "TNK6875105" },
  ];

  for (const f of flagged) {
    const order = await prisma.order.findFirst({ where: { orderNumber: f.orderNumber } });
    if (!order) continue;
    const confirmationOrEarliest = await prisma.email.findMany({
      where: { orderId: order.id },
      orderBy: { receivedAt: "asc" },
    });
    console.log(`\n=== ${f.retailer} #${f.orderNumber} — re-deriving anchor for each email (read-only, not persisted) ===`);
    for (const e of confirmationOrEarliest) {
      const dec = decryptEmailContent(e as any);
      const headers = getHeaders(e.rawJson);
      const forwardType = classifyForwardType(headers);
      const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
      const resolved = resolveAnchorDate({ forwardType, headers, bodyText, receivedAt: e.receivedAt });
      console.log({
        emailType: e.emailType,
        subject: dec.subject,
        rederivedForwardType: forwardType,
        rederivedAnchorDate: resolved.anchorDate,
        rederivedAnchorSource: resolved.anchorSource,
      });
    }
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
