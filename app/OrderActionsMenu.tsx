"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArchiveOrderButton } from "./ArchiveOrderButton";

const menuItemClass = "block w-full text-left px-3 py-2 text-sm text-ink hover:bg-page disabled:opacity-50";

// Overflow menu for secondary order actions — return-window-design-tokens.md
// §6 Commit 2. Closes via an invisible full-screen backdrop click rather
// than a document-level listener, so there's no external dependency and no
// listener cleanup to get wrong.
export function OrderActionsMenu({
  orderId,
  isArchived,
  trackingUrl,
  returnTrackingUrl,
  className = "",
}: {
  orderId: string;
  isArchived: boolean;
  trackingUrl: string | null;
  returnTrackingUrl: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const router = useRouter();

  async function handleDelete() {
    if (!window.confirm("Delete this order? This can't be undone from the app.")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/delete`, { method: "PATCH" });
      if (res.ok) {
        setOpen(false);
        router.refresh();
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className={`relative shrink-0 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="More actions"
        className="w-9 h-9 flex items-center justify-center rounded-lg text-secondary hover:bg-page hover:text-ink text-lg leading-none"
      >
        ⋯
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-10 cursor-default"
          />
          <div className="absolute right-0 top-full mt-1 z-20 w-48 bg-card border border-border rounded-lg shadow-lg py-1 flex flex-col">
            {trackingUrl && (
              <a
                href={trackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className={menuItemClass}
              >
                Track package →
              </a>
            )}
            {returnTrackingUrl && (
              <a
                href={returnTrackingUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setOpen(false)}
                className={menuItemClass}
              >
                Track your return →
              </a>
            )}
            <ArchiveOrderButton orderId={orderId} isArchived={isArchived} className={menuItemClass} />
            <button type="button" onClick={handleDelete} disabled={deleting} className={`${menuItemClass} text-red-600`}>
              {deleting ? "…" : "Delete order"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
