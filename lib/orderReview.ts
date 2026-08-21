import { prisma } from "@/lib/db";
import {
  createOrderFromEmail,
  mergeEmailIntoOrder,
  rebuildOrderFromRemainingEmails,
  applyFallbackOrderDate,
  recomputeOrderStatus,
  recomputeDisplayStatus,
} from "@/lib/linkOrder";
import { NEEDS_REVIEW_REASON_TEXT, type NeedsReviewReasonId } from "@/lib/needsReviewReasons";

// Shared by both the user-facing "Needs Review" cards and the admin
// dashboard — callers are responsible for their own access control
// (session ownership for users, ADMIN_SECRET for the admin actions),
// exactly like linkEmailToOrder doesn't do auth either.

function normalizeNote(note: string | null | undefined): string | null {
  const trimmed = note?.trim();
  return trimmed ? trimmed : null;
}

// "Looks correct" — an explicit human override. Always wins over whatever
// the data-completeness recompute would otherwise decide, since the human
// is directly asserting this order is fine as-is.
export async function approveOrder(orderId: string, note?: string | null): Promise<boolean> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order) return false;

  await prisma.order.update({
    where: { id: orderId },
    data: {
      needsReview: false,
      userNote: normalizeNote(note) ?? order.userNote,
    },
  });
  return true;
}

// "Split into separate order" — unlinks the most recently *received*
// email linked to this order into a brand-new Order, then re-derives the
// original order's merged fields from whatever's left. Splitting only
// resolves "are these the same order," not general data completeness, so
// (unlike approve) needsReview is left to the normal recompute on both
// resulting orders rather than forced false — if either still looks
// incomplete afterward, that's a separate, legitimate reason to flag it.
export async function splitOrder(orderId: string, note?: string | null): Promise<{ newOrderId: string } | null> {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { emails: true } });
  if (!order) return null;
  if (order.emails.length <= 1) return null; // nothing to split off

  const mostRecent = [...order.emails].sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];

  const newOrderId = await createOrderFromEmail(order.userId, mostRecent, order.returnPortalUrl);
  await prisma.email.update({ where: { id: mostRecent.id }, data: { orderId: newOrderId } });

  // Re-derives the original order's merged fields from whatever's left,
  // and recomputes its status/needsReview — handled inside this call.
  await rebuildOrderFromRemainingEmails(orderId);
  await prisma.order.update({
    where: { id: orderId },
    data: { userNote: normalizeNote(note) ?? order.userNote },
  });

  await applyFallbackOrderDate(newOrderId);
  await recomputeOrderStatus(newOrderId);

  return { newOrderId };
}

// CARD_SPEC.md Part 3 — the needs-review bucket's "Link to order" action.
// v1 is a manual pick: the user has already chosen targetOrderId themselves
// from the full order list, so this just performs the same merge
// linkEmailToOrder's auto-matcher performs on a match, minus the matching.
// Scoped to the same user as both the email and the target order — callers
// are still responsible for confirming that themselves (same convention as
// approveOrder/splitOrder above).
export async function linkEmailToExistingOrder(emailId: string, targetOrderId: string): Promise<boolean> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  const targetOrder = await prisma.order.findUnique({ where: { id: targetOrderId } });
  if (!email || !targetOrder || email.userId !== targetOrder.userId) return false;

  await mergeEmailIntoOrder(targetOrder, email, null);
  await prisma.email.update({ where: { id: emailId }, data: { orderId: targetOrderId, needsReview: false } });
  await applyFallbackOrderDate(targetOrderId);
  await recomputeOrderStatus(targetOrderId);
  await recomputeDisplayStatus(targetOrderId);
  return true;
}

// CARD_SPEC.md Part 3 — "Create new order." Offered when there's no
// existing order to attach an orphaned email to; seeds a fresh Order from
// the email's own extracted fields, same shape createOrderFromEmail always
// produces (the no-match branch of linkEmailToOrder does exactly this).
export async function createOrderFromOrphanedEmail(emailId: string): Promise<{ orderId: string } | null> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return null;

  const orderId = await createOrderFromEmail(email.userId, email, null);
  await prisma.email.update({ where: { id: emailId }, data: { orderId, needsReview: false } });
  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);
  await recomputeDisplayStatus(orderId);
  return { orderId };
}

// CARD_SPEC.md Part 3 — "Not a purchase." Junk-with-rescue (lib/junk.ts's
// JUNK_FILTER/rescueEmail contract), never a hard delete — deliberately not
// deleteEmail() above, which really does prisma.email.delete().
export async function archiveOrphanedEmail(emailId: string): Promise<boolean> {
  const email = await prisma.email.findUnique({ where: { id: emailId }, select: { id: true } });
  if (!email) return false;
  await prisma.email.update({ where: { id: emailId }, data: { junkedAt: new Date() } });
  return true;
}

// There's no stored "reason code" for needsReview — it's just a boolean,
// set either by the prefix-match heuristic in lib/linkOrder.ts or by
// missing-deadline data-completeness logic. Best-effort explanation: the
// AI's own extraction notes on the most recent linked email almost always
// exist and are the most specific answer; fall back to a heuristic based
// on whether a deadline was ever computed. This is the raw, technical
// text — see reviewReasonLabel below for the plain-language version users
// actually see; this stays as supporting detail (truncated on the
// dashboard, shown in full on the admin dashboard).
export function reviewReason(order: { returnDeadline: Date | null; emails: { extractionNotes: string | null }[] }): string {
  const mostRecentNote = order.emails[0]?.extractionNotes;
  if (mostRecentNote) return mostRecentNote;
  if (!order.returnDeadline) return "Missing return deadline information.";
  return "An incoming email's order number closely matched this order's — please confirm it's the same purchase.";
}

export type ReviewOrderForLabel = {
  id: string;
  orderNumber: string | null;
  orderDate: Date | null;
  orderTotal: number | null;
  userNote: string | null;
  emails: { orderNumber: string | null }[];
};

export interface ReviewCandidateOrder {
  id: string;
  orderNumber: string | null;
}

// [auto]-prefixed userNote entries are the merge logic's own audit trail
// (lib/linkOrder.ts's retailerPrefixNote/refundFallbackNote) — the most
// authoritative signal for *why* a merge needed a human to confirm it,
// since it names the two retailer strings that triggered it. Parsed here
// rather than duplicated at write time; see TASKS.md Known Issues for the
// separate, longer-standing note about userNote co-mingling auto and
// user-authored text.
const RETAILER_PREFIX_NOTE = /^\[auto\] retailer prefix match: "(.+)" ← "(.+)"$/m;

// CARD_SPEC.md Part 3 — order-kind bucket rows' reason, mapped onto the
// spec's canonical reason vocabulary (lib/needsReviewReasons.ts). Checked in
// priority order, cheap-version scope (owner-locked 2026-08-21):
//
// 1. An [auto] retailer-prefix-merge note is the strongest, most specific
//    signal that this order is probably the same purchase as another one
//    already in the system — CARD_SPEC's "duplicate" reason.
// 2. A linked email's orderNumber that differs from this order's own AND
//    actually matches a DIFFERENT existing order (not just "differs," which
//    the pre-rebuild code treated as sufficient on its own) — CARD_SPEC's
//    "belongs to an existing order" reason. candidateOrders lets a caller
//    with no other-orders data on hand (e.g. the admin dashboard) pass []
//    and safely skip this check rather than throw.
// 3/4. Missing orderDate / orderTotal — trivial, non-classifier-adjacent
//    null checks with exact-fit spec sentences, kept distinct rather than
//    folded into the generic tail (2026-08-21 owner decision).
// 5. Everything else (previously separate return-portal-untrusted,
//    unconfirmed-forward-date, and low-confidence checks, plus the true
//    catch-all) collapses into one generic "uncertain_details" reason —
//    cheap-version simplification; the full-detection version that
//    re-differentiates these is a logged TASKS.md 🟡 Next follow-up, not
//    built here.
export function computeOrderReviewReason(
  order: ReviewOrderForLabel,
  candidateOrders: ReviewCandidateOrder[] = [],
): { reasonId: NeedsReviewReasonId; why: string } {
  const prefixMatch = order.userNote?.match(RETAILER_PREFIX_NOTE);
  if (prefixMatch) {
    return { reasonId: "duplicate", why: NEEDS_REVIEW_REASON_TEXT.duplicate };
  }

  const mismatchedNumbers = order.emails
    .map((email) => email.orderNumber)
    .filter((n): n is string => !!n && n !== order.orderNumber);
  const belongsToAnotherOrder = mismatchedNumbers.some((mismatched) =>
    candidateOrders.some(
      (candidate) =>
        candidate.id !== order.id && candidate.orderNumber && candidate.orderNumber.toLowerCase() === mismatched.toLowerCase(),
    ),
  );
  if (belongsToAnotherOrder) {
    return { reasonId: "belongs_to_existing_order", why: NEEDS_REVIEW_REASON_TEXT.belongs_to_existing_order };
  }

  if (!order.orderDate) {
    return { reasonId: "missing_order_date", why: NEEDS_REVIEW_REASON_TEXT.missing_order_date };
  }
  if (order.orderTotal == null) {
    return { reasonId: "missing_order_total", why: NEEDS_REVIEW_REASON_TEXT.missing_order_total };
  }
  return { reasonId: "uncertain_details", why: NEEDS_REVIEW_REASON_TEXT.uncertain_details };
}

