import type { Order, Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { computeDeadline, normalizeReturnPortalUrl, classifyReturnPortalTrust } from "@/lib/extract";
import { decrypt } from "@/lib/crypto";
import { resolveBodyText } from "@/lib/emailBodyText";
import { deriveDisplayStatus, buildStatusTransitionData } from "@/lib/displayStatus";
import { parseTrackingResolved } from "@/lib/trackingParser";
import { shouldAutoJunk } from "@/lib/junk";
import { isFoodGroceryRetailer } from "@/lib/foodGroceryExclusion";
import { activeOrderFilter } from "@/lib/orderFilters";
import { OPEN_STATUSES } from "@/lib/alerts";
import { logActionWithRetry } from "@/lib/actionLog";

// Narrow field sets for functions that take a full Email but only read a
// handful of fields — lets their callers `select` instead of fetching whole
// rows (Email carries encrypted textBody/htmlBody/rawJson, avg ~438KB/row
// combined; see TASKS.md's missing-select-email-order-queries entry). A
// full `Email` object still satisfies these structurally, so existing
// full-row callers are unaffected.
type MergeableEmail = Pick<
  Email,
  | "lineItems"
  | "emailType"
  | "orderDate"
  | "anchorDate"
  | "deliveryDate"
  | "estimatedDeliveryDate"
  | "deliveredAt"
  | "returnWindowDays"
  | "returnWindowStartsFrom"
  | "policySource"
  | "orderCurrency"
  | "orderTotal"
>;
type NewOrderEmail = Pick<
  Email,
  | "retailer"
  | "orderNumber"
  | "emailType"
  | "orderDate"
  | "anchorDate"
  | "deliveryDate"
  | "estimatedDeliveryDate"
  | "deliveredAt"
  | "returnWindowDays"
  | "returnWindowStartsFrom"
  | "returnDeadline"
  | "deadlineIsEstimated"
  | "policySource"
  | "orderTotal"
  | "orderCurrency"
  | "lineItems"
>;
type TrackingEmail = Pick<Email, "emailType" | "textBody" | "htmlBody">;

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
  if (source === "amazon_default") return "amazon_default";
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
// proxy from it.
//
// Since ANCHOR_DATE_RESOLVER.md (2026-07-25): if that email was processed
// by the anchor resolver at ingestion (forwardType is non-null), its
// precomputed anchorDate is the single source of truth — including null,
// which means the resolver genuinely could not confirm a date on a manual
// forward and deliberately did not invent one. Falling back to receivedAt
// in that case would silently reintroduce exactly the invented-date
// problem the resolver exists to close, so this function must NOT do that
// for a resolver-processed row.
//
// For a row that predates the resolver (forwardType is null — never
// classified, not the same as "manual"), keep the original two-tier
// behavior unchanged, so existing orders don't regress the day this ships:
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
// This pre-resolver path is expected to fade out naturally as old rows
// stop being anyone's earliest-linked email; no backfill is planned.
//
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
    select: { forwardType: true, anchorDate: true, textBody: true, htmlBody: true, receivedAt: true },
  });
  if (!earliestEmail) return null;

  if (earliestEmail.forwardType != null) {
    return earliestEmail.anchorDate;
  }

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
      // TASKS.md 2026-08-27, diagnosis commit 179389e — marks this value
      // as a heuristic guess (earliest-linked email's receivedAt/anchorDate),
      // not a stated fact, so mergeEmailIntoOrder's provenance-aware rule
      // knows it's still correctable by a later, genuinely-extracted date.
      orderDateSource: "fallback",
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

// DELIVERED_BADGE_DESIGN_20260827.md Option A. deriveDisplayStatus advances
// displayStatus to "delivered" off emailTypes.includes("delivery") alone
// (2026-07-23 AquaTru fix) even when no date was extractable from the
// email body — but lib/orderCardState.ts's computeOrderCardState
// deliberately does NOT trust displayStatus for the awaiting_delivery/
// returnable split, only deliveredAt (comment "O7" — the two are meant to
// stay independently-computed so they can never disagree at runtime). That
// leaves deliveredAt permanently null on exactly the AquaTru-shaped order,
// so the card badge stays stuck on "Arrives" forever even after
// displayStatus already says delivered. This backfills deliveredAt from
// the delivery email's forward-resolver anchorDate (lib/forwardResolver.ts,
// shipped 2026-07-26) — but ONLY when that email is a Gmail auto-forward
// (forwardType === "auto"). Design doc confirmed this is safe because (a)
// auto-forward anchorDate IS receivedAt in every observed case (Gmail's
// auto-forward mechanism exposes no separate original-send header to
// prefer instead), and (b) the owner's stated assumption that a retailer's
// "delivered" notification goes out same-day, so receivedAt is a
// trustworthy proxy for the actual delivery date. Deliberately excluded:
// manual forwards (forwardType === "manual" or null/unclassified) — a
// manual forward's receivedAt/anchorDate can lag real delivery by hours to
// weeks (whenever the user got around to clicking Forward), so it is NOT a
// safe deliveredAt proxy. That's fallback B territory (design doc), not
// handled here — a manual-forward delivery email with no body date leaves
// deliveredAt null, same as today. Do not widen this to non-auto forwards
// without a fresh design pass.
// Pure — no DB. Picks the deliveredAt value recomputeDisplayStatus should
// backfill, or null to leave deliveredAt untouched. Extracted from the
// caller's DB fetch so this decision (the actual Option A logic) is
// testable without mocking Prisma, same pattern as deriveDisplayStatus.
// If an order somehow has more than one qualifying auto-forward delivery
// email (re-delivery, multiple packages), the earliest anchorDate wins —
// the first confirmed delivery event, not the most recently processed one.
export function resolveDeliveredAtBackfill(
  emails: { emailType: string | null; forwardType: string | null; deliveryDate: Date | null; anchorDate: Date | null }[],
  currentDeliveredAt: Date | null,
): Date | null {
  if (currentDeliveredAt !== null) return null; // never overwrite an existing value

  const candidates = emails
    .filter(
      (e) => e.emailType === "delivery" && e.forwardType === "auto" && e.deliveryDate === null && e.anchorDate !== null,
    )
    .map((e) => e.anchorDate as Date)
    .sort((a, b) => a.getTime() - b.getTime());

  return candidates[0] ?? null;
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
    select: { displayStatus: true, returnedAt: true, archivedAt: true, deliveredAt: true },
  });
  const emails = await prisma.email.findMany({
    where: { orderId },
    select: {
      emailType: true,
      refundAmount: true,
      refundAmountConfidence: true,
      forwardType: true,
      deliveryDate: true,
      anchorDate: true,
    },
  });
  const emailTypes = emails.map((e) => e.emailType).filter((t): t is string => t != null);
  const hasConfirmedRefundAmount = emails.some(
    (e) => e.emailType === "refund" && e.refundAmount != null && e.refundAmountConfidence !== "low",
  );
  const next = deriveDisplayStatus(emailTypes, order.displayStatus, hasConfirmedRefundAmount, order.deliveredAt);
  const deliveredAtBackfill = resolveDeliveredAtBackfill(emails, order.deliveredAt);

  if (next !== order.displayStatus || deliveredAtBackfill !== null) {
    const data: Record<string, unknown> =
      next !== order.displayStatus
        ? buildStatusTransitionData(next, { returnedAt: order.returnedAt, archivedAt: order.archivedAt })
        : {};
    if (deliveredAtBackfill !== null) data.deliveredAt = deliveredAtBackfill;
    await prisma.order.update({ where: { id: orderId }, data });
  }
}

// Multi-shipment detector (TASKS.md 2026-09-04, watching-mode only). Records
// an ActionLog marker the first time a second shipping_confirmation lands
// for an order with a tracking number that differs from the one already
// stored — applyShippingTracking below is "first tracking wins" and
// silently drops every later shipment's tracking info, so this is the only
// place that later info is ever visible at all. Deliberately just a log
// row: no schema field, no displayStatus change, no return-window impact —
// this exists purely to make the affected population queryable
// (`SELECT DISTINCT "orderId" FROM "ActionLog" WHERE action =
// 'multi_shipment_detected'`) once multi-shipment orders get a real spec.
// A missing tracking number on either side does NOT count as a difference
// (can't distinguish "second box" from "carrier info just didn't parse").
// Idempotent: guards on an existing marker row for this order before
// inserting another, so reprocessing the same email never double-logs.
export async function detectMultiShipment(
  orderId: string,
  userId: string | null,
  existingTrackingNumber: string | null,
  newTrackingNumber: string | null,
): Promise<void> {
  if (!existingTrackingNumber || !newTrackingNumber) return;
  if (existingTrackingNumber === newTrackingNumber) return;

  const alreadyLogged = await prisma.actionLog.findFirst({
    where: { orderId, action: "multi_shipment_detected" },
    select: { id: true },
  });
  if (alreadyLogged) return;

  await logActionWithRetry({
    orderId,
    userId,
    action: "multi_shipment_detected",
    outcome: "success",
    ipAddress: null,
    userAgent: null,
  });
}

// Scrapes carrier/trackingNumber/trackingUrl from a shipping_confirmation email
// body and writes them to the order. Skips if the order already has tracking
// info (from an earlier shipping email) or if the email is not a shipping_confirmation.
async function applyShippingTracking(orderId: string, email: TrackingEmail): Promise<void> {
  if (email.emailType !== "shipping_confirmation") return;

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { trackingNumber: true, userId: true },
  });

  const textBody = email.textBody ? decrypt(email.textBody) : null;
  const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
  const tracking = parseTrackingResolved(textBody, htmlBody);

  await detectMultiShipment(orderId, existing?.userId ?? null, existing?.trackingNumber ?? null, tracking.trackingNumber);

  if (existing?.trackingNumber) return;

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
async function applyReturnTracking(orderId: string, email: TrackingEmail): Promise<void> {
  if (email.emailType !== "return_label") return;

  const existing = await prisma.order.findUnique({
    where: { id: orderId },
    select: { returnTrackingNumber: true },
  });
  if (existing?.returnTrackingNumber) return;

  const textBody = email.textBody ? decrypt(email.textBody) : null;
  const htmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
  const tracking = parseTrackingResolved(textBody, htmlBody);

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

export type OrderMatchType = "exact" | "prefix" | "retailer_prefix";

export interface OrderMatch {
  order: Order;
  matchType: OrderMatchType;
}

// Deterministic orderNumber-based matching only — exact, then order-number
// prefix, then retailer-prefix. Does NOT cover the orphaned-refund
// (line-item/amount) fallback below — deliberately out of scope for the
// new caller (runExtraction.ts's policy-lookup pre-check, TASKS.md
// 2026-08-24): that fuzzy-match logic is under active investigation
// elsewhere (Caroline's RealReal item, 🔴 Now) and this fix shouldn't
// silently ride on it while it's under scrutiny.
// userId scoping on every query is load-bearing — see the same note on
// the exact-match query below, previously inlined in linkEmailToOrder.
export async function findMatchingOrder(
  userId: string,
  retailer: string,
  orderNumber: string,
): Promise<OrderMatch | null> {
  const exact = await prisma.order.findFirst({
    where: {
      userId,
      retailer: { equals: retailer, mode: "insensitive" },
      orderNumber: { equals: orderNumber, mode: "insensitive" },
    },
  });
  if (exact) return { order: exact, matchType: "exact" };

  const prefixMatch = await findPrefixMatchOrder(userId, retailer, orderNumber);
  if (prefixMatch) return { order: prefixMatch, matchType: "prefix" };

  const retailerPrefixMatch = await findRetailerPrefixMatchOrder(userId, retailer, orderNumber);
  if (retailerPrefixMatch) return { order: retailerPrefixMatch, matchType: "retailer_prefix" };

  return null;
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

// CURRENTLY UNUSED — not wired into the picker or detectEmailReviewReason
// (2026-08-31). Built and tested in Stage 3 for the shipment_unlinked
// ticket's Part 4a (filtering LinkToOrderPicker's candidate list to
// same-retailer, open orders), but Part 4a was scoped and then deferred
// same session — it needs real prop-drilling / shared-state work across
// app/(app)/page.tsx, app/(app)/needs-review/page.tsx,
// app/NeedsReviewBucket.tsx, and app/NeedsReviewRow.tsx that the ticket
// chose not to take on in this pass (Stage 4 shipped only Part 4b, the
// picker's create-new escape hatch, which doesn't call this function at
// all). See TASKS.md 👀 Watching for the deferred-work entry. This
// function and its tests (__tests__/linkOrder.test.ts) are ready to wire
// up whenever that work picks up — don't re-derive the matching rule from
// scratch, the reasoning below is still current.
//
// Retailer-scoped merge-candidate matcher for the shipment_unlinked
// population (TASKS.md 🔴 Now, "Rename + expand carrier_tracking_unlinked
// -> shipment_unlinked", Stage 3, 2026-08-30) — a delivery/shipping_
// confirmation/order_confirmation email with a known retailer but no order
// number to match on. Deliberately dumb, unlike findRefundFallbackOrder
// above: no line-item/total tiers, no date window, no recency tiebreak —
// just userId + case-insensitive exact retailer match (same convention as
// findRefundFallbackOrder's own query above) + open/in-flight status
// (activeOrderFilter + OPEN_STATUSES, lib/alerts.ts — "statuses where
// starting a return is still a meaningful, available action," the closest
// existing convention to "open/in-flight" for the Order.status field;
// findMatchingOrder/findRefundFallbackOrder don't filter by status at all,
// since they rely on precise orderNumber/line-item signals instead — no
// precedent to follow there). If this ever needs a fuzzy tier, that's a
// new decision, not an extension of this function — stop and flag first.
//
// Terminal-state orders (returned, refunded, cancelled — everything
// outside OPEN_STATUSES) are DELIBERATELY excluded, owner decision
// 2026-08-30: a newly-arriving shipment could in principle belong to an
// already-returned/refunded order (e.g. a second box of a split shipment
// arriving late), but done orders should stay done from the app's
// perspective, and surfacing a user's full retail history in this picker
// — rather than just what's still open — would be a real UX cost for the
// common case to guard a rare one. If this needs revisiting, that's a new
// decision, not a silent widening of OPEN_STATUSES.
//
// Deliberately DOES include null-orderNumber shell orders (owner
// requirement, 2026-08-30): retailer-only matching has no orderNumber to
// collide on, and this is the only manual recovery path today for the
// finding-5 sibling bug (a shell order from "Start a new order" on an
// unlinked shipment is otherwise invisible to every auto-matcher above,
// forever). A freshly-created shell defaults to status "ordered" (schema
// default) and gets recomputed via recomputeOrderStatus right after
// creation (lib/orderReview.ts's createOrderFromOrphanedEmail) — lands on
// "ordered" or "returnable" either way, both inside OPEN_STATUSES, so no
// special-casing is needed for shells to qualify here.
//
// Returns [] (never null, never throws) when there's no candidate — the
// intended caller (whenever Part 4a's filter wiring lands) should treat an
// empty array as "show the create-new escape hatch with nothing above
// it," not an error case.
export async function findShipmentMergeCandidates(userId: string, retailer: string): Promise<Order[]> {
  return prisma.order.findMany({
    where: {
      userId,
      retailer: { equals: retailer, mode: "insensitive" },
      ...activeOrderFilter,
      status: { in: OPEN_STATUSES },
    },
  });
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
async function resolveOrderTotal(existing: Order, email: Pick<Email, "emailType" | "orderTotal">): Promise<number | null> {
  if (email.emailType === "order_confirmation") {
    return email.orderTotal ?? existing.orderTotal;
  }

  const confirmation = await prisma.email.findFirst({
    where: { orderId: existing.id, emailType: "order_confirmation", orderTotal: { not: null } },
    select: { orderTotal: true },
  });
  if (confirmation) {
    return confirmation.orderTotal;
  }

  return email.orderTotal ?? existing.orderTotal;
}

// TASKS.md 2026-08-27, diagnosis commit 179389e — the two-tier "extracted"
// signal shared by every orderDate write site (createOrderFromEmail,
// mergeEmailIntoOrder, rebuildOrderFromRemainingEmails's seed write).
// Priority 1: the AI's own extracted orderDate field — a real, body-stated
// date. Priority 2, order_confirmation ONLY: the forward resolver's
// anchorDate (lib/forwardResolver.ts), when the AI found no explicit date
// in the body but the email's own send/forward timestamp is available —
// this is what actually fixes the Zara #54421192781 shape (a manually-
// forwarded order_confirmation whose real date lived only in the
// forwarded-header-parsed anchorDate, never in the AI's orderDate field).
// Deliberately NOT extended to shipping_confirmation/delivery — read-only
// investigation (same date) found priority 2 alone already covers roughly
// as many orders as priority 1, while broadening to ship/deliver anchorDate
// was only explored as an unvalidated hypothesis (would additionally fix
// Shopbop #143429832, but wasn't decided on) — left for a future session,
// not silently adopted here.
function resolveExtractedOrderDate(email: Pick<MergeableEmail, "emailType" | "orderDate" | "anchorDate">): Date | null {
  return email.orderDate ?? (email.emailType === "order_confirmation" ? email.anchorDate : null);
}

// Shared by the exact-match, order-number-prefix-match, and retailer-prefix-match
// paths: an existing Order gets enriched with whatever the new email adds, never
// blindly overwritten. Exported so the backfill script can call it directly,
// bypassing the normal match step entirely.
//
// orderDate is PROVENANCE-AWARE, not plain write-once (changed 2026-08-27,
// TASKS.md "orderDate write-once locks in the wrong email's date",
// diagnosis commit 179389e — see prisma/schema.prisma's orderDateSource
// comment for the full field definition). Plain write-once ("once set,
// never move again, regardless of type") was itself a deliberate fix for a
// real bug (2026-08-16: a shipping order's own delivery email arriving
// after its order_confirmation and silently replacing a correct date with
// a wrong later one) — but it went too far the other direction: it also
// permanently locked in a HEURISTIC guess (applyFallbackOrderDate's
// earliest-linked-email fallback) with no way for a later, genuinely
// AI-extracted date to ever correct it. Zara #54421192781 is the
// concrete case: its delivery email happened to be the first one
// successfully linked (the two earlier shipping_confirmations were
// orphaned until a retailer-identification fix reconciled them days
// later), so the fallback wrote the delivery email's own receivedAt as
// orderDate — and the real order_confirmation, arriving over a week
// later with the correct date actually stated in its body, could never
// overwrite it.
//
// The fix distinguishes WHY the current value is what it is, not just
// THAT it's set:
//   - orderDateSource "extracted": a genuine per-email date signal — see
//     resolveExtractedOrderDate above (the AI's own orderDate field, or,
//     order_confirmation only, the forward resolver's anchorDate). Never
//     overwritten by anything, regardless of the incoming email's type.
//     This is what still protects the 2026-08-16 case (a later shipping/
//     delivery email's extracted date, if it had one, could not replace
//     an order_confirmation's).
//   - orderDateSource "fallback" or "unknown" (row predates this field):
//     just a heuristic guess or undetermined provenance — not actually
//     confirmed correct, so a genuinely extracted date is allowed to
//     replace it, ESTABLISHING or OVERWRITING alike.
//
// Both the establishing and overwriting cases still go through the SAME
// ALLOWED_FALLBACK_EMAIL_TYPES type gate as before (order_confirmation,
// shipping_confirmation, delivery only) — deliberately kept, not dropped,
// despite lib/extract.ts's own extraction prompt looking for a stated
// order date across every email type. This protects a second, separate,
// already-fixed incident: J.Crew #2523415500, a lone REFUND email
// creating an order whose orderDate got set to the refund's own
// (irrelevant) extracted date, because nothing else had ever linked to
// establish a real one first (see __tests__/linkOrder.test.ts, "a refund
// email never establishes orderDate when nothing has set it yet"). That
// protection predates and is independent of this session's fix — do not
// remove it while working on the orderDate-provenance logic; a refund/
// return_label/other-typed email's own extracted orderDate is real
// extraction, per lib/extract.ts, but has no reliable relationship to
// order-placement time (same reasoning that already excludes those types
// from applyFallbackOrderDate's separate receivedAt-based fallback below).
export async function mergeEmailIntoOrder(existing: Order, email: MergeableEmail, returnPortalUrl: string | null): Promise<string> {
  const emailLineItems = asLineItemArray(email.lineItems);
  const existingOrderDateSource = existing.orderDateSource ?? "unknown";
  const isEstablishingEmailType = ALLOWED_FALLBACK_EMAIL_TYPES.has(email.emailType ?? "");
  const canOverwriteOrderDate = existingOrderDateSource !== "extracted" && isEstablishingEmailType;
  const extractedOrderDate = resolveExtractedOrderDate(email);
  const orderDateWillChange = extractedOrderDate != null && canOverwriteOrderDate;
  const mergedOrderDate = orderDateWillChange ? extractedOrderDate : existing.orderDate;
  const mergedOrderDateSource = orderDateWillChange ? "extracted" : existingOrderDateSource;
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
      orderDateSource: mergedOrderDateSource,
      // Clears whenever orderDate actually changes to a genuinely
      // extracted value this merge (orderDateWillChange) — a real stated
      // date, not inferred, so orderDateEstimated should read false from
      // that point on, whether this is the FIRST time orderDate was ever
      // set or a later correction of a fallback guess. Otherwise
      // (orderDate isn't moving, or it's already "extracted" and staying
      // put) the existing flag is left exactly as it was.
      orderDateEstimated: orderDateWillChange ? false : existing.orderDateEstimated,
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
  email: NewOrderEmail,
  returnPortalUrl: string | null,
): Promise<string> {
  const extractedOrderDate = resolveExtractedOrderDate(email);
  const created = await prisma.order.create({
    data: {
      userId,
      retailer: email.retailer,
      orderNumber: email.orderNumber,
      orderDate: extractedOrderDate,
      // TASKS.md 2026-08-27 ("orderDate write-once locks in the wrong
      // email's date"), diagnosis commit 179389e. The triggering email's
      // own extracted signal (AI orderDate, or — for an order_confirmation
      // only — the forward resolver's anchorDate, per
      // resolveExtractedOrderDate above) is authoritative ("extracted") —
      // leave orderDateSource unset (falls to the schema default,
      // 'unknown') when there's no extracted value yet, since
      // applyFallbackOrderDate (called immediately after this, in
      // linkEmailToOrder) will set both orderDate and
      // orderDateSource:"fallback" together if its heuristic fires. Never
      // write "fallback" here directly — that would be a lie if
      // applyFallbackOrderDate's own allowed-type gate then declines to
      // fire for this email's type.
      orderDateSource: extractedOrderDate ? "extracted" : undefined,
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
  const emails = await prisma.email.findMany({
    where: { orderId },
    orderBy: { receivedAt: "asc" },
    select: {
      orderDate: true,
      anchorDate: true,
      deliveryDate: true,
      estimatedDeliveryDate: true,
      deliveredAt: true,
      returnWindowDays: true,
      returnWindowStartsFrom: true,
      returnDeadline: true,
      deadlineIsEstimated: true,
      policySource: true,
      orderTotal: true,
      orderCurrency: true,
      lineItems: true,
      emailType: true,
    },
  });
  if (emails.length === 0) return;

  const [first, ...rest] = emails;
  const firstExtractedOrderDate = resolveExtractedOrderDate(first);
  await prisma.order.update({
    where: { id: orderId },
    data: {
      orderDate: firstExtractedOrderDate,
      // Same reasoning as createOrderFromEmail (TASKS.md 2026-08-27,
      // diagnosis commit 179389e) — this seed write must set
      // orderDateSource too, or it would stay whatever it was before the
      // rebuild while orderDate itself resets to `first`'s value, leaving
      // the two permanently mismatched and mergeEmailIntoOrder's
      // provenance-aware rule below (called for `rest`) working off a
      // stale premise.
      orderDateSource: firstExtractedOrderDate ? "extracted" : "unknown",
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
  const email = await prisma.email.findUnique({
    where: { id: emailId },
    // Everything this function (and everything it calls: mergeEmailIntoOrder,
    // createOrderFromEmail, applyShippingTracking/applyReturnTracking,
    // resolveOrderTotal, findRefundFallbackOrder) actually reads off `email`.
    // Deliberately excludes rawJson/fromEmail/fromName/subject — this ran on
    // every non-pre-junked inbound email with no select before, the single
    // largest ingestion-path contributor to the Neon bandwidth-quota
    // incident (see TASKS.md's missing-select-email-order-queries entry).
    select: {
      retailer: true,
      orderNumber: true,
      userId: true,
      emailType: true,
      junkedAt: true,
      lineItems: true,
      orderTotal: true,
      orderCurrency: true,
      policySource: true,
      orderDate: true,
      anchorDate: true,
      deliveryDate: true,
      estimatedDeliveryDate: true,
      deliveredAt: true,
      returnWindowDays: true,
      returnWindowStartsFrom: true,
      returnDeadline: true,
      deadlineIsEstimated: true,
      textBody: true,
      htmlBody: true,
    },
  });
  if (!email) return;

  // Retailer-name backstop (Food + grocery delivery exclusion, TASKS.md
  // 🔴 Now, 2026-08-18) — Amazon Fresh / Whole Foods Market arrive from
  // Amazon's generic order-update@amazon.com, so they can't be caught by
  // the sender-domain pre-junk in shouldAutoJunk (lib/junk.ts) without
  // also junking every real Amazon order. Checked here instead, on the
  // retailer name extraction already resolved, before any order-matching
  // or order-creation logic below runs — a match never reaches an Order.
  // Idempotency guard mirrors the orphaned-"other" branch further down:
  // never overwrite an existing junkedAt.
  if (isFoodGroceryRetailer(email.retailer)) {
    if (email.junkedAt == null) {
      await prisma.email.update({ where: { id: emailId }, data: { junkedAt: new Date() } });
    }
    return;
  }

  // A refund email with no order number (Bugs 9+10: Shopbop and H&M both
  // did this) still gets a shot at linking via findRefundFallbackOrder
  // below, instead of the blanket needsReview-and-stop every other
  // email type gets when orderNumber is missing. Scoped strictly to
  // emailType === "refund" — this does not loosen the orderNumber
  // requirement for order_confirmation/shipping_confirmation/delivery/
  // return_label emails, which still need one.
  const isOrphanedRefund = email.emailType === "refund" && !!email.retailer && !email.orderNumber;

  if (!email.retailer || (!email.orderNumber && !isOrphanedRefund)) {
    // This branch is the only place an email can end up orphaned
    // (orderId stays null) — the only point shouldAutoJunk (lib/junk.ts)
    // can ever fire from. Confirmed-non-commerce (emailType === "other")
    // gets auto-filed here, no user action; needsReview stays true
    // underneath either way, so a rescue (lib/junk.ts's rescueEmail)
    // restores it to exactly the same "orphaned, needs review" state it
    // would have had without junking — junkedAt is a visibility layer on
    // top of that state, not a replacement for it.
    const junkedAt = shouldAutoJunk({ emailType: email.emailType, orderId: null }) ? new Date() : undefined;
    await prisma.email.update({
      where: { id: emailId },
      data: { needsReview: true, ...(junkedAt ? { junkedAt } : {}) },
    });
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
    // leaking one user's purchase data onto another's dashboard. Enforced
    // inside findMatchingOrder (lib/linkOrder.ts) on every query.
    const match = await findMatchingOrder(email.userId, email.retailer, email.orderNumber!);

    if (match) {
      matchedOrderDisplayStatus = match.order.displayStatus;
      orderId = await mergeEmailIntoOrder(match.order, email, returnPortalUrl);
      if (match.matchType === "prefix") {
        isPrefixMatchedOrder = true;
      } else if (match.matchType === "retailer_prefix") {
        isPrefixMatchedOrder = true;
        retailerPrefixNote = `[auto] retailer prefix match: "${match.order.retailer}" ← "${email.retailer}"`;
      }
    } else {
      orderId = await createOrderFromEmail(email.userId, email, returnPortalUrl);
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

  // M2 (SECURITY_AUDIT.md) — a SIGNAL feeding needsReview, never a hard
  // block; returnPortalUrl still renders/opens exactly as before regardless
  // of tier. Count-only log, no URL/retailer/order id — matches this
  // project's existing count-level-only logging convention (see BUILD.md's
  // privacy invariants) and specifically avoids ever logging a full
  // returnPortalUrl, some of which carry PII in their query string (a real
  // observed case: a Linc return-tracking URL embedding the user's email
  // address). Reason text is NOT written here — lib/orderReview.ts's
  // reviewReasonLabel() re-derives it live from the order's own
  // returnPortalUrl/retailer at render time (see that file's comment for
  // why this one's reason doesn't need a stored field, unlike the
  // point-in-time facts above).
  const portalTrustTier = classifyReturnPortalTrust(returnPortalUrl, email.retailer, email.policySource);
  console.log("[M2 portal-trust tier]", portalTrustTier ?? "none");
  const isPortalUntrusted = portalTrustTier === "unknown-unverified";

  // recomputeOrderStatus derives needsReview from data completeness, which
  // would happily clear it the moment the order looks complete — but any
  // prefix match (or refund-fallback match) needs a human to confirm it
  // wasn't two different orders that happened to line up by inference,
  // regardless of how complete the data looks. Force it true after
  // recompute, not before. Also append an audit note to userNote so the
  // merge reason is visible without having to diff order records.
  if (isPrefixMatchedOrder || isRefundFallbackMatch || isKeptStatusConflict || isPortalUntrusted) {
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
