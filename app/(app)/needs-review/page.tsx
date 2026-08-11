import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { JUNK_FILTER } from "@/lib/junk";
import { orderReviewRow, emailReviewRow } from "@/lib/needsReviewRows";
import { NeedsReviewRow } from "@/app/NeedsReviewRow";

export const dynamic = "force-dynamic";

// CARD_SPEC.md Part 3 — the needs-review bucket's "View all N ->" page,
// reached from app/NeedsReviewBucket.tsx once its inline limit overflows.
// Same row data/actions as the bucket, just unlimited and always expanded.
export default async function NeedsReviewPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const userId = session.user.id;

  const [reviewOrders, orphanedEmails, linkablePickerOrders] = await Promise.all([
    prisma.order.findMany({
      where: { userId, needsReview: true, archivedAt: null, deletedAt: null },
      include: {
        emails: {
          select: { subject: true, extractionNotes: true, orderNumber: true, confidence: true, receivedAt: true, forwardType: true, anchorDate: true },
          orderBy: { receivedAt: "desc" },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.email.findMany({
      where: { orderId: null, userId, ...JUNK_FILTER },
      orderBy: { receivedAt: "desc" },
      select: { id: true, retailer: true, receivedAt: true, orderTotal: true, orderCurrency: true },
    }),
    prisma.order.findMany({
      where: { userId, archivedAt: null, deletedAt: null },
      select: { id: true, retailer: true, orderNumber: true, orderDate: true },
      orderBy: { orderDate: "desc" },
    }),
  ]);

  const rows = [...reviewOrders.map(orderReviewRow), ...orphanedEmails.map(emailReviewRow)];

  return (
    <main className="flex-1 min-w-0 px-5 pt-4 pb-20 md:pb-8 md:pl-12 md:pr-8 md:pt-12 max-w-[860px]">
      <header className="mb-[22px]">
        <h1 className="font-serif text-[30px] md:text-[38px] leading-[1.08] font-medium text-ink">Needs review</h1>
        <p className="text-sm text-muted mt-1">Everything flagged for a quick check, in one place.</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-secondary">
          Nothing needs review right now.{" "}
          <Link href="/" className="underline">
            Back to dashboard
          </Link>
        </p>
      ) : (
        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-[18px] flex flex-col gap-3">
          {rows.map((row) => (
            <NeedsReviewRow key={`${row.kind}-${row.id}`} row={row} expanded linkablePickerOrders={linkablePickerOrders} />
          ))}
        </div>
      )}
    </main>
  );
}
