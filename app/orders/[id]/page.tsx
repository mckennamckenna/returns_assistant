import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

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

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(total: number | null, currency: string | null): string {
  if (total == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

interface LineItem {
  name: string;
  price: number | null;
  quantity: number | null;
}

function isLineItemArray(value: unknown): value is LineItem[] {
  return Array.isArray(value) && value.every((item) => typeof item === "object" && item !== null && "name" in item);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-800 mt-0.5">{value ?? "—"}</dd>
    </div>
  );
}

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const order = await prisma.order.findUnique({
    where: { id },
    include: { emails: { orderBy: { receivedAt: "asc" } } },
  });

  if (!order) {
    notFound();
  }

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto w-full">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to dashboard
      </Link>

      <div className="flex justify-between items-baseline gap-4 mt-4">
        <h1 className="text-2xl font-semibold">{order.retailer || "Unknown retailer"}</h1>
        <div className="flex items-center gap-2">
          <span className="inline-block text-xs font-medium text-zinc-600 bg-zinc-100 px-2 py-0.5 rounded">
            {STATUS_LABELS[order.status] ?? order.status}
          </span>
          {order.needsReview && (
            <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              Needs Review
            </span>
          )}
        </div>
      </div>

      <div className="border border-zinc-200 rounded-lg p-4 mt-4">
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field label="Order number" value={order.orderNumber} />
          <Field label="Order date" value={formatDate(order.orderDate)} />
          <Field label="Delivery date" value={formatDate(order.deliveryDate)} />
          <Field label="Return window" value={order.returnWindowDays ? `${order.returnWindowDays} days` : "—"} />
          <Field
            label="Return deadline"
            value={
              order.returnDeadline
                ? `${formatDate(order.returnDeadline)}${order.deadlineIsEstimated ? " (estimated)" : ""}`
                : "—"
            }
          />
          <Field
            label="Policy source"
            value={
              order.policySource === "web_lookup"
                ? "Web lookup"
                : order.policySource === "stated_in_email"
                  ? "Stated in email"
                  : order.policySource === "user_supplied"
                    ? "User supplied"
                    : "—"
            }
          />
          <Field label="Order total" value={formatCurrency(order.orderTotal, order.orderCurrency)} />
        </dl>

        {isLineItemArray(order.lineItems) && order.lineItems.length > 0 && (
          <div className="mt-4">
            <dt className="text-xs uppercase tracking-wide text-zinc-400">Line items</dt>
            <ul className="text-sm text-zinc-800 mt-1">
              {order.lineItems.map((item, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {item.name}
                    {item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : ""}
                  </span>
                  <span className="text-zinc-500 whitespace-nowrap">
                    {item.price != null ? formatCurrency(item.price, order.orderCurrency) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold mt-8 mb-3">
        Linked emails ({order.emails.length})
      </h2>
      <ul className="flex flex-col gap-3">
        {order.emails.map((email) => (
          <li key={email.id} className="border border-zinc-200 rounded-lg">
            <Link href={`/emails/${email.id}`} className="block p-3 hover:bg-zinc-50">
              <div className="flex justify-between items-baseline gap-4">
                <span className="font-medium truncate">{email.subject || "(no subject)"}</span>
                <span className="text-sm text-zinc-500 whitespace-nowrap">
                  {email.receivedAt.toLocaleDateString()}
                </span>
              </div>
              <span className="text-xs text-zinc-400">{email.emailType ?? "unclassified"}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
