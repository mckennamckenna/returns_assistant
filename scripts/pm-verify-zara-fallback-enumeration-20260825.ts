/**
 * scripts/pm-verify-zara-fallback-enumeration-20260825.ts
 *
 * READ-ONLY. 0 billed Anthropic calls — findMany only, no runExtraction/
 * extractEmail/model call anywhere in this path. 0 DB writes.
 *
 * Step 1 of the Zara retailer-fallback build (owner-gated pre-code
 * enumeration). Simulates Decision 2's gate and Decision 3's precedence
 * exactly as specified against every currently-eligible row, so the owner
 * can review real output before any schema/code change lands. Does not
 * write retailer or retailerSource anywhere.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

// Decision 3, step 1 — exact match, case-insensitive.
const GENERIC_FROM_NAMES = new Set([
  "noreply", "no-reply", "hello", "team", "support", "orders", "notifications",
  "info", "contact", "service", "customer service", "delivery manager",
  "tracking", "updates",
]);

// Broader (non-exact) heuristic, enumeration-only — flags fromName values
// that CONTAIN a generic word without being an exact match to it, so a
// human can see where Decision 3's exact-match rule might let something
// slip through that its own intent (generic sender name -> skip to domain)
// was trying to catch.
const GENERIC_SUBSTRING_HINTS = [
  "noreply", "no-reply", "hello", "team", "support", "order", "notification",
  "info", "contact", "service", "delivery", "tracking", "update",
];

// Decision 3, step 2 — ESP subdomain strip list.
const ESP_SUBDOMAIN_PREFIXES = ["email.", "mktg.", "send.", "mail."];

// Enumeration-only suspicious hint for step-2 (domain) resolutions that
// land on a known ESP/whitelabel platform domain rather than a brand
// domain — Decision 3 has no exclusion for this, flagging for visibility.
const ESP_WHITELABEL_HINTS = [
  "shopifyemail", "klaviyomail", "sendgrid", "mailgun", "iterable", "braze",
  "mandrillapp", "sparkpost", "postmarkapp",
];

// Decision 2, condition (ii).
const GATE_EMAIL_TYPES = new Set([
  "order_confirmation", "shipping_confirmation", "delivery", "return_label", "refund",
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email.toLowerCase() : email.slice(at + 1).toLowerCase();
}

function domainLabel(domain: string): { label: string; strippedPrefix: string | null } {
  let d = domain;
  let strippedPrefix: string | null = null;
  for (const prefix of ESP_SUBDOMAIN_PREFIXES) {
    if (d.startsWith(prefix)) {
      d = d.slice(prefix.length);
      strippedPrefix = prefix;
      break;
    }
  }
  const parts = d.split(".");
  const registrable = parts.length >= 2 ? parts[parts.length - 2] : parts[0];
  const label = registrable.charAt(0).toUpperCase() + registrable.slice(1);
  return { label, strippedPrefix };
}

interface Resolution {
  step: 1 | 2 | 3 | 4;
  value: string | null;
  suspicious: boolean;
  suspiciousReason: string | null;
}

function resolve(fromEmail: string, fromName: string | null): Resolution {
  const trimmedName = (fromName ?? "").trim();
  if (trimmedName.length > 0 && !GENERIC_FROM_NAMES.has(trimmedName.toLowerCase())) {
    const lower = trimmedName.toLowerCase();
    const hint = GENERIC_SUBSTRING_HINTS.find((h) => lower.includes(h));
    return {
      step: 1,
      value: trimmedName,
      suspicious: hint !== undefined,
      suspiciousReason: hint ? `fromName "${trimmedName}" contains generic word "${hint}" but is not an exact match to the generic list — resolves via step 1 as-is` : null,
    };
  }

  // Step 2 — domain-derived (step 1 skipped: fromName empty or generic exact match)
  const domain = domainOf(fromEmail);
  if (domain) {
    const { label, strippedPrefix } = domainLabel(domain);
    const espHint = ESP_WHITELABEL_HINTS.find((h) => domain.includes(h));
    return {
      step: 2,
      value: label,
      suspicious: espHint !== undefined,
      suspiciousReason: espHint ? `domain "${domain}" matches known ESP/whitelabel hint "${espHint}"${strippedPrefix ? ` (after stripping "${strippedPrefix}")` : ""}` : null,
    };
  }

  // Step 3 — override map, START EMPTY per design. Nothing to check.

  // Step 4 — nothing resolved.
  return { step: 4, value: null, suspicious: true, suspiciousReason: "gate passed but nothing resolved — unexpected, review manually" };
}

async function main() {
  console.log("0 estimated billed Anthropic calls — findMany only, no extraction/model path touched.\n");

  const candidates = await prisma.email.findMany({
    where: {
      retailer: null,
      extractedAt: { not: null },
      emailType: { in: [...GATE_EMAIL_TYPES] },
    },
    select: {
      id: true, emailType: true, fromEmail: true, fromName: true, receivedAt: true,
      orderNumber: true, extractionNotes: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Decision-2 gate (i)+(ii) match: ${candidates.length} row(s)\n`);
  console.log(
    "id".padEnd(26), "emailType".padEnd(22), "fromEmail".padEnd(30),
    "fromName".padEnd(22), "step", "resolved retailer".padEnd(22), "suspicious"
  );
  console.log("-".repeat(150));

  let suspiciousCount = 0;
  const rows: { id: string; step: number; value: string | null; suspicious: boolean; reason: string | null; fromEmail: string; fromName: string | null; emailType: string | null }[] = [];

  for (const e of candidates) {
    const dec = decryptEmailContent(e as any);
    const res = resolve(dec.fromEmail, dec.fromName);
    if (res.suspicious) suspiciousCount++;
    rows.push({ id: e.id, step: res.step, value: res.value, suspicious: res.suspicious, reason: res.suspiciousReason, fromEmail: dec.fromEmail, fromName: dec.fromName, emailType: e.emailType });
    console.log(
      e.id.padEnd(26),
      (e.emailType ?? "").padEnd(22),
      dec.fromEmail.padEnd(30),
      (dec.fromName ?? "").padEnd(22),
      String(res.step),
      (res.value ?? "(null)").padEnd(22),
      res.suspicious ? "TRUE" : "false"
    );
  }

  console.log(`\n${suspiciousCount} of ${candidates.length} row(s) flagged suspicious.\n`);
  console.log("Suspicious detail:");
  for (const r of rows.filter((r) => r.suspicious)) {
    console.log(`  ${r.id} [${r.emailType}] fromEmail=${r.fromEmail} fromName=${r.fromName ?? "(null)"} -> step ${r.step}, resolved="${r.value ?? "(null)"}"`);
    console.log(`    reason: ${r.reason}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
