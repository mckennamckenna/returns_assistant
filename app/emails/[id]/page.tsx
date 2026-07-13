import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { reExtract } from "./actions";
import { ReExtractButton } from "./ReExtractButton";
import { decryptEmailContent } from "@/lib/emailEncryption";

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

export default async function EmailDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const emailRaw = await prisma.email.findUnique({ where: { id, userId: session.user.id } });

  if (!emailRaw) {
    notFound();
  }

  const email = decryptEmailContent(emailRaw);

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto w-full">
      <div className="flex justify-between items-baseline">
        <Link href="/" className="text-sm text-secondary hover:underline">
          &larr; Back to dashboard
        </Link>
        {email.orderId && (
          <Link href={`/orders/${email.orderId}`} className="text-sm text-secondary hover:underline">
            View Order &rarr;
          </Link>
        )}
      </div>

      <h1 className="text-2xl font-semibold mt-4">{email.subject || "(no subject)"}</h1>
      <div className="flex justify-between items-baseline gap-4 mt-1 text-sm text-secondary">
        <span className="truncate">Forwarded by you</span>
        <span className="whitespace-nowrap">{email.receivedAt.toLocaleString()}</span>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border border-border rounded-lg p-4">
          <div className="flex justify-between items-center mb-3">
            <h2 className="font-semibold">Extracted data</h2>
            <form action={reExtract.bind(null, email.id)}>
              <ReExtractButton />
            </form>
          </div>

          {email.needsReview && (
            <span className="inline-block mb-3 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
              Needs Review
            </span>
          )}

          <dl className="grid grid-cols-2 gap-3">
            <Field label="Email type" value={email.emailType} />
            <Field label="Confidence" value={email.confidence} />
            <Field label="Retailer" value={email.retailer} />
            <Field label="Order number" value={email.orderNumber} />
            <Field label="Order date" value={formatDate(email.orderDate)} />
            <Field label="Delivery date" value={formatDate(email.deliveryDate)} />
            <Field label="Return window" value={email.returnWindowDays ? `${email.returnWindowDays} days` : "—"} />
            <Field
              label="Return deadline"
              value={
                email.returnDeadline
                  ? `${formatDate(email.returnDeadline)}${email.deadlineIsEstimated ? " (estimated)" : ""}`
                  : "—"
              }
            />
            <Field
              label="Policy source"
              value={email.policySource === "web_lookup" ? "Web lookup" : email.policySource === "email" ? "Email" : "—"}
            />
            <Field label="Order total" value={formatCurrency(email.orderTotal, email.orderCurrency)} />
          </dl>

          {isLineItemArray(email.lineItems) && email.lineItems.length > 0 && (
            <div className="mt-3">
              <dt className="text-xs uppercase tracking-wide text-muted">Line items</dt>
              <ul className="text-sm text-ink mt-0.5">
                {email.lineItems.map((item, i) => (
                  <li key={i} className="flex justify-between gap-2">
                    <span className="truncate">
                      {item.name}
                      {item.quantity != null && item.quantity > 1 ? ` ×${item.quantity}` : ""}
                    </span>
                    <span className="text-secondary whitespace-nowrap">
                      {item.price != null ? formatCurrency(item.price, email.orderCurrency) : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3">
            <Field label="Extraction notes" value={email.extractionNotes} />
          </div>

          <p className="text-xs text-muted mt-3">
            {email.extractedAt ? `Extracted ${email.extractedAt.toLocaleString()}` : "Not yet extracted"}
          </p>
        </div>

        <div>
          {email.htmlBody ? (
            <iframe
              srcDoc={email.htmlBody}
              sandbox=""
              className="w-full h-[70vh] border border-border rounded-lg"
            />
          ) : (
            <p className="whitespace-pre-wrap text-ink border border-border rounded-lg p-4 h-[70vh] overflow-auto">
              {email.textBody || "(no body)"}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
