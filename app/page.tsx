import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function snippet(text: string | null, length = 200): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(total: number | null, currency: string | null): string {
  if (total == null) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

// Orders above this are visually emphasized — a higher-value return is
// worth more of the user's attention than a cheap one with the same deadline.
const HIGH_VALUE_THRESHOLD = 150;

const STATUS_LABELS: Record<string, string> = {
  ordered: "Ordered",
  shipped: "Shipped",
  delivered: "Delivered",
  returnable: "Returnable",
  return_started: "Return started",
  refund_pending: "Refund pending",
  completed: "Completed",
  expired: "Expired",
  needs_review: "Needs Review",
};

export default async function Home() {
  const [orders, orphanedEmails] = await Promise.all([
    prisma.order.findMany({
      include: { _count: { select: { emails: true } } },
    }),
    prisma.email.findMany({
      where: { orderId: null },
      orderBy: { receivedAt: "desc" },
    }),
  ]);

  const sortedOrders = [...orders].sort((a, b) => {
    if (a.returnDeadline == null && b.returnDeadline == null) return 0;
    if (a.returnDeadline == null) return 1;
    if (b.returnDeadline == null) return -1;
    return a.returnDeadline.getTime() - b.returnDeadline.getTime();
  });

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-semibold mb-6">Returns Assistant</h1>

      {sortedOrders.length === 0 && orphanedEmails.length === 0 ? (
        <p className="text-zinc-500">No emails yet. Forward one to see it here.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {sortedOrders.map((order) => {
              const isHighValue = (order.orderTotal ?? 0) >= HIGH_VALUE_THRESHOLD;
              return (
                <li
                  key={order.id}
                  className={`border rounded-lg ${
                    isHighValue ? "border-amber-300 border-l-4" : "border-zinc-200"
                  }`}
                >
                  <Link href={`/orders/${order.id}`} className="block p-4 hover:bg-zinc-50">
                    <div className="flex justify-between items-baseline gap-4">
                      <span className="font-semibold text-zinc-800">{order.retailer || "Unknown retailer"}</span>
                      <span className="text-sm text-zinc-500 whitespace-nowrap">
                        {order._count.emails} email{order._count.emails === 1 ? "" : "s"}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 mt-1 text-sm text-zinc-500 flex-wrap">
                      {order.orderNumber && <span>#{order.orderNumber}</span>}
                      {order.orderTotal != null && (
                        <span className={isHighValue ? "font-bold text-zinc-900" : "font-semibold text-zinc-800"}>
                          {formatCurrency(order.orderTotal, order.orderCurrency)}
                        </span>
                      )}
                      {order.returnDeadline && (
                        <span>
                          Return by {formatDate(order.returnDeadline)}
                          {order.deadlineIsEstimated ? " (estimated)" : ""}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 mt-2">
                      <span className="inline-block text-xs font-medium text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded">
                        {STATUS_LABELS[order.status] ?? order.status}
                      </span>
                      {order.needsReview && (
                        <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                          Needs Review
                        </span>
                      )}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>

          {orphanedEmails.length > 0 && (
            <div className="mt-10">
              <h2 className="text-lg font-semibold mb-3">Unlinked emails</h2>
              <p className="text-sm text-zinc-500 mb-4">
                Couldn&apos;t match these to a retailer + order number — review and clean up manually.
              </p>
              <ul className="flex flex-col gap-4">
                {orphanedEmails.map((email) => (
                  <li key={email.id} className="border border-zinc-200 rounded-lg">
                    <Link href={`/emails/${email.id}`} className="block p-4 hover:bg-zinc-50">
                      <div className="flex justify-between items-baseline gap-4">
                        <span className="font-medium truncate">
                          {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
                        </span>
                        <span className="text-sm text-zinc-500 whitespace-nowrap">
                          {email.receivedAt.toLocaleString()}
                        </span>
                      </div>
                      <p className="font-semibold mt-1">{email.subject || "(no subject)"}</p>
                      <p className="text-zinc-600 mt-1">{snippet(email.textBody)}</p>
                      {email.needsReview && (
                        <span className="inline-block mt-2 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                          Needs Review
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </main>
  );
}
