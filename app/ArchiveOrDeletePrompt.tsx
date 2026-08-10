"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// CARD_SPEC.md Part 5 Q7: NO "⋯", NO glyph, NO swipe/gesture. A single
// labeled `Archive` control lives in the card's expanded state; tapping it
// opens this small archive-or-delete prompt. Delete is not a peer control —
// it lives inside this prompt, own confirm, never hard delete (the DELETE
// endpoint soft-deletes; HARD_DELETE_DAYS sweeps it later).
//
// Already archived -> single-step Unarchive, no prompt, no warning (Q8) —
// same behavior ArchiveOrderButton has always had.
export function ArchiveOrDeletePrompt({
  orderId,
  isArchived,
  className = "",
}: {
  orderId: string;
  isArchived: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const router = useRouter();

  async function setArchived(archived: boolean) {
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/archive`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archived }),
      });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm("Delete this order? This can't be undone from the app.")) return;
    setPending(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/delete`, { method: "PATCH" });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  }

  if (isArchived) {
    return (
      <button type="button" onClick={() => setArchived(false)} disabled={pending} className={className}>
        {pending ? "…" : "Unarchive"}
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      <button type="button" onClick={() => setOpen((o) => !o)} className={className}>
        Archive
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-60 bg-card border border-border rounded-lg shadow-lg p-3 flex flex-col gap-2">
            <p className="text-xs text-muted">Archive keeps this order. Delete discards it as not a purchase.</p>
            <button
              type="button"
              onClick={() => setArchived(true)}
              disabled={pending}
              className="text-left text-sm text-ink hover:bg-page rounded px-2 py-1 disabled:opacity-50"
            >
              {pending ? "…" : "Archive"}
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="text-left text-sm text-red-600 hover:bg-page rounded px-2 py-1 disabled:opacity-50"
            >
              {pending ? "…" : "Delete"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
