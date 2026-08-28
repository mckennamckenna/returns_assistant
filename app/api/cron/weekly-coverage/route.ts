import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { sendEmail, formatSenderEmail } from "@/lib/postmark";
import { notifyAdmin } from "@/lib/adminNotify";
import { scheduledRunWeekStart } from "@/lib/coverageCheck";
import { JUNK_FILTER } from "@/lib/junk";

export const dynamic = "force-dynamic";

const REMINDER_TYPE = "weekly_coverage_check";
const LOOKBACK_DAYS = 7;

// Mirrors lib/linkOrder.ts's ALLOWED_FALLBACK_EMAIL_TYPES — an order backed
// by one of these is a real purchase; an order backed only by
// refund/return_label/other (never an order_confirmation, shipping_confirmation,
// or delivery) is a duplicate/orphan of a real order elsewhere, not a
// purchase of its own (2026-08-16: the #2523415500 class — a lone refund
// email spawned a brand-new Order instead of matching its real original).
// This is the "you bought this" test now, not a non-null orderDate — an
// order's orderDate can be legitimately null (fallback couldn't resolve
// one) or, before the write-once fix, corrupted by a later non-establishing
// email; neither should decide inclusion on its own. Duplicated here rather
// than imported so this route's purchase-signal logic stays self-contained.
const ESTABLISHING_EMAIL_TYPES = ["order_confirmation", "shipping_confirmation", "delivery"];

function formatCurrency(total: number | null, currency: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

function firstName(name: string | null): string {
  const first = name?.trim().split(/\s+/)[0];
  return first || "there";
}

interface CoverageItem {
  retailer: string | null;
  orderTotal: number | null;
  orderCurrency: string | null;
}

function buildCoverageLines(items: CoverageItem[]): string {
  if (items.length === 0) {
    return "We didn't receive any shopping emails from you this week.";
  }
  return items
    .map((item) => {
      const retailer = item.retailer || "an unknown retailer";
      const total = formatCurrency(item.orderTotal, item.orderCurrency);
      return total ? `- ${retailer} — ${total}` : `- 1 order from ${retailer}`;
    })
    .join("\n");
}

function buildBody(name: string | null, coverageLines: string): string {
  return `Hi ${firstName(name)},

Quick check-in from Return Window — did we track everything you ordered this week?

Here's what we have from you:
${coverageLines}

If that looks right — great, nothing to do!

If we missed something, just reply to this email and let McKenna know what slipped through. It helps us make the app better.

— Return Window`;
}

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Gates this whole feature off by default — an alpha-only check-in
  // shouldn't accidentally start going out to a real user base later
  // just because the cron schedule fired. Must be explicitly enabled.
  if (process.env.ALPHA_MODE !== "true") {
    return NextResponse.json({ skipped: true, reason: "ALPHA_MODE is not enabled" });
  }

  const url = new URL(request.url);
  const force = url.searchParams.get("force") === "true";

  const fromAddress = process.env.REMINDER_FROM_EMAIL;
  if (!fromAddress) {
    return NextResponse.json({ error: "REMINDER_FROM_EMAIL not configured" }, { status: 500 });
  }
  const fromEmail = formatSenderEmail(fromAddress);

  const now = new Date();
  // Content window (what emails this week's coverage summary includes) —
  // rolling 7-day, unchanged by this fix. Deliberately separate from the
  // dedup window below: this governs what a real run *shows*, which must
  // not change.
  const lookbackStart = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  // Dedup window — scheduled-run-week, not rolling. See lib/coverageCheck.ts.
  const dedupWindowStart = scheduledRunWeekStart(now);

  const users = await prisma.user.findMany();

  const sent: { userId: string; userEmail: string; orderCount: number }[] = [];
  const skippedAlreadySent: { userId: string; userEmail: string }[] = [];
  const failed: { userId: string; userEmail: string; error: string }[] = [];

  for (const user of users) {
    // "Per user per week," not "per order, ever" — the @@unique on
    // Reminder doesn't help here (orderId is null for every row of this
    // type), so the dedupe check is a recent-send lookup instead.
    if (!force) {
      const recentSend = await prisma.reminder.findFirst({
        where: { userId: user.id, reminderType: REMINDER_TYPE, sentAt: { gte: dedupWindowStart } },
      });
      if (recentSend) {
        skippedAlreadySent.push({ userId: user.id, userEmail: user.email });
        continue;
      }
    }

    try {
      const recentEmails = await prisma.email.findMany({
        where: { userId: user.id, receivedAt: { gte: lookbackStart }, ...JUNK_FILTER },
        include: {
          order: {
            select: {
              retailer: true,
              orderTotal: true,
              orderCurrency: true,
              orderDate: true,
              // Existence check only (take: 1) — is this order backed by
              // ANY establishing email across its whole history, not just
              // ones received this week. See ESTABLISHING_EMAIL_TYPES above.
              emails: { where: { emailType: { in: ESTABLISHING_EMAIL_TYPES } }, select: { id: true }, take: 1 },
            },
          },
        },
      });

      // Dedupe by order — several emails (confirmation, shipping,
      // delivery) about the same order this week should produce one
      // line, not one per email. Unlinked emails fall back to the
      // email's own retailer field, one line each — unchanged by this
      // gate: an emailType:null extraction-failure row has no orderId at
      // all, so it never reaches the linked branch below. Those stay
      // visible on purpose (the QA net's job — the 2026-08-07 flood
      // finding), only linked orphans are subject to the new gate.
      //
      // Linked emails must clear TWO checks, in order:
      // 1. Purchase-signal gate — the order must have at least one
      //    establishing email (order_confirmation/shipping_confirmation/
      //    delivery) somewhere in its history. An order backed only by
      //    refund/return_label/other never counts as "you bought this" —
      //    it's dropped outright, not relabeled with different copy,
      //    since a relabeled line still gives a duplicate/orphan Order its
      //    own line in the digest. This replaces null-defaults-to-inclusion
      //    as the primary purchase test: it doesn't matter whether
      //    orderDate is null or even corrupted, only whether real purchase
      //    evidence exists anywhere on the order.
      // 2. Staleness check — the ORDER's own placedDate (Order.orderDate),
      //    not the triggering email's receivedAt — otherwise an order
      //    placed weeks ago whose delivery email merely arrived this week
      //    reads as a new purchase. Only excludes on positive evidence the
      //    order predates this week's window; a null placedDate on an
      //    order that already passed gate 1 (so real purchase evidence
      //    exists, just no resolved date) still defaults to inclusion.
      const seenOrderIds = new Set<string>();
      const items: CoverageItem[] = [];
      for (const email of recentEmails) {
        if (email.orderId) {
          if (seenOrderIds.has(email.orderId)) continue;
          seenOrderIds.add(email.orderId);
          const hasEstablishingEmail = (email.order?.emails?.length ?? 0) > 0;
          if (!hasEstablishingEmail) continue;
          const placedDate = email.order?.orderDate ?? null;
          if (placedDate !== null && placedDate < lookbackStart) continue;
          items.push({
            retailer: email.order?.retailer ?? null,
            orderTotal: email.order?.orderTotal ?? null,
            orderCurrency: email.order?.orderCurrency ?? null,
          });
        } else {
          items.push({ retailer: email.retailer, orderTotal: null, orderCurrency: null });
        }
      }

      const body = buildBody(user.name, buildCoverageLines(items));
      await sendEmail({
        to: user.email,
        from: fromEmail,
        subject: "Did we catch everything you bought this week? 🛍",
        textBody: body,
      });
      // Load-bearing: a force/test send must never write a Reminder row —
      // otherwise it dedup-suppresses the next real scheduled run, which is
      // exactly how an off-schedule Jun 27 force send silently knocked 3
      // users out of the real Jul 3 run. Scheduled-week keying above closes
      // the same gap defensively, but this is what actually stops it.
      if (!force) {
        await prisma.reminder.create({ data: { userId: user.id, reminderType: REMINDER_TYPE } });
      }

      sent.push({ userId: user.id, userEmail: user.email, orderCount: items.length });
    } catch (error) {
      console.error("Weekly coverage check failed for user", user.id, error);
      failed.push({
        userId: user.id,
        userEmail: user.email,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (sent.length > 0 || failed.length > 0) {
    await notifyAdmin(
      "Return Window: weekly coverage check summary",
      buildAdminSummary(sent, failed),
      "weekly_coverage_summary",
    );
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    force,
    totalUsers: users.length,
    sent,
    skippedAlreadySent,
    failed,
  });
}

function buildAdminSummary(
  sent: { userId: string; userEmail: string; orderCount: number }[],
  failed: { userId: string; userEmail: string; error: string }[],
): string {
  const lines = [`${sent.length} coverage check(s) sent, ${failed.length} failure(s).`, ""];

  if (sent.length > 0) {
    lines.push("Sent:");
    for (const s of sent) {
      lines.push(`- ${s.userEmail} — ${s.orderCount} order(s) this week`);
    }
    lines.push("");
  }

  if (failed.length > 0) {
    lines.push("Failed:");
    for (const f of failed) {
      lines.push(`- ${f.userEmail} — ${f.error}`);
    }
  }

  return lines.join("\n");
}
