import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { deleteEmail, approveOrderAction, splitOrderAction } from "@/app/actions";
import { DeleteButton } from "@/app/DeleteButton";
import { ReviewCard } from "@/app/ReviewCard";
import { SearchFilterBar } from "@/app/SearchFilterBar";
import { reviewReason, reviewReasonLabel } from "@/lib/orderReview";
import { decryptEmailContent } from "@/lib/emailEncryption";
import { daysUntil } from "@/lib/reminders";
import { OPEN_STATUSES, isClosingSoon } from "@/lib/alerts";
import { SummaryCard } from "@/app/SummaryCard";
import { OrderCard } from "@/app/OrderCard";

export const dynamic = "force-dynamic";

type SortField = "retailer" | "total" | "purchaseDate" | "deliveryDate" | "returnDate" | "daysLeft";

function formatCurrency(total: number | null, currency: string | null): string {
  if (total == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function snippet(text: string | null, length = 160): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

// Nulls always sort last, regardless of direction — a missing date or total
// isn't "less than zero," it's unknown, and shouldn't jump to the top when
// sorting descending.
function compareNullable(a: number | null, b: number | null, dir: "asc" | "desc"): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return dir === "desc" ? b - a : a - b;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; sort?: string; dir?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const params = await searchParams;
  const q = (params.q ?? "").trim().toLowerCase();
  // No longer surfaced as a dropdown (return-window-design-tokens.md §6
  // Commit 2 drops status tabs in favor of sort-by-urgency-by-default) —
  // still read here for the Summary Card's "View all" link and the
  // Sidebar/Settings "Archived" links, both of which deep-link via ?status=.
  const statusFilter = params.status ?? "all";
  const sortField: SortField = (["retailer", "total", "purchaseDate", "deliveryDate", "returnDate", "daysLeft"] as const).includes(
    params.sort as SortField,
  )
    ? (params.sort as SortField)
    : "returnDate";
  const sortDir: "asc" | "desc" = params.dir === "desc" ? "desc" : "asc";

  const now = new Date();

  const [allOrders, rawOrphanedEmails, reviewOrders] = await Promise.all([
    prisma.order.findMany({
      // includes archived orders so the "Archived" filter tab can show them;
      // soft-deleted orders are still excluded
      where: { userId, deletedAt: null },
      include: { _count: { select: { emails: true } } },
    }),
    prisma.email.findMany({
      where: { orderId: null, userId },
      orderBy: { receivedAt: "desc" },
    }),
    prisma.order.findMany({
      where: { userId, needsReview: true, archivedAt: null, deletedAt: null },
      include: {
        emails: { select: { subject: true, extractionNotes: true, orderNumber: true, confidence: true }, orderBy: { receivedAt: "desc" } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  const orphanedEmails = rawOrphanedEmails.map(decryptEmailContent);

  // Stats only count active (non-archived) orders — archived orders are hidden
  // from the dashboard until the user explicitly opens the Archived tab.
  const activeOrders = allOrders.filter((o) => o.archivedAt === null);

  const openOrders = activeOrders.filter((o) => OPEN_STATUSES.includes(o.status));
  const closingSoonOrders = openOrders.filter((o) => isClosingSoon(o, now));
  const valueAtRisk = closingSoonOrders.reduce((sum, o) => sum + (o.orderTotal ?? 0), 0);

  // Search + status filter
  let visibleOrders = allOrders.filter((order) => {
    if (q) {
      const haystack = `${order.retailer ?? ""} ${order.orderNumber ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    // "Archived" tab is the only place archived orders are visible
    if (statusFilter === "archived") return order.archivedAt !== null;
    if (order.archivedAt !== null) return false; // hide from all other views
    if (statusFilter === "all") return true;
    if (statusFilter === "open") return OPEN_STATUSES.includes(order.status);
    if (statusFilter === "closing_soon") return isClosingSoon(order, now);
    if (statusFilter === "needs_review") return order.needsReview;
    return order.displayStatus === statusFilter;
  });

  // Sort
  visibleOrders = [...visibleOrders].sort((a, b) => {
    switch (sortField) {
      case "retailer":
        return sortDir === "desc"
          ? (b.retailer ?? "").localeCompare(a.retailer ?? "")
          : (a.retailer ?? "").localeCompare(b.retailer ?? "");
      case "total":
        return compareNullable(a.orderTotal, b.orderTotal, sortDir);
      case "purchaseDate":
        return compareNullable(a.orderDate?.getTime() ?? null, b.orderDate?.getTime() ?? null, sortDir);
      case "deliveryDate":
        return compareNullable(a.deliveryDate?.getTime() ?? null, b.deliveryDate?.getTime() ?? null, sortDir);
      case "returnDate":
        return compareNullable(a.returnDeadline?.getTime() ?? null, b.returnDeadline?.getTime() ?? null, sortDir);
      case "daysLeft":
        return compareNullable(
          a.returnDeadline ? daysUntil(a.returnDeadline, now) : null,
          b.returnDeadline ? daysUntil(b.returnDeadline, now) : null,
          sortDir,
        );
    }
  });

  return (
    <main className="flex-1 min-w-0 px-5 pt-4 pb-20 md:pb-8 md:pl-12 md:pr-8 md:pt-12 max-w-[860px]">
      {/* Shrunk from 30/38px (2026-07-13) — read as a hero competing with the
          content rather than a warm header. See TRUST_AUDIT.md item 5. */}
      <header className="mb-6">
        <h1 className="font-serif text-[24px] md:text-[26px] leading-[1.15] font-medium text-ink">{getGreeting()}</h1>
        <p className="text-sm text-muted mt-1">Here&apos;s what&apos;s happening with your returns.</p>
      </header>

      <SearchFilterBar initialQuery={params.q ?? ""} initialSort={sortField} />

      <SummaryCard
        count={closingSoonOrders.length}
        dollarAmount={formatCurrency(valueAtRisk, "USD")}
        href="/?status=closing_soon"
        singleOrderRetailer={closingSoonOrders.length === 1 ? closingSoonOrders[0].retailer : null}
      />

      {reviewOrders.length > 0 && (
        <details open className="mb-8 bg-amber-50 border border-amber-200 rounded-2xl">
          <summary className="cursor-pointer list-none px-5 py-4 md:px-6 md:py-5 font-semibold text-amber-900 flex items-center justify-between">
            <span>Needs review ({reviewOrders.length})</span>
            <span className="text-xs text-amber-700">▾</span>
          </summary>
          <div className="px-5 pb-5 md:px-6 md:pb-6 grid grid-cols-1 md:grid-cols-2 gap-3">
            {reviewOrders.map((order) => (
              <div key={order.id} className="bg-white border border-amber-200 rounded-lg p-3 md:p-4">
                <p className="text-sm font-medium text-ink leading-tight">{reviewReasonLabel(order)}</p>
                <ReviewCard
                  retailerLine={`${order.retailer || "Unknown retailer"}${order.orderNumber ? ` #${order.orderNumber}` : ""}`}
                  note={reviewReason(order)}
                  userNote={order.userNote}
                  approveAction={approveOrderAction.bind(null, order.id)}
                  splitAction={splitOrderAction.bind(null, order.id)}
                />
              </div>
            ))}
          </div>
        </details>
      )}

      {allOrders.length === 0 && orphanedEmails.length === 0 ? (
        <p className="text-secondary">
          No emails yet.{" "}
          <Link href="/settings" className="underline">
            Forward your first order confirmation
          </Link>{" "}
          to get started.
        </p>
      ) : visibleOrders.length === 0 ? (
        <p className="text-secondary">No orders match your search and filters.</p>
      ) : (
        <div className="flex flex-col gap-4">
          {visibleOrders.map((order) => (
            <OrderCard key={order.id} order={order} now={now} />
          ))}
        </div>
      )}

      {orphanedEmails.length > 0 && (
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-ink mb-3">Unlinked emails</h2>
          <p className="text-sm text-secondary mb-4">
            Couldn&apos;t match these to a retailer + order number — review and clean up manually.
          </p>
          <ul className="flex flex-col gap-3">
            {orphanedEmails.map((email) => (
              <li key={email.id} className="bg-card border border-border rounded-xl flex items-stretch">
                <Link href={`/emails/${email.id}`} className="flex-1 block p-4 hover:bg-page min-w-0">
                  <div className="flex justify-between items-baseline gap-4">
                    <span className="font-medium text-ink truncate">Forwarded by you</span>
                    <span className="text-sm text-muted whitespace-nowrap">{email.receivedAt.toLocaleString()}</span>
                  </div>
                  <p className="font-semibold text-ink mt-1">{email.subject || "(no subject)"}</p>
                  <p className="text-secondary mt-1">{snippet(email.textBody)}</p>
                  {email.needsReview && (
                    <span className="inline-block mt-2 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                      Needs review
                    </span>
                  )}
                </Link>
                <form action={deleteEmail.bind(null, email.id)} className="flex items-center pr-3">
                  <DeleteButton label="Delete email" />
                </form>
              </li>
            ))}
          </ul>
        </div>
      )}
    </main>
  );
}
