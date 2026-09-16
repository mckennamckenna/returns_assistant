// READ-ONLY diagnostic. Zero writes, zero billed Anthropic calls — reads
// stored rows and calls the pure functions resolveBodyTextWithAlternate /
// htmlToPlainText (via resolveBodyText's own html-to-text config, not a
// reimplementation) locally. Supports TASKS.md 🔴 Now "Investigation:
// sparse-body extraction on emails with retailerSource='sender_fallback'"
// (2026-09-15), Q2: raw-email inspection of Bloomingdale's #781187611 and
// #781160797.
//
// Redacted 2026-09-15 for commit: this script never prints raw textBody,
// raw htmlBody, or html-to-text-converted content — only counts, lengths,
// yes/no findings, and a coarse "where does it appear" classification
// (image alt / URL / running text). See TASKS.md/session notes for the
// pre-redaction review that flagged the original version as unsafe to
// commit (it printed short snippets of real customer email content).
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { resolveBodyTextWithAlternate } from "../lib/emailBodyText";
import { convert } from "html-to-text";

const prisma = new PrismaClient();
const TARGET_ORDER_NUMBERS = ["781187611", "781160797"];

// Mirrors lib/emailBodyText.ts's htmlToPlainText exactly (same selectors,
// same truncation) so this script sees precisely what the pipeline sees —
// that function isn't exported, so it's reproduced here read-only rather
// than modifying the lib file to export it.
function htmlToPlainText(html: string): string {
  const text = convert(html, {
    selectors: [
      { selector: "img", format: "skip" },
      { selector: "a", options: { ignoreHref: true } },
      { selector: '[style*="display:none" i]', format: "skip" },
      { selector: '[style*="display: none" i]', format: "skip" },
      { selector: '[class*="preheader" i]', format: "skip" },
      { selector: '[id*="preheader" i]', format: "skip" },
    ],
  }).trim();
  return text.slice(0, 12000);
}

function nonWhitespaceLen(s: string | null): number {
  return (s ?? "").replace(/\s/g, "").length;
}

// Coarse classification of where a match sits, WITHOUT printing the
// surrounding text — looks only at whether the nearest preceding
// `alt="`/`href="`/`src="` attribute opener is still "open" (no closing
// quote or tag-close between it and the match). Approximate by design:
// good enough to distinguish "buried in an image alt or a tracking URL"
// from "sitting in plain running text a reader would see," which is the
// only thing this diagnostic needs — not a full HTML parse.
function classifyLocation(haystack: string, matchIndex: number): "image alt" | "url" | "running text" {
  const windowStart = Math.max(0, matchIndex - 300);
  const before = haystack.slice(windowStart, matchIndex);

  const candidates: { type: "image alt" | "url"; idx: number; attrLen: number }[] = [
    { type: "image alt", idx: before.lastIndexOf('alt="'), attrLen: 5 },
    { type: "image alt", idx: before.lastIndexOf("alt='"), attrLen: 5 },
    { type: "url", idx: before.lastIndexOf('href="'), attrLen: 6 },
    { type: "url", idx: before.lastIndexOf('src="'), attrLen: 5 },
  ].filter((c) => c.idx >= 0);

  if (candidates.length === 0) return "running text";

  candidates.sort((a, b) => b.idx - a.idx);
  const nearest = candidates[0];
  const between = before.slice(nearest.idx + nearest.attrLen);
  if (between.includes('"') || between.includes(">")) return "running text";
  return nearest.type;
}

function findOccurrences(haystack: string, needle: RegExp, label: string) {
  const matches = [...haystack.matchAll(needle)];
  if (matches.length === 0) {
    console.log(`  ${label}: not found`);
    return;
  }

  const locationCounts = { "image alt": 0, url: 0, "running text": 0 };
  for (const m of matches) {
    const idx = m.index ?? 0;
    locationCounts[classifyLocation(haystack, idx)]++;
  }
  console.log(
    `  ${label}: found ${matches.length}x` +
      ` (image alt: ${locationCounts["image alt"]}, url: ${locationCounts.url}, running text: ${locationCounts["running text"]})`,
  );
}

async function main() {
  let totalFound = 0;

  for (const orderNumber of TARGET_ORDER_NUMBERS) {
    console.log(`\n================ Order #${orderNumber} ================`);

    const emails = await prisma.email.findMany({
      where: { orderNumber, emailType: "order_confirmation" },
      select: {
        id: true,
        userId: true,
        emailType: true,
        retailer: true,
        retailerSource: true,
        textBody: true,
        htmlBody: true,
      },
    });

    if (emails.length === 0) {
      console.log("  No order_confirmation Email row found with this orderNumber (may be linked via Order rather than Email.orderNumber — widen query if needed).");
      continue;
    }

    totalFound += emails.length;

    for (const e of emails) {
      console.log(`\n  -- Email ${e.id} (retailer=${e.retailer}, retailerSource=${e.retailerSource}) --`);

      const textBody = e.textBody ? decrypt(e.textBody) : null;
      const htmlBody = e.htmlBody ? decrypt(e.htmlBody) : null;

      const textLen = nonWhitespaceLen(textBody);
      const htmlLenRaw = htmlBody?.length ?? 0;

      console.log(`  textBody: present=${textBody !== null}, raw length=${textBody?.length ?? 0}, non-whitespace length=${textLen}`);
      console.log(`  htmlBody: present=${htmlBody !== null}, raw length=${htmlLenRaw}`);

      if (textBody) {
        findOccurrences(textBody, /bloomingdale.?s?/gi, "textBody: 'Bloomingdale's' variant");
        findOccurrences(textBody, /\b781187611\b|\b781160797\b/g, "textBody: order number literal");
      }
      if (htmlBody) {
        findOccurrences(htmlBody, /bloomingdale.?s?/gi, "htmlBody (raw): 'Bloomingdale's' variant");
      }

      const { primary, alternate } = resolveBodyTextWithAlternate(textBody, htmlBody);
      console.log(`  resolveBodyTextWithAlternate: primary source = ${primary === textBody?.trim() ? "textBody" : primary === null ? "none" : "htmlBody(converted)"}, primary length=${primary?.length ?? 0}, alternate present=${alternate !== null}`);

      if (htmlBody) {
        const converted = htmlToPlainText(htmlBody);
        console.log(`  html-to-text(htmlBody) length: ${converted.length}`);
        findOccurrences(converted, /bloomingdale.?s?/gi, "html-to-text output: 'Bloomingdale's' variant");
      }

      console.log(`  labeled order-number check (textBody): ${textBody ? new RegExp(`order\\s*(number|#)?\\s*:?\\s*${orderNumber}`, "i").test(textBody) : "n/a"}`);
      console.log(`  labeled order-number check (htmlBody raw): ${htmlBody ? new RegExp(`order\\s*(number|#)?\\s*:?\\s*${orderNumber}`, "i").test(htmlBody) : "n/a"}`);
    }
  }

  // Safe-fail guard: this script targets two specific, hardcoded email
  // IDs (via their order numbers) — if neither is found, the DB state has
  // diverged from what this script assumes (rows deleted, order numbers
  // changed, wrong environment), and silently printing an all-empty
  // report would look like a real "nothing found" finding instead of a
  // broken assumption. Fail loudly instead.
  if (totalFound === 0) {
    console.error(
      `\nNo order_confirmation Email rows found for either target order number (${TARGET_ORDER_NUMBERS.join(", ")}).` +
        ` This script's assumptions (these two rows exist, are order_confirmation type, and are queryable by` +
        ` orderNumber) no longer hold — investigate before trusting any output above.`,
    );
    process.exit(1);
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0 · extraction/policy-lookup calls triggered: 0");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
