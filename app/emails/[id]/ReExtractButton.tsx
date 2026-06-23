"use client";

import { useFormStatus } from "react-dom";

export function ReExtractButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm border border-zinc-300 rounded px-3 py-1 hover:bg-zinc-50 disabled:opacity-50"
    >
      {pending ? "Re-extracting…" : "Re-extract"}
    </button>
  );
}
