"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markReturnRequestedAction } from "./actions";

// Combines what were two separate controls (an external link to
// returnPortalUrl, and a status-only "I'm returning this" button) into the
// design doc's single "Start return" primary action — opens the portal (if
// one exists) and marks the order return_requested in one click.
// window.open must happen synchronously in the click handler, before the
// action's await, or browsers block it as an unrequested popup.
export function StartReturnButton({
  orderId,
  returnPortalUrl,
  className,
}: {
  orderId: string;
  returnPortalUrl: string | null;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (returnPortalUrl) {
      window.open(returnPortalUrl, "_blank", "noopener,noreferrer");
    }
    setPending(true);
    try {
      await markReturnRequestedAction(orderId);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={className}>
      {pending ? "…" : "Start return"}
    </button>
  );
}
