import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyToken, signCsrfToken } from "@/lib/actionToken";
import { decideArchivePageState, type ArchiveOrderDetails } from "@/lib/archivePageState";
import { DisplayStatusBadge } from "@/app/DisplayStatusBadge";
import { daysUntil } from "@/lib/reminders";

export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function formatCurrency(total: number | null, currency: string | null): string | null {
  if (total == null) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

function orderLabel(order: { retailer: string | null; orderNumber: string | null }): string {
  return order.orderNumber ? `${order.retailer ?? "this order"} #${order.orderNumber}` : (order.retailer ?? "this order");
}

function MessagePage({
  title,
  body,
  order,
}: {
  title: string;
  body: string;
  order?: { retailer: string | null; orderNumber: string | null } | null;
}) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-stone-800">Return Window</span>
        <h1 className="text-lg font-medium text-stone-800 mt-6">{title}</h1>
        {order && <p className="text-stone-600 text-sm mt-1">{orderLabel(order)}</p>}
        <p className="text-stone-500 text-sm mt-2">{body}</p>
      </div>
    </main>
  );
}

// The order-detail block shown above the Archive button — reads entirely
// from the same order lookup the page already did (no new DB calls, no
// re-verification of the token). Purely what gets rendered above the
// button; the redemption decision itself lives in Phase 3's endpoint.
function OrderSummary({ order, orderId }: { order: ArchiveOrderDetails; orderId: string }) {
  const total = formatCurrency(order.orderTotal, order.orderCurrency);
  const days = order.returnDeadline ? daysUntil(order.returnDeadline, new Date()) : null;

  return (
    <div className="mt-6 border border-stone-200 rounded-lg p-4 text-left">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-base font-semibold text-stone-800">{order.retailer ?? "Unknown retailer"}</div>
          {order.orderNumber && <div className="text-xs text-stone-400">#{order.orderNumber}</div>}
        </div>
        <DisplayStatusBadge status={order.displayStatus} />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-y-1.5 text-sm">
        {total && (
          <>
            <dt className="text-stone-500">Total</dt>
            <dd className="text-stone-700 text-right">{total}</dd>
          </>
        )}
        {order.orderDate && (
          <>
            <dt className="text-stone-500">Order date</dt>
            <dd className="text-stone-700 text-right">{formatDate(order.orderDate)}</dd>
          </>
        )}
        {order.returnDeadline && (
          <>
            <dt className="text-stone-500">Return deadline</dt>
            <dd className="text-stone-700 text-right">
              {formatDate(order.returnDeadline)}
              {days != null && days >= 0 && <span className="text-stone-400"> ({days}d left)</span>}
            </dd>
          </>
        )}
      </dl>
      <a
        href={`${APP_URL}/orders/${orderId}`}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block mt-3 text-xs font-medium text-stone-600 underline hover:text-stone-800"
      >
        View in app →
      </a>
    </div>
  );
}

export default async function ArchiveActionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <MessagePage title="This link is invalid" body="Contact support." />;
  }

  const verifyResult = verifyToken(token, { action: "archive" });

  // Read-only — only look anything up once the token is at least
  // cryptographically well-formed. This page never writes TokenRedemption
  // or ActionLog; a page view must never look like a redemption attempt.
  let redemption = null;
  let order = null;
  if (verifyResult.valid) {
    const tokenHash = createHash("sha256").update(token).digest("hex");
    redemption = await prisma.tokenRedemption.findUnique({ where: { tokenHash } });
    order = await prisma.order.findUnique({
      where: { id: verifyResult.payload.orderId },
      select: {
        userId: true,
        retailer: true,
        orderNumber: true,
        orderTotal: true,
        orderCurrency: true,
        orderDate: true,
        returnDeadline: true,
        displayStatus: true,
        deletedAt: true,
      },
    });
  }

  const state = decideArchivePageState(verifyResult, redemption, order);

  switch (state.state) {
    case "invalid":
      // Stays minimal — the token's semantic meaning is limited here (bad
      // signature, or the internal-bug-defense userId mismatch), and for
      // the mismatch case specifically, showing order details would leak
      // information about an order that isn't this token's.
      return <MessagePage title="This link is invalid" body="Contact support." />;
    case "expired":
      // Also stays minimal — same reasoning, an expired token's semantic
      // meaning doesn't extend to "here's your order."
      return (
        <MessagePage
          title="This link expired"
          body={`This link expired on ${formatDate(state.expiredAt)}. Open the app to take action.`}
        />
      );
    case "already_used":
      return (
        <MessagePage
          title="Already done"
          body={`This action was already completed on ${formatDate(state.redeemedAt)}.`}
          order={state.order}
        />
      );
    case "order_state_changed":
      return (
        <MessagePage title="No longer available" body="This order is no longer available." order={state.order} />
      );
    case "confirm": {
      // Invariant: decideArchivePageState only returns "confirm" when
      // verifyResult.valid is true (it's the branch reached after every
      // !verifyResult.valid case has already returned). Asserted here
      // rather than silently falling back to an empty orderId.
      if (!verifyResult.valid) {
        throw new Error("unreachable: confirm state implies a valid token");
      }
      const csrf = signCsrfToken(token);

      return (
        <main className="min-h-screen flex items-center justify-center p-8">
          <div className="w-full max-w-sm text-center">
            <span className="text-xl font-semibold text-stone-800">Return Window</span>
            <h1 className="text-lg font-medium text-stone-800 mt-6">Archive {orderLabel(state.order)}?</h1>
            <p className="text-stone-500 text-sm mt-2">
              This stops all reminders for it — you can still find it in your Archive within the app.
            </p>
            <OrderSummary order={state.order} orderId={verifyResult.payload.orderId} />
            <form method="POST" action="/api/action/archive" className="mt-6">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="csrf" value={csrf} />
              <button
                type="submit"
                className="w-full rounded-lg bg-stone-800 text-white py-2.5 text-sm font-medium hover:bg-stone-700"
              >
                Archive this order
              </button>
            </form>
          </div>
        </main>
      );
    }
  }
}
