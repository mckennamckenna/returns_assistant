// Each word is stripped to its alphanumeric characters before taking an
// initial — otherwise a word like "(On-Running)" contributes its leading
// "(" as a rendered initial (e.g. "On (On-Running)" → "O(").
export function initialsFor(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .map((word) => word.replace(/[^a-zA-Z0-9]/g, ""))
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

// Neutral circle, initials-only for now — return-window-design-tokens.md
// §6 Commit 2 (logo integration is a separate future task).
export function RetailerAvatar({ name }: { name: string }) {
  return (
    <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-page border border-border text-ink text-sm font-semibold">
      {initialsFor(name)}
    </span>
  );
}
