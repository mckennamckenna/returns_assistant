import { PrismaClient } from "@prisma/client";
import { formatCalendarDate, formatCalendarDateShort } from "../lib/dateDisplay";
import { computeOrderCardState, orderCardChip } from "../lib/orderCardState";

const prisma = new PrismaClient();

async function main() {
  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "54421192781" } },
  });
  if (!order) throw new Error("not found");

  console.log("Raw deliveredAt:", order.deliveredAt);
  console.log("Raw estimatedDeliveryDate:", order.estimatedDeliveryDate);
  console.log("Raw orderDate:", order.orderDate);
  console.log("Raw returnDeadline:", order.returnDeadline);

  const state = computeOrderCardState(order);
  console.log("\nComputed state:", state);

  const chip = orderCardChip({
    state,
    displayStatus: order.displayStatus,
    estimatedDeliveryDate: order.estimatedDeliveryDate,
    returnDeadline: order.returnDeadline,
    orderTotal: order.orderTotal,
    lineItems: order.lineItems,
    now: new Date(),
  });
  console.log("Dashboard-card-equivalent chip label:", chip.label);

  console.log("\nDetail-page-equivalent 'Delivery Date' field:");
  const best = order.deliveredAt ?? order.estimatedDeliveryDate ?? order.deliveryDate;
  console.log(formatCalendarDate(best));

  console.log("\nOrder date (detail page):", formatCalendarDate(order.orderDate));
  console.log("Return deadline (detail page):", formatCalendarDate(order.returnDeadline));
}

main().finally(() => prisma.$disconnect());
