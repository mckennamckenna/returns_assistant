import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <span className="text-xl font-semibold text-stone-800">Returns assistant</span>
          <p className="text-stone-500 text-sm mt-1">Sign in to your account</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
