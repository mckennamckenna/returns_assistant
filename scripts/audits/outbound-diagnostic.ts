// Diagnostic: why does outbound tracking fail on 12 of 14 return-eligible
// orders? TASKS.md 🔴 Now, 2026-09-04. Follows the 2026-09-04 tracking audit
// (Q1 outbound 2/14) and owner's priority call that returns are more
// product-critical than incoming.
//
// READ-ONLY. Zero writes, zero Anthropic/model calls. Prisma reads + the
// app's own decrypt() helper + parseTracking() (called read-only, exactly as
// production calls it — never writes its result anywhere here) + regex/
// string matching for the carrier/URL/attachment inventory.
//
// Usage: npx tsx scripts/audits/outbound-diagnostic.ts
import { PrismaClient } from "@prisma/client";
import { decrypt } from "../../lib/crypto";
import { parseTracking } from "../../lib/trackingParser";

const prisma = new PrismaClient();

// Carrier formats with a near-zero false-positive risk (a distinctive
// prefix, not just a bare digit count) — used to gate confidence on
// htmlStrippedReparse below. Verified by hand during this diagnostic: the
// bare-digit carriers (DHL 10-11 digits, FedEx 12/15 digits) happily match
// order numbers, RMA/SKU fragments, and other footer boilerplate once HTML
// tags are stripped and text runs get concatenated — e.g. a Zara order
// number ("Order No. 54421192781") and a RealReal footer ID fragment
// ("#23-8017818358-6") both spuriously matched DHL's pattern this way. Only
// prefix-distinctive carriers are trusted as a "confirmed" HTML-text-gap
// finding; a bare-digit-carrier hit is reported as "needs manual
// verification," never as confirmed.
const DISTINCTIVE_CARRIERS = new Set(["UPS", "Amazon Logistics", "OnTrac", "LaserShip", "UniUni"]);

// Mirrors the full CARRIERS list in lib/trackingParser.ts (10 carriers as of
// the 2026-09-04 expansion, commit efd5ea8) — used here only for the
// inventory (which carriers are mentioned/linked), not for extraction.
const CARRIER_DOMAINS: { name: string; domain: RegExp }[] = [
  { name: "UPS", domain: /\bups\.com\/track/i },
  { name: "USPS", domain: /\busps\.com/i },
  { name: "FedEx", domain: /\bfedex(?:track)?\.com/i },
  { name: "DHL", domain: /\bdhl\.com/i },
  { name: "Amazon Logistics", domain: /\btrack\.amazon\.com/i },
  { name: "OnTrac", domain: /\bontrac\.com/i },
  { name: "LaserShip", domain: /\blasership\.com/i },
  { name: "UniUni", domain: /\buniuni\.com/i },
  { name: "Veho", domain: /\bshipveho\.com/i },
  { name: "AxleHire", domain: /\baxlehire\.com/i },
];

// Redirect/click-tracking and returns-portal domains that can carry a real
// tracking destination without it ever being visible in the email body —
// distinct from "no signal at all." Not exhaustive; expand if the data shows
// more.
const REDIRECT_OR_PORTAL_DOMAINS: { name: string; domain: RegExp }[] = [
  { name: "EasyPost (tracking aggregator)", domain: /\btrack\.easypost\.com/i },
  { name: "Loop Returns (portal)", domain: /\bloopreturns\.com/i },
  { name: "SendGrid click-tracking", domain: /\.ct\.sendgrid\.net/i },
  { name: "Klaviyo click-tracking", domain: /\bclick\.klaviyo\.com/i },
  { name: "ReturnGO (portal)", domain: /\breturngo\.ai/i },
  { name: "Happy Returns (portal)", domain: /\bhappyreturns\.com/i },
  { name: "Narvar (portal)", domain: /\bnarvar\.com/i },
];

function findRedirectOrPortalUrls(text: string): { name: string; url: string }[] {
  const found: { name: string; url: string }[] = [];
  const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0];
    for (const c of REDIRECT_OR_PORTAL_DOMAINS) {
      if (c.domain.test(url)) {
        found.push({ name: c.name, url });
        break;
      }
    }
  }
  return found;
}

const CARRIER_NAME_PATTERNS: { name: string; pattern: RegExp }[] = [
  { name: "UPS", pattern: /\bUPS\b/i },
  { name: "USPS", pattern: /\bUSPS\b/i },
  { name: "FedEx", pattern: /\bFed\s?Ex\b/i },
  { name: "DHL", pattern: /\bDHL\b/i },
  { name: "Amazon Logistics", pattern: /\bAmazon\s?Logistics\b/i },
  { name: "OnTrac", pattern: /\bOnTrac\b/i },
  { name: "LaserShip", pattern: /\bLaserShip\b/i },
  { name: "UniUni", pattern: /\bUniUni\b/i },
  { name: "Veho", pattern: /\bVeho\b/i },
  { name: "AxleHire", pattern: /\bAxleHire\b/i },
  // Not yet supported anywhere in parseTracking() — kept in the inventory so
  // a name-only mention (no matching domain/regex above) surfaces as a real
  // "carrier we still don't support" candidate rather than silently vanishing.
  { name: "Canada Post", pattern: /\bCanada\s?Post\b/i },
  { name: "Royal Mail", pattern: /\bRoyal\s?Mail\b/i },
  { name: "Australia Post", pattern: /\bAustralia\s?Post\b/i },
  { name: "GLS", pattern: /\bGLS\b/ },
  { name: "Purolator", pattern: /\bPurolator\b/i },
];

function safeDecrypt(v: string | null): string | null {
  if (v == null) return null;
  try {
    return decrypt(v);
  } catch {
    return null;
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

// Any https URL that ISN'T a recognized carrier domain — candidate
// retailer-portal / other links, for manual judgment in the report.
function findNonCarrierUrls(text: string): string[] {
  const found = new Set<string>();
  const urlRe = /https?:\/\/[^\s"'<>)]+/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[0];
    const isCarrier = CARRIER_DOMAINS.some((c) => c.domain.test(url));
    if (!isCarrier) {
      try {
        found.add(new URL(url).hostname);
      } catch {
        // malformed URL — skip
      }
    }
  }
  return Array.from(found);
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

function classifyAttachments(rawJson: unknown): { pdfs: string[]; images: string[]; other: string[] } {
  const result = { pdfs: [] as string[], images: [] as string[], other: [] as string[] };
  if (!rawJson || typeof rawJson !== "object") return result;
  const attachments = (rawJson as { Attachments?: PostmarkAttachment[] }).Attachments;
  if (!Array.isArray(attachments)) return result;
  for (const a of attachments) {
    const type = (a.ContentType ?? "").toLowerCase();
    const name = (a.Name ?? "(unnamed)").toLowerCase();
    if (type.includes("pdf") || name.endsWith(".pdf")) {
      result.pdfs.push(a.Name ?? "(unnamed)");
    } else if (type.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(name)) {
      result.images.push(a.Name ?? "(unnamed)");
    } else {
      result.other.push(a.Name ?? "(unnamed)");
    }
  }
  return result;
}

type FailureMode =
  | "a_unsupported_carrier"
  | "b_pdf_attachment"
  | "c_image_or_qr"
  | "d_email_not_linked"
  | "e_other";

interface OrderDiagnostic {
  orderId: string;
  retailer: string | null;
  displayStatus: string;
  linkedReturnLabelEmails: number;
  unlinkedCandidateEmailId: string | null;
  reparsedNow: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null } | null;
  plainTextOnlyReparse: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null } | null;
  // parseTracking() called with HTML tags stripped and fed in as the
  // plainText argument — tests whether a tracking number sits as visible
  // HTML text (e.g. inside an <a> tag's link text) that the real pipeline
  // never sees, because it only ever passes the separate textBody field to
  // the plain-text fallback, never a stripped version of htmlBody.
  htmlStrippedReparse: { carrier: string | null; trackingNumber: string | null; trackingUrl: string | null } | null;
  carriersMentioned: string[];
  carrierUrlsFound: { carrier: string; url: string }[];
  nonCarrierUrls: string[];
  redirectOrPortalUrls: { name: string; url: string }[];
  pdfAttachments: string[];
  imageAttachments: string[];
  failureMode: FailureMode;
  failureModeNote: string;
}

async function main() {
  console.log("OUTBOUND TRACKING-FAILURE DIAGNOSTIC — READ ONLY. Zero writes, zero Anthropic/model calls.\n");
  console.log(`Run at: ${new Date().toISOString()}`);

  const outboundEligible = await prisma.order.findMany({
    where: { displayStatus: { in: ["return_requested", "returned"] } },
    select: {
      id: true,
      retailer: true,
      userId: true,
      displayStatus: true,
      returnCarrier: true,
      returnTrackingNumber: true,
      returnTrackingUrl: true,
    },
  });
  const missing = outboundEligible.filter((o) => !(o.returnTrackingNumber && o.returnTrackingUrl));

  console.log(`\nOutbound eligible: ${outboundEligible.length}. Missing tracking: ${missing.length}.`);
  if (missing.length !== 12) {
    console.log(
      `NOTE: expected 12 per the 2026-09-04 audit; found ${missing.length}. Data has moved since — report against the actual current count.`,
    );
  }

  // Unlinked return_label emails, for the "should this have been linked?" check.
  const unlinkedReturnLabelEmails = await prisma.email.findMany({
    where: { emailType: "return_label", orderId: null },
    select: { id: true, userId: true, retailer: true },
  });

  const results: OrderDiagnostic[] = [];

  for (const order of missing) {
    const linkedEmails = await prisma.email.findMany({
      where: { orderId: order.id, emailType: "return_label" },
      select: { id: true, subject: true, textBody: true, htmlBody: true, rawJson: true },
    });

    let unlinkedCandidateEmailId: string | null = null;
    if (linkedEmails.length === 0) {
      const candidate = unlinkedReturnLabelEmails.find((e) => e.userId === order.userId && e.retailer && order.retailer && e.retailer === order.retailer);
      unlinkedCandidateEmailId = candidate?.id ?? null;
    }

    let reparsedNow: OrderDiagnostic["reparsedNow"] = null;
    let plainTextOnlyReparse: OrderDiagnostic["plainTextOnlyReparse"] = null;
    let htmlStrippedReparse: OrderDiagnostic["htmlStrippedReparse"] = null;
    let carriersMentioned: string[] = [];
    let carrierUrlsFound: { carrier: string; url: string }[] = [];
    let nonCarrierUrls: string[] = [];
    let redirectOrPortalUrls: { name: string; url: string }[] = [];
    let pdfAttachments: string[] = [];
    let imageAttachments: string[] = [];

    for (const email of linkedEmails) {
      const decryptedText = safeDecrypt(email.textBody);
      const decryptedHtml = safeDecrypt(email.htmlBody);
      const decryptedRawJson = safeDecrypt(email.rawJson);

      // Does the CURRENT (post-carrier-expansion) parser succeed on this
      // email today, in a way that would actually surface a tracking link
      // (the UI's own render condition — both trackingNumber AND
      // trackingUrl, not carrier alone)? This is a read-only re-parse for
      // diagnostic purposes only — its result is never written anywhere.
      const parsed = parseTracking(decryptedText, decryptedHtml);
      if (parsed.trackingNumber && parsed.trackingUrl) reparsedNow = parsed;

      // Isolate the plain-text fallback specifically (pass html: null) to
      // check whether a real number exists in body text even when an HTML
      // link match already "won" and short-circuited phase 1 without a
      // usable number (the DHL-locator-link pattern seen in the 2026-09-04
      // audit's Q2 sanity check).
      if (decryptedText) {
        const textOnly = parseTracking(decryptedText, null);
        if (textOnly.carrier || textOnly.trackingNumber) plainTextOnlyReparse = textOnly;
      }

      // Strip HTML tags and feed the result through the SAME plain-text
      // fallback — tests whether a tracking number is sitting as visible
      // link text (e.g. <a href="https://track.easypost.com/...">1Z...</a>)
      // that the real pipeline never sees, since fromPlainText() only ever
      // receives the separate textBody field, never htmlBody-as-text.
      if (decryptedHtml) {
        const stripped = decryptedHtml.replace(/<[^>]+>/g, " ");
        const strippedResult = parseTracking(stripped, null);
        if (strippedResult.carrier || strippedResult.trackingNumber) htmlStrippedReparse = strippedResult;
      }

      const combinedText = [email.subject ?? "", decryptedText ?? "", decryptedHtml ?? ""].join("\n");
      carriersMentioned = Array.from(new Set([...carriersMentioned, ...findCarrierNameMentions(combinedText)]));
      carrierUrlsFound = [...carrierUrlsFound, ...findAllCarrierUrls(combinedText)];
      nonCarrierUrls = Array.from(new Set([...nonCarrierUrls, ...findNonCarrierUrls(combinedText)]));
      redirectOrPortalUrls = [...redirectOrPortalUrls, ...findRedirectOrPortalUrls(combinedText)];

      if (decryptedRawJson) {
        try {
          const parsedJson = JSON.parse(decryptedRawJson);
          const { pdfs, images } = classifyAttachments(parsedJson);
          pdfAttachments = [...pdfAttachments, ...pdfs];
          imageAttachments = [...imageAttachments, ...images];
        } catch {
          // malformed rawJson — skip attachment inventory for this email
        }
      }
    }

    // Failure-mode categorization. Ordered most-specific/most-confident
    // first. Every branch describes what was ACTUALLY found — no branch
    // claims "nothing found" unless carriersMentioned/nonCarrierUrls/
    // redirectOrPortalUrls/pdfAttachments/imageAttachments are all genuinely
    // empty, to avoid the false "no signal" claim a cruder version of this
    // script made on its first pass (see 2026-09-04 outbound-diagnostic
    // report for that correction).
    const KNOWN_SUPPORTED_CARRIERS = ["UPS", "USPS", "FedEx", "DHL", "Amazon Logistics", "OnTrac", "LaserShip", "UniUni", "Veho", "AxleHire"];
    let failureMode: FailureMode;
    let failureModeNote: string;

    if (linkedEmails.length === 0) {
      failureMode = "d_email_not_linked";
      failureModeNote = unlinkedCandidateEmailId
        ? `No return_label email linked; a same-user/same-retailer unlinked one exists (${unlinkedCandidateEmailId}) that plausibly should have been.`
        : "No return_label email linked, and no unlinked candidate found for this user+retailer — no relevant email in the system at all.";
    } else if (reparsedNow) {
      failureMode = "a_unsupported_carrier";
      failureModeNote = `Re-parsing the linked email TODAY surfaces a full trackingNumber+trackingUrl pair (carrier=${reparsedNow.carrier}, trackingNumber=${reparsedNow.trackingNumber}) that the parser at ingestion time did not. Confirm whether this carrier was one of the six added in the 2026-09-04 expansion (efd5ea8) or was already supported and simply not reprocessed. Not auto-fixed (no backfill, per scope).`;
    } else if (htmlStrippedReparse && htmlStrippedReparse.carrier && DISTINCTIVE_CARRIERS.has(htmlStrippedReparse.carrier)) {
      failureMode = "e_other";
      failureModeNote = `CONFIRMED: tracking number is present in the email as visible HTML text (carrier=${htmlStrippedReparse.carrier}, trackingNumber=${htmlStrippedReparse.trackingNumber}, distinctive format — low false-positive risk) but is invisible to the real pipeline — parseTracking()'s plain-text fallback only ever receives the separate textBody field, never a stripped version of htmlBody. Real, characterized parser gap, not a data-absence case. Not fixed here (out of scope).`;
    } else if (htmlStrippedReparse && htmlStrippedReparse.trackingNumber) {
      failureMode = "e_other";
      failureModeNote = `UNVERIFIED, LIKELY FALSE POSITIVE: HTML-stripped-as-text re-parse found a ${htmlStrippedReparse.carrier}-shaped number (${htmlStrippedReparse.trackingNumber}) via a bare-digit-count pattern, which this diagnostic confirmed (by hand, on other orders) frequently matches order numbers/RMA fragments/footer IDs rather than real tracking numbers once HTML is flattened to text. Needs manual verification against the source email before treating this as a real gap — do not act on this number without checking it first.`;
    } else if (carrierUrlsFound.length > 0) {
      failureMode = "e_other";
      failureModeNote = `A known-carrier URL is present (${carrierUrlsFound.map((u) => `${u.carrier}:${u.url}`).join(" | ")}) but no tracking number is extractable from it, from plain text, or from HTML-stripped-as-text. Consistent with a generic carrier locator/landing page (e.g. a bare https://locator.dhl.com link) that never carried a specific tracking ID in this email at all — not a parser gap, the ID itself doesn't appear to be present.`;
    } else if (redirectOrPortalUrls.length > 0) {
      failureMode = "e_other";
      failureModeNote = `Only a redirect/click-tracking or returns-portal link is present (${redirectOrPortalUrls.map((u) => `${u.name}:${u.url}`).join(" | ")}), with no visible carrier domain, tracking number, PDF, or image. The real tracking destination (if any) is one hop behind this link — matches the "redirect resolution" pattern already logged as deferred in DECISIONS.md (2026-09-04), just via a different link-wrapper (SendGrid/Loop Returns/etc. rather than Klaviyo).`;
    } else if (pdfAttachments.length > 0) {
      failureMode = "b_pdf_attachment";
      failureModeNote = `No carrier link, redirect/portal link, or carrier name found; ${pdfAttachments.length} PDF attachment(s) present (${pdfAttachments.join(", ")}) — tracking is plausibly inside the PDF, which the pipeline doesn't read.`;
    } else if (imageAttachments.length > 0) {
      failureMode = "c_image_or_qr";
      failureModeNote = `No carrier link, redirect/portal link, carrier name, or PDF found; ${imageAttachments.length} image attachment(s) present (${imageAttachments.join(", ")}) — plausible QR-code-only label, which the pipeline doesn't read.`;
    } else if (carriersMentioned.some((name) => !KNOWN_SUPPORTED_CARRIERS.includes(name))) {
      const unsupported = carriersMentioned.filter((name) => !KNOWN_SUPPORTED_CARRIERS.includes(name));
      failureMode = "a_unsupported_carrier";
      failureModeNote = `Carrier name(s) mentioned that parseTracking() still has no pattern for: ${unsupported.join(", ")}.`;
    } else if (carriersMentioned.length > 0) {
      // A supported carrier's NAME appears (e.g. "UPS"), but none of its
      // signals (domain URL, format-matching number) were found anywhere —
      // most likely a location/venue mention (e.g. "Drop off at THE UPS
      // STORE, <address>"), not a tracking reference at all.
      failureMode = "e_other";
      failureModeNote = `Carrier name(s) mentioned (${carriersMentioned.join(", ")}) but no matching URL or tracking-number format found anywhere (including HTML-stripped-as-text) — likely a drop-off location/venue mention (e.g. "THE UPS STORE, <address>"), not an actual tracking reference. Check per-order detail for retailer-specific context (e.g. Amazon's no-box QR/print-label return flow, where the carrier name appears only as a drop-off venue and no tracking number is ever stated in the email).`;
    } else {
      failureMode = "e_other";
      failureModeNote = "No carrier name, carrier URL, redirect/portal URL, PDF, or image signal found anywhere in the linked email(s) — genuinely no tracking-adjacent signal present. Needs a manual read of the full email body (see subject in report) to characterize further.";
    }

    results.push({
      orderId: order.id,
      retailer: order.retailer,
      displayStatus: order.displayStatus,
      linkedReturnLabelEmails: linkedEmails.length,
      unlinkedCandidateEmailId,
      reparsedNow,
      plainTextOnlyReparse,
      htmlStrippedReparse,
      carriersMentioned,
      carrierUrlsFound,
      nonCarrierUrls,
      redirectOrPortalUrls,
      pdfAttachments,
      imageAttachments,
      failureMode,
      failureModeNote,
    });
  }

  console.log("\n=== PER-ORDER BREAKDOWN ===");
  for (const r of results) {
    console.log(`\n-- order=${r.orderId} retailer=${r.retailer ?? "(none)"} status=${r.displayStatus} --`);
    console.log(`  linked return_label emails: ${r.linkedReturnLabelEmails}${r.unlinkedCandidateEmailId ? ` (unlinked candidate: ${r.unlinkedCandidateEmailId})` : ""}`);
    console.log(`  carriers mentioned: [${r.carriersMentioned.join(", ")}]`);
    console.log(`  carrier URLs found: [${r.carrierUrlsFound.map((u) => `${u.carrier}:${u.url}`).join(" | ")}]`);
    console.log(`  redirect/portal URLs found: [${r.redirectOrPortalUrls.map((u) => `${u.name}:${u.url}`).join(" | ")}]`);
    console.log(`  non-carrier URLs: [${r.nonCarrierUrls.join(", ")}]`);
    console.log(`  PDF attachments: [${r.pdfAttachments.join(", ")}]`);
    console.log(`  image attachments: [${r.imageAttachments.join(", ")}]`);
    console.log(`  re-parse today (full, requires trackingNumber+trackingUrl): ${JSON.stringify(r.reparsedNow)}`);
    console.log(`  re-parse today (plain-text-only): ${JSON.stringify(r.plainTextOnlyReparse)}`);
    console.log(`  re-parse today (HTML-stripped-as-text): ${JSON.stringify(r.htmlStrippedReparse)}`);
    console.log(`  FAILURE MODE: (${r.failureMode}) ${r.failureModeNote}`);
  }

  console.log("\n=== SUMMARY TALLY BY FAILURE MODE ===");
  const tally = new Map<FailureMode, number>();
  for (const r of results) tally.set(r.failureMode, (tally.get(r.failureMode) ?? 0) + 1);
  for (const [mode, count] of tally) console.log(`  ${mode}: ${count}`);

  console.log("\n=== DONE. Zero writes performed. Zero model calls made. ===");

  return results;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
