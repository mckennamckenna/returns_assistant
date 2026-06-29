// One-time backfill after fixing lib/runExtraction.ts to fall back to a
// plain-text conversion of htmlBody when textBody is empty/whitespace-only
// (iPhone/Apple Mail forwards are HTML-only and previously reached
// extraction with nothing to read). Finds every email that was stuck in
// that state and re-extracts it.
//
// Usage: node --env-file=.env ./node_modules/.bin/tsx scripts/backfill-html-fallback-extraction.ts

import { PrismaClient } from "@prisma/client";
import { runExtraction } from "../lib/runExtraction";
import { decrypt } from "../lib/crypto";

const prisma = new PrismaClient();

async function main() {
  const emails = await prisma.email.findMany({
    select: {
      id: true,
      subject: true,
      textBody: true,
      htmlBody: true,
      retailer: true,
      orderNumber: true,
      confidence: true,
      needsReview: true,
    },
  });

  const affected = emails.filter((email) => {
    const text = email.textBody ? decrypt(email.textBody).trim() : "";
    const html = email.htmlBody ? decrypt(email.htmlBody).trim() : "";
    return text.length === 0 && html.length > 0;
  });

  console.log(`Found ${affected.length} email(s) with empty/whitespace textBody and non-empty htmlBody.`);

  for (const before of affected) {
    await runExtraction(before.id);

    const after = await prisma.email.findUnique({
      where: { id: before.id },
      select: { retailer: true, orderNumber: true, confidence: true, needsReview: true },
    });

    console.log(`\n${before.id} (${before.subject ?? "no subject"})`);
    console.log(
      `  before: retailer=${before.retailer ?? "—"} orderNumber=${before.orderNumber ?? "—"} confidence=${
        before.confidence ?? "—"
      } needsReview=${before.needsReview}`,
    );
    console.log(
      `  after:  retailer=${after?.retailer ?? "—"} orderNumber=${after?.orderNumber ?? "—"} confidence=${
        after?.confidence ?? "—"
      } needsReview=${after?.needsReview}`,
    );
  }

  console.log(`\nDone. Re-extracted ${affected.length} email(s).`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
