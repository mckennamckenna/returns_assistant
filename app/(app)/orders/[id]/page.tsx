import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { deleteEmail, markReturnedAction, markKeptAction } from "@/app/actions";
import { DeleteButton } from "@/app/DeleteButton";
import { ArchiveOrderButton } from "@/app/ArchiveOrderButton";
import { MarkRefundedButton } from "@/app/MarkRefundedButton";
import { StartReturnButton } from "@/app/StartReturnButton";
import { DisplayStatusBadge } from "@/app/DisplayStatusBadge";
import { CopyButton } from "@/app/CopyButton";
import { KEPT_WARNING_CAPTION } from "@/lib/displayStatus";
import { getVisibleActions } from "@/lib/orderActions";
import { returnWindowFromLabel } from "@/lib/returnWindowLabel";

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
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="text-sm text-ink mt-0.5">{value ?? "—"}</dd>
    </div>
  );
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

  const now = new Date();
  const { canStartReturn, canMarkReturned, canKeep, canMarkRefunded } = getVisibleActions(order, now);

  // Consolidated into one note below, rather than repeating "(estimated)" on
  // each field separately — see TRUST_AUDIT.md item 3.
  const deliveryIsEstimated = !order.deliveredAt && (order.estimatedDeliveryDate != null || order.deliveryDate != null);
  const deadlineIsEstimated = order.returnDeadline != null && order.policySource !== "stated_in_email";
  const hasEstimatedField = order.orderDateEstimated || deliveryIsEstimated || deadlineIsEstimated;

  return (
    <main className="flex-1 min-w-0 px-5 pt-4 pb-20 md:pt-8 md:px-8 md:pb-8 max-w-3xl mx-auto">
      <Link href="/" className="text-sm text-secondary hover:underline">
        &larr; Back to dashboard
      </Link>

      <div className="flex justify-between items-baseline gap-4 mt-4">
        <h1 className="text-2xl font-semibold text-ink">{order.retailer || "Unknown retailer"}</h1>
        <div className="flex items-center gap-2">
          <DisplayStatusBadge status={order.displayStatus} />
          {order.needsReview && (
            <span className="inline-block text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              Needs Review
            </span>
          )}
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 mt-4">
        {hasEstimatedField && (
          <p className="text-xs text-accent font-medium mb-3">Some dates on this order are estimated</p>
        )}
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <Field
            label="Order number"
            value={
              order.orderNumber ? (
                <span className="flex items-center gap-2">
                  <span className="break-all">{order.orderNumber}</span>
                  <CopyButton text={order.orderNumber} iconOnly label="Copy order number" />
                </span>
              ) : null
            }
          />
          <Field label="Order date" value={order.orderDate ? formatDate(order.orderDate) : "—"} />
          <Field
            label="Delivery date"
            value={(() => {
              const best = order.deliveredAt ?? order.estimatedDeliveryDate ?? order.deliveryDate;
              return best ? formatDate(best) : "—";
            })()}
          />
          <Field
            label="Return deadline"
            value={
              <>
                {order.returnDeadline ? formatDate(order.returnDeadline) : "—"}
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
          <Field
            label="Order total"
            value={
              <span className="font-serif text-lg font-semibold text-ink">
                {formatCurrency(order.orderTotal, order.orderCurrency)}
              </span>
            }
          />
        </dl>

        <div className="flex flex-wrap items-start gap-3 mt-4">
          {canStartReturn && (
            <StartReturnButton
              orderId={order.id}
              returnPortalUrl={order.returnPortalUrl}
              className="bg-ink text-page text-sm font-medium rounded-lg px-4 py-2 hover:bg-ink/90 disabled:opacity-50"
            />
          )}
          {order.trackingNumber && order.trackingUrl && (
            <a
              href={order.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block border border-border text-ink text-sm font-medium rounded-lg px-4 py-2 hover:bg-page"
            >
              Track package
            </a>
          )}
          {order.returnTrackingNumber && order.returnTrackingUrl && (
            <a
              href={order.returnTrackingUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block border border-border text-ink text-sm font-medium rounded-lg px-4 py-2 hover:bg-page"
            >
              Track your return
            </a>
          )}
          {canMarkReturned && (
            <form action={markReturnedAction.bind(null, order.id)}>
              <button type="submit" className="bg-ink text-page text-sm font-medium rounded-lg px-4 py-2 hover:bg-ink/90">
                Mark as returned
              </button>
            </form>
          )}
          {canMarkRefunded && (
            <MarkRefundedButton
              orderId={order.id}
              className="bg-ink text-page text-sm font-medium rounded-lg px-4 py-2 hover:bg-ink/90"
            />
          )}
          {canKeep && (
            <form action={markKeptAction.bind(null, order.id)} className="flex flex-col items-start gap-1">
              <button
                type="submit"
                className="border border-border text-ink text-sm font-medium rounded-lg px-4 py-2 hover:bg-page"
              >
                Keeping it
              </button>
              <span className="text-xs text-muted">{KEPT_WARNING_CAPTION}</span>
            </form>
          )}
          <ArchiveOrderButton
            orderId={order.id}
            isArchived={order.archivedAt !== null}
            className="border border-border text-ink text-sm font-medium rounded-lg px-4 py-2 hover:bg-page"
          />
        </div>

        {isLineItemArray(order.lineItems) && order.lineItems.length > 0 && (
          <div className="mt-4">
            <dt className="text-xs uppercase tracking-wide text-muted">Line items</dt>
            <ul className="text-sm text-ink mt-1">
              {order.lineItems.map((item, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className="truncate">
                    {item.name}
                    {item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : ""}
                  </span>
                  <span className="text-secondary whitespace-nowrap">
                    {item.price != null ? formatCurrency(item.price, order.orderCurrency) : ""}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <h2 className="text-lg font-semibold text-ink mt-8 mb-3">
        Linked emails ({order.emails.length})
      </h2>
      <ul className="flex flex-col gap-3">
        {order.emails.map((email) => (
          <li key={email.id} className="border border-border rounded-lg flex items-stretch">
            <Link href={`/emails/${email.id}`} className="flex-1 block p-3 hover:bg-page min-w-0">
              <div className="flex justify-between items-baseline gap-4">
                <span className="font-medium text-ink truncate">{email.subject || "(no subject)"}</span>
                <span className="text-sm text-muted whitespace-nowrap">
                  {email.receivedAt.toLocaleDateString()}
                </span>
              </div>
              <span className="text-xs text-muted">{email.emailType ?? "unclassified"}</span>
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
