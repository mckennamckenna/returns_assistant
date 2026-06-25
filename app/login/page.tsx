import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { LoginForm } from "./LoginForm";

const ERROR_MESSAGES: Record<string, string> = {
  Verification: "That link has expired or was already used — links only work once. Request a new one below.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  // A signed-in user landing here (e.g. an older magic link whose
  // callbackUrl pointed back at /login) should bounce straight to the
  // dashboard instead of being shown the form again.
  const session = await auth();
  if (session?.user) redirect("/");

  const { error } = await searchParams;
  const errorMessage = error ? ERROR_MESSAGES[error] ?? "Something went wrong signing in. Please try again." : null;

  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-xl font-semibold text-stone-800">Returns assistant</span>
          <p className="text-stone-500 text-sm mt-1">Sign in to your account</p>
        </div>
        {errorMessage && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">
            {errorMessage}
          </p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
