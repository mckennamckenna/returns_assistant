import type { Order, Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDeadline } from "@/lib/extract";
import { decrypt } from "@/lib/crypto";
import { resolveBodyText } from "@/lib/emailBodyText";
import { deriveDisplayStatus } from "@/lib/displayStatus";
import { parseTracking } from "@/lib/trackingParser";

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

// The AI sometimes extracts different precision from different email types for
// the same retailer — "Proenza" from a shipping template vs "Proenza Schouler"
// from an order confirmation. Exact-retailer matching then silently creates two
// Order cards for one real order. The fallback below catches this by treating
// one name being a prefix of the other as a merge candidate (with needsReview).
// Minimum length guards against short common words like "Gap" (3 chars) or
// "Net" colliding coincidentally. Known failure mode: "American" (8 chars) is a
// valid prefix of both "American Eagle" and "American Vintage" — if two different
// "American X" retailer orders share the same order number they would be wrongly
// merged. Accepted over silent duplicate-card creation; every retailer-prefix merge
// is flagged needsReview + logged in Order.userNote so a human can correct it.
const MIN_RETAILER_PREFIX_LENGTH = 4;

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

// A forwarded-message block embeds the ORIGINAL email's send date as plain
// text — Gmail: "Date: Tue, May 19, 2026 at 4:21 PM"; Apple Mail/iPhone:
// "Date: April 22, 2026 at 9:07:10 PM PDT". That's the retailer's actual
// send time — unlike receivedAt/rawJson.Date, which is when the customer
// forwarded it (could be weeks later). Only valid as an orderDate proxy for
// order_confirmation emails specifically: an order confirmation is normally
// sent right when the order is placed, but a shipping/delivery/return
// email's send date has no such relationship to the order date.
//
// Operates on resolveBodyText's output (textBody, or htmlBody converted to
// plain text when textBody is empty), not raw textBody — Apple/iPhone
// forwards are HTML-only. html-to-text renders Apple's forwarded block as a
// blockquote, prefixing every line with "> ", so the leading `(?:>\s*)*` is
// required or the Date line never matches at all for that format. The
// unicode normalization handles Apple's narrow no-break space (U+202F)
// before AM/PM, which plain whitespace handling can miss.
function parseForwardedHeaderDate(bodyText: string | null): Date | null {
  if (!bodyText) return null;
  const match = bodyText.match(/^(?:>\s*)*Date:\s*(.+)$/m);
  if (!match) return null;
  const normalized = match[1].trim().normalize("NFKC").replace(/\s+/g, " ").replace(" at ", " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Finds the earliest order_confirmation email linked to this order and
// parses its forwarded-header date as an orderDate proxy.
async function resolveFallbackOrderDate(orderId: string): Promise<Date | null> {
  const confirmationEmail = await prisma.email.findFirst({
    where: { orderId, emailType: "order_confirmation" },
    orderBy: { receivedAt: "asc" },
  });
  if (!confirmationEmail) return null;

  const textBody = confirmationEmail.textBody ? decrypt(confirmationEmail.textBody) : null;
  const htmlBody = confirmationEmail.htmlBody ? decrypt(confirmationEmail.htmlBody) : null;
  return parseForwardedHeaderDate(resolveBodyText(textBody, htmlBody));
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
    returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
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

// Derives and persists the user-facing displayStatus from the email types
// linked to this order. Never auto-downgrades a status that was manually
// advanced (return_requested or higher) — those can only move forward via
// the PATCH /api/orders/:id/status endpoint.
export async function recomputeDisplayStatus(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { displayStatus: true },
  });
  const emails = await prisma.email.findMany({
    where: { orderId },
    select: { emailType: true },
  });
  const emailTypes = emails.map((e) => e.emailType).filter((t): t is string => t != null);
  const next = deriveDisplayStatus(emailTypes, order.displayStatus);
  if (next !== order.displayStatus) {
    await prisma.order.update({ where: { id: orderId }, data: { displayStatus: next } });
  }
}

// Scrapes carrier/trackingNumber/trackingUrl from a shipping_confirmation email
// body and writes them to the order. Skips if the order already has tracking
// info (from an earlier shipping email) or if the email is not a shipping_confirmation.
async function applyShippingTracking(orderId: string, email: Email): Promise<void> {
  if (email.emailType !== "shipping_confirmation") return;

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { trackingNumber: true },
  });
  if (existing?.trackingNumber) return;

  const textBody = email.textBody ? decrypt(email.textBody) : null;
  const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
  const tracking = parseTracking(textBody, htmlBody);

  if (tracking.carrier || tracking.trackingNumber || tracking.trackingUrl) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        carrier: tracking.carrier,
        trackingNumber: tracking.trackingNumber,
        trackingUrl: tracking.trackingUrl,
      },
    });
  }
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

// Exported for unit testing.
// Returns true when one retailer name is a case-insensitive prefix of the
// other and the shorter name meets the minimum length floor.
export function isRetailerPrefixMatch(a: string, b: string): boolean {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  const shorter = lowerA.length <= lowerB.length ? lowerA : lowerB;
  const longer = lowerA.length <= lowerB.length ? lowerB : lowerA;
  return shorter.length >= MIN_RETAILER_PREFIX_LENGTH && longer.startsWith(shorter);
}

// Fallback for the case where the exact retailer match fails but the order
// number matches exactly — looks for an existing order whose retailer is a
// prefix match of the incoming email's retailer (or vice versa).
// Order-number equality is enforced in the DB query (not the JS filter) to
// avoid loading the entire user's Order set into memory.
async function findRetailerPrefixMatchOrder(
  userId: string,
  retailer: string,
  orderNumber: string,
): Promise<Order | null> {
  const candidates = await prisma.order.findMany({
    where: { userId, orderNumber: { equals: orderNumber, mode: "insensitive" } },
  });
  return candidates.find((c) => c.retailer != null && isRetailerPrefixMatch(c.retailer, retailer)) ?? null;
}

// An order_confirmation describes the WHOLE order; a shipping or delivery
// email often only describes ONE package of a multi-package shipment, and
// can state THAT package's own subtotal in a way that looks exactly like
// a stated total (e.g. "Package total: $21.84" for one box of a five-box
// order). Once a real order_confirmation has supplied a total, no other
// email type is allowed to override it — discovered as a real regression
// while backfilling more aggressive shipping/delivery extraction: a
// correct $433.64 order_confirmation total got silently overwritten by
// two shipping emails' partial-package totals, in merge order.
async function resolveOrderTotal(existing: Order, email: Email): Promise<number | null> {
  if (email.emailType === "order_confirmation") {
    return email.orderTotal ?? existing.orderTotal;
  }

  const confirmation = await prisma.email.findFirst({
    where: { orderId: existing.id, emailType: "order_confirmation", orderTotal: { not: null } },
  });
  if (confirmation) {
    return confirmation.orderTotal;
  }

  return email.orderTotal ?? existing.orderTotal;
}

// Shared by the exact-match, order-number-prefix-match, and retailer-prefix-match
// paths: an existing Order gets enriched with whatever the new email adds, never
// blindly overwritten. Exported so the backfill script can call it directly,
// bypassing the normal match step entirely.
export async function mergeEmailIntoOrder(existing: Order, email: Email, returnPortalUrl: string | null): Promise<string> {
  const emailLineItems = asLineItemArray(email.lineItems);
  const mergedOrderDate = email.orderDate ?? existing.orderDate;
  const mergedDeliveryDate = email.deliveryDate ?? existing.deliveryDate;
  const mergedReturnWindowDays = email.returnWindowDays ?? existing.returnWindowDays;
  const mergedReturnWindowStartsFrom = email.returnWindowStartsFrom ?? existing.returnWindowStartsFrom;
  const existingLineItems = asLineItemArray(existing.lineItems);
  const mergedLineItems = emailLineItems.length > existingLineItems.length ? emailLineItems : existingLineItems;
  const mergedOrderTotal = await resolveOrderTotal(existing, email);

  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: mergedOrderDate ? mergedOrderDate.toISOString() : null,
    deliveryDate: mergedDeliveryDate ? mergedDeliveryDate.toISOString() : null,
    returnWindowDays: mergedReturnWindowDays,
    returnWindowStartsFrom: mergedReturnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  const updated = await prisma.order.update({
    where: { id: existing.id },
    data: {
      orderDate: mergedOrderDate,
      deliveryDate: mergedDeliveryDate,
      returnWindowDays: mergedReturnWindowDays,
      returnWindowStartsFrom: mergedReturnWindowStartsFrom,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated,
      policySource: mapPolicySource(email.policySource) ?? existing.policySource,
      orderTotal: mergedOrderTotal,
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
      returnWindowStartsFrom: email.returnWindowStartsFrom,
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
      returnWindowStartsFrom: first.returnWindowStartsFrom,
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
  let retailerPrefixNote: string | null = null;

  if (existing) {
    orderId = await mergeEmailIntoOrder(existing, email, returnPortalUrl);
  } else {
    const prefixMatch = await findPrefixMatchOrder(email.userId, email.retailer, email.orderNumber);

    if (prefixMatch) {
      orderId = await mergeEmailIntoOrder(prefixMatch, email, returnPortalUrl);
      isPrefixMatchedOrder = true;
    } else {
      const retailerPrefixMatch = await findRetailerPrefixMatchOrder(
        email.userId,
        email.retailer,
        email.orderNumber,
      );
      if (retailerPrefixMatch) {
        orderId = await mergeEmailIntoOrder(retailerPrefixMatch, email, returnPortalUrl);
        isPrefixMatchedOrder = true;
        retailerPrefixNote = `[auto] retailer prefix match: "${retailerPrefixMatch.retailer}" ← "${email.retailer}"`;
      } else {
        orderId = await createOrderFromEmail(email.userId, email, returnPortalUrl);
      }
    }
  }

  await prisma.email.update({ where: { id: emailId }, data: { orderId } });
  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);
  await applyShippingTracking(orderId, email);
  await recomputeDisplayStatus(orderId);

  // recomputeOrderStatus derives needsReview from data completeness, which
  // would happily clear it the moment the order looks complete — but any
  // prefix match needs a human to confirm it wasn't two different orders
  // that happened to share a prefix, regardless of how complete the data
  // looks. Force it true after recompute, not before.
  // For a retailer-prefix merge, also append an audit note to userNote so
  // the merge reason is visible without having to diff order records.
  if (isPrefixMatchedOrder) {
    const noteUpdate: { needsReview: boolean; userNote?: string } = { needsReview: true };
    if (retailerPrefixNote) {
      const merged = await prisma.order.findUnique({ where: { id: orderId }, select: { userNote: true } });
      const prior = merged?.userNote ?? null;
      noteUpdate.userNote = prior ? `${prior}\n${retailerPrefixNote}` : retailerPrefixNote;
    }
    await prisma.order.update({ where: { id: orderId }, data: noteUpdate });
  }
}
