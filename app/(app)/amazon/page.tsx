import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { isAmazonOrder, amazonRowLabel, compareNullableDate } from "@/lib/amazonBundle";
import { ArchiveOrderButton } from "@/app/ArchiveOrderButton";

export const dynamic = "force-dynamic";

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

function itemSummary(lineItems: unknown): string | null {
  if (!isLineItemArray(lineItems) || lineItems.length === 0) return null;
  const [first, ...rest] = lineItems;
  return rest.length > 0 ? `${first.name} +${rest.length} more` : first.name;
}

// v1, awareness-only (AMAZON_HANDLING.md 1.2 footer) — the full read-only
// Amazon list, all states, reached via the dashboard bundle card's
// "View all" link. Same row format as the bundle's expanded rows, minus the
// delivered-only filter.
export default async function AmazonOrdersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const now = new Date();
  const allOrders = await prisma.order.findMany({
    where: { userId: session.user.id, archivedAt: null, deletedAt: null },
  });
  const orders = allOrders
    .filter((o) => isAmazonOrder(o.retailer))
    .sort((a, b) => compareNullableDate(a.returnDeadline, b.returnDeadline));

  return (
    <main className="flex-1 min-w-0 px-5 pt-4 pb-20 md:pb-8 md:pl-12 md:pr-8 md:pt-12 max-w-[860px]">
      <header className="mb-[22px] flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-[30px] md:text-[38px] leading-[1.08] font-medium text-ink">Amazon orders</h1>
          <p className="text-sm text-muted mt-1">All your Amazon orders in one place — read-only.</p>
        </div>
        <a
          href="https://www.amazon.com"
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 bg-ink text-page text-sm font-medium rounded-lg px-4 py-2 hover:bg-ink/90 whitespace-nowrap"
        >
          Go to Amazon
        </a>
      </header>

      {orders.length === 0 ? (
        <p className="text-secondary">
          No Amazon orders right now.{" "}
          <Link href="/" className="underline">
            Back to dashboard
          </Link>
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {orders.map((order) => (
            <div key={order.id} className="bg-card border border-border rounded-2xl p-[18px] flex items-center justify-between gap-3">
              <Link href={`/orders/${order.id}`} className="min-w-0 flex-1">
                <p className="text-sm text-ink truncate">{itemSummary(order.lineItems) ?? order.orderNumber ?? "Order"}</p>
                <p className="text-xs text-muted">{formatCurrency(order.orderTotal, order.orderCurrency)}</p>
              </Link>
              <span className="text-xs text-muted whitespace-nowrap">{amazonRowLabel(order, now)}</span>
              <ArchiveOrderButton orderId={order.id} isArchived={false} className="text-xs text-muted underline whitespace-nowrap" />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
