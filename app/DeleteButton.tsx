"use client";

import { useFormStatus } from "react-dom";

export function DeleteButton({ label = "Delete" }: { label?: string }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label={label}
      title={label}
      className="text-zinc-400 hover:text-red-600 disabled:opacity-50 px-2 text-sm"
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
