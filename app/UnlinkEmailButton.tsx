"use client";

import { useFormStatus } from "react-dom";

// carrier-row-disposition Phase 3 — mirror of DeleteButton.tsx, secondary/
// tertiary text styling (not the destructive-red treatment DeleteButton
// uses on hover) since unlink is trivially reversible: relink from the
// needs-review dashboard, no confirm step needed (owner, 2026-08-28).
export function UnlinkEmailButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-label="Unlink email from this order"
      title="Unlink email from this order"
      className="text-xs font-medium text-secondary underline hover:text-ink disabled:opacity-50 whitespace-nowrap px-2"
    >
      {pending ? "…" : "Unlink"}
    </button>
  );
}
