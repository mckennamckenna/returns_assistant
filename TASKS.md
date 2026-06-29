# Return Window — Task Board

> Single source of truth for what's being worked on. Claude Code reads this at the
> start of a session and updates it at the end of each task.
> Priority tags: 🔴 ship-blocker (do now) · 🟡 next · ⚪ later
> Rule: only 🔴 items get worked right now. Everything is measured against
> "does this get a real user on it today."

---

## 🔴 Now — ship-blockers
- [ ] **Mango order matching** — `F4VLSF` (order confirmation) vs `F4VLSF00`
      (ReBOUND return confirmation) create two separate Order records instead of
      linking. Fix in `lib/linkOrder.ts` with fuzzy prefix matching. *(in progress)*

## 🟡 Next
- [ ] Get **one friend** logged in and using it end-to-end (the real milestone)
- [ ] Buy domains: `returnwindow.com` (+ `closetwindow.com`, `windowshopping.com`)
- [ ] Smoke-test the full flow on production after Mango fix: sign in → forward
      an order email → see it parsed → see the return window / deadline

## ⚪ Later
- [ ] Closet Window (wardrobe intelligence) — only after Return Window has
      retention data
- [ ] Window Shopping (pre-purchase / price tracking) — same gate
- [ ] Holding-company structure ("Window") — not now

## ✅ Done
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

## ⚠️ Known issues / tech debt
<!-- Claude Code: append issues you discover here, newest first, with the file involved -->
- Order-number normalization is brittle across retailers (Mango is the first
  case; expect more retailer-specific suffix quirks).

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
