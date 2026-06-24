import { prisma } from "@/lib/db";
import { computeDeadline } from "@/lib/extract";
import { decrypt } from "@/lib/crypto";

// If a return label was issued this long ago with no refund email since,
// assume the customer has shipped it back and the refund is in flight.
const RETURN_PROCESSING_DAYS = 14;

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

export async function linkEmailToOrder(emailId: string): Promise<void> {
  const email = await prisma.email.findUnique({ where: { id: emailId } });
  if (!email) return;

  if (!email.retailer || !email.orderNumber) {
    await prisma.email.update({ where: { id: emailId }, data: { needsReview: true } });
    return;
  }

  const existing = await prisma.order.findFirst({
    where: {
      retailer: { equals: email.retailer, mode: "insensitive" },
      orderNumber: { equals: email.orderNumber, mode: "insensitive" },
    },
  });

  const emailLineItems = asLineItemArray(email.lineItems);
  let orderId: string;

  if (existing) {
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
      },
    });
    orderId = updated.id;
  } else {
    const created = await prisma.order.create({
      data: {
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
        lineItems: emailLineItems as object,
      },
    });
    orderId = created.id;
  }

  await prisma.email.update({ where: { id: emailId }, data: { orderId } });
  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);
}
