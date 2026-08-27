// TASKS.md 2026-08-27 ("Dashboard/detail date drift on #54421192781") — the
// shared source of truth for rendering a calendar-date field (deliveredAt,
// deliveryDate, estimatedDeliveryDate, orderDate, returnDeadline) anywhere
// in the app.
//
// These fields are semantically CALENDAR DATES, not instants — "delivered
// Aug 22" means the calendar day Aug 22, full stop. They are stored as
// `DateTime` at UTC midnight as a LEGACY REPRESENTATION of that calendar
// date (the schema predates this distinction) — the UTC-midnight instant
// is a stand-in for "Aug 22," not a claim that delivery happened at a
// specific moment in time.
//
// Renderers MUST read the stored value's UTC year/month/day components
// directly (`timeZone: "UTC"` below) and MUST NOT convert to any local
// timezone — including the app's own users' timezone. Converting a
// UTC-midnight "Aug 22" stand-in to America/Los_Angeles (UTC-7 in August)
// produces "Aug 21, 5pm" — a real, correct timezone conversion, but the
// wrong answer for a value that was never a real instant to begin with.
// That conversion is exactly the bug this file exists to close, not a fix
// for it: it's what the pre-2026-08-27 client-side code did by calling
// `toLocaleDateString(undefined, ...)` with no explicit timeZone, which
// defaults to the browser's real local zone. The server-rendered pages hit
// the same underlying mistake from the other direction — no explicit
// timeZone there defaults to the server process's zone (UTC on Vercel),
// which happens to equal the stored value's own zone, so those surfaces
// looked correct by coincidence, not by design. Same missing pin, two
// different accidents: one side rolls the date back, the other doesn't,
// and the same order reads two different days depending only on which
// kind of component rendered it. That's the dashboard-vs-detail drift,
// and it's the same mechanism behind two earlier, independently-logged
// "off by one day" entries (2026-08-21, 2026-08-25) and a third framed as
// an open (a)/(b) decision ("(a) the date's own timezone (or UTC)" vs.
// "(b) the user's local timezone") — this file resolves that decision as
// (a): pin to the date's own timezone (UTC, since that's how it's stored),
// never to any viewer's local zone, US-based or otherwise. This holds
// regardless of where the app is used from — it isn't a US-specific
// choice, it falls out of what these fields actually mean.
//
// (A 2026-08-27 build session initially implemented this file pinned to
// America/Los_Angeles under an "always render in the user's local
// timezone" framing, on the reasoning that the dashboard's pre-existing
// client-side behavior already did that and every alpha user is Pacific.
// Caught before shipping: that framing directly contradicts what a
// calendar-date value actually needs — genuine Pacific conversion of a
// UTC-midnight "Aug 22" produces "Aug 21," reintroducing the exact
// rollback bug everywhere instead of fixing it. Recorded here so the next
// reader doesn't re-derive and re-reject the same wrong turn.)
export function formatCalendarDate(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Short form — "Aug 22". Use wherever the date is inline with other context
// that already establishes the year (card chips: "Arrives Aug 22").
export function formatCalendarDateShort(date: Date | null): string {
  if (!date) return "—";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}
