export const dynamic = "force-dynamic";

const APP_URL = "https://app.myreturnwindow.com";

// Purely a display concern — reads the outcome the POST endpoint already
// decided (app/api/action/start-return/route.ts), no DB access, no
// re-verification. Only reached for non-success outcomes: a successful
// redemption 302s straight to the retailer's returnPortalUrl and never
// lands here. Same deliberate tradeoff as the Archive/Returned done pages:
// this outcome param isn't signed, so a user could load
// /action/start-return/done?outcome=no_portal directly by hand — not a
// security issue (no state changes happen from viewing this page), just a
// mildly confusing edge case.
const COPY: Record<string, { title: string; body: string }> = {
  expired: { title: "This link expired", body: "Open the app to take action." },
  already_used: { title: "Already done", body: "This action was already completed." },
  invalid: { title: "This link is invalid", body: "Contact support." },
  order_state_changed: { title: "No longer available", body: "This order is no longer available." },
  no_portal: { title: "No return link available", body: "Open the app to find a return option for this order." },
};

export default async function StartReturnDonePage({
  searchParams,
}: {
  searchParams: Promise<{ outcome?: string }>;
}) {
  const { outcome } = await searchParams;
  const copy = (outcome && COPY[outcome]) || COPY.invalid;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-ink">Return Window</span>
        <h1 className="text-lg font-medium text-ink mt-6">{copy.title}</h1>
        <p className="text-secondary text-sm mt-2">{copy.body}</p>
        <a
          href={APP_URL}
          className="inline-block mt-6 text-sm font-medium text-ink underline hover:text-secondary"
        >
          Go to your dashboard
        </a>
      </div>
    </main>
  );
}
