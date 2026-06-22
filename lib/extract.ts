import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = "claude-sonnet-4-6";

export type Confidence = "high" | "medium" | "low";

interface RawExtraction {
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
  needsReview: boolean;
}

function buildPrompt(textBody: string): string {
  return `You are extracting return/refund-relevant information from a forwarded shopping email.

IMPORTANT: This email was forwarded by the customer, so the From header shows
the customer, not the retailer. Identify the retailer from the email BODY content
only — look for sender names, logos described in text, order confirmation
language, etc.

From the email body below, extract:
- retailer (string or null)
- orderNumber (string or null)
- orderDate (ISO date or null)
- deliveryDate (ISO date or null, only if explicitly stated)
- returnWindowDays (number or null, e.g. 30 — only if explicitly stated)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null — what the window counts from)
- confidence ("high" | "medium" | "low")
- notes (one sentence: your reasoning, especially any assumption or uncertainty)

Rules:
- If the email doesn't clearly state something, return null for that field. Never guess or invent a deadline, policy, or date.
- Lower confidence whenever you have to infer rather than read something directly.
- If this email isn't an order/shipping confirmation at all (e.g. marketing, unrelated), set retailer to null and confidence to "low" with a note saying so.

Respond with ONLY valid JSON, no preamble, no markdown formatting.

EMAIL BODY:
${textBody}`;
}

function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenced ? fenced[1] : text;
}

function computeReturnDeadline(parsed: RawExtraction): string | null {
  const base = parsed.deliveryDate ?? parsed.orderDate;
  if (!base || parsed.returnWindowDays == null) return null;

  const baseDate = new Date(base);
  if (Number.isNaN(baseDate.getTime())) return null;

  baseDate.setUTCDate(baseDate.getUTCDate() + parsed.returnWindowDays);
  return baseDate.toISOString();
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

  const returnDeadline = computeReturnDeadline(parsed);
  const needsReview =
    parsed.confidence === "low" ||
    parsed.retailer == null ||
    parsed.orderNumber == null ||
    returnDeadline == null;

  return { ...parsed, returnDeadline, needsReview };
}
