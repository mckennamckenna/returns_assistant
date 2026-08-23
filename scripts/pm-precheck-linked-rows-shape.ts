// READ-ONLY. Zero billed calls. Refines the cost estimate for the
// no-write orderNumber pre-check on the 4 already-linked cousin rows
// (owner-approved, ~4 billed calls estimated) by checking, locally and
// for free, whether each row's alternate body actually clears the
// substantiality bar the two-pass retry gates on — same check
// resolveBodyTextWithAlternate does, just surfaced here before spending
// anything.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "@/lib/crypto";
import { resolveBodyTextWithAlternate } from "@/lib/emailBodyText";

const prisma = new PrismaClient();

const TARGET_IDS = [
  "cmr1pp9tj0001jp04wgicru7d", // H&M refund
  "cmsdp8slh0001l90426f5df6x", // Chan Luu refund
  "cmshq51zz0001l804w8wr2w8l", // H&M refund
  "cmsj2nbsq0001l704wab4rll6", // H&M refund
];

async function main() {
  for (const id of TARGET_IDS) {
    const e = await prisma.email.findUnique({ where: { id } });
    if (!e) {
      console.log(id, "NOT FOUND");
      continue;
    }
    const textBody = e.textBody ? decrypt(e.textBody) : null;
    const htmlBody = e.htmlBody ? decrypt(e.htmlBody) : null;
    const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);
    console.log({
      id,
      retailer: e.retailer,
      emailType: e.emailType,
      returnWindowDaysAlreadyStored: e.returnWindowDays,
      retryWouldFire: alternate != null,
      primaryLength: primary?.length ?? 0,
      alternateLength: alternate?.length ?? 0,
    });
  }
  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());
