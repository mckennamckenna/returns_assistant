import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { deleteEmail, approveOrderAction, splitOrderAction, markReturnRequestedAction, markReturnedAction, markKeptAction } from "./actions";
import { DeleteButton } from "./DeleteButton";
import { SoftDeleteOrderButton } from "./SoftDeleteOrderButton";
import { ArchiveOrderButton } from "./ArchiveOrderButton";
import { MarkRefundedButton } from "./MarkRefundedButton";
import { DisplayStatusBadge } from "./DisplayStatusBadge";
import { DISPLAY_STATUS_RANK, KEPT_WARNING_CAPTION } from "@/lib/displayStatus";
import { ReviewCard } from "./ReviewCard";
import { SearchFilterBar } from "./SearchFilterBar";
import { reviewReason, reviewReasonLabel } from "@/lib/orderReview";
import { decryptEmailContent } from "@/lib/emailEncryption";
import { daysUntil } from "@/lib/reminders";
import { activeOrderFilter } from "@/lib/orderFilters";
import { Sidebar } from "./Sidebar";
import { BottomNav } from "./BottomNav";
import { StatCard } from "./StatCard";
import { RetailerAvatar } from "./RetailerAvatar";
import { DaysLeftChip } from "./DaysLeftChip";

export const dynamic = "force-dynamic";

// Statuses where starting a return is still a meaningful, available action.
// Once a return has been started, refunded, completed, or the window has
// passed, the order is no longer "open" in this sense.
const OPEN_STATUSES = ["ordered", "shipped", "delivered", "returnable", "needs_review"];
const CLOSING_SOON_DAYS = 7;
const HIGH_VALUE_THRESHOLD = 150;

type SortField = "retailer" | "total" | "purchaseDate" | "deliveryDate" | "returnDate" | "daysLeft";

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
      where: { userId, needsReview: true, ...activeOrderFilter },
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

  const isClosingSoon = (order: (typeof allOrders)[number]) =>
    order.returnDeadline != null && daysUntil(order.returnDeadline, now) >= 0 && daysUntil(order.returnDeadline, now) <= CLOSING_SOON_DAYS;

  const openOrders = activeOrders.filter((o) => OPEN_STATUSES.includes(o.status));
  const openValue = openOrders.reduce((sum, o) => sum + (o.orderTotal ?? 0), 0);
  const closingSoonOrders = openOrders.filter(isClosingSoon);
  const valueAtRisk = closingSoonOrders.reduce((sum, o) => sum + (o.orderTotal ?? 0), 0);
  const alertCount = openOrders.filter((o) => o.needsReview || isClosingSoon(o)).length;

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
    if (statusFilter === "closing_soon") return isClosingSoon(order);
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

  function sortLink(field: SortField): string {
    const next = new URLSearchParams();
    if (q) next.set("q", params.q ?? "");
    if (statusFilter !== "all") next.set("status", statusFilter);
    next.set("sort", field);
    next.set("dir", sortField === field && sortDir === "asc" ? "desc" : "asc");
    return `/?${next.toString()}`;
  }

  function SortHeader({ field, children }: { field: SortField; children: React.ReactNode }) {
    const active = sortField === field;
    return (
      <th className="text-left text-xs font-medium text-muted uppercase tracking-wide pb-3 pr-4">
        <Link href={sortLink(field)} className={`hover:text-ink ${active ? "text-ink" : ""}`}>
          {children}
          {active ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </Link>
      </th>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar alertCount={alertCount} accountLabel={session.user.email ?? "Your account"} />
      <BottomNav alertCount={alertCount} />

      <main className="flex-1 p-4 pb-20 md:p-8 max-w-6xl">
        <header className="mb-6">
          <h1 className="font-serif text-[30px] leading-[1.08] font-medium text-ink">{getGreeting()}</h1>
          <p className="text-sm text-muted mt-1">Here&apos;s what&apos;s happening with your returns.</p>
        </header>

        <SearchFilterBar initialQuery={params.q ?? ""} initialStatus={statusFilter} />

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <StatCard
            label="Open returns"
            value={String(openOrders.length)}
            sublabel={`${formatCurrency(openValue, "USD")} total value`}
            accent="rose"
          />
          <StatCard
            label="Closing soon"
            value={String(closingSoonOrders.length)}
            sublabel={`within ${CLOSING_SOON_DAYS} days`}
            accent="amber"
          />
          <StatCard
            label="Total value at risk"
            value={formatCurrency(valueAtRisk, "USD")}
            sublabel="closing soon, not yet returned"
            accent="sage"
          />
        </div>

        {reviewOrders.length > 0 && (
          <details open className="mb-8 bg-amber-50 border border-amber-200 rounded-xl">
            <summary className="cursor-pointer list-none px-5 py-4 font-semibold text-amber-900 flex items-center justify-between">
              <span>Needs review ({reviewOrders.length})</span>
              <span className="text-xs text-amber-700">▾</span>
            </summary>
            <div className="px-5 pb-5 flex flex-col gap-3">
              {reviewOrders.map((order) => (
                <div key={order.id} className="bg-white border border-amber-200 rounded-lg p-2.5">
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
          <>
          <div className="md:hidden flex flex-col gap-3">
            {visibleOrders.map((order) => {
              const isHighValue = (order.orderTotal ?? 0) >= HIGH_VALUE_THRESHOLD;
              return (
                <div key={order.id} className={`bg-card border border-border rounded-xl p-4 ${isHighValue ? "bg-rose-50/40" : ""}`}>
                  <div className="flex items-center gap-3">
                    <Link href={`/orders/${order.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <RetailerAvatar name={order.retailer || "?"} />
                      <div className="min-w-0">
                        <div className="text-lg font-medium text-ink truncate">{order.retailer || "Unknown retailer"}</div>
                        {order.orderNumber && <div className="text-xs text-muted truncate">#{order.orderNumber}</div>}
                        <div className="mt-0.5"><DisplayStatusBadge status={order.displayStatus} /></div>
                      </div>
                    </Link>
                    <DaysLeftChip returnDeadline={order.returnDeadline} isEstimated={order.deadlineIsEstimated} />
                  </div>
                  <div className="flex items-baseline justify-between mt-3">
                    <span className="font-serif text-[27px] font-semibold text-ink">
                      {formatCurrency(order.orderTotal, order.orderCurrency)}
                    </span>
                    <span className="text-[13px] text-muted whitespace-nowrap">
                      Return by {formatDate(order.returnDeadline)}
                      {order.deadlineIsEstimated ? " (est.)" : ""}
                    </span>
                  </div>
                  {order.orderTotal == null && (
                    <p className="text-xs text-muted mt-1">Forward your order confirmation to add the total</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    {order.trackingNumber && order.trackingUrl && (
                      <a
                        href={order.trackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Track package →
                      </a>
                    )}
                    {order.returnTrackingNumber && order.returnTrackingUrl && (
                      <a
                        href={order.returnTrackingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Track your return →
                      </a>
                    )}
                    {order.returnPortalUrl && (
                      <a
                        href={order.returnPortalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline"
                      >
                        Start return →
                      </a>
                    )}
                    {(DISPLAY_STATUS_RANK[order.displayStatus] ?? 0) < DISPLAY_STATUS_RANK.return_requested && (
                      <form action={markReturnRequestedAction.bind(null, order.id)}>
                        <button type="submit" className="text-xs font-medium text-secondary hover:text-ink hover:underline">
                          I&apos;m returning this
                        </button>
                      </form>
                    )}
                    {(DISPLAY_STATUS_RANK[order.displayStatus] ?? 0) < DISPLAY_STATUS_RANK.returned &&
                      (order.returnDeadline == null || daysUntil(order.returnDeadline, now) >= 0) && (
                        <form action={markKeptAction.bind(null, order.id)} className="flex flex-col items-start gap-0.5">
                          <button type="submit" className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline">
                            I&apos;m keeping this
                          </button>
                          <span className="text-[10px] text-muted">{KEPT_WARNING_CAPTION}</span>
                        </form>
                      )}
                    {order.displayStatus === "return_requested" && (
                      <form action={markReturnedAction.bind(null, order.id)}>
                        <button type="submit" className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline">
                          Mark as returned
                        </button>
                      </form>
                    )}
                    {order.displayStatus === "returned" && (
                      <MarkRefundedButton
                        orderId={order.id}
                        className="text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:underline"
                      />
                    )}
                    <div className="ml-auto flex items-center gap-1">
                      <ArchiveOrderButton
                        orderId={order.id}
                        isArchived={order.archivedAt !== null}
                        className="text-xs font-medium text-secondary hover:text-ink"
                      />
                      <SoftDeleteOrderButton orderId={order.id} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="hidden md:block bg-card border border-border rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide pb-3 pr-4 pl-5 pt-4">
                    Retailer
                  </th>
                  <th className="text-left text-xs font-medium text-muted uppercase tracking-wide pb-3 pr-4 pt-4">
                    Status
                  </th>
                  <SortHeader field="total">Total price</SortHeader>
                  <SortHeader field="purchaseDate">Purchase date</SortHeader>
                  <SortHeader field="deliveryDate">Delivery date</SortHeader>
                  <SortHeader field="returnDate">Return date</SortHeader>
                  <SortHeader field="daysLeft">Days left</SortHeader>
                  <th className="pb-3 pr-4"></th>
                </tr>
              </thead>
              <tbody>
                {visibleOrders.map((order) => {
                  const isHighValue = (order.orderTotal ?? 0) >= HIGH_VALUE_THRESHOLD;
                  return (
                    <tr key={order.id} className={`border-b border-border last:border-0 ${isHighValue ? "bg-rose-50/40" : ""}`}>
                      <td className="py-3 pr-4 pl-5">
                        <Link href={`/orders/${order.id}`} className="flex items-center gap-3 group">
                          <RetailerAvatar name={order.retailer || "?"} />
                          <div className="min-w-0">
                            <div className="text-lg font-medium text-ink group-hover:underline truncate">
                              {order.retailer || "Unknown retailer"}
                            </div>
                            {order.orderNumber && <div className="text-xs text-muted truncate">#{order.orderNumber}</div>}
                          </div>
                        </Link>
                        {order.orderTotal == null && (
                          <p className="text-xs text-muted mt-1">Forward your order confirmation to add the total</p>
                        )}
                        {order.trackingNumber && order.trackingUrl && (
                          <a
                            href={order.trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            Track package →
                          </a>
                        )}
                        {order.returnTrackingNumber && order.returnTrackingUrl && (
                          <a
                            href={order.returnTrackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-1 text-xs font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            Track your return →
                          </a>
                        )}
                        {order.returnPortalUrl && (
                          <a
                            href={order.returnPortalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="block mt-1 text-xs font-medium text-rose-600 hover:text-rose-800 hover:underline"
                          >
                            Start return →
                          </a>
                        )}
                      </td>
                      <td className="py-3 pr-4">
                        <DisplayStatusBadge status={order.displayStatus} />
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap font-serif font-semibold text-ink">
                        {formatCurrency(order.orderTotal, order.orderCurrency)}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-secondary">
                        {formatDate(order.orderDate)}
                        {order.orderDateEstimated ? <span className="text-muted"> (est.)</span> : ""}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-secondary">
                        {(() => {
                          const best = order.deliveredAt ?? order.estimatedDeliveryDate ?? order.deliveryDate;
                          if (!best) return "—";
                          return (
                            <>
                              {formatDate(best)}
                              {!order.deliveredAt && (order.estimatedDeliveryDate || order.deliveryDate) && (
                                <span className="text-muted"> (est.)</span>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap text-secondary">
                        {formatDate(order.returnDeadline)}
                        {order.deadlineIsEstimated ? <span className="text-muted"> (est.)</span> : ""}
                      </td>
                      <td className="py-3 pr-4 whitespace-nowrap">
                        <DaysLeftChip returnDeadline={order.returnDeadline} isEstimated={order.deadlineIsEstimated} />
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          {order.displayStatus === "returned" && (
                            <MarkRefundedButton
                              orderId={order.id}
                              className="text-xs font-medium text-emerald-700 hover:text-emerald-900 hover:underline whitespace-nowrap"
                            />
                          )}
                          {(DISPLAY_STATUS_RANK[order.displayStatus] ?? 0) < DISPLAY_STATUS_RANK.returned &&
                            (order.returnDeadline == null || daysUntil(order.returnDeadline, now) >= 0) && (
                              <form action={markKeptAction.bind(null, order.id)} className="flex flex-col items-end gap-0.5">
                                <button type="submit" className="text-xs font-medium text-slate-600 hover:text-slate-900 hover:underline whitespace-nowrap">
                                  I&apos;m keeping this
                                </button>
                                <span className="text-[10px] text-muted whitespace-nowrap">{KEPT_WARNING_CAPTION}</span>
                              </form>
                            )}
                          <ArchiveOrderButton
                            orderId={order.id}
                            isArchived={order.archivedAt !== null}
                            className="text-xs font-medium text-secondary hover:text-ink"
                          />
                          <SoftDeleteOrderButton orderId={order.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
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
    </div>
  );
}
