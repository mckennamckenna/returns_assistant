import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { resolveInboundTokenFromAddress } from "@/lib/inboundAddress";

export const dynamic = "force-dynamic";

function formatDateTime(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (value instanceof Date) return formatDateTime(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-800 mt-0.5 break-words">{value ?? "—"}</dd>
    </div>
  );
}

// Full Order row, field by field — no dollar-amount or PII restriction on
// this page (unlike the list/user-detail views above it), since reaching
// this page is itself the deliberate "yes, I need to see this" click.
const ORDER_FIELD_LABELS: [string, string][] = [
  ["id", "ID"],
  ["retailer", "Retailer"],
  ["orderNumber", "Order number"],
  ["orderDate", "Order date"],
  ["orderDateEstimated", "Order date estimated"],
  ["deliveryDate", "Delivery date (legacy)"],
  ["estimatedDeliveryDate", "Estimated delivery date"],
  ["deliveredAt", "Delivered at"],
  ["returnDeadline", "Return deadline"],
  ["deadlineIsEstimated", "Deadline estimated"],
  ["policySource", "Policy source"],
  ["returnWindowDays", "Return window (days)"],
  ["returnWindowStartsFrom", "Return window starts from"],
  ["orderTotal", "Order total"],
  ["orderCurrency", "Order currency"],
  ["returnPortalUrl", "Return portal URL"],
  ["status", "Internal status"],
  ["needsReview", "Needs review"],
  ["displayStatus", "Display status"],
  ["carrier", "Carrier"],
  ["trackingNumber", "Tracking number"],
  ["trackingUrl", "Tracking URL"],
  ["returnCarrier", "Return carrier"],
  ["returnTrackingNumber", "Return tracking number"],
  ["returnTrackingUrl", "Return tracking URL"],
  ["returnedAt", "Returned at"],
  ["archivedAt", "Archived at"],
  ["deletedAt", "Deleted at"],
  ["userNote", "User note"],
  ["createdAt", "Created at"],
  ["updatedAt", "Updated at"],
];

const EMAIL_EXTRACTION_FIELD_LABELS: [string, string][] = [
  ["retailer", "Retailer"],
  ["orderNumber", "Order number"],
  ["orderDate", "Order date"],
  ["estimatedDeliveryDate", "Estimated delivery date"],
  ["deliveredAt", "Delivered at"],
  ["deliveryDate", "Delivery date (legacy)"],
  ["returnWindowDays", "Return window (days)"],
  ["returnWindowStartsFrom", "Return window starts from"],
  ["returnDeadline", "Return deadline"],
  ["policySource", "Policy source"],
  ["confidence", "Confidence"],
  ["refundAmount", "Refund amount"],
  ["refundAmountConfidence", "Refund amount confidence"],
];

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ forwardingAddress: string; orderId: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.email !== process.env.ADMIN_USER_EMAIL) {
    notFound();
  }

  const { forwardingAddress, orderId } = await params;
  const inboundToken = resolveInboundTokenFromAddress(decodeURIComponent(forwardingAddress));
  const user = inboundToken ? await prisma.user.findUnique({ where: { inboundToken } }) : null;
  if (!user) notFound();

  // Scoped by userId, not just id — matches app/orders/[id]/page.tsx's
  // existing convention: a mismatched owner 404s exactly like a
  // nonexistent order, rather than letting an orderId be viewed against
  // any forwardingAddress in the URL.
  const order = await prisma.order.findUnique({ where: { id: orderId, userId: user.id } });
  if (!order) notFound();

  // Deliberately never selects textBody, htmlBody, fromEmail, fromName, or
  // rawJson — those are AES-256-GCM encrypted at rest (BUILD.md privacy
  // invariant #3), and rendering them here means plaintext hits server
  // logs. A "reveal email content" affordance is out of scope for this
  // page, not just unbuilt — not stubbed, not planned here.
  const emails = await prisma.email.findMany({
    where: { orderId: order.id },
    orderBy: { receivedAt: "desc" },
    select: {
      id: true,
      emailType: true,
      receivedAt: true,
      subject: true,
      retailer: true,
      orderNumber: true,
      orderDate: true,
      deliveryDate: true,
      estimatedDeliveryDate: true,
      deliveredAt: true,
      returnWindowDays: true,
      returnWindowStartsFrom: true,
      returnDeadline: true,
      policySource: true,
      confidence: true,
      refundAmount: true,
      refundAmountConfidence: true,
      extractionRaw: true,
      extractionNotes: true,
    },
  });

  const orderRecord = order as unknown as Record<string, unknown>;

  return (
    <main className="min-h-screen p-8 max-w-3xl mx-auto w-full">
      <Link href={`/admin/users/${encodeURIComponent(forwardingAddress)}`} className="text-sm text-zinc-500 hover:underline">
        &larr; Back to user
      </Link>

      <h1 className="text-2xl font-semibold mt-4 mb-6">{order.retailer || "Unknown retailer"}</h1>

      <div className="border border-zinc-200 rounded-lg p-4 mb-8">
        <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">Order</h2>
        <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {ORDER_FIELD_LABELS.map(([key, label]) => (
            <Field key={key} label={label} value={formatValue(orderRecord[key])} />
          ))}
        </dl>
      </div>

      <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide mb-3">
        Linked emails ({emails.length})
      </h2>
      <div className="flex flex-col gap-4">
        {emails.map((email) => {
          const emailRecord = email as unknown as Record<string, unknown>;
          return (
            <div key={email.id} className="border border-zinc-200 rounded-lg p-4">
              <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
                <span className="font-medium text-zinc-800">{email.emailType || "(unclassified)"}</span>
                <span className="text-xs text-zinc-400">{formatDateTime(email.receivedAt)}</span>
              </div>
              <p className="text-sm text-zinc-700 mb-3">{email.subject || "(no subject)"}</p>

              <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-3">
                {EMAIL_EXTRACTION_FIELD_LABELS.map(([key, label]) => (
                  <Field key={key} label={label} value={formatValue(emailRecord[key])} />
                ))}
              </dl>

              {email.extractionNotes && (
                <div className="mb-3">
                  <dt className="text-xs uppercase tracking-wide text-zinc-400">Extraction notes</dt>
                  <dd className="text-sm text-zinc-700 mt-0.5">{email.extractionNotes}</dd>
                </div>
              )}

              {email.extractionRaw != null && (
                <div>
                  <dt className="text-xs uppercase tracking-wide text-zinc-400 mb-1">Extraction raw</dt>
                  <pre className="text-xs bg-zinc-50 border border-zinc-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-words">
                    {JSON.stringify(email.extractionRaw, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </main>
  );
}
