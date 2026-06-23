import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { reExtract } from "./actions";
import { ReExtractButton } from "./ReExtractButton";

export const dynamic = "force-dynamic";

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-zinc-400">{label}</dt>
      <dd className="text-sm text-zinc-800 mt-0.5">{value ?? "—"}</dd>
    </div>
  );
}

export default async function EmailDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const email = await prisma.email.findUnique({ where: { id } });

  if (!email) {
    notFound();
  }

  return (
    <main className="min-h-screen p-8 max-w-5xl mx-auto w-full">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to dashboard
      </Link>

      <h1 className="text-2xl font-semibold mt-4">{email.subject || "(no subject)"}</h1>
      <div className="flex justify-between items-baseline gap-4 mt-1 text-sm text-zinc-500">
        <span className="truncate">
          {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
        </span>
        <span className="whitespace-nowrap">{email.receivedAt.toLocaleString()}</span>
      </div>

      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="border border-zinc-200 rounded-lg p-4">
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
          </dl>

          <div className="mt-3">
            <Field label="Extraction notes" value={email.extractionNotes} />
          </div>

          <p className="text-xs text-zinc-400 mt-3">
            {email.extractedAt ? `Extracted ${email.extractedAt.toLocaleString()}` : "Not yet extracted"}
          </p>
        </div>

        <div>
          {email.htmlBody ? (
            <iframe
              srcDoc={email.htmlBody}
              sandbox=""
              className="w-full h-[70vh] border border-zinc-200 rounded-lg"
            />
          ) : (
            <p className="whitespace-pre-wrap text-zinc-800 border border-zinc-200 rounded-lg p-4 h-[70vh] overflow-auto">
              {email.textBody || "(no body)"}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
