import type { Email } from "@prisma/client";
import { prisma } from "@/lib/db";
import { extractEmailIdentity, finalizeExtraction, type ExistingOrderContext } from "@/lib/extract";
import { linkEmailToOrder, findMatchingOrder } from "@/lib/linkOrder";
import { decrypt } from "@/lib/crypto";
import { resolveBodyTextWithAlternate } from "@/lib/emailBodyText";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { isFoodGroceryRetailer } from "@/lib/foodGroceryExclusion";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback, isCarrierSender } from "@/lib/retailerFallback";

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

    // email.anchorDate is resolved at ingestion (lib/forwardResolver.ts),
    // before this ever runs, and is already on the row this function holds —
    // no extra read. Passed to extraction as the reference for year-less
    // dates (buildPrompt) and, below, to finalizeExtraction for the
    // ANCHOR_DATE_RESOLVER.md Part 3 sanity guard. Null for an unresolved
    // manual forward, which both consumers treat as "no reference, don't
    // guess."
    // `?? null` normalizes the one shape Prisma never produces but a
    // hand-built caller can (an object literal with the field omitted) —
    // both consumers treat null as "no reference, don't guess," so this
    // keeps that single meaning rather than letting undefined leak through.
    const anchorDate = email.anchorDate ?? null;

    const parsed = await extractEmailIdentity(body, email.subject ?? null, emailId, alternateBody, anchorDate);

    // Sender-derived retailer fallback (ZARA_RETAILER_FALLBACK, 2026-08-25,
    // Decision 1/2/3 — see lib/retailerFallback.ts and
    // ZARA_DIAGNOSTIC_FINDINGS_20260825.md / ZARA_DIAGNOSTIC_FINDINGS_
    // BACKFILL_RADIUS_20260825.md) — computed here, BEFORE the policy-
    // lookup gate below, instead of after finalizeExtraction returns.
    // TASKS.md 2026-09-11/13 fix session: the previous ordering computed
    // this fallback only after finalizeExtraction had already run, so a
    // body-extraction null silently skipped the billed lookup gate (and
    // the Amazon/food-grocery short-circuits) even on emails where this
    // fallback would go on to resolve a real retailer moments later.
    // Deliberately does NOT mutate parsed.retailer — retailerSource
    // below still needs to distinguish "body extraction found it" from
    // "sender fallback guessed it," which would be impossible to recover
    // once parsed.retailer no longer reflected body-extraction-only.
    // `fallback` is reused below at the write, instead of being
    // recomputed a second time.
    const fallback =
      parsed.retailer == null && parsed.emailType != null && RETAILER_FALLBACK_GATE_EMAIL_TYPES.has(parsed.emailType)
        ? resolveRetailerFallback(decrypt(email.fromEmail), email.fromName ? decrypt(email.fromName) : null)
        : null;
    const effectiveRetailer = parsed.retailer ?? fallback?.retailer ?? null;

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
    // them at ingestion, before any Email row exists. Uses
    // effectiveRetailer (not parsed.retailer) so a sender-fallback-
    // resolved retailer benefits from the existing-order skip too — see
    // TASKS.md 2026-09-11/13 fix session, Gate 1 consumer #5.
    let existingOrder: ExistingOrderContext | null = null;
    const mayTriggerPolicyLookup =
      parsed.returnWindowDays == null &&
      !(isAmazonOrder(effectiveRetailer) && parsed.emailType !== "other") &&
      !isFoodGroceryRetailer(effectiveRetailer);

    if (mayTriggerPolicyLookup && effectiveRetailer && parsed.orderNumber) {
      const match = await findMatchingOrder(email.userId, effectiveRetailer, parsed.orderNumber);
      if (match) {
        existingOrder = { returnWindowDays: match.order.returnWindowDays };
      }
    }

    // Envelope fact, not a body fact — computed here because this is where
    // the decrypted From header is available. Deliberately independent of
    // `fallback` above: that only resolves when body extraction found NO
    // retailer, so it cannot answer "did a carrier send this" for the H&M
    // case (UPS sender, body names H&M). TASKS.md 2026-09-21, root cause (a).
    const senderIsCarrier = isCarrierSender(decrypt(email.fromEmail));

    const result = await finalizeExtraction(
      parsed,
      emailId,
      existingOrder,
      effectiveRetailer,
      anchorDate,
      senderIsCarrier,
    );

    // Sender-derived retailer fallback WRITE. Reuses `fallback` computed
    // above rather than re-deriving it — the gating condition below
    // (`result.retailer == null && fallback`) is equivalent to the
    // original `result.retailer == null && result.emailType != null &&
    // RETAILER_FALLBACK_GATE_EMAIL_TYPES.has(result.emailType)`, because
    // `fallback` was computed from that same emailType gate against
    // parsed.emailType, and finalizeExtraction never reassigns
    // parsed.emailType or parsed.retailer — result.retailer ===
    // parsed.retailer and result.emailType === parsed.emailType always.
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
    let finalCarrier: string | null = null;

    if (result.retailer == null && fallback) {
      finalRetailer = fallback.retailer;
      retailerSource = fallback.retailerSource;
      finalCarrier = fallback.carrier;
    }

    await prisma.email.update({
      where: { id: emailId },
      data: {
        emailType: result.emailType,
        retailer: finalRetailer,
        retailerSource,
        carrier: finalCarrier,
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
