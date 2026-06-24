import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Fast/cheap model — this is a binary gate run on every inbound email,
// not the detailed extraction. Cost and latency matter more than nuance.
const MODEL = "claude-haiku-4-5-20251001";

function buildPrompt(text: string): string {
  return `You are a privacy filter for a shopping-returns app. Decide whether this forwarded email is RETAIL/COMMERCE related: an online or in-store purchase, shipping, delivery, return, or refund of a physical or digital product or service.

It is NOT commerce if it's about: pharmacy or prescriptions, medical records or appointments, financial statements or banking, personal correspondence, or anything else unrelated to a retail purchase.

If you're not sure, answer NOT_COMMERCE — when in doubt, we discard rather than keep.

Respond with ONLY one word: COMMERCE or NOT_COMMERCE.

EMAIL BODY:
${text}`;
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Returns true if the email should be kept (is commerce, or we couldn't
// tell — see the catch in callers: classification errors fail OPEN, since
// dropping real data because of a transient API error is worse than
// occasionally keeping a non-commerce email pending the next privacy pass).
export async function isCommerceEmail(textBody: string | undefined, htmlBody: string | undefined): Promise<boolean> {
  const text = (textBody || (htmlBody ? stripHtml(htmlBody) : "")).slice(0, 8000);
  if (!text) return false; // nothing to classify, nothing to confirm as commerce

  const message = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 8,
    messages: [{ role: "user", content: buildPrompt(text) }],
  });

  const block = message.content[0];
  const answer = block.type === "text" ? block.text.trim().toUpperCase() : "";
  return answer.startsWith("COMMERCE");
}
