import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { getInboundAddress, resolveInboundTokenFromAddress } from "@/lib/inboundAddress";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ forwardingAddress: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.email !== process.env.ADMIN_USER_EMAIL) {
    notFound();
  }

  const { forwardingAddress } = await params;
  const inboundToken = resolveInboundTokenFromAddress(decodeURIComponent(forwardingAddress));
  const user = inboundToken ? await prisma.user.findUnique({ where: { inboundToken } }) : null;
  if (!user) notFound();

  // No activeOrderFilter here, deliberately — extraction-quality debugging
  // often involves orders the user has archived or moved away from, so
  // archived/soft-deleted orders are included on this view, with a visual
  // indicator, rather than hidden like every normal user-facing page.
  const orders = await prisma.order.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      retailer: true,
      orderNumber: true,
      returnDeadline: true,
      estimatedDeliveryDate: true,
      deliveredAt: true,
      displayStatus: true,
      needsReview: true,
      orderDateEstimated: true,
      deadlineIsEstimated: true,
      archivedAt: true,
      deletedAt: true,
    },
  });

  return (
    <main className="min-h-screen p-8 max-w-4xl mx-auto w-full">
      <Link href="/admin/users" className="text-sm text-secondary hover:underline">
        &larr; Back to users
      </Link>

      <h1 className="text-xl font-mono font-semibold mt-4 mb-6 break-all">{getInboundAddress(user.inboundToken)}</h1>

      <div className="bg-card border border-border rounded-lg overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted uppercase tracking-wide">
              <th className="py-2 pl-4 pr-4">Retailer</th>
              <th className="py-2 pr-4">Order #</th>
              <th className="py-2 pr-4">Deadline</th>
              <th className="py-2 pr-4">Est. delivery</th>
              <th className="py-2 pr-4">Delivered</th>
              <th className="py-2 pr-4">Status</th>
              <th className="py-2 pr-4">Needs review</th>
              <th className="py-2 pr-4">Order date est.</th>
              <th className="py-2 pr-4">Deadline est.</th>
              <th className="py-2 pr-4">State</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => (
              <tr
                key={order.id}
                className={`border-b border-border last:border-0 ${order.archivedAt || order.deletedAt ? "opacity-50" : ""}`}
              >
                <td className="py-2 pl-4 pr-4">
                  <Link
                    href={`/admin/users/${encodeURIComponent(forwardingAddress)}/orders/${order.id}`}
                    className="text-blue-600 hover:underline"
                  >
                    {order.retailer || "Unknown retailer"}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-secondary">{order.orderNumber || "—"}</td>
                <td className="py-2 pr-4 text-secondary">{formatDate(order.returnDeadline)}</td>
                <td className="py-2 pr-4 text-secondary">{formatDate(order.estimatedDeliveryDate)}</td>
                <td className="py-2 pr-4 text-secondary">{formatDate(order.deliveredAt)}</td>
                <td className="py-2 pr-4 text-secondary">{order.displayStatus}</td>
                <td className="py-2 pr-4 text-secondary">{order.needsReview ? "yes" : "—"}</td>
                <td className="py-2 pr-4 text-secondary">{order.orderDateEstimated ? "yes" : "—"}</td>
                <td className="py-2 pr-4 text-secondary">{order.deadlineIsEstimated ? "yes" : "—"}</td>
                <td className="py-2 pr-4 text-secondary text-xs">
                  {order.deletedAt ? "Deleted" : order.archivedAt ? "Archived" : "Active"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
