import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { deriveDisplayStatusCore } from "@/lib/displayStatus";
import { recomputeOrderStatus } from "@/lib/linkOrder";
import { logActionWithRetry } from "@/lib/actionLog";

const ACTION = "unkeep";

// x-vercel-forwarded-for is set by Vercel's own edge network on every
// request that reaches this function, and — unlike x-forwarded-for —
// can't be altered by an intermediate rewrite or middleware step. Matches
// the same choice already made in the signed-token action routes.
function getClientIp(request: NextRequest): string | null {
  return request.headers.get("x-vercel-forwarded-for");
}

// Reverses a manual "kept" decision. Deliberately not routed through
// buildStatusTransitionData's rank-gate (lib/displayStatus.ts) or the
// generic PATCH /api/orders/:id/status endpoint — kept and returned share
// rank 5, so any auto-derived target is "<=" and gets rejected by both. The
// un-keep target also isn't a fixed rank the way a manual advance is: it's
// whatever the order's current email evidence actually supports, so this
// route re-derives it directly via deriveDisplayStatusCore rather than
// asking the shared gate to special-case a downgrade.
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const order = await prisma.order.findUnique({
    where: { id },
    select: { userId: true, displayStatus: true, deliveredAt: true },
  });

  if (!order || order.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (order.displayStatus !== "kept") {
    return NextResponse.json(
      { error: "Order is not currently marked Kept — nothing to reverse" },
      { status: 409 },
    );
  }

  const emails = await prisma.email.findMany({
    where: { orderId: id },
    select: { emailType: true, refundAmount: true, refundAmountConfidence: true },
  });
  const emailTypes = emails.map((e) => e.emailType).filter((t): t is string => t != null);
  const hasConfirmedRefundAmount = emails.some(
    (e) => e.emailType === "refund" && e.refundAmount != null && e.refundAmountConfidence !== "low",
  );

  // "ordered" is the lowest real rank — passing it as the floor means the
  // ladder below always wins over it, which is what a from-scratch
  // re-derivation (no prior manual decision to respect) needs.
  const nextDisplayStatus = deriveDisplayStatusCore(emailTypes, "ordered", hasConfirmedRefundAmount, order.deliveredAt);

  const updated = await prisma.order.update({
    where: { id },
    data: { displayStatus: nextDisplayStatus, keptAt: null, archivedAt: null },
    select: { displayStatus: true, archivedAt: true },
  });

  // Not wrapped in the same transaction as the update above:
  // recomputeOrderStatus (lib/linkOrder.ts) only takes an orderId and
  // always uses the module-level prisma client, not a passed-in tx handle.
  // Refactoring its signature to accept one is out of scope for this
  // session (TASKS.md) — accepted as a small window of non-atomicity: if
  // this second write fails, displayStatus/keptAt/archivedAt are already
  // correctly cleared, but the internal `status` field could be left
  // momentarily stale until the next email-triggered recompute.
  await recomputeOrderStatus(id);

  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");
  await logActionWithRetry({
    userId: session.user.id,
    orderId: id,
    action: ACTION,
    outcome: "success",
    ipAddress: ip,
    userAgent,
  });

  return NextResponse.json({ displayStatus: updated.displayStatus, archivedAt: updated.archivedAt });
}
