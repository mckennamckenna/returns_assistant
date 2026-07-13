"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-sm font-medium text-rose-600 hover:text-rose-800 border border-rose-200 rounded-lg px-3 py-1.5 hover:bg-rose-50"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
