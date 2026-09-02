"use client";

import { useState } from "react";

// Fire-and-forget clipboard copy on the same click that submits the form —
// same pattern as StartReturnButton.tsx's window.open() (must happen
// synchronously in the click handler, not after an await, or it risks
// losing the user-gesture context some browsers require for clipboard
// writes). Never awaited and never blocks the native form submit: a
// clipboard permission failure (denied, insecure context, no document
// focus) must not stop the user from reaching the retailer's return page.
export function StartReturnSubmitButton({ orderNumber, retailer }: { orderNumber: string | null; retailer: string }) {
  const [pending, setPending] = useState(false);

  function handleClick() {
    if (orderNumber && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(orderNumber).catch(() => {});
    }
    setPending(true);
  }

  return (
    <button
      type="submit"
      onClick={handleClick}
      disabled={pending}
      className="w-full rounded-lg bg-ink text-page py-2.5 text-sm font-medium hover:bg-ink/90"
    >
      {pending ? "…" : `Continue to ${retailer} →`}
    </button>
  );
}
