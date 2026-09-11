import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { readReviewRows } from "@/lib/sheets";

export const dynamic = "force-dynamic";

// One-off read-only diagnostic (2026-09-11) — NOT a scheduled job,
// deliberately not in vercel.json. During the 2026-09-11 overlapping-
// invocations incident, weekly-url-review's old write order (Sheet
// append before DB create — fixed in the commit right before this one)
// let losing invocations write a Sheet row for an order whose DB row
// another invocation had already claimed, leaving ghost Sheet rows with
// no DB record behind them. This route identifies, for each known-
// affected orderId, which Sheet row is canonical (matches
// ReturnUrlReview.sheetRowId) versus which are ghosts — and reports
// each row's current owner-set status, so the owner can see what
// they've already reviewed before deciding what to clean up. Read-only:
// no writes anywhere, Sheet or DB.
//
// The 12 orderIds below are exactly the set found duplicated by that
// incident (see TASKS.md / that day's session for derivation) — this is
// intentionally NOT a general "scan for any duplicate Sheet row"
// route, since a broader scan wasn't asked for and would surface
// unrelated rows without the same incident-specific vetting.
const KNOWN_DUPLICATED_ORDER_IDS = [
  "cmtrpvmcx0003l7045cbhmsgx", // Bloomingdale's (#781187611)
  "cmts5rxus001yw9hv736f6gqj", // Bloomingdale's (#781160797)
  "cmts5in3v0011w9hvi0gf2au4", // Shutterfly
  "cmtthurcb0001w9i6mafwjdbu", // Row Works Clothing Co.
  "cmtx91sxa0003l504i2gljmdq", // Syncwire
  "cmtuw46490003jn04v8anfdbx", // Zara
  "cmsnp1u8u0004jl04jehpqnbw", // Rowing Pad
  "cmsm3bxhh0003js04fmocudc3", // The RealReal (#R332247205)
  "cmrchi2ul0003kz049itfhi4f", // Gap Inc.
  "cmtau1pe70003lc04614a7qgj", // nmjlmajong
  "cmsho1tjr0003jx04onzv3x1v", // Charmspring
  "cmsvzhb8k0003jz04f2z3h3dz", // The RealReal (#R268770184)
];

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization");
  if (authHeader === `Bearer ${secret}`) return true;

  const url = new URL(request.url);
  return url.searchParams.get("secret") === secret;
}

interface RowSummary {
  rowNumber: number;
  status: string;
}

interface OrderGhostReport {
  orderId: string;
  rawRetailer: string;
  canonicalRow: RowSummary | null;
  ghostRows: RowSummary[];
  summaryLine: string;
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const reviews = await prisma.returnUrlReview.findMany({
    where: { orderId: { in: KNOWN_DUPLICATED_ORDER_IDS } },
    select: { orderId: true, rawRetailer: true, sheetRowId: true },
  });
  const reviewByOrderId = new Map(reviews.map((r) => [r.orderId, r]));

  const sheetRows = await readReviewRows();
  const sheetRowsByOrderId = new Map<string, RowSummary[]>();
  for (const row of sheetRows) {
    if (!KNOWN_DUPLICATED_ORDER_IDS.includes(row.orderId)) continue;
    const existing = sheetRowsByOrderId.get(row.orderId) ?? [];
    existing.push({ rowNumber: row.rowNumber, status: row.status || "(blank)" });
    sheetRowsByOrderId.set(row.orderId, existing);
  }

  const report: OrderGhostReport[] = KNOWN_DUPLICATED_ORDER_IDS.map((orderId) => {
    const review = reviewByOrderId.get(orderId);
    const rawRetailer = review?.rawRetailer ?? "(no ReturnUrlReview row found)";
    const canonicalSheetRowId = review?.sheetRowId ? Number(review.sheetRowId) : null;

    const rows = (sheetRowsByOrderId.get(orderId) ?? []).sort((a, b) => a.rowNumber - b.rowNumber);
    const canonicalRow = rows.find((r) => r.rowNumber === canonicalSheetRowId) ?? null;
    const ghostRows = rows.filter((r) => r.rowNumber !== canonicalSheetRowId);

    const canonicalText = canonicalRow
      ? `canonical is row ${canonicalRow.rowNumber} (status: ${canonicalRow.status})`
      : "canonical row not found in Sheet (check manually)";
    const ghostText = ghostRows.length > 0
      ? ghostRows.map((g) => `ghost row ${g.rowNumber} (status: ${g.status})`).join(", ")
      : "no ghost rows found";
    const summaryLine = `orderId ${orderId} (${rawRetailer}) — ${canonicalText}, ${ghostText}`;

    return { orderId, rawRetailer, canonicalRow, ghostRows, summaryLine };
  });

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    report,
    summaryLines: report.map((r) => r.summaryLine),
  });
}
