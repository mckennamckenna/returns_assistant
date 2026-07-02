"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signOut } from "@/auth";
import { approveOrder, splitOrder } from "@/lib/orderReview";
import { DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export async function deleteEmail(emailId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { orderId: true, userId: true } });
  if (!email || email.userId !== session.user.id) return;

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

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

async function getNote(formData: FormData): Promise<string | null> {
  const note = formData.get("note");
  return typeof note === "string" ? note : null;
}

export async function approveOrderAction(orderId: string, formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
  if (!order || order.userId !== session.user.id) return;

  await approveOrder(orderId, await getNote(formData));
  revalidatePath("/");
}

export async function splitOrderAction(orderId: string, formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
  if (!order || order.userId !== session.user.id) return;

  await splitOrder(orderId, await getNote(formData));
  revalidatePath("/");
}

async function advanceDisplayStatus(orderId: string, nextStatus: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, displayStatus: true },
  });
  if (!order || order.userId !== session.user.id) return;

  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  const nextRank = DISPLAY_STATUS_RANK[nextStatus] ?? 0;
  if (nextRank <= currentRank) return;

  await prisma.order.update({ where: { id: orderId }, data: { displayStatus: nextStatus } });
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
}

export async function markReturnRequestedAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "return_requested");
}

export async function markReturnedAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "returned");
}
