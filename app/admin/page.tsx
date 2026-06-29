import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { isValidAdminSecret } from "@/lib/adminAuth";
import { reviewReason, reviewReasonLabel } from "@/lib/orderReview";
import { getInboundAddress } from "@/lib/inboundAddress";
import { adminApproveAction, adminSplitAction } from "./actions";

export const dynamic = "force-dynamic";

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>;
}) {
  // Stateless gate: every load re-checks the query param against
  // ADMIN_SECRET. A 404, not a "wrong password" page — this URL is meant
  // to be unguessable and unlinked, not a login form someone could probe.
  const { secret } = await searchParams;
  if (!isValidAdminSecret(secret)) {
    notFound();
  }

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [reviewOrders, users, recentSends, discardRows] = await Promise.all([
    prisma.order.findMany({
      where: { needsReview: true },
      include: {
        user: { select: { email: true } },
        emails: { select: { subject: true, extractionNotes: true, orderNumber: true, confidence: true }, orderBy: { receivedAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.user.findMany({
      include: { _count: { select: { orders: true, emails: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.reminder.findMany({
      take: 50,
      orderBy: { sentAt: "desc" },
      include: { order: { select: { retailer: true, orderNumber: true } }, user: { select: { email: true } } },
    }),
    prisma.discardLog.findMany({
      where: { reason: "non_commerce", occurredAt: { gte: thirtyDaysAgo } },
      select: { occurredAt: true },
    }),
  ]);

  // Small N at this stage — a per-user query is simpler and clearer than
  // a single aggregate query that'd need raw SQL for a "max per group".
  const lastEmailByUser = await Promise.all(
    users.map((u) => prisma.email.findFirst({ where: { userId: u.id }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true } })),
  );

  const discardByDay = new Map<string, number>();
  for (const row of discardRows) {
    const day = row.occurredAt.toISOString().slice(0, 10);
    discardByDay.set(day, (discardByDay.get(day) ?? 0) + 1);
  }
  const discardDays = [...discardByDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <main className="min-h-screen p-8 max-w-6xl mx-auto w-full">
      <h1 className="text-2xl font-semibold mb-8">Admin</h1>

      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-3">Needs review ({reviewOrders.length})</h2>
        {reviewOrders.length === 0 ? (
          <p className="text-sm text-stone-500">Nothing flagged right now.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {reviewOrders.map((order) => (
              <div key={order.id} className="bg-white border border-amber-200 rounded-lg p-4">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <span className="font-medium text-stone-800">{order.retailer || "Unknown retailer"}</span>
                    {order.orderNumber && <span className="text-sm text-stone-400 ml-2">#{order.orderNumber}</span>}
                  </div>
                  <span className="text-sm text-stone-500">{order.user.email}</span>
                </div>
                <p className="text-sm font-medium text-stone-700 mt-2">{reviewReasonLabel(order)}</p>
                <p className="text-xs text-stone-400 mt-1">{reviewReason(order)}</p>
                <p className="text-xs text-stone-400 mt-2">
                  Emails: {order.emails.map((e) => e.subject || "(no subject)").join(" · ")}
                </p>
                {order.userNote && (
                  <p className="text-sm text-stone-700 italic mt-2 border-l-2 border-amber-300 pl-2">User note: {order.userNote}</p>
                )}
                <form className="mt-3 flex gap-2">
                  <input type="hidden" name="secret" value={secret} />
                  <button
                    type="submit"
                    formAction={adminApproveAction.bind(null, order.id)}
                    className="text-sm font-medium rounded-lg px-3 py-1.5 bg-rose-600 text-white hover:bg-rose-700"
                  >
                    Approve
                  </button>
                  <button
                    type="submit"
                    formAction={adminSplitAction.bind(null, order.id)}
                    className="text-sm font-medium rounded-lg px-3 py-1.5 border border-stone-300 text-stone-700 hover:bg-stone-50"
                  >
                    Split
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-3">Recent users ({users.length})</h2>
        <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs font-medium text-stone-400 uppercase tracking-wide">
                <th className="py-2 pl-4 pr-4">Email</th>
                <th className="py-2 pr-4">Joined</th>
                <th className="py-2 pr-4">Orders</th>
                <th className="py-2 pr-4">Emails</th>
                <th className="py-2 pr-4">Last email</th>
                <th className="py-2 pr-4">Inbound address</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <tr key={user.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 pl-4 pr-4">{user.email}</td>
                  <td className="py-2 pr-4 text-stone-500">{formatDate(user.createdAt)}</td>
                  <td className="py-2 pr-4 text-stone-500">{user._count.orders}</td>
                  <td className="py-2 pr-4 text-stone-500">{user._count.emails}</td>
                  <td className="py-2 pr-4 text-stone-500">{formatDateTime(lastEmailByUser[i]?.receivedAt ?? null)}</td>
                  <td className="py-2 pr-4 text-stone-500 font-mono text-xs whitespace-nowrap">
                    {getInboundAddress(user.inboundToken)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-12">
        <h2 className="text-lg font-semibold mb-3">Recent sends (last {recentSends.length})</h2>
        <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-100 text-left text-xs font-medium text-stone-400 uppercase tracking-wide">
                <th className="py-2 pl-4 pr-4">User</th>
                <th className="py-2 pr-4">Order</th>
                <th className="py-2 pr-4">Type</th>
                <th className="py-2 pr-4">Sent</th>
              </tr>
            </thead>
            <tbody>
              {recentSends.map((reminder) => (
                <tr key={reminder.id} className="border-b border-stone-50 last:border-0">
                  <td className="py-2 pl-4 pr-4">{reminder.user.email}</td>
                  <td className="py-2 pr-4 text-stone-500">
                    {reminder.order
                      ? `${reminder.order.retailer || "Unknown"}${reminder.order.orderNumber ? ` #${reminder.order.orderNumber}` : ""}`
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-stone-500">{reminder.reminderType}</td>
                  <td className="py-2 pr-4 text-stone-500">{formatDateTime(reminder.sentAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-3">Discard log — non-commerce (last 30 days)</h2>
        {discardDays.length === 0 ? (
          <p className="text-sm text-stone-500">No discards in this window.</p>
        ) : (
          <div className="bg-white border border-stone-200 rounded-lg overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-100 text-left text-xs font-medium text-stone-400 uppercase tracking-wide">
                  <th className="py-2 pl-4 pr-4">Day</th>
                  <th className="py-2 pr-4">Discarded</th>
                </tr>
              </thead>
              <tbody>
                {discardDays.map(([day, count]) => (
                  <tr key={day} className="border-b border-stone-50 last:border-0">
                    <td className="py-2 pl-4 pr-4">{day}</td>
                    <td className="py-2 pr-4 text-stone-500">{count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}
