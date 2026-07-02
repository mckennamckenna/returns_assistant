# Return Window — Task Board

> Single source of truth for what's being worked on. Read at session start,
> updated immediately when any bug, follow-up, or feature comes up in conversation.
>
> **Entry format:** one-line summary · optional 1–2 lines of context · optional
> link to the session or BUILD.md milestone that spawned it.
>
> Rule: work items in Now only. Everything is measured against "does this get a
> real user on it today."
>
> **Done split:** TASKS.md Done = one line, plain English, no commit hash or backfill
> numbers. HISTORY.md = full detail (commit hash, root cause, what was verified). If
> BUILD.md's data model or invariants change, update BUILD.md in the same commit.
>
> **Scope control:** Claude Code works only on (a) items in 🔴 Now, or (b) the explicit
> task given in the current session — and in case (b), 🔴 Now must be updated to reflect
> it BEFORE work starts. Scope expansions mid-session ("while I was in there I also
> fixed X") must be added to Now or confirmed before proceeding — no silent scope creep.
> At session close, state explicitly: committed? pushed? deployed? "Tests passed" does
> not mean deployed. If any of those three didn't happen, say so plainly.

---

## 🔴 Now
- [x] **Re-forward H&M "Your return package has arrived"** — email was discarded
      by the old classify gate (now fixed). Re-forwarded; landed correctly.

## 🟡 Next
- [ ] **Marketing homepage at myreturnwindow.com + beta signup** — public-facing
      homepage at the root domain (not app.) explaining what Return Window is, with a
      way for people to sign up for the beta. Followed by cleaning up your own account
      (the test/dev data) so it reflects what a real first-time user would see.
- [ ] Get **one friend** logged in and using it end-to-end (the real milestone)
- [ ] Buy domains: `returnwindow.com` (+ `closetwindow.com`, `windowshopping.com`)
- [ ] Smoke-test the full flow on production after Mango fix: sign in → forward
      an order email → see it parsed → see the return window / deadline
- [ ] **Move retailer-prefix merge marker off `Order.userNote`** — today's
      backfill wrote `[auto] retailer prefix match: ...` into `userNote`, which
      per Milestone 10 is the user-authored review note. If `[auto]`-prefixed
      entries accumulate, user notes become indistinguishable from system notes
      in queries and the admin dashboard. Needs a proper field or audit log.
      Spawned by `2cb5de2`.

## 👀 Watching — parked, revisit only if it recurs
- [ ] **Post-beta: delivery-only orders (no `shipping_confirmation`)** — during alpha,
      4 orders (H&M, Freda Salvador, Tuckernuck, Shopbop) had only a delivery email,
      no shipping confirmation. Root cause: users forwarding manually and not forwarding
      every email. Once real Gmail-filter forwarding replaces manual forwarding, delivery-only
      orders should become rare. If still common post-beta, investigate the discard gate
      and extraction pipeline for dropped `shipping_confirmation` emails — don't assume
      "user didn't forward it" anymore.
- [ ] **Mango order-number mismatch** (`F4VLSF` vs `F4VLSF00`, ReBOUND suffix) —
      Do NOT fix yet. Watch whether third-party return services (ReBOUND, Narvar,
      Happy Returns, etc.) consistently append suffixes across multiple retailers.
      If the pattern recurs, build fuzzy suffix-strip matching in `lib/linkOrder.ts`.

## ⚪ Someday
- [ ] Closet Window (wardrobe intelligence) — only after Return Window has
      retention data
- [ ] Window Shopping (pre-purchase / price tracking) — same gate
- [ ] Holding-company structure ("Window") — not now
- [ ] **Rotate Postmark inbound webhook URL** — still points at
      `returns-assistant.vercel.app/api/inbound`. Deliberately deferred in
      Milestone 20 (both URLs serve the same app); worth rotating eventually
      for consistency once there's a low-risk window.
- [ ] **Extraction quality: retailer name specificity** — AI extracts different
      precision from different email types for the same retailer (Proenza vs
      Proenza Schouler from shipping vs order-confirmation templates). A
      prompt-level fix could reduce reliance on the retailer-prefix fallback.
      Surfaced by today's `2cb5de2`.

## ✅ Done
- [x] Documentation restructured — BUILD.md trimmed to current-state reference; HISTORY.md created with full chronological detail; TASKS.md Done section reformatted to one-liners.
- [x] Dashboard UI additions — "Track your return" link, "Mark as refunded" button, Archive/Unarchive button, and Archived filter tab added to dashboard and order detail page.
- [x] Soft-delete wired to dashboard delete buttons — both buttons now hit the soft-delete endpoint with a confirm gate; old hard-delete server action removed.
- [x] Refund check-in reminder added — fires 5 or 10 days after returnedAt depending on whether return tracking is present.
- [x] Archive + soft-delete fields added to Order — PATCH endpoints, activeOrderFilter helper, hard-delete cron step.
- [x] displayStatus logic fixed — delivery emails advance to "shipped"; return_label emails auto-advance to "return_requested".
- [x] Return-shipment tracking fields added — returnCarrier, returnTrackingNumber, returnTrackingUrl scraped from return_label emails.
- [x] Sunday weekly digest shipped.
- [x] Subject-line order number extraction fixed — shipping emails that state the order number only in the subject now link correctly.
- [x] User-facing displayStatus field shipped — badge, filter dropdown, manual advancement buttons, tracking link.
- [x] Magic-link login fixed in production — Auth.js v5 env var mismatch resolved.
- [x] Admin onboarding view added — lists all users' forwarding addresses, session-gated.
- [x] Custom inbound domain (mail.myreturnwindow.com) piloted and rolled out to all users.

## ⚠️ Known issues / tech debt
<!-- Claude Code: append issues you discover here, newest first, with the file involved -->
- Order-number normalization is brittle across retailers (Mango is the first
  case; expect more retailer-specific suffix quirks).
- Retailer-name prefix matching has a known collision risk: "American" (8 chars)
  is a prefix of "American Eagle", "American Vintage", etc. — two orders from
  different "American X" retailers with the same order number would be wrongly
  merged. Accepted trade-off; every such merge is flagged needsReview + logged
  in Order.userNote (`lib/linkOrder.ts`).

## 📝 Decisions log
<!-- One line per decision so future-you and Claude Code know WHY -->
- Brand family: **Return Window** (wedge) → **Closet Window** → **Window Shopping**,
  unified "Window" metaphor. Build/validate Return Window first; expansions wait
  for retention data.
- Auth: Auth.js v5 — use `AUTH_*` env vars only, never the legacy `NEXTAUTH_*`.
- Inbound email domain is now `mail.myreturnwindow.com` for all users (rolled
  out from a one-account pilot); old `+tag` `postmarkapp.com` addresses still
  resolve, so no user's existing forwarding rule broke.
- Extraction falls back to html-to-text when textBody is empty — required for
  iPhone/Apple Mail forwards, which are HTML-only.
- Forwarded-header orderDate fallback handles Apple Mail format + reads
  htmlBody for HTML-only iPhone forwards.
- Retailer-prefix fallback added to order linking — "Proenza" / "Proenza Schouler"
  was the first real case; MIN_RETAILER_PREFIX_LENGTH=4, exact order number
  required, every merge flagged needsReview + logged.
- Outbound mail consolidated onto myreturnwindow.com — reminders from
  `reminders@myreturnwindow.com`, logins from `hello@myreturnwindow.com`
  (LOGIN_FROM_EMAIL ?? REMINDER_FROM_EMAIL fallback in auth.ts).
