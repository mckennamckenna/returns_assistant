// Audit: what tracking are we already surfacing, and is it right?
// TASKS.md 🔴 Now, 2026-09-04 (revised framing). Crawl step for a possible
// package-tracking feature — coverage + correctness of what's LIVE today,
// not a feasibility probe (superseded framing: "is the signal extractable").
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Every check here is
// Prisma reads + the app's own decrypt() helper (lib/crypto.ts, same key
// already used everywhere) + regex/string matching. No extraction path,
// no schema change, no carrier reassignment — inventory and counts only.
//
// Usage: npx tsx scripts/audits/package-tracking-signal.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";

const prisma = new PrismaClient();

// ---------------------------------------------------------------------------
// Carrier tracking-number FORMAT regexes — deliberately NOT the app's own
// loose production patterns (lib/trackingParser.ts's DHL pattern is just
// "10-11 digits", too permissive to discriminate anything). These are
// tighter real-world formats, used only for the Q2 correctness check.
// Confirmed going in (see session reflection) that this check will NOT
// flag the known H&M DHL/USPS case — that's a business-logic collision
// (DHL eCommerce handing last-mile to USPS), not a format collision, and
// per owner instruction we report that outcome plainly rather than loosen
// the regex to force a match.
// ---------------------------------------------------------------------------
const STRICT_CARRIER_PATTERNS: Record<string, RegExp> = {
  UPS: /^1Z[A-Z0-9]{16}$/i,
  USPS: /^(94|93|92|82|20)\d{18,20}$/,
  FedEx: /^\d{12}$|^\d{15}$|^\d{20}$/,
  DHL: /^\d{10,11}$/,
};

// Carrier tracking-domain patterns, used two ways below:
//   - Q3 inventory: find ALL carrier URLs present in a return_label email
//     (not just the first/extracted one, unlike lib/trackingParser.ts)
const CARRIER_DOMAINS: { name: string; domain: RegExp }[] = [
  { name: "UPS", domain: /\bups\.com\/track/i },
  { name: "USPS", domain: /\busps\.com/i },
  { name: "FedEx", domain: /\bfedex(?:track)?\.com/i },
  { name: "DHL", domain: /\bdhl\.com/i },
  { name: "Canada Post", domain: /\bcanadapost(-postescanada)?\.ca/i },
];

const CARRIER_NAME_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "DHL", pattern: /\bDHL\b/i },
  { name: "USPS", pattern: /\bUSPS\b/i },
  { name: "UPS", pattern: /\bUPS\b/i },
  { name: "FedEx", pattern: /\bFed\s?Ex\b/i },
];

function safeDecrypt(v: string | null): string | null {
  if (v == null) return null;
  try {
    return decrypt(v);
  } catch {
    return null; // malformed/legacy value — skip rather than crash the audit
  }
}

function findAllCarrierUrls(text: string): { carrier: string; url: string }[] {
  const found: { carrier: string; url: string }[] = [];
  const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0];
    for (const c of CARRIER_DOMAINS) {
      if (c.domain.test(url)) {
        found.push({ carrier: c.name, url });
        break;
      }
    }
  }
  return found;
}

function findCarrierNameMentions(text: string): string[] {
  const names: string[] = [];
  for (const c of CARRIER_NAME_PATTERNS) {
    if (c.pattern.test(text)) names.push(c.name);
  }
  return names;
}

interface PostmarkAttachment {
  Name?: string;
  ContentType?: string;
}

function extractPdfAttachments(rawJson: unknown): { name: string; contentType: string }[] {
  if (!rawJson || typeof rawJson !== "object") return [];
  const attachments = (rawJson as { Attachments?: PostmarkAttachment[] }).Attachments;
  if (!Array.isArray(attachments)) return [];
  return attachments
    .filter((a) => {
      const type = (a.ContentType ?? "").toLowerCase();
      const name = (a.Name ?? "").toLowerCase();
      return type.includes("pdf") || name.endsWith(".pdf");
    })
    .map((a) => ({ name: a.Name ?? "(unnamed)", contentType: a.ContentType ?? "(unknown)" }));
}

function pct(n: number, d: number): string {
  if (d === 0) return "n/a (0 in denominator)";
  return `${((n / d) * 100).toFixed(1)}%`;
}

function retailerKey(r: string | null): string {
  return r ?? "(no retailer)";
}

function groupCount<T>(rows: T[], keyFn: (t: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = keyFn(row);
    const arr = map.get(k) ?? [];
    arr.push(row);
    map.set(k, arr);
  }
  return map;
}

// ===========================================================================
// Q1 — Coverage
// ===========================================================================
async function auditCoverage() {
  const incoming = await prisma.order.findMany({
    where: { emails: { some: { emailType: "shipping_confirmation" } } },
    select: { id: true, retailer: true, trackingNumber: true, trackingUrl: true },
  });
  const outbound = await prisma.order.findMany({
    where: { displayStatus: { in: ["return_requested", "returned"] } },
    select: { id: true, retailer: true, returnTrackingNumber: true, returnTrackingUrl: true },
  });

  const incomingSurfaced = incoming.filter((o) => o.trackingNumber && o.trackingUrl);
  const outboundSurfaced = outbound.filter((o) => o.returnTrackingNumber && o.returnTrackingUrl);

  console.log("\n=== Q1: COVERAGE ===");
  console.log(`Incoming eligible (order has ≥1 linked shipping_confirmation email): ${incoming.length}`);
  console.log(`  Surfaced (trackingNumber AND trackingUrl set): ${incomingSurfaced.length} (${pct(incomingSurfaced.length, incoming.length)})`);
  console.log(`Outbound eligible (displayStatus in return_requested/returned): ${outbound.length}`);
  console.log(`  Surfaced (returnTrackingNumber AND returnTrackingUrl set): ${outboundSurfaced.length} (${pct(outboundSurfaced.length, outbound.length)})`);

  console.log("\n-- Incoming coverage by retailer --");
  const incomingByRetailer = groupCount(incoming, (o) => retailerKey(o.retailer));
  const incomingRows: { retailer: string; eligible: number; surfaced: number }[] = [];
  for (const [retailer, rows] of incomingByRetailer) {
    const surfaced = rows.filter((o) => o.trackingNumber && o.trackingUrl).length;
    incomingRows.push({ retailer, eligible: rows.length, surfaced });
    console.log(`  ${retailer}: ${surfaced}/${rows.length} (${pct(surfaced, rows.length)})`);
  }

  console.log("\n-- Outbound coverage by retailer --");
  const outboundByRetailer = groupCount(outbound, (o) => retailerKey(o.retailer));
  const outboundRows: { retailer: string; eligible: number; surfaced: number }[] = [];
  for (const [retailer, rows] of outboundByRetailer) {
    const surfaced = rows.filter((o) => o.returnTrackingNumber && o.returnTrackingUrl).length;
    outboundRows.push({ retailer, eligible: rows.length, surfaced });
    console.log(`  ${retailer}: ${surfaced}/${rows.length} (${pct(surfaced, rows.length)})`);
  }

  return {
    incomingTotal: incoming.length,
    incomingSurfaced: incomingSurfaced.length,
    outboundTotal: outbound.length,
    outboundSurfaced: outboundSurfaced.length,
    incomingRows,
    outboundRows,
    incomingOrders: incoming,
    outboundOrders: outbound,
  };
}

// ===========================================================================
// Q2 — Correctness of carrier attribution
// ===========================================================================
type MismatchBucket = "match" | "mismatch" | "unverifiable_no_number" | "unknown_carrier_pattern";

function checkFormat(carrier: string | null, trackingNumber: string | null): MismatchBucket {
  if (!trackingNumber) return "unverifiable_no_number";
  if (!carrier || !STRICT_CARRIER_PATTERNS[carrier]) return "unknown_carrier_pattern";
  return STRICT_CARRIER_PATTERNS[carrier].test(trackingNumber) ? "match" : "mismatch";
}

async function auditCorrectness() {
  const incomingCarrierSet = await prisma.order.findMany({
    where: { carrier: { not: null } },
    select: { id: true, retailer: true, carrier: true, trackingNumber: true },
  });
  const outboundCarrierSet = await prisma.order.findMany({
    where: { returnCarrier: { not: null } },
    select: { id: true, retailer: true, returnCarrier: true, returnTrackingNumber: true },
  });

  console.log("\n=== Q2: CORRECTNESS OF CARRIER ATTRIBUTION ===");
  console.log(`Incoming orders with a carrier attributed: ${incomingCarrierSet.length}`);
  console.log(`Outbound orders with a returnCarrier attributed: ${outboundCarrierSet.length}`);

  function summarize(label: string, rows: { retailer: string | null; carrierValue: string | null; number: string | null }[]) {
    const buckets: Record<MismatchBucket, number> = { match: 0, mismatch: 0, unverifiable_no_number: 0, unknown_carrier_pattern: 0 };
    const mismatchRows: typeof rows = [];
    for (const r of rows) {
      const b = checkFormat(r.carrierValue, r.number);
      buckets[b]++;
      if (b === "mismatch") mismatchRows.push(r);
    }
    const checkable = buckets.match + buckets.mismatch;
    console.log(`\n-- ${label} --`);
    console.log(`  Checkable (carrier known pattern + number present): ${checkable}`);
    console.log(`  Match: ${buckets.match}  Mismatch: ${buckets.mismatch} (${pct(buckets.mismatch, checkable)} of checkable)`);
    console.log(`  Unverifiable (no tracking number to check): ${buckets.unverifiable_no_number}`);
    console.log(`  Unknown carrier pattern (carrier value not in our regex map): ${buckets.unknown_carrier_pattern}`);
    if (mismatchRows.length) {
      console.log(`  Mismatch rows:`);
      for (const r of mismatchRows) console.log(`    retailer=${r.retailer ?? "(none)"} carrier=${r.carrierValue} number=${r.number}`);
    }
    return { buckets, mismatchRows, checkable };
  }

  const incomingSummary = summarize(
    "Incoming",
    incomingCarrierSet.map((o) => ({ retailer: o.retailer, carrierValue: o.carrier, number: o.trackingNumber })),
  );
  const outboundSummary = summarize(
    "Outbound",
    outboundCarrierSet.map((o) => ({ retailer: o.retailer, carrierValue: o.returnCarrier, number: o.returnTrackingNumber })),
  );

  // Sanity check against the known H&M DHL/USPS case.
  const hmDhlReturns = outboundCarrierSet.filter((o) => o.retailer === "H&M" && o.returnCarrier === "DHL");
  console.log("\n-- Sanity check: known H&M DHL/USPS case --");
  if (hmDhlReturns.length === 0) {
    console.log("  No H&M orders with returnCarrier=DHL found in current data (may have changed since the pre-audit check).");
  }
  for (const o of hmDhlReturns) {
    const result = checkFormat(o.returnCarrier, o.returnTrackingNumber);
    console.log(`  H&M order ${o.id}: returnCarrier=DHL, returnTrackingNumber=${o.returnTrackingNumber}, format-check result=${result}`);
    console.log(`    -> ${result === "mismatch" ? "FLAGGED as expected" : "NOT flagged — confirms format-regex alone does not catch this class of mislabel (see report)"}`);
  }

  return { incomingCarrierSet, outboundCarrierSet, incomingSummary, outboundSummary, hmDhlReturns };
}

// ===========================================================================
// Q3 — PDF-attachment channel + carrier-mention/URL inventory (return_label emails)
// ===========================================================================
interface ReturnLabelInventoryRow {
  emailId: string;
  orderId: string | null;
  retailer: string | null;
  hasPdf: boolean;
  pdfAttachments: { name: string; contentType: string }[];
  carriersMentioned: string[];
  urlsFound: { carrier: string; url: string }[];
}

async function auditPdfChannel() {
  const returnLabelEmails = await prisma.email.findMany({
    where: { emailType: "return_label" },
    select: { id: true, orderId: true, retailer: true, subject: true, textBody: true, htmlBody: true, rawJson: true },
  });

  const inventory: ReturnLabelInventoryRow[] = [];
  for (const email of returnLabelEmails) {
    const decryptedText = safeDecrypt(email.textBody);
    const decryptedHtml = safeDecrypt(email.htmlBody);
    const decryptedRawJson = safeDecrypt(email.rawJson);

    const combinedText = [email.subject ?? "", decryptedText ?? "", decryptedHtml ?? ""].join("\n");

    let rawJsonParsed: unknown = null;
    if (decryptedRawJson) {
      try {
        rawJsonParsed = JSON.parse(decryptedRawJson);
      } catch {
        rawJsonParsed = null;
      }
    }

    const pdfAttachments = extractPdfAttachments(rawJsonParsed);
    const carriersMentioned = findCarrierNameMentions(combinedText);
    const urlsFound = findAllCarrierUrls(combinedText);

    inventory.push({
      emailId: email.id,
      orderId: email.orderId,
      retailer: email.retailer,
      hasPdf: pdfAttachments.length > 0,
      pdfAttachments,
      carriersMentioned,
      urlsFound,
    });
  }

  const totalWithPdf = inventory.filter((r) => r.hasPdf).length;

  console.log("\n=== Q3: PDF-ATTACHMENT CHANNEL (return_label emails) ===");
  console.log(`Total return_label emails: ${inventory.length}`);
  console.log(`With ≥1 PDF attachment: ${totalWithPdf} (${pct(totalWithPdf, inventory.length)})`);

  console.log("\n-- By retailer --");
  const byRetailer = groupCount(inventory, (r) => retailerKey(r.retailer));
  const retailerRows: { retailer: string; total: number; withPdf: number }[] = [];
  for (const [retailer, rows] of byRetailer) {
    const withPdf = rows.filter((r) => r.hasPdf).length;
    retailerRows.push({ retailer, total: rows.length, withPdf });
    console.log(`  ${retailer}: ${withPdf}/${rows.length} (${pct(withPdf, rows.length)})`);
  }

  console.log("\n-- Carrier-mention / URL inventory (for future carrier-attribution decisions) --");
  for (const row of inventory) {
    console.log(
      `  email=${row.emailId} retailer=${row.retailer ?? "(none)"} pdf=${row.hasPdf ? row.pdfAttachments.map((a) => a.name).join(",") : "no"} ` +
        `carriersMentioned=[${row.carriersMentioned.join(",")}] urls=[${row.urlsFound.map((u) => `${u.carrier}:${u.url}`).join(" | ")}]`,
    );
  }

  return { inventory, totalWithPdf, retailerRows };
}

// ===========================================================================
// Q4 — Missing-tracking diagnosis
// ===========================================================================
async function auditMissingTrackingDiagnosis(
  incomingOrders: { id: string; retailer: string | null; trackingNumber: string | null; trackingUrl: string | null }[],
  outboundOrders: { id: string; retailer: string | null; returnTrackingNumber: string | null; returnTrackingUrl: string | null }[],
) {
  console.log("\n=== Q4: MISSING-TRACKING DIAGNOSIS ===");
  console.log(
    "NOTE — eligibility is asymmetric by design (per Q1 definitions): incoming eligibility REQUIRES a linked\n" +
      "shipping_confirmation email to exist; outbound eligibility is displayStatus-based and does NOT require any\n" +
      "email to exist. So bucket (a) 'no relevant email at all' is structurally impossible for incoming — every\n" +
      "incoming-eligible order has one by construction. Reporting this asymmetry explicitly rather than forcing a\n" +
      "symmetric table.",
  );

  // --- Incoming: eligibility already requires a linked shipping_confirmation email,
  // so every missing-tracking incoming order is bucket (c) by construction.
  const incomingMissing = incomingOrders.filter((o) => !(o.trackingNumber && o.trackingUrl));
  console.log(`\n-- Incoming (${incomingMissing.length} orders missing tracking) --`);
  console.log(`  (c) email present, extraction ran, no tracking pulled: ${incomingMissing.length} (100% by construction — see note above)`);
  console.log(`  (a) no relevant email: 0 (impossible under this eligibility definition)`);
  console.log(`  (b) email present but blocked upstream: 0 (impossible under this eligibility definition — eligibility requires a LINKED email)`);

  // --- Outbound: eligibility is status-based, so all three buckets are real.
  const outboundMissing = outboundOrders.filter((o) => !(o.returnTrackingNumber && o.returnTrackingUrl));
  const outboundOrderIds = outboundMissing.map((o) => o.id);

  const ordersWithUserId = await prisma.order.findMany({
    where: { id: { in: outboundOrderIds } },
    select: { id: true, userId: true, retailer: true, needsReview: true },
  });
  const orderMetaById = new Map(ordersWithUserId.map((o) => [o.id, o]));

  const linkedReturnLabelCounts = await prisma.email.groupBy({
    by: ["orderId"],
    where: { emailType: "return_label", orderId: { in: outboundOrderIds } },
    _count: { _all: true },
  });
  const linkedOrderIds = new Set(linkedReturnLabelCounts.map((r) => r.orderId));

  // Unlinked return_label emails, for the heuristic "blocked upstream" match:
  // same user, same retailer, never linked to any order (orderId: null).
  const unlinkedReturnLabelEmails = await prisma.email.findMany({
    where: { emailType: "return_label", orderId: null },
    select: { id: true, userId: true, retailer: true },
  });

  let bucketA = 0; // no relevant email at all
  let bucketB = 0; // email present but blocked upstream (heuristic retailer+user match to an unlinked email)
  let bucketC = 0; // email present (linked), extraction ran, no tracking pulled

  const bucketBDetails: { orderId: string; retailer: string | null; matchedUnlinkedEmailId: string }[] = [];
  const bucketADetails: { orderId: string; retailer: string | null; needsReview: boolean }[] = [];

  for (const orderId of outboundOrderIds) {
    if (linkedOrderIds.has(orderId)) {
      bucketC++;
      continue;
    }
    const meta = orderMetaById.get(orderId);
    const candidateUnlinked = meta
      ? unlinkedReturnLabelEmails.find((e) => e.userId === meta.userId && e.retailer && meta.retailer && e.retailer === meta.retailer)
      : undefined;
    if (candidateUnlinked) {
      bucketB++;
      bucketBDetails.push({ orderId, retailer: meta?.retailer ?? null, matchedUnlinkedEmailId: candidateUnlinked.id });
    } else {
      bucketA++;
      bucketADetails.push({ orderId, retailer: meta?.retailer ?? null, needsReview: meta?.needsReview ?? false });
    }
  }

  console.log(`\n-- Outbound (${outboundMissing.length} orders missing tracking) --`);
  console.log(`  (a) no relevant email received at all: ${bucketA} (${pct(bucketA, outboundMissing.length)})`);
  console.log(
    `  (b) email present but blocked upstream (heuristic: an unlinked return_label email exists for the same user+retailer): ${bucketB} (${pct(bucketB, outboundMissing.length)})`,
  );
  console.log(`  (c) email present (linked), extraction ran, no tracking pulled: ${bucketC} (${pct(bucketC, outboundMissing.length)})`);
  console.log(
    `\n  NOTE on bucket (b): this is a best-effort heuristic (same userId + exact retailer-string match against an\n` +
      `  unlinked return_label email), not a guaranteed causal link — DB-field equality only, no fuzzy/model matching.`,
  );

  if (bucketADetails.length) {
    console.log(`  (a) detail: ${bucketADetails.map((d) => `${d.orderId}${d.needsReview ? " [needsReview]" : ""}`).join(", ")}`);
  }
  if (bucketBDetails.length) {
    console.log(`  (b) detail: ${bucketBDetails.map((d) => `order=${d.orderId} matched-email=${d.matchedUnlinkedEmailId}`).join(", ")}`);
  }

  // Supplementary global context (not folded into the per-order buckets above).
  const totalShipConf = await prisma.email.count({ where: { emailType: "shipping_confirmation" } });
  const unlinkedShipConf = await prisma.email.count({ where: { emailType: "shipping_confirmation", orderId: null } });
  const totalReturnLabel = await prisma.email.count({ where: { emailType: "return_label" } });
  const unlinkedReturnLabel = await prisma.email.count({ where: { emailType: "return_label", orderId: null } });
  console.log(`\n-- Supplementary context (email-level, not order-scoped) --`);
  console.log(`  shipping_confirmation emails: ${totalShipConf} total, ${unlinkedShipConf} never linked to any order`);
  console.log(`  return_label emails: ${totalReturnLabel} total, ${unlinkedReturnLabel} never linked to any order`);

  return {
    incomingMissingCount: incomingMissing.length,
    outboundMissingCount: outboundMissing.length,
    bucketA,
    bucketB,
    bucketC,
    bucketADetails,
    bucketBDetails,
    supplementary: { totalShipConf, unlinkedShipConf, totalReturnLabel, unlinkedReturnLabel },
  };
}

// ===========================================================================
// Appendix — DHL/USPS mislabel population size (cross-referenced via Q3
// body-text/URL inventory, NOT the format-regex from Q2, since Q2 confirmed
// the format check does not catch this class of collision).
// ===========================================================================
async function appendixDhlUspsPopulation(q2: Awaited<ReturnType<typeof auditCorrectness>>, q3: Awaited<ReturnType<typeof auditPdfChannel>>) {
  console.log("\n=== APPENDIX: DHL/USPS mislabel population size ===");
  console.log("Known-not-being-fixed-this-session item. Cross-referencing Q3's body-text/URL inventory against");
  console.log("Q2's assigned returnCarrier, since the Q2 format-regex check does not catch this class of collision.");

  const dhlOutboundOrderIds = new Set(q2.outboundCarrierSet.filter((o) => o.returnCarrier === "DHL").map((o) => o.id));

  const crossFlagged = q3.inventory.filter(
    (row) =>
      row.orderId &&
      dhlOutboundOrderIds.has(row.orderId) &&
      (row.carriersMentioned.includes("USPS") || row.urlsFound.some((u) => u.carrier === "USPS")),
  );

  console.log(`Outbound orders labeled returnCarrier=DHL: ${dhlOutboundOrderIds.size}`);
  console.log(
    `Of those, orders whose linked return_label email also mentions "USPS" in body text or contains a usps.com URL: ${crossFlagged.length}`,
  );
  for (const row of crossFlagged) {
    console.log(`  order=${row.orderId} retailer=${row.retailer ?? "(none)"} email=${row.emailId}`);
  }
  console.log(
    "This is a real (non-format) signal for the DHL/USPS collision population — not exhaustive (only checks return_label\n" +
      "body text/links, and only orders whose return_label email is actually linked), but a defensible lower bound.",
  );

  return { dhlOutboundCount: dhlOutboundOrderIds.size, crossFlaggedCount: crossFlagged.length, crossFlagged };
}

async function main() {
  console.log("PACKAGE-TRACKING SIGNAL AUDIT — READ ONLY. Zero writes, zero Anthropic/model calls.\n");
  console.log(`Run at: ${new Date().toISOString()}`);

  const q1 = await auditCoverage();
  const q2 = await auditCorrectness();
  const q3 = await auditPdfChannel();
  const q4 = await auditMissingTrackingDiagnosis(q1.incomingOrders, q1.outboundOrders);
  const appendix = await appendixDhlUspsPopulation(q2, q3);

  console.log("\n=== DONE. Zero writes performed. Zero model calls made. ===");

  return { q1, q2, q3, q4, appendix };
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
