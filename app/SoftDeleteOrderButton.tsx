"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function SoftDeleteOrderButton({ orderId, className }: { orderId: string; className?: string }) {
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function handleClick() {
    if (!window.confirm("Delete this order? This can't be undone from the app.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/delete`, { method: "PATCH" });
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
      aria-label="Delete order"
      title="Delete order"
      className={`text-muted hover:text-red-600 disabled:opacity-50 px-2 text-sm${className ? ` ${className}` : ""}`}
    >
      {pending ? "…" : "✕"}
    </button>
  );
}
