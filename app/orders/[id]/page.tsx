import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { deleteEmail, markReturnRequestedAction, markReturnedAction } from "@/app/actions";
import { DeleteButton } from "@/app/DeleteButton";
import { ArchiveOrderButton } from "@/app/ArchiveOrderButton";
import { MarkRefundedButton } from "@/app/MarkRefundedButton";
import { DisplayStatusBadge } from "@/app/DisplayStatusBadge";
import { DISPLAY_STATUS_RANK } from "@/lib/displayStatus";

export const dynamic = "force-dynamic";

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

function returnWindowFromLabel(startsFrom: string | null): string {
  if (startsFrom === "order_date") return "from order date";
  if (startsFrom === "delivery_date") return "from delivery date";
  return "from purchase";
}

// Combines what used to be two separate fields ("Return window" /
// "Policy source") into one human-readable line, e.g. "30 days from
// delivery date — Web lookup". "Web lookup" is the only source worth
// linking — it's the one case where there's somewhere useful to send a
// skeptical user to verify the policy themselves; "stated in email" and
// "user supplied" have no comparable destination.
function PolicyLine({
  order,
}: {
  order: {
    retailer: string | null;
    returnWindowDays: number | null;
    returnWindowStartsFrom: string | null;
    policySource: string | null;
    returnPortalUrl: string | null;
  };
}): React.ReactNode {
  if (!order.returnWindowDays) return "—";

  const prefix = `${order.returnWindowDays} days ${returnWindowFromLabel(order.returnWindowStartsFrom)}`;

  if (order.policySource === "web_lookup") {
    const lookupUrl =
      order.returnPortalUrl ||
      `https://www.google.com/search?q=${encodeURIComponent(`${order.retailer ?? ""} return policy`)}`;
    return (
      <>
        {prefix} —{" "}
        <a href={lookupUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
          Web lookup
        </a>
      </>
    );
  }

  const sourceText =
    order.policySource === "stated_in_email" ? "stated in email" : order.policySource === "user_supplied" ? "user supplied" : null;

  return sourceText ? `${prefix} — ${sourceText}` : prefix;
}

export default async function OrderDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  // Scoped by userId, not just id — a mismatched owner 404s exactly like a
  // nonexistent order, rather than leaking that *some* order exists at
  // this id but belongs to someone else.
  const order = await prisma.order.findUnique({
    where: { id, userId: session.user.id },
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
          <DisplayStatusBadge status={order.displayStatus} />
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
          <Field
            label="Order date"
            value={order.orderDate ? `${formatDate(order.orderDate)}${order.orderDateEstimated ? " (estimated)" : ""}` : "—"}
          />
          <Field
            label="Delivery date"
            value={(() => {
              const best = order.deliveredAt ?? order.estimatedDeliveryDate ?? order.deliveryDate;
              if (!best) return "—";
              const isEst = !order.deliveredAt && (order.estimatedDeliveryDate != null || order.deliveryDate != null);
              return `${formatDate(best)}${isEst ? " (estimated)" : ""}`;
            })()}
          />
          <Field
            label="Return deadline"
            value={
              <>
                {order.returnDeadline
                  ? `${formatDate(order.returnDeadline)}${
                      order.deadlineIsEstimated
                        ? order.estimatedDeliveryDate
                          ? " (estimated — based on shipping estimate)"
                          : " (estimated)"
                        : ""
                    }`
                  : "—"}
                {order.returnPortalUrl && (
                  <a
                    href={order.returnPortalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline mt-0.5"
                  >
                    View return policy &rarr;
                  </a>
                )}
              </>
            }
          />
          <Field label="Return policy" value={<PolicyLine order={order} />} />
          <Field label="Order total" value={formatCurrency(order.orderTotal, order.orderCurrency)} />
        </dl>

        <div className="flex flex-wrap gap-3 mt-4">
          {order.returnPortalUrl && (
            <a
              href={order.returnPortalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-blue-600 text-white text-sm font-medium rounded px-4 py-2 hover:bg-blue-700"
            >
              Start Return &rarr;
            </a>
          )}
          {order.trackingNumber && order.trackingUrl && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-stone-100 text-stone-700 text-sm font-medium rounded px-4 py-2 hover:bg-stone-200"
            >
              Track package &rarr;
            </a>
          )}
          {order.returnTrackingNumber && order.returnTrackingUrl && (
            <a
              href={order.returnTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block bg-stone-100 text-stone-700 text-sm font-medium rounded px-4 py-2 hover:bg-stone-200"
            >
              Track your return &rarr;
            </a>
          )}
          {(DISPLAY_STATUS_RANK[order.displayStatus] ?? 0) < DISPLAY_STATUS_RANK.return_requested && (
            <form action={markReturnRequestedAction.bind(null, order.id)}>
              <button
                type="submit"
                className="bg-amber-50 text-amber-700 text-sm font-medium rounded px-4 py-2 hover:bg-amber-100 border border-amber-200"
              >
                I&apos;m returning this
              </button>
            </form>
          )}
          {order.displayStatus === "return_requested" && (
            <form action={markReturnedAction.bind(null, order.id)}>
              <button
                type="submit"
                className="bg-green-50 text-green-700 text-sm font-medium rounded px-4 py-2 hover:bg-green-100 border border-green-200"
              >
                Mark as returned
              </button>
            </form>
          )}
          {order.displayStatus === "returned" && (
            <MarkRefundedButton
              orderId={order.id}
              className="bg-emerald-50 text-emerald-700 text-sm font-medium rounded px-4 py-2 hover:bg-emerald-100 border border-emerald-200"
            />
          )}
          <ArchiveOrderButton
            orderId={order.id}
            isArchived={order.archivedAt !== null}
            className="bg-stone-100 text-stone-600 text-sm font-medium rounded px-4 py-2 hover:bg-stone-200"
          />
        </div>

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
          <li key={email.id} className="border border-zinc-200 rounded-lg flex items-stretch">
            <Link href={`/emails/${email.id}`} className="flex-1 block p-3 hover:bg-zinc-50 min-w-0">
              <div className="flex justify-between items-baseline gap-4">
                <span className="font-medium truncate">{email.subject || "(no subject)"}</span>
                <span className="text-sm text-zinc-500 whitespace-nowrap">
                  {email.receivedAt.toLocaleDateString()}
                </span>
              </div>
              <span className="text-xs text-zinc-400">{email.emailType ?? "unclassified"}</span>
            </Link>
            <form action={deleteEmail.bind(null, email.id)} className="flex items-center pr-3">
              <DeleteButton label="Delete email" />
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
