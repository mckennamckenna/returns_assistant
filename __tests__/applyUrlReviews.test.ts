import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Route-level smoke coverage for the apply-url-reviews cron, focused on the
// 2026-09-16 URL-shape defense-in-depth fix (TASKS.md). Not full coverage
// of every branch (already-applied skip, missing-review failure, etc.) —
// this mirrors weeklyUrlReview.test.ts's "alpha infra, smoke coverage
// only" convention.

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    returnUrlReview: {
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn().mockResolvedValue({}),
    },
    order: {
      update: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/adminNotify", () => ({ notifyAdmin: vi.fn() }));
vi.mock("@/lib/sheets", () => ({ readReviewRows: vi.fn() }));

import { GET } from "@/app/api/cron/apply-url-reviews/route";
import { readReviewRows, type ReviewRow } from "@/lib/sheets";

function makeSheetRow(overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    rowNumber: 2,
    orderId: "order-1",
    rawRetailer: "Shopbop",
    approvedRetailer: "Shopbop",
    queryUsed: "Shopbop returns",
    currentReturnPortalUrl: "",
    candidateUrl: "https://shopbop.com/returns",
    status: "approved",
    ...overrides,
  };
}

describe("apply-url-reviews GET", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = "test-secret";
    process.env.APP_DOMAIN = "myreturnwindow.com";
    mockPrisma.returnUrlReview.findMany.mockResolvedValue([
      {
        orderId: "order-1",
        status: "PENDING",
        order: { id: "order-1", retailer: "Shopbop" },
      },
    ]);
    mockPrisma.$transaction.mockImplementation(async (ops: unknown[]) => Promise.all(ops as Promise<unknown>[]));
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  function makeRequest() {
    return new NextRequest("https://example.com/api/cron/apply-url-reviews?secret=test-secret");
  }

  // T3/T4 (2026-09-16 fix) — a URL-shaped Approved-retailer cell must not
  // reach Order.retailer, and the row must stay PENDING (not APPLIED, not
  // REJECTED) so it's re-evaluated on the next run once the owner fixes
  // the cell.
  it("rejects a URL-shaped approvedRetailer: no Order.retailer write, row stays PENDING, warning logged", async () => {
    vi.mocked(readReviewRows).mockResolvedValue([
      makeSheetRow({ approvedRetailer: "shopbop.com" }),
    ] as Awaited<ReturnType<typeof readReviewRows>>);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.order.update).not.toHaveBeenCalled();
    expect(mockPrisma.returnUrlReview.update).not.toHaveBeenCalled();

    expect(body.skippedUrlShaped).toEqual(["order-1"]);
    expect(body.applied).toEqual([]);
    expect(body.failed).toEqual([]);

    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("order-1"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("shopbop.com"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("URL-shape rejected by apply-cron defense"));
  });

  it("applies a clean (non-URL-shaped) approvedRetailer normally", async () => {
    vi.mocked(readReviewRows).mockResolvedValue([
      makeSheetRow({ approvedRetailer: "Shopbop, Inc." }),
    ] as Awaited<ReturnType<typeof readReviewRows>>);

    const response = await GET(makeRequest());
    const body = await response.json();

    expect(mockPrisma.$transaction).toHaveBeenCalled();
    expect(body.skippedUrlShaped).toEqual([]);
    expect(body.applied).toEqual([{ orderId: "order-1", status: "approved" }]);
  });
});
