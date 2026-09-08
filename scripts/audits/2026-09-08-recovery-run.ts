// REAL recovery run for the 106 eligible self_outbound_loop discards
// accounted for in docs/audits/2026-09-07-recovery-dryrun.md. TASKS.md
// 🔴 Now, "Real recovery of the 106 eligible self_outbound_loop discards."
//
// Unlike the dry-run driver (scripts/audits/2026-09-07-recovery-dryrun-
// driver.ts, left unmodified and still a safe, re-runnable, zero-write
// artifact), this script performs REAL writes: prisma.email.create(),
// the real prisma.email.update() with extracted fields, and the real
// lib/linkOrder.ts linkEmailToOrder() (merge/create + full cascade —
// applyFallbackOrderDate, recomputeOrderStatus, tracking, recompute
// DisplayStatus). No dryRunSink anywhere in this file.
//
// Reuses DryRunCache (read-only for classify/extract) so only the one
// ERROR row from the dry-run (whose cache write failed mid-run) incurs a
// fresh Haiku/Sonnet call for those two stages. policy_lookup is never
// cached and re-fires for real on every row that needs it, same as any
// normal ingestion.
import fs from "fs";
import { PrismaClient } from "@prisma/client";
import { classifyForwardType, resolveAnchorDate } from "../../lib/forwardResolver";
import { detectSelfOutboundLoop } from "../../lib/selfOutboundGuard";
import { extractDomain, isFoodGroceryDomain, isFoodGroceryRetailer } from "../../lib/foodGroceryExclusion";
import { isUspsCarrierDomain } from "../../lib/uspsCarrierPingExclusion";
import { shouldAutoJunk } from "../../lib/junk";
import { isCommerceEmail } from "../../lib/classify";
import { extractEmailIdentity, finalizeExtraction, type RawExtraction, type ExistingOrderContext } from "../../lib/extract";
import { resolveBodyTextWithAlternate } from "../../lib/emailBodyText";
import { findMatchingOrder, linkEmailToOrder } from "../../lib/linkOrder";
import { isAmazonOrder } from "../../lib/amazonBundle";
import { RETAILER_FALLBACK_GATE_EMAIL_TYPES, resolveRetailerFallback } from "../../lib/retailerFallback";
import { encryptEmailContent, encryptRawJson } from "../../lib/emailEncryption";

process.env.REMINDER_FROM_EMAIL = process.env.REMINDER_FROM_EMAIL || "reminders@myreturnwindow.com";
process.env.LOGIN_FROM_EMAIL = process.env.LOGIN_FROM_EMAIL || "hello@myreturnwindow.com";

const prisma = new PrismaClient();
const scratch = "/private/tmp/claude-501/-Users-mckennasweazey/52f59ad2-5931-465e-ac32-589219f4c846/scratchpad";
const dryrunPayloadDir = `${scratch}/dryrun106`; // 105 of the 106 payloads live here
const pilotPayloadDir = `${scratch}/pilot21`; // unused fallback, kept for completeness
const ERROR_ROW_ID = "641077e7-56c5-4523-bf29-f90259a840dd";

const jsonlPath = `${scratch}/recovery_run_results.jsonl`;

interface RowResult {
  messageId: string;
  userId: string | null;
  receivedAt: string | null;
  from: string;
  subject: string;
  stage: "fetch" | "user_lookup" | "dedup_check" | "guard_check" | "prejunk" | "classify" | "extract" | "link" | "done";
  cacheHitClassify: boolean;
  cacheHitExtract: boolean;
  commerceResult: "commerce" | "non_commerce" | "unknown";
  emailType: string | null;
  orderNumber: string | null;
  retailer: string | null;
  outcome: "NEW_ORDER" | "MERGE" | "NO_LINK" | "NON_COMMERCE_DISCARDED" | "PREJUNKED" | "SKIPPED_ALREADY_EXISTS" | "UNEXPECTED_SELF_OUTBOUND" | "ERROR";
  emailId: string | null;
  orderIdBefore: string | null;
  orderIdAfter: string | null;
  orderSnapshotBefore: Record<string, unknown> | null;
  orderSnapshotAfter: Record<string, unknown> | null;
  errorMessage: string | null;
  errorStack: string | null;
}

function isConnectionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("P1017") || msg.includes("Server has closed the connection") || msg.includes("Can't reach database server");
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isConnectionError(err)) throw err;
    console.warn("Connection error, retrying once after reconnect:", err instanceof Error ? err.message : err);
    await prisma.$disconnect();
    await new Promise((r) => setTimeout(r, 1500));
    await prisma.$connect();
    return await fn();
  }
}

function pushAndSave(results: RowResult[], row: RowResult) {
  results.push(row);
  fs.appendFileSync(jsonlPath, JSON.stringify(row) + "\n");
}

function emptyRow(messageId: string): RowResult {
  return {
    messageId,
    userId: null,
    receivedAt: null,
    from: "",
    subject: "",
    stage: "fetch",
    cacheHitClassify: false,
    cacheHitExtract: false,
    commerceResult: "unknown",
    emailType: null,
    orderNumber: null,
    retailer: null,
    outcome: "ERROR",
    emailId: null,
    orderIdBefore: null,
    orderIdAfter: null,
    orderSnapshotBefore: null,
    orderSnapshotAfter: null,
    errorMessage: null,
    errorStack: null,
  };
}

async function main() {
  fs.writeFileSync(jsonlPath, "");
  const results: RowResult[] = [];

  const cacheRows = await withRetry(() => prisma.dryRunCache.findMany());
  const cacheByMessageId = new Map(cacheRows.map((r) => [r.messageId, r]));
  const scopeIds = [...cacheByMessageId.keys(), ERROR_ROW_ID];

  if (scopeIds.length !== 106) {
    console.error(`SCOPE ASSERTION FAILED: expected 106, got ${scopeIds.length}. Stopping before any write.`);
    process.exit(1);
  }
  console.log(`Scope confirmed: ${scopeIds.length} messageIds (${cacheByMessageId.size} cached + 1 ERROR row).`);

  // Preserve dry-run's scope ordering/token mapping for token->userId and payload lookups.
  const scopeMeta = JSON.parse(fs.readFileSync(`${scratch}/dryrun_scope_with_tokens.json`, "utf8")) as {
    messageId: string;
    token: string;
  }[];
  const tokenByMessageId = new Map(scopeMeta.map((m) => [m.messageId, m.token]));
  // The ERROR row's token: pull from the original eligible list (owner-scoped, cmqtng57q0001w9y3sm6r8kog).
  if (!tokenByMessageId.has(ERROR_ROW_ID)) {
    tokenByMessageId.set(ERROR_ROW_ID, "cmqx4cy1r0001jl04kcu739on");
  }

  for (const messageId of scopeIds) {
    const row = emptyRow(messageId);
    try {
      const token = tokenByMessageId.get(messageId);
      if (!token) throw new Error(`no token mapping found for messageId ${messageId}`);

      const file = fs.existsSync(`${dryrunPayloadDir}/${messageId}.json`)
        ? `${dryrunPayloadDir}/${messageId}.json`
        : `${pilotPayloadDir}/${messageId}.json`;
      if (!fs.existsSync(file)) throw new Error(`no cached Postmark payload found for ${messageId}`);
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      row.from = payload.FromFull?.Email ?? "";
      row.subject = (payload.Subject ?? "").slice(0, 80);
      row.receivedAt = payload.Date ?? null;

      row.stage = "user_lookup";
      const user = await withRetry(() => prisma.user.findUnique({ where: { inboundToken: token }, select: { id: true } }));
      const userId = user?.id ?? null;
      row.userId = userId;
      if (!userId) throw new Error(`no user found for token ${token}`);

      row.stage = "dedup_check";
      const existingEmail = await withRetry(() =>
        prisma.email.findFirst({ where: { userId, messageId }, select: { id: true } }),
      );
      if (existingEmail) {
        row.outcome = "SKIPPED_ALREADY_EXISTS";
        row.emailId = existingEmail.id;
        pushAndSave(results, row);
        continue;
      }

      row.stage = "guard_check";
      const forwardType = classifyForwardType(payload.Headers);
      const selfOutbound = detectSelfOutboundLoop({ fromEmail: payload.FromFull?.Email, headers: payload.Headers, forwardType });
      if (selfOutbound.isSelfOutbound) {
        row.outcome = "UNEXPECTED_SELF_OUTBOUND";
        console.error(`UNEXPECTED: ${messageId} now classifies as self-outbound (reason: ${selfOutbound.reason}). Stopping this row, not writing anything for it.`);
        pushAndSave(results, row);
        continue;
      }

      row.stage = "prejunk";
      const inboundToken = payload.MailboxHash || token;
      const fromDomain = extractDomain(payload.FromFull?.Email ?? "");
      const { anchorDate, anchorSource } = resolveAnchorDate({
        forwardType,
        headers: payload.Headers,
        bodyText: payload.TextBody ?? payload.HtmlBody ?? null,
        receivedAt: new Date(payload.Date),
      });
      const buildCreateData = () => {
        const encrypted = encryptEmailContent({
          fromEmail: payload.FromFull?.Email ?? "",
          fromName: payload.FromFull?.Name ?? null,
          textBody: payload.TextBody ?? null,
          htmlBody: payload.HtmlBody ?? null,
        });
        return {
          userId,
          fromEmail: encrypted.fromEmail,
          fromName: encrypted.fromName,
          toHash: inboundToken,
          subject: payload.Subject,
          textBody: encrypted.textBody,
          htmlBody: encrypted.htmlBody,
          receivedAt: new Date(payload.Date),
          rawJson: encryptRawJson(payload),
          forwardType,
          anchorDate,
          anchorSource,
          messageId: payload.MessageID ?? messageId,
        };
      };

      if (fromDomain && (isFoodGroceryDomain(fromDomain) || isUspsCarrierDomain(fromDomain))) {
        const created = await withRetry(() =>
          prisma.email.create({ data: { ...buildCreateData(), junkedAt: new Date() } }),
        );
        row.outcome = "PREJUNKED";
        row.emailId = created.id;
        pushAndSave(results, row);
        continue;
      }

      row.stage = "classify";
      const cached = cacheByMessageId.get(messageId);
      let isCommerce: boolean;
      let parsed: RawExtraction | null = null;
      if (cached) {
        row.cacheHitClassify = true;
        isCommerce = cached.isCommerce;
        parsed = cached.extractionResult as unknown as RawExtraction | null;
        if (isCommerce && parsed) row.cacheHitExtract = true;
      } else {
        isCommerce = await isCommerceEmail(payload.TextBody, payload.HtmlBody);
      }
      row.commerceResult = isCommerce ? "commerce" : "non_commerce";

      if (!isCommerce) {
        await withRetry(() => prisma.discardLog.create({ data: { reason: "non_commerce" } }));
        row.outcome = "NON_COMMERCE_DISCARDED";
        pushAndSave(results, row);
        continue;
      }

      row.stage = "extract";
      if (!parsed) {
        const { primary, alternate } = resolveBodyTextWithAlternate(payload.TextBody ?? null, payload.HtmlBody ?? null);
        if (!primary) throw new Error("no textBody or htmlBody to extract from");
        parsed = await extractEmailIdentity(primary, payload.Subject ?? null, `RECOVERY-${messageId}`, alternate);
      }

      const created = await withRetry(() => prisma.email.create({ data: buildCreateData() }));
      row.emailId = created.id;

      const mayTriggerPolicyLookup =
        parsed.returnWindowDays == null &&
        !(isAmazonOrder(parsed.retailer) && parsed.emailType !== "other") &&
        !isFoodGroceryRetailer(parsed.retailer);

      let existingOrder: ExistingOrderContext | null = null;
      if (mayTriggerPolicyLookup && parsed.retailer && parsed.orderNumber) {
        const match = await withRetry(() => findMatchingOrder(userId, parsed!.retailer!, parsed!.orderNumber!));
        if (match) {
          existingOrder = { returnWindowDays: match.order.returnWindowDays };
          row.orderIdBefore = match.order.id;
          row.orderSnapshotBefore = match.order as unknown as Record<string, unknown>;
        }
      }

      row.stage = "extract"; // policy_lookup is part of finalizeExtraction, still "extract" stage for error attribution
      const result = await finalizeExtraction(parsed, created.id, existingOrder);

      let finalRetailer = result.retailer;
      let retailerSource: "body_extraction" | "sender_fallback" | "carrier_deferred" | null =
        result.retailer != null ? "body_extraction" : null;
      let finalCarrier: string | null = null;
      if (result.retailer == null && result.emailType != null && RETAILER_FALLBACK_GATE_EMAIL_TYPES.has(result.emailType)) {
        const fallback = resolveRetailerFallback(payload.FromFull?.Email ?? "", payload.FromFull?.Name ?? null);
        finalRetailer = fallback.retailer;
        retailerSource = fallback.retailerSource;
        finalCarrier = fallback.carrier;
      }

      row.emailType = result.emailType;
      row.orderNumber = result.orderNumber;
      row.retailer = finalRetailer;

      // Capture "before" snapshot for the actual target order, if we didn't
      // already via the policy-lookup pre-check above (e.g. no policy
      // lookup was attempted, or orderNumber/retailer weren't both present
      // at that point but are now after retailer fallback resolved).
      if (!row.orderSnapshotBefore && finalRetailer && result.orderNumber) {
        const preMatch = await withRetry(() => findMatchingOrder(userId, finalRetailer!, result.orderNumber!));
        if (preMatch) {
          row.orderIdBefore = preMatch.order.id;
          row.orderSnapshotBefore = preMatch.order as unknown as Record<string, unknown>;
        }
      }

      await withRetry(() =>
        prisma.email.update({
          where: { id: created.id },
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
        }),
      );

      row.stage = "link";
      await withRetry(() => linkEmailToOrder(created.id, result.returnPortalUrl));

      const finalEmail = await withRetry(() =>
        prisma.email.findUnique({ where: { id: created.id }, select: { orderId: true } }),
      );
      row.orderIdAfter = finalEmail?.orderId ?? null;

      if (row.orderIdAfter) {
        const afterOrder = await withRetry(() => prisma.order.findUnique({ where: { id: row.orderIdAfter! } }));
        row.orderSnapshotAfter = afterOrder as unknown as Record<string, unknown>;
        row.outcome = row.orderIdBefore && row.orderIdBefore === row.orderIdAfter ? "MERGE" : "NEW_ORDER";
      } else {
        row.outcome = "NO_LINK";
      }

      row.stage = "done";
      pushAndSave(results, row);
    } catch (error) {
      row.errorMessage = error instanceof Error ? error.message : String(error);
      row.errorStack = error instanceof Error ? (error.stack ?? null) : null;
      row.outcome = "ERROR";
      pushAndSave(results, row);
    }

    console.log(`[${results.length}/106] ${row.messageId} stage=${row.stage} outcome=${row.outcome}`);
  }

  fs.writeFileSync(`${scratch}/recovery_run_results.json`, JSON.stringify(results, null, 2));
  console.log("\nDone. Results written to scratchpad/recovery_run_results.json and .jsonl");
}

main().finally(() => prisma.$disconnect());
