# Return Window — Task Board

> Single source of truth for what's being worked on. Read at session start,
> updated immediately when any bug, follow-up, or feature comes up in conversation.
>
> **Entry format:** one-line summary · optional 1–2 lines of context · optional
> link to the session or BUILD.md milestone that spawned it.
>
> Rule: work items in Now only. Everything is measured against "does this get a
> real user on it today."

---

## 🔴 Now
- [x] **Re-forward H&M "Your return package has arrived"** — email was discarded
      by the old classify gate (now fixed). Re-forwarded; landed correctly.

## 🟡 Next
- [ ] Get **one friend** logged in and using it end-to-end (the real milestone)
- [ ] Buy domains: `returnwindow.com` (+ `closetwindow.com`, `windowshopping.com`)
- [ ] Smoke-test the full flow on production after Mango fix: sign in → forward
      an order email → see it parsed → see the return window / deadline
- [ ] **Refund check-in reminder** — one-way email, no CTA. Fires 5 days after
      `returned` if `returnTrackingNumber` present, 10 days if not.
- [ ] **Archive + delete for orders** — soft-delete via `archivedAt` / `deletedAt`.
      Archive is reversible, no confirm required. Delete requires confirmation and
      hard-deletes after 30 days via cron.
- [ ] **Move retailer-prefix merge marker off `Order.userNote`** — today's
      backfill wrote `[auto] retailer prefix match: ...` into `userNote`, which
      per Milestone 10 is the user-authored review note. If `[auto]`-prefixed
      entries accumulate, user notes become indistinguishable from system notes
      in queries and the admin dashboard. Needs a proper field or audit log.
      Spawned by `2cb5de2`.

## 👀 Watching — parked, revisit only if it recurs
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
      for consistency once there's a low-risk window. See BUILD.md Milestone 20
      Prompt 32.
- [ ] **Extraction quality: retailer name specificity** — AI extracts different
      precision from different email types for the same retailer (Proenza vs
      Proenza Schouler from shipping vs order-confirmation templates). A
      prompt-level fix could reduce reliance on the retailer-prefix fallback.
      Surfaced by today's `2cb5de2`.

## ✅ Done
- [x] **displayStatus backfill + delivery→shipped logic fix** — `deriveDisplayStatus` now
      treats `delivery` emails as equivalent to `shipping_confirmation` for advancing
      to `"shipped"` (delivery implies shipped; no separate "delivered" value in
      displayStatus). Backfill via `scripts/backfill-display-status.ts` corrected 9 orders
      stuck at migration-default `"ordered"`. MANGO #F4VLSF correctly skipped (return_label
      only, no shipping/delivery — needs manual dashboard advance). 3 new tests. `e9ab352`.
- [x] **Return-shipment tracking fields** — `returnCarrier`, `returnTrackingNumber`,
      `returnTrackingUrl` on `Order` (migration `20260701164738`). `applyReturnTracking`
      in `lib/linkOrder.ts` scrapes `return_label` emails using the same carrier-pattern
      logic as outbound tracking. `return_label` classification already existed;
      no new EmailType added. No UI in this pass.
- [x] **Sunday weekly digest** — `app/api/cron/weekly-digest/route.ts`, fires every Sunday
      at 16:00 UTC. Orders due in next 7 days, excludes `returned`/`refunded`. One email
      per user, sorted by deadline. Zero-orders variant included. Deduped via Reminder table
      (`reminderType: "weekly_digest"`, lookback 7 days). Not `ALPHA_MODE`-gated.
      `archivedAt`/`deletedAt` filter deferred — fields don't exist yet; noted in route and BUILD.md.
- [x] **Subject-line `orderNumber` fix** — extraction prompt now reads the email subject
      for `orderNumber` (but never `retailer`). Proenza Schouler shipping email
      (subject "A shipment from order #86864 is on the way") now resolves correctly:
      `orderNumber: "86864"`, `needsReview: false`. Backfill re-extracted 5 affected
      rows; 1 fixed, 4 legitimately remain (no order number in subject or body).
      Deployed `22975f7`.
- [x] **User-facing `displayStatus` field** — `ordered` / `shipped` / `return_requested` /
      `returned` / `refunded` on Order, separate from internal `Order.status`. `shipped`
      auto-derives from `shipping_confirmation` emails + scrapes carrier tracking info
      (UPS/USPS/FedEx/DHL). Manual advancement via `PATCH /api/orders/:id/status` and
      "I'm returning this" / "Mark as returned" dashboard buttons. Status badge + filter
      on dashboard and order detail page. Never auto-downgrades a manually-advanced status.
      22 new tests. Deployed `1d00cae`.
- [x] Magic-link login fixed in production — root cause was Auth.js **v5** env var
      mismatch. Removed `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `AUTH_TRUST_HOST`
      (v5 uses `AUTH_SECRET` / `AUTH_URL`; Vercel sets trust host automatically),
      redeployed clean.
- [x] Admin onboarding view added (`app/admin/onboarding/page.tsx`) listing every
      real user's forwarding address, gated on `ADMIN_USER_EMAIL` — verified
      against live data (`e1111e3`).
- [x] Custom inbound domain piloted on one account (`mail.myreturnwindow.com`),
      verified end-to-end with a real forwarded order email before rollout
      (`83a7a15`).
- [x] Custom inbound domain rolled out to every user — old `+tag` addresses still
      work unchanged; verified live on a non-pilot account (`3eb005a`).
- [x] Extraction now falls back to htmlBody (converted to plain text) when
      textBody is empty/whitespace-only — `lib/runExtraction.ts` was sending
      Claude nothing for HTML-only forwards (e.g. iPhone/Apple Mail). Verified
      against the real Coyuchi order email (`cmqyqtb5e0001ji04u78l8ny2`): now
      extracts retailer, order number, dates, and total correctly. Backfill
      scan found no other affected rows in the current dataset.
- [x] Forwarded-header `orderDate` fallback (`lib/linkOrder.ts`) now reads the
      same `textBody`-or-`htmlText` body (shared via new `lib/emailBodyText.ts`)
      and recognizes both Gmail's and Apple Mail/iPhone's forwarded-header
      formats. Also fixed a real bug found in the process: `html-to-text`
      renders Apple's forwarded block as a blockquote (each line prefixed
      `"> "`), which the old regex never matched. Verified against the real
      Coyuchi email's actual htmlBody — correctly parses its Apple-format
      `Date:` line. Diagnosis + re-run found 0 currently-affected orders (the
      3 orders missing `orderDate` have no linked `order_confirmation` email,
      so the fallback correctly leaves them untouched); re-linking Coyuchi
      itself confirmed no regression.
- [x] Commerce gate (`lib/classify.ts`) false-negative fixed — `isCommerceEmail()`
      was using a home-rolled `stripHtml` that left `<style>`/`<head>` CSS content
      as raw text, so large retailer HTML emails (H&M 130KB) had their Haiku window
      filled with CSS boilerplate and were discarded as NOT_COMMERCE. Fixed by
      routing through `resolveBodyText()` (shared with extraction) and truncating
      the clean plain text. Confirmed via DB + DiscardLog: H&M "Your return package
      has arrived" was the single discard on record; row is absent. Deployed `ffb42be`.
- [x] Retailer-name mismatch order-linking fixed — AI extracted "Proenza" from
      the shipping email but "Proenza Schouler" from the order confirmation; exact
      retailer match failed and a duplicate Order was created. Added retailer-prefix
      fallback in `lib/linkOrder.ts` (MIN_RETAILER_PREFIX_LENGTH=4, exact order
      number required, needsReview + userNote audit log on every prefix merge).
      6 unit tests in `__tests__/linkOrder.test.ts`. Backfill merged the shipping
      email into the correct order and deleted the empty stub (`2cb5de2`).
- [x] **Approve auto-merged Proenza Schouler order in Needs Review** — confirmed
      both emails linked correctly (order confirmation + shipping), extraction data
      intact; approved via dashboard review flow.

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
