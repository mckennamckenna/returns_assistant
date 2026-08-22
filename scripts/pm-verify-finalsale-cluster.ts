import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const linkedRows = await prisma.email.findMany({
    where: { needsReview: true, orderId: { not: null } },
    select: { id: true, retailer: true, orderNumber: true, confidence: true, emailType: true, returnDeadline: true, extractionNotes: true },
  });
  const tieredRe = /multiple return windows detected/i;
  const unclearRe = /Web lookup for return policy was unclear/i;
  const finalSaleRe = /final sale/i;
  const other = linkedRows.filter(r => {
    const notes = r.extractionNotes ?? "";
    if (r.confidence === "low") return false;
    if (r.emailType !== "other" && (!r.retailer || !r.orderNumber)) return false;
    if (tieredRe.test(notes)) return false;
    if (unclearRe.test(notes)) return false;
    if (r.emailType === "order_confirmation" && !r.returnDeadline) return false;
    return true;
  });
  const fs = other.filter(r => finalSaleRe.test(r.extractionNotes ?? ""));
  console.log(`${fs.length} rows\n`);
  for (const r of fs) {
    console.log(`id=${r.id} retailer=${r.retailer}`);
    console.log(`  ${r.extractionNotes}\n`);
  }
}
main().finally(() => prisma.$disconnect());
