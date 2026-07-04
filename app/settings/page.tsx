import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getInboundAddress } from "@/lib/inboundAddress";
import { DeleteAllDataForm } from "./DeleteAllDataForm";
import { CopyButton } from "./CopyButton";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");

  const inboundAddress = getInboundAddress(user.inboundToken);

  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <Link href="/" className="text-sm text-zinc-500 hover:underline">
        &larr; Back to dashboard
      </Link>

      <h1 className="text-2xl font-semibold mt-4 mb-6">Settings</h1>

      <div className="border border-stone-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold text-stone-800 mb-2">Your forwarding address</h2>
        <p className="text-sm text-stone-500 mb-3">
          Forward your order confirmations, shipping updates, and return emails to this address. Only you can use it.
        </p>
        <div className="flex items-center gap-2">
          <code className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 break-all">
            {inboundAddress}
          </code>
          <CopyButton text={inboundAddress} />
        </div>
      </div>

      <div className="border border-stone-200 rounded-lg p-4 mb-6">
        <h2 className="font-semibold text-stone-800 mb-2">Archived orders</h2>
        <p className="text-sm text-stone-500 mb-3">
          Orders you&apos;ve archived are hidden from the dashboard and stop sending reminders.
        </p>
        <Link href="/?status=archived" className="text-sm text-stone-700 underline">
          View archived orders
        </Link>
      </div>

      <div className="border border-red-200 rounded-lg p-4">
        <h2 className="font-semibold text-red-700 mb-2">Delete all my data</h2>
        <DeleteAllDataForm />
      </div>
    </main>
  );
}
