"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db";
import { auth, signOut } from "@/auth";
import { linkEmailToExistingOrder, createOrderFromOrphanedEmail, archiveOrphanedEmail, approveOrder } from "@/lib/orderReview";
import { rescueEmail } from "@/lib/junk";
import { decideManualStatusChange } from "@/lib/displayStatus";
import { logActionWithRetry } from "@/lib/actionLog";

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
// reclassified as shipment_unlinked (renamed 2026-08-30, formerly
// carrier_tracking_unlinked) by detectEmailReviewReason.
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

// Logs every call to ActionLog (action "status_action:<from>-><to>") — see
// the model comment in prisma/schema.prisma for the full convention and
// outcome taxonomy. Added 2026-09-04: this was previously a silent no-op on
// every non-success branch, which is exactly what made a manual "Mark as
// refunded" on an order with no confirmed refund amount unrecoverable to
// investigate after the fact.
async function advanceDisplayStatus(orderId: string, nextStatus: string): Promise<void> {
  const hdrs = await headers();
  const ipAddress = hdrs.get("x-vercel-forwarded-for");
  const userAgent = hdrs.get("user-agent");

  const session = await auth();
  if (!session?.user) {
    await logActionWithRetry({
      userId: null,
      orderId,
      action: `status_action:unknown->${nextStatus}`,
      outcome: "unauthenticated",
      ipAddress,
      userAgent,
    });
    return;
  }
  const userId = session.user.id;

  let succeeded = false;
  try {
    succeeded = await prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { userId: true, displayStatus: true, returnedAt: true, archivedAt: true, keptAt: true },
      });

      const decision = decideManualStatusChange(order, userId, nextStatus);
      const action = `status_action:${decision.fromStatus}->${nextStatus}`;

      if (decision.outcome === "success" && decision.data) {
        await tx.order.update({ where: { id: orderId }, data: decision.data });
      }

      await tx.actionLog.create({
        data: { userId, orderId, action, outcome: decision.outcome, ipAddress, userAgent },
      });

      return decision.outcome === "success";
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await logActionWithRetry({
      userId,
      orderId,
      action: `status_action:unknown->${nextStatus}:error:${message.slice(0, 200)}`,
      outcome: "exception",
      ipAddress,
      userAgent,
    });
    throw error;
  }

  if (!succeeded) return;

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
