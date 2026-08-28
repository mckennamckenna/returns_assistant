"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth, signOut } from "@/auth";
import { linkEmailToExistingOrder, createOrderFromOrphanedEmail, archiveOrphanedEmail, approveOrder } from "@/lib/orderReview";
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

// Phase 3 carrier-row-disposition (docs/design/carrier_row_disposition_20260828.md)
// — mirror-image of linkEmailToOrderAction above: same ownership check, same
// revalidatePath, single-field write in the opposite direction. Required in
// the same phase as the new link picker wiring for carrier rows, not
// deferred — a misclick in the picker has no other recovery path (owner,
// 2026-08-28). needsReview: true mirrors linkEmailToExistingOrder setting it
// false on link; the email re-enters the needs-review bucket and is
// reclassified as carrier_tracking_unlinked by detectEmailReviewReason.
export async function unlinkEmailFromOrderAction(emailId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { userId: true, orderId: true } });
  if (!email || email.userId !== session.user.id) return;

  await prisma.email.update({ where: { id: emailId }, data: { orderId: null, needsReview: true } });
  if (email.orderId) {
    revalidatePath(`/orders/${email.orderId}`);
  }
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

// CARD_SPEC.md Part 3 — the order detail page's resolution control for a
// needsReview order (2026-08-21). Order-kind bucket rows always degrade to
// View detail (lib/needsReviewActions.ts — Link-to-order has no
// order-to-order merge capability, see TASKS.md 🟡 Next). This page IS that
// View-detail destination, so mirroring the bucket's action verbatim would
// be a self-link/no-op. The one action that's genuinely always valid here
// regardless of the order's specific detected reason is the existing human
// override already built in lib/orderReview.ts: confirm the order is fine
// as-is and clear the flag.
export async function approveOrderAction(orderId: string): Promise<void> {
  const session = await auth();
  if (!session?.user) return;

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
  if (!order || order.userId !== session.user.id) return;

  await approveOrder(orderId, null);
  revalidatePath("/");
  revalidatePath(`/orders/${orderId}`);
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
