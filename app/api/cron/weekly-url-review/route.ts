import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { notifyAdmin } from "@/lib/adminNotify";
import { activeOrderFilter } from "@/lib/orderFilters";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { normalizeRetailer } from "@/lib/retailer-normalize";
import { searchWeb, SerperResult } from "@/lib/search";
import { ensureSheetHeaders, appendReviewRow } from "@/lib/sheets";

export const dynamic = "force-dynamic";

// Alpha weekly search-and-verify (TASKS.md 🔴 Now, "Alpha weekly
// search-and-verify for returnPortalUrl"). Queues every active
// non-Amazon order that doesn't already have a ReturnUrlReview row —
// deliberately NOT scoped to "new this week": the primary motivation is
// fixing the existing bad-URL backlog (52.8% of active non-Amazon
// returnPortalUrl values measured bad), so the first run queues the
// whole backlog. Subsequent runs only pick up genuinely new orders,
// since backlog orders already have a review row by then. Self-healing:
// an order whose search failed this run has no review row, so it's
// picked up again next run automatically (see the per-order catch
// block below).

const KNOWN_CARRIER_DOMAINS = ["ups.com", "fedex.com", "usps.com", "dhl.com"];
// Illustrative, not exhaustive — extend as bad matches surface in review.
const KNOWN_MARKETING_DOMAINS = ["bit.ly", "sendgrid.net", "mailchimp.com", "klaviyo.com", "list-manage.com"];

const BAD_PATH_KEYWORDS = ["contact", "help", "support", "track", "login", "signin", "account"];
const GOOD_PATH_KEYWORDS_STRONG = ["return", "returns"];
const GOOD_PATH_KEYWORDS_WEAK = ["policy", "refund"];

function extractDomain(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

function domainMatchesOrIsSubdomainOf(domain: string, target: string): boolean {
  return domain === target || domain.endsWith(`.${target}`);
}

function isCarrierOrMarketingDomain(domain: string): boolean {
  return [...KNOWN_CARRIER_DOMAINS, ...KNOWN_MARKETING_DOMAINS].some((known) =>
    domainMatchesOrIsSubdomainOf(domain, known),
  );
}

// Exported for tests. knownDomain is the retailer's own domain when it was
// derivable (search-subject priority (2): an existing returnPortalUrl that
// already looked like a real domain) — null when the search subject came
// from a retailer-name string instead, in which case the +5 own-domain
// bonus never applies (there's nothing confirmed to compare against).
export function scoreResult(result: SerperResult, knownDomain: string | null, appDomain: string): number {
  const domain = extractDomain(result.url);
  if (!domain) return -10; // unparseable URL — treat as worst case, never surfaced as top candidate

  let score = 0;
  // Pathname only, not the full URL string — the domain itself can
  // spuriously contain a keyword (e.g. "myreturnwindow.com" contains
  // "return"), which would otherwise offset the own-domain penalty below.
  const path = new URL(result.url).pathname.toLowerCase();

  if (knownDomain && domain === knownDomain) score += 5;
  if (GOOD_PATH_KEYWORDS_STRONG.some((kw) => path.includes(kw))) score += 3;
  if (GOOD_PATH_KEYWORDS_WEAK.some((kw) => path.includes(kw))) score += 2;
  if (BAD_PATH_KEYWORDS.some((kw) => path.includes(kw))) score -= 3;
  if (isCarrierOrMarketingDomain(domain)) score -= 5;
  if (domainMatchesOrIsSubdomainOf(domain, appDomain)) score -= 10;

  return score;
}

interface SearchSubject {
  subject: string;
  knownDomain: string | null;
}

// Priority order per spec: (1) a previously-approved retailer name for the
// same normalized retailer, so week 2+ orders benefit from prior
// corrections; (2) the order's existing returnPortalUrl's domain, when it
// looks like a real retailer domain (not a carrier/marketing/our-own
// domain); (3) the passive-normalized Order.retailer as a last resort.
export function resolveSearchSubject(
  order: { retailer: string | null; returnPortalUrl: string | null },
  approvedRetailerByNormalizedName: Map<string, string>,
  appDomain: string,
): SearchSubject {
  const normalized = normalizeRetailer(order.retailer ?? "");
  const priorApproval = approvedRetailerByNormalizedName.get(normalized);
  if (priorApproval) {
    return { subject: priorApproval, knownDomain: null };
  }

  if (order.returnPortalUrl) {
    const domain = extractDomain(order.returnPortalUrl);
    if (domain && !isCarrierOrMarketingDomain(domain) && !domainMatchesOrIsSubdomainOf(domain, appDomain)) {
      return { subject: domain, knownDomain: domain };
    }
  }

  return { subject: normalized, knownDomain: null };
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

  // Fail loudly before any Serper/Sheets call — deliberately not defaulted
  // to any hardcoded domain (including selfOutboundGuard.ts's own domain
  // check, which is an independently-owned concern; coupling them means a
  // rename to one silently breaks the other).
  const appDomain = process.env.APP_DOMAIN;
  if (!appDomain) {
    return NextResponse.json({ error: "APP_DOMAIN not configured" }, { status: 500 });
  }

  const now = new Date();

  const priorApprovals = await prisma.returnUrlReview.findMany({
    where: { status: "APPROVED", approvedRetailer: { not: null } },
    orderBy: { reviewedAt: "desc" },
    select: { rawRetailer: true, approvedRetailer: true },
  });
  const approvedRetailerByNormalizedName = new Map<string, string>();
  for (const row of priorApprovals) {
    const key = normalizeRetailer(row.rawRetailer);
    // orderBy reviewedAt desc means the first row seen per key is the
    // most recent approval — later duplicates are ignored.
    if (!approvedRetailerByNormalizedName.has(key) && row.approvedRetailer) {
      approvedRetailerByNormalizedName.set(key, row.approvedRetailer);
    }
  }

  const candidateOrders = await prisma.order.findMany({
    where: {
      ...activeOrderFilter,
      retailer: { not: null },
      returnUrlReview: null,
    },
    select: { id: true, retailer: true, returnPortalUrl: true },
  });

  const queued: { orderId: string; retailer: string | null; candidateUrl: string | null }[] = [];
  const failed: { orderId: string; retailer: string | null; error: string }[] = [];
  const skippedAmazon: string[] = [];

  await ensureSheetHeaders();

  for (const order of candidateOrders) {
    if (isAmazonOrder(order.retailer)) {
      skippedAmazon.push(order.id);
      continue;
    }

    try {
      const { subject, knownDomain } = resolveSearchSubject(order, approvedRetailerByNormalizedName, appDomain);
      const query = `"${subject}" returns`;

      const results = await searchWeb(query);
      const top10 = results.slice(0, 10);
      const scored = top10
        .map((result) => ({ result, score: scoreResult(result, knownDomain, appDomain) }))
        .sort((a, b) => b.score - a.score);

      const candidateUrl = scored[0]?.result.url ?? "";
      const alternative1 = scored[1]?.result.url ?? "";
      const alternative2 = scored[2]?.result.url ?? "";
      const allNegative = scored.length > 0 && scored.every((s) => s.score < 0);

      const sheetRowId = await appendReviewRow({
        orderId: order.id,
        rawRetailer: order.retailer ?? "",
        approvedRetailerPrefill: subject,
        queryUsed: query,
        currentReturnPortalUrl: order.returnPortalUrl ?? "",
        candidateUrl,
        alternative1,
        alternative2,
        queuedAt: now.toISOString(),
        urlNotesPrefill: allNegative ? "all candidates scored negatively, likely no good page exists" : undefined,
      });

      await prisma.returnUrlReview.create({
        data: {
          orderId: order.id,
          rawRetailer: order.retailer ?? "",
          queryUsed: query,
          candidateUrl: candidateUrl || null,
          alternativeUrls: [alternative1, alternative2].filter(Boolean),
          candidateSource: "SEARCH",
          status: "PENDING",
          sheetRowId,
        },
      });

      queued.push({ orderId: order.id, retailer: order.retailer, candidateUrl: candidateUrl || null });
    } catch (error) {
      // No ReturnUrlReview row is created on failure — this is what makes
      // the job self-heal: the order still has no review row, so next
      // week's query picks it up again automatically.
      console.error("Weekly URL review failed for order", order.id, error);
      failed.push({
        orderId: order.id,
        retailer: order.retailer,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (queued.length > 0 || failed.length > 0) {
    await notifyAdmin(
      "Return Window: weekly URL review summary",
      buildAdminSummary(queued, failed, skippedAmazon.length),
      "weekly_url_review_summary",
    );
  }

  return NextResponse.json({
    ranAt: now.toISOString(),
    totalCandidates: candidateOrders.length,
    queued,
    failed,
    skippedAmazon: skippedAmazon.length,
  });
}

function buildAdminSummary(
  queued: { orderId: string; retailer: string | null; candidateUrl: string | null }[],
  failed: { orderId: string; retailer: string | null; error: string }[],
  skippedAmazonCount: number,
): string {
  const lines = [
    `${queued.length} order(s) queued for review, ${failed.length} failure(s), ${skippedAmazonCount} Amazon order(s) skipped.`,
    "",
  ];

  if (failed.length > 0) {
    lines.push("Failed (will retry next run):");
    for (const f of failed) {
      lines.push(`- ${f.orderId} (${f.retailer ?? "unknown retailer"}) — ${f.error}`);
    }
  }

  return lines.join("\n");
}
