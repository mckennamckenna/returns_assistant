import type { Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { extractEmailIdentity, finalizeExtraction, type ExistingOrderContext } from "@/lib/extract";
import { linkEmailToOrder, findMatchingOrder } from "@/lib/linkOrder";
import { decrypt } from "@/lib/crypto";
import { resolveBodyTextWithAlternate } from "@/lib/emailBodyText";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { isFoodGroceryRetailer } from "@/lib/foodGroceryExclusion";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback } from "@/lib/retailerFallback";

// Accepts either an id (scripts and the manual re-extract action only ever
// hold an id) or the row itself (the inbound route, which already has the
// object it just created 3 lines earlier). Passing the object skips the
// re-fetch entirely for that caller. The re-fetch (for id-based callers) now
// lives INSIDE the try/catch below -- previously it sat outside it, so a
// throw there (e.g. a DB hiccup in the instant right after the row's own
// create()) left the row silently extractedAt: null / needsReview: false,
// indistinguishable from "never called," with no retry path. TASKS.md
// 2026-08-08 traced this as the sole source of that state.
export async function runExtraction(emailOrId: string | Email): Promise<void> {
  const emailId = typeof emailOrId === "string" ? emailOrId : emailOrId.id;

  try {
    const email = typeof emailOrId === "string" ? await prisma.email.findUnique({ where: { id: emailOrId } }) : emailOrId;
    if (!email) {
      // Genuinely no row under this id (bad/stale id passed in) -- nothing
      // to flag on, but logged so a bad caller is visible, not silent.
      console.error("runExtraction: no email row found for id", emailId);
      return;
    }

    const decryptedTextBody = email.textBody ? decrypt(email.textBody) : null;
    const decryptedHtmlBody = email.htmlBody ? decrypt(email.htmlBody) : null;
    const { primary: body, alternate: alternateBody } = resolveBodyTextWithAlternate(decryptedTextBody, decryptedHtmlBody);

    if (!body) {
      throw new Error("no textBody or htmlBody to extract from");
    }

    const parsed = await extractEmailIdentity(body, email.subject ?? null, emailId, alternateBody);

    // Deterministic-match pre-check only (TASKS.md 2026-08-24) — finds
    // whether this email is about to link to an existing order that
    // already has a resolved return policy, so finalizeExtraction can skip
    // the billed web-search lookup. Skipped entirely for retailers that
    // never reach the billed branch regardless — Amazon default and
    // food/grocery exclusion, the same checks finalizeExtraction itself
    // uses (isAmazonOrder/isFoodGroceryRetailer, reused not
    // reimplemented) — so the extra DB read only happens where it could
    // actually save a billed call. RX/prescription emails never reach
    // this function at all: isCommerceEmail (lib/classify.ts) discards
    // them at ingestion, before any Email row exists.
    let existingOrder: ExistingOrderContext | null = null;
    const mayTriggerPolicyLookup =
      parsed.returnWindowDays == null &&
      !(isAmazonOrder(parsed.retailer) && parsed.emailType !== "other") &&
      !isFoodGroceryRetailer(parsed.retailer);

    if (mayTriggerPolicyLookup && parsed.retailer && parsed.orderNumber) {
      const match = await findMatchingOrder(email.userId, parsed.retailer, parsed.orderNumber);
      if (match) {
        existingOrder = { returnWindowDays: match.order.returnWindowDays };
      }
    }

    const result = await finalizeExtraction(parsed, emailId, existingOrder);

    // Sender-derived retailer fallback (ZARA_RETAILER_FALLBACK, 2026-08-25,
    // Decision 1/2/3 — see lib/retailerFallback.ts and
    // ZARA_DIAGNOSTIC_FINDINGS_20260825.md / ZARA_DIAGNOSTIC_FINDINGS_
    // BACKFILL_RADIUS_20260825.md). Body extraction always "ran" by this
    // point in this function — extractedAt is set on the same write below —
    // so Decision 2 condition (i) is satisfied by construction here; only
    // (ii) the emailType gate and (iii) whether the fallback resolves
    // anything still need checking. buildPrompt() (lib/extract.ts:207)
    // still never reads the From header for the body-extraction pass
    // itself — this only fires AFTER that pass has already returned null.
    //
    // Table 3 reconciliation (see commit 5fbc968's preview): the design's
    // "Zara rows flip from degrade branch to retailer-populated branch"
    // language did not play out for the 3 Zara rows live at build time,
    // because those rows already carried orderNumber = "54421192781" and
    // needsReviewRows.ts:78's routing predicate is (email.retailer ||
    // email.orderNumber) — the OR was already satisfied via orderNumber,
    // so the branch was already correct pre-fix. The write-to-field
    // decision (over UI-only, see lib/retailerFallback.ts) is still
    // correct on its own merits — the routing branch WILL matter for a
    // future Zara-shaped row arriving without an extracted orderNumber,
    // where UI-only would route incorrectly and this fix routes
    // correctly. For those 3 rows specifically, this fix shipped as a
    // display/labeling improvement; forward-looking routing correctness
    // is preserved for rows this population didn't happen to exercise.
    let finalRetailer = result.retailer;
    let retailerSource: "body_extraction" | "sender_fallback" | "carrier_deferred" | null =
      result.retailer != null ? "body_extraction" : null;

    if (result.retailer == null && result.emailType != null && RETAILER_FALLBACK_GATE_EMAIL_TYPES.has(result.emailType)) {
      const decryptedFromEmail = decrypt(email.fromEmail);
      const decryptedFromName = email.fromName ? decrypt(email.fromName) : null;
      const fallback = resolveRetailerFallback(decryptedFromEmail, decryptedFromName);
      finalRetailer = fallback.retailer;
      retailerSource = fallback.retailerSource;
    }

    await prisma.email.update({
      where: { id: emailId },
      data: {
        emailType: result.emailType,
        retailer: finalRetailer,
        retailerSource,
        orderNumber: result.orderNumber,
        orderDate: result.orderDate ? new Date(result.orderDate) : null,
        deliveryDate: result.deliveryDate ? new Date(result.deliveryDate) : null,
        estimatedDeliveryDate: result.estimatedDeliveryDate ? new Date(result.estimatedDeliveryDate) : null,
        deliveredAt: result.deliveredAt ? new Date(result.deliveredAt) : null,
        returnWindowDays: result.returnWindowDays,
        returnWindowStartsFrom: result.returnWindowStartsFrom,
        returnDeadline: result.returnDeadline ? new Date(result.returnDeadline) : null,
        deadlineIsEstimated: result.deadlineIsEstimated,
        policySource: result.policySource,
        orderTotal: result.orderTotal,
        orderCurrency: result.orderCurrency,
        refundAmount: result.refundAmount,
        refundAmountConfidence: result.refundAmountConfidence,
        lineItems: result.lineItems as object,
        confidence: result.confidence,
        needsReview: result.needsReview,
        extractionNotes: result.notes,
        extractionRaw: result as object,
        extractedAt: new Date(),
      },
    });

    await linkEmailToOrder(emailId, result.returnPortalUrl);
  } catch (error) {
    console.error("Extraction failed for email", emailId, error);

    await prisma.email.update({
      where: { id: emailId },
      data: { needsReview: true, extractedAt: new Date() },
    });
  }
}
