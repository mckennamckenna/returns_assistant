"use client";

import { useState } from "react";

export function TruncatedNote({ truncated, full, isTruncated }: { truncated: string; full: string; isTruncated: boolean }) {
  const [expanded, setExpanded] = useState(false);

  if (!isTruncated) {
    return <p className="text-xs text-stone-400 mt-1">{full}</p>;
  }

  return (
    <p className="text-xs text-stone-400 mt-1">
      {expanded ? full : truncated}{" "}
      <button type="button" onClick={() => setExpanded((e) => !e)} className="underline text-stone-500 hover:text-stone-700">
        {expanded ? "Show less" : "Read more"}
      </button>
    </p>
  );
}
