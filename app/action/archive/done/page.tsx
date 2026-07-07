export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

// Purely a display concern — reads the outcome the POST endpoint already
// decided (app/api/action/archive/route.ts), no DB access, no
// re-verification. Deliberate tradeoff, accepted: this outcome param isn't
// signed, so a user could load /action/archive/done?outcome=success
// directly and see the success copy without having archived anything.
// Not a security issue (no state changes happen from viewing this page),
// just a mildly confusing edge case if someone constructs the URL by hand.
// Signing the outcome, or reading it back from ActionLog, would be
// over-engineering for a page that only ever displays text.
const COPY: Record<string, { title: string; body: string }> = {
  success: { title: "Archived", body: "No more reminders for this order." },
  expired: { title: "This link expired", body: "Open the app to take action." },
  already_used: { title: "Already done", body: "This action was already completed." },
  invalid: { title: "This link is invalid", body: "Contact support." },
  order_state_changed: { title: "No longer available", body: "This order is no longer available." },
};

export default async function ArchiveDonePage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { outcome } = await searchParams;
  const copy = (outcome && COPY[outcome]) || COPY.invalid;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-stone-800">Return Window</span>
        <h1 className="text-lg font-medium text-stone-800 mt-6">{copy.title}</h1>
        <p className="text-stone-500 text-sm mt-2">{copy.body}</p>
        <a
          href={APP_URL}
          className="inline-block mt-6 text-sm font-medium text-stone-800 underline hover:text-stone-600"
        >
          Go to your dashboard
        </a>
      </div>
    </main>
  );
}
