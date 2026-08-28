import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { SearchFilterBar } from "@/app/SearchFilterBar";
import { daysUntil } from "@/lib/reminders";
import { OPEN_STATUSES, isClosingSoon } from "@/lib/alerts";
import { SummaryCard } from "@/app/SummaryCard";
import { OrderCard } from "@/app/OrderCard";
import { AmazonBundleCard } from "@/app/AmazonBundleCard";
import { NeedsReviewBucket } from "@/app/NeedsReviewBucket";
import { isAmazonOrder } from "@/lib/amazonBundle";
import { JUNK_FILTER } from "@/lib/junk";
import { orderReviewRow, emailReviewRow } from "@/lib/needsReviewRows";

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

  const [allOrders, orphanedEmails, reviewOrders] = await Promise.all([
    prisma.order.findMany({
      // includes archived orders so the "Archived" filter tab can show them;
      // soft-deleted orders are still excluded
      where: { userId, deletedAt: null },
      include: { _count: { select: { emails: true } } },
    }),
    // Lean select — CARD_SPEC.md Part 3's bucket row only needs retailer/
    // date/amount/orderNumber, not the encrypted body fields the old
    // "Unlinked emails" list used, so no decryptEmailContent() call is
    // needed here anymore. orderNumber (added 2026-08-21) feeds the
    // belongs-to-existing-order reason check in lib/needsReviewRows.ts.
    prisma.email.findMany({
      where: { orderId: null, userId, ...JUNK_FILTER },
      orderBy: { receivedAt: "desc" },
      select: { id: true, retailer: true, carrier: true, receivedAt: true, orderTotal: true, orderCurrency: true, orderNumber: true, emailType: true },
    }),
    prisma.order.findMany({
      where: { userId, needsReview: true, archivedAt: null, deletedAt: null },
      include: {
        // Trimmed 2026-08-21 to just what computeOrderReviewReason() reads
        // (lib/orderReview.ts) — the removed fields (subject/
        // extractionNotes/confidence/forwardType/anchorDate) only fed
        // reason branches that collapsed into the generic "uncertain
        // details" tail this session; nothing else in this file reads
        // reviewOrders.emails.
        emails: { select: { orderNumber: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  // Stats only count active (non-archived) orders — archived orders are hidden
  // from the dashboard until the user explicitly opens the Archived tab.
  const activeOrders = allOrders.filter((o) => o.archivedAt === null);

  // CARD_SPEC.md Part 3 — the "Link to order" manual picker's full list;
  // linking into an archived order isn't offered (same active-only scope
  // as the rest of the dashboard). Also doubles as the candidate-orders
  // list the belongs-to-existing-order/duplicate reason checks match
  // against (2026-08-21) — same population, same fields needed.
  const linkablePickerOrders = activeOrders.map((o) => ({
    id: o.id,
    retailer: o.retailer,
    orderNumber: o.orderNumber,
    orderDate: o.orderDate,
    orderTotal: o.orderTotal,
  }));

  // CARD_SPEC.md Part 3 — one unified needs-review bucket, replacing the
  // separate "Needs review" panel and "Unlinked emails" list below.
  const needsReviewRows = [
    ...reviewOrders.map((order) => orderReviewRow(order, linkablePickerOrders)),
    ...orphanedEmails.map((email) => emailReviewRow(email, linkablePickerOrders)),
  ];

  const openOrders = activeOrders.filter((o) => OPEN_STATUSES.includes(o.status));
  const closingSoonOrders = openOrders.filter((o) => isClosingSoon(o, now));
  const valueAtRisk = closingSoonOrders.reduce((sum, o) => sum + (o.orderTotal ?? 0), 0);

  // Active strict-Amazon orders fold into a single bundle card (below,
  // AMAZON_HANDLING.md v1) instead of rendering as individual cards.
  // Archived Amazon orders are unaffected — the bundle only covers active
  // orders, so they still render individually on the Archived tab.
  const amazonOrders = activeOrders.filter((o) => isAmazonOrder(o.retailer));

  // Search + status filter
  let visibleOrders = allOrders.filter((order) => {
    if (isAmazonOrder(order.retailer) && order.archivedAt === null) return false;
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

      <NeedsReviewBucket rows={needsReviewRows} linkablePickerOrders={linkablePickerOrders} />

      {amazonOrders.length > 0 && statusFilter !== "archived" && (
        <AmazonBundleCard orders={amazonOrders} now={now} />
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

    </main>
  );
}
