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
>
> **No ✅ in Done until the user has hand-verified in production — not just tests passing.**
> Claude Code reports "awaiting user verification" instead of ✅.

---

## 🔴 Now
- [ ] **Bugs 2–5 from owner's manual-review triage** — separate sessions, not yet
      enumerated here. [needs clarification: full list]
- [ ] **Bugs 9+10+11 (combined)** — linkOrder fallback + refund-status transition.
      Shopbop and H&M refund emails are orphaned (no order number in the email —
      needs fallback: retailer + line items, retailer + total, retailer + recency).
      Lola Blankets linked but didn't advance to `refunded`. New rule (supersedes
      BUILD.md's "refunded is never auto-derived"): refund emails advance
      `displayStatus` to `refunded`, trigger the refund check-in reminder, follow
      auto-archive behavior. Design decision to confirm with owner before
      implementing.

## 🟡 Next
- [ ] **Watching: Amazon extraction quality** — Amazon is likely to be the most
      common retailer for our users and has structural quirks (no
      `order_confirmation` email type, variable formats, category-dependent
      return policies). Today's `receivedAt` fallback (Bug 8) solves the
      missing-order-date case. If Amazon orders keep showing up in
      `needsReview` or extraction quality is noticeably worse than other
      retailers after we have 10+ real users, revisit as a candidate for
      retailer-specific parsing. Don't build until real usage data justifies it.
- [ ] **"I'm keeping this" status + button** — new `displayStatus: kept` value, one-way
      transition, auto-archives on transition (like refunded), stops reminders. Appears
      as a button next to "I'm returning this" on any order still within its return
      window. Distinct from refunded (money didn't come back) and from archive (a
      terminal-state destination, not a semantic decision). Under one-tap-from-email,
      becomes the third option in reminder emails alongside "I'm returning this" and
      "Remind me later." **Data model change — spec in BUILD.md before Claude Code
      touches it.**
- [ ] **Verify in production: archived orders with upcoming deadlines don't get
      reminders** — pending real data (no order is currently both archived and has an
      active deadline). The returned/refunded half of this check was confirmed via an
      isolated pure-function test against MANGO #F4VLSF's real data (see HISTORY.md) —
      MANGO's actual deadline (Jul 5) passing over the next 48 hours with no reminder
      sent is the natural live, end-to-end confirmation of that same behavior. Only the
      archived-with-deadline case has no real candidate order yet.
- [ ] **Reconsider Archived dropdown option in SearchFilterBar** now that there are two
      dedicated entry points (Sidebar nav + Settings link, added by Bug 1 fix) — likely
      remove for clarity, but verify after Bug 1 ships. Deliberately not done in the
      same commit as the Bug 1 fix (scope control).
- [ ] **Manual UX review, remaining items** — (1) Archive/Unarchive and (2) Archived
      filter confirmed via the Bug 1 hand-test; "Mark as refunded" confirm dialog +
      auto-archive confirmed via the refunded-misclick hand-test. Still unverified: (3)
      delete button shows the confirm dialog before acting, (4) "Track your return →"
      link appears on any order where a return label was forwarded.
- [ ] **Clean up owner account test/dev data** so it reflects what a real first-time
      user would see. (Split out of the homepage item; do after homepage ships.)
- [ ] Get **one friend** logged in and using it end-to-end (the real milestone)
- [ ] Buy domains: `returnwindow.com` (+ `closetwindow.com`, `windowshopping.com`)
- [ ] Smoke-test the full flow on production after Mango fix: sign in → forward
      an order email → see it parsed → see the return window / deadline
- [ ] **Non-Amazon orders still stuck with `orderDate: null`** — Bug 8's
      backfill was deliberately scoped to Amazon only. Found while running its
      dry-run: H&M #66993117803 and Tuckernuck #TNK6772725 (both delivery-only,
      no shipping_confirmation — same root cause as the "Post-beta:
      delivery-only orders" 👀 Watching item) and Lola Blankets #1158308
      (refund-only, already tracked under Bugs 9+10+11). Same
      `applyFallbackOrderDate` fallback would likely resolve these too, but
      wasn't run against them without a separate go-ahead.
- [ ] **Move retailer-prefix merge marker off `Order.userNote`** — today's
      backfill wrote `[auto] retailer prefix match: ...` into `userNote`, which
      per Milestone 10 is the user-authored review note. If `[auto]`-prefixed
      entries accumulate, user notes become indistinguishable from system notes
      in queries and the admin dashboard. Needs a proper field or audit log.
      Spawned by `2cb5de2`.
- [ ] Archive page tidy-up — strip to essentials: archived orders + static chrome (nav,
      menus) only. No filter dropdowns, no cross-bucket counts, no nudges toward active
      orders. Archive is a quiet room, not another dashboard.
- [ ] Investigate duplicate Order rows for On order 101130827062601745. LinkOrder merge
      bug, or intentional? Cheap check, not urgent.

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
- [ ] Cost / token efficiency pass (post-beta) — Anthropic prompt caching on the
      extraction API call (biggest lever, ~1 session of work, drops input cost ~80%, no
      quality risk). Cache return policies by retailer domain (compounds with user
      growth). Move any remaining Sonnet calls that don't need Sonnet-quality to Haiku
      4.5 (audit which calls actually need extraction-grade reasoning vs.
      classification-grade). Retailer-specific template parsers for the top ~10
      retailers as short-circuit before AI extraction (higher effort, needs monitoring
      for template drift). Batch
      API for non-urgent backend work. None urgent at current volume — but revisit
      before >20 real users, or when a monthly Anthropic bill first makes you flinch.
      Prompt caching alone can be pulled forward from Someday if pre-beta AI cost
      becomes noticeable.

## ✅ Done
- [x] Bug 8: Order date fallback to email receivedAt when extraction returns null; new orderDateEstimated flag; 3 Amazon orders backfilled — owner hand-verified in production.
- [x] Bug 7: event tickets/tours/memberships/donations/subscriptions excluded from commerce gate — Southbank Centre e-ticket stray order soft-deleted, owner hand-verified in production.
- [x] returnPortalUrl scheme normalization: fixed 2 On order rows, added normalization helper called at every write path.
- [x] Refunded-misclick fix: confirm dialog on "Mark as refunded", auto-archive on refunded (atomic), H&M order corrected — owner hand-tested and confirmed in production.
- [x] Bug 1+6: Archive/Unarchive UI made visible; deadline reminders now respect displayStatus.
- [x] Marketing homepage at myreturnwindow.com shipped with beta signup — public marketing page (host-routed, no auth), `/api/beta-signup` storing + deduping emails and notifying admin; magic-link login on app.myreturnwindow.com verified unaffected.
- [x] H&M "Your return package has arrived" re-forwarded after the classify-gate fix — landed correctly.
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
- **Duplicate "On (On-Running)" order rows** — two separate Order records with the same
  `orderNumber` (`101130827062601745`), found while diagnosing the returnPortalUrl scheme
  bug (`lib/linkOrder.ts` matching). Not investigated further — out of scope for that fix.
  Worth a look: likely a linking/matching gap, not a user action.
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
- Marketing homepage host-routed at the proxy layer — `myreturnwindow.com` /
  `www.myreturnwindow.com` serve `/marketing`, `app.myreturnwindow.com` keeps the
  dashboard; host check runs before the auth check, not after.
- Archive is the general-purpose "hide, but keep, and stop emailing" primitive; refunded
  is the one manual displayStatus transition that auto-archives, atomically, in the same
  write — not via a hook/cron/subscriber. See BUILD.md's Email-first principle.
- "Mark as refunded" is the only manual status button with a confirm gate (native
  `window.confirm`, teaching-copy message) — it's irreversible in the UI and has the
  archiving side effect. "Mark as returned" and "I'm returning this" stay frictionless.
- `returnPortalUrl` is normalized (scheme prepended if missing) at every DB write point —
  belt-and-suspenders against the AI extracting a bare domain/path instead of a full URL.
- "Mark as refunded" stays gated to returned status only. Skipping to refunded from
  earlier states would bypass the returnedAt timestamp and silently kill the refund
  check-in reminder. Two clicks (returned → refunded) is the price of the reminder chain
  staying intact.
- Component testing philosophy: no jsdom / testing-library. Extract UI decision logic
  into pure functions and test those; keep the codebase's existing pure-function unit
  test shape until there's a deliberate reason to change it.
- Diagnostic-first debugging: verify the reported symptom against DB/code state before
  writing a fix. If the diagnostic contradicts the report, ask before proceeding rather
  than fixing the wrong thing. Pattern proven today by the MANGO→On mixup catch (Bug 3)
  and last session's "was Bug 1 even deployed?" catch.
