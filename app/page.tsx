import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function snippet(text: string | null, length = 200): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

function formatDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatCurrency(total: number | null, currency: string | null): string {
  if (total == null) return "";
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "USD" }).format(total);
  } catch {
    return `${currency ?? "$"}${total}`;
  }
}

// Highest-value orders with a return window closing soon should surface
// first; everything else stays newest-first.
const CLOSE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function isClosingSoon(returnDeadline: Date | null): boolean {
  if (!returnDeadline) return false;
  const msUntilDeadline = returnDeadline.getTime() - Date.now();
  return msUntilDeadline >= 0 && msUntilDeadline <= CLOSE_WINDOW_MS;
}

export default async function Home() {
  const emails = await prisma.email.findMany({
    orderBy: { receivedAt: "desc" },
  });

  const closingSoon = emails
    .filter((e) => isClosingSoon(e.returnDeadline))
    .sort((a, b) => (b.orderTotal ?? 0) - (a.orderTotal ?? 0));
  const rest = emails.filter((e) => !isClosingSoon(e.returnDeadline));
  const sortedEmails = [...closingSoon, ...rest];

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-semibold mb-6">Returns Assistant</h1>

      {emails.length === 0 ? (
        <p className="text-zinc-500">No emails yet. Forward one to see it here.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {sortedEmails.map((email) => (
            <li key={email.id} className="border border-zinc-200 rounded-lg">
              <Link href={`/emails/${email.id}`} className="block p-4 hover:bg-zinc-50">
                <div className="flex justify-between items-baseline gap-4">
                  <span className="font-medium truncate">
                    {email.fromName ? `${email.fromName} <${email.fromEmail}>` : email.fromEmail}
                  </span>
                  <span className="text-sm text-zinc-500 whitespace-nowrap">
                    {email.receivedAt.toLocaleString()}
                  </span>
                </div>
                <p className="font-semibold mt-1">{email.subject || "(no subject)"}</p>
                <p className="text-zinc-600 mt-1">{snippet(email.textBody)}</p>

                {(email.retailer || email.orderNumber || email.returnDeadline || email.confidence) && (
                  <div className="flex items-center gap-2 mt-2 text-sm text-zinc-500 flex-wrap">
                    {email.retailer && <span className="font-medium text-zinc-700">{email.retailer}</span>}
                    {email.orderNumber && <span>#{email.orderNumber}</span>}
                    {email.returnDeadline && (
                      <span>
                        {email.orderTotal != null && (
                          <span className="font-semibold text-zinc-800">
                            {formatCurrency(email.orderTotal, email.orderCurrency)}{" "}
                          </span>
                        )}
                        Return by {formatDate(email.returnDeadline)}
                        {email.deadlineIsEstimated ? " (estimated)" : ""}
                      </span>
                    )}
                    {email.confidence && <span className="text-zinc-400">{email.confidence} confidence</span>}
                  </div>
                )}

                {email.needsReview && (
                  <span className="inline-block mt-2 text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                    Needs Review
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
