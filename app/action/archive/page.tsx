import { createHash } from "crypto";
import { prisma } from "@/lib/db";
import { verifyToken, signCsrfToken } from "@/lib/actionToken";
import { decideArchivePageState } from "@/lib/archivePageState";

export const dynamic = "force-dynamic";

function formatDate(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function MessagePage({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-stone-800">Return Window</span>
        <h1 className="text-lg font-medium text-stone-800 mt-6">{title}</h1>
        <p className="text-stone-500 text-sm mt-2">{body}</p>
      </div>
    </main>
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
      select: { userId: true, retailer: true, orderNumber: true, deletedAt: true },
    });
  }

  const state = decideArchivePageState(verifyResult, redemption, order);

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
        />
      );
    case "order_state_changed":
      return <MessagePage title="No longer available" body="This order is no longer available." />;
    case "confirm": {
      const csrf = signCsrfToken(token);
      const orderLabel = state.orderNumber
        ? `${state.retailer ?? "this order"} #${state.orderNumber}`
        : (state.retailer ?? "this order");

      return (
        <main className="min-h-screen flex items-center justify-center p-8">
          <div className="w-full max-w-sm text-center">
            <span className="text-xl font-semibold text-stone-800">Return Window</span>
            <h1 className="text-lg font-medium text-stone-800 mt-6">Archive {orderLabel}?</h1>
            <p className="text-stone-500 text-sm mt-2">
              This stops all reminders for it — you can still find it in your Archive within the app.
            </p>
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
