import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { getInboundAddress } from "@/lib/inboundAddress";
import { DeleteAllDataForm } from "./DeleteAllDataForm";
import { CopyButton } from "./CopyButton";
import { GmailVerificationCode } from "./GmailVerificationCode";

export default async function SettingsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user) redirect("/login");

  const inboundAddress = getInboundAddress(user.inboundToken);
  // Alpha-only hardcoded filter. Excludes known pharmacy/medical senders
  // from a keyword-based commerce net. Deliberately not user-configurable —
  // OAuth intake replaces this filter workflow entirely at scale.
  // Do not extend into user-specific exclusions; that path is not the plan.
  const GMAIL_COMMERCE_QUERY =
    '-from:(informeddelivery.usps.com OR redrockrx.com OR express-scripts.com OR caremark.com OR optumrx.com OR costplusdrugs.com OR capsule.com OR alto.com OR hims.com OR forhims.com OR hers.com OR forhers.com OR ro.co OR curology.com OR nurx.com OR hellowisp.com OR cerebral.com OR plushcare.com OR keeps.com OR bluechew.com OR redboxrx.com OR pharmacy.amazon.com OR goodrx.com OR honeybeehealth.com OR blinkhealth.com OR nowrx.com OR getcove.com OR lemonaidhealth.com OR apostrophe.com) ("tracking number" OR "your order has shipped" OR "your order is on the way" OR "your order is on its way" OR "out for delivery" OR "track your order" OR "track your shipment" OR "shipping confirmation" OR "estimated delivery" OR "return label" OR "your refund" OR "we\'ve received your return" OR "received your return" OR "your return has arrived" OR "order details")';
  const gmailSearchUrl = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(GMAIL_COMMERCE_QUERY).replace(/\(/g, "%28").replace(/\)/g, "%29")}`;

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
        <div className="flex items-center gap-2 mb-3">
          <code className="flex-1 bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-700 break-all">
            {inboundAddress}
          </code>
          <CopyButton text={inboundAddress} />
        </div>
        <a
          href={gmailSearchUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-sm font-medium text-stone-700 border border-stone-300 rounded-lg px-3 py-1.5 hover:bg-stone-50"
        >
          Open Gmail with this address ready to filter
        </a>
        <p className="text-xs text-stone-400 mt-2">
          Opens Gmail with your address ready to filter. From there: click the search bar&apos;s filter icon, choose
          &quot;Create filter&quot;, then check &quot;Forward it to&quot; and paste your Return Window address.
        </p>
      </div>

      <GmailVerificationCode initialCode={user.gmailVerificationCode} />

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
