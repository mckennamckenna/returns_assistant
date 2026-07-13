import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { getInboundAddress } from "@/lib/inboundAddress";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

type SortMode = "recent" | "needsReview";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ sort?: string }>;
}) {
  // Identity-based gate, matching app/admin/onboarding/page.tsx exactly —
  // not the shared-secret pattern app/admin/page.tsx uses. This page shows
  // real per-user extraction data, so it's scoped to one specific account
  // rather than "anyone who knows a secret."
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.email !== process.env.ADMIN_USER_EMAIL) {
    notFound();
  }

  const { sort } = await searchParams;
  const sortMode: SortMode = sort === "needsReview" ? "needsReview" : "recent";

  const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" } });

  // Small N at this stage — a per-user query is simpler and clearer than a
  // single aggregate query that'd need raw SQL for a "max per group" /
  // conditional count. Same pattern already used in app/admin/page.tsx.
  const rows = await Promise.all(
    users.map(async (user) => {
      const [orderCount, needsReviewCount, mostRecentOrder] = await Promise.all([
        prisma.order.count({ where: { userId: user.id } }),
        prisma.order.count({ where: { userId: user.id, needsReview: true } }),
        prisma.order.findFirst({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      ]);
      return {
        forwardingAddress: getInboundAddress(user.inboundToken),
        orderCount,
        needsReviewCount,
        mostRecentOrderAt: mostRecentOrder?.createdAt ?? null,
      };
    }),
  );

  const sorted = [...rows].sort((a, b) => {
    if (sortMode === "needsReview") {
      return b.needsReviewCount - a.needsReviewCount;
    }
    return (b.mostRecentOrderAt?.getTime() ?? 0) - (a.mostRecentOrderAt?.getTime() ?? 0);
  });

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto w-full">
      <h1 className="text-2xl font-semibold mb-2">Users</h1>
      <p className="text-sm text-secondary mb-6">
        Forwarding addresses only — no names, emails, retailers, or dollar amounts on this page.
      </p>

      <div className="flex gap-2 mb-4 text-sm">
        <Link
          href="/admin/users?sort=recent"
          className={`px-3 py-1.5 rounded-lg border ${sortMode === "recent" ? "border-ink bg-ink text-page" : "border-border text-ink hover:bg-page"}`}
        >
          Most recent order
        </Link>
        <Link
          href="/admin/users?sort=needsReview"
          className={`px-3 py-1.5 rounded-lg border ${sortMode === "needsReview" ? "border-ink bg-ink text-page" : "border-border text-ink hover:bg-page"}`}
        >
          Most needsReview
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted uppercase tracking-wide">
              <th className="py-2 pl-4 pr-4">Forwarding address</th>
              <th className="py-2 pr-4">Orders</th>
              <th className="py-2 pr-4">Most recent order</th>
              <th className="py-2 pr-4">Needs review</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.forwardingAddress} className="border-b border-border last:border-0">
                <td className="py-2 pl-4 pr-4 font-mono text-xs">
                  <Link
                    href={`/admin/users/${encodeURIComponent(row.forwardingAddress)}`}
                    className="text-blue-600 hover:underline"
                  >
                    {row.forwardingAddress}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-secondary">{row.orderCount}</td>
                <td className="py-2 pr-4 text-secondary">{formatDate(row.mostRecentOrderAt)}</td>
                <td className="py-2 pr-4 text-secondary">{row.needsReviewCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
