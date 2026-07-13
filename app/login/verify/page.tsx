export default function VerifyRequestPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-ink">Return Window</span>
        <div className="bg-card border border-border rounded-xl p-6 mt-6">
          <p className="text-ink font-medium">Check your email</p>
          <p className="text-secondary text-sm mt-1">
            We sent you a magic link. Click it once to sign in — it only works the first time.
          </p>
          <p className="text-muted text-xs mt-4">
            Didn&apos;t get anything? You may need an invite first —{" "}
            <a href="https://myreturnwindow.com" className="underline hover:text-ink">
              request access
            </a>
            .
          </p>
        </div>
      </div>
    </main>
  );
}
