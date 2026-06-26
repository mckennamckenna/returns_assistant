"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

const DEBOUNCE_MS = 300;

const STATUS_OPTIONS = [
  { value: "all", label: "All orders" },
  { value: "open", label: "Open" },
  { value: "closing_soon", label: "Closing soon" },
  { value: "needs_review", label: "Needs review" },
  { value: "completed", label: "Completed" },
  { value: "expired", label: "Expired" },
];

export function SearchFilterBar({ initialQuery, initialStatus }: { initialQuery: string; initialStatus: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [status, setStatus] = useState(initialStatus);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync if the URL changes from outside this component (e.g. the
  // "Clear" link below, or a sort-header link elsewhere on the page) —
  // local state otherwise wouldn't know the params moved.
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => setStatus(initialStatus), [initialStatus]);

  function pushUrl(nextQuery: string, nextStatus: string) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextStatus !== "all") params.set("status", nextStatus);
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushUrl(value, status), DEBOUNCE_MS);
  }

  function handleStatusChange(value: string) {
    setStatus(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushUrl(query, value);
  }

  return (
    <div className="flex flex-wrap items-center gap-3 mb-6">
      <input
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search retailer or order number"
        className="flex-1 min-w-[14rem] bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm placeholder:text-stone-400"
      />
      <select
        value={status}
        onChange={(e) => handleStatusChange(e.target.value)}
        className="bg-white border border-stone-200 rounded-lg px-3 py-2 text-sm text-stone-600"
      >
        {STATUS_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {(query || status !== "all") && (
        <Link href={pathname} className="text-sm text-stone-500 hover:underline">
          Clear
        </Link>
      )}
    </div>
  );
}
