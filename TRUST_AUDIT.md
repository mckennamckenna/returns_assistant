# Trust Audit — Authenticated Dashboard

**Date:** 2026-07-13
**Status:** Phase 1 — investigation only. No code changes. No commits.
**Method:** Screenshot-driven, against the real production database via a local
`next dev` server. Desktop (1440×900) and mobile (390×844) viewports, real
data from the owner's own account (25 orders) plus a genuine empty account
created and deleted for this audit only.

**A note on method, for transparency:** capturing the *authenticated*
dashboard required a session. Rather than guess from source or ask for a
fresh login, I created a short-lived `Session` row directly in the database
for the owner's own existing account (no email sent, no password involved),
used it locally to screenshot every surface below, then deleted the session
row immediately after. I also created one throwaway `User` with zero orders
to capture the true empty state, and deleted that user and its session when
done. Verified afterward: the owner's real account and all 25 orders are
untouched. No other data was read, written, or exported. The local dev
server was stopped and every temporary script was deleted at the end.

**One artifact to ignore in every screenshot:** a small black circle with an
"N" in the bottom-left corner is `next dev`'s own development-mode indicator
badge — confirmed by loading the fully public, logged-out `/login` page,
where it also appears. It is not a real UI element and will not exist on
production (`app.myreturnwindow.com`). It happens to visually overlap the
sidebar's account/sign-out area in these screenshots; that overlap is a
capture artifact, not a real bug.

---

## Correction to one pre-discussed premise

**"Looks correct" is not crimson.** Checked directly against
`app/ReviewCard.tsx:77` and confirmed in every screenshot: the button uses
`bg-ink` (the app's standard black), not red. There is a rose/crimson color
elsewhere in the app (`CopyButton.tsx`'s `text-rose-600`, `DeleteButton.tsx`'s
`hover:text-red-600`), which may be what's being recalled — but neither is
this button. As shipped today, there's no destructive-color risk on this
confirm action. Keeping this row in the table below so it isn't silently
dropped, but there's nothing to fix here.

---

## Findings table

| Surface | Viewport | Element | Reads as (to a first-time user) | Proposed fix | Effort | Risk |
|---|---|---|---|---|---|---|
| Dashboard list | Desktop + mobile | **Retailer avatar for "On (On-Running)" renders literally as "O("** — `initialsFor()` in `RetailerAvatar.tsx` takes the first letter of the first two whitespace-split words; the second word here is `"(On-Running)"`, so its first character is `(`. | A broken/glitched icon, not a brand monogram | Strip leading non-alphabetic characters before taking initials, or only consider alphabetic words | S | Low |
| Sidebar | Desktop | Active nav item's left-border indicator (`border-l-[3px]` + `rounded-lg`) renders as a curved bracket shape, not a flush vertical accent line — confirmed via zoomed crop | A stray character or rendering glitch next to "Dashboard," not an intentional active-state marker | Square the left corners on the active item (or on all nav items), or switch to a differently-shaped indicator | S/M | Low |
| Order detail page | Desktop + mobile | Action-button row (`app/(app)/orders/[id]/page.tsx`) shows **"Start Return →" (blue) alongside a status-specific button ("I'm returning this" / "Mark as returned") simultaneously**, gated only by `order.returnPortalUrl` existing — not by `displayStatus`. Different color system entirely (blue/yellow/green) from the redesigned `OrderCard`'s unified black buttons. | "Wait, haven't I already started this return? Which button do I press?" — and visually, "this doesn't look like the same app as the dashboard." | Rebuild this section to reuse the same status-gated single-action pattern as `OrderCard` | **L** | **Med — this is a behavior/logic fix, not pure display; flagging that it exceeds "display-only" scope for a name-it-and-decide call, not proposing it for this polish pass** |
| Dashboard card + order detail | Desktop + mobile | **Wall of "(est.)"**: Shopbop's dashboard card shows it twice ("11 days left (est.)" chip + "Return by Jul 23, 2026 (est.)"); its detail page shows it three more times, once per field ("Jul 8, 2026 (estimated)" ×2, "Jul 23, 2026 (estimated — based on shipping estimate)") — 5 repetitions of the same hedge for one order. | "This app doesn't actually know anything for sure" — erodes the core value proposition (a trustworthy deadline) | Consolidate to one estimate indicator per order (e.g. a single note/tooltip) instead of repeating the word on every field | M | Low/Med (copy + multiple call sites, no logic change) |
| Needs-review card | Desktop + mobile | "Looks correct" button color | See correction above — not an issue as shipped | — | — | — |
| Needs-review card | Desktop + mobile | No plain-English "why" line visible without clicking "Read more" — only "This order needs a quick check" + retailer/order number shown by default | Doesn't know why it's being asked to confirm something, has to commit to an extra click to find out | Surface the first ~60 chars of the review reason inline; "Read more" only expands the rest | S/M | Low |
| Dashboard list | **Mobile only** | Order-number + item-summary combined line overflows on narrow widths — e.g. Poshmark: `#6a4d94…748a · M...` — the item name gets truncated to almost nothing after the (already-shortened) order number eats the line | A cut-off, broken label rather than a real product name | Drop the item summary from this line at narrow widths, or stack order-number/item-summary on two lines below ~480px | S | Low |
| Sidebar footer | Desktop (mobile has no equivalent — no account email shown at all in bottom nav) | Account email truncates via CSS ellipsis (`truncate` class, no `title`) — e.g. `mckenna.sweazey@g…` | Can't confirm which account you're logged into without guessing — relevant for anyone with multiple accounts/emails | Add a `title` attribute with the full email (same pattern just shipped for order numbers) | S | Low |
| Dashboard | Desktop (≥1024px, worst at 1440px+) | Content column caps at roughly 640–850px inside a 1440px viewport — **~40% of the screen is blank beige space** on the right | "Did something fail to load?" / "this looks unfinished," not "this is an intentional narrow reading column" | This is the central ask behind "Desktop visual polish" — widen the column moderately, or use the space intentionally (secondary content/insights) rather than leaving it empty | M/L | Low (pure layout) |
| Dashboard header | Desktop (wide viewports) | "Good afternoon" greeting doesn't scale up with viewport width — looks small relative to the surrounding whitespace | Feels like a mobile layout stretched onto a wide screen rather than a considered desktop treatment | Increase greeting type scale at `md`/`lg` breakpoints | S | Low |
| Needs-review card | Desktop (wide viewports) | Card keeps the same narrow, stacked layout as mobile; the two review items stack vertically even with ample width available | Doesn't feel adapted for desktop, same "stretched mobile" read as the greeting | Consider a 2-column grid for review items at `md+` | M | Low |
| Dashboard ("Unlinked emails" section) | Desktop + mobile | Raw forwarded promotional-email previews are shown, including a visible tracking-style URL (`click.mkt.isdnn.com/...`) in the body preview text | Spam/phishing content appearing to leak into the app's own UI — especially confusing for a first-time user who doesn't yet understand why marketing emails end up here | Strip/hide raw URLs from the preview snippet before display, or truncate the body preview before any URL-looking substring | M | Low |
| Dashboard card + order detail | Desktop + mobile | "(est.)" / "at risk" text — measured color `rgb(154,122,69)` (12px) against the page background `rgb(245,244,242)` computes to **~3.66:1 contrast**, below WCAG AA's 4.5:1 minimum for normal-size text | Genuinely hard to read for some users, not just a stylistic quibble — this is a measured number, not a vibe | Darken the amber/tan token, or increase weight/size specifically for these tags | S | Low |
| Order detail page | **Mobile only** | Long order number (Poshmark, 24 chars) wraps across 3 lines; the "Copy" button sits awkwardly mid-wrap rather than below the value | Not broken, just visually inelegant for the long-order-number case | Stack the Copy button below the full value at narrow widths instead of inline | S | Low |
| Order detail + dashboard | Desktop + mobile | Bare "Delivery date —" / "Return by — (est.)" with zero explanatory context when the field is simply not yet known | "The app failed to fetch this" rather than "we don't have a delivery email for this order yet, that's normal" | Replace the bare dash with a short inline hint on the fields most central to the app's promise | S/M | Low |
| Sidebar / dashboard | N/A (general assessment, not a specific bug) | Retailer avatar treatment overall (neutral bordered circle + initials, same background as the page) | Not embarrassing on its own — this is a reasonable, common fallback pattern (Slack/Gmail-style initials) independent of the logo-deferral decision | No fix needed beyond the "O(" bug above | — | — |

---

## Explicitly in-scope items (Phase 2 pre-committed) — status after this audit

- **Sidebar refinement**: the active-item bracket-shaped border (row 2 above) is the concrete finding here.
- **Spacing pass**: no single egregious spacing bug found beyond what's already listed; the wide-viewport empty-space row is the dominant issue in this category.
- **Greeting size at desktop widths**: confirmed, row 10 above.
- **Needs-review card styling at wider viewports**: confirmed, row 11 above (plus the "why" line, row 6, which is a content gap more than a styling one but affects the same card).

---

## Top 5 for chat summary

1. Retailer avatar bug: "On (On-Running)" → literally renders as **"O("**.
2. Order detail page's action buttons are a different, unmigrated design entirely from the redesigned dashboard card — and aren't gated by order status, so contradictory buttons can show together. This is a logic fix, not pure display — flagging for a scope decision rather than folding into this pass.
3. Wall of "(est.)": Shopbop shows the same hedge **5 times** across its card and detail page.
4. Contrast on "(est.)"/"at risk" text measured at **~3.66:1**, below WCAG AA's 4.5:1 for normal text — an actual number, not a stylistic guess.
5. The wide-viewport empty space: at 1440px, roughly **40% of the screen is blank beige void** to the right of the content column — the single most visible thing about the desktop dashboard, and the crux of "Desktop visual polish."

---

*No code, styles, components, or copy were touched in this phase. Waiting for
an explicit scope list before Phase 2 begins.*
