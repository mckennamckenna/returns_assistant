// READ-ONLY. Zero billed calls. Follow-up detail query — the first
// pre-check pass surfaced two discrepancies from the task brief's
// assumptions (5 rows today not 6, mixed retailers/emailTypes not "4 H&M
// return_label rows", two return_label emails on order 68468087873 both
// already orderNumber-populated) that need resolving before a final list
// can be shown to the owner.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const CENSUS_IDS = [
  "cmr1pp9tj0001jp04wgicru7d",
  "cmsdp8slh0001l90426f5df6x",
  "cmshq51zz0001l804w8wr2w8l",
  "cmsj2nbsq0001l704wab4rll6",
  "cmt0uxvz70001ic0468kxgkjp",
];

const ORDER_68468087873_RETURN_LABELS = ["cmsdqyh5y0003ju04f3ws09o1", "cms7nayc70001i604oaxjjjd9"];

async function main() {
  console.log("=== Today's census rows, full detail ===");
  for (const id of CENSUS_IDS) {
    const e = await prisma.email.findUnique({
      where: { id },
      select: { id: true, retailer: true, emailType: true, receivedAt: true, orderNumber: true, needsReview: true, extractedAt: true },
    });
    console.log(e);
  }

  console.log("\n=== Order 68468087873's two return_label emails, full detail ===");
  for (const id of ORDER_68468087873_RETURN_LABELS) {
    const e = await prisma.email.findUnique({
      where: { id },
      select: {
        id: true,
        retailer: true,
        emailType: true,
        receivedAt: true,
        orderNumber: true,
        orderId: true,
        needsReview: true,
        extractedAt: true,
      },
    });
    console.log(e);
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0");
}

main().finally(() => prisma.$disconnect());
