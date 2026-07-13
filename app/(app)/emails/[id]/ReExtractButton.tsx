"use client";

import { useFormStatus } from "react-dom";

export function ReExtractButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="text-sm border border-border rounded px-3 py-1 hover:bg-page disabled:opacity-50"
    >
      {pending ? "Re-extracting…" : "Re-extract"}
    </button>
  );
}
