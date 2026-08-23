import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();
const IDS = [
  "cmr1pp9tj0001jp04wgicru7d",
  "cmsdp8slh0001l90426f5df6x",
  "cmshq51zz0001l804w8wr2w8l",
  "cmsj2nbsq0001l704wab4rll6",
  "cmt0uxvz70001ic0468kxgkjp",
];
async function main() {
  for (const id of IDS) {
    const e = await prisma.email.findUnique({ where: { id }, select: { id: true, orderNumber: true, orderId: true } });
    console.log(e);
  }
}
main().finally(() => prisma.$disconnect());
