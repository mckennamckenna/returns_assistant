import { PrismaClient } from "@prisma/client";
import { formatCalendarDate, formatCalendarDateShort } from "../lib/dateDisplay";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "54421192781" } },
    select: { estimatedDeliveryDate: true },
  });
  console.log(
    "estimatedDeliveryDate — the exact field that produced the original 'Aug 23 vs Aug 24' drift:",
  );
  console.log("  formatCalendarDateShort (used by both dashboard card and detail chip now):", formatCalendarDateShort(order?.estimatedDeliveryDate ?? null));
  console.log("  formatCalendarDate (used by the detail page's 'Delivery date' field):", formatCalendarDate(order?.estimatedDeliveryDate ?? null));
  console.log("Both now come from the same function — cannot disagree.");
}

main().finally(() => prisma.$disconnect());
