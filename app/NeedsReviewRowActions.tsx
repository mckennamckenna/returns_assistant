"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createOrderFromEmailAction, archiveOrphanedEmailAction } from "./actions";
import type { NeedsReviewActionId } from "@/lib/needsReviewActions";

// The primary registered slot-4 action for an email row — one of the two
// email-kind outcomes from lib/needsReviewActions.ts's registry ("view_detail"
// order rows render as a plain link in NeedsReviewRow.tsx, no client state
// needed there).
export function NeedsReviewRowActions({
  emailId,
  actionId,
  label,
  className = "",
}: {
  emailId: string;
  actionId: NeedsReviewActionId;
  label: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    // CARD_SPEC.md Part 3 — "Create new order" gets its own confirm step,
    // matching the existing junk-with-rescue confirm pattern; "Not a
    // purchase" stays frictionless since it's reversible (rescueEmail).
    if (actionId === "create_new_order" && !window.confirm("Create a new order from this email?")) return;

    setPending(true);
    try {
      if (actionId === "create_new_order") {
        await createOrderFromEmailAction(emailId);
      } else if (actionId === "not_a_purchase") {
        await archiveOrphanedEmailAction(emailId);
      }
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  if (actionId !== "create_new_order" && actionId !== "not_a_purchase") return null;

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={className}>
      {pending ? "…" : label}
    </button>
  );
}
