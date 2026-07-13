# Return Window — Design Tokens (Alpha)

The single reference for fonts and color. Hand this file to Claude Code for the
build. Every value here matches the approved mock.

---

## 1. Fonts — both free, self-hosted

| Role | Font | Source | License |
|---|---|---|---|
| Display serif | **Bodoni Moda** | fonts.google.com/specimen/Bodoni+Moda | SIL Open Font License — free |
| Interface sans | **Inter** | fonts.google.com/specimen/Inter | SIL Open Font License — free |

**Weights to download:** Bodoni Moda **Regular (400)**, **Medium (500)**, **SemiBold (600)**;
Inter **Regular (400)** and **Medium (500)**. Five files total.

Bodoni Moda is a variable optical-size font (opsz 6–96). At display sizes (greeting,
big numbers) it renders with maximum thick/thin contrast automatically. Self-host
the variable `.woff2` for both weight and optical size in one file.

---

## 2. Type scale

Serif = Bodoni Moda. Sans = Inter. Sizes are for mobile (~380 px); scale up ~15% for desktop.

| Element | Font | Size | Weight | Color token |
|---|---|---|---|---|
| Wordmark "MY RETURN WINDOW" | Sans | 13 px, tracking +4 px, UPPERCASE | 500 | Ink |
| Greeting "Good evening, Mckenna" | Serif | 30 px, line-height 1.08 | 500 | Ink |
| Greeting subtitle | Sans | 14 px | 400 | Muted |
| Section label ("DUE IN THE NEXT 7 DAYS") | Sans | 10–11 px, tracking +1.5 px, UPPERCASE | 500 | Accent |
| Summary count "1" | Serif | 34 px | 600 | Ink |
| Summary dollar "$640.87" | Serif | 25 px | 600 | Ink |
| Summary sublabels ("return closing soon") | Sans | 12 px | 400 | Secondary |
| Retailer name | Sans | 18 px | 500 | Ink |
| Order # / item meta | Sans | 12 px | 400 | Muted |
| Status pill text | Sans | 12 px | 500 | (per status tint) |
| Days-left number | Serif | 19 px | 600 | Ink |
| "days left" label | Sans | 11 px | 400 | (per tint) |
| Order price "$433.64" | Serif | 27 px | 600 | Ink |
| Return-by date | Sans | 13 px | 400 | Muted |
| Button labels | Sans | 14 px | 500 | (fill-dependent) |
| Nav labels | Sans | 12 px | 500 active / 400 inactive | Ink / Muted |

Rule: serif is only for greeting, summary numbers, days-left numbers, and prices.
Everything functional stays sans. Let size create hierarchy — no bold serif.

---

## 3. Color

### Foundations (crisp, near-white)
| Token | Hex | Where |
|---|---|---|
| Page | `#F5F4F2` | app background — cool near-white, NOT cream/beige |
| Card | `#FFFFFF` | all cards (summary, order, nav bar) |
| Ink | `#16120E` | headings, primary text, button fill, active nav |
| Secondary | `#7A736A` | supporting copy |
| Muted | `#A8A096` | metadata, dates, placeholders |
| Border | `#E8E6E2` | hairlines, outlined buttons, inputs |
| Accent | `#9A7A45` | small-caps labels only — never large areas |

### Status tints — small, cool, desaturated
| State | Background | Text |
|---|---|---|
| Neutral (Shipped / Ordered / Delivered & deciding) | `#EEEDEB` | `#6E665C` |
| Return initiated | `#E7EBEF` | `#4E5A68` |
| Safe (days-left pill, > 7 days) | `#E9F0E4` | `#5E7052` |
| Closing soon (days-left pill, ≤ 7 days) | `#F4EBD8` | `#9A7A45` |

Warmth lives ONLY in the closing-soon pill and the accent label text.
Everything else is neutral/cool.

---

## 4. Radii
| Element | Radius |
|---|---|
| Cards (summary + order) | 16 px |
| Search / sort controls | 12 px |
| Buttons | 10 px |
| Status + days-left pills | 999 px (full) |
| Retailer logo container | 50% (circle) |

## 5. Spacing (8-point)
- Card padding: 18 px
- Gap between cards: 16 px
- Page side margins: 20 px
- Label → value: 8 px · related metadata: 12 px · section separation: 22 px
- Shadow: almost none. If any: `box-shadow: 0 2px 12px rgba(30,20,12,0.035)`.
  Cards defined by border + whitespace, not elevation.

---

## 6. Claude Code tasks — two commits, in order

Add each to 🔴 Now before starting it. Run commit 1 first, verify in production,
then run commit 2.

### Commit 1: Typography and color (no layout changes)

> **Task: self-host Bodoni Moda + Inter and apply the design tokens.**
>
> Add two self-hosted font families using `next/font/local` (or `next/font/google`
> with `display: 'swap'`): **Bodoni Moda** (display serif, variable weight 400–700,
> variable optical size 6–96) and **Inter** (UI sans, weights 400 + 500). Expose as
> CSS variables `--font-serif` and `--font-sans` on the root layout.
>
> Then apply the type scale and color palette from
> `return-window-design-tokens.md` (§2–§3):
> - Serif (Bodoni Moda) on: greeting, summary count, summary dollar, days-left
>   number, order price. Nothing else.
> - Sans (Inter) on: everything else — wordmark, buttons, labels, status pills,
>   nav, metadata.
> - Page background: `#F5F4F2`. Card backgrounds: `#FFFFFF`. Borders: `#E8E6E2`.
>   Text colors: Ink `#16120E`, Secondary `#7A736A`, Muted `#A8A096`.
> - Status pill backgrounds and text per the status tint table.
> - Button fill: Ink. Button text: Page. Outlined button border: Border.
>
> No layout, spacing, or component changes in this commit — typography and color
> only. Report committed / pushed / deployed status at close.

### Commit 2: Dashboard layout redesign

Run this after commit 1 is verified in production.

> **Task: redesign the mobile dashboard layout per the design tokens doc.**
>
> This changes the structure of the dashboard. Reference the approved mock
> (the final crisp-palette Bodoni Moda render in chat) for the target.
>
> **Summary card** — replace the current three separate colored boxes (open
> returns / closing soon / value at risk) with a single compact horizontal card:
> count (serif) | thin vertical divider | dollar amount (serif) | dark "View all →"
> button. Background: `#FFFFFF`. Label above in tracked uppercase sans:
> "DUE IN THE NEXT 7 DAYS" in accent color `#9A7A45`.
>
> **Needs-review card** — surface the existing needsReview UI below the summary
> card and above the order list. Keep the two actions (Looks right / Split order).
> No new backend work — this is a repositioning of existing UI.
>
> **Order card anatomy** — each card is white (`#FFFFFF`), 16 px radius, 18 px
> padding. Left-to-right:
> - Retailer logo circle (48 px, `#F5F4F2` background, 1 px border) — initials
>   for now, logo integration is a separate future task
> - Middle column: retailer name (18 px sans medium), order number + item name
>   (12 px muted), status pill below (12 px sans medium, background and text
>   color per the status tint table in §3)
> - Top-right: days-left pill (serif number + "days left" label). Sage tint
>   (`#E9F0E4` / `#5E7052`) when > 7 days, tan tint (`#F4EBD8` / `#9A7A45`)
>   when ≤ 7 days
> - Below: price in serif (27 px) + "Return by [date]" in muted sans (13 px)
> - Two equal-width buttons: "Start return" (dark fill) and "I'm keeping this"
>   (outlined), plus a `…` overflow icon for secondary actions (Track package,
>   Archive, Mark returned/refunded)
>
> **Search + sort row** — search input (left, flex-1) and sort dropdown (right).
> Both white background, 12 px radius, 1 px border. No tabs (All orders / Due
> soon / etc.) — sort-by-urgency as default is sufficient at alpha volume.
>
> **QR/label hint** — on cards with status "return initiated" or "return
> requested," show a disabled button: QR icon + "View QR code" + a "Soon" pill.
> Greyed out (`#F5F4F2` background, muted text). No click target. This hints at
> the coming feature without promising it works.
>
> **Bottom nav** — three items: Dashboard (house icon, active = Ink),
> To drop off (package icon, inactive = Muted), Alerts (bell icon, inactive =
> Muted). Labels below each icon, 12 px sans.
>
> **Spacing** — follow §5: 20 px side margins, 16 px between cards, 22 px
> section separation, 18 px card padding.
>
> Report committed / pushed / deployed status at close.
