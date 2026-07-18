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
- [ ] **Fix: `isCommerceEmail()` silently discarding genuine commerce email —
      diagnostic complete 2026-07-17, root cause found, not yet fixed.** A
      real Amazon order confirmation forwarded by an alpha user never reached
      her dashboard. Vercel function logs for the window were unavailable
      (outside retention, confirmed via a failed historical range query vs. a
      working relative one — not a tooling gap). DB evidence instead: no
      `Email`/`Order` row exists for it anywhere, but a `DiscardLog`
      (`reason: "non_commerce"`) row's timestamp matches the reported
      Postmark processing time to within 17 seconds — and that code path is
      only reachable *after* Basic Auth, token resolution, and rate limiting
      all already succeeded. This refutes the original leading hypothesis
      (C1 Basic Auth rollout dead zone — the timeline argues against a 401:
      Postmark's dashboard was updated with credentials before the redeploy
      that activated the check, per the rollout's own documented ordering).
      Real cause: `lib/classify.ts`'s `isCommerceEmail()` classified a
      genuine order confirmation as non-commerce (or hit its `if (!text)
      return false` empty-body early-return before ever calling the model —
      can't distinguish between the two; the actual email content is
      unrecoverable, `DiscardLog` is deliberately content-free and no
      `Email` row means no encrypted copy exists either). Also flagging a
      real discrepancy while in this code: that early-return fails *closed*
      ("nothing to classify" → discard), contradicting the function's own
      comment two lines above it that classification errors fail *open*.
      Not fixed — diagnostic only per instruction. Needs a decision: improve
      the classifier prompt/threshold, change the empty-body case to fail
      open instead of closed, and/or surface silent commerce-discards
      somewhere reviewable (today they're anonymous by design — no way to
      know a real order was dropped without a user reporting it, as happened
      here).
- [ ] **Mobile UX audit pass — catalog complete 2026-07-17, promoted from
      🟡 Next (`mobile-ux-audit-pass`). Docs-only entry; nothing fixed yet.**
      Real-device pass, real orders, catalog-before-fixing per this item's
      original framing. Eight findings below, in the owner's priority order —
      **preserve this order**, it is the triage, not just a list. Each entry
      states what it is, severity, code location (where known), and whether
      the next step is a fix, a spec pass, or an investigation.

      **1. Bell icon alignment on bottom nav — FIXED 2026-07-17, awaiting
      owner verification on a real device.** Root cause: the badge
      (`app/BottomNav.tsx`) was correctly `position: absolute`, not a
      normal-flow sibling — but its wrapping `<span className="relative">`
      had no explicit `display`, defaulting to `inline`. An absolutely
      positioned child of a plain `inline` container is inconsistently
      handled across mobile browser layout engines, which is what surfaced
      as the icon being pushed even though nothing was a true document-flow
      sibling. Fix: wrapper changed to `className="relative inline-flex"`,
      giving it an unambiguous, size-locked containing block. No other file
      uses this badge pattern — `Sidebar.tsx`'s desktop "Alerts" badge is a
      separate, non-overlay implementation (inline pill next to text, no
      icon), unaffected by and unrelated to this fix. 359 tests still
      passing (no test coverage for this — CSS/layout, no jsdom per
      component testing philosophy), `npm run build` clean.
      **Follow-up 2026-07-17:** owner found the fix correct in Safari iOS
      but Bell still nudged relative to Home/Gear in Chrome iOS — a
      cross-browser rendering difference, not a failed fix. Root cause:
      Bell is the only icon wrapped in an extra `<span>` (Home/Gear are bare
      `<svg>` flex items); that wrapper inherits line-height with no
      explicit value, and Chrome/Safari disagree on how much of that leaks
      into the computed box height of a nested inline-flex flex item.
      Considered removing the wrapper entirely (anchor the badge to `Link`,
      which already has `relative`) so Bell's DOM matches Home/Gear exactly
      — rejected: the badge's `-top-1/-right-1.5` offsets are only valid
      measured from the icon's own tight box; `Link` is a much wider
      `flex-1` tap target with the icon centered inside it, so anchoring
      there would put the badge tens of pixels from the actual bell, and
      that distance isn't expressible as a fixed offset since it varies
      with viewport width. Applied the smaller, correct fallback instead:
      added `leading-none` to the wrapper to cancel the line-height
      inheritance directly.
      **Re-diagnosis 2026-07-17:** owner caught two Chrome-iOS screenshots,
      same session, seconds apart — misaligned with the URL bar expanded,
      correctly baselined with it collapsed. `leading-none` was the correct
      class of fix (wrapper asymmetry) but the wrong mechanism — the real
      driver is iOS's dynamic-toolbar viewport resize, not a static
      line-height leak. No `vh`/`dvh` unit exists in `BottomNav.tsx` itself,
      but its ancestor `app/(app)/layout.tsx` used `min-h-screen` (100vh,
      the classic non-dynamic unit) one level up — `position:fixed;
      bottom:0` nav bars are exactly the combination WebKit-based mobile
      browsers handle inconsistently during that toolbar animation, and
      Bell's extra nested-flex layer gives the browser more layout work to
      redo mid-resize than Home/Gear's bare, fixed-size `<svg>`. Swapped to
      `min-h-[100vh] min-h-[100dvh]` (dvh tracks the real visible viewport
      through the toolbar animation; vh stays as a fallback for Safari
      <15.4/Chrome <108) in `app/(app)/layout.tsx` — the only place inside
      the `(app)` route group declaring `min-h-screen`. `leading-none` left
      in place (harmless, avoids confounding the test). Sanity-checked
      every other `min-h-screen`/`h-screen`/`100vh` usage in the app: all
      are on separate, unrelated routes outside the `(app)` group
      (`/login`, `/login/verify`, `/privacy`, `/admin/*`, `/action/*`,
      `/marketing`) with their own independent declarations, untouched by
      this change. One adjacent-but-unaffected note: `Sidebar.tsx`'s
      desktop `<aside>` uses `h-screen` (its own direct `100vh`, not a
      percentage of the layout div's height) — same unit class, but
      desktop-only (`md:flex`) and not implicated in a mobile
      toolbar-resize bug, left alone. `npm run build` clean, 359 tests
      passing (no test coverage — CSS/layout). **Experiment, not confirmed
      — owner verifying live: scroll through the dashboard on Chrome iOS
      watching Bell through the URL-bar collapse/expand animation. If it
      stays baselined throughout, mechanism confirmed; if it still shifts,
      back to re-examining. Not Done until then.**

      **2. "This will stop all reminders" caption scoping — fix, already
      diagnosed.** Diagnosed in full in `ac173f2` (2026-07-17 diagnostic
      session): `KEPT_WARNING_CAPTION` (`lib/displayStatus.ts`) is spec'd in
      BUILD.md only for "I'm keeping this," but in `app/OrderCard.tsx` it
      renders as a sibling `<p>` after the whole button row (gated only by
      `canKeep`) rather than nested inside Keeping-it's own markup — so when
      Start return and Keeping it render side by side (the common case), it
      visually reads as captioning Start return too. **Not a behavior bug** —
      confirmed `SKIP_DISPLAY_STATUSES` in `lib/reminders.ts` deliberately
      excludes `return_requested`; Start return does not stop reminders. Fix
      is scoped: move the caption inside `OrderCard.tsx`'s `{canKeep && (...)}`
      block, matching the already-correct pattern in
      `app/(app)/orders/[id]/page.tsx`.

      **3. "..." overflow menu replacement — spec, propose don't decide.**
      `app/OrderActionsMenu.tsx` currently hides Archive and Delete (plus
      tracking links when present) behind a "⋯" button. Two
      always-available items don't justify a menu, and hiding
      destructive-only actions (Delete) behind an ambiguous affordance is the
      wrong pattern — a user has no visual cue that anything destructive
      lives there. Proposed replacement, for owner decision, not decided
      here: an explicit icon affordance (e.g. a trash-can icon with its own
      confirm step, matching `handleDelete`'s existing
      `window.confirm`) rather than a generic overflow glyph, with Archive
      surfaced as its own always-visible action rather than tucked away
      alongside a destructive one.

      **4. State-label contradictions + button hierarchy — one workstream,
      spec pass needed.** Cards can show combinations like "Kept" + "at risk"
      + a return-by date simultaneously (`app/OrderCard.tsx`'s `atRisk`
      via `isClosingSoon()`, `DisplayStatusBadge.tsx`, `DaysLeftChip.tsx` all
      render independently of each other), and primary-CTA visual weight
      shifts unpredictably between cards (two side-by-side buttons, two
      buttons with different primary treatment, one full-width button, or
      none, depending on `getVisibleActions()`'s combination for that order).
      Underlying issue: the app has no consistent notion of "the user already
      made a decision about this order" that other UI elements can defer to
      — each label/badge/button is computed independently. Needs a spec pass
      (what should suppress what, once a decision is made) before any design
      or code change. The specific "Kept + at risk" combination observed
      during this audit was a testing artifact (see note below), but the
      broader label-fighting pattern is real independent of that instance.

      **5. Quick-check (needs-review) surface doesn't explain itself — spec
      needed before design.** `app/ReviewCard.tsx` asks users to arbitrate
      between "looks correct" and "split into separate order" with no visible
      evidence supporting either option and no explanation of why the system
      isn't confident in the first place. Same root concern as the existing
      Next item about this card's missing "why" line (`TRUST_AUDIT.md` row
      6), but broader: it's not just a missing explanation string, it's that
      the whole surface asks for a judgment call without giving the
      information needed to make one. Needs a spec pass, not a copy tweak.

      **6. Order-linking — two distinct findings, do not conflate:**
      - **6a. Auto-link fails on an exact order-number match — investigation
        needed, root cause unknown.** Observed: a Shopbop quick-check card
        asked for confirmation on order #142770152 while a Shopbop
        #142770152 order already existed on the dashboard, status Kept. Same
        retailer, same exact order number — this should have auto-linked
        without a quick-check at all. Entry point to trace:
        `lib/linkOrder.ts`'s `linkEmailToOrder()` and the exact-match path it
        calls before falling through to prefix/fallback matching. Do not
        guess at a fix before finding the actual cause.
      - **6b. No order number present — design decision needed, connects to
        an existing Next item.** Refund/return emails without an order
        number can't be linked at all today. Proposal: match on item
        name/description when order number is absent. This is the same
        underlying gap as the existing `shopbop-goods-based-matching` Next
        item (`findRefundFallbackOrder()` in `lib/linkOrder.ts`, currently
        retailer + amount + recency only) — don't spec these separately;
        the confidence-threshold decision is shared.

      **7. Full-width "Mark as refunded" button on Returned cards — design
      judgment, not a bug.** `app/MarkRefundedButton.tsx`, styled full-width
      via `app/OrderCard.tsx`'s `flex-1` wrapper when it's the sole action on
      a Returned card. It's a status update the user is confirming, not a
      decision they're weighing, so primary-CTA visual weight overstates it.
      Options for a future design pass: shrink it to secondary-button
      weight, or move it into `OrderActionsMenu`. **Explicitly out of
      scope, per owner:** auto-detecting the refund from a follow-up email
      instead of a manual button.

      **8. Truncation, reconfirmed at real-device scale — not new, do not
      re-log.** Order-number and item-name overflow reconfirmed live on
      Shopbop, Loeffler Randall, On, and every Amazon card. These are the
      same findings already tracked as `TRUST_AUDIT.md` rows 7 (order-number
      + item-summary overflow), 8 (sidebar email truncation — desktop
      analog), and 14 (order-detail long-order-number wrap). This audit adds
      real-device confirmation, not new scope.

      **Cross-reference, not a fix here:** image 7 of this audit shows three
      Amazon cards in sequence with similar visual weight and truncated order
      numbers — this is the live, concrete case the existing
      `amazon-dashboard-folder-view` Next item was proposing to solve. This
      mobile pass confirms that item's premise; it does not attempt Amazon
      clustering itself.

      **Testing-artifact note, flagged not prioritized:** some observed
      contradictory states — specifically "Kept" cards also showing "at
      risk" + a return-by date — were produced by the owner manually moving
      test orders in and out of Kept during this audit, not a natural user
      path. Real (finding 4 above is still valid beyond this instance), but
      this specific combination shouldn't be treated as a live bug to chase.

      **Not in scope, flagged for separate handling:** Mango and Gap Inc.
      "Returned" cards showing "Return by —" and prompting the user to
      forward original order confirmations. Owner flagged these as edge
      cases to handle separately, not part of this workstream.
- [ ] **Decide on proposed finding C2 — no SPF/DKIM check on inbound mail
      (surfaced by the Item 3 C1 dig, 2026-07-17).** `SECURITY_AUDIT.md` now
      has a full write-up under C2 (CRITICAL, proposed, not yet accepted) —
      `PostmarkInboundPayload` has no authentication-result field and nothing
      checks sender identity; a forged-sender email to a known/leaked address
      reaches the same M2 (phishing return-portal link)/L4 (forged refund
      auto-advancing status) impact the original C1 was worried about, without
      needing to forge the webhook request at all. Needs: (1) a decision on
      whether to accept it as tracked, (2) if accepted, a real check of what
      Postmark's inbound payload actually exposes for this account (raw
      `Headers` array with `Received-SPF`/`Authentication-Results`?) — platform
      inspection, not a code question. `[needs clarification]` on priority
      relative to other Now/Next work.
      than folding it into C1.
- [ ] **returnwindow-label-anchor-uncertainty** — order detail's
      `returnWindowFromLabel()` (`app/(app)/orders/[id]/page.tsx`) defaults
      a `null`/unknown `returnWindowStartsFrom` to the label "from
      purchase," with the same certainty as a confirmed order-date policy.
      Sidekick's page reads "60 days from purchase — Web lookup" even
      though the anchor is genuinely unconfirmed — that ambiguity is
      exactly why `computeDeadline()` sets `deadlineIsEstimated: true` for
      this case. The "(est.)"/"some dates are estimated" flag communicates
      uncertainty; the "from purchase" label communicates certainty, on
      the same page, about the same fact. Not urgent enough to fix today,
      but it's the visible follow-up to sidekick-deadline-anchor-mismatch
      (just shipped), not backlog.
- [ ] **Security cleanse (queued 2026-07-14, tomorrow's priority)** — full
      pass, prep for a more public-facing alpha: env vars, auth, API
      routes, input validation, rate limiting, data exposure. Not started
      tonight. The inbound webhook auth rollout (completed `d5772a8`,
      2026-07-15) is directly relevant context to start from — its
      findings inform this cleanse, not blocking work.
- [ ] **archive-button-styling-mismatch** — order detail's "Archive" button
      renders as bare text with no border, while "Keeping it" (outlined),
      "Track package" (outlined), and "Mark as returned" (filled black) all
      render as proper buttons. Owner screenshots 2026-07-15 confirm this
      on Shopbop (Return requested state) and Poshmark (Kept state). Fix:
      Archive should be an outlined button matching "Keeping it" — same
      shape, same weight. Applies to the order detail page; worth checking
      dashboard card overflow menus too during the fix, in case the same
      pattern recurs there. Directly violates the owner's stated hierarchy
      rule (see Decisions log): "one black button is fine as long as the
      others look like buttons and are equal." Surfaced as the leftover
      piece of Follow-up polish's item 3 (hierarchy) after items 1-2
      verified live and the MarkRefundedButton judgment call was confirmed
      correct.
- [ ] **Retailer logo coverage test — investigation only, both passes now run
      live against Logo.dev.** Domain pass (real observed sender domains):
      15/15 hit, but 1 (Gap Inc. → optiturn.com) confirmed wrong-company logo.
      Name pass (retailers with no domain): 20/22 hit, 2 confirmed wrong
      (NET-A-PORTER, Sidekick), 4 unverified generic marks. Quality-adjusted:
      78.3% of order volume gets a confidently-correct logo, not the 93.5%
      raw hit rate. See `LOGO_COVERAGE.md` for full breakdown + recommendation
      (2026-07-13). `LOGO_DEV_PUBLISHABLE_KEY` added to gitignored `.env.local`
      only — not committed, not in Vercel. No code/schema/UI changes, no
      commits.
- [ ] **Auto-archive after missed window — pushed (`a7af7df`), auto-deployed.** Nightly
      cron sweep, silent (no email/Reminder/ActionLog row), 14+ days past
      `returnDeadline`, scoped to `ordered`/`shipped`/`return_requested` (deliberately
      excludes `returned` — already user-acted, tracked separately by refund
      check-in; `refunded`/`kept` never candidates since both already auto-archive on
      their own manual transitions). `returnDeadline: null` excluded automatically by
      Prisma's `lte` filter, no explicit guard. New `lib/autoArchive.ts`
      (`AUTO_ARCHIVE_GRACE_DAYS`, `autoArchiveCutoff()`, `autoArchiveOrderWhere()`,
      pure/unit-tested) + one new step in `app/api/cron/route.ts` right after the
      existing hard-delete sweep, `autoArchived` count added to the route's JSON
      summary, no new `vercel.json` cron entry. 9 new tests
      (`__tests__/autoArchive.test.ts`, mirrors `archiveDelete.test.ts`'s pattern),
      221 total passing; `npm run build` clean. Separate commit from "Mark kept" —
      can't be hand-verified until real orders miss their windows in production, so
      no reason to bundle it into an earlier deploy. Deployed but still can't be
      browser-verified — a pre-push read-only query found 0 currently-eligible
      orders; verification here means watching a future scheduled cron run's
      `autoArchived` count once a real order ages past the grace period.
- [ ] **Verify brother's Gmail forwarding filter is actually built and forwarding** —
      as of session close he had verified his Return Window forwarding address
      with Google, but not confirmed to have (a) opened the deep link successfully,
      (b) built the Gmail filter using the preloaded commerce query, or (c) had
      any commerce email actually forward through. Poll him tomorrow; if he
      responds, log verbatim what he did. Step 5 UX is still unverified for
      any non-owner user.

## 🟡 Next
- [ ] **"This will stop all reminders" caption is misleading on the dashboard
      card when Start return is also visible — diagnostic completed 2026-07-17,
      confirmed copy bug, not a behavior bug.** Traced `Start return` end to
      end: `StartReturnButton` → `markReturnRequestedAction` →
      `advanceDisplayStatus(orderId, "return_requested")` →
      `buildStatusTransitionData` sets **only** `{ displayStatus:
      "return_requested" }` — no `archivedAt`, no other flag. The reminder
      pipeline's `SKIP_DISPLAY_STATUSES` (`lib/reminders.ts`) deliberately
      excludes `return_requested`, with an explicit comment: "the window is
      still open and the package may not have shipped yet, so the reminder
      still matters." (The only thing that actually stops reminders is the
      separate `order.status === "return_started"`, set by
      `computeOrderStatus()` only when a real `return_label` email is linked —
      unrelated to the manual button.) So **Start return does not stop
      reminders — confirmed correct, working as designed.**
      `KEPT_WARNING_CAPTION` (`lib/displayStatus.ts`) was spec'd in BUILD.md's
      "Add Mark kept" milestone explicitly and only for "I'm keeping this," in
      all three surfaces (card, list/table, detail) — never scoped to Start
      return in any spec or Decisions log entry. On the order detail page it's
      correctly nested inside Keeping-it's own `<form>`, unambiguous. On the
      **dashboard card** (`OrderCard.tsx`), it's rendered as a sibling `<p>`
      below the *entire* button row rather than scoped inside Keeping-it's own
      markup — so on the common case where an order is `ordered`/`shipped`
      rank (both `canStartReturn` and `canKeep` true), it visually reads as
      captioning both buttons even though it's gated only by `canKeep`.
      Proposed fix (not applied — report-only diagnostic): move the caption
      inside `OrderCard.tsx`'s `{canKeep && (...)}` block, matching the detail
      page's already-correct scoping.
- [ ] **`vitest-nextauth-import-fragility` needs its own investigation** —
      promoted from Known Issues 2026-07-17 per its own stated graduation
      criteria ("if a third instance shows up, it graduates from 'pre-existing
      fragility, work around it' to 'test setup needs its own investigation'").
      Root cause: `next-auth`'s entry point transitively imports `next/server`
      (via `next-auth/lib/env.js`), which only resolves inside Next.js's own
      bundler, not plain Node/vitest ESM resolution — so importing `auth.ts`,
      or even bare `"next-auth"`, fails under vitest. Three decisions shaped by
      working around it so far, without ever fixing it: (1) H1 Phase 3
      (2026-07-16, `903a9eb`) — extracted `auth.ts`'s rate-limit-plus-allowlist
      logic into `lib/magicLinkRateLimit.ts`, sourced `AuthError` from
      `@auth/core/errors` directly. (2) M1's fix (2026-07-17, `505c7fb`) — test
      strategy for the BCC removal was built entirely against
      `lib/magicLinkRateLimit.ts`, never `auth.ts`, specifically because of this
      constraint. (3) The L5 nodemailer-override guard (2026-07-17, proposed
      below, not yet built) — every guard option had to be evaluated against
      "does this survive vitest-nextauth-import-fragility," which ruled out the
      simplest approaches (a standalone script importing `auth.ts` directly)
      and pushed toward a boot-time runtime assertion instead. Not investigated
      this session per explicit instruction — tracked here so the next session
      that touches auth-adjacent testing picks it up instead of re-discovering
      it. Candidate directions to evaluate when picked up: a vitest alias/mock
      for `next/server`, or a documented, explicit pattern for what's safe to
      import directly in a test vs. what needs extraction to a
      `lib/`-level module first.
- [ ] **Guard against L5's nodemailer-override regressing silently** — proposed
      2026-07-17, not built (see `SECURITY_AUDIT.md` L5(d) and `BUILD.md`'s
      Security invariants for the full context: L5's LOW rating depends
      entirely on `auth.ts`'s custom `sendVerificationRequest` continuing to
      override `@auth/core`'s default, which calls nodemailer's vulnerable
      `createTransport`/`sendMail` directly; nothing currently enforces that,
      and two unrelated commits already touched that exact function). Two
      complementary options evaluated, both feasible without importing
      `auth.ts` under vitest (see `vitest-nextauth-import-fragility` above for
      why that constraint matters):
      1. **Boot-time runtime assertion in `auth.ts`.** After constructing the
         `Nodemailer` provider, assert its `sendVerificationRequest` is
         reference-equal to the one imported from `lib/magicLinkRateLimit.ts`;
         throw (fail loud at boot, same pattern as the existing
         `TOKEN_SIGNING_SECRET` length check) if not. Runs for real on every
         dev/production boot, inside the actual Next.js runtime where
         `next-auth` imports fine — no vitest involvement at all. Catches: the
         override being removed or swapped out. Does not catch: the override
         staying wired but its own implementation being changed to call
         nodemailer directly.
      2. **ESLint rule banning direct `nodemailer` imports** outside an
         explicit allowlist (or banning it outright — no file in this repo
         currently imports `nodemailer` directly, confirmed by grep). Static,
         zero runtime cost, runs at lint/CI time, doesn't touch vitest/next-auth
         resolution at all. Catches: any new code (this file or a future one)
         importing `nodemailer` directly. Does not catch: the override being
         removed entirely, since that reactivates `@auth/core`'s own
         already-installed default without any new import in our code.
      **Recommendation:** both together, not either alone — they guard against
      the two different realistic mutation vectors (wiring removed vs. new
      usage added) and neither is expensive. A third option (wrapping/spying on
      nodemailer's own `createTransport` as an in-process canary) was considered
      and set aside as more invasive for the same coverage as option 1.
      Proposed only — awaiting a decision on whether/which to build.
- [ ] **Amazon: reminder for every email, not just the deadline-driven
      schedule** — Amazon orders are high-volume and frequently multi-item;
      users need to know about each individual email because linking is
      fragile and refunds/partial-shipments are common. Currently the
      reminder pipeline treats Amazon like any other retailer — same
      deadline-threshold schedule (7/2/1/same-day), no per-email touchpoint.
      Open design question: does this become a retailer-policy-DB flag
      (per-retailer reminder cadence), or an Amazon-specific branch in
      `lib/reminders.ts`? Needs a spec pass before code. Slug:
      `amazon-per-email-reminder-cadence`.
- [ ] **Amazon dashboard card as folder, not single order** — Amazon orders
      fan out into many shipments and often several "orders" that are
      really one shopping session, and the current card-per-order treatment
      makes the Amazon section of the dashboard chaotic. Proposal: collapse
      Amazon into a single folder-style card that expands to show the
      underlying orders. Open design question: does this generalize to
      other high-volume retailers (Poshmark maybe), or stay Amazon-only?
      Related to the Gap Inc. brand-family item already in this section.
      Slug: `amazon-dashboard-folder-view`.
- [ ] **PROMOTED to 🔴 Now 2026-07-17 — see Now section.** Slug:
      `mobile-ux-audit-pass`.
- [ ] **Mobile: order-number + item-summary line overflows on narrow widths** —
      e.g. Poshmark's row shows `#6a4d94…748a · M...`, the item name truncated
      to near-nothing after the (already-shortened) order number eats the
      line. Surfaced by 2026-07-13 trust audit (`TRUST_AUDIT.md` row 7), not
      in the six-item Phase 2 scope. Proposed fix: drop item summary from
      this line at narrow widths, or stack the two on separate lines below
      ~480px.
- [ ] **Sidebar account email truncates with no `title` fallback** — e.g.
      `mckenna.sweazey@g…`, no way to see the full address without editing
      the DOM. Surfaced by trust audit (`TRUST_AUDIT.md` row 8), not in
      today's six-item scope. Proposed fix: add a `title` attribute, same
      pattern as the order-number display fix.
- [ ] **"Unlinked emails" section shows a raw tracking-style URL in the body
      preview** — e.g. `click.mkt.isdnn.com/...` visible in a forwarded
      promotional email's preview text, reads as spam/phishing leaking into
      the app's own UI. Surfaced by trust audit (`TRUST_AUDIT.md` row 12),
      not in today's scope. Proposed fix: strip/hide raw URLs from the
      preview snippet before display.
- [ ] **Order detail page: long order number wraps awkwardly on mobile** —
      24-char Poshmark-style numbers wrap across 3 lines with the Copy
      button sitting mid-wrap rather than below the value. Cosmetic only,
      not broken. Surfaced by trust audit (`TRUST_AUDIT.md` row 14).
      Proposed fix: stack Copy button below the value at narrow widths.
- [ ] **Bare "Delivery date —" / "Return by — (est.)" renders with zero
      explanatory context** when the field is simply not yet known — could
      read as "the app failed to fetch this" rather than "we don't have a
      delivery email yet, that's normal." Surfaced by trust audit
      (`TRUST_AUDIT.md` row 15), not in today's scope. Proposed fix: a short
      inline hint on the fields most central to the app's promise.
- [ ] **Retailer logos** — `RetailerAvatar` currently shows initials only
      (deliberately, per Commit 2: "logo integration is a separate future
      task"). Needs a logo source/lookup strategy — not spec'd yet.
- [ ] **orderDate-fallback Phase 3** — verify UI behavior with a null-orderDate
      order (5-min eyeball, likely no code needed per Phase 1's finding that
      null orderDate already renders as "—" correctly). Phase 4 backfill is
      done (2026-07-10, see HISTORY.md) and provided the excluded-side
      verification of Phase 2 via before/after diff; this eyeball check on
      one of the 5 now-null-orderDate rows (e.g. Mango #F4VLSG00 or Moda
      Operandi #456603272478) is the one remaining piece.
- [ ] **Gap Inc. brand-family identity** — Gap orders also surface under Old
      Navy; one parent (Gap / Old Navy / Banana Republic / Athleta) spans
      multiple brands with inconsistent attribution. Candidate for a
      first-class fix like the Amazon case; connects to the retailer-prefix
      collision risk in Known Issues and the retailer-policy DB. Evidence:
      Gap #1R1KXD3 listed under Old Navy. Slug: `gap-inc-brand-family-identity`.
- [ ] **Shopbop / refund matching on goods when no order number** — Shopbop's
      refund email names the item but has no order number.
      `findRefundFallbackOrder()` matches on retailer + amount + recency
      today; investigate adding line-item/goods-description as another
      signal. Needs real investigation, not a quick patch. Slug:
      `shopbop-goods-based-matching`.
- [ ] **Diagnose Gmail deep-link URL construction bug** — 2/2 non-owner
      test users (mom, then brother) whose filters matched their entire
      inbox instead of the intended commerce search, forwarding personal
      email into Return Window's extraction pipeline. Byte-identical URL to
      the owner's own (which works correctly) — not a "user followed
      instructions wrong" case. Deep debugging is high-cost without ability
      to instrument the browser. Root cause suspected: search query not
      carrying through the URL to Gmail. **2026-07-13: the button itself
      removed from Settings** (see Known Issues) as an immediate stopgap —
      this item is now purely about the underlying fix. When fixed and
      verified against a third non-owner account (using the
      filter-matches-everything monitoring alert — being built in a
      separate session, per owner — as the verification signal: no alert
      firing = fix confirmed), re-introduce the button + explanatory copy at
      `settings/page.tsx` (previously at lines 22-24 and 45-56 pre-removal —
      reference commit `3658947` — the removal commit — to see the original
      implementation via `git show 3658947^:app/\(app\)/settings/page.tsx`).
      Real evidence supporting OAuth prioritization as the eventual real fix.
      Slug: `gmail-deeplink-cross-account-parsing`.
- [ ] **Surface delivery date as first-class dashboard info** — currently
      `estimatedDeliveryDate`, `deliveredAt`, `deliveryDate` drive deadline
      computation and are extracted from emails, but the user-facing
      dashboard shows them inconsistently and often as "—" even when data
      exists. Retailer emails (e.g. an Amazon "Arriving tomorrow" window, a
      J.Crew "Delivered on or before [date]" line) prominently feature
      delivery info; users forwarding those emails expect Return Window to
      show delivery info equally prominently. Real evidence: today's
      Amazon and J.Crew tests (2026-07-09), both retailers surface
      delivery-date info prominently in their own emails. Design question:
      how does this affect product positioning — is Return Window primarily
      a return-deadline reminder, or a full purchase-tracking dashboard?
      Also: dashboard shows "—" for orders where estimatedDeliveryDate
      exists, suggesting a display bug on top of the design question. Slug:
      `delivery-date-first-class-surface`.
- [ ] **Final sale / non-returnable items handling** — surfaced today by a
      J.Crew order. Return Window currently treats return eligibility as an
      order-level concept (returnWindowDays, returnDeadline). Real-world
      retail has two failure modes: (1) entire order is final sale — some
      clearance/sample-sale purchases have no returns at all; product should
      surface "No returns" and skip reminder pipeline entirely; (2) mixed
      order — most items returnable but specific items marked final sale,
      monogrammed, personalized, altered, or otherwise excluded. Schema
      change needed for per-line-item return eligibility. J.Crew's returns
      page explicitly enumerates the exclusion categories (the AI captured
      this in extractionNotes). Also connects to the retailer policy
      database work — per-retailer exclusion category list is worth
      curating. Priority: medium — this is a core promise of the product
      ("when can I return this?"), and the answer "never" is legitimate.
      Slug: `final-sale-nonreturnable-handling`.
- [ ] **Admin order detail panel conflates AI-extraction values with Order
      row values** — the "Extracted data" panel on the admin order detail
      page shows fields as they came from `extractionRaw` (what the AI
      found). But the Order row itself may have different values after
      linking and fallback logic runs — e.g., an Amazon order_confirmation
      where AI extraction returned `orderDate: null` but
      `applyFallbackOrderDate` populated the Order's `orderDate` from
      `receivedAt`. Currently both cases display "ORDER DATE: —" identically,
      hiding the fallback provenance. Suggests either (a) two separate panels
      showing "extraction result" and "final Order state" side by side, or
      (b) surfacing fallback provenance inline ("Order date: Jul 9, 2026
      (inferred from email receivedAt)"). Real evidence: today's Phase 2
      verification confusion — both PM and coordinating-Claude misread the
      extraction panel as "current state of the Order." Slug:
      `admin-extraction-vs-order-panel-conflation`.
- [ ] **Runtime validation on the AI's extraction JSON response** — `lib/extract.ts`
      currently does `JSON.parse(...) as RawExtraction`/`as PolicyLookupResult`
      with no runtime schema check. Was low-stakes when every field was
      informational; now that `needsReview` is behavior-critical, a silently
      omitted field degrades to falsy rather than being caught or logged.
      Add real validation (e.g. zod) at the parse boundary. Slug:
      `extraction-runtime-validation`.
- [ ] **User notification policy for data corrections** — surfaced by
      Caroline's Moda backfill: her return deadline moved from Aug 13 to
      Jul 28 (a real, meaningful shift) via a one-off admin backfill, and she
      wasn't notified. Judgment call this time was "return already in-flight,
      correction affects no future action she'll take" — but that reasoning
      was ad hoc, not policy. Needs a real decision: when a backend
      correction changes a user-facing fact (deadline, status, amount), what
      triggers a notification vs. silent correction? Matters more as backfills
      become more routine.
- [ ] **`orderDate` column on admin dashboard user
      detail table** — small, clean addition; deferred out of admin dashboard
      v1.1. Not urgent since order date is already visible on the order
      detail page.
- [ ] **Retailer policy database** — NOT tomorrow, needs its own session — for
      high-volume retailers where we can
      justify curation (Moda, Shopbop, Nordstrom, J.Crew, Amazon, and the next
      ~15-25), maintain a known-good record of return policy: window(s), tiering
      conditions, refund vs. store credit windows, return portal URL, sale-item
      exclusions, anchor (order date vs. delivery date). Extraction priority
      becomes: retailer-known-policy → email → web_lookup → guess. Deeply
      entangled with the tiered-policy schema work below (likely one shared
      schema, one shared spec pass). Highest-quality trust upgrade for extraction
      and the most complete answer to WNU-class stale-URL bugs. Data-model
      change + governance question (audit cadence, ownership). Spec in BUILD.md
      before Claude Code touches it. Real evidence: Moda + Shopbop both surfaced
      today from a single walkthrough.
- [ ] **Stale return-portal URLs from web_lookup — trust-tier the field** — WNU's
      `returnsportal.co` URL was extracted from web_lookup and is a defunct
      provider (redirects to Swap Commerce, acquired). AI-extracted portal URLs
      can be stale from indexed-but-outdated sources. Proposal: low-confidence
      `returnPortalUrl` values surface as "Start return at [retailer]" linking
      to retailer's own returns landing page rather than the direct portal.
      Bigger UX change than a prompt tweak. May become largely moot for
      high-volume retailers once retailer policy DB ships (curated URLs). Real
      evidence: WNU on Caroline's dashboard. Slug:
      `returnportal-trust-tier`.
- [ ] **Setup-page copy: warn about stale Gmail confirmation codes** — dashboard
      currently displays whatever code arrived last; if user comes back to setup
      page hours later, the displayed code may already be Gmail-expired (Google
      typically ~24hr). Add: arrival timestamp ("received 47 minutes ago"), plus
      "request a new code" affordance if it's more than an hour old.
      Independent of the auto-email-code feature; either could ship alone. Slug:
      `gmail-code-staleness-copy`.
- [ ] **Admin dashboard: consolidate `lib/inboundAddress.ts` with webhook's
      address-resolution** — currently parallel implementations of the same
      forwarding-address→user logic. Deliberate at build time (mirrored rather
      than reused because the webhook parses a payload object and the admin
      path parses a route-param string), but drift risk if either changes and
      the other doesn't. Extract to a shared helper.
- [ ] **Admin dashboard: decide fate of `/admin/onboarding`** — overlaps with
      new `/admin/users` list view. Either replace, or clarify distinct
      purposes. Follow-up after owner uses new surface for a few days.
- [ ] **Admin dashboard: email content decrypt/reveal path** — deliberately
      deferred from initial build. Track "needed email body" cases this week
      (running list in a note); revisit if pattern emerges. If it does emerge,
      must be built with sanitized server logs — decrypting to a rendered page
      means plaintext hits logs unless careful.
- [ ] **Admin dashboard: inline review-flag surface** — during dashboard
      walkthroughs, tag issues in-place with category enum (tiered-policy /
      fallback-wrong / trust-erosion-visible / extraction-quality / other) +
      free-text note. Query view for triage. Blocked on: second walkthrough to
      validate categories. Real evidence: today's walkthrough required
      copy-paste-to-Claude workflow; would have been meaningfully faster with
      in-app flagging.
- [ ] **Gmail deep link Step 5 UX pass** — query preload fixed today. Still
      open: how the setup page explains what users do with the search results
      (filter icon → create filter → forward to X), what happens when their
      inbox has no matching emails, whether we show the raw query string,
      whether users can edit it. Real evidence pending: brother's data
      inconclusive; poll again.
- [ ] **Post-walkthrough observation: three of four alpha users surfaced no
      substantive extraction issues** — good baseline signal, but "no issues
      found" ≠ "no issues exist"; walkthrough was skim for obvious wrongness,
      not deep audit. Consider a deeper pass on one user (probably owner's
      own account with the most volume) when there's a specific class of bug
      to hunt for. Not urgent.
- [ ] **Post-walkthrough observation: Caroline is forwarding manually without a
      filter yet** — her data shape is skewed by this (return-label emails
      creating orders, no shipping confirmations linked, every deadline
      estimated). Once she runs the Gmail filter, dashboard should re-populate
      with proper shipping/delivery emails and many "estimated" flags should
      resolve on their own. Worth re-walking Caroline's dashboard *after* she
      sets up the filter, as a check.
- [ ] **Tiered return policies + store credit tracking** — NOT tomorrow, needs
      its own session — data model change; spec in `BUILD.md` first, before
      any implementation. Entangled with the retailer policy database work
      above (likely one shared schema, one shared spec pass).
- [ ] **Admin dashboard follow-ups** — open questions after the new
      `/admin/users` surface has been used for a day: replace `/admin/
      onboarding` (now overlapping), add an email-content-reveal path if
      actually needed, add mutation actions (e.g. resend reminder). All
      deliberately deferred, not decided.
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
- [ ] **Extraction: infer `orderTotal` from `refundAmount` + line items** — when
      the AI has high-confidence line item prices and a refund amount but not an
      original order total, it currently leaves `orderTotal: null`. Prompt-quality
      improvement: allow inference when the data supports it. Low priority.
- [ ] **Extraction: verify AI source attributions in notes** — WNU's extraction
      claimed `returnsportal.co/r/withnothingunderneath` was found on WNU's
      international returns page. Manual check suggests the URL doesn't appear
      there at all; possibly the AI hallucinated the source attribution. Open
      question because it affects how much we trust `extractionNotes` as diagnostic
      data. Small research task.
- [ ] **Broader onboarding audit: where else do we assume the user is in our
      dashboard when they aren't?** — surfaced today by the Gmail confirmation code
      discussion. Any setup step where the user's mental context isn't our app
      should probably have an email touchpoint by default, because that's where
      their attention actually is.
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
- [ ] **Coordinating-Claude in-session task capture** — currently the running
      list of "add to TASKS.md" items lives in prose in coordinating-Claude's
      messages, which is error-prone across long sessions. Explore whether
      Claude Code can be given a "working notes" file it appends to during a
      session, and whether coordinating-Claude can reliably read/write it.
      Alternative: shorter sessions with more frequent TASKS.md commits.
- [ ] **Shipping-email template uniformity hypothesis** — owner intuition
      (2026-07-09): `shipping_confirmation` emails likely have less template
      variety across retailers than `order_confirmation` emails. If true, has
      implications for Gmail filter design (bias filter toward shipping-side
      keywords) and for retailer policy DB coverage strategy. Test: sample
      30-50 shipping emails across retailers, look at structural similarity
      metric. Not urgent.
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
- [x] **C1 dig completed 2026-07-17 (analysis only, no code)** — tested the audit's
      "rotate to high entropy" premise instead of assuming it. Verified the CUID
      v1 algorithm against Prisma's actual generator source (no `cuid` package —
      Prisma's built-in default). Quantified real entropy: ~41 bits from the
      random block only (timestamp/counter/fingerprint are inferable or
      near-deterministic, not secret) — ≈2.8×10¹² possible values, ≈220 billion
      guesses expected to hit any of 13 live tokens even in the attacker-best
      case, with no guessing oracle. Conclusion: entropy rotation is likely the
      wrong remaining fix — recommended killing it as priority. Real gap:
      confirmed (not assumed) that no SPF/DKIM/sender-authentication check
      exists anywhere in the inbound path — proposed as new finding **C2**
      (CRITICAL, not yet accepted) rather than folded into C1. C1 itself now
      documented as 3-of-4 resolved. Full write-up in `SECURITY_AUDIT.md`'s
      C1/C2 entries — see 🔴 Now for the resulting decision needed.
- [x] **L5 re-rated 2026-07-17 (docs-only, no code change)** — `SECURITY_AUDIT.md`'s
      "runtime deps came back clean" claim was false; `nodemailer` (direct
      dependency) carries a HIGH advisory. No clean upgrade exists (next-auth's
      beta pin caps it at `^7.0.7`, and 7.x was never patched). Confirmed via
      source-level trace, not the code comment, that the vulnerable
      `createTransport`/`sendMail` path is unreachable — our own
      `sendVerificationRequest` override replaces it before any request is
      handled. Re-rated LOW but flagged as a fragile LOW, not closed outright —
      revisit alongside the next-auth-stable upgrade (L6). Full detail in
      SECURITY_AUDIT.md's L5 entry itself (small enough not to duplicate into
      HISTORY.md).
- [x] **M1 fixed and owner-verified live 2026-07-17** — sign-in email no longer
      BCCs the admin with a live magic link; separate link-free admin
      notification confirmed working, second allowlisted user's sign-in
      confirmed no email reached the admin mailbox. `SECURITY_AUDIT.md` M1
      closed. Full detail in HISTORY.md.
- [x] **Security status reconciliation — diagnostic only, no fixes (2026-07-17).**
      Full read against `SECURITY_AUDIT.md`/TASKS.md/live code, reported in-session
      (not a written artifact). Findings: C1 was 3-of-4 remediated (webhook auth ✅,
      token/secret separation ✅, rate limit ✅ via H1, entropy rotation ❌ open) —
      TASKS.md's Done-section note overclaimed full resolution, the audit doc's
      `⚠︎ C1` marker underclaimed by not crediting the 3 done parts. M1 was open
      and untracked anywhere in TASKS.md, silently relocated (not fixed) from
      `auth.ts` to `lib/magicLinkRateLimit.ts:121` by the unrelated H1 Phase 3
      refactor (`903a9eb`). M2/M3/M4/L1/L2/L3/L4/L6 all confirmed unchanged since
      the audit was written, none tracked in TASKS.md anywhere. L5's "runtime deps
      came back clean" claim was contradicted by `npm audit --omit=dev`: `nodemailer`
      is a direct dependency with a HIGH-severity advisory. This report is the
      source that spawned the three-item security work above/below.
- [x] **H1 rate limiting shipped and owner-verified live across all three
      public endpoints** — `/api/inbound` (30/hr per token), `/api/beta-signup`
      (3/hr per IP, plus per-email admin-notification dedup), and magic-link
      send (8/hr per email AND 20/hr per IP, loud user-facing message on
      block). `SECURITY_AUDIT.md`'s H1 finding closed. Full detail (three
      phases, three sets of limits, three product decisions, an IP-threading
      finding, and a vitest/next-auth import workaround) in HISTORY.md.
- [x] **Desktop visual polish — Phase 2, all six items owner-verified live.**
      All six items from TRUST_AUDIT.md applied in one commit: (1)
      avatar-initials bug fix ("On (On-Running)" → "OO", no longer "O("),
      (2) order detail action buttons migrated to `lib/orderActions.ts`'s
      shared `getVisibleActions()` — same function OrderCard calls, so
      list/detail can't drift apart again; detail page now reuses
      `StartReturnButton` and the ink/border button styling instead of its
      own unmigrated blue/yellow/green set, (3) "(est.)" deduplication —
      dashboard card down to one indicator, detail page replaces 3
      per-field suffixes with one "Some dates on this order are estimated"
      note, (4) `--color-accent` darkened `#9a7a45` → `#7a5c2e` (measured
      ~3.6:1 → ~5.2–6.2:1 across all three real backgrounds it's used
      against, clears WCAG AA), (5) content column 640px → 860px (dashboard
      + alerts), greeting 30/38px → 24/26px, sidebar active-item indicator
      no longer renders as a curved bracket, needs-review card gets a
      2-column layout at md+ plus a specific why-line (`reviewReasonLabel`
      now parses the `[auto]` retailer-prefix-merge note instead of falling
      through to a generic message), (6) summary card names the retailer
      when exactly one order is due. 23 new tests (`orderActions`,
      `orderReview`, `retailerAvatar`), 298 total passing; `npm run build`
      clean. Committed (`cc99f33`), pushed, auto-deployed
      (`dpl_E7hmoUunv3tq7pnGwr9pTkGqxsat`, confirmed Ready and aliased to
      `app.myreturnwindow.com` within ~3s of push). Four trust-audit
      findings outside this scope logged separately, not dropped. **Owner
      confirmed all six items live 2026-07-15** ("item B all landed").
- [x] **"I'm keeping this" and Archive both work correctly live** — owner
      clicked Mark kept on a Poshmark order (moved to Kept) and Archive on
      a Shopbop order (moved to Archive), both confirmed in production
      2026-07-15. Full detail in HISTORY.md.
- [x] **Order detail's Track-package/Track-your-return buttons and the
      order-number Copy button both confirmed working live** — owner
      verified 2026-07-15. Full detail in HISTORY.md.
- [x] **Docs-only bookkeeping (2026-07-15)** — moved
      sidekick-deadline-anchor-mismatch to Done, full detail to HISTORY.md;
      promoted the `returnWindowFromLabel()` observation from Known Issues
      to Now. No code changes.
- [x] **Sidekick's return deadline now shows the correct date** — fixed an
      ambiguous-policy anchor bug plus tightened the shipping-estimate
      buffer; owner-verified live 2026-07-15. Full detail in HISTORY.md.
- [x] **Inbound webhook now requires HTTP Basic Auth; flood alert live** —
      Postmark hardening rollout complete, verified live (401 without
      credentials, normal 200 with them). Also resolves security-audit
      finding C1. Full detail in HISTORY.md.
- [x] **Docs-only board cleanup (2026-07-15)** — moved Gmail deep-link removal
      to Done, dropped the stale "greenlit as Now item" clause from Follow-up
      polish, stripped stale `[TOMORROW #2]`/`[TOMORROW #3]` tags from Next,
      and clarified CLAUDE.md's "DONE MEANS DEPLOYED" wording for docs-only
      changes. No code changes.
- [x] **Gmail deep-link filter-setup button removed from Settings** — owner
      hand-verified live in production 2026-07-15. Full detail in HISTORY.md.
- [x] **Dashboard row density ("desktop OrderCard cleanup") — 4-line
      desktop layout.** `OrderCard.tsx` renders two parallel blocks sharing
      identical underlying data/logic — mobile (`md:hidden`) keeps the
      exact original 5-line stacked layout; desktop (`hidden md:block`)
      merges retailer+order# onto L1 (status pill + days-left pill at the
      right) and gives item description its own full-width
      single-line-truncate row (L2), down from 5 lines to 4. Verified live
      against all four named worst-case rows (Poshmark pill-clash, 193-char
      Amazon description, Loeffler Randall longest retailer, mobile) in a
      disposable browser session. Committed (`b3d1d26`), pushed,
      auto-deployed (`dpl_G4iETqE59TU6LKBRteAr9Hv5hXKd`, confirmed Ready
      and aliased). **Marked Done per owner closeout instruction
      2026-07-14** — noting for the record this reflects the owner's
      explicit session-closeout call, not a separately-witnessed browser
      verification beyond the disposable-session check above.
- [x] **RESOLVED 2026-07-14: Vercel auto-deploy mechanism confirmed —
      `mckennamckenna/returns_assistant` is connected to this Vercel project
      via the GitHub integration (connected 2026-06-21).** Every push to
      `main` triggers a production deploy on its own, including docs-only
      commits — this is standard GitHub-integration auto-deploy, not some
      other unexplained trigger. `CLAUDE.md`'s deploy section corrected to
      say so and to stop recommending `vercel --prod` (which just creates a
      redundant duplicate deployment alongside the one GitHub already
      triggered). Eight data points collected across six sessions
      (2026-07-09 through 2026-07-13, lag consistently ~2-3 seconds by the
      end) before the mechanism was confirmed via the dashboard rather than
      inferred from CLI timing alone — full history preserved below as the
      decision-log record of how this was chased down.
      <details><summary>Full data-point history (click to expand)</summary>

      **2026-07-09, first data point:** within ~24 seconds of a docs-only
      `git push` (TASKS.md/HISTORY.md commit, no `vercel --prod` run), a new
      Production deployment appeared in `vercel ls` with status Building,
      then went Ready and became the aliased live deployment — no explicit
      deploy command was run for it. `vercel project inspect` showed no Git
      Repository connection at the time (a CLI-visibility gap, not evidence
      the integration didn't exist).
      **2026-07-10, second data point:** owner directed "push it, don't run
      `vercel --prod`, GitHub integration auto-deploys on push" — pattern
      held: a new Building deployment appeared ~35s after `git push`, went
      Ready, `returns-assistant.vercel.app` aliased to it
      (`dpl_BH21fS2a5pcceEcjjGvba5FWpFVX`), no manual deploy command run.
      **2026-07-12, third data point:** recurred at session close. Explicitly
      ran `vercel --prod` for commit `b6ff814` (Tasks A/B), confirmed
      `dpl_86QfR7qHpUfv1aiJqvTq8TP4p3TQ` Ready and aliased. Then pushed one
      more docs-only commit (`016ca20`); ~2.5 minutes later, with no
      `vercel --prod` run, `dpl_BdhzY93AwF6NqQhMKjYtiGBettsy` appeared and
      became the new aliased live deployment.
      **2026-07-13, fourth data point:** pushed the order-number-display
      commit (`771778f`) — new deployment within ~2 seconds
      (`dpl_HBsw75cTQmFzdequQcYTXyA857rF`), Ready, aliased.
      **2026-07-13, fifth data point:** pushed Desktop visual polish Phase 2
      (`cc99f33`) — within ~3 seconds (`dpl_E7hmoUunv3tq7pnGwr9pTkGqxsat`),
      Ready, aliased.
      **2026-07-13, sixth data point:** pushed the Gmail deep-link removal
      (`3658947`) — within ~3 seconds (`dpl_FMKqbrZRTsLSv99tRctnq62i7oLJ`),
      Ready, aliased.
      **2026-07-13, seventh data point:** pushed Follow-up polish
      (`f3b549a`) — within ~3 seconds (`dpl_DQhUXbjbjgPbM76miPqfT1Lu84M4`),
      Ready, aliased.
      **2026-07-13, eighth data point:** pushed Dashboard row density
      (`b3d1d26`) — within ~2 seconds, caught at "Initializing" even earlier
      in the lifecycle than prior checks
      (`dpl_G4iETqE59TU6LKBRteAr9Hv5hXKd`), Ready, aliased.
      </details>
- [x] **Order-number display** — `OrderCard.tsx` middle-truncates order
      numbers over 16 chars (`#6a4d94…748a`), full value in `title` +
      `aria-label`; order detail page shows the full untruncated number plus
      a copy button. `lib/orderNumberDisplay.ts` + tests. Committed
      (`771778f`), pushed, deployed (`dpl_HBsw75cTQmFzdequQcYTXyA857rF`) —
      **owner-verified live 2026-07-13.**
- [x] **Needs-review card placement — verified correct, no move needed.**
      Checked twice (2026-07-12 session close, and again on 2026-07-13) —
      sits between the summary card and the order list in
      `app/(app)/page.tsx`, unchanged since Commit 2's original
      diagnostic-first check. No code changes; closing as verified-correct
      per owner instruction rather than leaving it open indefinitely.
- [x] **Task A ("at risk" label, conditional on ≤7 days left) and Task B
      ("(est.)" hedging, conditional on `policySource === "stated_in_email"`,
      no schema migration)** — both owner-verified live 2026-07-12. See
      Known Issues for the one follow-up this surfaced (summary card's
      single-order display).
- [x] **Design tokens Commit 2 — dashboard layout redesign**, its follow-up
      button-label fix ("Keeping it"), and the desktop layout pass (640px
      content column, retokened route-aware Sidebar, content-sized buttons
      at desktop). All three owner-verified live 2026-07-12. One flagged
      judgment call in the desktop pass — the brief asked for both a
      page-colored sidebar background and a page-colored active-item
      highlight, which can't coexist; resolved with a left-border indicator
      instead (the brief's own listed alternative).
- [x] **Commit 2 follow-up fixes** — mobile width overflow at 380px (missing
      `min-w-0` on flex children), Sidebar/BottomNav now render from a shared
      `app/(app)/layout.tsx` on every authenticated page instead of just the
      dashboard, and the Alerts nav item is now a real `/alerts` page instead
      of a dead `<div>`. Owner-verified live 2026-07-12.
- [x] **Design tokens Commit 1 — self-host Bodoni Moda + Inter, apply type
      scale + color palette.** `next/font/google` self-hosts Bodoni Moda
      (serif, weights 400–700) + Inter (sans, 400/500), exposed as
      `--font-serif`/`--font-sans`; `--font-sans` drives Tailwind v4's
      default body font automatically, so only the doc's explicitly-listed
      serif elements (greeting, StatCard value, order price in mobile
      card/desktop table/order-detail, and DaysLeftChip's number) needed an
      explicit `font-serif` override. `app/globals.css` adds page/card/ink/
      secondary/muted/border/accent color tokens (`bg-page`, `text-ink`,
      etc.), replacing the warm-cream `stone`/`zinc` palette across every
      logged-in-app page (dashboard, order detail, settings, login, admin —
      ~30 files touched, scope confirmed with owner). Marketing page
      (`myreturnwindow.com`) deliberately excluded — turned out to be a
      fully separate bespoke design (own Cormorant Garamond font link,
      inline-hex styles), not a themed dashboard variant. Hue-bearing
      semantic colors (status badges' returned/refunded/kept, DaysLeftChip's
      ≤2-day red urgency tier, and the order-detail/dashboard's per-action
      colored buttons — Start Return blue, returning amber, keeping slate,
      returned green, refunded emerald) deliberately left untouched — not
      covered by the token doc's status-tint table, flagged explicitly in
      the plan rather than guessed at. `npm run build` clean (type-checks
      pass). Automated browser screenshot verification was attempted (no
      working headless-browser tool pre-existed in this repo; a Playwright
      chromium install hung for hours in this sandboxed environment and was
      killed) — could not complete it that session; verification instead
      rested on the clean build plus an exhaustive repo-wide grep confirming
      zero leftover references to the old palette/fonts outside the
      deliberately-untouched `RetailerAvatar.tsx` and the excluded marketing
      page. Committed (`90f6856`), pushed, deployed
      (`dpl_5T9C68LZE5i39b63fPUPsBRYeWcx`, confirmed Ready and aliased to
      `app.myreturnwindow.com`) — **owner-verified live 2026-07-12.**
- [x] **HTML emails** — deadline reminder, weekly digest, and refund check-in emails now send real HTML with clickable links instead of raw URLs. Owner-verified live via a real forced send (Shopbop test order): HTML rendered correctly, all three links resolved.
- [x] **"Mark returned" signed-token email action** — second one-tap-from-email action after Archive. Owner-verified live: clicked the link on the Shopbop test order, confirmed the order transitioned to returned correctly, reverted after.
- [ ] **orderDate-fallback Phase 4 backfill** — 6 prod rows matched the
      pre-gate wrong-fire pattern (fallback fired before 76f4dd6's gate
      existed, earliest-linked emailType now excluded); not 5 as originally
      logged from Phase 1. Upway #US8855 excluded — it's the separate
      `other`-classification bug already tracked in Known Issues, not a gate
      wrong-fire; verified unchanged post-backfill. 5 backfilled: Mango
      #F4VLSG00, Moda Operandi #456603272478, Gap Inc. #1R1KXD3, Lola
      Blankets #1158308, Shopbop (refund, no order number) —
      `orderDate`/`orderDateEstimated` → null/false, `returnDeadline`/
      `deadlineIsEstimated` recomputed via real `computeDeadline()` (all
      cascade to null — no `deliveredAt`/`estimatedDeliveryDate` to anchor
      on). Silent correction, same test as Caroline's Moda backfill (all 5
      are return_requested/refunded, no future reminder affected). One-off
      diagnostic + backfill scripts deleted after use. Full before/after
      table and reasoning in HISTORY.md — doubles as the excluded-side
      Phase 2 verification. **Awaiting user verification (Phase 3 eyeball)**
      — see 🟡 Next.
- [x] orderDate-fallback Phase 2: `applyFallbackOrderDate` now gates by
      earliest-linked email's emailType. Allowed types (fallback fires):
      `order_confirmation`, `shipping_confirmation`, `delivery`. Excluded
      types (fallback stays null): `return_label`, `refund`, `other`. Gate
      lives inside the function itself; all three call sites
      (`linkOrder.ts:540`, `linkOrder.ts:630`, `orderReview.ts:56`) covered
      uniformly. Committed (`76f4dd6`), pushed, deployed
      (`dpl_5mopRwrpkD6nh8PyPyKHRnMBJ8aE`). 8 new tests, 199 passing.
      Allowed-side owner-verified via a fresh Amazon order_confirmation
      forward — fallback correctly fired, `orderDate` set from `receivedAt`,
      `orderDateEstimated: true`, deadline computed correctly. Non-regression
      owner-verified via a fresh J.Crew order_confirmation with extracted
      orderDate — fallback correctly early-returned, working case unchanged.
      Excluded-side verification deferred to Phase 4 backfill — closed
      2026-07-10: 6 prod rows matched the pre-gate wrong-fire pattern, not 5
      as originally logged; 1 (Upway #US8855) excluded as a separate
      `other`-classification bug, 5 backfilled. Full detail in HISTORY.md.
      BUILD.md invariant + Decisions log entry shipped in same commit.
- [x] Merged memory-system standing habits (`feedback_standing_habits.md`)
      into CLAUDE.md at repo root — repo file now canonical, memory file is
      a pointer. Committed (`9ebe8dc`), pushed. Fixes the drift risk of two
      overlapping-but-different sources of truth for working habits (repo
      Working Agreement vs. memory-system Behavioral Habits). Surfaced by
      diagnostic during today's fresh-session boot.
- [x] A1 Phase 2: `needsReview` promoted to first-class JSON schema field —
      surfaced when live production reliability bug: re-running extraction on
      Caroline's Moda email produced `needsReview: false` because the AI
      wrote lowercase "multiple" instead of uppercase "Multiple", defeating
      the case-sensitive `notesIndicateTieredWindow` string match. Fix: AI
      now sets `needsReview` directly via the extraction JSON schema (both
      email-body and web_lookup prompts). `notesIndicateTieredWindow`
      retained as OR'd fallback for one release cycle. Committed (`74507b4`),
      pushed, deployed (`dpl_941nSRixVg7vrdeh2wsDhGAf37ss`). 6 new tests, 191
      passing. Owner-verified via 4 consecutive independent extractions of
      Caroline's Moda Email — all consistent `needsReview: true`, no
      non-determinism observed. Deliberately Shape 2 only: `Order.needsReview`
      NOT propagated from `Email.needsReview` for extraction-quality signals,
      because Order-level UI ("Looks correct / Split into separate order") is
      designed for linking-review, not extraction-review. Separating those
      concerns is a 🟡 Next spec pass.
- [x] A1: Tiered-return-window prompt rule — extraction picks shortest
      applicable window when multiple are stated, sets `needsReview: true`,
      records detection in notes. Applies to both email-body extraction and
      `buildPolicyLookupPrompt`. Committed (`1216aaf`), pushed, deployed
      (`dpl_EhQMify5JkYh5WEMrLVE66kEHmso`). 4 new tests, 185 passing.
      Web_lookup path owner-verified via Shopbop live forward (15 days,
      needsReview true, notes format correct). Email-body path owner-verified
      via read-only re-extraction of Caroline's Moda Email row.
- [x] Caroline's Moda Order — backfilled under A1 Phase 2 extraction rules.
      `Email.returnWindowDays: 30 → 14`, `Email.needsReview: false → true`,
      `Email.extractionRaw` fully replaced, `Email.extractedAt` bumped.
      `Order.returnWindowDays: 30 → 14`, `Order.returnDeadline:
      Aug 13, 2026 → Jul 28, 2026` (recomputed via `computeDeadline()`, not
      hand-written), `Order.needsReview` deliberately untouched (Shape 2
      no-propagation). One-off script deleted after use per project
      convention. Caroline not notified — return already in-flight, deadline
      correction affects no future action she'll take (see 🟡 Next: user
      notification policy for data corrections).
- [x] Admin dashboard v1 — three read-only pages (`/admin/users`,
      `/admin/users/[fwd]`, `/admin/users/[fwd]/orders/[id]`), session-gated
      to `ADMIN_USER_EMAIL`, no mutation endpoints, no email content
      decryption. Layered privacy: forwarding address as opaque identifier,
      no personal details on list view. Committed (`b498a08`), pushed,
      deployed. Owner-verified in production.
- [x] Admin dashboard v1.1 — added `estimatedDeliveryDate` and `deliveredAt`
      columns to user detail table, expanded order detail per-email fields to
      match. Committed (`ab290a5`), pushed, deployed
      (`dpl_3JoVHd63NntbXfxFPoxPCxyCQeed`). Owner-verified in production.
      `orderDate` column still missing on the user detail table — deferred to
      next admin-dash session; not urgent since order date is visible on the
      order detail page.
- [x] Gmail deep-link query preload swap — commerce query with pharmacy
      exclusion now preloaded in setup page Step 5, replacing the reversed
      `to:(forwarding-address)` query. Committed (`730fc36`), pushed, deployed
      (`dpl_A49kcwf1xRvSgwRms6DnaUhrExT9`). Owner-verified in production;
      brother verified the forwarding-address confirmation code loop
      end-to-end but deep-link + filter-build path still unverified for any
      non-owner (see 🟡 Next: Gmail Step 5 UX pass).
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
- **`vitest-nextauth-import-fragility` — PROMOTED to 🟡 Next 2026-07-17.** Now
  shaped three separate decisions (H1 Phase 3 extraction, M1's test strategy,
  the L5 guard proposal); per its own graduation criteria below, that's the
  investigation trigger. See 🟡 Next for the full item.
- **Good Eggs order showing "Return by Jul 21, 2025" on the active
  dashboard with a live "Start return" button** — the deadline is in the
  past (2025, over a year ago relative to the current session date), so
  this is an expired order that should be filtered out or auto-archived,
  not shown as actionable. Spotted 2026-07-13 owner review, explicitly
  **not fixed tonight** — needs investigation into why
  `lib/autoArchive.ts`'s sweep or the dashboard's active-order filter
  didn't catch it (auto-archive requires 14+ days past `returnDeadline`
  and runs nightly via cron — worth checking whether the cron actually ran
  for this order, whether `returnDeadline` is somehow null/wrong despite
  the displayed date, or whether this status makes it exempt from the
  sweep). `app/(app)/page.tsx` (dashboard query) and `lib/autoArchive.ts`
  are the likely files. Backlog — not in scope for tonight's closeout.
- **Gmail deep-link filter setup button removed from Settings as of
  2026-07-13, pending URL construction fix.** `app/(app)/settings/page.tsx` —
  2/2 non-owner test users (mom, brother) ended up with a filter matching
  their entire inbox instead of the intended commerce search. Non-owner
  users must now set up the Gmail filter manually with no in-app guidance
  (no replacement copy was added — deliberate, see 🟡 Next). Impact:
  onboarding friction for non-technical users; watch for setup-completion
  drop-off. A separate monitoring alert for "filter matched everything" is
  being built in a separate session (per owner) — not this one, don't
  duplicate. Re-introduce the button once `gmail-deeplink-cross-account-parsing`
  (🟡 Next) is fixed and verified.
- **`Order.retailer` has a casing duplicate: "Mango" and "MANGO" exist as two
  separate retailer strings** (1 order each) — same normalization problem
  `CLAUDE.md` already documents for order-number suffixes, just on the
  retailer name field instead. Surfaced 2026-07-13 during the logo-coverage
  investigation (`LOGO_COVERAGE.md`). Not fixed — out of scope for that task.
- **Third-party returns-logistics vendor domains can masquerade as a
  retailer's own sending domain** — Gap Inc.'s sender domain resolves to
  `optiturn.com` (a returns-processing platform, likely not Gap's own site),
  a failure mode the existing ESP-exclusion concept doesn't cover (it's not
  a marketing ESP, it's a returns vendor: Optiturn/Narvar/Happy
  Returns/Loop/AfterShip are the likely list). Relevant to any future
  sender-domain-derived feature (e.g. retailer logos). Surfaced 2026-07-13,
  see `LOGO_COVERAGE.md` §7.
- **RESOLVED 2026-07-14 ("adaptive hero" fix):** ~~Summary card should show
  the retailer name, not just the dollar total, when exactly one order is
  due~~ — `app/SummaryCard.tsx` gained a `singleOrderRetailer` prop, shown
  above the dollar figure only when `count === 1` (e.g. "Poshmark" above
  "$640.87"). Shipped as item 6 of the Desktop visual polish Phase 2
  commit (`cc99f33`, 2026-07-13). No design-doc pattern was ever found to
  reference (see the now-superseded note below) — the spec was worked out
  fresh instead: exact threshold (`count === 1`), which order wins is moot
  since count 1 means only one candidate exists. Marked Done per owner
  closeout instruction 2026-07-14.
- **RESOLVED, not a bug:** ~~coverage-check email showing entire order history
  instead of "this week"~~ — `app/api/cron/weekly-coverage/route.ts` already
  filters `Email.receivedAt >= now - 7 days` and has since Milestone 16
  (`0f80ee5`). Read-only check against real data (2026-07-10): the filter
  narrows results for most users (owner: 49 emails → 19 within window,
  Caroline: 8 → 6, others → 0), but two alpha accounts (jsweazey,
  kathleensweazey) have 100% of their data within the last 7 days simply
  because their accounts are only ~2 days old — so a coverage email for either
  of them legitimately shows "everything," coincidentally, not because the
  filter is missing. Leaving this entry as a record so it isn't
  re-investigated; if a genuinely-old order shows up in a future coverage
  email, that's a different bug, not this one.
- **Dashboard visual polish: archive column overflow** — surfaced today by
  owner. Archive column falls off the visible page area on the main
  dashboard. Layout needs a cleanup pass. Not urgent but real UX friction.
  Slug: `dashboard-visual-polish-archive-overflow`.
- **`other`-typed emails that link to an Order and carry retailer/orderNumber
  are likely misclassifications** — surfaced during Phase 1 diagnostic
  (2026-07-09). 1 of 15 `other`-typed rows in prod (Upway, a "Link to
  order"-subject email) is a real transactional email typed as `other` while
  carrying retailer, order number, and Order linkage. Likely
  cause: extraction prompt treats "helpdesk"-toned transactional emails as
  marketing. If pattern recurs, add a `needsReview: true` gate: any
  `other`-typed email that gets a non-null `retailer` is prima facie
  contradictory. Slug: `other-emailtype-transactional-misclassification`.
- **A1 Phase 2 verification could not cleanly isolate AI-set `needsReview`
  vs. fallback contribution** — both fire in the tiered-window case because
  notes text naturally contains the fallback marker phrase. Qualitative
  evidence (AI narrating its own reasoning) is the current proxy. Cleaner
  proof would require temporarily disabling `notesIndicateTieredWindow` on a
  test run.
- **No runtime validation on the AI's JSON response** (`lib/extract.ts`,
  `JSON.parse(...) as RawExtraction` / `as PolicyLookupResult`) — pre-existing
  pattern for every field, but newly relevant now that `needsReview` is
  behavior-critical: if the AI ever omits the field entirely despite the
  prompt instruction, `parsed.needsReview` is `undefined` at runtime, which
  `||`-evaluates as falsy rather than being caught or logged. The
  `notesIndicateTieredWindow` fallback still catches the tiered-window case
  specifically, but nothing would catch an omission the AI intended to flag
  for a different reason. Not fixed here — flagging only. Real fix tracked
  in 🟡 Next as `extraction-runtime-validation`.
- **Bug naming going forward uses slugs, not numeric IDs** — historical Bugs
  1-11 preserved as-is in HISTORY.md, but new bugs get human-readable slug
  names (e.g., `orderDate-fallback-emailtype-gate`, `returnportal-trust-tier`)
  so TASKS/BUILD entries stand alone without a lookup. Rationale: HISTORY
  already has "Bugs 9+10+11" collated into one entry; numeric IDs don't scale
  and require grep to resolve.
- **RESOLVED (A1 Phase 2, `74507b4`):** ~~A1 tiered-window detection is
  string-match on AI notes output~~ — this predicted failure mode actually
  happened (AI wrote lowercase "multiple" instead of "Multiple",
  `needsReview` silently stayed `false`) and was fixed same-day by promoting
  `needsReview` to a first-class AI-set JSON field, with the string-match
  kept only as an OR'd fallback. Leaving this entry as a record that the
  prediction was correct, not removing it outright.
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
- **Principle: never BCC credential-bearing email** (2026-07-17, M1 fix). A
  BCC copies the *entire message*, including any live link, token, or code
  inside it — there's no way to BCC "the fact that this happened" without
  also BCCing the credential itself. If the admin needs visibility into a
  sign-in/verification event, send a separate notification that names the
  event (who, when) without including the sensitive payload — the
  `createUser` event already did this correctly; M1's sign-in-email BCC
  didn't, and has now been brought in line with it (`lib/magicLinkRateLimit.ts`,
  `buildSignInAdminNotification`).
  ✅ **RESOLVED 2026-07-17** — see the superseding entry below, right after
  the original Gmail-confirmation-code BCC decision. Killed the
  `Auto-email Gmail confirmation code` Next item rather than carving out an
  exception; this principle now applies without a carve-out.
- Magic-link rate limiting is loud, not silent, unlike the allowlist gate
  right below it in the same function. When a real user hits the 8/hr
  (per email) or 20/hr (per IP) limit, they see a message explaining
  they've been rate-limited, rather than a silent no-op. Rationale: the
  "silently succeed" pattern the allowlist gate uses exists to defend
  against credential-stuffing/enumeration, which doesn't apply here — this
  app has no password, so there's nothing to protect by staying silent.
  The residual leak risk (a rate-limit message reveals *that* a request
  was throttled, not *whether* the email is allowlisted — both allowlisted
  and non-allowlisted emails hit the same limit and see the same message)
  isn't meaningful at pre-public-alpha scale, and silently failing sign-in
  is one of the worst UX patterns a small app can have — it teaches users
  the app is broken.
- Admin notification on a magic-link rate-limit hit is deduped per-email
  per 24h (same shape as `beta_signup`, see the dedup-granularity entry
  above) but only fires when the rate-limited email is on the allowlist.
  An unknown email hammering the limit is attacker/scanner noise the
  existing `allowlist_rejection` notification already covers; a second
  alert for the same noise adds nothing. Real users are the only signal
  worth a second look.
- Admin notification dedup granularity depends on the signal's meaning.
  Attack-shaped signals (`allowlist_rejection`, `inbound_rate_limited`) dedup
  per-kind — one alert per window is enough. Real-user signals
  (`beta_signup`) dedup per-user identifier — every real user is worth its
  own alert. The rate limit at the endpoint is the flood protection; the
  notification dedup shapes visibility, not security. Written down after a
  2026-07-16 review flagged `beta_signup`'s dedup as "per-kind, one email
  per 24h regardless of unique signups" — the actual shipped code was
  already correct (`hasRecentNotification`'s `relatedEmail` param makes
  every existing caller dedup per kind+identifier, not kind alone), but
  that correctness wasn't obvious from the code shape, and testing with
  only a single repeated email can't distinguish the two designs from each
  other. Documenting the principle so a future caller doesn't have to
  re-derive it under review.
- List view is the primary interaction surface for routine order actions; card/detail
  view is for orders needing attention. Buttons for routine transitions (returning,
  keeping) belong in list view.
- CLAUDE.md at repo root is the canonical source for standing habits.
  Memory-system files (`~/.claude/projects/.../memory/*`) are local
  conveniences that must reference the repo file. When the two diverge,
  the repo file wins. Rationale: memory system is machine-scoped and
  invisible in version control; repo file is portable, visible, and
  auditable.
- `applyFallbackOrderDate` fires only when the earliest-linked email is
  `order_confirmation`, `shipping_confirmation`, or `delivery`. Excluded
  types (`return_label`, `refund`, `other`) leave `orderDate` null.
  Rationale: post-purchase-loop emails' `receivedAt` has no defined
  relationship to the true order date; inventing an anchor from them
  produces visibly-wrong deadlines (Caroline's Moda, 2026-07-08). `other`
  is excluded because 14/15 current rows are unlinked marketing; the 1
  anomaly (Upway) is a classification bug tracked separately, not a case
  for gate special-casing. (Full detail also in BUILD.md's Decisions log.)
- Tiered return windows resolve to the shortest applicable window, always,
  even when the user's specific tier would grant a longer window.
  `needsReview: true` set on all tiered cases, via a first-class JSON schema
  field as of A1 Phase 2 (not string-matching, per the entry below).
  Rationale: "a wrong deadline is worse than a missing one" — a redundant
  early reminder is harmless, a missed shorter deadline is trust-eroding.
  Real fix (surfacing both windows to user) deferred to the tiered-policy
  schema pass.
- Retailer policy database is the highest-quality data source for extraction
  and belongs at the top of the extraction priority order (retailer-known
  → email → web_lookup → guess). Not built yet; scoped as a 🟡 Next spec
  pass, entangled with tiered-policy schema work.
- `notesIndicateTieredWindow` retained as an OR'd fallback after A1 Phase 2,
  for one release cycle — belt-and-suspenders against JSON-schema-field
  regression, not the primary signal anymore (superseded: A1 originally
  detected tiering via string-match alone; Phase 2 promoted `needsReview` to
  a first-class AI-set field). Remove once we've observed reliable AI
  behavior over multiple weeks.
- `Email.needsReview` and `Order.needsReview` serve two different jobs
  (extraction-review vs. linking-review) with different UI treatments and
  different human-override semantics. Extraction-quality signals
  deliberately NOT propagated to `Order.needsReview` until a proper spec
  pass separates the two concerns.
- Silent correction was the right call for Caroline's Moda backfill (return
  already in-flight, correction affects no future action). Broader user
  notification policy needs stating before scale — tracked in 🟡 Next.
- Bug naming going forward uses human-readable slugs, not sequential numeric
  IDs. Historical Bugs 1-11 preserved in HISTORY.md as-is; not renamed.
- Gmail confirmation code will be delivered to users via email (in addition
  to dashboard surfacing), with owner BCC'd. Rationale: user's mental context
  during Gmail forwarding setup is Gmail itself, not the Return Window
  dashboard; email meets them where they are. Codes are also time-sensitive
  (Google ~24hr expiration) and dashboard-only surfacing risks stale codes on
  return visits.
  **SUPERSEDED 2026-07-17 — killed, not built.** The BCC half of this
  decision conflicts directly with M1's "never BCC credential-bearing email"
  principle (see that entry above) — a Gmail confirmation code is exactly
  the same shape of credential-bearing content M1 fixed for magic links,
  time-limited or not. Decision: kill `Auto-email Gmail confirmation code`
  entirely rather than carve out an exception. Reasoning: (1) M1's principle
  applies to time-limited codes, not just magic links — there's no
  principled reason a code expiring in ~24h is exempt from a rule justified
  by "don't put credentials in a second mailbox"; (2) during alpha the owner
  is the only one setting up forwarding, so the code already lands in the
  right place (the owner's own inbox) without any user-facing email flow —
  there's no real gap this was filling yet; (3) the forwarding architecture
  itself is not the long-term plan, so building a user-facing code-delivery
  flow now means building a feature for a system expected to be replaced.
  If forwarding outlives that expectation and self-serve setup becomes real,
  this can be revisited — but the redesign should respect M1's principle
  from the start (e.g. surface the code in the dashboard only, no BCC'd
  email), not reintroduce the conflict this entry closes.
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
- `computeDeadline()`: a `null`/unknown `returnWindowStartsFrom` now anchors directly
  on `orderDate`, not a delivery-plus-buffer guess (2026-07-15,
  sidekick-deadline-anchor-mismatch). Rationale: order-date anchor is always
  <= delivery-date anchor, so defaulting an unconfirmed anchor to orderDate can
  never compute a deadline later than the true one could be — mirrors the
  tiered-window "shortest window always wins" entry above ("a wrong deadline is
  worse than a missing one"). Deadline is still flagged `deadlineIsEstimated: true`
  in this case even though `orderDate` itself is a real value — the anchor choice
  is an assumption, not a confirmed fact.
- `STANDARD_SHIPPING_DAYS` (the synthetic buffer used only when a policy is
  explicitly `delivery_date`-anchored but no real delivery signal exists yet)
  tightened 7 -> 5 days (2026-07-15, same session). Same "wrong deadline worse
  than missing" principle: owner explicitly accepted the trade that a user might
  occasionally start a return a couple days before they strictly needed to
  (minor inconvenience) in exchange for never computing a deadline later than
  the real one (real cost, a missed return).
