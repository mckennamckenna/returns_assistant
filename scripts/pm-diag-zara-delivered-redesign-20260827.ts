/**
 * scripts/pm-diag-zara-delivered-redesign-20260827.ts
 *
 * READ-ONLY diagnostic. 0 billed Anthropic calls. 0 DB writes.
 *
 * Re-scope of the Zara #54421192781 delivered-badge bug (TASKS.md 🔴 Now,
 * commit 42348b0) into a design pass. Answers, in order:
 *   1. Reconcile prior diagnosis with owner's observation of ongoing drift.
 *   2. Was the forward auto/manual classifier probe ever run? (TASKS.md
 *      says yes, 2026-07-21, and a full build shipped 2026-07-26 —
 *      Email.forwardType/anchorDate/anchorSource, lib/forwardResolver.ts.
 *      Confirm this against the DB directly rather than trusting the doc.)
 *   3. Forward-header original-send-date extraction feasibility across all
 *      delivery-typed emails, using the ALREADY-DEPLOYED resolver fields
 *      where present, and re-deriving for anything unclassified.
 *   4. Classify the Zara delivery email specifically.
 *   5. Size the 20 peer orders (from the 2026-08-26 diagnostic) against the
 *      auto/manual groups and residual-after-extraction bucket.
 */

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent, decryptRawJson } from "../lib/emailEncryption";
import { classifyForwardType, resolveAnchorDate, type RawHeader } from "../lib/forwardResolver";
import { resolveBodyText } from "../lib/emailBodyText";

const prisma = new PrismaClient();

function getHeaders(rawJsonDecrypted: string): RawHeader[] | null {
  try {
    const payload = decryptRawJson(rawJsonDecrypted) as any;
    return payload?.Headers ?? null;
  } catch {
    return null;
  }
}

async function main() {
  // ---------- STEP 1: reconcile prior diagnosis with owner's observation ----------
  console.log("=== STEP 1: Zara order fields right now ===");
  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "54421192781" } },
    select: {
      id: true,
      displayStatus: true,
      deliveredAt: true,
      deliveryDate: true,
      estimatedDeliveryDate: true,
      orderDate: true,
      updatedAt: true,
    },
  });
  console.log(order);
  console.log(
    "Card badge (lib/orderCardState.ts) reads: estimatedDeliveryDate (via computeOrderCardState -> orderCardChip 'awaiting_delivery' branch), since deliveredAt is",
    order?.deliveredAt,
  );
  console.log(
    "Detail page (app/(app)/orders/[id]/page.tsx:220) reads: deliveredAt ?? estimatedDeliveryDate ?? deliveryDate",
  );
  console.log(
    "Both fields currently equal:",
    order?.estimatedDeliveryDate?.toISOString(),
    "vs",
    order?.deliveryDate?.toISOString(),
    "- SAME VALUE means the two-different-field theory from last session no longer explains any drift; if the owner is currently seeing Aug23/Aug24 split, it is a stale page render (SSR cache / browser cache), not two different underlying values.",
  );

  console.log("\n=== STEP 1 (cont'd): Email rows + extractedAt timestamps ===");
  const emails = await prisma.email.findMany({
    where: { orderId: order?.id },
    orderBy: { receivedAt: "asc" },
    select: {
      id: true,
      emailType: true,
      receivedAt: true,
      extractedAt: true,
      deliveryDate: true,
      forwardType: true,
      anchorDate: true,
      anchorSource: true,
      needsReview: true,
    },
  });
  for (const e of emails) console.log(e);
  console.log(
    "Last session's diagnostic ran before the order_confirmation email at",
    emails.find((e) => e.emailType === "order_confirmation")?.extractedAt,
    "- order.updatedAt now is",
    order?.updatedAt,
    ". If updatedAt hasn't moved since, nothing has changed since last session and 'both read Aug 24' was correct at the time it was checked.",
  );

  // ---------- STEP 2: was the classifier probe run? ----------
  console.log("\n=== STEP 2: forward classifier — already built and deployed? ===");
  const classifiedCount = await prisma.email.count({ where: { forwardType: { not: null } } });
  const totalEmails = await prisma.email.count();
  console.log(`Email rows with forwardType set (non-null): ${classifiedCount} / ${totalEmails}`);
  console.log(
    "lib/forwardResolver.ts (classifyForwardType, resolveAnchorDate) exists and is wired into app/api/inbound/route.ts per TASKS.md's Anchor Date Resolver Part 2 entry (deployed 2026-07-26, commit 13521ca). This DB count confirms whether it has actually been running on real inbound traffic, independent of what the doc claims.",
  );

  console.log("\n--- AquaTru, reported first per the 2026-07-21 spec ---");
  const aquaTruEmails = await prisma.email.findMany({
    where: { emailType: "delivery" },
    select: { id: true, orderId: true, retailer: true, forwardType: true, anchorDate: true, anchorSource: true, receivedAt: true },
  });
  const aquaTru = aquaTruEmails.filter((e) => (e.retailer ?? "").toLowerCase().includes("aquatru"));
  for (const e of aquaTru) console.log(e);

  // ---------- STEP 3: forward-header extraction feasibility, all delivery-typed emails ----------
  console.log("\n=== STEP 3: forward-header original-send-date extraction across ALL delivery-typed emails ===");
  const deliveryEmails = await prisma.email.findMany({
    where: { emailType: "delivery" },
    select: {
      id: true,
      orderId: true,
      retailer: true,
      receivedAt: true,
      deliveryDate: true,
      forwardType: true,
      anchorDate: true,
      anchorSource: true,
      rawJson: true,
      textBody: true,
      htmlBody: true,
      fromEmail: true,
      fromName: true,
    },
  });
  console.log(`Total delivery-typed emails: ${deliveryEmails.length}`);

  type Row = {
    id: string;
    retailer: string | null;
    forwardType: string;
    anchorSource: string;
    anchorDate: Date | null;
    receivedAt: Date;
    deltaMs: number | null;
    failureReason: string | null;
  };
  const rows: Row[] = [];

  for (const e of deliveryEmails) {
    const dec = decryptEmailContent(e as any);
    let forwardType = e.forwardType;
    let anchorDate = e.anchorDate;
    let anchorSource = e.anchorSource;
    let failureReason: string | null = null;

    if (!forwardType) {
      // Pre-resolver row — re-derive read-only, matching exactly what the
      // resolver would have computed at ingestion, to answer the feasibility
      // question for rows that predate the 2026-07-26 deploy.
      const headers = getHeaders(e.rawJson);
      forwardType = classifyForwardType(headers);
      const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
      const resolved = resolveAnchorDate({ forwardType: forwardType as "auto" | "manual", headers, bodyText, receivedAt: e.receivedAt });
      anchorDate = resolved.anchorDate;
      anchorSource = resolved.anchorSource;
      if (!headers) failureReason = "no rawJson Headers array";
    }

    if (anchorSource === "unresolved") {
      // Distinguish "no Date line at all" from "Date line present but unparseable"
      const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
      const hasDateLine = bodyText ? /^(?:>\s*)*Date:\s*.+$/m.test(bodyText) : false;
      const hasForwardBlock = bodyText ? /forwarded message|begin forwarded message/i.test(bodyText) : false;
      failureReason = !hasForwardBlock
        ? "no forwarded-message header block found"
        : !hasDateLine
          ? "forward block present, Date line missing"
          : "Date line present, unparseable";
    }

    const deltaMs = anchorDate ? anchorDate.getTime() - e.receivedAt.getTime() : null;
    rows.push({ id: e.id, retailer: e.retailer, forwardType: forwardType!, anchorSource: anchorSource!, anchorDate, receivedAt: e.receivedAt, deltaMs, failureReason });
  }

  const succeeded = rows.filter((r) => r.anchorSource === "original_header" || r.anchorSource === "quoted_body");
  const failed = rows.filter((r) => r.anchorSource === "unresolved");
  const receivedAtFallback = rows.filter((r) => r.anchorSource === "received_at");
  console.log(`\nSuccess (original_header or quoted_body): ${succeeded.length} / ${rows.length} = ${((succeeded.length / rows.length) * 100).toFixed(1)}%`);
  console.log(`Fell to received_at (auto-forward, header Date missing): ${receivedAtFallback.length}`);
  console.log(`Unresolved (no usable date at all): ${failed.length}`);

  console.log("\n--- Failure breakdown ---");
  const failureCounts = new Map<string, number>();
  for (const r of failed) failureCounts.set(r.failureReason!, (failureCounts.get(r.failureReason!) ?? 0) + 1);
  for (const [reason, count] of failureCounts) console.log(`  ${reason}: ${count}`);

  console.log("\n--- Success by forwardType ---");
  const byType = new Map<string, number>();
  for (const r of succeeded) byType.set(r.forwardType, (byType.get(r.forwardType) ?? 0) + 1);
  console.log(Object.fromEntries(byType));

  console.log("\n--- Client detection (From-header heuristics on the ORIGINAL forwarded message, best-effort) ---");
  // Best-effort only: distinguishing client is not something the resolver
  // itself computes. Flagged explicitly as approximate.
  console.log("(Not reliably derivable from stored fields without deeper header parsing — see write-up notes.)");

  console.log("\n--- Delta distribution (anchorDate - receivedAt) for successes, ms -> human ---");
  const deltas = succeeded.map((r) => r.deltaMs!).sort((a, b) => a - b);
  function fmt(ms: number) {
    const abs = Math.abs(ms);
    const mins = abs / 60000;
    return `${ms < 0 ? "-" : ""}${mins < 60 ? mins.toFixed(1) + "m" : (mins / 60).toFixed(1) + "h"}`;
  }
  if (deltas.length > 0) {
    console.log("min:", fmt(deltas[0]), "median:", fmt(deltas[Math.floor(deltas.length / 2)]), "max:", fmt(deltas[deltas.length - 1]));
  }

  console.log("\n--- By retailer (success rate) ---");
  const byRetailer = new Map<string, { ok: number; total: number }>();
  for (const r of rows) {
    const key = r.retailer ?? "(none)";
    const cur = byRetailer.get(key) ?? { ok: 0, total: 0 };
    cur.total += 1;
    if (r.anchorSource === "original_header" || r.anchorSource === "quoted_body") cur.ok += 1;
    byRetailer.set(key, cur);
  }
  for (const [retailer, { ok, total }] of byRetailer) {
    console.log(`  ${retailer}: ${ok}/${total} = ${((ok / total) * 100).toFixed(0)}%`);
  }

  console.log("\n--- fromEmail domain distribution (client-detection proxy is not possible; user-base concentration check) ---");
  const domains = new Map<string, number>();
  for (const e of deliveryEmails) {
    const dec = decryptEmailContent(e as any);
    const domain = dec.fromEmail.split("@")[1]?.toLowerCase() ?? "unknown";
    domains.set(domain, (domains.get(domain) ?? 0) + 1);
  }
  console.log(Object.fromEntries(domains));

  // ---------- STEP 4: classify the Zara delivery email specifically ----------
  console.log("\n=== STEP 4: Zara delivery email classification ===");
  const zaraDeliveryEmail = deliveryEmails.find((e) => e.orderId === order?.id);
  if (zaraDeliveryEmail) {
    const dec = decryptEmailContent(zaraDeliveryEmail as any);
    const headers = getHeaders(zaraDeliveryEmail.rawJson);
    const forwardType = zaraDeliveryEmail.forwardType ?? classifyForwardType(headers);
    const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
    const resolved =
      zaraDeliveryEmail.anchorDate || zaraDeliveryEmail.anchorSource
        ? { anchorDate: zaraDeliveryEmail.anchorDate, anchorSource: zaraDeliveryEmail.anchorSource }
        : resolveAnchorDate({ forwardType: forwardType as "auto" | "manual", headers, bodyText, receivedAt: zaraDeliveryEmail.receivedAt });
    console.log({
      forwardType,
      storedForwardType: zaraDeliveryEmail.forwardType,
      bodyDeliveryDateExtracted: zaraDeliveryEmail.deliveryDate,
      resolvedAnchorDate: resolved.anchorDate,
      resolvedAnchorSource: resolved.anchorSource,
      receivedAt: zaraDeliveryEmail.receivedAt,
    });
  } else {
    console.log("Zara order has no delivery-typed email in the deliveryEmails set (unexpected — investigate).");
  }

  // ---------- STEP 5: size the 20 peer orders ----------
  console.log("\n=== STEP 5: peer orders (deliveredAt NULL, estimatedDeliveryDate in the past) ===");
  const peers = await prisma.order.findMany({
    where: { deliveredAt: null, estimatedDeliveryDate: { not: null, lt: new Date() } },
    select: { id: true, retailer: true, orderNumber: true, estimatedDeliveryDate: true },
  });
  console.log(`Peer count: ${peers.length}`);

  let autoCount = 0;
  let manualCount = 0;
  let autoResolvable = 0;
  let manualResolvable = 0;
  let residual = 0;
  for (const p of peers) {
    const peerDeliveryEmails = await prisma.email.findMany({
      where: { orderId: p.id, emailType: "delivery" },
      select: { id: true, forwardType: true, anchorDate: true, anchorSource: true, receivedAt: true, rawJson: true, textBody: true, htmlBody: true, fromEmail: true, fromName: true },
    });
    if (peerDeliveryEmails.length === 0) {
      console.log(`  ${p.retailer} ${p.orderNumber}: no delivery-typed email linked (different root cause, not this bug's mechanism)`);
      continue;
    }
    const e = peerDeliveryEmails[0];
    const dec = decryptEmailContent(e as any);
    const headers = getHeaders(e.rawJson);
    const forwardType = e.forwardType ?? classifyForwardType(headers);
    const bodyText = resolveBodyText(dec.textBody, dec.htmlBody);
    const resolved =
      e.anchorDate || e.anchorSource
        ? { anchorDate: e.anchorDate, anchorSource: e.anchorSource }
        : resolveAnchorDate({ forwardType: forwardType as "auto" | "manual", headers, bodyText, receivedAt: e.receivedAt });

    if (forwardType === "auto") autoCount++;
    else manualCount++;

    const primaryResolved = resolved.anchorSource === "original_header" || resolved.anchorSource === "quoted_body";
    if (primaryResolved) {
      if (forwardType === "auto") autoResolvable++;
      else manualResolvable++;
    } else if (forwardType !== "auto") {
      residual++;
    }
    console.log(`  ${p.retailer} ${p.orderNumber}: forwardType=${forwardType} anchorSource=${resolved.anchorSource} anchorDate=${resolved.anchorDate}`);
  }
  console.log(`\nAuto-forwarded: ${autoCount} (primary-path resolvable: ${autoResolvable}, else fallback A = receivedAt safe)`);
  console.log(`Manually forwarded: ${manualCount} (primary-path resolvable: ${manualResolvable}, residual needing fallback B: ${residual})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
