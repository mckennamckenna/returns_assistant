import Anthropic from "@anthropic-ai/sdk";

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

interface RawExtraction {
  emailType: EmailType;
  retailer: string | null;
  orderNumber: string | null;
  orderDate: string | null;
  deliveryDate: string | null;
  returnWindowDays: number | null;
  returnWindowStartsFrom: "order_date" | "delivery_date" | null;
  confidence: Confidence;
  notes: string;
}

export interface ExtractionResult extends RawExtraction {
  returnDeadline: string | null;
  deadlineIsEstimated: boolean;
  needsReview: boolean;
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
- returnWindowDays (integer or null — e.g. 30; only if explicitly stated)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null — what the window counts from, only if stated)
- confidence ("high" | "medium" | "low")
- notes (one sentence: your reasoning, especially any assumption or uncertainty)

Rules:
- NEVER invent, guess, or infer a date, deadline, or policy that isn't written in the email.
- Return null for any field not clearly present. Null + low confidence is always better than a wrong answer.
- Lower confidence whenever you have to infer rather than read something directly.
- For shipping confirmations: focus on deliveryDate — that's the key field.
- For order confirmations: focus on returnWindowDays and returnWindowStartsFrom.
- If the email is marketing/promotional/unrelated: set emailType to "other", retailer to null, confidence to "low".

Respond with ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

EMAIL BODY:
${textBody}`;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

// Priority order for computing returnDeadline:
// 1. deliveryDate + returnWindowDays → most accurate.
// 2. orderDate + returnWindowDays, no deliveryDate → estimate assuming
//    STANDARD_SHIPPING_DAYS of transit, flagged deadlineIsEstimated.
// 3. returnWindowDays missing → leave null, caller sets needsReview.
function computeDeadline(parsed: RawExtraction): {
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
    max_tokens: 1024,
    messages: [{ role: "user", content: buildPrompt(textBody) }],
  });

  const block = message.content[0];
  const text = block.type === "text" ? block.text : "";
  const parsed: RawExtraction = JSON.parse(stripCodeFence(text));

  const { returnDeadline, deadlineIsEstimated } = computeDeadline(parsed);

  const isCommerceEmail = parsed.emailType !== "other";
  const needsReview =
    parsed.confidence === "low" ||
    (isCommerceEmail && (parsed.retailer == null || parsed.orderNumber == null)) ||
    (parsed.emailType === "order_confirmation" && returnDeadline == null);

  return { ...parsed, returnDeadline, deadlineIsEstimated, needsReview };
}
