import Anthropic from "@anthropic-ai/sdk";
import type { MessageParam } from "@anthropic-ai/sdk/resources/messages";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

// Conservative assumption when we only have an order date, no confirmed
// delivery date yet — errs toward a tighter (earlier) deadline.
const STANDARD_SHIPPING_DAYS = 7;

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
  needsReview: boolean;
}

interface PolicyLookupResult {
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
  returnPortalUrl: string | null;
  confidence: Confidence;
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
- notes (one sentence: what you found and roughly where, or why you couldn't find a clear answer)

Rules:
- Only report returnWindowDays if a current, official policy clearly states it.
- Only report returnPortalUrl if you find an actual, specific URL on the retailer's official site for starting a return — never guess or construct a plausible-looking URL from the retailer's domain.
- If the policy varies by item category, membership tier, or sale status, report the standard/default window and set confidence no higher than "medium".
- If you can't find a clear, current policy, return null for returnWindowDays and confidence "low". Never guess.`;
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
// 2. deliveredAt known (a real "delivery" email, not an estimate) → most
//    accurate. Never estimated.
// 3. estimatedDeliveryDate known (a shipping-email carrier ETA, no
//    confirmed delivery yet) → same math, but flagged deadlineIsEstimated
//    — the whole point of this split: a carrier estimate is not a fact.
// 4. orderDate known, no delivery signal at all, policy counts from
//    delivery (or doesn't say) → estimate a delivery date assuming
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

  if ((deliveredValid || estimatedValid) && returnWindowStartsFrom === "order_date" && orderValid) {
    return { returnDeadline: addDays(orderParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: false };
  }

  if (deliveredValid) {
    return { returnDeadline: addDays(deliveredParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: false };
  }

  if (estimatedValid) {
    return { returnDeadline: addDays(estimatedParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: true };
  }

  if (orderValid) {
    if (returnWindowStartsFrom === "order_date") {
      return { returnDeadline: addDays(orderParsed!, returnWindowDays).toISOString(), deadlineIsEstimated: false };
    }

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

  const isCommerceEmail = parsed.emailType !== "other";
  const needsReview =
    parsed.confidence === "low" ||
    (isCommerceEmail && (parsed.retailer == null || parsed.orderNumber == null)) ||
    (parsed.emailType === "order_confirmation" && returnDeadline == null) ||
    policyLookupWasUnclear;

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
