"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { markRefundedAction } from "./actions";
import { REFUND_CONFIRM_MESSAGE, requiresConfirmBeforeStatusChange } from "@/lib/displayStatus";

export function MarkRefundedButton({ orderId, className }: { orderId: string; className?: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (requiresConfirmBeforeStatusChange("refunded") && !window.confirm(REFUND_CONFIRM_MESSAGE)) return;
    setPending(true);
    try {
      await markRefundedAction(orderId);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <button type="button" onClick={handleClick} disabled={pending} className={className}>
      {pending ? "…" : "Mark as refunded"}
    </button>
  );
}
