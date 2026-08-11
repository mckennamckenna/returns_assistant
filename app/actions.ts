"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signOut } from "@/auth";
import { linkEmailToExistingOrder, createOrderFromOrphanedEmail, archiveOrphanedEmail } from "@/lib/orderReview";
import { rescueEmail } from "@/lib/junk";
import { DISPLAY_STATUS_RANK, buildStatusTransitionData } from "@/lib/displayStatus";

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

// CARD_SPEC.md Part 3 needs-review bucket actions. Each checks ownership of
// the email itself; linkToOrder additionally relies on
// linkEmailToExistingOrder's own userId match between email and target
// order (lib/orderReview.ts) before merging.
export async function linkEmailToOrderAction(emailId: string, targetOrderId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true } });
  if (!email || email.userId !== session.user.id) return;

  await linkEmailToExistingOrder(emailId, targetOrderId);
  revalidatePath("/");
}

export async function createOrderFromEmailAction(emailId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true } });
  if (!email || email.userId !== session.user.id) return;

  await createOrderFromOrphanedEmail(emailId);
  revalidatePath("/");
}

export async function archiveOrphanedEmailAction(emailId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true } });
  if (!email || email.userId !== session.user.id) return;

  await archiveOrphanedEmail(emailId);
  revalidatePath("/");
}

export async function rescueEmailAction(emailId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true } });
  if (!email || email.userId !== session.user.id) return;

  await rescueEmail(emailId);
  revalidatePath("/");
}

async function advanceDisplayStatus(orderId: string, nextStatus: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { userId: true, displayStatus: true, returnedAt: true, archivedAt: true, keptAt: true },
  });
  if (!order || order.userId !== session.user.id) return;

  const currentRank = DISPLAY_STATUS_RANK[order.displayStatus] ?? 0;
  const nextRank = DISPLAY_STATUS_RANK[nextStatus] ?? 0;
  if (nextRank <= currentRank) return;

  const data = buildStatusTransitionData(nextStatus, order);

  await prisma.order.update({ where: { id: orderId }, data });
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
}

export async function markReturnRequestedAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "return_requested");
}

export async function markReturnedAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "returned");
}

export async function markRefundedAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "refunded");
}

export async function markKeptAction(orderId: string): Promise<void> {
  await advanceDisplayStatus(orderId, "kept");
}
