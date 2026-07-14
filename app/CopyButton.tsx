"use client";

import { useState } from "react";

// Hand-rolled, minimal stroke icon — matches the app's existing icon
// convention (BottomNav.tsx's Home/Bell/Gear icons, OrderCard.tsx's QrIcon),
// not a new icon library dependency. No copy/clipboard icon existed
// anywhere in the app before this.
function CopyIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 12l6 6L20 6" />
    </svg>
  );
}

// iconOnly: a small icon-quiet button instead of the "Copy"/"Copied!" text
// pill — for contexts where the value being copied is itself the visible
// content (e.g. an order number) and the action should stay visually quiet
// rather than compete with it. label drives both aria-label and title so
// screen readers and hover both get the same description.
export function CopyButton({ text, iconOnly = false, label = "Copy" }: { text: string; iconOnly?: boolean; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (iconOnly) {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-label={label}
        title={label}
        className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-secondary hover:text-ink hover:bg-page disabled:opacity-50"
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="text-sm font-medium text-rose-600 hover:text-rose-800 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-50"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
