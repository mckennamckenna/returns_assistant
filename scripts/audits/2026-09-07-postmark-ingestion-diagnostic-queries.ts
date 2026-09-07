// Read-only diagnostic queries for the 2026-09-07 Postmark ingestion
// diagnostic (TASKS.md 🔴 Now). Zero writes, zero Anthropic/model calls.
//
// Usage: npx tsx scripts/audits/2026-09-07-postmark-ingestion-diagnostic-queries.ts

import { PrismaClient } from "@prisma/client";
import { decryptEmailContent } from "../../lib/emailEncryption";

const prisma = new PrismaClient();

async function main() {
  console.log("=== Order 1RYJR48 ===");
  const order = await prisma.order.findFirst({
    where: { orderNumber: { contains: "1RYJR48" } },
    include: {
      user: { select: { id: true, email: true, inboundToken: true } },
      emails: {
        select: {
          id: true,
          receivedAt: true,
          subject: true,
          messageId: true,
          emailType: true,
          junkedAt: true,
          needsReview: true,
          fromEmail: true,
        },
      },
    },
  });
  if (!order) {
    console.log("No Order found matching 1RYJR48");
  } else {
    console.log("userId:", order.user?.id, "userEmail:", order.user?.email, "inboundToken:", order.user?.inboundToken);
    console.log("Linked emails on this Order:", order.emails.length);
    for (const e of order.emails) {
      console.log({
        id: e.id,
        receivedAt: e.receivedAt,
        subject: e.subject,
        messageId: e.messageId,
        emailType: e.emailType,
        junkedAt: e.junkedAt,
        needsReview: e.needsReview,
        fromEmail: decryptEmailContent({ fromEmail: e.fromEmail, fromName: null, textBody: null, htmlBody: null }).fromEmail,
      });
    }

    if (order.user) {
      console.log("\n=== All Email rows for this user on 2026-09-02 ===");
      const dayEmails = await prisma.email.findMany({
        where: {
          userId: order.user.id,
          receivedAt: { gte: new Date("2026-09-02T00:00:00Z"), lt: new Date("2026-09-03T00:00:00Z") },
        },
        select: { id: true, receivedAt: true, subject: true, messageId: true, emailType: true, junkedAt: true, orderId: true, fromEmail: true },
        orderBy: { receivedAt: "asc" },
      });
      for (const e of dayEmails) {
        console.log({
          id: e.id,
          receivedAt: e.receivedAt,
          subject: e.subject,
          messageId: e.messageId,
          emailType: e.emailType,
          junkedAt: e.junkedAt,
          orderId: e.orderId,
          fromEmail: decryptEmailContent({ fromEmail: e.fromEmail, fromName: null, textBody: null, htmlBody: null }).fromEmail,
        });
      }

      console.log("\n=== DiscardLog rows on 2026-09-02 (global — table has no userId) ===");
      const discards = await prisma.discardLog.findMany({
        where: { occurredAt: { gte: new Date("2026-09-02T00:00:00Z"), lt: new Date("2026-09-03T00:00:00Z") } },
        select: { reason: true, occurredAt: true },
        orderBy: { occurredAt: "asc" },
      });
      console.log("Total DiscardLog rows that day (all users):", discards.length);
      const byReason: Record<string, number> = {};
      for (const d of discards) byReason[d.reason] = (byReason[d.reason] ?? 0) + 1;
      console.log(byReason);
    }
  }

  console.log("\n=== DiscardLog rows near 2026-09-04T18:30–19:30Z (Gap 3rd email arrival window) ===");
  const nearGap3 = await prisma.discardLog.findMany({
    where: { occurredAt: { gte: new Date("2026-09-04T18:30:00Z"), lt: new Date("2026-09-04T19:30:00Z") } },
    orderBy: { occurredAt: "asc" },
  });
  console.log(nearGap3);

  console.log("\n=== All Email rows for this user, 2026-09-02 through 2026-09-06 ===");
  if (order?.user) {
    const wideEmails = await prisma.email.findMany({
      where: {
        userId: order.user.id,
        receivedAt: { gte: new Date("2026-09-02T00:00:00Z"), lt: new Date("2026-09-07T00:00:00Z") },
      },
      select: { receivedAt: true, subject: true, messageId: true, junkedAt: true },
      orderBy: { receivedAt: "asc" },
    });
    for (const e of wideEmails) {
      console.log(e.receivedAt.toISOString(), "|", e.subject, "|", e.messageId, "| junked:", !!e.junkedAt);
    }
  }

  console.log("\n=== All self_outbound_loop DiscardLog rows, 2026-09-01 through 2026-09-07 (global) ===");
  const allSelfOutboundDiscards = await prisma.discardLog.findMany({
    where: {
      reason: "self_outbound_loop",
      occurredAt: { gte: new Date("2026-09-01T00:00:00Z"), lt: new Date("2026-09-07T00:00:00Z") },
    },
    orderBy: { occurredAt: "asc" },
  });
  console.log("Count:", allSelfOutboundDiscards.length);
  for (const d of allSelfOutboundDiscards) console.log(d.occurredAt.toISOString());

  // Lookup helper for arbitrary messageIds found in Postmark — pass via CLI arg.
  const lookupIds = process.argv.slice(2);
  if (lookupIds.length) {
    console.log("\n=== messageId lookups ===");
    for (const id of lookupIds) {
      const found = await prisma.email.findFirst({ where: { messageId: id }, select: { id: true, userId: true, subject: true, receivedAt: true } });
      console.log(id, "->", found ?? "NOT FOUND in Email table");
    }
  }
}

main().finally(() => prisma.$disconnect());
