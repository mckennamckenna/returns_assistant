import { prisma } from "@/lib/db";
import { createOrderFromEmail, rebuildOrderFromRemainingEmails, applyFallbackOrderDate, recomputeOrderStatus } from "@/lib/linkOrder";

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

type ReviewOrderForLabel = {
  orderNumber: string | null;
  orderDate: Date | null;
  orderTotal: number | null;
  emails: { orderNumber: string | null; confidence: string | null }[];
};

// Plain-language translation of the same underlying signals reviewReason
// inspects — shown prominently, always, regardless of whether a
// technical note exists. Checked in priority order: a prefix match is
// the most specific, actionable explanation when it applies; a generic
// confidence/total gap is the least specific, so it's the fallback.
export function reviewReasonLabel(order: ReviewOrderForLabel): string {
  const isPrefixMatch = order.emails.some((email) => email.orderNumber && email.orderNumber !== order.orderNumber);
  if (isPrefixMatch) {
    return "We matched this return email to an existing order — please confirm it's correct";
  }
  if (!order.orderDate) {
    return "We couldn't find a purchase date — the return deadline may be estimated";
  }
  if (order.emails.some((email) => email.confidence === "low")) {
    return "We're not certain about some details on this order";
  }
  if (order.orderTotal == null) {
    return "Order total couldn't be found";
  }
  return "This order needs a quick check";
}

// Approximate, not linguistically perfect — splits after sentence-ending
// punctuation OR a semicolon, followed by whitespace, which leaves
// decimals like "$433.64" intact (no space directly after that period).
// The semicolon split matters in practice: the AI's extraction notes
// routinely chain several distinct observations into one long,
// semicolon-separated period-terminated sentence (e.g. "X is true; Y was
// assumed because Z; confidence is medium since W."), so splitting on
// periods alone could return all of that as a single "sentence" and
// completely defeat the point of truncating for a short preview.
export function truncateToSentences(text: string, maxSentences: number): { truncated: string; isTruncated: boolean } {
  const sentences = text.split(/(?<=[.!?;])\s+/).filter(Boolean);
  if (sentences.length <= maxSentences) {
    return { truncated: text, isTruncated: false };
  }
  return { truncated: sentences.slice(0, maxSentences).join(" "), isTruncated: true };
}
