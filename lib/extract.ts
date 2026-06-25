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
  lineItems: LineItem[];
  confidence: Confidence;
  notes: string;
}

export interface ExtractionResult extends RawExtraction {
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

function buildPrompt(textBody: string): string {
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

From the email body below, extract:
- emailType (one of the types above)
- retailer (string or null — from body only, never the From header)
- orderNumber (string or null)
- orderDate (ISO date string or null — only if explicitly stated)
- deliveryDate (ISO date string or null — only if explicitly stated; common in shipping confirmations as "estimated delivery")
- returnWindowDays (integer or null — e.g. 30; only if explicitly stated in THIS email)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null — what the window counts from, only if stated)
- orderTotal (number or null — the total amount charged, only if explicitly stated)
- orderCurrency (string or null — e.g. "USD", only if determinable)
- lineItems (array of {name, price, quantity} — individual items in the order; empty array if none are itemized in this email)
- confidence ("high" | "medium" | "low")
- notes (one sentence: your reasoning, especially any assumption or uncertainty)

Rules:
- NEVER invent, guess, or infer a date, deadline, policy, price, or item that isn't written in the email.
- Return null for any field not clearly present. Null + low confidence is always better than a wrong answer.
- Lower confidence whenever you have to infer rather than read something directly.
- For shipping confirmations: focus on deliveryDate — that's the key field.
- For order confirmations: focus on returnWindowDays, returnWindowStartsFrom, orderTotal, and lineItems.
- If the email is marketing/promotional/unrelated: set emailType to "other", retailer to null, confidence to "low".
- Leave returnWindowDays null if this email doesn't state it — don't guess based on what you know about the retailer. A separate lookup step handles that.

Respond with ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

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
// 1. deliveryDate + returnWindowDays → most accurate.
// 2. orderDate + returnWindowDays, no deliveryDate → estimate assuming
//    STANDARD_SHIPPING_DAYS of transit, flagged deadlineIsEstimated.
// 3. returnWindowDays missing → leave null, caller sets needsReview.
export function computeDeadline(parsed: {
  orderDate: string | null;
  deliveryDate: string | null;
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
}): {
  returnDeadline: string | null;
  deadlineIsEstimated: boolean;
} {
  const { orderDate, deliveryDate, returnWindowDays, returnWindowStartsFrom } = parsed;

  if (returnWindowDays == null) {
    return { returnDeadline: null, deadlineIsEstimated: false };
  }

  if (deliveryDate) {
    const deliveryParsed = new Date(deliveryDate);
    const orderParsed = orderDate ? new Date(orderDate) : null;
    const start =
      returnWindowStartsFrom === "order_date" && orderParsed && !Number.isNaN(orderParsed.getTime())
        ? orderParsed
        : deliveryParsed;

    if (Number.isNaN(start.getTime())) {
      return { returnDeadline: null, deadlineIsEstimated: false };
    }

    return {
      returnDeadline: addDays(start, returnWindowDays).toISOString(),
      deadlineIsEstimated: false,
    };
  }

  if (orderDate) {
    const orderParsed = new Date(orderDate);
    if (Number.isNaN(orderParsed.getTime())) {
      return { returnDeadline: null, deadlineIsEstimated: false };
    }

    const estimatedDelivery = addDays(orderParsed, STANDARD_SHIPPING_DAYS);
    return {
      returnDeadline: addDays(estimatedDelivery, returnWindowDays).toISOString(),
      deadlineIsEstimated: true,
    };
  }

  return { returnDeadline: null, deadlineIsEstimated: false };
}

export async function extractEmail(textBody: string): Promise<ExtractionResult> {
  const message = await anthropic.messages.create({
    model: MODEL,
    // Orders with many line items can produce long responses — 1024 was
    // truncating mid-JSON for orders with a dozen+ items.
    max_tokens: 4096,
    messages: [{ role: "user", content: buildPrompt(textBody) }],
  });

  const text = lastTextBlock(message.content as { type: string; text?: string }[]);
  const parsed: RawExtraction = JSON.parse(stripCodeFence(text));

  let policySource: PolicySource | null = null;
  let policyLookupWasUnclear = false;
  let returnPortalUrl: string | null = null;

  if (parsed.returnWindowDays != null) {
    policySource = "email";
  } else if (parsed.retailer) {
    try {
      const lookup = await lookupReturnPolicy(parsed.retailer);
      returnPortalUrl = lookup.returnPortalUrl;

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

  const { returnDeadline, deadlineIsEstimated } = computeDeadline(parsed);

  const isCommerceEmail = parsed.emailType !== "other";
  const needsReview =
    parsed.confidence === "low" ||
    (isCommerceEmail && (parsed.retailer == null || parsed.orderNumber == null)) ||
    (parsed.emailType === "order_confirmation" && returnDeadline == null) ||
    policyLookupWasUnclear;

  return { ...parsed, returnDeadline, deadlineIsEstimated, policySource, returnPortalUrl, needsReview };
}
