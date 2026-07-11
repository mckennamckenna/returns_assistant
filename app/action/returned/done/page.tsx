export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

// Purely a display concern — reads the outcome the POST endpoint already
// decided (app/api/action/returned/route.ts), no DB access, no
// re-verification. Same deliberate tradeoff as the Archive done page:
// this outcome param isn't signed, so a user could load
// /action/returned/done?outcome=success directly and see the success copy
// without having marked anything returned. Not a security issue (no state
// changes happen from viewing this page), just a mildly confusing edge case
// if someone constructs the URL by hand.
const COPY: Record<string, { title: string; body: string }> = {
  success: { title: "Marked as returned", body: "We'll check back in a bit to confirm your refund landed." },
  expired: { title: "This link expired", body: "Open the app to take action." },
  already_used: { title: "Already done", body: "This action was already completed." },
  invalid: { title: "This link is invalid", body: "Contact support." },
  order_state_changed: { title: "No longer available", body: "This order is no longer available." },
};

export default async function ReturnedDonePage({
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
