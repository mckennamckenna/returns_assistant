import Link from "next/link";
import { notFound } from "next/navigation";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isValidAdminSecret } from "@/lib/adminAuth";
import { getInboundAddress } from "@/lib/inboundAddress";

export const dynamic = "force-dynamic";

// Dashboard V1 step 1 (TASKS.md 🔴 Now, 2026-09-06) — cross-user orders
// table. Read-only: no row-level actions beyond the click-through to the
// existing per-order detail page. Same stateless secret gate as
// app/admin/page.tsx, per that Now entry's instruction to reuse whatever
// gate that page uses rather than introduce a new auth check.

const PAGE_SIZE = 50;

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

type SearchParams = {
  secret?: string;
  page?: string;
  needsReview?: string;
  displayStatus?: string;
  retailer?: string;
  user?: string;
  missingDeadline?: string;
  lowConfidence?: string;
};

// Preserves every active filter (and the secret) while only changing `page`
// — used by the Prev/Next links below.
function buildPageHref(params: SearchParams, page: number): string {
  const qs = new URLSearchParams();
  if (params.secret) qs.set("secret", params.secret);
  if (params.needsReview) qs.set("needsReview", params.needsReview);
  if (params.displayStatus) qs.set("displayStatus", params.displayStatus);
  if (params.retailer) qs.set("retailer", params.retailer);
  if (params.user) qs.set("user", params.user);
  if (params.missingDeadline) qs.set("missingDeadline", params.missingDeadline);
  if (params.lowConfidence) qs.set("lowConfidence", params.lowConfidence);
  qs.set("page", String(page));
  return `/admin/orders?${qs.toString()}`;
}

export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  if (!isValidAdminSecret(params.secret)) {
    notFound();
  }

  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const where: Prisma.OrderWhereInput = {};
  if (params.needsReview === "true") where.needsReview = true;
  if (params.displayStatus) where.displayStatus = params.displayStatus;
  if (params.retailer) where.retailer = { contains: params.retailer, mode: "insensitive" };
  if (params.user) where.user = { email: { contains: params.user, mode: "insensitive" } };
  if (params.missingDeadline === "true") where.returnDeadline = null;
  if (params.lowConfidence === "true") where.emails = { some: { confidence: "low" } };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      select: {
        id: true,
        retailer: true,
        orderNumber: true,
        displayStatus: true,
        returnDeadline: true,
        needsReview: true,
        updatedAt: true,
        user: { select: { inboundToken: true, email: true } },
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto w-full">
      <h1 className="text-2xl font-semibold mb-8">All orders</h1>

      <form className="flex flex-wrap gap-2 mb-4 text-sm" method="get">
        <input type="hidden" name="secret" value={params.secret} />
        <select name="needsReview" defaultValue={params.needsReview ?? ""} className="rounded-lg border border-border px-2 py-1.5">
          <option value="">Needs review: any</option>
          <option value="true">Needs review: yes</option>
        </select>
        <select name="displayStatus" defaultValue={params.displayStatus ?? ""} className="rounded-lg border border-border px-2 py-1.5">
          <option value="">Status: any</option>
          <option value="ordered">ordered</option>
          <option value="shipped">shipped</option>
          <option value="delivered">delivered</option>
          <option value="return_requested">return_requested</option>
          <option value="returned">returned</option>
          <option value="refunded">refunded</option>
          <option value="kept">kept</option>
        </select>
        <input
          type="text"
          name="retailer"
          placeholder="Retailer contains…"
          defaultValue={params.retailer ?? ""}
          className="rounded-lg border border-border px-2 py-1.5"
        />
        <input
          type="text"
          name="user"
          placeholder="User email contains…"
          defaultValue={params.user ?? ""}
          className="rounded-lg border border-border px-2 py-1.5"
        />
        <select name="missingDeadline" defaultValue={params.missingDeadline ?? ""} className="rounded-lg border border-border px-2 py-1.5">
          <option value="">Deadline: any</option>
          <option value="true">Missing deadline</option>
        </select>
        <select name="lowConfidence" defaultValue={params.lowConfidence ?? ""} className="rounded-lg border border-border px-2 py-1.5">
          <option value="">Confidence: any</option>
          <option value="true">Has low-confidence email</option>
        </select>
        <button type="submit" className="text-sm font-medium rounded-lg px-3 py-1.5 bg-ink text-page hover:bg-ink/90">
          Apply
        </button>
      </form>

      <p className="text-sm text-secondary mb-3">
        {total} order{total === 1 ? "" : "s"} · page {page} of {totalPages}
      </p>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted uppercase tracking-wide">
              <th className="py-2 pl-4 pr-4">User</th>
              <th className="py-2 pr-4">Retailer</th>
              <th className="py-2 pr-4">Order #</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Deadline</th>
              <th className="py-2 pr-4">Needs review</th>
              <th className="py-2 pr-4">Updated</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const forwardingAddress = getInboundAddress(order.user.inboundToken);
              return (
                <tr key={order.id} className="border-b border-border last:border-0">
                  <td className="py-2 pl-4 pr-4 text-secondary">{order.user.email}</td>
                  <td className="py-2 pr-4">
                    <Link
                      href={`/admin/users/${encodeURIComponent(forwardingAddress)}/orders/${order.id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {order.retailer || "Unknown retailer"}
                    </Link>
                  </td>
                  <td className="py-2 pr-4 text-secondary">{order.orderNumber || "—"}</td>
                  <td className="py-2 pr-4 text-secondary">{order.displayStatus}</td>
                  <td className="py-2 pr-4 text-secondary">{formatDate(order.returnDeadline)}</td>
                  <td className="py-2 pr-4 text-secondary">{order.needsReview ? "yes" : "—"}</td>
                  <td className="py-2 pr-4 text-secondary">{formatDateTime(order.updatedAt)}</td>
                </tr>
              );
            })}
            {orders.length === 0 && (
              <tr>
                <td colSpan={7} className="py-4 pl-4 pr-4 text-sm text-secondary">
                  No orders match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex gap-2 mt-4 text-sm">
        {page > 1 && (
          <Link href={buildPageHref(params, page - 1)} className="px-3 py-1.5 rounded-lg border border-border text-ink hover:bg-page">
            &larr; Prev
          </Link>
        )}
        {page < totalPages && (
          <Link href={buildPageHref(params, page + 1)} className="px-3 py-1.5 rounded-lg border border-border text-ink hover:bg-page">
            Next &rarr;
          </Link>
        )}
      </div>
    </main>
  );
}
