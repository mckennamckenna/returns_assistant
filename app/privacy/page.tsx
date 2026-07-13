import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen p-8 max-w-2xl mx-auto w-full">
      <Link href="/" className="text-sm text-secondary hover:underline">
        &larr; Back to dashboard
      </Link>

      <h1 className="text-2xl font-semibold mt-4 mb-6">Privacy</h1>

      <ul className="flex flex-col gap-4 text-ink">
        <li>
          <strong>What we store:</strong> only the shopping emails you forward to us — sender, subject, date, body
          text, and whatever order details (retailer, order number, dates, totals) we can read from them. The
          sender and message content are encrypted at rest — even we can&apos;t read the raw email content without
          the decryption key.
        </li>
        <li>
          <strong>What we don&apos;t store:</strong> emails that aren&apos;t clearly about a purchase. A fast check
          runs before anything is saved — pharmacy, medical, financial, personal, or other non-commerce mail is
          discarded immediately and never written to our database.
        </li>
        <li>
          <strong>We never sell your data.</strong> Not to advertisers, not to data brokers, not to anyone — for any
          reason.
        </li>
        <li>
          <strong>We never train AI models on your email content.</strong> The AI calls we make read one email to
          answer specific questions about it (retailer, order number, return deadline) — nothing more, and nothing
          is used to train or improve any model.
        </li>
        <li>
          <strong>You can delete everything, anytime.</strong> Go to{" "}
          <Link href="/settings" className="underline">
            Settings
          </Link>{" "}
          and confirm — it permanently erases every email, order, and reminder we have, with no undo.
        </li>
      </ul>
    </main>
  );
}
