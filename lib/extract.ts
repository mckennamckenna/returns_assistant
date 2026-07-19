import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

// Conservative assumption when we only have an order date, no confirmed
// delivery date yet — errs toward a tighter (earlier) deadline. Tightened
// 7 → 5 days 2026-07-15 (Decisions log): a wrong deadline is worse than a
// missing one, so a shorter buffer trades "user occasionally returns a
// few days before they strictly had to" for "never miss the real window."
const STANDARD_SHIPPING_DAYS = 5;

export type Confidence = "high" | "medium" | "low";

export type EmailType =
  | "order_confirmation"
  | "shipping_confirmation"
  | "delivery"
  | "return_label"
  | "refund"
  | "other";

export type PolicySource = "email" | "web_lookup";

export interface LineItem {
  name: string;
  price: number | null;
  quantity: number | null;
}

interface RawExtraction {
  emailType: EmailType;
  retailer: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
  orderTotal: number | null;
  orderCurrency: string | null;
  // Distinct from orderTotal: the dollar figure explicitly identified as
  // the amount being refunded/credited back, not the original purchase
  // price. Retailer refund emails are often vague ("your refund is being
  // processed") — refundAmount stays null unless a specific figure is
  // unambiguously labeled as the refund. Drives the refunded-vs-returned
  // branch in lib/displayStatus.ts: a confirmed amount means the money is
  // actually back, so the order can auto-advance straight to "refunded";
  // no confirmed amount means the retailer only confirmed *something*
  // happened, so the order advances to "returned" instead and the existing
  // refund check-in reminder nudges the user to verify later.
  refundAmount: number | null;
  refundAmountConfidence: Confidence | null; // null iff refundAmount is null
  lineItems: LineItem[];
  // Distinct from ExtractionResult.returnPortalUrl below: this is only
  // ever set when the email itself links to a returns page — the final
  // field falls back to a web lookup when this is null. Named separately
  // so the two sources never get confused in extractEmail's merge logic.
  returnPortalUrlFromEmail: string | null;
  confidence: Confidence;
  // AI-set directly (not derived downstream) — true for: tiered-window
  // detection, low confidence, missing retailer/orderNumber on a commerce
  // email, missing deadline on an order_confirmation, or any ambiguity the
  // AI itself flagged in notes. Non-optional: the AI must always output a
  // value. extractEmail() ORs this with its own JS-side triggers (some of
  // which the AI structurally can't know about, e.g. an extraction
  // exception) rather than trusting it exclusively — see TIERED RETURN
  // WINDOWS below and BUILD.md's Extraction section for the full rationale,
  // including the notesIndicateTieredWindow fallback kept alongside this
  // for one release cycle.
  needsReview: boolean;
  notes: string;
}

export interface ExtractionResult extends RawExtraction {
  // Routed from RawExtraction.deliveryDate by emailType — see
  // routeDeliveryDate below. deliveryDate itself stays on the result
  // unchanged (legacy display fallback).
  estimatedDeliveryDate: string | null;
  deliveredAt: string | null;
  returnDeadline: string | null;
  deadlineIsEstimated: boolean;
  policySource: PolicySource | null;
  returnPortalUrl: string | null;
}

interface PolicyLookupResult {
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
  returnPortalUrl: string | null;
  confidence: Confidence;
  // Same contract as RawExtraction.needsReview above — AI-set directly,
  // primarily for tiered-window detection in the web-lookup context.
  needsReview: boolean;
  notes: string;
}

function buildPrompt(subject: string, textBody: string): string {
  return `You are extracting return/refund-relevant information from a forwarded shopping email.

IMPORTANT: This email was forwarded by the customer, so the From header shows
the customer, not the retailer. Identify the retailer from the email BODY content
only — look for sender names, logos described in text, order confirmation
language, etc.

First, identify the email type. Then extract what's relevant for that type.

EMAIL TYPES:
- "order_confirmation" — confirms a purchase was placed
- "shipping_confirmation" — confirms item has shipped, often has estimated delivery date and tracking
- "delivery" — confirms item was delivered
- "return_label" — contains a return shipping label or link
- "refund" — confirms a refund was issued
- "other" — marketing, promotional, or unrelated

From the email subject and body below, extract:
- emailType (one of the types above)
- retailer (string or null — from body only, NEVER from the subject line or From header)
- orderNumber (string or null — may appear in the subject line OR the body)
- orderDate (ISO date string or null)
- deliveryDate (ISO date string or null — only if explicitly stated; common in shipping confirmations as "estimated delivery")
- returnWindowDays (integer or null — e.g. 30; only if explicitly stated in THIS email)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null — what the window counts from, only if stated)
- orderTotal (number or null — see ORDER TOTAL below)
- orderCurrency (string or null — e.g. "USD", only if determinable)
- refundAmount (number or null — see REFUND AMOUNT below)
- refundAmountConfidence ("high" | "medium" | "low" | null — null iff refundAmount is null; see REFUND AMOUNT below)
- lineItems (array of {name, price, quantity} — see LINE ITEMS below)
- returnPortalUrlFromEmail (string or null — see RETURN POLICY LINK below)
- confidence ("high" | "medium" | "low")
- needsReview (boolean — see NEEDS REVIEW below; always output this, never omit it)
- notes (one sentence: your reasoning, especially any assumption or uncertainty, and call out explicitly if orderTotal was derived by summing line items rather than read directly)

A forwarded shopping email is rarely the ONLY email about that order a
customer will send — but don't assume a follow-up is coming. Extract as
much as this single email actually supports, for every field, regardless
of emailType. Shipping and delivery confirmations are not just
"deliveryDate" emails: retailers very often restate the order total,
the full item list, and the original order date even in a shipping
notification — read the whole body, not just the shipping-specific part.

ORDER TOTAL — look harder before returning null:
- Check for "order total", "total", "amount charged", "amount", "you paid", or a dollar figure positioned near the order number.
- If the email shows a subtotal plus separate charges (shipping, tax, discount) that combine into a total, compute that sum.
- If no total is stated anywhere but individual line items with prices are listed, sum the line item prices as an estimate — and say so in notes. This estimate may not match the real charged total (it can miss tax, shipping, or discounts), so don't report confidence higher than "medium" when the total is derived this way rather than read directly.
- Still NEVER invent a number with no basis in the email at all. Trying harder means reading more carefully and computing sums that are actually present in the text — not guessing.

REFUND AMOUNT — only for the dollar figure explicitly identified as the amount being refunded or credited back, e.g. "You will be refunded $123.05", "Refund total: $45.00", "$29.99 has been credited to your original payment method". This is NOT the same as orderTotal (the original purchase price) — never reuse orderTotal, or any other total in the email, as a stand-in for refundAmount. Retailers are often vague about refunds ("we're processing your refund", "we've received your return") without ever stating a specific dollar figure — when that's all the email says, leave refundAmount null. Set refundAmountConfidence "high" only when the figure is unambiguously labeled as the refund amount; "medium" if it's stated but derived (e.g. summed from several itemized partial refunds) or the labeling is slightly ambiguous; "low" if there's a dollar figure that might be the refund amount but it's genuinely unclear which figure that is. refundAmountConfidence must be null when refundAmount is null.

LINE ITEMS — extract from any email type that lists them, not just order confirmations. Shipping and delivery confirmations frequently list "what's in this shipment" with names and prices — extract those exactly the same way you would from an order confirmation.

ORDER DATE — look for it in shipping and delivery confirmations too, not just order confirmations. Retailers often restate it as "you placed this order on [date]", "order placed: [date]", or similar, even in a shipping notification. Extract it as orderDate whenever it's explicitly stated, regardless of emailType.

RETURN POLICY LINK — if the email contains a link to a returns page, a return policy, a "how to return this item" section, or similar, extract that URL as returnPortalUrlFromEmail. Only extract an actual URL present in the email text — never construct or guess one.

TIERED RETURN WINDOWS — when the email states multiple return windows tiered by item type (full-price vs. sale), refund method (cash refund vs. store credit), sale/promotional status, or any other condition, return the SHORTEST window mentioned as returnWindowDays, regardless of which condition triggers it. Do not attempt to resolve which tier applies to this specific order — that resolution isn't possible from the email alone, and a missed shorter deadline is worse than a redundant earlier reminder. When you do this, append to notes, in exactly this form: "Multiple return windows detected: [list every window with its stated condition]. Selected shortest ([N] days) per policy." If tiering exists but no window can be identified as the shortest with confidence (e.g. every window is stated ambiguously), return returnWindowDays: null, set confidence to "low", and explain the ambiguity in notes instead of guessing.

NEEDS REVIEW — set needsReview to true when ANY of the following apply, false otherwise:
- You detected and resolved a tiered return window (see TIERED RETURN WINDOWS above) — a human should always confirm which tier actually applies to this order.
- confidence is "low".
- This is a commerce email (emailType is not "other") and you couldn't determine retailer or orderNumber.
- emailType is "order_confirmation" and you couldn't determine a return deadline (no returnWindowDays, or nothing to anchor it to).
- You flagged any other genuine ambiguity or uncertainty in notes.
Always output needsReview — never omit it, and never leave it to be inferred from notes alone.

Rules:
- NEVER invent, guess, or infer a date, deadline, policy, price, or item that isn't written in the email (an order-total sum derived from line items that ARE in the email doesn't count as inventing — that's computing from what's there).
- Return null for any field not clearly present. Null + low confidence is always better than a wrong answer.
- Lower confidence whenever you have to infer or compute rather than read something directly.
- If the email is marketing/promotional/unrelated: set emailType to "other", retailer to null, confidence to "low".
- Leave returnWindowDays null if this email doesn't state it — don't guess based on what you know about the retailer. A separate lookup step handles that.
- orderNumber may be read from the subject line (e.g. "A shipment from order #86864 is on the way") as well as from the body. retailer must NEVER be read from the subject or From header — body only.

Respond with ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

EMAIL SUBJECT:
${subject}

EMAIL BODY:
${textBody}`;
}

function buildPolicyLookupPrompt(retailer: string): string {
  return `Search the web for ${retailer}'s current return policy, and the direct page where a customer actually starts a return.

Respond with ONLY valid JSON, no preamble, no markdown formatting:
- returnWindowDays (integer or null — only if you find a clear, specific number of days)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null)
- returnPortalUrl (string or null — the direct URL of the specific page where a customer begins/initiates a return, e.g. a "Returns & Exchanges" or "Start a Return" page. NOT the homepage, NOT a general help-center search page — the actual page for starting a return.)
- confidence ("high" | "medium" | "low")
- needsReview (boolean — see NEEDS REVIEW below; always output this, never omit it)
- notes (one sentence: what you found and roughly where, or why you couldn't find a clear answer)

Rules:
- Only report returnWindowDays if a current, official policy clearly states it.
- Only report returnPortalUrl if you find an actual, specific URL on the retailer's official site for starting a return — never guess or construct a plausible-looking URL from the retailer's domain.
- If official policy states multiple return windows tiered by item type, membership tier, refund method, sale status, or any other condition, report the SHORTEST window as returnWindowDays, regardless of which condition triggers it — do NOT report the standard/default window. Note every window and its condition in notes, in exactly this form: "Multiple return windows detected: [list every window with its stated condition]. Selected shortest ([N] days) per policy." If no window can be identified as the shortest with confidence, return returnWindowDays: null, confidence "low", and explain the ambiguity in notes instead of guessing.
- If you can't find a clear, current policy, return null for returnWindowDays and confidence "low". Never guess.

NEEDS REVIEW — set needsReview to true when you detected and resolved a tiered return window (the primary case here — a human should always confirm which tier applies), OR when confidence is "low", OR when you flagged any other genuine ambiguity in notes. False otherwise. Always output needsReview — never omit it.`;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fenced) return fenced[1];
  // No closing fence found — likely a truncated response. Strip a leading
  // fence marker if present so we can still attempt to parse what we have.
  return text.replace(/^```(?:json)?\s*/, "");
}

function lastTextBlock(content: { type: string; text?: string }[]): string {
  for (let i = content.length - 1; i >= 0; i--) {
    if (content[i].type === "text" && content[i].text) {
      return content[i].text as string;
    }
  }
  return "";
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// A stated delivery date only means a confirmed, already-happened delivery
// when it comes from an actual "delivery" email — every other email type
// (shipping confirmations most commonly) that states one is stating a
// carrier ESTIMATE, not a confirmed delivery, even though the raw
// extraction field (deliveryDate) is the same either way. Routing by
// emailType keeps the AI prompt/schema unchanged and puts the
// estimate-vs-confirmed distinction where a reliable signal already exists
// for it — the model's own emailType classification.
export function routeDeliveryDate(
  emailType: EmailType,
  deliveryDate: string | null,
): { estimatedDeliveryDate: string | null; deliveredAt: string | null } {
  if (!deliveryDate) return { estimatedDeliveryDate: null, deliveredAt: null };
  return emailType === "delivery"
    ? { estimatedDeliveryDate: null, deliveredAt: deliveryDate }
    : { estimatedDeliveryDate: deliveryDate, deliveredAt: null };
}

async function lookupReturnPolicy(retailer: string): Promise<PolicyLookupResult> {
  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1024,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    messages: [{ role: "user", content: buildPolicyLookupPrompt(retailer) } as MessageParam],
  });

  const text = lastTextBlock(message.content as { type: string; text?: string }[]);
  return JSON.parse(stripCodeFence(text));
}

// Priority order for computing returnDeadline:
// 1. returnWindowStartsFrom === "order_date" and orderDate known → anchor
//    on orderDate directly, regardless of any delivery signal. Never
//    estimated — this is the real anchor the policy actually counts from
//    (Amazon's path). Delivery info is irrelevant here and must stay so.
// 1b. returnWindowStartsFrom === null (genuinely unknown/ambiguous — e.g.
//    a web_lookup that couldn't determine the anchor) and orderDate known
//    → also anchor on orderDate directly, same as 1, ignoring delivery
//    signals. Decision (2026-07-15, Decisions log, sidekick-deadline-
//    anchor-mismatch): order-date anchor is always <= delivery-date
//    anchor, so defaulting an unconfirmed anchor to orderDate can never
//    compute a deadline LATER than the true one — the prior behavior
//    (falling through to a delivery-plus-buffer guess, case 4 below) could
//    compute a deadline later than a true order-date-anchored policy,
//    risking a missed window. Mirrors the tiered-window "shortest window
//    wins" precedent. Flagged deadlineIsEstimated (unlike case 1) — the
//    orderDate value itself is real, but which field the window counts
//    from is still an assumption, not a confirmed fact.
// 2. deliveredAt known (a real "delivery" email, not an estimate) → most
//    accurate. Never estimated. (Only reached when returnWindowStartsFrom
//    is the explicit "delivery_date", or orderDate is unknown so case 1b
//    doesn't apply.)
// 3. estimatedDeliveryDate known (a shipping-email carrier ETA, no
//    confirmed delivery yet) → same math, but flagged deadlineIsEstimated
//    — the whole point of this split: a carrier estimate is not a fact.
// 4. orderDate known, no delivery signal at all, returnWindowStartsFrom is
//    the explicit "delivery_date" → estimate a delivery date assuming
//    STANDARD_SHIPPING_DAYS of transit, flagged deadlineIsEstimated.
// 5. returnWindowDays missing, or nothing to anchor on → null, caller sets
//    needsReview.
export function computeDeadline(parsed: {
  orderDate: string | null;
  deliveredAt: string | null;
  estimatedDeliveryDate: string | null;
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
}): {
  returnDeadline: string | null;
  deadlineIsEstimated: boolean;
} {
  const { orderDate, deliveredAt, estimatedDeliveryDate, returnWindowDays, returnWindowStartsFrom } = parsed;

  if (returnWindowDays == null) {
    return { returnDeadline: null, deadlineIsEstimated: false };
  }

  const orderParsed = orderDate ? new Date(orderDate) : null;
  const orderValid = !!orderParsed && !Number.isNaN(orderParsed.getTime());

  const deliveredParsed = deliveredAt ? new Date(deliveredAt) : null;
  const deliveredValid = !!deliveredParsed && !Number.isNaN(deliveredParsed.getTime());

  const estimatedParsed = estimatedDeliveryDate ? new Date(estimatedDeliveryDate) : null;
  const estimatedValid = !!estimatedParsed && !Number.isNaN(estimatedParsed.getTime());

  if (orderValid && (returnWindowStartsFrom === "order_date" || returnWindowStartsFrom == null)) {
    return {
      returnDeadline: addDays(orderParsed!, returnWindowDays).toISOString(),
      deadlineIsEstimated: returnWindowStartsFrom == null,
    };
  }

  if (deliveredValid) {
    return { returnDeadline: addDays(deliveredParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: false };
  }

  if (estimatedValid) {
    return { returnDeadline: addDays(estimatedParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: true };
  }

  if (orderValid) {
    const estimatedDelivery = addDays(orderParsed!, STANDARD_SHIPPING_DAYS);
    return {
      returnDeadline: addDays(estimatedDelivery, returnWindowDays).toISOString(),
      deadlineIsEstimated: true,
    };
  }

  return { returnDeadline: null, deadlineIsEstimated: false };
}

// Pure function — safe to test without DB, mocks, or an API call.
// The AI (both the email-body extraction and the web-search policy lookup)
// sometimes returns a bare domain/path instead of a fully-qualified URL
// (e.g. "on.com/en-us/faq/returns-and-exchanges" — a real extracted value).
// Stored or rendered as-is, the browser treats that as a relative path
// against the current origin and 404s. Call this at every point
// returnPortalUrl enters the DB.
export function normalizeReturnPortalUrl(url: string | null): string | null {
  const trimmed = url?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

// Resolves the returnPortalUrl that will be persisted: the email's own
// stated link wins when present; otherwise falls back to the web-lookup
// result. Exported so this write-path shape — including normalization —
// is testable without calling the Anthropic API.
export function resolveReturnPortalUrlForWrite(
  fromEmail: string | null,
  fromLookup: string | null,
): string | null {
  return normalizeReturnPortalUrl(fromEmail ?? fromLookup);
}

// A handful of ccTLDs that are themselves two labels — without this list,
// naive "last two labels" registrable-domain extraction would misparse
// e.g. "shop.southbankcentre.co.uk" as domain "co.uk" instead of
// "southbankcentre.co.uk". No public-suffix-list dependency for this
// signal-only classifier: anything outside this small hardcoded set fails
// SAFE (falls through to unknown-unverified, an extra review flag on a
// legitimate domain), never toward false trust.
const MULTI_LABEL_TLDS = new Set([
  "co.uk", "org.uk", "me.uk", "ac.uk", "gov.uk",
  "com.au", "net.au", "org.au",
  "co.nz", "co.jp", "co.in", "co.za",
  "com.br", "com.mx",
]);

// The registrable domain (eTLD+1) — never the raw hostname/subdomain
// chain. A hostname like "hannaandersson-cdn.bloomreach.co" contains the
// retailer's name as a subdomain label while the domain that actually
// controls the content is bloomreach.co, a third party; matching on the
// full hostname would grant this the highest trust tier — the same shape
// an attacker domain like "amazon.evil-cdn.com" would exploit. Only the
// registrable domain is ever compared against anything.
function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const lastTwo = labels.slice(-2).join(".");
  return MULTI_LABEL_TLDS.has(lastTwo) ? labels.slice(-3).join(".") : lastTwo;
}

function normalizeForDomainMatch(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Small vetted allowlist of third-party return-management platforms whose
// domains never relate to the retailer's own name by design — checked
// before retailer-domain matching for exactly that reason. Domains marked
// "confirmed live" were observed in this app's own production
// returnPortalUrl data (2026-07-19 diagnostic, retailers: Ruti/Julia Amory
// → loopreturns.com, Old Navy → narvar.com, H&M → parcellab.com, With
// Nothing Underneath → reveni.io, Janie and Jack → letslinc.com). Happy
// Returns and ReBOUND are seeded from public knowledge — named in
// SECURITY_AUDIT.md's M2 finding and TASKS.md's Mango order-number-drift
// history respectively — but not yet confirmed against our own data.
const KNOWN_THIRD_PARTY_PORTAL_DOMAINS = new Set([
  "loopreturns.com", // confirmed live
  "narvar.com", // confirmed live
  "parcellab.com", // confirmed live
  "reveni.io", // confirmed live
  "letslinc.com", // confirmed live
  "happyreturns.com", // seeded, unverified against our own data
  "reboundreturns.com", // seeded, unverified against our own data
]);

export type ReturnPortalTrustTier =
  | "known-third-party-portal"
  | "retailer-own-domain"
  | "web-lookup-sourced"
  | "unknown-unverified";

// A SIGNAL feeding needsReview (SECURITY_AUDIT.md M2), never a hard block —
// legitimate portals and retailer domains must always be classifiable as
// trusted, and returnPortalUrl still renders/opens exactly as it does
// today regardless of tier. Returns null when there's no URL at all — a
// missing link isn't itself suspicious, so it never contributes a tier.
//
// Priority order: known-portal domains are checked first, since by design
// they never relate to the retailer's name; retailer-own-domain requires
// an EXACT match between the normalized retailer name and the registrable
// domain's own label (deliberately not a substring/contains check — a
// short domain label like "on" (on.com, "On (On-Running)") would otherwise
// match almost any retailer name containing those two letters, the same
// short-string collision risk this codebase already guards against
// elsewhere via MIN_PREFIX_MATCH_LENGTH/MIN_RETAILER_PREFIX_LENGTH in
// lib/linkOrder.ts). This means some real retailer-owned domains that
// don't textually match their brand name (Tuckernuck's tnuck.com, On's
// on.com) will land in unknown-unverified instead — an accepted,
// measured trade-off (see the tier-distribution log at the call site),
// not a bug: the failure direction is always an extra review glance on a
// legitimate link, never false trust.
//
// web-lookup-sourced is measurement-only, NOT a security boundary:
// policySource reflects where the return WINDOW came from, not
// necessarily this specific URL — an email can state a portal URL with no
// explicit window (window from lookup, URL still from the
// attacker-influenceable email body), so this tier has a known
// false-negative rate against the actual threat model and must never be
// treated as proof the URL is safe.
export function classifyReturnPortalTrust(
  returnPortalUrl: string | null,
  retailer: string | null,
  policySource: string | null,
): ReturnPortalTrustTier | null {
  if (!returnPortalUrl) return null;

  let hostname: string;
  try {
    hostname = new URL(returnPortalUrl).hostname;
  } catch {
    return "unknown-unverified"; // unparseable — fails safe, never toward trust
  }

  const domain = registrableDomain(hostname);

  if (KNOWN_THIRD_PARTY_PORTAL_DOMAINS.has(domain)) return "known-third-party-portal";

  if (retailer) {
    const sld = domain.split(".")[0] ?? "";
    if (normalizeForDomainMatch(retailer) === normalizeForDomainMatch(sld)) {
      return "retailer-own-domain";
    }
  }

  if (policySource === "web_lookup") return "web-lookup-sourced";

  return "unknown-unverified";
}

// The exact marker both prompts (TIERED RETURN WINDOWS / buildPolicyLookupPrompt)
// are instructed to prepend to notes when they detect and resolve a tiered
// return policy — e.g. "30 days full-price, 14 days sale." Neither
// RawExtraction nor PolicyLookupResult's JSON schema has a needsReview
// field of its own (that boolean has always been computed downstream in
// extractEmail, never read from the AI's own output), so notes is the one
// existing place this signal can travel without widening either schema.
export const TIERED_WINDOW_NOTE_MARKER = "Multiple return windows detected";

// Whether a notes string indicates the AI detected and resolved (not just
// flagged as ambiguous) a tiered return policy — the AI already reports
// the shortest window when it hits this case, but the choice of tier
// always needs a human to confirm against this specific order, so this
// forces needsReview regardless of otherwise-high confidence. Exported so
// extractEmail's needsReview computation and this file's tests share one
// detection point instead of two copies of the same string check.
export function notesIndicateTieredWindow(notes: string): boolean {
  return notes.includes(TIERED_WINDOW_NOTE_MARKER);
}

// Combines the AI's own needsReview signal (both the email-body and
// web-lookup paths — see the NEEDS REVIEW prompt rule in buildPrompt and
// buildPolicyLookupPrompt) with the existing JS-side triggers this project
// has always computed independently. The JS-side triggers remain because
// some of them structurally can't be known by the AI at response time
// (e.g. a missing return deadline is only knowable after computeDeadline
// runs, downstream of the AI's own JSON). notesIndicateTieredWindow is
// included as a fallback, not the primary signal — belt-and-suspenders for
// one release cycle in case the AI ever fails to set needsReview itself on
// a tiered-window case; see BUILD.md's Extraction section and TASKS.md for
// the removal plan. Exported so extractEmail's computation and this file's
// tests share one implementation instead of two copies of the same logic.
export function computeNeedsReview(params: {
  aiNeedsReview: boolean;
  lookupNeedsReview: boolean;
  confidence: Confidence;
  emailType: EmailType;
  retailer: string | null;
  orderNumber: string | null;
  returnDeadline: string | null;
  policyLookupWasUnclear: boolean;
  notes: string;
}): boolean {
  const isCommerceEmail = params.emailType !== "other";
  return (
    params.aiNeedsReview ||
    params.lookupNeedsReview ||
    params.confidence === "low" ||
    (isCommerceEmail && (params.retailer == null || params.orderNumber == null)) ||
    (params.emailType === "order_confirmation" && params.returnDeadline == null) ||
    params.policyLookupWasUnclear ||
    notesIndicateTieredWindow(params.notes)
  );
}

export async function extractEmail(textBody: string, subject: string | null): Promise<ExtractionResult> {
  const message = await anthropic.messages.create({
    model: MODEL,
    // Orders with many line items can produce long responses — 1024 was
    // truncating mid-JSON for orders with a dozen+ items.
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(subject ?? "(no subject)", textBody) }],
  });

  const text = lastTextBlock(message.content as { type: string; text?: string }[]);
  const parsed: RawExtraction = JSON.parse(stripCodeFence(text));

  let policySource: PolicySource | null = null;
  let policyLookupWasUnclear = false;
  let lookupNeedsReview = false;
  const returnPortalUrlFromEmail: string | null = parsed.returnPortalUrlFromEmail ?? null;
  let returnPortalUrlFromLookup: string | null = null;

  if (parsed.returnWindowDays != null) {
    policySource = "email";
  } else if (parsed.retailer) {
    try {
      const lookup = await lookupReturnPolicy(parsed.retailer);
      returnPortalUrlFromLookup = lookup.returnPortalUrl;

      if (lookup.returnWindowDays != null && lookup.confidence !== "low") {
        parsed.returnWindowDays = lookup.returnWindowDays;
        parsed.returnWindowStartsFrom = lookup.returnWindowStartsFrom;
        policySource = "web_lookup";
        parsed.notes = `${parsed.notes} Return policy from web lookup: ${lookup.notes}`;
        // The lookup's own needsReview flag (primarily tiered-window
        // detection — see buildPolicyLookupPrompt's NEEDS REVIEW rule)
        // only matters in this accepted branch: the "unclear" branch below
        // already forces needsReview via policyLookupWasUnclear regardless.
        lookupNeedsReview = lookup.needsReview;
      } else {
        policyLookupWasUnclear = true;
        parsed.notes = `${parsed.notes} Web lookup for return policy was unclear: ${lookup.notes}`;
      }
    } catch (error) {
      console.error("Return policy web lookup failed for", parsed.retailer, error);
      policyLookupWasUnclear = true;
    }
  }

  const { estimatedDeliveryDate, deliveredAt } = routeDeliveryDate(parsed.emailType, parsed.deliveryDate);
  const { returnDeadline, deadlineIsEstimated } = computeDeadline({
    orderDate: parsed.orderDate,
    deliveredAt,
    estimatedDeliveryDate,
    returnWindowDays: parsed.returnWindowDays,
    returnWindowStartsFrom: parsed.returnWindowStartsFrom,
  });
  const returnPortalUrl = resolveReturnPortalUrlForWrite(returnPortalUrlFromEmail, returnPortalUrlFromLookup);

  const needsReview = computeNeedsReview({
    aiNeedsReview: parsed.needsReview,
    lookupNeedsReview,
    confidence: parsed.confidence,
    emailType: parsed.emailType,
    retailer: parsed.retailer,
    orderNumber: parsed.orderNumber,
    returnDeadline,
    policyLookupWasUnclear,
    notes: parsed.notes,
  });

  return {
    ...parsed,
    estimatedDeliveryDate,
    deliveredAt,
    returnDeadline,
    deadlineIsEstimated,
    policySource,
    returnPortalUrl,
    needsReview,
  };
}
