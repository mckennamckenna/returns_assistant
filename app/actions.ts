"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function deleteOrder(orderId: string): Promise<void> {
  // Reminder rows reference Order with no cascade — delete dependents first
  // or the Order delete fails on the foreign key constraint.
  await prisma.reminder.deleteMany({ where: { orderId } });
  await prisma.email.deleteMany({ where: { orderId } });
  await prisma.order.delete({ where: { id: orderId } });

  revalidatePath("/");
}

export async function deleteEmail(emailId: string): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { orderId: true } });
  if (!email) return;

  await prisma.email.delete({ where: { id: emailId } });

  if (email.orderId) {
    const remaining = await prisma.email.count({ where: { orderId: email.orderId } });
    if (remaining === 0) {
      await prisma.reminder.deleteMany({ where: { orderId: email.orderId } });
      await prisma.order.delete({ where: { id: email.orderId } });
    }
    revalidatePath(`/orders/${email.orderId}`);
  }

  revalidatePath("/");
}
