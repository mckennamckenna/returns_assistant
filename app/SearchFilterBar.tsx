"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";

const DEBOUNCE_MS = 300;

// Same fields the old desktop table's sortable column headers covered.
// return-window-design-tokens.md §6 Commit 2: "No tabs... sort-by-urgency
// as default is sufficient at alpha volume" — status filtering (open,
// closing soon, etc.) drops from the UI; sorting replaces it.
const SORT_OPTIONS = [
  { value: "returnDate", label: "Return date" },
  { value: "daysLeft", label: "Days left" },
  { value: "retailer", label: "Retailer" },
  { value: "total", label: "Total price" },
  { value: "purchaseDate", label: "Purchase date" },
  { value: "deliveryDate", label: "Delivery date" },
];

export function SearchFilterBar({ initialQuery, initialSort }: { initialQuery: string; initialSort: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [query, setQuery] = useState(initialQuery);
  const [sort, setSort] = useState(initialSort);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Re-sync if the URL changes from outside this component — local state
  // otherwise wouldn't know the params moved.
  useEffect(() => setQuery(initialQuery), [initialQuery]);
  useEffect(() => setSort(initialSort), [initialSort]);

  function pushUrl(nextQuery: string, nextSort: string) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextSort !== "returnDate") params.set("sort", nextSort);
    const queryString = params.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function handleQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushUrl(value, sort), DEBOUNCE_MS);
  }

  function handleSortChange(value: string) {
    setSort(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pushUrl(query, value);
  }

  return (
    <div className="flex flex-col md:flex-row md:flex-wrap md:items-center gap-3 mb-6">
      <input
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Search retailer or order number"
        className="w-full md:flex-1 md:min-w-[14rem] bg-card border border-border rounded-[12px] px-3 py-2 text-sm placeholder:text-muted"
      />
      <select
        value={sort}
        onChange={(e) => handleSortChange(e.target.value)}
        className="w-full md:w-auto bg-card border border-border rounded-[12px] px-3 py-2 text-sm text-secondary"
      >
        {SORT_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            Sort: {option.label}
          </option>
        ))}
      </select>
      {query && (
        <Link href={pathname} className="text-sm text-secondary hover:underline">
          Clear
        </Link>
      )}
    </div>
  );
}
