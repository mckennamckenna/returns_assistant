/**
 * scripts/pm-verify-zara-fallback-enumeration-20260825.ts
 *
 * READ-ONLY. 0 billed Anthropic calls — findMany only, no runExtraction/
 * extractEmail/model call anywhere in this path. 0 DB writes.
 *
 * Step 1 of the Zara retailer-fallback build (owner-gated pre-code
 * enumeration + preview). Simulates Decision 2's gate and the AMENDED
 * Decision 3 (Step 0 carrier-domain deferral added ahead of the original
 * Steps 1-4) exactly as specified, against every currently-eligible row.
 * Also renders the Step 1c before/after preview (Email, Order,
 * needs-review routing) as a pure in-memory dry run — no migration, no
 * write, anywhere.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../lib/emailEncryption";

const prisma = new PrismaClient();

// Decision 3 (amended), Step 0 — carrier-domain deferral, checked BEFORE
// Steps 1-4. Starting list per owner's amendment; extended only if Step 1b
// finds a live row whose domain isn't covered (see main()).
const CARRIER_DOMAINS = new Set([
  "fedex.com", "usps.com", "ups.com", "dhl.com", "ontrac.com", "lasership.com",
]);

// Decision 3, Step 1 — exact match, case-insensitive.
const GENERIC_FROM_NAMES = new Set([
  "noreply", "no-reply", "hello", "team", "support", "orders", "notifications",
  "info", "contact", "service", "customer service", "delivery manager",
  "tracking", "updates",
]);

// Decision 3, Step 2 — ESP subdomain strip list (applied before taking the
// registered domain), same list used for the Step 0 carrier check per the
// owner's "same subdomain-stripping logic" instruction.
const ESP_SUBDOMAIN_PREFIXES = ["email.", "mktg.", "send.", "mail."];

const ESP_WHITELABEL_HINTS = [
  "shopifyemail", "klaviyomail", "sendgrid", "mailgun", "iterable", "braze",
  "mandrillapp", "sparkpost", "postmarkapp",
];

const GENERIC_SUBSTRING_HINTS = [
  "noreply", "no-reply", "hello", "team", "support", "order", "notification",
  "info", "contact", "service", "delivery", "tracking", "update",
];

// Decision 2, condition (ii).
const GATE_EMAIL_TYPES = new Set([
  "order_confirmation", "shipping_confirmation", "delivery", "return_label", "refund",
]);

function domainOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at === -1 ? email.toLowerCase() : email.slice(at + 1).toLowerCase();
}

// "Registered domain" per the owner's example (tracking.usps.com -> usps.com):
// strip a known ESP subdomain prefix if present, then take the last two
// dot-separated labels. Shared by the Step 0 carrier check and Step 2's
// domain-label derivation, per the owner's "same logic" instruction.
function registeredDomain(domain: string): { registered: string; strippedPrefix: string | null } {
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
  const registered = parts.length >= 2 ? parts.slice(-2).join(".") : d;
  return { registered, strippedPrefix };
}

function titleCase(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

interface Resolution {
  step: 0 | 1 | 2 | 3 | 4;
  retailer: string | null;
  retailerSource: "sender_fallback" | "carrier_deferred" | null;
  suspicious: boolean;
  suspiciousReason: string | null;
}

function resolve(fromEmail: string, fromName: string | null): Resolution {
  const domain = domainOf(fromEmail);
  const { registered, strippedPrefix } = registeredDomain(domain);

  // Step 0 (amended) — carrier deferral, checked first.
  if (CARRIER_DOMAINS.has(registered)) {
    return { step: 0, retailer: null, retailerSource: "carrier_deferred", suspicious: false, suspiciousReason: null };
  }

  // Step 1 — fromName if present and not an exact generic match.
  const trimmedName = (fromName ?? "").trim();
  if (trimmedName.length > 0 && !GENERIC_FROM_NAMES.has(trimmedName.toLowerCase())) {
    const lower = trimmedName.toLowerCase();
    const hint = GENERIC_SUBSTRING_HINTS.find((h) => lower.includes(h));
    return {
      step: 1,
      retailer: trimmedName,
      retailerSource: "sender_fallback",
      suspicious: hint !== undefined,
      suspiciousReason: hint ? `fromName "${trimmedName}" contains generic word "${hint}" but is not an exact match to the generic list` : null,
    };
  }

  // Step 2 — domain-derived.
  if (registered) {
    const label = titleCase(registered.split(".")[0]);
    const espHint = ESP_WHITELABEL_HINTS.find((h) => domain.includes(h));
    return {
      step: 2,
      retailer: label,
      retailerSource: "sender_fallback",
      suspicious: espHint !== undefined,
      suspiciousReason: espHint ? `domain "${domain}" matches known ESP/whitelabel hint "${espHint}"${strippedPrefix ? ` (after stripping "${strippedPrefix}")` : ""}` : null,
    };
  }

  // Step 3 — override map, START EMPTY per design. Nothing to check.

  // Step 4 — nothing resolved.
  return { step: 4, retailer: null, retailerSource: null, suspicious: true, suspiciousReason: "gate passed but nothing resolved — unexpected, review manually" };
}

const RETURN_SIDE_EMAIL_TYPES = new Set(["return_label", "refund"]);
const PURCHASE_SIDE_EMAIL_TYPES = new Set(["order_confirmation", "shipping_confirmation", "delivery"]);

// Mirrors lib/needsReviewRows.ts's detectEmailReviewReason exactly, so the
// preview reflects the real routing function rather than a paraphrase.
function detectEmailReviewReason(
  emailType: string | null,
  retailer: string | null,
  orderNumber: string | null,
  candidateOrderNumbers: string[],
): string {
  if (orderNumber) {
    const normalized = orderNumber.toLowerCase();
    if (candidateOrderNumbers.some((n) => n.toLowerCase() === normalized)) return "belongs_to_existing_order";
  }
  if (emailType && RETURN_SIDE_EMAIL_TYPES.has(emailType)) return "return_or_refund_no_link";
  if (emailType && PURCHASE_SIDE_EMAIL_TYPES.has(emailType) && (retailer || orderNumber)) return "real_purchase_no_record";
  return "no_extraction_signal";
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
      subject: true, orderNumber: true, extractionNotes: true, orderId: true, userId: true,
    },
    orderBy: { receivedAt: "asc" },
  });

  console.log(`Decision-2 gate (i)+(ii) match: ${candidates.length} row(s)\n`);

  // ---- Step 1a/1b: precedence table + carrier fromEmail dump ----
  console.log("=== STEP 1a — precedence resolution (amended Decision 3) ===\n");
  console.log(
    "id".padEnd(26), "emailType".padEnd(22), "fromEmail".padEnd(30),
    "fromName".padEnd(22), "step", "retailer".padEnd(22), "retailerSource".padEnd(18), "suspicious"
  );
  console.log("-".repeat(170));

  type RowResult = {
    id: string; emailType: string | null; fromEmail: string; fromName: string | null;
    subject: string | null; orderNumber: string | null; orderId: string | null; userId: string;
    res: Resolution;
  };
  const results: RowResult[] = [];
  let suspiciousCount = 0;

  for (const e of candidates) {
    const dec = decryptEmailContent(e as any);
    const res = resolve(dec.fromEmail, dec.fromName);
    if (res.suspicious) suspiciousCount++;
    results.push({ id: e.id, emailType: e.emailType, fromEmail: dec.fromEmail, fromName: dec.fromName, subject: e.subject, orderNumber: e.orderNumber, orderId: e.orderId, userId: e.userId, res });
    console.log(
      e.id.padEnd(26), (e.emailType ?? "").padEnd(22), dec.fromEmail.padEnd(30),
      (dec.fromName ?? "").padEnd(22), String(res.step), (res.retailer ?? "(null)").padEnd(22),
      (res.retailerSource ?? "(null)").padEnd(18), res.suspicious ? "TRUE" : "false"
    );
  }

  console.log(`\n${suspiciousCount} of ${candidates.length} row(s) flagged suspicious.`);
  const expectedZara = results.filter((r) => r.res.step === 1 && r.res.retailer === "Zara").length;
  const expectedCarrier = results.filter((r) => r.res.step === 0).length;
  console.log(`Zara rows resolving via step 1: ${expectedZara} (expected 3)`);
  console.log(`Carrier rows deferred via step 0: ${expectedCarrier} (expected 5)`);
  if (expectedZara !== 3 || expectedCarrier !== 5 || suspiciousCount !== 0) {
    console.log("*** ACTUAL DIFFERS FROM EXPECTED — see report, do not proceed without owner review. ***");
  }

  console.log("\n=== STEP 1b — carrier row fromEmail dump + domain-list coverage check ===\n");
  const carrierRows = results.filter((r) => r.res.step === 0 || CARRIER_DOMAINS.has(registeredDomain(domainOf(r.fromEmail)).registered));
  const nonCarrierButCarrierish = results.filter((r) => {
    const { registered } = registeredDomain(domainOf(r.fromEmail));
    return !CARRIER_DOMAINS.has(registered) && /fedex|usps|ups|dhl|ontrac|lasership/i.test(r.fromEmail + " " + (r.fromName ?? ""));
  });
  for (const r of carrierRows) {
    console.log(`  ${r.id}: fromEmail="${r.fromEmail}" fromName="${r.fromName ?? "(null)"}" -> registered domain "${registeredDomain(domainOf(r.fromEmail)).registered}" -> in list: ${CARRIER_DOMAINS.has(registeredDomain(domainOf(r.fromEmail)).registered)}`);
  }
  console.log(`\nStarting carrier list: ${[...CARRIER_DOMAINS].join(", ")}`);
  console.log(`Rows deferred via step 0: ${results.filter((r) => r.res.step === 0).length}`);
  console.log(`Rows with a carrier-like signal NOT caught by the list: ${nonCarrierButCarrierish.length}`);
  if (nonCarrierButCarrierish.length > 0) {
    console.log("*** LIST GAP — flag and stop:", nonCarrierButCarrierish.map((r) => `${r.id} (${r.fromEmail})`).join(", "));
  }

  // ---- Step 1c: preview tables ----
  console.log("\n\n=== STEP 1c — PREVIEW TABLE 1: Email before/after ===\n");
  for (const r of results) {
    console.log(`Email ${r.id}`);
    console.log(`  fromEmail: ${r.fromEmail}`);
    console.log(`  fromName: ${r.fromName ?? "(null)"}`);
    console.log(`  emailType: ${r.emailType}`);
    console.log(`  subject: "${(r.subject ?? "").slice(0, 60)}"`);
    console.log(`  retailer BEFORE: null`);
    console.log(`  retailer AFTER: ${r.res.retailer ?? "null"}`);
    console.log(`  retailerSource BEFORE: N/A — new column`);
    console.log(`  retailerSource AFTER: ${r.res.retailerSource ?? "null"}`);
    console.log("");
  }

  console.log("\n=== STEP 1c — PREVIEW TABLE 2: Order before/after ===\n");
  const linkedOrderIds = [...new Set(results.map((r) => r.orderId).filter((id): id is string => id !== null))];
  if (linkedOrderIds.length === 0) {
    console.log("No Order rows linked to any of the 8 in-scope Emails (all 8 have orderId: null). Table is empty — 0 Order.retailer changes, consistent with Decision 5 (do nothing to Order.retailer).");
  } else {
    const orders = await prisma.order.findMany({ where: { id: { in: linkedOrderIds } }, select: { id: true, orderNumber: true, retailer: true } });
    for (const o of orders) {
      const changed = false; // Decision 5: this design never writes Order.retailer.
      console.log(`Order ${o.id}  #${o.orderNumber ?? "(none)"}  retailer BEFORE: ${o.retailer}  retailer AFTER: ${o.retailer}  changed: ${changed}`);
    }
  }

  console.log("\n\n=== STEP 1c — PREVIEW TABLE 3: needs-review routing impact ===\n");
  // Per-user candidate order numbers, for the belongs_to_existing_order check —
  // real query, not assumed, since this determines whether Zara's already-
  // populated orderNumber matches an existing Order today.
  const userIds = [...new Set(results.map((r) => r.userId))];
  const candidateOrdersByUser = new Map<string, string[]>();
  for (const uid of userIds) {
    const orders = await prisma.order.findMany({ where: { userId: uid }, select: { orderNumber: true } });
    candidateOrdersByUser.set(uid, orders.map((o) => o.orderNumber).filter((n): n is string => n !== null));
  }

  let mismatchFlag = false;
  for (const r of results) {
    const candidateNums = candidateOrdersByUser.get(r.userId) ?? [];
    const before = detectEmailReviewReason(r.emailType, null, r.orderNumber, candidateNums);
    const after = detectEmailReviewReason(r.emailType, r.res.retailer, r.orderNumber, candidateNums);
    const flip = before !== after;
    console.log(`Email ${r.id}: BEFORE=${before}  AFTER=${after}  branch changed: ${flip}`);
    if (r.res.step === 1 || r.res.step === 2) {
      // These are the rows expected (per owner's design note) to "flip from
      // the degrade branch to the retailer-populated branch."
      if (!flip) mismatchFlag = true;
    }
  }
  if (mismatchFlag) {
    console.log("\n*** ACTUAL DIFFERS FROM STATED EXPECTATION: at least one row resolving via step 1/2 does NOT change needs-review branch. See report — this is a real discrepancy against the design note's stated expected result, not a script bug. Not patched here per instruction. ***");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
