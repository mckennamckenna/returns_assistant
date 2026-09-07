// Dry-run simulation of full recovery for the 106 remaining eligible
// self_outbound_loop discards (118 eligible minus the 12 the founder pilot
// already processed for real). TASKS.md 🔴 Now, self-outbound guard fix.
//
// Makes REAL billed Anthropic calls (isCommerceEmail/Haiku,
// extractEmailIdentity/Sonnet + retry, finalizeExtraction's policy_lookup
// web search) — those are not simulated, per the task brief. Writes
// NOTHING to Email or Order. The only DB writes this script makes are to
// the new DryRunCache table (see prisma/schema.prisma), which exists
// purely so a later real recovery pass can skip re-billing the
// content-only calls (isCommerceEmail, base extraction) for the same
// messageIds — never touches Email/Order.
//
// Mirrors app/api/inbound/route.ts + lib/runExtraction.ts + lib/linkOrder.ts's
// linkEmailToOrder decision tree exactly, using the real, unmodified
// helper functions (classifyForwardType, detectSelfOutboundLoop,
// shouldAutoJunk, isFoodGroceryRetailer, findMatchingOrder,
// findRefundFallbackOrder) for every read/decision, and the real
// mergeEmailIntoOrder/createOrderFromEmail for the merge-field computation
// (via the new dryRunSink parameter, which skips their prisma writes and
// hands back the computed data instead). The orchestration/branching
// itself is re-expressed here rather than calling linkEmailToOrder
// directly, because that function operates by re-fetching an Email row by
// id — something dry-run deliberately never creates.
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { classifyForwardType } from "../../lib/forwardResolver";
import { detectSelfOutboundLoop } from "../../lib/selfOutboundGuard";
import { extractDomain, isFoodGroceryDomain, isFoodGroceryRetailer } from "../../lib/foodGroceryExclusion";
import { isUspsCarrierDomain } from "../../lib/uspsCarrierPingExclusion";
import { shouldAutoJunk } from "../../lib/junk";
import { isCommerceEmail } from "../../lib/classify";
import { extractEmailIdentity, finalizeExtraction, type RawExtraction, type ExistingOrderContext } from "../../lib/extract";
import { resolveBodyTextWithAlternate, resolveBodyText } from "../../lib/emailBodyText";
import { findMatchingOrder, findRefundFallbackOrder, mergeEmailIntoOrder, createOrderFromEmail, type DryRunSink } from "../../lib/linkOrder";
import { isAmazonOrder } from "../../lib/amazonBundle";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback } from "../../lib/retailerFallback";
import { resolveAnchorDate } from "../../lib/forwardResolver";

process.env.REMINDER_FROM_EMAIL = process.env.REMINDER_FROM_EMAIL || "reminders@myreturnwindow.com";
process.env.LOGIN_FROM_EMAIL = process.env.LOGIN_FROM_EMAIL || "hello@myreturnwindow.com";

const prisma = new PrismaClient();
const dir = "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/dryrun106";
const scope = JSON.parse(
  fs.readFileSync(
    "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/dryrun_scope_with_tokens.json",
    "utf8",
  ),
);

const COMMERCE_SHAPED_KEYWORDS = ["order", "confirmation", "receipt", "shipped", "delivered", "refund", "tracking"];

interface RowResult {
  messageId: string;
  userId: string | null;
  receivedAt: string;
  from: string;
  subject: string;
  commerceResult: "commerce" | "non_commerce" | "error";
  classifierFalseNegative: boolean;
  emailType: string | null;
  orderNumber: string | null;
  retailer: string | null;
  outcome: "NEW_ORDER" | "MERGE" | "NO_LINK" | "ERROR" | "SKIPPED_DUPLICATE" | "SKIPPED_SELF_OUTBOUND";
  // Which findMatchingOrder/findRefundFallbackOrder tier resolved this
  // merge — null for NEW_ORDER/NO_LINK. This is the signal the real
  // linkEmailToOrder uses (its isPrefixMatchedOrder/isRefundFallbackMatch
  // flags) to force needsReview:true + append a userNote after merging —
  // a real, disclosed dry-run gap (that forcing step isn't simulated), so
  // this column lets the report flag which MERGE rows the real system
  // would additionally route to human review beyond whatever field-level
  // changes mergeEmailIntoOrder itself produces.
  matchTier: "exact" | "prefix" | "retailer_prefix" | "refund_fallback_line_item_overlap" | "refund_fallback_total_match" | "refund_fallback_recency" | null;
  targetOrderId: string | null;
  targetOrderNumber: string | null;
  targetOrderRetailer: string | null;
  fieldChanges: Record<string, { before: unknown; after: unknown; classification: string }> | null;
  errorMsg: string | null;
}

function classify(before: unknown, after: unknown): string {
  if (after == null) return "NO_CHANGE";
  if (before == null) return "FILL_NULL";
  if (JSON.stringify(before) === JSON.stringify(after)) return "NO_CHANGE";
  return "OVERWRITE";
}

async function main() {
  const results: RowResult[] = [];

  for (const item of scope) {
    const messageId = item.messageId as string;
    const file = `${dir}/${messageId}.json`;
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));

    const user = await prisma.user.findUnique({ where: { inboundToken: item.token }, select: { id: true } });
    const userId = user?.id ?? null;

    const row: RowResult = {
      messageId,
      userId,
      receivedAt: payload.Date,
      from: payload.FromFull?.Email ?? "",
      subject: (payload.Subject ?? "").slice(0, 60),
      commerceResult: "error",
      classifierFalseNegative: false,
      emailType: null,
      orderNumber: null,
      retailer: null,
      outcome: "ERROR",
      matchTier: null,
      targetOrderId: null,
      targetOrderNumber: null,
      targetOrderRetailer: null,
      fieldChanges: null,
      errorMsg: null,
    };

    try {
      if (!userId) throw new Error(`no user found for token ${item.token}`);

      // Dedup check (real read, same as app/api/inbound/route.ts) — should
      // be none, since these are eligible discards, but verified per row.
      const existingEmail = await prisma.email.findFirst({ where: { userId, messageId }, select: { id: true } });
      if (existingEmail) {
        row.outcome = "SKIPPED_DUPLICATE";
        results.push(row);
        continue;
      }

      const forwardType = classifyForwardType(payload.Headers);
      const bodyText = resolveBodyText(payload.TextBody ?? null, payload.HtmlBody ?? null);
      const { anchorDate } = resolveAnchorDate({
        forwardType,
        headers: payload.Headers,
        bodyText,
        receivedAt: new Date(payload.Date),
      });

      const selfOutbound = detectSelfOutboundLoop({ fromEmail: payload.FromFull?.Email, headers: payload.Headers, forwardType });
      if (selfOutbound.isSelfOutbound) {
        row.outcome = "SKIPPED_SELF_OUTBOUND";
        results.push(row);
        continue;
      }

      // Mirrors app/api/inbound/route.ts's shouldAutoJunk({emailType: null, orderId: null, fromDomain})
      // pre-extraction check exactly — both of its sender-domain conditions,
      // checked before isCommerceEmail ever fires (real cost win, real skip).
      const fromDomain = extractDomain(payload.FromFull?.Email ?? "");
      if (fromDomain && (isFoodGroceryDomain(fromDomain) || isUspsCarrierDomain(fromDomain))) {
        row.commerceResult = "non_commerce"; // pre-junk skip, never reaches the classifier
        row.outcome = "NO_LINK";
        results.push(row);
        continue;
      }

      // --- Cache check / isCommerceEmail + base extraction ---
      let isCommerce: boolean;
      let parsed: RawExtraction | null = null;
      const cached = await prisma.dryRunCache.findUnique({ where: { messageId } });
      if (cached) {
        isCommerce = cached.isCommerce;
        parsed = cached.extractionResult as unknown as RawExtraction | null;
      } else {
        isCommerce = await isCommerceEmail(payload.TextBody, payload.HtmlBody);
        if (isCommerce) {
          const { primary, alternate } = resolveBodyTextWithAlternate(payload.TextBody ?? null, payload.HtmlBody ?? null);
          if (!primary) {
            isCommerce = false; // mirrors runExtraction's "no textBody or htmlBody to extract from" throw path
          } else {
            parsed = await extractEmailIdentity(primary, payload.Subject ?? null, `DRYRUN-${messageId}`, alternate);
          }
        }
        await prisma.dryRunCache.create({
          data: { messageId, isCommerce, extractionResult: parsed as unknown as object | undefined },
        });
      }

      row.commerceResult = isCommerce ? "commerce" : "non_commerce";
      const subjLower = (payload.Subject ?? "").toLowerCase();
      if (!isCommerce && COMMERCE_SHAPED_KEYWORDS.some((k) => subjLower.includes(k))) {
        row.classifierFalseNegative = true;
      }

      if (!isCommerce || !parsed) {
        row.outcome = "NO_LINK";
        results.push(row);
        continue;
      }

      // --- finalizeExtraction (policy_lookup stage — always real, never cached) ---
      const mayTriggerPolicyLookup =
        parsed.returnWindowDays == null &&
        !(isAmazonOrder(parsed.retailer) && parsed.emailType !== "other") &&
        !isFoodGroceryRetailer(parsed.retailer);

      let existingOrder: ExistingOrderContext | null = null;
      if (mayTriggerPolicyLookup && parsed.retailer && parsed.orderNumber) {
        const match = await findMatchingOrder(userId, parsed.retailer, parsed.orderNumber);
        if (match) existingOrder = { returnWindowDays: match.order.returnWindowDays };
      }

      const result = await finalizeExtraction(parsed, `DRYRUN-${messageId}`, existingOrder);

      let finalRetailer = result.retailer;
      let finalCarrier: string | null = null;
      if (result.retailer == null && result.emailType != null && RETAILER_FALLBACK_GATE_EMAIL_TYPES.has(result.emailType)) {
        const fallback = resolveRetailerFallback(payload.FromFull?.Email ?? "", payload.FromFull?.Name ?? null);
        finalRetailer = fallback.retailer;
        finalCarrier = fallback.carrier;
      }
      void finalCarrier;

      row.emailType = result.emailType;
      row.orderNumber = result.orderNumber;
      row.retailer = finalRetailer;

      const emailLike = {
        emailType: result.emailType,
        orderDate: result.orderDate ? new Date(result.orderDate) : null,
        anchorDate,
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
        lineItems: result.lineItems,
      };

      const isOrphanedRefund = result.emailType === "refund" && !!finalRetailer && !result.orderNumber;

      if (finalRetailer && isFoodGroceryRetailer(finalRetailer)) {
        row.outcome = "NO_LINK";
        results.push(row);
        continue;
      }

      if (!finalRetailer || (!result.orderNumber && !isOrphanedRefund)) {
        row.outcome = "NO_LINK";
        results.push(row);
        continue;
      }

      const sink: DryRunSink = {
        recordMerge(orderId, before, wouldWriteData) {
          const changes: Record<string, { before: unknown; after: unknown; classification: string }> = {};
          for (const [key, after] of Object.entries(wouldWriteData)) {
            const beforeVal = (before as unknown as Record<string, unknown>)[key];
            const cls = classify(beforeVal, after);
            if (key === "lineItems") {
              const beforeLen = Array.isArray(beforeVal) ? beforeVal.length : 0;
              const afterLen = Array.isArray(after) ? after.length : 0;
              changes[key] = { before: `${beforeLen} item(s)`, after: `${afterLen} item(s)`, classification: afterLen > beforeLen ? "APPEND" : "NO_CHANGE" };
            } else {
              changes[key] = { before: beforeVal, after, classification: cls };
            }
          }
          row.fieldChanges = changes;
          row.targetOrderId = orderId;
        },
        recordNewOrder() {
          // NEW_ORDER: no before/after diff needed — nothing existed before.
        },
      };

      if (isOrphanedRefund) {
        const fallback = await findRefundFallbackOrder(userId, finalRetailer, Array.isArray(result.lineItems) ? result.lineItems : [], result.orderTotal);
        if (fallback) {
          row.targetOrderNumber = fallback.order.orderNumber;
          row.targetOrderRetailer = fallback.order.retailer;
          row.matchTier =
            fallback.tier === "line_item_overlap"
              ? "refund_fallback_line_item_overlap"
              : fallback.tier === "total_match"
                ? "refund_fallback_total_match"
                : "refund_fallback_recency";
          await mergeEmailIntoOrder(fallback.order, emailLike as never, result.returnPortalUrl, sink);
          row.outcome = "MERGE";
        } else {
          await createOrderFromEmail(userId, { ...emailLike, retailer: finalRetailer, orderNumber: result.orderNumber } as never, result.returnPortalUrl, sink);
          row.outcome = "NEW_ORDER";
        }
      } else {
        const match = await findMatchingOrder(userId, finalRetailer, result.orderNumber!);
        if (match) {
          row.targetOrderId = match.order.id;
          row.targetOrderNumber = match.order.orderNumber;
          row.targetOrderRetailer = match.order.retailer;
          row.matchTier = match.matchType;
          await mergeEmailIntoOrder(match.order, emailLike as never, result.returnPortalUrl, sink);
          row.outcome = "MERGE";
        } else {
          await createOrderFromEmail(userId, { ...emailLike, retailer: finalRetailer, orderNumber: result.orderNumber } as never, result.returnPortalUrl, sink);
          row.outcome = "NEW_ORDER";
        }
      }
    } catch (error) {
      row.errorMsg = error instanceof Error ? error.message : String(error);
      row.outcome = "ERROR";
    }

    results.push(row);
    console.log(`[${results.length}/106] ${row.messageId} ${row.commerceResult} ${row.outcome}`);
  }

  fs.writeFileSync(
    "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad/dryrun_results.json",
    JSON.stringify(results, null, 2),
  );
  console.log("\nDone. Results written to scratchpad/dryrun_results.json");
}

main().finally(() => prisma.$disconnect());
