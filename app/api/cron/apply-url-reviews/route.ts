import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/adminNotify";
import { isMeaningfulRetailerChange } from "@/lib/retailer-normalize";
import { readReviewRows, ReviewRow } from "@/lib/sheets";

export const dynamic = "force-dynamic";

// Daily companion to the weekly search-and-queue job
// (app/api/cron/weekly-url-review/route.ts) — reads owner approvals/
// rejections back from the Google Sheet and applies them. Runs daily so
// an approval made yesterday lands quickly rather than waiting a full
// week.
//
// A row is "already applied" once its ReturnUrlReview.status leaves
// PENDING — this job only acts on rows still PENDING in the DB, so
// re-running it (or running it twice in one day) is safe: already-applied
// rows are simply skipped.

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

  // Fail loudly before any Sheets call, matching the weekly-url-review
  // job's guard — required for both cron routes per owner instruction,
  // even though this route doesn't read APP_DOMAIN itself. Deliberately
  // not defaulted to any hardcoded domain (including selfOutboundGuard.ts's
  // own domain check, which is an independently-owned concern).
  const appDomain = process.env.APP_DOMAIN;
  if (!appDomain) {
    return NextResponse.json({ error: "APP_DOMAIN not configured" }, { status: 500 });
  }

  const now = new Date();

  const sheetRows = await readReviewRows();
  const actionableRows = sheetRows.filter((row) => row.status === "approved" || row.status === "rejected");

  const orderIds = actionableRows.map((row) => row.orderId).filter(Boolean);
  const reviewRows = await prisma.returnUrlReview.findMany({
    where: { orderId: { in: orderIds } },
    include: { order: { select: { id: true, retailer: true } } },
  });
  const reviewByOrderId = new Map(reviewRows.map((r) => [r.orderId, r]));

  const applied: { orderId: string; status: string }[] = [];
  const skippedAlreadyApplied: string[] = [];
  const failed: { orderId: string; error: string }[] = [];

  for (const sheetRow of actionableRows) {
    const review = reviewByOrderId.get(sheetRow.orderId);

    if (!review) {
      console.error(`apply-url-reviews: sheet row references unknown order ${sheetRow.orderId}, skipping`);
      failed.push({ orderId: sheetRow.orderId, error: "no matching ReturnUrlReview row found" });
      continue;
    }

    if (review.status !== "PENDING") {
      skippedAlreadyApplied.push(sheetRow.orderId);
      continue;
    }

    try {
      if (sheetRow.status === "approved") {
        await applyApproval(sheetRow, review.order.retailer);
      } else {
        await applyRejection(sheetRow);
      }
      applied.push({ orderId: sheetRow.orderId, status: sheetRow.status });
      console.log(`apply-url-reviews: applied ${sheetRow.status} for order ${sheetRow.orderId}`);
    } catch (error) {
      console.error(`apply-url-reviews: failed to apply ${sheetRow.status} for order ${sheetRow.orderId}`, error);
      failed.push({
        orderId: sheetRow.orderId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (applied.length > 0 || failed.length > 0) {
    await notifyAdmin(
      "Return Window: apply URL reviews summary",
      buildAdminSummary(applied, failed),
      "apply_url_reviews_summary",
    );
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    totalSheetRows: sheetRows.length,
    applied,
    skippedAlreadyApplied,
    failed,
  });
}

async function applyApproval(sheetRow: ReviewRow, currentRetailer: string | null): Promise<void> {
  const approvedRetailer = sheetRow.approvedRetailer.trim();
  const approvedUrl = sheetRow.candidateUrl.trim();

  if (!approvedUrl) {
    throw new Error('sheet row marked "approved" with an empty Candidate URL cell');
  }

  const orderUpdate: { returnPortalUrl: string; retailer?: string } = { returnPortalUrl: approvedUrl };

  // Strict-ish comparison (not passive normalization) — the owner
  // hand-reviewed this row, so a typed correction is deliberate and should
  // land on the order; "GAP" vs "Gap Inc." (case/whitespace only) does NOT
  // count as a change worth writing.
  if (approvedRetailer && isMeaningfulRetailerChange(currentRetailer, approvedRetailer)) {
    orderUpdate.retailer = approvedRetailer;
  }

  // Both writes must land together — an update that flips ReturnUrlReview
  // to APPROVED but fails to write Order.returnPortalUrl would be silent
  // data loss: the row is no longer PENDING, so no future run would ever
  // retry it, and the order's button would stay wrong forever.
  await prisma.$transaction([
    prisma.returnUrlReview.update({
      where: { orderId: sheetRow.orderId },
      data: {
        approvedRetailer: approvedRetailer || null,
        approvedUrl,
        status: "APPROVED",
        reviewedAt: new Date(),
      },
    }),
    prisma.order.update({
      where: { id: sheetRow.orderId },
      data: orderUpdate,
    }),
  ]);
}

async function applyRejection(sheetRow: ReviewRow): Promise<void> {
  const approvedRetailer = sheetRow.approvedRetailer.trim();

  // A rejected URL doesn't invalidate a corrected retailer name typed in
  // the same row — still useful ground truth. Order.retailer and
  // Order.returnPortalUrl are both left untouched on rejection.
  await prisma.returnUrlReview.update({
    where: { orderId: sheetRow.orderId },
    data: {
      approvedRetailer: approvedRetailer || null,
      status: "REJECTED",
      reviewedAt: new Date(),
    },
  });
}

function buildAdminSummary(
  applied: { orderId: string; status: string }[],
  failed: { orderId: string; error: string }[],
): string {
  const lines = [`${applied.length} review(s) applied, ${failed.length} failure(s).`, ""];

  if (failed.length > 0) {
    lines.push("Failed:");
    for (const f of failed) {
      lines.push(`- ${f.orderId} — ${f.error}`);
    }
  }

  return lines.join("\n");
}
