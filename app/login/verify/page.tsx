export default function VerifyRequestPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm text-center">
        <span className="text-xl font-semibold text-stone-800">Return Window</span>
        <div className="bg-white border border-stone-200 rounded-xl p-6 mt-6">
          <p className="text-stone-700 font-medium">Check your email</p>
          <p className="text-stone-500 text-sm mt-1">
            We sent you a magic link. Click it once to sign in — it only works the first time.
          </p>
        </div>
      </div>
    </main>
  );
}
