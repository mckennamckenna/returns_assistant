// One-off: creates a disposable test Order (owner account) for Phase 3
// curl verification of POST /api/action/archive. Not linked to any real
// email/purchase — safe to delete after verification.
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const owner = await prisma.user.findFirst({ where: { email: "mckenna.sweazey@gmail.com" } });
  if (!owner) throw new Error("owner not found");

  const order = await prisma.order.create({
    data: {
      userId: owner.id,
      retailer: "Phase 3 Test Retailer",
      orderNumber: "PHASE3-TEST-001",
      orderTotal: 42,
      orderCurrency: "USD",
      displayStatus: "shipped",
    },
  });

  console.log("orderId:", order.id);
  console.log("userId:", owner.id);
}

main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
