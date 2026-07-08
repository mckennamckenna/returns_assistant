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
- [ ] **Investigate unexplained extra Vercel production deployments** — found
      during 2026-07-08 session close: `vercel ls returns-assistant` shows
      several more "Ready"/Production deployments than were explicitly
      triggered via `vercel --prod` this session, including one 4 seconds
      after a docs-only git push. `vercel project inspect` confirms no Git
      Repository connection (ruling out GitHub auto-deploy), so the
      mechanism is unclear — check the Vercel dashboard directly (Settings →
      Git, Settings → Deploy Hooks) since this isn't visible via CLI.
      Production correctness isn't at risk (every deploy rebuilds whatever
      `main` legitimately contained), but the deploy model documented in
      `CLAUDE.md` ("manual, not automatic on push") may be stale.
## 🟡 Next
- [ ] **Admin notification dashboard view** — once `AdminNotification` exists
      and is being populated, add a `/admin/notifications` page (session-gated
      to owner) showing the last 50 rows sorted by `attemptedAt`, with
      color-coded `deliveryStatus` and one-click "resend failed" for any
      failed row. Cheap once the table exists; only worth it once
      notification volume warrants scrolling more than Prisma Studio's
      default view.
- [ ] **Extend self-serve email setup to non-Gmail providers** — Outlook,
      iCloud, ProtonMail each have their own filter/forward flow. Alpha is
      Gmail-only; when the first non-Gmail user shows up, revisit the setup
      page architecture to handle multiple providers cleanly rather than
      hardcoding Gmail assumptions.
- [ ] **Gmail confirmation code overwrite UX** — currently a second arriving
      code silently replaces the first; if a user has code #1 copied and code
      #2 overwrites in the UI, they may paste the stale code and see it
      rejected. If we see support requests around this in alpha, add a "newer
      code available" banner. Not urgent.
- [ ] **Carrier tracking refresh via AfterShip (tier 2)** — tier 3
      (delivery-confirmation email → deliveredAt) catches the common case.
      Tier 2 handles the edge cases: extraction pulled the wrong estimate,
      carrier updated the ETA mid-transit, delivery-confirmation email never
      arrived. Approach: AfterShip API integration ($9/month starter tier,
      ~$30-50/month at 100-1000 users), refresh on (a) user opens order detail
      page, (b) reminder cron is about to fire — not daily polling of
      everything. Trigger to build: if we see 3+ orders in a week where tier 3
      was insufficient (estimate was wrong, delivery confirmation never
      arrived, user surprised by wrong deadline). Not urgent until real usage
      data justifies it.
- [ ] **Extend signed-token actions beyond Archive** — Mark returned, Mark
      refunded, Mark kept, Unarchive. Infrastructure is live and reusable; each new
      action is roughly the shape of Phase 3+4 (endpoint + confirmation page). No
      token infra work needed. Prioritize by user need — Mark returned probably
      next since it's the most common transition. Estimate: probably 2-3 hours per
      action once you get in a rhythm.
- [ ] **Amazon: think it through as a first-class case, not a series of
      patches.** Every session so far has surfaced Amazon-specific
      adaptations: no `order_confirmation` email type (Bug 8), never provides
      purchase date (Bug 8 `receivedAt` fallback), variable formats across
      sub-brands (Fresh, Prime Video, marketplace, Whole Foods, digital),
      category-dependent return policies, refund emails without dollar
      amounts, Amazon-hosted return portals instead of retailer "start
      return" links, likely order_date vs delivery_date anchor mismatch
      (surfaced in tier 3 verification). Before adding another
      Amazon-specific patch, do a spec pass: what would it look like to
      treat Amazon as a first-class case, with its own extraction rules, its
      own policy lookup, its own reminder cadence if warranted? Output a
      written proposal (`AMAZON_HANDLING.md` in repo root) before any
      implementation. Ideally by the time we have real alpha data from users
      with a lot of Amazon volume.
- [ ] **Watching: Jul 12 Sunday digest** — verify actual scheduled fire produces
      Reminder rows. If clean, Jul 5 was likely a Vercel platform hiccup. If also
      silent, real runtime bug needing dashboard log investigation.
- [ ] **Cron failure alerting** — set up Vercel notifications so a missed cron
      invocation is discovered proactively, not by accident. Trigger for this: the
      Jul 5 digest silence was only surfaced because the owner noticed her inbox was
      quiet. Sunday check-ins probably won't scale to that discovery mechanism.
- [ ] **Sunday digest subject line + tone pass** — current subject is functional but
      generic. Owner preference is something like "What returns do you HAVE to send
      back this week — xoxo your friends at Return Window." Subject line determines
      open rate, so highest-leverage copy change on the digest. Not urgent; worth
      writing 3-5 options and picking carefully. Revisit once digest has real cadence
      with real users.
- [ ] **Zero-returns-this-week digest — rethink fallback content.** Current "nothing
      due, all caught up" wastes the touchpoint. Options: list active-but-not-due
      orders as "here's what we're watching," show recent 30-day refund wins, or skip
      the email on zero-return weeks. Under email-first every email should earn its
      place.
- [ ] **Coverage-check dedup should key off scheduled-run-week, not rolling 7-day
      lookback**, so test invocations don't perturb production cadence — currently a
      stray Jun 27 test send caused three users (owner, kathleen, alexandra) to be
      deduped from the Jul 3 real run.
- [ ] **Verify whether the coverage-check route on `?force=true` writes the Reminder
      row identically to a scheduled run** — if so, tests will keep affecting the
      schedule. Consider not writing a Reminder row on force invocations.
- [ ] **Refund verification loop** — plan is complete, spec'd in
      `REFUND_VERIFICATION_LOOP_PLAN.md` at repo root. Ready to execute. Two
      timestamps (`refundVerifiedAt`, `refundDisputedAt`), Yes/No signed-token
      buttons on check-in email, 7-day follow-up chain capped at 3 iterations.
      Blocked on nothing — priority when we return to feature work.
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
      reminders** — the returned/refunded half is now fully closed: MANGO #F4VLSF
      (`displayStatus: "returned"`, deadline Jul 5) got no deadline reminder at either
      the 1-day-out (Jul 4) or same-day (Jul 5) threshold, confirmed live in production
      (see HISTORY.md). Only the archived-with-upcoming-deadline half remains open — no
      real candidate order exists yet to test against.
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
- [ ] **Investigate duplicate Order rows for On order 101130827062601745** — two
      separate Order records with the same `orderNumber`, found while diagnosing the
      returnPortalUrl scheme bug (`lib/linkOrder.ts` matching). LinkOrder merge bug, or
      intentional? Cheap check, not urgent.

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
- [ ] **Confirmation page state** — if a user opens the same confirmation link in two
      tabs, tab A confirms, tab B still shows a confirm button that errors ambiguously
      ("already used"). Cosmetic UX polish, not a security issue. Consider a
      client-side check that pings the endpoint on mount to detect already-redeemed
      state.
- [ ] **ActionLog growth policy** — every failed verification writes a row. At current
      volume this is a non-issue; at scale it's a rate-limiting and retention
      question. Consider retention policy + rate-limiting once we have real users.
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
- [ ] **Fix backwards Gmail deep-link query on the setup page** — committed
      (`730fc36`), pushed, deployed (`dpl_A49kcwf1xRvSgwRms6DnaUhrExT9`), alias
      confirmed. `app/settings/page.tsx`'s deep link preloaded
      `to:(forwarding-address)` (zero results — nothing forwarded yet);
      replaced with a hardcoded commerce-keyword query excluding known
      pharmacy/medical senders. Encoding verified by round-tripping
      `decodeURIComponent` back to the exact original query string; parens
      forced to `%28`/`%29` via an explicit `.replace()` since
      `encodeURIComponent` leaves them literal by default. Build clean, full
      suite (181 tests) unaffected. **Awaiting owner verification**: open the
      setup page, click the deep link, confirm Gmail loads with the decoded
      commerce query preloaded and non-pharmacy results showing.
- [x] Admin notification persistence + allowlist rejection notify + auth-flow
      signup notify — every signup-adjacent event now writes a durable
      AdminNotification row and fires an admin notify email; Lauren's original
      silent-failure gap closed. Full detail in `HISTORY.md`.
- [ ] **Fix: estimated delivery dates presented as confirmed** — split
      `Order`/`Email.deliveryDate` (ambiguous — could be a carrier ETA or a
      confirmed delivery) into `estimatedDeliveryDate` (from shipping/other
      emails) and `deliveredAt` (only from an actual "delivery" email).
      `computeDeadline()` now prefers `deliveredAt` → `estimatedDeliveryDate`
      → orderDate-based guess, with the `order_date`-anchored (Amazon) path
      preserved unchanged. Reminders now suppress 1-day/same-day (not
      7-day/2-day) when `deadlineIsEstimated`, including under `?force=true`.
      UI: `DaysLeftChip` gains "(est.)"; order detail page's deadline shows
      "(estimated — based on shipping estimate)" when driven by a real
      shipping ETA, plain "(estimated)" otherwise; delivery-date fields
      (dashboard table + detail page) now show the best available date with
      an estimate caveat. 24 new/updated tests (`computeDeadline.test.ts` new
      — this function had no direct tests before; `reminders.test.ts`
      extended), full suite (182 tests) green, build clean.
      `scripts/backfill-estimated-delivery.ts` run against production
      (system-wide, not scoped to one account): 4 orders touched across 2
      users — one order-date-anchored order was correctly unaffected by
      design; three orders' past-dated estimates got flagged
      `deadlineIsEstimated: true` only, deadline left untouched, including
      the order that originally surfaced this bug — real time crossed into
      the next calendar day mid-session, so its estimate is now
      calendar-day-stale by the same rule, not a live one, so it shows the
      plain "(estimated)" caveat rather than the richer "based on shipping
      estimate" copy (that copy needs `estimatedDeliveryDate` populated,
      which only happens for still-live/future estimates). No qualifying
      live-estimate order exists in the owner's own account to browser-check
      the richer copy against — falling back to unit-test coverage for that
      specific path.
      **Reminder-suppression verified** via two disposable test orders in the
      owner's own account (deleted after use, same discipline as the Phase 5
      slice) at the 1-day threshold: confirmed-deadline order fired the
      reminder normally; estimated-deadline order was correctly suppressed,
      no email sent — both exercised via the real production decision/send
      functions, not a reimplementation. **Still awaiting**: owner's own
      browser check of the originally-reported order and a same-account
      Amazon order.
- [ ] **Self-serve Gmail forwarding setup** — committed (`2c55887`), pushed,
      deployed (`dpl_7XhxvEhxedgBWQpNwYPCY8o8NVx9`), alias confirmed. Gmail
      deep-link button + hint on the setup page; confirmation code now surfaced
      in real time via `GET /api/gmail-code` (polled every 3s, stops on code
      arrival or 15-min timeout — confirmed via curl the endpoint 401s signed
      out); "I've entered this code in Gmail" clears it via a new server
      action. Admin notify unchanged. 3 new unit tests pass, full suite (158
      tests) green, build clean. **Awaiting owner verification**: forward your
      Return Window address to a Gmail test account, walk the full flow, confirm
      the code appears within seconds and admin notify still lands.
- [ ] **Login allowlist gate added** — new `AllowedSignIn` table + `auth.ts`
      check: a magic-link email only sends if the address already has a `User`
      row (existing users never locked out) or is in `AllowedSignIn` (manually
      invited). Unapproved emails get the same "check your email" page but
      genuinely receive nothing — no enumeration leak. Seeded with 3 friend
      invites (vanessamitchener, jsweazey, aauerbuch @gmail.com). New emails
      going forward: `npx tsx scripts/addAllowedSignIn.ts <email...>`.
      Owner's own login confirmed working post-deploy. **Still awaiting**: one
      real friend (of the 3 seeded) completing sign-in end-to-end.
- [x] **Waitlist hint added to login success page** — "Didn't get anything?
      You may need an invite first — request access" now shown on both
      `/login/verify` and `LoginForm.tsx`'s inline success state, identical
      copy for approved and unapproved emails alike (no enumeration leak).
      Links to myreturnwindow.com. Owner-verified: a random unapproved email
      shows the note.
- [x] **Marketing landing page: mobile layout fixes + copy refresh** — committed
      (`54972aa`), pushed, deployed to production (`dpl_7hWP8RGB2MVMFBPR7kQnZwYEUxA8`),
      alias confirmed pointing at it. New feature copy + SMS footnote confirmed live at
      myreturnwindow.com. Restored real `/api/beta-signup` fetch wiring, loading state,
      error handling, and the working Sign in link that the source design pass had
      dropped; kept the stat band section (44%/58%/$890B) intact. Owner-verified: real
      signup test (confirmation email received), mobile viewport, Sign in link
      click-through (via the login test above).
- [x] **Signed-token infra + Archive-from-email slice — all 5 phases shipped, deployed, and owner-verified**, zero rollbacks: token core, TokenRedemption/ActionLog + issuance helper, Archive redemption endpoint, confirmation + failure-mode pages (enriched with order context), Archive link live in reminder + Sunday digest emails.
- [x] Phase 5: Archive link wired into reminder + Sunday digest email templates; verified via a disposable test order and a real reminder email, clicked through from the owner's actual inbox, no live sends to alpha users.
- [x] Phase 4: confirmation page + failure-mode pages, enriched with order context; browser-verified end-to-end including GET-safety and enriched failure pages.
- [x] Bugs 9+10+11: linkOrder fallback for orphaned refund emails; refund emails now advance status: refunded when confirmed amount extracted, returned otherwise; refundAmount field added to extraction schema — owner hand-verified in production.
- [x] Bug 8: Order date fallback to email receivedAt when extraction returns null; new orderDateEstimated flag; 3 Amazon orders backfilled — owner hand-verified in production.
- [x] Bug 7: event tickets/tours/memberships/donations/subscriptions excluded from commerce gate — Southbank Centre e-ticket stray order soft-deleted, owner hand-verified in production.
- [x] returnPortalUrl scheme normalization: fixed 2 On order rows, added normalization helper called at every write path.
- [x] Refunded-misclick fix: confirm dialog on "Mark as refunded", auto-archive on refunded (atomic), H&M order corrected — owner hand-tested and confirmed in production.
- [x] Bug 1+6: Archive/Unarchive UI made visible; deadline reminders now respect displayStatus.
- [x] Marketing homepage at myreturnwindow.com shipped with beta signup — public marketing page (host-routed, no auth), `/api/beta-signup` storing + deduping emails and notifying admin; magic-link login on app.myreturnwindow.com verified unaffected.
- [x] H&M "Your return package has arrived" re-forwarded after the classify-gate fix — owner hand-verified it landed correctly.
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
- **Duplicate "On (On-Running)" order rows** — see 🟡 Next: "Investigate duplicate Order
  rows for On order 101130827062601745."
- Order-number normalization is brittle across retailers (Mango is the first
  case; expect more retailer-specific suffix quirks).
- Retailer-name prefix matching has a known collision risk: "American" (8 chars)
  is a prefix of "American Eagle", "American Vintage", etc. — two orders from
  different "American X" retailers with the same order number would be wrongly
  merged. Accepted trade-off; every such merge is flagged needsReview + logged
  in Order.userNote (`lib/linkOrder.ts`).

## 📝 Decisions log
<!-- One line per decision so future-you and Claude Code know WHY -->
- Mark refunded is available from email, with a two-tap confirmation. This accepts
  the risk that a compromised email account could permanently archive an order in a
  state that stops all reminders. Rationale: the target user shouldn't be forced into
  the app to close a loop, and the compromised-inbox threat model already exposes worse
  actions (magic-link login gives full dashboard access). If misuse surfaces, the
  mitigation ladder is: better confirmation-page copy → require a distinct in-app
  confirmation for refunded → remove refunded from email entirely.
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
- "Refunded is never auto-derived" (the original rule) is superseded (Bugs 9+10+11):
  a refund email now auto-advances to `refunded` when it states a confirmed dollar
  amount, or only to `returned` when it doesn't. Retailer refund emails are frequently
  vague about whether the money actually moved, and catching that ambiguity is the
  product's job — trusting every refund email equally would have been the wrong call.
