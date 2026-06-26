import type { Order, Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDeadline } from "@/lib/extract";
import { decrypt } from "@/lib/crypto";

// If a return label was issued this long ago with no refund email since,
// assume the customer has shipped it back and the refund is in flight.
const RETURN_PROCESSING_DAYS = 14;

// A return-flow email citing "F4VLSF00" for an order confirmed as "F4VLSF"
// is the same order — ReBOUND and similar return portals sometimes
// append/truncate digits rather than repeating the order number exactly.
// Only treated as a *candidate* match, not a certain one: the prefix must
// be at least this long to avoid two unrelated short order numbers
// coincidentally matching, and every prefix match still gets needsReview
// so a human confirms it. See BUILD.md's order-number-drift note.
const MIN_PREFIX_MATCH_LENGTH = 5;

type OrderStatus =
  | "ordered"
  | "shipped"
  | "delivered"
  | "returnable"
  | "return_started"
  | "refund_pending"
  | "completed"
  | "expired"
  | "needs_review";

function mapPolicySource(source: string | null): string | null {
  if (source === "email") return "stated_in_email";
  if (source === "web_lookup") return "web_lookup";
  return null;
}

function asLineItemArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

// Gmail's forwarded-message block embeds the ORIGINAL email's send date as
// plain text, e.g. "Date: Tue, May 19, 2026 at 4:21 PM". That's the
// retailer's actual send time — unlike receivedAt/rawJson.Date, which is
// when the customer forwarded it (could be weeks later). Only valid as an
// orderDate proxy for order_confirmation emails specifically: an order
// confirmation is normally sent right when the order is placed, but a
// shipping/delivery/return email's send date has no such relationship to
// the order date.
function parseForwardedHeaderDate(textBody: string | null): Date | null {
  if (!textBody) return null;
  const match = textBody.match(/^Date:\s*(.+)$/m);
  if (!match) return null;
  const parsed = new Date(match[1].trim().replace(" at ", " "));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Finds the earliest order_confirmation email linked to this order and
// parses its forwarded-header date as an orderDate proxy.
async function resolveFallbackOrderDate(orderId: string): Promise<Date | null> {
  const confirmationEmail = await prisma.email.findFirst({
    where: { orderId, emailType: "order_confirmation" },
    orderBy: { receivedAt: "asc" },
  });
  if (!confirmationEmail?.textBody) return null;
  return parseForwardedHeaderDate(decrypt(confirmationEmail.textBody));
}

// If an order is missing orderDate after normal extraction/merging, try the
// forwarded-header fallback and recompute returnDeadline from it. The
// resulting deadline is always marked estimated — the date it's based on
// is inferred, not stated, regardless of whether deliveryDate is known.
export async function applyFallbackOrderDate(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.orderDate) return;

  const fallbackOrderDate = await resolveFallbackOrderDate(orderId);
  if (!fallbackOrderDate) return;

  const { returnDeadline } = computeDeadline({
    orderDate: fallbackOrderDate.toISOString(),
    deliveryDate: order.deliveryDate ? order.deliveryDate.toISOString() : null,
    returnWindowDays: order.returnWindowDays,
    returnWindowStartsFrom: null,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      orderDate: fallbackOrderDate,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated: true,
    },
  });
}

async function computeOrderStatus(
  orderId: string,
  returnDeadline: Date | null,
): Promise<{ status: OrderStatus; needsReview: boolean }> {
  const emails = await prisma.email.findMany({
    where: { orderId },
    select: { emailType: true, receivedAt: true },
  });

  const hasType = (t: string) => emails.some((e) => e.emailType === t);
  const now = Date.now();

  // needsReview reflects whether the ORDER's own resolved data is
  // incomplete — not whether some individual linked email was uncertain
  // in isolation. A shipping email that couldn't find a policy on its own
  // shouldn't flag the order if a sibling order-confirmation already
  // supplied returnWindowDays and a deadline was computed from it.
  const looksLikeRealOrder = hasType("order_confirmation") || hasType("shipping_confirmation") || hasType("delivery");
  const needsReview = looksLikeRealOrder && returnDeadline == null;

  if (hasType("refund")) {
    return { status: "completed", needsReview };
  }

  if (hasType("return_label")) {
    const mostRecentLabel = emails
      .filter((e) => e.emailType === "return_label")
      .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime())[0];
    const daysSinceLabel = (now - mostRecentLabel.receivedAt.getTime()) / (24 * 60 * 60 * 1000);
    return {
      status: daysSinceLabel > RETURN_PROCESSING_DAYS ? "refund_pending" : "return_started",
      needsReview,
    };
  }

  if (returnDeadline && now > returnDeadline.getTime()) {
    return { status: "expired", needsReview };
  }

  if (hasType("delivery")) {
    return { status: "returnable", needsReview };
  }

  if (hasType("shipping_confirmation")) {
    return { status: "shipped", needsReview };
  }

  if (hasType("order_confirmation")) {
    return { status: "ordered", needsReview };
  }

  return { status: "needs_review", needsReview: true };
}

export async function recomputeOrderStatus(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const { status, needsReview } = await computeOrderStatus(orderId, order.returnDeadline);
  await prisma.order.update({ where: { id: orderId }, data: { status, needsReview } });
}

function isPrefixMatch(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  const shorter = lowerA.length <= lowerB.length ? lowerA : lowerB;
  const longer = lowerA.length <= lowerB.length ? lowerB : lowerA;
  return shorter.length >= MIN_PREFIX_MATCH_LENGTH && longer.startsWith(shorter);
}

// Same userId + retailer scoping as the exact match — see the comment on
// the exact-match query below for why that's load-bearing, not optional.
async function findPrefixMatchOrder(userId: string, retailer: string, orderNumber: string): Promise<Order | null> {
  const candidates = await prisma.order.findMany({
    where: { userId, retailer: { equals: retailer, mode: "insensitive" } },
  });
  return candidates.find((candidate) => candidate.orderNumber && isPrefixMatch(candidate.orderNumber, orderNumber)) ?? null;
}

// Shared by both the exact-match and prefix-match paths: an existing Order
// gets enriched with whatever the new email adds, never blindly overwritten.
async function mergeEmailIntoOrder(existing: Order, email: Email, returnPortalUrl: string | null): Promise<string> {
  const emailLineItems = asLineItemArray(email.lineItems);
  const mergedOrderDate = email.orderDate ?? existing.orderDate;
  const mergedDeliveryDate = email.deliveryDate ?? existing.deliveryDate;
  const mergedReturnWindowDays = email.returnWindowDays ?? existing.returnWindowDays;
  const existingLineItems = asLineItemArray(existing.lineItems);
  const mergedLineItems = emailLineItems.length > existingLineItems.length ? emailLineItems : existingLineItems;

  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: mergedOrderDate ? mergedOrderDate.toISOString() : null,
    deliveryDate: mergedDeliveryDate ? mergedDeliveryDate.toISOString() : null,
    returnWindowDays: mergedReturnWindowDays,
    returnWindowStartsFrom: null, // not persisted on Order; defaults to delivery-anchored
  });

  const updated = await prisma.order.update({
    where: { id: existing.id },
    data: {
      orderDate: mergedOrderDate,
      deliveryDate: mergedDeliveryDate,
      returnWindowDays: mergedReturnWindowDays,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated,
      policySource: mapPolicySource(email.policySource) ?? existing.policySource,
      orderTotal: email.orderTotal ?? existing.orderTotal,
      orderCurrency: email.orderCurrency ?? existing.orderCurrency,
      lineItems: mergedLineItems as object,
      returnPortalUrl: returnPortalUrl ?? existing.returnPortalUrl,
    },
  });
  return updated.id;
}

// Seeds a brand-new Order directly from one email's fields — the same
// shape as the very first email an order is ever created from. Shared by
// the no-match path below and by lib/orderReview.ts's split action, which
// re-derives this when un-merging an email from an existing order.
export async function createOrderFromEmail(
  userId: string,
  email: Email,
  returnPortalUrl: string | null,
): Promise<string> {
  const created = await prisma.order.create({
    data: {
      userId,
      retailer: email.retailer,
      orderNumber: email.orderNumber,
      orderDate: email.orderDate,
      deliveryDate: email.deliveryDate,
      returnWindowDays: email.returnWindowDays,
      returnDeadline: email.returnDeadline,
      deadlineIsEstimated: email.deadlineIsEstimated,
      policySource: mapPolicySource(email.policySource),
      orderTotal: email.orderTotal,
      orderCurrency: email.orderCurrency,
      lineItems: asLineItemArray(email.lineItems) as object,
      returnPortalUrl,
    },
  });
  return created.id;
}

// Re-derives an order's merged fields from scratch, from whatever emails
// are still linked to it — used after splitting one email back out, so
// the remaining order doesn't keep stale data contributed by the email
// that just left. Replays the same fold the emails would have produced if
// merged in receivedAt order originally (later non-null values win),
// which matches mergeEmailIntoOrder's existing merge semantics exactly.
// returnPortalUrl is deliberately left untouched: it isn't stored on
// Email, so it can't be recovered from the remaining emails alone.
export async function rebuildOrderFromRemainingEmails(orderId: string): Promise<void> {
  const emails = await prisma.email.findMany({ where: { orderId }, orderBy: { receivedAt: "asc" } });
  if (emails.length === 0) return;

  const [first, ...rest] = emails;
  await prisma.order.update({
    where: { id: orderId },
    data: {
      orderDate: first.orderDate,
      deliveryDate: first.deliveryDate,
      returnWindowDays: first.returnWindowDays,
      returnDeadline: first.returnDeadline,
      deadlineIsEstimated: first.deadlineIsEstimated,
      policySource: mapPolicySource(first.policySource),
      orderTotal: first.orderTotal,
      orderCurrency: first.orderCurrency,
      lineItems: asLineItemArray(first.lineItems) as object,
    },
  });

  let current = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  for (const email of rest) {
    const updatedId = await mergeEmailIntoOrder(current, email, null);
    current = await prisma.order.findUniqueOrThrow({ where: { id: updatedId } });
  }

  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);
}

// returnPortalUrl isn't stored on Email (it's product/retailer data, not
// derived from any one email) — it's threaded through from the in-memory
// extraction result straight onto the Order, never persisted per-email.
export async function linkEmailToOrder(emailId: string, returnPortalUrl: string | null = null): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return;

  if (!email.retailer || !email.orderNumber) {
    await prisma.email.update({ where: { id: emailId }, data: { needsReview: true } });
    return;
  }

  // userId scoping here is load-bearing, not optional: without it, two
  // different users who both happen to shop at the same retailer with a
  // matching order-number format could have their orders merged together,
  // leaking one user's purchase data onto another's dashboard.
  const existing = await prisma.order.findFirst({
    where: {
      userId: email.userId,
      retailer: { equals: email.retailer, mode: "insensitive" },
      orderNumber: { equals: email.orderNumber, mode: "insensitive" },
    },
  });

  let orderId: string;
  let isPrefixMatchedOrder = false;

  if (existing) {
    orderId = await mergeEmailIntoOrder(existing, email, returnPortalUrl);
  } else {
    const prefixMatch = await findPrefixMatchOrder(email.userId, email.retailer, email.orderNumber);

    if (prefixMatch) {
      orderId = await mergeEmailIntoOrder(prefixMatch, email, returnPortalUrl);
      isPrefixMatchedOrder = true;
    } else {
      orderId = await createOrderFromEmail(email.userId, email, returnPortalUrl);
    }
  }

  await prisma.email.update({ where: { id: emailId }, data: { orderId } });
  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);

  // recomputeOrderStatus derives needsReview from data completeness, which
  // would happily clear it the moment the order looks complete — but a
  // prefix match needs a human to confirm it wasn't two different orders
  // that happened to share a prefix, regardless of how complete the data
  // looks. Force it true after recompute, not before.
  if (isPrefixMatchedOrder) {
    await prisma.order.update({ where: { id: orderId }, data: { needsReview: true } });
  }
}
