import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

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
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
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

      <div className="mt-6">
        {email.htmlBody ? (
          <iframe
            srcDoc={email.htmlBody}
            sandbox=""
            className="w-full h-[70vh] border border-zinc-200 rounded-lg"
          />
        ) : (
          <p className="whitespace-pre-wrap text-zinc-800">
            {email.textBody || "(no body)"}
          </p>
        )}
      </div>
    </main>
  );
}
