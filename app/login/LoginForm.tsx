"use client";

import { useActionState } from "react";
import { sendMagicLink } from "./actions";

export function LoginForm() {
  const [state, formAction, pending] = useActionState(
    async (_prev: { error?: string; sent?: boolean }, formData: FormData): Promise<{ error?: string; sent?: boolean }> => {
      const result = await sendMagicLink(formData);
      return result.error ? { error: result.error } : { sent: true };
    },
    {},
  );

  if (state.sent) {
    return (
      <div className="bg-white border border-stone-200 rounded-xl p-6 text-center">
        <p className="text-stone-700 font-medium">Check your email</p>
        <p className="text-stone-500 text-sm mt-1">We sent you a magic link to sign in.</p>
        <p className="text-stone-400 text-xs mt-4">
          Didn&apos;t get anything? You may need an invite first —{" "}
          <a href="https://myreturnwindow.com" className="underline hover:text-stone-600">
            request access
          </a>
          .
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="bg-white border border-stone-200 rounded-xl p-6 flex flex-col gap-3">
      <input
        type="email"
        name="email"
        required
        placeholder="you@example.com"
        className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400"
      />
      <button
        type="submit"
        disabled={pending}
        className="bg-rose-600 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-rose-700 disabled:opacity-50"
      >
        {pending ? "Sending…" : "Send magic link"}
      </button>
      {state.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
