import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
async function main() {
  const emails = await prisma.email.findMany({
    where: { orderId: "cmts5rxus001yw9hv736f6gqj" },
    select: { id: true, emailType: true, extractionNotes: true, needsReview: true, confidence: true },
  });
  emails.forEach((e) => console.log(e));
  const order = await prisma.order.findUnique({
    where: { id: "cmts5rxus001yw9hv736f6gqj" },
    select: { needsReview: true, status: true, displayStatus: true },
  });
  console.log("order:", order);
}
main().finally(() => prisma.$disconnect());
