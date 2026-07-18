import type { Order, Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDeadline, normalizeReturnPortalUrl } from "@/lib/extract";
import { decrypt } from "@/lib/crypto";
import { resolveBodyText } from "@/lib/emailBodyText";
import { deriveDisplayStatus, buildStatusTransitionData } from "@/lib/displayStatus";
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
// "Date: April 22, 2026 at 9:07:10 PM PDT". When present, that's the most
// precise orderDate proxy available short of the email actually stating one.
//
// Operates on resolveBodyText's output (textBody, or htmlBody converted to
// plain text when textBody is empty), not raw textBody — Apple/iPhone
// forwards are HTML-only. html-to-text renders Apple's forwarded block as a
// blockquote, prefixing every line with "> ", so the leading `(?:>\s*)*` is
// required or the Date line never matches at all for that format. The
// unicode normalization handles Apple's narrow no-break space (U+202F)
// before AM/PM, which plain whitespace handling can miss.
export function parseForwardedHeaderDate(bodyText: string | null): Date | null {
  if (!bodyText) return null;
  const match = bodyText.match(/^(?:>\s*)*Date:\s*(.+)$/m);
  if (!match) return null;
  const normalized = match[1].trim().normalize("NFKC").replace(/\s+/g, " ").replace(" at ", " ");
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Finds the earliest email linked to this order and derives an orderDate
// proxy from it, in two tiers:
//   1. Parse a forwarded-header "Date:" line out of its body, when present
//      (most precise — that's the retailer's actual send time, not when the
//      customer got around to forwarding it, which could be weeks later).
//   2. Otherwise fall back to the email's own receivedAt (Postmark's parsed
//      Date header, app/api/inbound/route.ts) — always present, and a good
//      proxy for auto-forwarded/directly-relayed transactional mail (e.g.
//      Amazon, which relays via SES with no forwarded quote block at all —
//      Bug 8). Weaker for a genuinely manually-forwarded email with no
//      parseable Date line, since receivedAt is then just "whenever the
//      customer forwarded it" — but better than no orderDate at all.
// Not scoped to order_confirmation internally — this function resolves the
// best available date from whatever the earliest linked email turns out to
// be. Amazon's transactional mail never produces an order_confirmation
// emailType (only shipping_confirmation), so hard-coding that type here
// would leave Amazon orders with no fallback candidate at all.
//
// Whether the fallback should fire at all for a given earliest-email type is
// decided by the caller, applyFallbackOrderDate, via its allowed-type gate
// below — return_label/refund/other-typed earliest emails never reach this
// function, because their receivedAt has no defined relationship to the
// true order date (see applyFallbackOrderDate's comment and BUILD.md's
// Decisions log).
async function resolveFallbackOrderDate(orderId: string): Promise<Date | null> {
  const earliestEmail = await prisma.email.findFirst({
    where: { orderId },
    orderBy: { receivedAt: "asc" },
  });
  if (!earliestEmail) return null;

  const textBody = earliestEmail.textBody ? decrypt(earliestEmail.textBody) : null;
  const htmlBody = earliestEmail.htmlBody ? decrypt(earliestEmail.htmlBody) : null;
  const parsed = parseForwardedHeaderDate(resolveBodyText(textBody, htmlBody));
  return parsed ?? earliestEmail.receivedAt;
}

// If an order is missing orderDate after normal extraction/merging, try the
// fallback and recompute returnDeadline from it — but only when the
// earliest-linked email is one of the types where receivedAt (or its
// forwarded-header Date line) is actually a meaningful proxy for order
// placement time: order_confirmation, shipping_confirmation, delivery.
// return_label, refund, and other-typed earliest emails are excluded —
// their receivedAt reflects a later point in the post-purchase loop (or,
// for other, unrelated marketing mail), with no defined relationship to
// when the order was actually placed. Inventing an orderDate from one of
// those produced a visibly-wrong deadline in production (Caroline's Moda
// order, 2026-07-08) — see BUILD.md's Decisions log. New emailType values
// must be explicitly added to one bucket or the other; there's no default.
// Both orderDateEstimated and deadlineIsEstimated are always set when the
// fallback does fire — the order date itself is inferred, not stated, so
// any deadline computed from it is estimated too regardless of whether
// deliveryDate is known.
const ALLOWED_FALLBACK_EMAIL_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);

export async function applyFallbackOrderDate(orderId: string): Promise<void> {
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.orderDate) return;

  const earliestEmail = await prisma.email.findFirst({
    where: { orderId },
    orderBy: { receivedAt: "asc" },
    select: { emailType: true },
  });
  if (!earliestEmail || !ALLOWED_FALLBACK_EMAIL_TYPES.has(earliestEmail.emailType ?? "")) return;

  const fallbackOrderDate = await resolveFallbackOrderDate(orderId);
  if (!fallbackOrderDate) return;

  const { returnDeadline } = computeDeadline({
    orderDate: fallbackOrderDate.toISOString(),
    deliveredAt: order.deliveredAt ? order.deliveredAt.toISOString() : null,
    estimatedDeliveryDate: order.estimatedDeliveryDate ? order.estimatedDeliveryDate.toISOString() : null,
    returnWindowDays: order.returnWindowDays,
    returnWindowStartsFrom: order.returnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  await prisma.order.update({
    where: { id: orderId },
    data: {
      orderDate: fallbackOrderDate,
      orderDateEstimated: true,
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
// the PATCH /api/orders/:id/status endpoint. The one auto-derivation signal
// allowed to move an order past return_requested/returned on its own is a
// refund email (see deriveDisplayStatus) — whether that lands on "refunded"
// or "returned" depends on hasConfirmedRefundAmount, computed here from
// every linked refund email's extracted refundAmount/refundAmountConfidence.
//
// Builds its update via the shared buildStatusTransitionData() — the same
// function both manual transition endpoints use — so this third caller
// can't drift from their atomic-write contract: auto-archive on "refunded",
// returnedAt backfilled on first arrival at either "returned" or "refunded".
export async function recomputeDisplayStatus(orderId: string): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    select: { displayStatus: true, returnedAt: true, archivedAt: true },
  });
  const emails = await prisma.email.findMany({
    where: { orderId },
    select: { emailType: true, refundAmount: true, refundAmountConfidence: true },
  });
  const emailTypes = emails.map((e) => e.emailType).filter((t): t is string => t != null);
  const hasConfirmedRefundAmount = emails.some(
    (e) => e.emailType === "refund" && e.refundAmount != null && e.refundAmountConfidence !== "low",
  );
  const next = deriveDisplayStatus(emailTypes, order.displayStatus, hasConfirmedRefundAmount);
  if (next !== order.displayStatus) {
    const data = buildStatusTransitionData(next, { returnedAt: order.returnedAt, archivedAt: order.archivedAt });
    await prisma.order.update({ where: { id: orderId }, data });
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

// Scrapes return carrier info from a return_label email body, using the same
// carrier-pattern logic as applyShippingTracking. Skips if tracking info is
// already present (first return label wins) or if the email is not a return_label.
// Never blocks return_requested status — null result is always safe.
async function applyReturnTracking(orderId: string, email: Email): Promise<void> {
  if (email.emailType !== "return_label") return;

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { returnTrackingNumber: true },
  });
  if (existing?.returnTrackingNumber) return;

  const textBody = email.textBody ? decrypt(email.textBody) : null;
  const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
  const tracking = parseTracking(textBody, htmlBody);

  if (tracking.carrier || tracking.trackingNumber || tracking.trackingUrl) {
    await prisma.order.update({
      where: { id: orderId },
      data: {
        returnCarrier: tracking.carrier,
        returnTrackingNumber: tracking.trackingNumber,
        returnTrackingUrl: tracking.trackingUrl,
      },
    });
  }
}

// Exported for unit testing.
// A return_label or refund email reaching an order already marked "kept" is
// new information contradicting a settled decision — surfaced via
// needsReview regardless of match confidence, since even an exact
// order-number match wouldn't otherwise force a review. Deliberately scoped
// to "kept": "returned"/"refunded" are the states these email types are the
// expected path toward, so applying the same guard there would flag the
// app's most ordinary flow instead of a genuine contradiction. Never touches
// displayStatus — that stays one-way via lib/displayStatus.ts's own guard;
// this only asks a human to look.
export function computeKeptStatusConflict(
  matchedOrderDisplayStatus: string | null,
  emailType: string | null,
): { isKeptStatusConflict: boolean; note: string | null } {
  const isKeptStatusConflict =
    matchedOrderDisplayStatus === "kept" && (emailType === "return_label" || emailType === "refund");
  return {
    isKeptStatusConflict,
    note: isKeptStatusConflict
      ? `[auto] a "${emailType}" email arrived on an order already marked "Kept" — resurfaced for review`
      : null,
  };
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

export type RefundFallbackTier = "line_item_overlap" | "total_match" | "recency";

export interface RefundFallbackMatch {
  order: Order;
  tier: RefundFallbackTier;
}

function normalizeItemName(name: string | null | undefined): string {
  return (name ?? "").toLowerCase().trim();
}

function lineItemsOverlap(refundItems: unknown[], orderItems: unknown[]): boolean {
  const refundNames = (refundItems as Array<{ name?: string }>)
    .map((i) => normalizeItemName(i.name))
    .filter((n) => n.length > 0);
  const orderNames = (orderItems as Array<{ name?: string }>)
    .map((i) => normalizeItemName(i.name))
    .filter((n) => n.length > 0);

  return refundNames.some((rn) => orderNames.some((on) => on.includes(rn) || rn.includes(on)));
}

// A refund email with no order number in the body (Bugs 9+10: Shopbop and
// H&M both did this) can't use the exact/prefix match paths above, which
// all require one. Only called for emailType === "refund" — never loosens
// the orderNumber requirement for any other email type.
//
// Scoped to candidate orders for the same retailer + userId, then narrowed
// by whichever signal the refund email actually has, most specific first:
//   1. line-item name overlap — the refund email names the same product(s)
//      as an existing order.
//   2. orderTotal match — soft signal only (refunds are frequently partial,
//      so this is a loose <= comparison, not exact equality).
//   3. recency — the single candidate if there's exactly one, otherwise the
//      most recently created one. Weakest signal, last resort.
// Returns null when there's no candidate order for that retailer at all —
// callers should create a new Order from the refund email itself in that
// case (there's nothing to merge into), not treat it as a failed match.
// Exported so the backfill dry-run script can preview which tier would
// fire (a read-only query itself — no writes happen until the caller
// actually merges/creates).
export async function findRefundFallbackOrder(
  userId: string,
  retailer: string,
  refundLineItems: unknown[],
  refundTotal: number | null,
): Promise<RefundFallbackMatch | null> {
  const candidates = await prisma.order.findMany({
    where: { userId, retailer: { equals: retailer, mode: "insensitive" }, deletedAt: null },
  });
  if (candidates.length === 0) return null;

  const overlapMatch = candidates.find((c) => lineItemsOverlap(refundLineItems, asLineItemArray(c.lineItems)));
  if (overlapMatch) return { order: overlapMatch, tier: "line_item_overlap" };

  if (refundTotal != null) {
    const totalMatch = candidates.find((c) => c.orderTotal != null && refundTotal <= c.orderTotal + 0.01);
    if (totalMatch) return { order: totalMatch, tier: "total_match" };
  }

  const mostRecent = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  return { order: mostRecent, tier: "recency" };
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
  const mergedEstimatedDeliveryDate = email.estimatedDeliveryDate ?? existing.estimatedDeliveryDate;
  const mergedDeliveredAt = email.deliveredAt ?? existing.deliveredAt;
  const mergedReturnWindowDays = email.returnWindowDays ?? existing.returnWindowDays;
  const mergedReturnWindowStartsFrom = email.returnWindowStartsFrom ?? existing.returnWindowStartsFrom;
  const existingLineItems = asLineItemArray(existing.lineItems);
  const mergedLineItems = emailLineItems.length > existingLineItems.length ? emailLineItems : existingLineItems;
  const mergedOrderTotal = await resolveOrderTotal(existing, email);

  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: mergedOrderDate ? mergedOrderDate.toISOString() : null,
    deliveredAt: mergedDeliveredAt ? mergedDeliveredAt.toISOString() : null,
    estimatedDeliveryDate: mergedEstimatedDeliveryDate ? mergedEstimatedDeliveryDate.toISOString() : null,
    returnWindowDays: mergedReturnWindowDays,
    returnWindowStartsFrom: mergedReturnWindowStartsFrom as "order_date" | "delivery_date" | null,
  });

  const updated = await prisma.order.update({
    where: { id: existing.id },
    data: {
      orderDate: mergedOrderDate,
      // A genuinely-extracted orderDate on the new email always supersedes a
      // prior fallback guess (mergedOrderDate above already prefers it) —
      // so the estimated flag must clear in the same case, or it goes stale
      // and keeps flagging a now-real date as inferred.
      orderDateEstimated: email.orderDate ? false : existing.orderDateEstimated,
      deliveryDate: mergedDeliveryDate,
      estimatedDeliveryDate: mergedEstimatedDeliveryDate,
      deliveredAt: mergedDeliveredAt,
      returnWindowDays: mergedReturnWindowDays,
      returnWindowStartsFrom: mergedReturnWindowStartsFrom,
      returnDeadline: returnDeadline ? new Date(returnDeadline) : null,
      deadlineIsEstimated,
      policySource: mapPolicySource(email.policySource) ?? existing.policySource,
      orderTotal: mergedOrderTotal,
      orderCurrency: email.orderCurrency ?? existing.orderCurrency,
      lineItems: mergedLineItems as object,
      returnPortalUrl: normalizeReturnPortalUrl(returnPortalUrl) ?? normalizeReturnPortalUrl(existing.returnPortalUrl),
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
      estimatedDeliveryDate: email.estimatedDeliveryDate,
      deliveredAt: email.deliveredAt,
      returnWindowDays: email.returnWindowDays,
      returnWindowStartsFrom: email.returnWindowStartsFrom,
      returnDeadline: email.returnDeadline,
      deadlineIsEstimated: email.deadlineIsEstimated,
      policySource: mapPolicySource(email.policySource),
      orderTotal: email.orderTotal,
      orderCurrency: email.orderCurrency,
      lineItems: asLineItemArray(email.lineItems) as object,
      returnPortalUrl: normalizeReturnPortalUrl(returnPortalUrl),
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
      orderDateEstimated: false, // rebuilding from scratch; re-derived below if still missing
      deliveryDate: first.deliveryDate,
      estimatedDeliveryDate: first.estimatedDeliveryDate,
      deliveredAt: first.deliveredAt,
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

  // A refund email with no order number (Bugs 9+10: Shopbop and H&M both
  // did this) still gets a shot at linking via findRefundFallbackOrder
  // below, instead of the blanket needsReview-and-stop every other
  // email type gets when orderNumber is missing. Scoped strictly to
  // emailType === "refund" — this does not loosen the orderNumber
  // requirement for order_confirmation/shipping_confirmation/delivery/
  // return_label emails, which still need one.
  const isOrphanedRefund = email.emailType === "refund" && !!email.retailer && !email.orderNumber;

  if (!email.retailer || (!email.orderNumber && !isOrphanedRefund)) {
    await prisma.email.update({ where: { id: emailId }, data: { needsReview: true } });
    return;
  }

  let orderId: string;
  let isPrefixMatchedOrder = false;
  let retailerPrefixNote: string | null = null;
  let isRefundFallbackMatch = false;
  let refundFallbackNote: string | null = null;
  // Pre-merge displayStatus of whichever existing order this email lands on
  // (null when a brand-new order is created instead) — captured before
  // mergeEmailIntoOrder runs, since "kept" is one-way and this is the only
  // point where the prior value is still visible.
  let matchedOrderDisplayStatus: string | null = null;

  if (isOrphanedRefund) {
    const refundFallback = await findRefundFallbackOrder(
      email.userId,
      email.retailer!,
      asLineItemArray(email.lineItems),
      email.orderTotal,
    );

    if (refundFallback) {
      matchedOrderDisplayStatus = refundFallback.order.displayStatus;
      orderId = await mergeEmailIntoOrder(refundFallback.order, email, returnPortalUrl);
      isRefundFallbackMatch = true;
      refundFallbackNote = `[auto] refund fallback match (${refundFallback.tier}): no order number on refund email; matched to "${refundFallback.order.retailer}" #${refundFallback.order.orderNumber ?? "(none)"}`;
    } else {
      // No candidate order for this retailer at all — the original
      // purchase was never forwarded. Create a new Order from the refund
      // email alone rather than leaving it permanently orphaned.
      orderId = await createOrderFromEmail(email.userId, email, returnPortalUrl);
      isRefundFallbackMatch = true;
      refundFallbackNote = `[auto] order created from refund email alone: no prior purchase record for retailer "${email.retailer}"`;
    }
  } else {
    // userId scoping here is load-bearing, not optional: without it, two
    // different users who both happen to shop at the same retailer with a
    // matching order-number format could have their orders merged together,
    // leaking one user's purchase data onto another's dashboard.
    const existing = await prisma.order.findFirst({
      where: {
        userId: email.userId,
        retailer: { equals: email.retailer, mode: "insensitive" },
        orderNumber: { equals: email.orderNumber!, mode: "insensitive" },
      },
    });

    if (existing) {
      matchedOrderDisplayStatus = existing.displayStatus;
      orderId = await mergeEmailIntoOrder(existing, email, returnPortalUrl);
    } else {
      const prefixMatch = await findPrefixMatchOrder(email.userId, email.retailer, email.orderNumber!);

      if (prefixMatch) {
        matchedOrderDisplayStatus = prefixMatch.displayStatus;
        orderId = await mergeEmailIntoOrder(prefixMatch, email, returnPortalUrl);
        isPrefixMatchedOrder = true;
      } else {
        const retailerPrefixMatch = await findRetailerPrefixMatchOrder(
          email.userId,
          email.retailer,
          email.orderNumber!,
        );
        if (retailerPrefixMatch) {
          matchedOrderDisplayStatus = retailerPrefixMatch.displayStatus;
          orderId = await mergeEmailIntoOrder(retailerPrefixMatch, email, returnPortalUrl);
          isPrefixMatchedOrder = true;
          retailerPrefixNote = `[auto] retailer prefix match: "${retailerPrefixMatch.retailer}" ← "${email.retailer}"`;
        } else {
          orderId = await createOrderFromEmail(email.userId, email, returnPortalUrl);
        }
      }
    }
  }

  await prisma.email.update({ where: { id: emailId }, data: { orderId } });
  await applyFallbackOrderDate(orderId);
  await recomputeOrderStatus(orderId);
  await applyShippingTracking(orderId, email);
  await applyReturnTracking(orderId, email);
  await recomputeDisplayStatus(orderId);

  const { isKeptStatusConflict, note: keptConflictNote } = computeKeptStatusConflict(
    matchedOrderDisplayStatus,
    email.emailType,
  );

  // recomputeOrderStatus derives needsReview from data completeness, which
  // would happily clear it the moment the order looks complete — but any
  // prefix match (or refund-fallback match) needs a human to confirm it
  // wasn't two different orders that happened to line up by inference,
  // regardless of how complete the data looks. Force it true after
  // recompute, not before. Also append an audit note to userNote so the
  // merge reason is visible without having to diff order records.
  if (isPrefixMatchedOrder || isRefundFallbackMatch || isKeptStatusConflict) {
    const note = retailerPrefixNote ?? refundFallbackNote ?? keptConflictNote;
    const noteUpdate: { needsReview: boolean; userNote?: string } = { needsReview: true };
    if (note) {
      const merged = await prisma.order.findUnique({ where: { id: orderId }, select: { userNote: true } });
      const prior = merged?.userNote ?? null;
      noteUpdate.userNote = prior ? `${prior}\n${note}` : note;
    }
    await prisma.order.update({ where: { id: orderId }, data: noteUpdate });
  }
}
