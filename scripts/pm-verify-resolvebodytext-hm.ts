// READ-ONLY pre-code verification. Zero writes, zero billed Anthropic calls
// (no extractEmail, no runExtraction, no lookupReturnPolicy — this script
// only reads the row and calls the pure function resolveBodyText locally).
// Mandatory gate before writing the H&M return_label extraction-gap fix
// (TASKS.md 🔴 Now, 2026-08-22): confirm which body source resolveBodyText
// actually picks for this row, and whether the clean "Order number
// 68462778273" sentence survives into it.
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../lib/crypto";
import { resolveBodyText } from "../lib/emailBodyText";

const prisma = new PrismaClient();
const TARGET_ID = "cmt090ioq0001l404crsih7w9";
const NEEDLE = "Order number 68462778273";

async function main() {
  const e = await prisma.email.findUnique({ where: { id: TARGET_ID } });
  if (!e) return console.log("Row not found.");

  const textBody = e.textBody ? decrypt(e.textBody) : null;
  const htmlBody = e.htmlBody ? decrypt(e.htmlBody) : null;

  const trimmedTextBody = textBody?.trim() ?? "";
  const nonWhitespaceLen = trimmedTextBody.replace(/\s/g, "").length;

  console.log("=== Inputs ===");
  console.log(`textBody present: ${textBody !== null} (raw length ${textBody?.length ?? 0}, trimmed non-whitespace length ${nonWhitespaceLen})`);
  console.log(`htmlBody present: ${htmlBody !== null} (raw length ${htmlBody?.length ?? 0})`);
  console.log(`MIN_TEXT_BODY_CHARS threshold in lib/emailBodyText.ts: 20`);
  console.log(`textBody would win iff nonWhitespaceLen (${nonWhitespaceLen}) > 20 → ${nonWhitespaceLen > 20}`);

  const resolved = resolveBodyText(textBody, htmlBody);

  console.log("\n=== resolveBodyText() actual return ===");
  console.log(`Returned length: ${resolved?.length ?? 0}`);
  console.log(`Which source was picked: ${resolved === trimmedTextBody ? "textBody (verbatim, unconverted)" : resolved === null ? "neither (null)" : "htmlBody (converted via html-to-text)"}`);

  console.log("\n=== First 500 chars of resolved string ===");
  console.log(resolved ? resolved.slice(0, 500) : "(null)");

  console.log(`\n=== Literal search for "${NEEDLE}" in resolved string ===`);
  const found = resolved?.includes(NEEDLE) ?? false;
  console.log(`Present verbatim: ${found}`);
  if (!found && resolved) {
    // Also check a looser variant in case whitespace/formatting differs.
    const looseFound = /order\s*number\s*68462778273/i.test(resolved);
    console.log(`Loose case-insensitive/whitespace-tolerant match: ${looseFound}`);
    if (looseFound) {
      const idx = resolved.search(/order\s*number\s*68462778273/i);
      console.log(`Loose match context: ...${resolved.slice(Math.max(0, idx - 50), idx + 100)}...`);
    }
  }

  console.log("\nbilled Anthropic calls this run: 0 · DB writes: 0 · extraction/policy-lookup calls triggered: 0");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
