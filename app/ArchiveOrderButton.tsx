"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function ArchiveOrderButton({
  orderId,
  isArchived,
  className,
}: {
  orderId: string;
  isArchived: boolean;
  className?: string;
}) {
  const [pending, setPending] = useState(false);
  const [archived, setArchived] = useState(isArchived);
  const router = useRouter();

  async function handleClick() {
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived: !archived }),
      });
      if (res.ok) {
        setArchived(!archived);
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
      title={archived ? "Restore to dashboard" : "Archive this order"}
      className={`disabled:opacity-50${className ? ` ${className}` : ""}`}
    >
      {pending ? "…" : archived ? "Unarchive" : "Archive"}
    </button>
  );
}
