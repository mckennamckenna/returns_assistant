import Link from "next/link";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

function snippet(text: string | null, length = 200): string {
  if (!text) return "";
  const trimmed = text.trim();
  return trimmed.length > length ? `${trimmed.slice(0, length)}…` : trimmed;
}

export default async function Home() {
  const emails = await prisma.email.findMany({
    orderBy: { receivedAt: "desc" },
  });

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <h1 className="text-3xl font-semibold mb-6">Returns Assistant</h1>

      {emails.length === 0 ? (
        <p className="text-zinc-500">No emails yet. Forward one to see it here.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {emails.map((email) => (
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
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
