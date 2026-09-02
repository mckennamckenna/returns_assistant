import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyToken, signCsrfToken } from "@/lib/actionToken";
import { decideStartReturnPageState, type StartReturnOrderDetails } from "@/lib/startReturnPageState";
import { truncateOrderNumber } from "@/lib/orderNumberDisplay";
import { formatCalendarDate } from "@/lib/dateDisplay";
import { StartReturnSubmitButton } from "./StartReturnSubmitButton";

export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

const formatDate = formatCalendarDate;

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

// Deliberately minimal — no nav, no footer, no links out beyond "Not now".
// Shared by every non-confirm state (invalid/expired/already_used/
// order_state_changed/no_portal), matching the design spec's "single
// centered card" layout for the whole page, not just the confirm state.
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
        <span className="text-xl font-semibold text-ink">Return Window</span>
        <h1 className="text-lg font-medium text-ink mt-6">{title}</h1>
        {order && <p className="text-secondary text-sm mt-1">{orderLabel(order)}</p>}
        <p className="text-secondary text-sm mt-2">{body}</p>
      </div>
    </main>
  );
}

function metaLine(parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null).join(" · ");
}

function ConfirmCard({ order, csrf, token }: { order: StartReturnOrderDetails; csrf: string; token: string }) {
  const retailer = order.retailer ?? "this retailer";
  const total = formatCurrency(order.orderTotal, order.orderCurrency);
  const orderRef = order.orderNumber ? `Order ${truncateOrderNumber(order.orderNumber)}` : null;
  const firstLine = metaLine([orderRef, total]);
  const orderedLine = order.orderDate ? `Ordered ${formatDate(order.orderDate)}` : null;
  const deadlineLine = order.returnDeadline ? `Return by ${formatDate(order.returnDeadline)}` : null;
  const secondLine = metaLine([orderedLine, deadlineLine]);

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-ink">Return Window</span>
        <h1 className="text-lg font-medium text-ink mt-6">Return to {retailer}</h1>
        {firstLine && <p className="text-secondary text-sm mt-2">{firstLine}</p>}
        {secondLine && <p className="text-secondary text-sm mt-1">{secondLine}</p>}
        <form method="POST" action="/api/action/start-return" className="mt-6">
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="csrf" value={csrf} />
          {order.orderNumber && (
            <p className="text-xs text-muted mb-2">
              We&rsquo;ll copy your order number to your clipboard — paste it on {retailer}&rsquo;s page if they ask
              for it.
            </p>
          )}
          <StartReturnSubmitButton orderNumber={order.orderNumber} retailer={retailer} />
        </form>
        <a href={APP_URL} className="inline-block mt-4 text-xs text-muted hover:text-secondary">
          Not now
        </a>
      </div>
    </main>
  );
}

export default async function StartReturnActionPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;

  if (!token) {
    return <MessagePage title="This link is invalid" body="Contact support." />;
  }

  const verifyResult = verifyToken(token, { action: "start-return" });

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
        returnPortalUrl: true,
        deletedAt: true,
      },
    });
  }

  const state = decideStartReturnPageState(verifyResult, redemption, order);

  switch (state.state) {
    case "invalid":
      return <MessagePage title="This link is invalid" body="Contact support." />;
    case "expired":
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
    case "no_portal":
      return (
        <MessagePage
          title="No return link available"
          body="Open the app to find a return option for this order."
          order={state.order}
        />
      );
    case "confirm": {
      // Invariant: decideStartReturnPageState only returns "confirm" when
      // verifyResult.valid is true (it's the branch reached after every
      // !verifyResult.valid case has already returned).
      if (!verifyResult.valid) {
        throw new Error("unreachable: confirm state implies a valid token");
      }
      const csrf = signCsrfToken(token);
      return <ConfirmCard order={state.order} csrf={csrf} token={token} />;
    }
  }
}
