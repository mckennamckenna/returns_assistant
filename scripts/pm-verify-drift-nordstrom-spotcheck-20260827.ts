import { PrismaClient } from "@prisma/client";
import { formatCalendarDate } from "../lib/dateDisplay";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: "1055864196" },
  });
  if (!order) throw new Error("not found");
  console.log("Nordstrom 1055864196:");
  console.log("  orderDate raw:", order.orderDate, "-> formatted:", formatCalendarDate(order.orderDate));
  console.log("  estimatedDeliveryDate raw:", order.estimatedDeliveryDate, "-> formatted:", formatCalendarDate(order.estimatedDeliveryDate));
  console.log("  deliveredAt raw:", order.deliveredAt, "-> formatted:", formatCalendarDate(order.deliveredAt));
  console.log("  returnDeadline raw:", order.returnDeadline, "-> formatted:", formatCalendarDate(order.returnDeadline));
}

main().finally(() => prisma.$disconnect());
