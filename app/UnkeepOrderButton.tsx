"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function UnkeepOrderButton({
  orderId,
  className,
}: {
  orderId: string;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/unkeep`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        setPending(false);
      }
    } catch {
      setPending(false);
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={pending}
      className={`disabled:opacity-50${className ? ` ${className}` : ""}`}
    >
      {pending ? "…" : "May not be keeping after all"}
    </button>
  );
}
