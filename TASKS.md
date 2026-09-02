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
> At session close, state explicitly: committed? pushed? deployed? — and how
> many billed Anthropic API calls this session made, from which call sites.
> "Tests passed" does not mean deployed. "Read-only" means no DB writes; it
> does NOT mean no API cost. Any script, probe, or verification that will
> call the model must state its estimated call count BEFORE running.
> (Amended 2026-07-22 — see Decisions log: "read-only" is a database
> property, not a cost property.)
>
> **No ✅ in Done until the user has hand-verified in production — not just tests passing.**
> Claude Code reports "awaiting user verification" instead of ✅.

---

## 🔴 Now

- [ ] **`returnPortalUrl` self-domain correctness bug — NEW 2026-09-02, from
      the fleet URL health audit (filed under Done).** At least one active
      order has `returnPortalUrl` set to
      `https://app.myreturnwindow.com/orders/{id}` — our own app's domain,
      not the retailer's return page. A user clicking Start-return from a
      reminder would be sent to our own login page instead of the
      retailer's return flow. Investigation first (blast radius, root
      cause, extraction-side check) — report before any fix. Fix (once
      confirmed): (A) validation guard at every `returnPortalUrl` DB write
      path rejecting self-domain URLs, logged not silently dropped; (B)
      null out existing affected rows, no re-extraction/backfill (separate
      concern). Scope: `returnPortalUrl`-write paths only.

- [ ] **`returnPortalUrl` coverage gap — why do only ~57% of active orders
      have one? — NEW 2026-09-01, surfaced by Start-return CTA build.**
      Coverage report during that build: 52/91 active orders (57.1%) have
      `returnPortalUrl` populated; 39 do not. Those 39 receive the
      improved reminder (order date + copyable order number) but no
      Start-return button.
      **Investigation questions:** (a) retailer breakdown of the 39 —
      concentrated or spread across the long tail? (b) for retailers where
      SOME orders have a URL and OTHERS don't, what's different —
      different email types, extraction paths, source confidence? (c) is
      the extraction prompt failing to find URLs actually present in the
      source emails, or are the source emails genuinely not carrying them?
      **Read-only investigation first, then decide fix.** Distinct from
      item 4250 (stale URLs we DO have, not missing ones) and item 4237
      (retailer policy DB — portal URL incidental there, not the point).
      **Explicitly NOT in scope of this item:** building the fix — that's
      a follow-up shaped by what the investigation finds.

- [ ] **[CODE BUILT + TESTED + PUSHED + DEPLOYED 2026-09-02, LIVE
      VERIFICATION PENDING] Reminder email: add order date, obviously
      copyable order number, and "Start return" CTA that also fires the
      state change — NEW + BUILT 2026-09-01/09-02, from owner review of a
      live SKIMS reminder.** Original gap: the reminder
      template omitted `orderDate`, buried `orderNumber` in prose, and had
      no direct return-flow entry point.
      **Investigation first (this repo's diagnostic-first habit):** the
      existing Mark-as-returned/Archive email links use a two-step,
      POST-gated pattern — an HMAC-signed token opens a read-only GET
      confirm page, and only a subsequent form POST (carrying a second
      derived CSRF token bound to that page load) performs the write. The
      code is explicit about why (`app/api/action/returned/route.ts:36-38`):
      an email client's link-prescanner issuing an automatic GET must never
      be able to redeem a token by itself. The original spec asked for a
      single GET-triggers-write-then-302 route with "no intermediate
      page" — flagged as unsafe (would let prescanners silently fire
      `return_requested`) and NOT built that way. **Owner resolved: reuse
      the existing two-step pattern as-is (Option 1), no auth-model
      change.**
      **Built:**
      - `app/api/cron/route.ts` (`buildBody`/`buildHtmlBody`): `orderDate`
        on its own line; `orderNumber` on its own line (HTML: inline
        `<code>` block, monospace, selectable in one gesture — no
        click-to-copy button, matches the plan's explicit v1 scope); a
        "Start return" link/button using `truncateOrderNumber` for
        display formatting. Omitted entirely (no dead link, no "coming
        soon") when `Order.returnPortalUrl` is null — **coverage check
        run this session: 52/91 active orders (57.1%) currently have a
        `returnPortalUrl`; the other 39 will keep getting the reminder
        without a Start-return button until that field is populated.**
      - `lib/startReturnAction.ts` + `lib/startReturnPageState.ts` — pure
        decision logic mirroring `lib/returnedAction.ts`/`returnedPageState.ts`,
        one deliberate difference: idempotent like Archive (not a rank-gated
        block like "returned") — reaching the retailer's portal stays
        useful regardless of the order's current status, so a stale link
        still redirects; only the DB write is conditional on rank.
      - `app/action/start-return/page.tsx` (+ `StartReturnSubmitButton.tsx`
        client component) — new GET confirm page per the owner's design
        spec (single card, no nav/footer/extra links, "Return to
        {retailer}" / meta lines / one primary button / "Not now"). Primary
        button fire-and-forget copies the real (untruncated) order number
        to clipboard on click before the native form POST — never awaited,
        never blocks the submit, silently no-ops on permission failure.
      - `app/api/action/start-return/route.ts` — POST-only (no GET
        handler, same as returned/archive), same
        `TokenRedemption`-first-for-single-use transaction shape, calls
        `buildStatusTransitionData("return_requested", order)` — the same
        pure transition-data builder `app/actions.ts`'s
        `advanceDisplayStatus` (the in-app Start Return button's path)
        already uses, so both entry points stay behind one shared
        contract. Success 302s straight to `returnPortalUrl`; every other
        outcome (expired/already_used/invalid/order_state_changed/
        `no_portal` — new: portal URL cleared between send and click) 303s
        to a new `app/action/start-return/done/page.tsx`.
      - `prisma/schema.prisma`: doc-comment-only updates listing
        `"start-return"`/`"no_portal"` alongside the existing action/outcome
        values — no migration, no schema change.
      - Tests: `__tests__/cron.test.ts` extended (existing literals gained
        `orderDate`/`returnPortalUrl`, new cases for the date/number lines
        and Start-return presence/omission); new
        `__tests__/startReturnAction.test.ts` and
        `__tests__/startReturnPageState.test.ts` mirroring the
        returned/archive equivalents. **762/762 tests passing,
        `npm run build` clean (typecheck + lint), all new routes
        registered** (`/action/start-return`, `/action/start-return/done`,
        `/api/action/start-return`) confirmed via build output. Confirmed
        `proxy.ts`'s matcher doesn't touch `/action/*` or `/api/action/*` —
        no session-gating change needed, same as the existing two actions.
      **Explicitly not touched, per scope:** digest/coverage-check/
      admin-notify templates; `returnPortalUrl` extraction/trust-tiering;
      the app's order detail page; the in-app `StartReturnButton.tsx`
      (reused its underlying transition data builder, didn't fork it).
      **Follow-up requested same session (2026-09-02):** the confirm
      page's clipboard pre-copy was silent — added quiet helper text
      above the primary button ("We'll copy your order number to your
      clipboard — paste it on {retailer}'s page if they ask for it"),
      phrased as intent ("we'll copy," not "we copied") since the write
      can fail silently. Only renders when `orderNumber` is present.
      **Committed (`a2f6eb9`, `35fb137`), pushed, and deployed — Vercel
      alias confirmed serving `35fb137`, status Ready (verified via
      `vercel inspect` immediately after push, 2026-09-02).** Still
      **awaiting live Gmail verification** per this repo's "no ✅ until
      hand-verified" rule — owner will confirm against the next real
      reminder: order date on its own line, order number selectable in
      one gesture, Start-return button lands on the retailer's page with
      no intermediate stop, and order state shows return-started
      immediately after. See the "Remind me tomorrow" follow-up (🟡 Next)
      opened during this build for out-of-scope-for-v1 work flagged
      along the way.

- [ ] **[CODE BUILT + TESTED + DEPLOYED 2026-08-27, LIVE VERIFICATION
      SKIPPED per owner] Sender display name change — reminder / digest /
      coverage-check / admin-notify emails show the sender name as
      literally "reminders."** Owner wants "My Return Window" on all of
      them; sending address stays `reminders@myreturnwindow.com`
      unchanged.
      **Root cause:** `REMINDER_FROM_EMAIL` (Vercel production env var)
      is a bare address with no display name — Gmail (and most clients)
      fall back to showing the local-part as a pseudo-name. Confirmed via
      `vercel env pull` against production, read-only.
      **Built and deployed (commit `6111fe2`):** `lib/postmark.ts` — new
      `SENDER_DISPLAY_NAME = "My Return Window"` constant +
      `formatSenderEmail(email)` helper, formatting `"Display Name
      <address>"` the way Postmark's `From` field expects. Wired into all
      4 call sites that read `REMINDER_FROM_EMAIL` directly:
      `app/api/cron/route.ts`, `.../weekly-digest/route.ts`,
      `.../weekly-coverage/route.ts`, and — per owner's "brand them all"
      — `lib/adminNotify.ts` (internal admin alerts, not originally in
      scope, added on request). `lib/refundCheckin.ts`'s check-in emails
      receive the already-formatted value passed through from
      `app/api/cron/route.ts`, so they're fixed for free, not a 5th site
      to edit. Pure code change — no env var, DKIM, SPF, or
      sending-address change. New `__tests__/postmark.test.ts` for the
      formatter; 6 existing test files' `@/lib/postmark` mocks updated to
      also export `formatSenderEmail` (they broke on the new import, not
      a logic regression — confirmed by reading each failure). 683/683
      tests passing, `npm run build` clean, deploy confirmed live.
      **Live email verification attempted and blocked, not skipped
      carelessly:** the real cron endpoints' `?force=true` path processes
      every user's real orders, not just the owner's — running it for
      real would have emailed other actual users just to check a sender
      name, so that path was correctly ruled out (owner confirmed via
      explicit question, per this repo's standing email-testing rule). A
      direct one-off test send to the owner's own inbox was attempted
      instead but blocked: the local `.env`'s `POSTMARK_SERVER_TOKEN` is
      stale (401 Unauthorized), and the real production token is marked
      **Sensitive** in Vercel, so `vercel env pull` returns it empty —
      same restriction already known for `AUTH_SECRET`. **Owner chose to
      skip live verification for now rather than work around the
      Sensitive-var restriction.** Correctness rests on code review + the
      passing tests, not an observed Gmail render. **Verify opportunistically
      the next time a real reminder/digest/coverage/admin email goes out**
      — check the sender name in Gmail's inbox list, not just the message
      body — and close this fully at that point, not before.

- [ ] **`Email.returnDeadline` frozen-snapshot drift — NEW 2026-08-27,
      end-of-day close-out on the orderDate write-once session.**
      Per-email `returnDeadline` is computed once, at extraction time
      (`lib/extract.ts`'s `computeDeadline`, called from the extraction
      pipeline), using only that email's own fields, and persisted to
      `Email.returnDeadline` permanently — never recomputed afterward,
      even when the order's underlying fields later change.
      **Concrete, verified symptom:** Zara #54421192781's order page now
      correctly shows `returnDeadline: Sep 15` (fixed by today's orderDate
      backfill, commit `165ba45`), but its order_confirmation email's own
      `Email.returnDeadline` still reads `Sep 23` — hand-verified live
      immediately after the backfill ran. The order-level value updates;
      the per-email snapshot doesn't, so the two surfaces now disagree in
      exactly the way the original diagnosis (commit `179389e`) predicted
      they would. **Not a hypothetical — reproduced end-to-end.**
      **Fix scope TBD, three candidates, not decided or built here:**
      (a) recompute `Email.returnDeadline` whenever an `Order` write
      changes one of its inputs (touches `lib/linkOrder.ts`'s merge path
      again, adds a new write trigger); (b) stop persisting it on `Email`
      at all and compute live wherever it's rendered (cleanest, but needs
      a check first for anything that reads the stored value directly —
      reminder emails, cron jobs — before it's safe to drop); (c) leave it
      stored but label the email-detail render as "deadline as of when
      this email was processed," making the staleness explicit instead of
      silently wrong. **Needs an owner call on which**, then its own
      build session — not sized further here.

- [ ] **Backfill forward-resolver (`classifyForwardType`/`resolveAnchorDate`)
      against pre-2026-07-26 Email rows — PROMOTED from 👀 Watching
      2026-08-27, end-of-day close-out on the orderDate write-once
      session.** The orderDate diagnosis session's Part 1 finding
      (commit `179389e`): all 6 previously-flagged orders (MANGO F4VLSF,
      Ruti 424051, Bettervits USA 444466, H&M 66993117803, Sidekick
      SK213978, Tuckernuck TNK6875105) have `forwardType`/`anchorDate`
      null not because the resolver ran and found nothing, but because
      every one of their emails predates the resolver shipping
      (2026-07-26) — it never ran on these rows at all. Read-only
      verification the same session (re-running `classifyForwardType`/
      `resolveAnchorDate` against their actual stored content, no
      writes): **all 6 come back `forwardType: "manual"` with a real,
      parseable `anchorDate`** from the quoted forwarded header. The
      signal isn't missing — it's just never been extracted.
      **High expected value: recovers real, user-visible wrong-orderDate
      cases using existing code, no new logic.** Would directly unblock
      re-running today's orderDate backfill (see ✅ Done /
      `HISTORY.md` 2026-08-27) against a materially larger population —
      today's backfill only reached order_confirmation emails with
      `forwardType`/`anchorDate` already populated, which structurally
      excludes every pre-2026-07-26 row regardless of priority tier.
      **Scoped as its own session, three phases, same discipline as
      today's orderDate fix:**
      1. Read-only diagnostic first — how many `Email` rows predate
         2026-07-26, what fraction re-derive a clean
         `forwardType`/`anchorDate` when the existing pure functions run
         against their real stored content (not just the 6 known cases),
         and whether re-deriving surfaces any NEW disagreement-pattern
         orders (see the Multi-email signal disagreement Watch entry
         below — check for this explicitly, don't assume it's clean).
      2. Backfill SQL for owner review (SELECT-first, idempotent,
         commented rollback — same pattern as today's two backfills).
      3. Apply only after explicit owner sign-off, then re-run (or
         extend) the orderDate backfill against the newly-classified
         population.
      Not built this session.

- [x] **CLOSED 2026-08-27 — see ✅ Done ("Timezone drift across
      calendar-date rendering") and `HISTORY.md` 2026-08-27 for the fix.
      This entry, plus the two pre-existing timezone entries it turned out
      to share a root cause with (🐛 Bugs / Annoying, "`orderCardState.test.ts`
      timezone-dependent assertion..." NEW 2026-08-25; 🐛 Bugs / Cosmetic,
      "[Low] Timezone off-by-one in `orderCardChip`'s Arrives-date label"
      NEW 2026-08-21), are all resolved by the same commit — closed
      together, not left as duplicates. Original diagnosis preserved
      below, not edited, per this board's Done-log convention.**
- [ ] **Dashboard/detail date drift on #54421192781 — live, reproduced in
      Safari + Chrome, not a stale render. NEW 2026-08-27, DIAGNOSED
      2026-08-27, read-only, 0 billed calls
      (`scripts/pm-diag-forward-mechanism-and-drift-20260827.ts`).**
      **This is the same known, already-logged, already-deferred bug as
      the two existing 🐛 Bugs entries "`orderCardState.test.ts`
      timezone-dependent assertion..." (Annoying, NEW 2026-08-25) and
      "[Low] Timezone off-by-one in `orderCardChip`'s Arrives-date label"
      (Cosmetic, NEW 2026-08-21) — not a new mechanism, a concrete
      real-order manifestation of that one.** Re-queried the DB live (not
      cached, not last session's snapshot): `order.estimatedDeliveryDate`
      and `order.deliveryDate` are BOTH `2026-08-24T00:00:00.000Z` —
      identical, UTC-midnight. The DB does not disagree with itself. Both
      surfaces read fields that resolve to this same instant; the drift is
      a render-time transform, not a data bug:
      - **Dashboard card** (`app/OrderCard.tsx`, `"use client"` — runs in
        the user's browser) → `computeOrderCardState`/`orderCardChip`
        (`lib/orderCardState.ts:93`) → `estimatedDeliveryDate.toLocaleDateString(undefined,
        ...)` with no explicit timezone → renders in the **browser's
        local timezone** (Pacific, UTC-7 in August) → `2026-08-24T00:00Z`
        = `2026-08-23T17:00 PDT` → **"Arrives Aug 23."**
      - **Detail page** (`app/(app)/orders/[id]/page.tsx` — a Server
        Component, no `"use client"`) → its own `formatDate()` helper on
        `deliveredAt ?? estimatedDeliveryDate ?? deliveryDate` → same
        `toLocaleDateString(undefined, ...)` pattern, but this one runs in
        **Vercel's server process (UTC)** → `2026-08-24T00:00Z` stays
        Aug 24 in UTC → **"Delivery Date Aug 24."**
      Same field, same value, two different execution timezones (client
      browser vs. server process) for the same unqualified
      `toLocaleDateString` call. This is exactly the mechanism the two
      existing timezone entries already diagnosed in the abstract
      (`__tests__/orderCardState.test.ts`'s `Aug 15` seed rendering as
      `Aug 14` on Pacific machines) — this session confirms it live,
      end-to-end, on a real production order, with two real users-visible
      surfaces disagreeing as a direct result.
      **Fix scope (not applied, flagged for the build session):** same
      owner (a)/(b) decision already blocking the existing entries —
      render in the date's own calendar day (UTC) always, or render in
      the user's local timezone consistently everywhere. Once decided,
      the fix is mechanical and narrow: every `toLocaleDateString`-adjacent
      call in the delivery-date render path
      (`lib/orderCardState.ts:93`, `app/OrderCard.tsx`'s and
      `app/(app)/orders/[id]/page.tsx`'s local `formatDate` helpers) needs
      the same explicit timezone handling, applied consistently across
      both the client and server render paths — a partial fix (e.g. only
      the card) would just move the disagreement rather than close it.
      **Independent of the deliveredAt backfill (Option A) above — can be
      built in parallel, does not block or get blocked by it.** Not fixed
      this session (diagnosis only, per session scope).

- [x] **Verify item 315 (card-geometry + order state machine) deploy state —
      NEW 2026-08-26, READ-ONLY diagnostic, 0 billed Anthropic calls.**
      Board said "Not yet deployed"; owner says it's live. Resolved via
      git/Vercel cross-reference — **DEPLOYED**, confirmed live in
      production. See session report; drafted update text for item 315
      handed to owner, not applied directly (per instruction).
- [x] **Routing tree design for needs-review bucket action selection — NEW
      2026-08-24, SUPERSEDES the "default-action heuristic" entry
      (🟡 Next).** That entry implicitly assumed a decision tree existed
      and needed better defaults. This session's read-only diagnostic
      (`scripts/pm-diag-needsreview-action-routing-20260824.ts`, deleted
      2026-08-24 close-out, superseded) confirmed: no tree exists.
      `lib/needsReviewRows.ts:67-74` has one branch (exact orderNumber
      match) and one fallback (`real_purchase_no_record`), which
      `lib/needsReviewActions.ts:47-48` maps to "Start a new order."
      `emailType` is not even fetched by either call site's Prisma select
      (`app/(app)/page.tsx:86`, `app/(app)/needs-review/page.tsx:36`).
      **SCOPE: design pass first, not build.** Session 1 = enumerate
      branches needed + correct action per branch + which fields the Prisma
      selects have to start fetching. Branch shapes to work out at minimum:
      return-side (return_label/refund with recoverable parent link),
      purchase-side no match (real orphan → Create), noise (non-e-commerce
      → Archive), residue (pre-gating carrier/promo → Archive), duplicate
      (same-order already present → Merge or dedupe). Session 2 = build,
      after owner reviews the design.
      **PRE-CODE VERIFICATION:** the 2026-08-24 diagnostic's 19-row table is
      90% of the baseline. Extend it to include an "expected action under
      proposed tree" column and commit alongside the design doc
      (paper-trail pattern from the 2026-08-23 H&M fix,
      `scripts/pm-verify-resolvebodytext-hm.ts`).
      **DEPENDENCIES: none blocking.** H&M attachment dependency from the
      old entry is discharged (2026-08-23 fix). Chan Luu dependency
      reframed as a data-integrity issue re: the synthetic `HRYTSJRJ` order
      (tracked separately, not blocking this).
      **NOT IN SCOPE:** the residue-cleanup sweep (separate 🟡 Next task,
      can run in parallel or after); the 4 deferred H&M/Chan Luu refund
      rows (still waiting on the `lookupReturnPolicy` bug); the Chan Luu
      new-order-number-on-return pattern (separate future entry).
      **SESSION 1 COMPLETE 2026-08-24 — design doc ready for owner review,
      not built.** Full design → `NEEDS_REVIEW_ROUTING_DESIGN.md` (repo
      root, follows `CARD_SPEC.md`/`return-window-design-tokens.md`
      precedent for design-doc location). Four-branch tree proposed
      (exact-match → Link; return_label/refund → Link, NEW; purchase-side
      with signal → Create; everything else → View detail, NEW
      `no_extraction_signal` reasonId). Verified against the live 19-row
      population: 8/18 email-kind rows change action (all
      Start-a-new-order → More-info; zero move to Merge in today's snapshot
      — the Link-on-return-type branch exists for the next H&M-shaped
      recurrence, not because it changes anything visible today).
      Pre-code verification committed: `scripts/pm-design-needsreview-
      routing-tree-20260824.ts`. Only `emailType` needs adding to the two
      Prisma selects — `extractedAt` turned out not to be a routing input.
      Three CARD_SPEC.md Part 3 amendments proposed for owner sign-off
      (design doc §5), not applied. Spawned one 🐛 Bugs entry (Infra/
      reliability, cross-referencing the 2026-08-21 Done entry above).
      **[2026-08-24 close-out]** Design pass complete —
      `NEEDS_REVIEW_ROUTING_DESIGN.md` committed with pre-code verification
      script. Owner review complete. Spec amendments A+B applied to
      `CARD_SPEC.md` Part 3; C deferred (see spec note). Build session
      ready to schedule. Owner UX call about collapsed bucket rows
      formalized as `CARD_SPEC.md` Part 3 amendment D in this commit — no
      separate build-session reconciliation needed.
      **MOVED HERE FROM 🟡 Next, 2026-08-24 close-out follow-up** — design
      pass complete, spec amendments applied, next session is the build
      session; belongs in Now for that session to start clean. Per the
      header's scope-control rule, this move should have happened before
      the design session began — flagged, not re-litigated. **Next
      session starts the build (Session 2).**
      **[2026-08-25 Session 2 — build complete, awaiting owner
      verification, NOT ✅.]** All four branches + two new reasonIds +
      collapsed-row control set implemented per
      `NEEDS_REVIEW_ROUTING_DESIGN.md` §2 and `CARD_SPEC.md` Part 3
      amendment D. `lib/needsReviewRows.ts:49-81` (`EmailReviewInput`
      gains `emailType`; `detectEmailReviewReason` rewritten to the
      four-branch tree — [now five branches after the 2026-08-28 carrier
      addition and the 2026-08-30 shipment_unlinked rename/expansion, see
      the shipment_unlinked ticket below]). `lib/needsReviewReasons.ts:11-20,29-38` (two new
      reasonIds + their exact spec sentences). `lib/needsReviewActions.ts:
      45-50` (`return_or_refund_no_link` added additively to the
      `link_to_order` branch; `no_extraction_signal` needs no new branch —
      falls through the existing degrade `else`, untouched). Prisma
      selects: `app/(app)/page.tsx:86`, `app/(app)/needs-review/page.tsx:
      36` both add `emailType: true` — grep confirmed no third
      `EmailReviewInput`-building call site exists. Collapsed-row control
      set: `app/NeedsReviewRow.tsx:72-96` — email-kind rows now render
      `{primary action, Archive (NEW standing control, `not_a_purchase` →
      `archiveOrphanedEmailAction`, already-wired), optional More info}`;
      order-kind rows unchanged (amendment D's "primary action from the
      routing tree" ties to the design doc's email-kind-only scope — see
      code comment at `app/NeedsReviewRow.tsx:29-38` for the reasoning,
      flagged here as an interpretation call, not an owner-confirmed
      literal instruction, since order-kind rows have no archive
      mechanism to wire to). Order-kind routing (`needsReviewActions.ts:
      43-44`) and the existing degrade path (`:49-51`, now the tail of an
      unchanged if/else chain) both confirmed untouched. Pre/post-code
      `pm-design-needsreview-routing-tree-20260824.ts` snapshots are
      byte-identical (0 DB drift) and match the design doc's exact
      prediction: 8/18 email-kind rows move Start-a-new-order → More
      info, 0 move to Merge (no live return/refund orphan exists yet —
      branch 2 verified instead via a seeded unit-test row, not prod
      data, per the session brief). 20/20 tests pass in
      `__tests__/needsReviewRows.test.ts` +
      `__tests__/needsReviewActions.test.ts` (both extended with explicit
      per-branch cases, including a seeded `emailType: "refund"` row
      confirming `return_or_refund_no_link` → "Merge with existing
      order"). `npx tsc --noEmit` and `npm run build` both clean (two
      pre-existing, unrelated failures noted and left alone:
      `anthropicUsage.test.ts` type errors, one timezone-sensitive date
      assertion in `orderCardState.test.ts` — both confirmed via
      `git stash` to predate this session). 0 billed Anthropic API calls
      (diagnostic script is read-only + non-model; no code change adds a
      model call). **Status: awaiting owner hand-verification in
      production before ✅** (dev-server smoke test only — no browser
      auth session available in this session; both `/` and
      `/needs-review` returned 307 redirect-to-login with no server
      error, confirming no runtime crash, but the actual three-control
      row rendering has not been eyeballed live). Commit/push/deploy
      status: see this session's close-out report.
      **[2026-08-25 — Session 2 hand-verified in prod, ✅ Done.]**
      Owner hand-verified deployed behavior at `app.myreturnwindow.com`
      against live population (19 email-kind orphan rows).

      **Verified working as designed:**
      - Branch 1 (`belongs_to_existing_order` → Link): no live rows
        exercise this today; classifier logic verified via unit test
        path per Session 2 report.
      - Branch 2 (`return_or_refund_no_link` → Link): no live rows
        exercise this today (no return/refund orphans in DB, as design
        doc §3 predicted); classifier logic verified via unit test.
        First real return/refund orphan arriving will exercise the
        branch in production; watch for it.
      - Branch 3 (`real_purchase_no_record` → Create, narrowed): 10 of
        19 rows correctly route here.
      - Branch 4 (`no_extraction_signal` → View detail degrade): 9 of
        19 rows correctly route here with the canonical sentence
        ("We couldn't extract any details from this email.") rendering
        in slot 3. Verified via `scripts/pm-verify-branch4-shipped-
        20260825.ts` (committed same day).
      - Collapsed-row two-shape rule: mapped rows render 3 controls
        (primary + Archive + More info); degrade rows render 2
        controls (Archive + More info); no duplicates. Verified in
        hand-verification of `/needs-review` page.

      **Live-data drift note:** design doc §3 predicted 8/18 rows on
      `no_extraction_signal`; actual live is 9/19 (one new orphan
      arrived between design and hand-verification, also correctly
      branch-4). Not a bug — expected drift as new emails arrive.
      Documented for future-reader clarity.

      **Session-2-adjacent findings NOT blocking ✅** (all logged
      separately as their own entries, do not conflate):
      - HTML-scanning fallback not triggering on Buff / H&M shapes
        → 🐛 Bugs Trust-breaking, new 2026-08-25.
      - `orderCardState.test.ts` timezone-dependent assertion
        → 🐛 Bugs Trust-breaking (assumed placement — CC prompt for
        that entry may not have been sent yet at time of this update;
        if not present, that's expected).
      - `anthropicUsage.test.ts` stale type fixture → 🟡 Next.
      - Elevate bucket-residue-cleanup priority → 🟡 Next.
      - Order-kind Archive not-yet-wired (from Session 2 B1) → 🟡 Next,
        added by CC end-of-Session-2.

      **Deploy-first-not-preview-first process note:** this session
      deployed to prod before hand-verification. TASKS.md header rule
      was not violated (rule gates ✅, not deploy timing), but preview-
      first is the intended discipline in this feature area and was
      missed. Not repeated in future sessions — preview-first is the
      default going forward for the needs-review bucket work.
- [x] **Read-only diagnosis of needs-review bucket action-routing — NEW
      2026-08-24, owner-directed, SCOPE-CAPPED (0 billed Anthropic calls, 0
      writes, no re-extraction) — COMPLETE, reported to owner 2026-08-24.**
      Diagnostic script (uncommitted, same pattern as the Caroline RealReal
      script — paper trail only, not shipped code):
      `scripts/pm-diag-needsreview-action-routing-20260824.ts`.
      **Count correction:** bucket is 19 rows live (18 email-kind orphans + 1
      order-kind), not 21 — flagging the discrepancy, not resolving it.
      **Root cause, exact lines:** `lib/needsReviewRows.ts`'s
      `detectEmailReviewReason` (L67-74) has exactly one branch — exact
      `orderNumber` match against existing orders (L68-72); every other case
      unconditionally falls through to L73 `return "real_purchase_no_record"`.
      `emailType` is never consulted — it isn't part of `EmailReviewInput`
      (L49-56) and isn't even fetched by either call site's Prisma `select`
      (`app/(app)/page.tsx:86`, `app/(app)/needs-review/page.tsx:36`).
      `lib/needsReviewActions.ts:47-48` then routes `real_purchase_no_record`
      → `create_new_order` ("Start a new order"). No short-circuit beyond
      this single branch; `hasRetailer` isn't consulted in routing at all
      (dropped 2026-08-21, confirmed via this session's read).
      **Whole Foods row: CONFIRMED** renders "Start a new order" — but it's 3
      duplicate rows, not 1, and `extractedAt` is null on all three
      (extraction never ran, not just "no retailer found"). Matches the
      expected pre-08-19-grocery residue sub-population.
      **"Every row except Anthropic … including `return_label` emails":
      partially confirmed, partially not supported by data.** The
      except-Anthropic part is right (that's the one order-kind row, always
      routes to "More info"). The `return_label` part isn't observable
      today: 0 of the 18 current orphans have `emailType` return_label or
      refund — every return_label/refund email in the DB is already linked
      (`orderId` not null) and structurally excluded from this query
      entirely. **The 4 deferred H&M/Chan Luu refund rows: checked
      directly — none appear in the bucket at all right now** (2 of the 4
      parent orders have `needsReview=false`, so no bucket row at all; the
      other 2 have `needsReview=true` but that only ever renders "More
      info," never "Start a new order," for order-kind rows under current
      code). The "if they render Start a new order that's the misfire"
      framing doesn't apply — that scenario can't happen under current code.
      **Residue-cleanup ballpark (🟡 Next entry):** of the 18 current
      orphans, 6 tag as USPS-pregating residue, 3 as pre-08-19-grocery
      residue (the Whole Foods triplet), 0 currently match the promo-outage
      domains (`em.target.com`/`email.bloomingdales.com` — that
      sub-population's ~3 rows from the 2026-08-21 census are no longer in
      the orphan set). Read-only ID script effectively exists already (this
      session's diagnostic script); an owner-confirmed deletion pass would
      be a short follow-up, well under an hour. Risk: domain/date tagging is
      a heuristic — confirm subject/content shape, not just sender domain,
      before any deletion.
      **Default-action heuristic (🟡 Next, line ~2503) NARROW/BROAD
      framing:** NARROW (emailType gate on return_label/refund) would fix
      **zero** of the 18 current orphans — none have that emailType. The
      actual, currently-visible bug is broader: every orphan of any
      emailType (delivery, shipping_confirmation, or never-extracted) falls
      through the same single fallback branch. Evidence does not support
      promoting NARROW as currently scoped — the framing doesn't match
      what's actually broken today; re-scoping (or scoping the broader
      fallback-branch problem) would need owner input before promotion.
      BROAD's parking: checked the Chan Luu return-approval orphan directly
      — it is not an orphan (linked to a synthetic `HRYTSJRJ` order, the
      already-tracked Happy Returns/third-party order-number gap, 🟡 Next).
      Doesn't clear the dependency (structural gap unchanged) but confirms
      rather than assumes its shape — no new information changes BROAD's
      parking.
- [ ] **Caroline's The RealReal order #R268770184, $7,921.75 — owner reports
      it's the sum of OTHER items in the order, not the item she actually
      purchased/received in this shipment. NEW 2026-08-22, READ-ONLY
      diagnostic this session (`scripts/pm-diag-caroline-realreal.ts` +
      raw-body pull, uncommitted), 0 billed Anthropic calls, 0 writes,
      scoped to Caroline's account only. [needs clarification] — root cause
      not yet resolved to one side or the other, see below.** Pulled and
      decrypted both linked `shipping_confirmation` emails' raw `htmlBody`
      directly. Each email has a real, distinct structure: **`Shipped
      Today:`** names exactly ONE item (email 1: "Coco Shop Floral Print
      Long Dress"; email 2: "Gucci Horsebit Accent Leather Sandals") — no
      price given for either. Separately, both emails carry an identical
      **`Other Items In This Order:`** section listing the other 8 pieces
      with prices (Prada ×2, Tory Burch, Chanel $2980, Hermès $2340, TOTEME
      $1137.50, Bottega Veneta $837, etc.) — summing to $7,921.75.
      Extraction summed the "Other Items In This Order" list (the only
      priced items available) and did NOT include the actual "Shipped
      Today" item in the sum since it carries no price in either email —
      `extractionNotes` says this plainly on both rows ("no grand total was
      stated directly ... two additional items ... were omitted from the
      sum, so the true order total is likely higher"). Searched the full
      decrypted body for recommendation/cross-sell language ("recommend,"
      "you may also like," "picked for you," etc.) — **none found.** The
      email's own heading literally reads "Other Items In This Order," which
      reads as a genuine multi-item order manifest (RealReal is a
      multi-consignor marketplace; one checkout commonly ships as several
      parcels over days/weeks, each email listing what shipped today plus
      the rest of the order for reference), not a marketing widget disguised
      as one. **Two live explanations, not distinguishable from our data
      alone:** (a) this genuinely is one 9-item order and Caroline is
      misremembering/hasn't tracked that she bundled that many pieces into
      one cart across staggered shipments — no bug, nothing to fix; (b)
      RealReal's own template is grouping items from a SEPARATE order/cart
      under this order's "Other Items In This Order" section for shipping-
      consolidation reasons, and our extraction is faithfully reproducing a
      retailer-side mislabeling — real bug, but the fix (stop trusting
      "Other Items In This Order" as this order's total) needs Caroline to
      confirm the mismatch first. **Next step: ask Caroline to check her own
      RealReal purchase history for #R268770184 and confirm whether all 9
      named items are genuinely hers** — not guessable from the email
      content or our DB alone.
- [ ] Postmark rejected-path backward sample — NEW 2026-08-18, candidate
      read-only investigation, not started. Emails Haiku drops
      (non-commerce → no Email row) are retained in Postmark with full
      content + headers for the account retention window (45 days
      default, adjustable 7-365; VERIFY our actual setting live) and are
      retrievable read-only via the Messages API. Gives a backward sample
      of the rejected population for the recent window — match Postmark
      inbound against Email rows by MessageID; present-in-Postmark-but-no-
      row = the rejected set. Limits: window-bounded (recent ~45d only);
      Postmark has the email but NOT Haiku's verdict or per-call cost, so
      labeling a sample by hand (free, ~50-100 emails) or re-running
      classification (BILLED — state count first) is needed to answer "how
      much of what Haiku rejected was actually commerce." Complementary to
      the forward measurement layer, not a replacement. Verify live: (a)
      Postmark retention setting, (b) Messages API credentials still
      wired.

- → see DECISIONS.md 2026-07-23 ("STANDING CORRECTION: Needs Review panel registry superseded") — originally a standalone note here in 🔴 Now.
> 1. ~~Manual link, Fitness Superstore `#48868`~~ — done, see ✅ Done.
> 2. ~~Apply `scripts/backfill-junk-other-emails.ts`~~ — done, see above.
> 3. → folded into the "Unified card geometry + order state machine"
>    item, 2026-08-10 (moved from 🙋 Waiting on Owner to 🔴 Now; that item
>    is now in ✅ Done, confirmed deployed 2026-08-26 — no longer "above").
> 4. **Connect the email-level "Needs review" badge to the panel.** Must
>    come AFTER Task 2 (now satisfied) — un-junked promotional email would
>    have flooded a surface built for the real orphaned-genuine-commerce
>    emails. Not started today unless owner says so.

- [ ] **Exclude Amazon from the Sunday returns digest — BUILT, committed
      (`fd5ec95`), and pushed 2026-08-10. Deploy triggered on push; not yet
      hand-verified live. Pure content filter, 0 billed Anthropic calls,
      0 writes.**
      `app/api/cron/weekly-digest/route.ts` — filter Amazon out of the
      "due this week" content selection (the forward-looking `sevenDaysOut`
      query, which is separate from and does NOT touch
      `lib/weeklyDigestDedup.ts`) using strict `isAmazonOrder(retailer)` from
      `lib/amazonBundle.ts` (strict only — Whole Foods / Zappos excluded by
      design). Apply in the shared content selection so both the normal and
      `?force=true` paths are covered. Import cycle: import `isAmazonOrder`
      INTO the route, not into a lib amazonBundle imports — same clean shape
      as the shipped cron reminder skip (`90dccd0`); confirm via grep +
      `npm run build`. **Empty-week behavior — DECIDED: on an all-Amazon
      week the digest STILL SENDS (weekly touchpoint retained during alpha).
      No skip-empty logic; zero-returns fallback copy unchanged.** Global for
      all users (no per-user preference infra). Supersedes the 2026-08-04
      "visibility comes from the digest only" rationale — see Decisions log.
      **Tests:** new `__tests__/weeklyDigestAmazonExclusion.test.ts`
      (route-mock convention, matching `__tests__/cronAmazonSkip.test.ts`,
      since the filter lives inline in the route) — 5 cases: Amazon row
      excluded / non-Amazon row retained / Amazon excluded under
      `?force=true` / mixed batch drops only Amazon / all-Amazon week still
      sends (no skip-empty). 521/521 full suite passing, `npm run build`
      clean. **VERIFY BY: real Sunday 16:00 UTC cron fire — no ✅ until owner
      hand-verifies in production.**

- [ ] **Amazon return-window default (30 days), forward short-circuit —
      Step 1 BUILT on branch `amazon-return-window-default` 2026-08-09,
      MERGED to `main` (`b2fbc10`) and PUSHED to `origin/main` this
      session — confirmed via `git log`/`git merge-base --is-ancestor`,
      not just taken on the owner's word. Awaiting owner hand-verification
      in production — not ✅ until then. Step 2 backfill APPLIED,
      owner-approved (detail below). 0 billed Anthropic calls, 0 writes
      beyond the approved Step 2 backfill. Owner decisions locked
      2026-08-08. Grocery decoupled — separate task below.** **Headline: 94
      of 99 Amazon-retailer emails ever received
      (95%) already carry `policySource: "web_lookup"`** — i.e. already
      triggered a billed Sonnet+web-search call historically that
      deterministically resolves to ~30 days; that's the volume this rule
      stops paying for going forward. (Order-level proxy 51/52 — the
      cited prior snapshot of 83 is a units difference, not investigated
      further, per owner.) **Step 1:** `lib/extract.ts` — before
      `lookupReturnPolicy()` fires, `isAmazonOrder(retailer) &&
      emailType !== "other"` with no stated window now sets
      `returnWindowDays: 30`, `policySource: "amazon_default"` (new
      `PolicySource` variant), and the lookup call is skipped entirely,
      not just overwritten after. New value threaded through
      `mapPolicySource()` (`lib/linkOrder.ts`) and the order/email detail
      page display ternaries; schema comments updated (no migration — both
      fields are untyped `String?`). Guard preserved: orders with a
      resolved window for any other reason never reach the new branch, so
      the 3 flagged-for-tier-confidence rows are untouched by construction.
      `npx tsc --noEmit` clean on all touched files (10 pre-existing
      unrelated test-file errors confirmed via `git stash`, same before and
      after). **Step 2 APPLIED 2026-08-09, owner-approved.** 1 row
      (`cms0p1qi00005l204zy6iq57m`, Amazon, order `113-5215249-6165864`):
      `returnWindowDays` null→30, `policySource` null→`amazon_default`,
      `returnDeadline` null→2026-08-24 (`deadlineIsEstimated: true`,
      anchored on `orderDate` since no `returnWindowStartsFrom` was ever
      stated), `needsReview` true→false via the existing
      `recomputeOrderStatus()` (byproduct, not hand-set) — `status` also
      advanced to `returnable`. Verified after: total `needsReview: true`
      orders (all retailers) 22→21, exactly the expected delta; all 3 guard
      rows re-checked unchanged (`returnWindowDays: 30`, `policySource:
      web_lookup`, `needsReview: true` — untouched); 0 non-Amazon rows
      touched. **Merged + pushed** — branch
      `amazon-return-window-default`, merge commit `b2fbc10` on
      `origin/main`, awaiting owner hand-verification in production (not
      Done until then, per this board's own rule). Marketplace-seller
      simplification logged in `DECISIONS.md` 2026-08-08.
- [ ] **Amazon grocery exclusion (Whole Foods / Amazon Fresh) — decoupled
      2026-08-09, RETIRED 2026-08-21 during main/origin-main
      reconciliation: superseded by the broader food + grocery delivery
      exclusion task before this branch's line ever started it (see ✅
      Done — that entry's own text confirms this one was "superseded ...
      and deleted as part of this promotion"). Not built independently,
      not carried forward as open work.**
- [ ] **Historical `emailType` census (cost-priority input) — DONE
      2026-08-05, READ-ONLY, confirmed zero billed Anthropic calls, zero
      writes.** Follow-on to the Aug-4 backfill's small-sample finding
      (95/133 outage-window emails were `emailType: "other"`). Confirmed
      at full scale, 743 total emails: **`other` is 373 rows — 50.2% of
      all emails, 51.1% of all billed extractions (730 processed;
      excludes 13 rows where extraction was never even attempted).** Over
      half of every Sonnet extraction call ever billed was spent on mail
      that turned out to be marketing. **98.1% of those `other` rows
      (366/373) are already junked** — confirms the earlier 2026-07-23
      finding at 2x the prior scale: the app already catches this
      content, just strictly *after* paying full Sonnet-extraction cost
      for it, not before. Only 7 `other` rows are still live/unjunked.
      **Gating, static-read confirmed:** the Haiku commerce-classifier
      (`isCommerceEmail()`, `lib/classify.ts`) is the ONLY gate, and it
      runs *before* the `Email` row is even created
      (`app/api/inbound/route.ts`) — a non-commerce verdict there means
      no row and no extraction cost at all. Once a row passes that gate
      and is created, `runExtraction()` calls `extractEmail()`
      **unconditionally** — no secondary check, no confidence threshold,
      nothing between Haiku's verdict and the paid Sonnet call. Full
      `emailType` distribution: `other` 373 (50.2%), `shipping_confirmation`
      129 (17.4%), `order_confirmation` 105 (14.1%), `delivery` 64 (8.6%),
      `null`/never-resolved 32 (4.3%), `return_label` 28 (3.8%), `refund`
      12 (1.6%). **Reframes the cost-priority question, not decided
      here:** since virtually every `other` row already gets caught (just
      late), the Haiku gate's own false-positive rate — roughly a coin
      flip, letting ~half of what becomes `other` through as COMMERCE —
      is the actual lever, not the retailer-policy cache (which only
      protects the ~49% that isn't marketing). A pre-extraction filter or
      a stricter/second-pass classifier check would be a different, and
      on these numbers likely bigger, win than PHASE 1a/1b — owner
      decision, not built here.
- [ ] **Suppress Amazon deadline reminders — IMPLEMENTED 2026-08-04, tests +
      build clean, COMMITTED (`90dccd0`), PUSHED, DEPLOYED (confirmed live
      on `app.myreturnwindow.com` as of this session's close-out,
      2026-08-05) — awaiting owner hand-verification in production, not
      yet Done.** Confirmed owner decision: Amazon orders must not get the
      standalone 7/2/1/same-day deadline reminders — visibility comes from
      the Sunday digest / Friday coverage-check only, applying
      `AMAZON_HANDLING.md`'s awareness-only principle to reminders (a
      deadline nag is an action prompt, which v1 doesn't do). Net-new
      enforcement, not a repaired guard — `lib/reminders.ts` had zero
      Amazon references before this. **Diagnostic-first catch: the
      session brief's file path (`app/api/cron/reminders/route.ts`)
      doesn't exist — the real cron lives at `app/api/cron/route.ts`**
      (confirmed by directory listing before editing anything); implemented
      against the real file. **Option A (cron-loop skip), not Option B
      (pure-function rule)** — one line, `if (isAmazonOrder(order.retailer))
      continue;`, added at the top of the order loop before `reminderType`
      is computed, covering both the normal and `?force=true` paths since
      both flow through the same loop. Reuses `isAmazonOrder` from
      `lib/amazonBundle.ts` unchanged. **Import-cycle check, as flagged in
      the brief:** `amazonBundle.ts` imports `daysUntil` FROM
      `reminders.ts`; importing `isAmazonOrder` INTO `route.ts` (not into
      `reminders.ts`) avoids the cycle entirely — confirmed via grep (
      neither `reminders.ts` nor `amazonBundle.ts` imports from
      `route.ts`) and a clean `npm run build`. **Tests:** new
      `__tests__/cronAmazonSkip.test.ts`, 6 cases (Amazon order skipped /
      still skipped under `?force=true` / non-Amazon order unaffected /
      existing estimated-deadline suppression unchanged / case-insensitive
      match / mixed batch skips only the Amazon row) — full-route mock
      pattern matching `__tests__/inboundDedup.test.ts`'s convention, not
      cron.test.ts's pure-function-only pattern, since the skip lives
      inline in the route. 504/504 full suite passing, `npm run build`
      clean. **Open question, not decided here (per brief's explicit
      scope):** whether the same carve-out should apply to
      `runRefundCheckinReminders()` (`lib/refundCheckin.ts`) — a different
      reminder type, not touched this pass, plausibly the same
      awareness-only logic but a separate owner decision. **Also flagged:**
      `amazon-per-email-reminder-cadence` (🟡 Next, MORE per-email Amazon
      reminders) is the opposite direction from this fix (fewer/none) —
      needs owner reconciliation, not resolved here. **Zero billed
      Anthropic calls — pure logic change, tests mock the DB, no live or
      forced send run.**
- [ ] **Orphan census refresh — NEW 2026-08-04, READ-ONLY, 0 billed
      Anthropic calls, 0 writes.** Systematic re-count of the four
      no-resolve-path populations first sized 2026-07-23 (orphaned
      genuine-commerce 20, extraction failures 35 [23 ran-and-failed + 12
      never-ran], linked-but-flagged 108, junked 174 — ~337 total,
      `rescueEmail()` still zero call sites), against current data
      post-Aug-outage. Also: categorize the orphaned genuine-commerce
      bucket by linking-failure mode (no `orderNumber` / `orderNumber`
      present but no matching order / candidate order exists but no
      fallback matcher fired) to size and scope the no-fallback-matcher
      gap (`findRefundFallbackOrder` only covers `refund`-typed emails,
      diagnosed 2026-07-22) as design input for a real fix. Plus a
      cross-user security cross-check on orphans/dupes (per-row
      `userId` match against candidate order's `userId`), specifically
      resolving the Alex Moser Jul 31 Wayfair pair (linking gap vs. a
      new instance of the cross-user exposure class already tracked
      above). Scripts import only `@prisma/client`, never
      `runExtraction`/`extractEmail`. Report only, no fixes.
- [ ] **Re-extract the Aug 1–4 credit-outage orphans — PHASE B DONE
      2026-08-05, 103/104 repaired, 1 residual flagged, awaiting owner
      review (not hand-verified in production).** Ran in 4 passes (one
      initial + three resumes) after two distinct infra interruptions —
      see `HISTORY.md`/session detail for the full trace: a Neon
      connection drop crashed the first pass at row 87/104 cleanly (no
      corruption, idempotent resume worked as designed); a second issue
      was traced to one specific row (`cmsdunton...`, retailer "Suzie
      Kondi") whose `lookupReturnPolicy` call hangs near the Anthropic
      SDK's default timeout, long enough for Neon to auto-suspend and
      wedge the rest of that run's DB connections — isolated and skipped
      rather than retried blindly a third time. **103 rows repaired, 32
      newly linked to an order.** Actual cost came in under the Phase A
      estimate: 132 billed calls (105 extraction + 27 lookup) vs. the
      ~176 estimated — the real lookup-trigger rate (~26%) was well below
      the 70% precedent used for the estimate. Confirms `webSearchRequests`
      logging is correct in production: all 27 real `policy_lookup` calls
      logged `webSearchRequests: 3` (the max), closing that open
      verification item from the cost-visibility pass.
      **Still open, not resolved this pass:**
      1. **`cmsdunton0001gt04vm8msv9m`** ("Suzie Kondi") — still
         `emailType: null`. A bounded per-call timeout on
         `lookupReturnPolicy` (`lib/extract.ts`) would fix this properly,
         but that's a production code change needing sign-off, not
         something to slip into a backfill script — flagged, not built.
      2. The 18-row pre-bound failure cluster
         (2026-07-31T18:01:30Z–2026-08-01T04:56:06Z) surfaced in Phase A,
         suggesting the true outage start may be ~18h earlier than the
         owner-stated bound — **deliberately excluded from this Phase B
         run** per the owner's explicit "stated 104" approval, not folded
         in silently. Also excluded, separately: 12 known 2026-07-21 rows
         (ACE VISALIA RSC/GLOBAL-E dedup-cluster dates, already tracked)
         and 1 isolated 2026-07-28T17:46:26 row.
      Same operation as the
      2026-07-26 23-row repair, new window: outage `2026-08-01T12:08:00Z`
      (13:08 BST) → restored ~Aug 4 09:00 UTC (clean extraction confirmed
      21:46 BST Aug 4). Target = emails in that window still in the
      extraction-failure state (`emailType: null`), plus any received-but-
      never-run population, both distinct from emails that extracted fine
      in the same window (those are skipped, not re-paid-for). Two-phase,
      hard stop: Phase A is zero billed calls/zero writes, reported for
      explicit owner approval before Phase B (the actual writing
      re-extraction) runs. This is also the first real production dataset
      for the `anthropic_usage` cost-visibility logging shipped
      2026-08-04, and the first real `policy_lookup` log line — closes the
      still-open `webSearchRequests > 0` eyeball check from that pass, for
      free, once Phase B runs.
- [ ] **Anthropic cost-visibility pass — IMPLEMENTED 2026-08-04, tests +
      build clean, COMMITTED (`ae9e685`), PUSHED, DEPLOYED (confirmed live
      on `app.myreturnwindow.com` 2026-08-04) — awaiting owner
      hand-verification in production, not yet Done.** Session-brief scope: per-call `anthropic_usage` JSON
      logging on all 3 call sites (`lib/classify.ts`, `lib/extract.ts` ×2)
      via new `lib/anthropicUsage.ts`, plus the `PHASE 1c`-adjacent
      "never research `other` emails" gate in `extractEmail()`
      (`lib/extract.ts`) — narrowly scoped to `emailType === "other"` only,
      not the broader delivery/shipping gating question still open below.
      Zero billed Anthropic calls this pass (all tests mock the SDK); zero
      DB reads/writes. Does NOT include: the negative/positive policy
      cache (`PHASE 1a`), the rest of `PHASE 1c` (delivery/shipping
      gating), or email-body truncation — see the session's full report.
      **Process note:** this entry itself was added after work started, not
      before, per this file's own "before starting work" rule — flagging
      the miss rather than silently correcting it.
- [x] **Re-extract the 23 core-block emailType:null rows — DATA REPAIR,
      RUN 2026-07-26, owner-confirmed, WROTE to prod.** Follow-on to the
      digest diagnostic below: the 07-19T23:55:37Z→07-20T22:52:46Z outage
      window produced 23 contiguous extraction failures on otherwise-good
      emails (confirmed distinct from the 12 ragged-tail
      redelivery-duplicate rows, which were excluded — those route to the
      content-key dedupe cleanup, not here). **Result: 23/23 repaired,
      0 still null — no genuinely-unreadable residue population exists.**
      15/23 resolved to real commerce data (retailer + orderNumber +
      linked order — 9 Amazon, plus Amazon Fresh, Honest History, Five
      Marys Ranch, Gundry MD, Etsy, DONNI). 8/23 resolved decisively to
      `emailType: "other"` with no order data — confirmed genuine
      non-commerce content on a healthy read (eBay message-thread
      notifications ×2, Bloomingdale's/RugsUSA marketing, and one
      Target promo that names the retailer but carries no order) via
      `shouldAutoJunk`'s existing orphan path, not extraction failures.
      Zero rows failed to extract cleanly. **This directly answers the
      digest-design question the owner was waiting on: there is no
      "genuinely unreadable" bucket from this outage to design around —
      every row was either real data or confirmed junk.**
      **Cost — MATERIALLY MORE than the ~23 estimate, flagged per
      instruction:** 39 total billed Anthropic calls (23 `extractEmail` +
      16 `lookupReturnPolicy`, 14 success / 2 unclear / 0 error) — 70%
      over the declared estimate, because 16 of 23 rows resolved a
      retailer with no `returnWindowDays`, triggering Phase 1a/1c's known
      extra-cost path (Sonnet + up to 3 web searches each). Consistent
      with — not new evidence against — the Phase 1a negative-cache case
      already queued in this section. Script: `scripts/reextract-
      outage-core-block.ts` (uncommitted, not run again — targets the
      fixed 23-id list, would no-op safely via its own pre-check if rerun
      since none are `emailType: null` anymore). Did NOT touch digest
      logic or make any exclude/design change — that
      decision is the owner's, gated on this repaired/residue split.
- [ ] **Friday weekly coverage-check digest badly broken — DIAGNOSTIC PASS,
      2026-07-26, promoted from 🐛 Bugs (Trust-breaking) per session brief
      (customer-facing email quality is today's priority). Read-only only —
      no fixes this pass.** Scope: defect 1 (unknown-retailer flood,
      dominant) and defect 3 (stale/wrong-window) only; defect 2
      (duplicate lines) already has a forward-only fix (`0b055df`, ⏳
      Verifying) and is explicitly not being re-solved here. Bisecting
      `JUNK_FILTER` against this week's commits (`0b055df`, `13521ca`, the
      junk-backfill) per the board's own prime hypothesis — confirm or
      kill before touching any code. See full findings once this pass
      closes (below in 🐛 Bugs, updated in place) — not duplicating the
      write-up here.
- [ ] **Coverage-check "this week" fix — defect 3 (stale/wrong-window),
      IMPLEMENTED 2026-08-05, tests + build clean, COMMITTED (`2ef71e5`,
      `20477e7`), PUSHED, DEPLOYED (confirmed `app.myreturnwindow.com`
      alias on commit `20477e7`, 2026-08-05) — AWAITING OWNER
      VERIFICATION on the next scheduled Friday run (2026-08-07), not yet
      Done. Process note: this entry itself was added after code was
      already touched, not before — flagging the miss per this file's own
      convention rather than silently correcting it.** Direct follow-on
      to the diagnostic pass above: a linked
      order whose delivery/shipping email merely arrived this week was
      being shown as if newly purchased, even when the order itself was
      placed weeks earlier (real example: Alex's Jul 31 digest showing
      Emme Parsons/Mejuri "delivery" lines for old orders).
      `app/api/cron/weekly-coverage/route.ts`'s linked-email branch now
      filters on the order's own `orderDate` (placedDate) against the
      rolling 7-day content window, not the triggering email's
      `receivedAt` — unlinked emails are unchanged, still keyed on
      `receivedAt` since they're the missing-order signal this email
      exists to surface. `placedDate` reuses `Order.orderDate` as-is
      (already the right "when placed" signal end-to-end via
      `applyFallbackOrderDate`/`resolveFallbackOrderDate` in
      `lib/linkOrder.ts` — derived from the EARLIEST linked email, never
      a later delivery email, and only when that earliest email's type
      is `order_confirmation`/`shipping_confirmation`/`delivery`). Null
      policy: a null `orderDate` (fallback couldn't resolve one) defaults
      to inclusion rather than silent exclusion — dropping it could hide
      a real this-week purchase; only excluded on positive evidence
      (`orderDate` before the window start). Dedup window
      (`scheduledRunWeekStart`) and the force-path's "never write a
      Reminder row" rule are untouched. **Amazon caveat, not fixed this
      pass:** Amazon orders' `orderDate` often falls back to `receivedAt`
      (no `order_confirmation` emailType), so this date-filter is close
      to a no-op for Amazon specifically — Amazon has its own coverage-
      grouping fix queued separately, see report.
- [ ] **PHASE 1a — policy-lookup-negative-cache. The single highest-value
      fix from the 2026-07-21 cost investigation. NEW 2026-07-22.** Cache
      failed return-policy lookups, not just successful ones, so a retailer
      that can't be resolved is not re-attempted per email. Evidence this
      is the right first move: on 07-21, ACE VISALIA RSC alone produced 14
      of the day's 33 `lookupReturnPolicy()` calls, with 0 successes —
      every one guaranteed to fail, every one billing Sonnet plus up to 3
      web searches. A negative cache turns those 14 into 1. Why this comes
      BEFORE the positive cache (see `extraction-cost-visibility`, 🟡
      Next): the positive cache only protects retailers already seen and
      resolved. The negative cache protects against every future garbage
      retailer value, including ones not yet in the data. It is the guard;
      the positive cache is the optimization. Build both, this one first.
      **Open design decisions to make before building, not during:**
      (1) TTL — a failure should expire, since a retailer may become
      resolvable later (new policy page, corrected retailer name). Suggest
      ~7 days; decide explicitly. (2) Key — retailer name or normalized
      domain? Must match whatever key the positive cache uses; decide once
      for both. (3) Failure taxonomy — is "no policy found" cached the same
      as "web search errored"? A transient network failure should probably
      not poison the cache for a week. Bucket by reason, mirroring the
      link-resolve probe's own "failures bucketed by reason, never
      conflated" discipline (2026-07-21 PROBE).
      **Verify gate — ALREADY DONE, reported 2026-07-23:** `lookupReturnPolicy()`
      is called from exactly one site (`lib/extract.ts`'s `extractEmail`),
      triggered whenever `parsed.returnWindowDays == null && parsed.retailer`
      — no caller currently treats failure specially; the try/unclear/catch
      branches all just set `policyLookupWasUnclear`/leave `policySource`
      null. Nothing further to verify before building.
      **EVIDENCE 2026-07-26:** the 23-row repair batch billed 39 calls not
      23 — 16 hit `lookupReturnPolicy`, and 14 SUCCEEDED (9 of the 23 were
      Amazon). This is the POSITIVE-cache pattern (repeat retailers
      re-looked-up every order), NOT the negative-cache failure pattern
      the sequencing above is built on. Do not ship the negative cache
      alone and call cost handled — the dominant waste in real traffic
      looks like redundant *successful* lookups on repeat retailers.
      Confirm ordering against the cost-anatomy token pass before
      building either.
      **NEW GATE, 2026-08-04 (board hygiene pass) — do not spec before
      this lands:** both this cache (negative) and `extraction-cost-
      visibility`/PHASE 1b (positive) are gated on reading a few days of
      the now-live `anthropic_usage` per-call logging first (shipped
      2026-08-04, see 🔴 Now) — that data sizes the cache, measures the
      real repeat-retailer hit rate, and settles the shared cache-key
      question (retailer name vs. normalized domain, open question (2)
      above) with real numbers instead of a guess. Target: read ~Friday's
      accumulated data before spec'ing either cache.
      **SEQUENCING INVERTED, 2026-08-13 (separate read-only investigation —
      see `HISTORY.md`) — AWAITING OWNER SIGN-OFF, not yet applied.**
      Full 826-row production measurement (not the 103-row sample the
      earlier ~26% figure came from): `lookupReturnPolicy` fired on 30.1%
      of extractions (249/826), and 65.5%+ of fired lookups were redundant
      repeats — a floor, since exact-string grouping undercounts (e.g.
      "donni" vs "donni." split one retailer into two buckets). Of the 163
      saveable repeats, **142 (87%) were positive/success repeats** versus
      only 21 negative-repeat saves, 15 of those a single retailer (ACE
      VISALIA RSC — the known extraction mis-parse, not a broad pattern).
      **This reverses the ordering above: PHASE 1b (positive cache) is now
      the higher-value first build, this item (1a, negative) the smaller
      follow-on.** Cache itself is confirmed justified as a direct build
      either way (not the deeper refactor) — nothing here is done or
      self-applied; this is a measured finding awaiting owner sign-off on
      the resequencing, sized-and-ready-to-spec, not built.
- [ ] **PHASE 1c — policy-lookup-gating. NEW 2026-07-22, from the 07-21
      cost investigation.** Decide whether `lookupReturnPolicy()` should be
      reachable from `delivery`- or `shipping_confirmation`-typed emails at
      all, or gated to `order_confirmation` only. Why this is a real
      question and not just cost hygiene: the 14 ACE calls originated from
      FedEx delivery-notification emails. A delivery notification is not
      where a return policy lives, and the retailer is already known from
      the linked order by that point (when there IS a linked order — see
      the still-orphaned cases above, where there isn't). If the gate is
      correct, this removes the class of waste rather than caching around
      it — cheaper than both caches and it improves data quality too.
      **Verify gate — ALREADY DONE, reported 2026-07-23:** confirmed
      `lookupReturnPolicy()`'s trigger condition
      (`parsed.returnWindowDays == null && parsed.retailer`) has no
      `emailType` check anywhere — reachable from every email type
      unconditionally. **Do not assume the answer is "gate it"** — if a
      shipping email legitimately carries the first mention of a retailer
      for an order that never sent an `order_confirmation`, gating breaks
      that (see the 15-orphaned-purchases item: this is a real, live case,
      not hypothetical). Weigh against `PHASE 1a`'s negative cache, which
      solves the same cost problem without that risk.
      **Evidence the question is wider than delivery/shipping (2026-07-23,
      junk-backfill verify gate):** `lookupReturnPolicy()` fired on 4 of 5
      sampled `other`-typed emails — pure marketing, no order at all
      (Target ×2, Bloomingdale's ×2). Cost waste on content with zero
      chance of ever needing a return policy. Fold into this gating
      decision, not investigated further here.
- [ ] **Dateless-order snapshot 2026-07-25 — 6 of 7 are return-POLICY
      resolution failures (returnWindowDays == null), not date failures.
      Clean real-world sample for the policy-lookup work. Orders:
      Nordstrom #1048279668, VPL Bike #3267, Etsy #4120342614, Anthropic
      PBC #2532-4693-8394, ACE VISALIA RSC #001352978 (delivered but no
      policy), Amazon #113-5215249-6165864. Investigation only — confirm
      these are all policy-lookup misses, not a shared root cause.**
- [ ] **`returnDeadline < orderDate` sweep — QUICK CHECK RUN 2026-07-23,
      ESCALATED (not a one-off).** One query, as asked: any order where
      `returnDeadline < orderDate`. Result: **3 hits, not 1** — Good Eggs
      (`returnDeadline` 2025-07-21 vs `orderDate` 2026-07-14, -358 days),
      Emme Parsons (2025-08-14 vs 2026-07-22, -343 days), Waitrose
      (2020-08-21 vs 2026-07-14, **-2153 days**). Good Eggs itself doesn't
      matter (grocery, no real return window) but the parse that produced
      it isn't grocery-specific — confirmed by the other two hits being
      unrelated retailers. Per the original framing: multiple hits means
      escalate, not close as an oddity.
      **Root-cause lead, not a full diagnosis — cheap to check, worth
      recording:** all 3 share the identical shape. `orderDate` is
      `orderDateEstimated: true` (fallback-derived) but has the *correct*
      year (2026) in all 3. `estimatedDeliveryDate` has a *wrong* year
      (2025, 2025, 2020) despite `orderDate` on the same row being right.
      `returnWindowStartsFrom: "delivery_date"` on all 3, so `returnDeadline`
      correctly anchors on `estimatedDeliveryDate` — the deadline math
      (`computeDeadline()`) isn't the bug; the bad input feeding it is.
      Points at whatever produces `estimatedDeliveryDate` (`routeDeliveryDate`/
      `resolveEstimatedDeliveryDate`, `lib/extract.ts`) as the place to look
      first, not date-arithmetic code. Not investigated further than this —
      no fix, no mechanism confirmed, just a starting point for whoever
      picks this up.
      **4th instance surfaced 2026-07-23 (Task 1 verify gate, manual
      Fitness Superstore link) — retailer not in the original 3:** a
      Fitness Superstore email already linked to order `#48868`
      (`cmrdz7rm90007jp04dst5ih4e`) carries `orderDate: 2025-07-09`, wrong
      year, while the Order's own `orderDate` is the correct 2026-07-09 —
      same wrong-year-on-a-date-field shape, this time on `orderDate`
      itself rather than `estimatedDeliveryDate`. Not currently governing
      the order's deadline (the Order-level value is correct), so no live
      impact. Not investigated further, per instruction.
      **5th instance surfaced 2026-08-25 (owner-reported from live UI, Target
      order `912003624619619`, $108.39) — NEW ANGLE: this is the first
      pickup-order instance in the pattern.** Order date 2026-08-25 (correct,
      today), estimated delivery date 2026-08-25 → shown in UI as 8/25/2025
      (wrong year, 358 days in the past — matches the Good Eggs / Emme Parsons
      shape exactly). Return deadline mechanically derived (9/8/2025), status
      correctly "Expired" against the bad deadline. Three linked emails: order
      confirmation, "ready for in-store pickup at Redwood City," and "picked
      up" — no shipping/delivery notification, because there was no shipment.
      Semantically "delivery date" here means "picked up on." Could be another
      instance of the same wrong-year mechanism (strengthens the escalation
      case, doesn't change the root-cause lead), OR the pickup fulfillment
      path is hitting a different code path in the estimator that hasn't been
      looked at. Not distinguishable without a DB read on the row — not
      investigated further this session, logged only per owner instruction.
      Root-cause lead unchanged: still `routeDeliveryDate` /
      `resolveEstimatedDeliveryDate` in `lib/extract.ts` as the first place
      to look. Escalation weight now: 5 instances, 4 retailers (Good Eggs,
      Emme Parsons, Waitrose, Fitness Superstore, Target), first pickup-order
      case.
- [ ] **ACE VISALIA RSC — duplicate Email rows CONFIRMED genuine (content
      check, not timing), status path still unexplained. NEW 2026-07-23.**
      Content check run, not a timing assumption: within each same-second
      cluster (6 rows at 2026-07-21T15:59:22, 6 more at 19:11:20), every
      row shares the *identical* Postmark `MessageID`, identical subject,
      and identical `htmlBody` hash. That rules out the batch-forward
      reading (same-second arrival of genuinely distinct emails, plausible
      given `receivedAt` is the forward date not the send date, and given
      the probe-confirmed sub-3-minute auto-forward lag) — identical
      `MessageID` means Postmark delivered the same message 6 times, and
      each delivery created its own Email row. No ingestion-level dedup
      exists anywhere in `app/api/inbound/route.ts`. Per the resolution
      rule this was checked against: identical stays in 🔴 Now, it's a
      bigger problem than the cost angle alone.
      **Still no theory on the status path — do not close this as
      "explained by duplicate rows."** All 6 duplicate emails in each
      cluster are orphaned (`orderId: null`), yet the one real Order under
      this retailer name (`#001352978`) already reads `displayStatus:
      "delivered"` with no return deadline set. Nothing in the duplicate-
      row finding explains how that order reached "delivered" while none
      of its own inbound emails are linked to it. Needs tracing, not
      assumed — a separate question from the duplication itself.
      **Cost consequence, for completeness — the retailer-misidentification
      half of this is tracked separately below (`carrier-facility-as-
      retailer`, 🟡 Next):** each of the 14 orphaned ACE-named emails
      independently re-ran `lookupReturnPolicy()` (none are
      `order_confirmation`), accounting for 14 of the 33 policy-lookup
      calls on 07-21, all 14 failed.
      **Confirmed at scale, 2026-07-23 orphan-candidate report: the same
      duplicate-MessageID pattern also hit GLOBAL-E NL B.V (~4-6 identical
      rows), not just ACE VISALIA — inflates the orphan count on any
      report that doesn't dedupe by MessageID first. Likely first fix
      tomorrow.**
      **DEDUP GUARD BUILT 2026-07-26 — tracks in ⏳ Verifying below, not
      here.** The status-path mystery (order `#001352978` reading
      "delivered" with no linked emails) remains explicitly OUT of scope —
      a separate follow-on trace, not investigated or fixed here.
      → see 🐛 Bugs (Trust-breaking) 2026-07-26: "Friday weekly
      coverage-check digest badly broken" — defect 2 of that item is this
      same MessageID-redelivery duplication (ACE VISALIA ×6, GLOBAL-E
      NL B.V ×3, real user-visible impact); the dedup fix addresses that
      defect only, not the digest's other three defects.
      **RESOLUTION 2026-08-08 — mechanism resolved-forward, "ACE VISALIA"
      retired as a label, residue re-filed under existing slugs, not
      re-opened here.**
      **Mechanism RESOLVED-FORWARD:** the messageId dedup guard (shipped
      2026-07-26, `0b055df`) stops new duplicate-orphan rows going
      forward — confirmed in code at `app/api/inbound/route.ts:229-239`
      (the `findFirst`-then-discard check) plus the
      `@@unique([userId, messageId])` constraint
      (`prisma/schema.prisma:189`) as the race backstop. Confirmed
      forward-only, not a backfill: migration
      `20260726042035_add_email_messageid_dedup` is purely additive
      (`ADD COLUMN` + `CREATE UNIQUE INDEX`, no data `UPDATE`), and no
      script anywhere in the repo ever writes `messageId` onto a
      pre-existing row — verified by direct code read, not memory,
      2026-08-08.
      **Residual, re-filed not re-opened — two related but distinct
      pre-guard populations from the same 2026-07-21 incident, not the
      same rows, not conflated:** (1) this item's own originally-tracked
      rows — ACE VISALIA RSC (14 orphaned, extracted, retailer-named) and
      GLOBAL-E NL B.V (~4-6 identical rows) — both `messageId: null`
      (pre-dates the guard). (2) A separate set surfaced by the
      2026-08-08 extraction-gap census (see ✅ Done, `runExtraction.ts:8`
      findUnique-gap fix): 11 rows sharing the exact same 07-21
      same-second timestamps but never extracted at all
      (`extractedAt: null`, FedEx "out for delivery"/"delivered" and
      Amazon/Whole Foods "picked up" senders) — same redelivery-storm
      incident, different rows, also `messageId: null`. Both populations
      are historical, un-swept data, not an open dedup bug — the guard
      would have caught either shape had it existed at ingestion time.
      Both point at the existing "Orphan census refresh" 🔴 Now item's
      cleanup scope; they clear when that backfills/matches, not before.
      **"ACE VISALIA RSC" was a mis-extracted pseudo-retailer EXAMPLE, not
      its own bug.** It stays only as the illustrative case in `PHASE
      1a`'s evidence (14 failed `lookupReturnPolicy` calls) and `PHASE
      1c`'s gating rationale (delivery emails shouldn't reach
      `lookupReturnPolicy` at all). Both keep their own identity
      (`PHASE 1a — policy-lookup-negative-cache`, `PHASE 1c —
      policy-lookup-gating`); neither needs the ACE name to stand on its
      own.
      **PHASE 1a confirmed status, 2026-08-08: still OPEN, not built.**
      Verified by direct read, not inferred: `lookupReturnPolicy()`
      (`lib/extract.ts:272-289`) has no cache logic of any kind, and its
      one call site (`lib/extract.ts:608`) calls the Anthropic API
      unconditionally whenever the gate passes — no pre-check against any
      prior failure or success. The one genuinely-live fix this incident
      spawned has not shipped; recorded here on its own so it isn't
      buried under the retired name.
      **Net: no item on this board carries "ACE VISALIA" as its identity
      after this entry.** The status-path mystery flagged above (order
      `#001352978` reading "delivered" with no linked emails) remains
      unresolved and out of scope for this edit — not touched, not
      implied fixed.
- [ ] **H&M — do we extract from attachments? CONFIRMED: no, not at all.
      NEW 2026-07-23.** Checked directly: `app/api/inbound/route.ts`'s
      `PostmarkInboundPayload` interface doesn't declare an `Attachments`
      field at all — Postmark's real inbound webhook payload includes
      attachment content, but this codebase never types it, never reads
      it, never passes it to extraction. Extraction only ever sees
      `TextBody`/`HtmlBody`. For the two orphaned H&M emails literally
      titled "Your receipt is attached," whatever order number lives in the
      PDF is completely invisible to the system today — `orderNumber: NULL`
      on both is exactly what you'd expect, not a matcher failure. Per the
      owner: the two same-day H&M orders are genuinely distinct purchases
      placed back-to-back, so there IS a correct answer per email — the
      system just can't see it without reading the attachment. Searched the
      broader unlinked pile for the same pattern (subject or
      `extractionNotes` containing "attached"): found only these same 2
      H&M emails by keyword match — could not independently confirm or
      rule out the pattern recurring under different wording without a
      fuzzier search or manual review; flagging that limitation rather than
      claiming a broader count. Not fixed here — attachment parsing would
      be new ingestion-pipeline work (decrypt/store/pass attachment content
      into the extraction prompt or a secondary pass), not a small change.
      Check this BEFORE designing any H&M tie-breaker for the ambiguous-
      candidate case (see the 15-orphaned-purchases item) — if attachments
      become readable, H&M may link itself with no tie-breaker needed at
      all.
- [ ] **15 orphaned genuine-commerce emails, no fallback matcher —
      real purchases with no deadline tracked, silently. Surfaced
      2026-07-22 during the Needs Review panel verify gate, full per-email
      report run 2026-07-23.** `orderNumber: NULL` on all 15 (FedEx/UPS/USPS
      delivery-and-shipping notifications, real order confirmations — ACE
      VISALIA RSC ×6, H&M ×3, Poshmark ×2, Fitness Superstore ×2, Good Eggs
      ×1, SilkSilky ×1). `findRefundFallbackOrder` (the only existing
      no-order-number fallback matcher) is scoped to `refund`-typed emails
      only — no equivalent exists for `delivery`/`shipping_confirmation`/
      `order_confirmation`. Same underlying gap as the already-tracked
      `6b`/`shopbop-goods-based-matching` 🟡 Next item — this confirms it's
      not theoretical, it's live and costing users money today.
      **Corrected breakdown (2026-07-23 full report — supersedes the
      earlier "12 of 15" estimate, which was accurate at diagnosis time but
      has drifted as real inbound traffic continued arriving):** 11 with
      exactly one same-user same-retailer candidate order, 1 with zero
      candidates (SilkSilky — first purchase from that retailer, nothing to
      match), **3 ambiguous — all H&M, three separate same-day H&M orders,
      no order number on the orphaned emails to disambiguate.**
      **Design requirement, recorded 2026-07-23: the matcher must
      auto-link the unambiguous cases and route ambiguous ones to Needs
      Review — not guess.** H&M is the proof this has to be a hard rule,
      not a heuristic: two of its three candidate orders were placed the
      same day (owner-confirmed genuinely distinct purchases, back-to-back)
      with no order number recoverable from either orphaned email's body —
      there is a correct answer per email, but no safe *automatic* way to
      pick it from what the matcher can see today. (Separately: H&M's
      `orderNumber: NULL` may be an ingestion gap, not a matching gap —
      see the H&M attachment item, 🔴 Now, before designing any tie-breaker
      here at all.) A matcher that guesses on ambiguous cases would
      silently attach an email to the wrong order — worse than staying
      orphaned. Not fixed here.
      **CONFIRMED COMPOUNDING SYMPTOM 2026-08-22, READ-ONLY (real-window
      replay via `scripts/pm-repro-coverage-digest-mckenna-v2.ts` +
      `scripts/pm-diag-0821-digest-triage.ts`, uncommitted), 0 billed calls,
      0 writes, mckenna.sweazey@gmail.com only.** This same orphan class also
      leaks into the Friday coverage-check digest, not just the needs-review
      bucket — owner-reported. mckenna's real 2026-08-21 send window
      (2026-08-14T16:56:43Z→2026-08-21T16:56:43Z) contains an orphaned
      `return_label` email from H&M (id `cmt090ioq0001l404crsih7w9`,
      received 2026-08-19, `orderId: null`, `orderNumber: null`,
      `extractionNotes` correctly declines to set `orderTotal` since the
      $939.90 line-item sum is "returned items only ... not the full order
      total"). mckenna has 3 real H&M orders on file; the strongest linking
      candidate is `68462778273` ($1,131.88, placed 2026-07-21, status
      `returnable`/`returned`, `returnedAt` stamped 2026-08-21) — same order
      already named above. **Root cause is the SAME orphan-relinking gap**,
      just a second surfacing: the 2026-08-19 coverage-check
      establishing-email gate only filters LINKED orders (`orderId` set); an
      *unlinked* email of any type — including a `return_label`/`refund`
      update for an order the user already has — still renders in the
      digest, by design, as the "missing-order signal this email exists to
      surface" (see HISTORY.md 2026-08-19). For a real linking failure like
      this one, that "signal" reads to the user as a confusing/redundant
      digest line, not a useful QA net. Not fixed here — same underlying fix
      (relink orphaned post-purchase mail via item/style-code overlap, per
      the J.Crew matcher design already queued) would resolve this
      symptom too, without needing a separate digest-side change.
      **Types in this report need re-verification before matcher design
      (2026-07-23, Task 1 verify gate):** the Fitness Superstore ×2 pair is
      actually typed `order_confirmation`, not delivery/shipping as this
      report's breakdown states — a fallback matcher gets scoped by
      `emailType`, so if the type breakdown is off here, it may be off
      elsewhere in the 15 too. Not re-verified across the full list now.
      **Live instance of the email-level badge dead end (2026-07-23):**
      Fitness Superstore's two emails are now correctly linked (Task 1) but
      both still carry `Email.needsReview: true`, with no resolve path —
      the same confirmed dead end as the Trust-breaking bug list entry
      above, now observed on a real post-fix row instead of just
      theoretically. The four-slot panel build must answer what
      fills the resolve-action slot for a flag like this. Not investigated
      further now.
      **Folded in 2026-07-25 (mobile audit finding #6b, no longer a
      standalone item):** refund/return emails with no order number can't
      be linked at all today. Proposal: match on item name/description when
      order number is absent — the same underlying gap as the existing
      `shopbop-goods-based-matching` 🟡 Next item
      (`findRefundFallbackOrder()` in `lib/linkOrder.ts`, currently retailer
      + amount + recency only). The confidence-threshold decision is shared
      with this item, not spec'd separately. Per the design requirement
      already recorded above: ambiguous cases route to Needs Review, never
      guessed.
      **Confirmed still live and grown, 2026-08-04 (board hygiene pass +
      fresh evidence from a real digest).** Orphaned genuine-commerce is
      now 30-32 rows (drifting live), not 15/20. Fresh census bucket-3
      (candidate order exists, matcher didn't fire): **17 rows** — ACE
      VISALIA RSC ×6, H&M ×5, Poshmark ×2, NET-A-PORTER ×2, Good Eggs,
      Honest History. **The H&M same-day-ambiguous case is still live
      right now** (same user, two H&M orders placed the same day,
      2026-07-21 03:02 and 14:55) — direct reconfirmation of the design
      requirement above; do not build a "closest date wins" matcher, it
      would pick wrong here. **User-facing evidence, real digest:**
      Alexandra's own Friday coverage-check showed two Wayfair lines —
      one linked (with price) and one orphaned ("1 order from Wayfair,"
      no price) — this is the customer-facing symptom of this exact bug,
      not a new one. **Caveat, honestly flagged rather than asserted as
      fact:** the specific orphaned Wayfair row from that digest could
      not be pinned down against the live DB at time of this note — no
      currently-orphaned email in her account resolves to retailer
      "Wayfair" (nor was a live "SCRIBE"/"Monos" orphan found, the other
      examples mentioned alongside it). Best candidate by shape: a
      2026-07-31T18:31:05Z delivery-notification row still sitting at
      `emailType: null` (extraction never ran/succeeded) — that's the
      **known pre-bound extraction-failure cluster** (see the Aug 1-4
      credit-outage item, 🔴 Now), a different failure mode than this
      item's no-fallback-matcher gap, not confirmed as Wayfair without
      running extraction. Do not treat the Wayfair specifics as verified
      until that row resolves (or a fresh digest names it again). **A
      separate, unrelated duplicate exists on a different account for the
      same Wayfair order-number** (two fully-linked Order rows, two
      different userIds) — per owner instruction 2026-08-04, this is a
      known accident on the *other* account and is explicitly OUT of
      scope here; it does not reopen or extend the 2026-07-28 P0
      cross-user item (unchanged, not touched by this pass).
      **[2026-08-26 PARKED to 👀 Watching per owner]** Original count (15)
      was owner's own dashboard only. Owner reports the current count is
      much lower, exact figure unknown without cross-user dashboard
      inspection. Portion of the original population is now covered by the
      carrier-email routing work (item 2568). Not blocking; not urgent.
      → see 👀 Watching: "Orphan-orders census across users"
- [ ] **`refund_pending` → `SKIP_STATUSES` fix (`lib/reminders.ts`) shipped
      (`63b88e4`) — needs a follow-up code comment.** VERIFIED real,
      go-ahead given, fix deployed. Still needs a code comment explaining
      *why* the guard exists despite nothing being in the state right now:
      `status` recomputes only on new-email-link, never on a schedule — so
      this needs 14+ days in `return_started` plus a later, unrelated
      email to actually fire; 0 orders currently affected.
- [ ] **Security cleanse (queued 2026-07-14, tomorrow's priority)** — full
      pass, prep for a more public-facing alpha: env vars, auth, API
      routes, input validation, rate limiting, data exposure. Not started
      tonight. The inbound webhook auth rollout (completed `d5772a8`,
      2026-07-15) is directly relevant context to start from — its
      findings inform this cleanse, not blocking work.
- [ ] **Forward auto/manual mis-classification — deadline gate depends on
      this. NEW 2026-07-21, from the probe above — NOT a "classifier picked
      wrong" bug, more severe: no classifier exists at all.** `app/(app)/page.tsx:230`
      and `app/(app)/emails/[id]/page.tsx:76` both render the literal
      hardcoded string `"Forwarded by you"` — not a lookup, not conditional
      on any stored field, no such field exists on `Email` at all. Every
      email shows this same label regardless of how it actually arrived.
      Confirmed via raw Postmark headers (rawJson, decrypted) that this is
      wrong for the majority case: 24 of 34 delivery-typed emails carry
      unambiguous Gmail auto-forward evidence (`Return-Path` with the
      `+caf_=` Content-Auto-Forward marker, `X-Forwarded-For`/
      `X-Forwarded-To` headers, original sender's DKIM still validating) —
      AquaTru among them. The UI has been telling the owner every
      auto-forwarded order was manually forwarded. Both planned features
      ((a) forward-date deadline estimation, (b) carrier-link resolve
      gating) depend on this signal being real and stored, not just
      inferred ad hoc per investigation. Needs: a real classifier (the
      header signal — `+caf_=` / `X-Forwarded-For` presence — is cheap and
      reliable per this probe, not full page rendering) run at ingestion
      time (`app/api/inbound/route.ts`), a new persisted field, and the two
      UI call sites updated to read it instead of the static string. Not
      built here — this is a probe finding, not a fix. **Framed as a build,
      not a bug fix** — there's no broken derivation to repair, a new one
      needs to be written from scratch.
      → see DECISIONS.md 2026-07-21 ("Forward auto/manual classifier: two design rules")
      → **SUPERSEDED 2026-07-25 by `ANCHOR_DATE_RESOLVER.md`'s Part 2** — that
      spec closes this item (and folds in the `returnDeadline < orderDate`
      sweep and the Emme Parsons dateless-invented-year bug) under one build.
      Not marked Done here; the build now tracks in ⏳ Verifying below. Left
      in place, not deleted, per this board's own rules.
- [ ] **Mobile UX audit pass — catalog complete 2026-07-17, promoted from
      🟡 Next (`mobile-ux-audit-pass`). Docs-only entry; nothing fixed yet.**
      Real-device pass, real orders, catalog-before-fixing per this item's
      original framing. Eight findings below, in the owner's priority order —
      **preserve this order**, it is the triage, not just a list. Each entry
      states what it is, severity, code location (where known), and whether
      the next step is a fix, a spec pass, or an investigation.

      → **1. Bell icon alignment** moved to ❄️ Deferred 2026-07-25
      (0-for-4 remote-fix attempts; stop remote-reasoning fixes; revisit
      only with an on-device Safari Web Inspector session, or absorbed into
      the card-geometry rebuild).

      **2. "This will stop all reminders" caption scoping — ✅ semantic fix
      DONE, owner-verified 2026-07-17; visual follow-up split out as
      finding #1b (🟡 Next).** Full detail moved to the Done section.

      → **3. "..." overflow menu replacement** decided 2026-07-25 and
      folded into the "Unified card geometry + order state machine"
      🙋 Waiting on Owner item below — see DECISIONS.md 2026-07-25.

      → **4. State-label contradictions + button hierarchy** folded into
      the "Unified card geometry + order state machine" 🙋 Waiting on
      Owner item below, 2026-07-25.

      → **5. Quick-check (needs-review) surface** folded into the
      "Unified card geometry + order state machine" 🙋 Waiting on Owner
      item below, 2026-07-25.

      **6. Order-linking:**
      - **6a. SHIPPED (`3f5677f`) — moved to Done.** Turned out not to be an
        exact-match bug at all (the exact-match query was always correct);
        see Done section for the actual root cause and `BUILD.md`'s
        Order-linking notes for the fix.
      - → **6b. No order number present** folded 2026-07-25 into the
        "15 orphaned genuine-commerce emails" 🔴 Now item above.

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

- [ ] **Manually-created null-orderNumber orders are invisible to
      auto-matching → duplicates on later order_confirmation —
      NEW 2026-08-30.** When a user hits "Start a new order" from
      a delivery-shaped Needs Review row (no orderNumber in the
      email), createOrderFromEmail (lib/linkOrder.ts:777-818)
      writes an Order row with orderNumber: null. Every path in
      findMatchingOrder (lib/linkOrder.ts:1008 → findExactMatchOrder,
      findPrefixMatchOrder, findRetailerPrefixMatchOrder) requires
      candidate.orderNumber to be non-null (findPrefixMatchOrder:485
      explicit). When a real order_confirmation later arrives for
      the same purchase, the matcher structurally cannot see the
      shell order — returns null, createOrderFromEmail runs again,
      producing a duplicate Order for the same real-world purchase.
      **Real bug, not hypothetical** — mechanism traced end-to-end
      2026-08-30 during the shipment_unlinked routing investigation
      (Phase A.1 finding 5).
      **Frequency estimate:** owner (2026-08-30) notes confirmation-
      after-shipment is uncommon (returns following shipping emails
      more common, still occasional) — medium urgency, not high.
      Not routinely creating dupes today; blocks the ability to
      cleanly resolve future manual linking.
      **Fix scope not decided here** — needs its own Phase A.
      Candidate approaches: (a) teach findMatchingOrder to also
      match null-orderNumber shells by retailer + date proximity
      when the incoming email has an orderNumber; (b) add a flag
      to manually-created shells that grants special matcher
      treatment; (c) something else CC surfaces during investigation.
      **Complementary to shipment_unlinked ticket, not blocking** —
      that ticket also creates null-orderNumber shells in the
      zero-candidate case (same as today), and whatever fix lands
      here will apply to those shells automatically.
      **Existing dupes:** unknown count in current DB; check as
      part of Phase A. Don't backfill until fix is deployed.

## 🙋 Waiting on Owner

- **RESOLVED 2026-07-29 — Part 5 signed off, build UNBLOCKED.** All 9
  open questions answered by the owner — `CARD_SPEC_Part5_signoff.md`
  (the 9 decisions, wins over `CARD_SPEC.md`'s own still-blank inline
  Part 5 text where they differ) + `CC_BUILD_PROMPT_card_geometry.md`
  (the build brief for Claude Code). Full decision list: `DECISIONS.md`
  2026-07-29. **Verification note:** an initial check earlier in this
  same close-out found neither file present and flagged it as a
  discrepancy rather than assumed signed-off; both appeared minutes later
  (owner completing them in parallel) and were re-verified against their
  actual content before this was marked resolved.
  **Carry-ins for the build, don't reintroduce these:** rename the
  summary-stat pill from "Need attention" to "Needs review" (one name,
  all surfaces); reconcile slot-4's approved `Keep` copy against the
  detail page's existing `Keeping it` (same action, two surfaces today).
  **SUPERSEDED 2026-08-10:** `CARD_SPEC.md` now absorbs
  `CARD_SPEC_Part5_signoff.md` in full (Part 5 answered inline, plus the
  later fifth-action/manual-picker/summary-tab additions locked
  2026-08-10) and is the single source of truth — the "sign-off wins
  where it differs" override above no longer applies.
  `CARD_SPEC_Part5_signoff.md` stays in the repo as a dated record of the
  original sign-off, not a second live source.

→ **Unified card geometry + order state machine (2x2 four-slot)** — MOVED
  TO 🔴 Now 2026-08-10: owner brief given this session, `CARD_SPEC.md` is
  build-ready, build starting on a branch, preview-first. Full item, its
  6 preserved sub-entries, and the resolved four-slot-inventory
  contradiction now live in 🔴 Now.

- [x] **RESOLVED 2026-08-24 — Needs-review routing-tree design, owner review
  complete.** Full design doc: `NEEDS_REVIEW_ROUTING_DESIGN.md`. [§2 is now
  a five-branch tree as of 2026-08-30, see the shipment_unlinked ticket in
  🔴 Now — doc updated in place, not re-signed-off as a separate entry.]
  Sign-off given on: the four-branch tree (§2), the two new reasonIds/copy
  (`return_or_refund_no_link`, `no_extraction_signal`), and the proposed
  `CARD_SPEC.md` Part 3 amendments — A and B applied, C deferred (spec
  note added), D (collapsed bucket-row controls) applied. Full item MOVED
  to 🔴 Now ("Routing tree design for needs-review bucket action
  selection") — build session (Session 2) ready to start.

## ⏳ Verifying

- **VERIFY BY: owner glance in the app — forward a real email through Gmail auto-forward and manual-forward, confirm the "Forwarded automatically"/"Forwarded by you" label is correct on each, and that a real order's deadline still computes correctly.**
- [ ] **Anchor date resolver — PART 2 BUILT AND DEPLOYED 2026-07-26, per
      `ANCHOR_DATE_RESOLVER.md` (owner-approved spec, Part 4 decisions
      answered — see DECISIONS.md 2026-07-25).** Migration applied
      (additive only — `Email.forwardType`/`anchorDate`/`anchorSource`,
      all nullable, no backfill), `lib/forwardResolver.ts` built
      (`classifyForwardType`, `resolveAnchorDate`, `forwardTypeLabel`),
      wired into `app/api/inbound/route.ts` at ingestion. Both hardcoded
      "Forwarded by you" UI call sites now read `forwardType`. Pre-commit
      read-only query (2026-07-25) found 7 orders currently dateless for
      unrelated reasons (missing return policy, one `emailType: "other"`
      gate case) — none from an anchor-resolution problem, so the new
      needs-review reason has ~0 day-one impact on existing data, confirmed
      by design (gated on `forwardType === "manual"`, never fires on a
      pre-migration row where `forwardType` is still null).
      `resolveFallbackOrderDate` (`lib/linkOrder.ts`) now trusts a
      resolver-processed row's `anchorDate` as-is (including null —
      unresolved never falls back to `receivedAt`); a pre-resolver row
      (`forwardType` null) keeps its original parse-or-`receivedAt`
      behavior unchanged, so existing orders don't regress. New
      `reviewReasonLabel()` branch ("We couldn't confirm the date on a
      forwarded email") keyed off the earliest linked email, same
      re-derived-not-stored pattern as the M2 reason. 28 new/updated tests,
      478/478 passing, `npm run build` clean. **Committed (`13521ca`),
      pushed, and deployed — confirmed via production runtime logs
      2026-07-26 (real inbound webhook traffic processed successfully,
      zero error-level logs in the 6 hours since deploy), but NOT
      hand-verified by the owner in the app. Awaiting owner
      verification — not Done.**
      **Part 3 (the sanity guard, closing the `returnDeadline < orderDate`
      sweep) deliberately NOT started this pass** — it touches the AI
      extraction pipeline itself (`lib/extract.ts`'s `computeDeadline`/
      `routeDeliveryDate`, `lib/runExtraction.ts`), a materially larger and
      riskier surface than Part 2's ingestion-time-only + fallback-function
      changes. Recommending it as its own follow-on pass rather than
      bundling it into this already-large change — owner to confirm.
      Supersedes the "Forward auto/manual mis-classification" item (🔴 Now)
      (left in place, not deleted) and will close the
      `returnDeadline < orderDate` sweep item once Part 3 lands. Does not
      touch `CARD_SPEC.md`/the needs-review bucket UI (still unbuilt,
      Waiting on Owner) — only sets the existing `Order.needsReview`
      boolean + a new `reviewReasonLabel()` branch, the same mechanism every
      other reason already uses.

- **VERIFY BY: owner glance — force a duplicate delivery (or wait for the next real Postmark redelivery) and confirm only one Email row/order exists, no repeated line in the next Friday coverage-check digest.**
- [ ] **ACE VISALIA RSC / GLOBAL-E NL B.V MessageID dedup guard — BUILT
      2026-07-26.** Read-only investigation of MessageID persistence,
      `app/api/inbound/route.ts`'s exact ingestion flow, per-user MessageID
      uniqueness, and existing event-log patterns — recommendation:
      skip-and-log via a `DiscardLog`-shaped record, guard scoped to
      `(userId, messageId)`, checked via `findFirst` before
      `isCommerceEmail()`. **Verified all 10 real duplicate clusters (449
      rows) against the full 3-signal criteria (MessageID + subject +
      htmlBody hash) before building — 100% true redelivery duplicates,
      zero MessageID-only false matches.** Owner-approved 2026-07-26:
      `Email.messageId` populated on new inbound rows going forward only —
      **explicitly NOT backfilled onto existing rows** (enforced by
      construction: `@@unique([userId, messageId])`, and Postgres never
      matches NULL to NULL, so all 449 pre-existing rows are invisible to
      the constraint). Additive migration applied
      (`20260726042035_add_email_messageid_dedup` — one nullable column,
      one unique index). New `PostmarkInboundPayload.MessageID` field read
      directly from the plaintext payload (no decryption needed at
      ingestion). Dedup check sits before `isCommerceEmail()`, so a
      redelivery costs nothing beyond one lookup — skips both billed calls
      (Haiku classification, Sonnet extraction), not just the expensive
      one. Race backstop: a `P2002` from `email.create()` (two
      near-simultaneous redeliveries both passing the pre-check) is caught
      and logged identically, not treated as a real failure. 6 new tests
      (`__tests__/inboundDedup.test.ts`) plus the existing rate-limit
      suite reconfirmed unaffected, 484/484 passing, `npm run build`
      clean. **Committed (`0b055df`) — pushed and deployed status
      confirmed at session close, see below. Awaiting owner verification —
      not Done.** Addresses defect 2 only of the "Friday weekly
      coverage-check digest badly broken" bug (🐛 Bugs, Trust-breaking) —
      defects 1, 3, and 4 of that bug are untouched. The status-path
      mystery (order `#001352978` reading "delivered" with no linked
      emails) remains explicitly OUT of scope — a separate follow-on
      trace, not investigated or fixed here.

- **VERIFY BY: passive — a future scheduled cron run once a real order ages 14+ days past its returnDeadline (0 orders currently eligible).**
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

- **VERIFY BY: next Friday 16:00 UTC scheduled cron run.**
- [ ] **Coverage-check dedup bug — FIXED 2026-07-20, pushed, not deployed
      /verified yet.** Step 1 (read-only) confirmed both suspected
      mechanisms exactly: dedup was a rolling 7-day lookback from the exact
      invocation instant, and `?force=true` wrote a Reminder row identically
      to a scheduled run (only skipped the pre-check, not the write).
      Confirmed against real dates: Jun 27, 2026 was a **Saturday**
      (off-schedule force/test — the cron only runs **Fridays**,
      `0 16 * * 5` per `vercel.json`), Jul 3 was the real scheduled Friday
      run, 6 days later — inside the old 7-day trailing window computed
      from Jul 3. **Correction to this item's own framing:** the original
      ask said verification "waits for a real Sunday," but this route's
      schedule is Friday, not Sunday (that's `weekly-digest`, a separate
      route) — flagging since the fix's real-world verification should
      watch the next Friday, not Sunday.
      Fix: new `lib/coverageCheck.ts` (`scheduledRunWeekStart()`, pure,
      10 unit tests including a direct reproduction of the Jun 27/Jul 3
      incident using the real dates) — dedup now keys off the most recent
      scheduled Friday-16:00-UTC instant, not a rolling window. Separately,
      `prisma.reminder.create(...)` in the route is now skipped entirely
      when `force === true` (the load-bearing fix — this is what actually
      stops a force send suppressing a same-week real run; the week-keying
      is defense-in-depth on top). The content window (what emails a real
      run's summary includes) is untouched — only the dedup boundary
      changed. Also found, out of scope, flagged only:
      **`app/api/cron/weekly-digest/route.ts` has the identical bug pattern**
      (same rolling lookback, same unconditional `reminder.create` under
      force) — the Sunday digest is equally exposed; not fixed here.
      Verified locally: `npm run build` clean, 421/421 tests passing (10
      new). **Real-world verification still needs a real Friday run** — not
      Done until confirmed live. Out of scope, untouched: cron alerting,

- **VERIFY BY: next Sunday 16:00 UTC scheduled cron run.**
- [ ] **weekly-digest dedup bug (Sunday "your returns this week") — FIXED
      2026-07-20, pushed, not deployed/verified yet — the real product
      email, all users, higher stakes than the Friday coverage-check.**
      Sanity-check confirmed the two routes **duplicate** the dedup logic
      (no shared module) — mirrored the fix rather than unifying at the
      source, duplication flagged as tech debt below. New
      `lib/weeklyDigestDedup.ts` (deliberately a near-duplicate of
      `lib/coverageCheck.ts`, Sunday/16:00 UTC instead of Friday/16:00 UTC)
      — dedup now keys off the most recent scheduled Sunday-16:00-UTC
      instant instead of a rolling 7-day lookback. `prisma.reminder.create(...)`
      in `weekly-digest/route.ts` now skipped entirely when `force === true`
      (the load-bearing fix, same as `9163d0b`). The "due this week" content
      window (`sevenDaysOut`, a forward-looking query — different shape than
      coverage-check's backward-looking content window, unrelated to dedup)
      is untouched. 9 new tests in `__tests__/weeklyDigestDedup.test.ts`,
      including a constructed same-week test-send-vs-real-run scenario
      (Jun 29 Monday off-schedule send vs. Jul 5 Sunday real run, 6 days
      apart, mirroring the real weekly-coverage incident's shape since there
      was no real reported incident date for this route specifically) —
      proves the old boundary would have dropped the user and the new one
      doesn't. Verified locally: `npm run build` clean, 430/430 tests
      passing (9 new). **Real-world verification still needs a real Sunday
      run** — not Done until confirmed live.

- **VERIFY BY: owner glance at production — browser-verifiable immediately, no cron wait needed.**
- [ ] **Sidebar account-email truncation (cosmetic) — FIXED 2026-07-20,
      pushed, awaiting owner verification in production — not Done.**
      `app/Sidebar.tsx` — added a `title={accountLabel}` attribute to the
      existing `truncate` span, same pattern already used for order-number
      display elsewhere in the app. **Diagnostic note:** `Sidebar` is
      `hidden md:flex` — desktop-only, no mobile equivalent exists (checked
      `BottomNav.tsx`, confirmed no account-email display there at all). Its
      column is a fixed `w-60` (240px) regardless of overall viewport width
      once ≥768px, so "narrow width" for this specific element means the
      sidebar's own fixed column, not the page's overall width — verified at
      both 768px (the `md` breakpoint boundary, the narrowest real case)
      and 1440px with a synthetic long email created solely for this check
      (`mckenna.sweazey+truncationtest@metaxmoda-extremely-long-example-domain.com`,
      a throwaway test user + session, deleted immediately after — not a
      real account). Confirmed at both widths: `scrollWidth > clientWidth`
      (ellipsis actually engaging, not just visually plausible) and the
      `title` attribute holds the exact full address. `npm run build` clean,
      430/430 tests passing (no test coverage added — CSS/layout, no jsdom
      per this project's component-testing philosophy). Browser-verifiable
      on deploy — owner should confirm on production, no cron wait needed.

## ❄️ Deferred

- [ ] **Phase 6 — Needs-review carrier row disambiguation (PAUSED 2026-08-29).**
      Card content fix not worth the squeeze given data. See `DECISIONS.md`
      2026-08-29. Revisit if: (a) carrier email volume grows and a larger
      sample (n>3 shipments) looks materially different, or (b) Phase 4/5
      gets scoped and this folds into that work.

## 🐛 Bugs

### Trust-breaking
- [x] **CLOSED 2026-08-27 — see ✅ Done ("orderDate write-once fixed,
      backfill executed") and `HISTORY.md` 2026-08-27 for the full arc.
      The email-detail-page return-deadline disagreement (frozen per-email
      snapshot, `Email.returnDeadline`) is NOT resolved by this closure —
      verified still showing Sep 23 post-backfill, exactly as predicted —
      and stays open as its own, separately-scoped, unbuilt fix (see the
      "Related, separate finding" note below, preserved). Original
      diagnosis + build detail preserved below, not edited:**
- [ ] **[CODE BUILT + TESTED + DEPLOYED 2026-08-27 (commit `c150170`) —
      backfill SQL revised after owner review, pending execution]
      orderDate write-once locks in the wrong email's date when
      extraction/linking happens out of receivedAt order.**
      **Build session 2026-08-27 close-out:** `prisma/schema.prisma` — new
      `Order.orderDateSource` field (`"extracted" | "fallback" | "unknown"`,
      migration `20260827224554_add_order_date_source`, additive, all 198
      existing rows default to `"unknown"`, applied to production — no
      code deployed against it yet). `lib/linkOrder.ts` — new pure
      `resolveExtractedOrderDate()` (an email's own AI-extracted
      `orderDate`, or — order_confirmation only — the forward resolver's
      `anchorDate` when the AI found none), wired into all three write
      sites (`createOrderFromEmail`, `mergeEmailIntoOrder`,
      `applyFallbackOrderDate`) plus a fourth site the original diagnosis
      didn't name but needed the same fix (`rebuildOrderFromRemainingEmails`,
      used by the order-review split action). `orderDate` is no longer
      plain write-once — a value sourced from `"fallback"` or `"unknown"`
      can be corrected by a later, genuinely-extracted date; a value
      sourced from `"extracted"` never can, preserving two independent,
      named historical protections that predate this fix (2026-08-16's
      shipping-email-overwrites-order_confirmation case, and the J.Crew
      #2523415500 lone-refund-email case — both still enforced via the
      `ALLOWED_FALLBACK_EMAIL_TYPES` type gate, deliberately kept, not
      dropped, despite this session's own draft algorithm initially
      omitting it — caught via a clarifying question before implementing,
      see the session transcript). 21 new/updated tests, 681/681 passing,
      `npm run build` clean.
      **Priority rule for what counts as "extracted," confirmed via a
      dedicated read-only investigation before implementing (0 billed
      calls) — not the original literal one-tier spec:**
      Priority 1 = an order_confirmation's own AI-extracted `orderDate`
      (50/198 orders). Priority 2 = no priority-1 signal, but that same
      order_confirmation's `anchorDate` (48/198 orders — nearly as large
      as priority 1, and specifically what corrects Zara, whose
      order_confirmation had `orderDate: null` in its own extraction and
      only carried the real Aug 16 date via `anchorDate`). Quality-checked
      first: 10 spot-checked orders where both signals existed (on
      different emails within the same order) showed deltas of 0.16–3.13
      days — extraction and anchorDate agree closely, priority order is
      not inverted. **Deliberately NOT extended to shipping_confirmation/
      delivery emails' anchorDate** (a "priority 3") — would additionally
      fix Shopbop #143429832 (36/100 otherwise-residual orders would
      resolve) but was only explored as an unvalidated hypothesis, not
      adopted this session. **Confirmed via a second, targeted check:
      Shopbop and all 6 previously-flagged orders (MANGO F4VLSF, Ruti
      424051, Bettervits USA 444466, H&M 66993117803, Sidekick SK213978,
      Tuckernuck TNK6875105) remain uncorrected under the adopted rule** —
      Shopbop has no order_confirmation at all; the other 6 either have
      none or have one with no signal in either field. All 7 get labeled
      `orderDateSource: "fallback"` by the backfill (documents provenance,
      doesn't invent a date) and stay open as a residual, not silently
      dropped — flagged explicitly for a future session to decide on the
      broader gate.
      **Backfill SQL drafted, NOT executed, REVISED after owner review:**
      `scripts/orderdate-source-backfill-20260827.sql` — SELECT-first, two
      idempotent UPDATEs (the orderDate+returnDeadline correction, and the
      label-only pass for residuals), commented rollback. **Also
      recomputes `returnDeadline`** for corrected orders — a raw SQL
      `orderDate` change does NOT trigger `computeDeadline()` the way a
      real ingested email would, so without this the deadline would stay
      stale even after `orderDate` is fixed.
      **First draft caught a real bug before running, via owner review of
      the eyeball list (not by inspection alone):** the original
      candidate-selection logic picked "the earliest order_confirmation
      with a signal" per order with no check that multiple such emails
      actually agreed. Two of the original 6 "bucket (a)" corrections were
      wrong: **Fitness Superstore #48868** has two order_confirmation
      emails whose own extracted `orderDate` disagree by a full year
      (2025 vs. 2026 — 2026 is correct; 2025 is a pre-existing,
      already-documented extraction bug, `ANCHOR_DATE_RESOLVER.md`'s
      deferred Part 3 "wrong year" guard) — the old logic picked the wrong
      one and would have corrupted an already-correct value. **Fixed:**
      added a disagreement check — when an order's order_confirmation
      emails disagree by more than same-day-different-time on the
      priority-firing field, the order is excluded from auto-correction
      entirely (falls to the fallback label, no value change) rather than
      guessing which signal is right. Verified live: excludes exactly
      Fitness Superstore. **Waitrose #1058208405** was also flagged during
      review (its one available anchorDate is a reschedule notice 3 weeks
      after the real order, not the order date) but does NOT get caught by
      the disagreement rule (only one signal exists, nothing to disagree
      with) — owner accepted this as-is: Waitrose is a grocery order, out
      of product scope, its orderDate accuracy doesn't affect any decision
      the app makes for it (see new Watch entry on grocery scope below).
      **Revised bucket (a) — 5 real value corrections, verified live
      against production:** Zara #54421192781 (Aug 22 → Aug 16,
      `returnDeadline` Sep 21 → Sep 15), Ulta Beauty #M223726065 (Jul 25 →
      Jul 24), SKIMS #SB33487073 (Jul 31 19:47 → Jul 31 00:00), SSENSE
      #44266308515307 (Jul 31 → Jul 30), Waitrose #1058208405 (Jul 14 →
      Aug 5, accepted non-goal correction). Of the remaining 193 orders:
      ~92 are relabeled `"extracted"` with no value change (already
      correct), ~101 relabeled `"fallback"` (no usable signal, or
      disagreement-excluded — includes Fitness Superstore, Shopbop
      #143429832, and the 6 previously-flagged orders).
      **Also surfaced during this verification, unrelated and NOT fixed
      here:** Waitrose's existing `returnDeadline` (2021-08-21) is itself
      badly broken — 5 years in the past. Traced to `returnWindowStartsFrom:
      "delivery_date"`, so it anchors on a `deliveredAt`/estimated-delivery
      signal, not `orderDate` — meaning this backfill correctly leaves it
      untouched (in scope only for `orderDate`-anchored deadlines), but the
      underlying value looks like the same "wrong year" extraction bug
      class as Fitness Superstore, just landing on a different field. New
      🐛 Bugs entry logged below, not investigated further this session.
      Per CLAUDE.md's data-write rule: **owner must review this SQL and
      run it manually against production** — the code change alone only
      affects emails processed from now on, it does not touch existing
      rows.

      **Root cause, confirmed via Zara's own data:** `applyFallbackOrderDate`
      (`lib/linkOrder.ts`) fires once, the moment an Order's `orderDate` is
      first null, and treats "the earliest-received email currently linked
      to this order" as a proxy for "the earliest email overall." That
      assumption breaks whenever an order is created from an email that
      ISN'T actually the earliest-received one — because a genuinely
      earlier email was orphaned (unlinked) at the time and only gets
      matched into the order LATER. `orderDate` is then write-once
      (2026-08-16 fix, `mergeEmailIntoOrder`) and is never revisited even
      after the true-earliest email retroactively links in. Zara's case:
      Order.createdAt (`2026-08-26T02:46:02`) matches the DELIVERY email's
      extraction time almost to the millisecond — the order was created
      FROM the delivery email (received Aug 22), not from either
      shipping_confirmation (received Aug 18 and Aug 21, both carrying
      `retailerSource: "sender_fallback"` — orphaned pre-2026-08-25 Zara
      retailer-identification fix, reconciled into this order only once
      the delivery email created it on Aug 26). `orderDate` was set to the
      delivery email's own `anchorDate`/`receivedAt` (Aug 22) by
      `applyFallbackOrderDate` at that exact creation moment, then frozen.
      The manually-forwarded order_confirmation (Aug 26, real send date
      Aug 16 per its forwarded header) later merged in but could not
      correct it — write-once, and separately, its own AI-extracted
      `orderDate` field was null anyway (only the anchor resolver's
      regex-parsed `anchorDate` had Aug 16; `mergeEmailIntoOrder`'s
      establishing-write condition only ever checks the AI-extracted
      `orderDate` field, never `anchorDate` — a second, related gap: even
      on a fresh order with no write-once lock yet, a manually-forwarded
      confirmation whose only date signal is the forwarded-header
      `anchorDate` can never establish `orderDate` via the merge path,
      only via the separate `applyFallbackOrderDate` path, and only if
      it happens to be the earliest-linked email when that runs).

      **Not Zara-only — confirmed systemic, not an artifact of this week's
      heavy Zara debugging.** Two independent checks across all 185 orders
      with a non-null `orderDate`:
      - **2/185 orders have a strictly IMPOSSIBLE orderDate** (the order's
        `orderDate` falls AFTER the earliest linked shipping_confirmation
        or delivery email's `receivedAt` — order placed after it shipped).
        Zara is one. **The other is a clean, non-Zara confirmation:**
        Shopbop order `143429832` — same exact mechanism, no Zara retailer
        fallback involved at all: its delivery email (received/extracted
        Aug 4) created the order and set `orderDate`, while its
        shipping_confirmation (received a day earlier, Aug 3) wasn't
        extracted until ~2 hours after the order already existed — pure
        extraction-processing-order variance, nothing forward-type or
        retailer-fallback specific. This confirms the bug is general
        (any out-of-order extraction/linking), not tied to Zara's
        particular orphan history.
      - **6/185 additional orders have an orderDate matching none of their
        linked emails' `receivedAt`, `anchorDate`, or own extracted
        `orderDate`** — a weaker, noisier signal (could reflect a
        re-extracted/changed email since orderDate was set, not
        necessarily this same bug), listed for completeness, not claimed
        as confirmed instances of this mechanism.
      - **Caveat, likely undercount:** the "impossible" check only catches
        cases where the wrong-earliest-email's date is late enough to be
        logically impossible. An order where extraction happened out of
        order but the wrong email's date still looks plausible (e.g., two
        emails received hours apart) would show a subtly-wrong `orderDate`
        that this check cannot detect. The true affected population is
        probably larger than 2.

      **Fix scope above — BUILT 2026-08-27, see the build-session summary
      at the top of this entry.** (This paragraph is what the design pass
      predicted before building; kept verbatim as the paper trail. The
      built solution took the "provenance, not write-once" direction
      rather than "revisit the earliest-email determination," and DID end
      up accepting `anchorDate` as an establishing source for
      order_confirmation specifically, exactly as flagged as a possibility
      here.)

      **Related, separate finding — return-deadline disagreement, same
      order, different mechanism:** Zara's order detail page shows Sep 21;
      its email detail page (the order_confirmation email specifically)
      shows Sep 23. Not two different implementations of the deadline math
      — the SAME function (`computeDeadline`, `lib/extract.ts`) called at
      two different times with different inputs, never reconciled.
      `lib/extract.ts`'s extraction pipeline calls it once per email, at
      that email's own extraction time, using only that email's own
      extracted fields, and persists the result on the `Email` row
      permanently (`Email.returnDeadline`) — a frozen snapshot, never
      revisited. `lib/linkOrder.ts` calls the same function twice more
      (`applyFallbackOrderDate`, `mergeEmailIntoOrder`), against the
      order-level merged fields, and keeps it live on every merge. The
      order_confirmation email's own extraction had `orderDate: null` (its
      AI extraction didn't find one) so its snapshot fell through to
      `computeDeadline`'s `estimatedDeliveryDate`-based branch
      (`Aug 24 + 30 days = Sep 23`); the order-level computation has
      `orderDate` non-null (Aug 22, the wrong value from the bug above) so
      it uses the `orderDate`-based branch (`Aug 22 + 30 days = Sep 21`).
      The email detail page (`app/(app)/emails/[id]/page.tsx`) renders the
      frozen per-email snapshot as if it were current truth, with no
      indication it can diverge from the order's own live value. **All 3
      production call sites of `computeDeadline` enumerated:**
      `lib/extract.ts` (per-email, frozen at extraction), `lib/linkOrder.ts`
      ×2 (`applyFallbackOrderDate`, `mergeEmailIntoOrder`, both order-level
      and live). Fix scope (not built): likely either stop persisting/
      displaying the per-email snapshot as a user-facing "deadline" at all
      (it's an artifact of extraction-time state, not a fact about the
      order), or recompute it whenever the order-level deadline changes —
      needs an owner call on which.
      **UPDATE 2026-08-27, build session: confirmed this does NOT
      self-correct automatically, and the backfill only fixes half of
      it.** The order-level `returnDeadline` does NOT recompute just from
      correcting `orderDate` — that only happens via application code at
      real ingestion time, never from a raw SQL `UPDATE` — so the backfill
      SQL (`scripts/orderdate-source-backfill-20260827.sql`) explicitly
      recomputes it using `computeDeadline`'s own case-1 formula (verified
      live: Zara's order page will show Sep 15 post-backfill, matching the
      expected Aug 16 + 30 days). **The per-EMAIL frozen snapshot
      (`Email.returnDeadline`, shown on the email detail page) is NOT
      touched by this backfill** — the `Email` table is out of this
      session's scope. Zara's order_confirmation email detail page will
      keep showing Sep 23 even after the backfill runs, while the order
      page correctly shows Sep 15 — the exact disagreement this finding
      first surfaced, now confirmed to persist post-backfill rather than
      resolved by it. **Verify this explicitly after the backfill runs**
      (open item, not done here) and treat the per-email snapshot fix as
      still fully unbuilt, needing its own session per the fix-scope note
      above.

      **Manual-forward late-arrival, checked as its own hypothesis and
      narrower than feared:** orders where an `order_confirmation` was
      received AFTER a `shipping_confirmation`/`delivery` email on the
      same order: **2/198**, not systemic on its own — Zara (4.3-day gap,
      the real "late manual forward" shape) and Freda Salvador `234403`
      (2-minute gap, not meaningfully "late," likely back-to-back
      forwards). This confirms the design doc's "0 orders need fallback B"
      finding still holds for the manual-forward-lateness framing
      specifically — but the broader out-of-order-extraction bug above is
      NOT limited to manual forwards (Shopbop had none involved) and is
      the real, larger-scoped issue.

- [ ] **7/21/2026 ingestion incident — 12 orphaned rows. Investigated
      2026-08-20, confirmed as a genuine incident window, not an
      isolated glitch. Not fixed — cleanup is a separate, owner-approved
      step, not done here.** Surfaced while investigating a
      food-grocery-exclusion "miss" (see the ✅ Done entry's correction
      note) — the 3 Whole Foods rows involved turned out to be part of a
      much larger, previously-undercounted pattern.
      **Incident window: 2026-07-21, 15:59–21:39 UTC (5.7 hours).** Four
      same-timestamp duplicate clusters, spanning four unrelated original
      senders (rules out a sender-side cause):
        - 15:59:22 UTC — FedEx "out for delivery" (tracking 522569099412):
          13 rows, 7 extracted, **6 never extracted**
        - 17:36:09 UTC — Amazon/Whole Foods "order picked up": 4 rows, 1
          extracted, **3 never extracted**
        - 19:11:20 UTC — FedEx "delivered" (same tracking 522569099412): 8
          rows, 6 extracted, **2 never extracted**
        - 21:39:09 UTC — Mejuri "The wait is over!": 2 rows, 1 extracted,
          **1 never extracted**
      **12 of 52 Emails received that day (23%) have `extractedAt IS
      NULL` — never even attempted, not attempted-and-failed** (a failed
      attempt still stamps `extractedAt` per `runExtraction.ts`'s catch
      block). 27 of the 52 (52%) were part of a duplicate-timestamp
      cluster at all. Two of the four clusters (15:59, 21:39) were not
      previously documented anywhere; the 19:11:20 cluster was partially
      known as "ACE VISALIA RSC ×6" (the Bugs/Infra digest-duplicate
      item and Decisions log) but that entry only ever counted the 6
      successfully-extracted duplicates, never the 2 that never
      extracted at all.
      **Ruled out:** a bad deploy — zero commits landed on 2026-07-21 at
      all (last commit before: 2026-07-20T21:52 PT; next: 2026-07-22).
      DiscardLog shows no spike (4 rows all day, all `non_commerce`,
      proportionally lower than a quiet-day baseline) — whatever failed,
      it wasn't over-rejection at the classification/discard layer.
      **Most likely mechanism, unconfirmed:** the already-logged
      Anthropic credit-balance outage was measured ending
      2026-07-20T22:52:46Z, hours before this window — but degraded
      (not fully down) API behavior extending past that bookend, causing
      some `runExtraction` calls to hang/time out and the resulting
      redelivery to land as a new row, is consistent with every cluster
      showing a MIX of extracted/unextracted outcomes (never clean 0% or
      100%). **Cannot be confirmed — no runtime/error logs are available
      this far back**, and there is no other log source with per-request
      detail (`DiscardLog` carries no per-email identifier).
      **Cleanup, not yet run:** junk all 12 orphaned rows (match:
      `receivedAt` within the incident window AND `extractedAt IS
      NULL`). Small script, mirrors the food-grocery sweep pattern
      (census → dry-run → owner-approved apply). Needs its own
      owner-approved dry-run before any write — separate flow from this
      board update.
- [ ] **Weekly coverage-check digest junk RECURRED on the 2026-08-07 run —
      NEW FINDING 2026-08-08, READ-ONLY diagnosis (scripts/pm-repro-coverage-
      digest-mckenna*.ts, uncommitted), 0 billed Anthropic calls, 0 writes.
      Different root cause than the 07-25 incident below — NOT a repeat of
      that regression, NOT fixed by the 08-05 placedDate commit (`2ef71e5`),
      because that fix only touches the LINKED-order branch and this is
      entirely the unlinked-email branch, which the 08-05 commit explicitly
      left unchanged.** Reported by the owner from a real received digest:
      11 "1 order from an unknown retailer" lines + 1 "1 order from Chan
      Luu" line the owner did not order. Reproduced exactly (11 + 1, row for
      row) by replaying the route's real query against the actual send
      window, pinned via the real `Reminder.sentAt` for
      `weekly_coverage_check`: **2026-07-31T16:03:38Z → 2026-08-07T16:03:38Z**
      (rolling 7 days from the exact cron-run instant, keyed on
      `Email.receivedAt` — not a calendar week, not aligned to "since last
      Friday" if the schedule ever drifts).
      **Two distinct causes, both in `app/api/cron/weekly-coverage/route.ts`:**
      **1. The 11 "unknown retailer" lines are all real emails, not a query
      bug.** Every one is either an unlinked email with no retailer
      (`orderId: null`, e.g. bare USPS tracking emails) or an
      `emailType: null` extraction-failure row — 4 of the 11 are the
      already-documented Amazon "Advance refund issued" cluster from the
      Jul 31–Aug 1 Anthropic credit outage (see the Aug 1-4 credit-outage
      item, this file), 1 is the already-flagged residual `lookupReturnPolicy`
      timeout row ("Suzie Kondi Return", `cmsdunton...`, still open per the
      Aug 1-4 backfill item), 2 are duplicate "Re: Region 109 Order
      Confirmation" forwards, 1 is a marketing newsletter ("Green Shoots at
      Gucci and Dior...") that slipped the Haiku commerce gate. **By design**
      (`lib/junk.ts`'s `shouldAutoJunk`), `emailType: null` rows are never
      auto-junked — deliberately, so a human can still resolve a genuine
      extraction failure — but the coverage-check query (`JUNK_FILTER` only,
      no `emailType` filter at all) doesn't distinguish "extraction failed,
      needs a human" from "here's an order," so every one renders identically
      to a real purchase line. **2. The Chan Luu line is a genuine order-
      linking gap, not junk.** The owner's original Chan Luu order (linked,
      placed 2026-07-19, already refunded as of 2026-08-03 — confirmed via
      its own "Refund notification" email, same window) is fine. But a
      SEPARATE email — "Fwd: Your Chan Luu return is approved (HRYTSJRJ)",
      matching the Happy Returns return label the owner has (order 20473581,
      express code HRYTSJRJ, "Ramona Poplin Pant Caviar", return started
      2026-07-25) — got linked to a brand-new orphan Order
      (`cmsf9771o000fw9xbdateg6nu`) instead of being matched back to the
      existing Chan Luu order. That orphan Order has no resolved
      `orderDate`. The 08-05 fix's null-policy ("an indeterminate orderDate
      defaults to inclusion, not exclusion, so a real this-week purchase
      isn't silently hidden") is doing exactly what it was built to do here
      — it's just applying that policy to an orphaned return-tracking Order,
      not a real new purchase, which is what makes it render as "1 order
      from Chan Luu" as if freshly bought. **Not fixed here — diagnosis
      only, per this file's own convention.** Candidate fix directions, not
      built, need an owner call: (a) give the coverage-check its own
      `emailType` allowlist (e.g. only `order_confirmation` counts as "you
      bought this," `return_label`/`refund`/pure `delivery` either get
      dropped or get different copy) — likely fixes both the 11-line flood
      and the Chan Luu phantom in one change; (b) separately, find why the
      Chan Luu return-approval email didn't match its existing order — same
      class of gap as the already-tracked "no-fallback-matcher" orphan
      items elsewhere in this file, worth checking whether it's the same
      root cause or a new one.
- [ ] **Weekly coverage-check digest junk RECURRED AGAIN on the 2026-08-14
      run — NEW FINDING 2026-08-16, READ-ONLY diagnosis
      (`scripts/pm-repro-coverage-digest-mckenna-v2.ts`, already-existing +
      2 new one-off ownership-checked scripts this session, all
      uncommitted), 0 billed Anthropic calls, 0 writes.** Owner received a
      digest showing Suzie Kondi and J.Crew lines, neither a new purchase
      that week — both are old, already-refunded orders. Confirmed via the
      real `Reminder.sentAt` window (2026-08-07T16:46:56Z →
      2026-08-14T16:46:56Z): both retailers' only emails landing in that
      window were a `return_label` + a `refund` email (Suzie Kondi) and a
      lone `refund` email (J.Crew) — post-purchase-loop mail, not new
      orders. **Two distinct causes:**
      **1. J.Crew — the already-known gap, recurring.** Same root cause as
      the Chan Luu incident above: this Order was created entirely from an
      orphaned `refund` email (no `order_confirmation` ever linked), so
      `orderDate` is correctly left null by `applyFallbackOrderDate`'s
      type gate (`lib/linkOrder.ts`) — but the coverage-check's
      null-defaults-to-inclusion policy then shows it as if freshly
      bought. Confirms candidate fix (a) from the 2026-08-08 entry above
      (an `emailType` allowlist in the coverage-check, e.g. only
      `order_confirmation` counts as "you bought this") is still open and
      would fix this instance too.
      **CORRECTION 2026-08-16, per this file's "don't let a hypothesis get
      mistaken for fact" rule — not rewritten in place, appended instead:**
      the "orphaned `refund` email, no `order_confirmation` ever linked"
      mechanism above is confirmed correct as a description of Order
      #2523415500 itself. What's wrong is the implication that no real
      J.Crew order exists behind it. It does — #2523415500 is a duplicate
      orphan of a separate, healthy Order, **#2522877374**, which has its
      own real `order_confirmation`/`shipping_confirmation` and an intact
      `orderDate`. See the new bug entry below, "Same real order ingested
      under two order numbers," for the full mechanism and verification.
      **2. Suzie Kondi — NEW, not previously documented.** This is a
      DIFFERENT bug, upstream of the digest: the order's `orderDate` was
      NOT null — it had been silently overwritten to the refund email's
      own date. `mergeEmailIntoOrder` (`lib/linkOrder.ts` line ~499,
      `const mergedOrderDate = email.orderDate ?? existing.orderDate`) has
      no `emailType` gate, unlike `applyFallbackOrderDate`'s
      `ALLOWED_FALLBACK_EMAIL_TYPES` a few lines away in the same file. The
      refund email's own AI-extracted `orderDate` field (confirmed on the
      row: set to the refund email's own received date) unconditionally
      superseded the order's real, already-correct `orderDate` when the
      refund email was linked, also clearing `orderDateEstimated` to
      `false` (line ~525) since a "genuinely extracted" date is trusted
      unconditionally — so the corruption doesn't even self-flag as an
      estimate. Net effect: a real order placed weeks earlier now reads as
      placed the day its refund posted. This is a data-correctness bug,
      not just a digest-display one — `orderDate` feeds `returnDeadline`
      too (moot for a completed/refunded order, but not for any other
      order this same merge path touches with a still-open deadline).
      **Not fixed here — diagnosis only.** Two fix directions, not built,
      need an owner call: (a) apply the same
      `ALLOWED_FALLBACK_EMAIL_TYPES`-style gate to `mergeEmailIntoOrder`'s
      `orderDate` merge (only `order_confirmation`/`shipping_confirmation`/
      `delivery`-typed emails' extracted `orderDate` may set/overwrite —
      this is the data-correctness fix, independent of the digest); (b)
      the coverage-check `emailType` allowlist from the 2026-08-08 entry
      (the digest-specific fix — would also cover J.Crew and any future
      null-orderDate orphan). Likely want both: (a) prevents the order
      record itself from silently going wrong; (b) prevents the digest
      from over-trusting `orderDate` even when it's null for legitimate
      reasons.
      **ADDENDUM 2026-08-16 — read-only provenance diagnostic run
      (`scripts/pm-diag-orderdate-provenance.ts`), 0 billed calls, 0
      writes, scoped to owner's data only.** Confirms the finding above
      directly: Suzie Kondi #99500's stored `orderDate` (2026-08-12)
      matches its `refund` email's own extracted date exactly, while its
      `order_confirmation`/`shipping_confirmation` emails both carry the
      true date (2026-07-23) — classified `CORRUPTED_RECOVERABLE`, true
      date recoverable. Population scan across all 53 of this owner's
      orders with a non-null `orderDate`: exactly **1** `CORRUPTED_RECOVERABLE`
      (this same row), **0** `CORRUPTED_UNRECOVERABLE`, **0**
      `SUSPICIOUS_AMBIGUOUS` — **owner-scoped and provisional as first
      written; see the unscoped, all-users rerun below, which is the real
      sizing since `mergeEmailIntoOrder` is shared code, not
      owner-specific.** Also checked J.Crew **#2522877374** specifically
      (a different order than the digest offender): it DOES have two
      establishing emails linked (order_confirmation +
      shipping_confirmation, both 2026-07-09) and its `orderDate` is
      intact (`OK_FROM_ESTABLISHING`) — status `kept`.
      **CORRECTION 2026-08-16 (same session, caught before this entry was
      acted on):** the line above originally read "two distinct real
      J.Crew purchases on this account" — that was wrong. It is **one
      purchase, two Order rows (duplicate — see the new bug entry directly
      below, "Same real order ingested under two order numbers")**.
      #2523415500 ($350.65, refund-only, `orderDate: null`, created
      2026-08-13) is a duplicate orphan of #2522877374, not a second real
      purchase. No fix or backfill applied this pass — diagnosis only, per
      this file's own convention.
      **FOLLOW-UP 2026-08-16 — unscoped population scan (all users, same
      script, `--all-users`), 0 billed calls, 0 writes.** Real sizing,
      across all 150 orders (any user) with a non-null `orderDate`: **2**
      `CORRUPTED_RECOVERABLE` (Suzie Kondi #99500 above, plus a
      newly-surfaced `Fitness Superstore #48868`, id
      `cmrdz8en40009jp04kvmeuvv8`, stored 2026-07-09 → recoverable to
      2025-07-09 — note the year gap, not eyeballed further this pass),
      **0** `CORRUPTED_UNRECOVERABLE`, **1** `SUSPICIOUS_AMBIGUOUS`
      (`Bloomingdale's #779507885`, id `cms6rt854000bkv04e19mdwcv`, stored
      2026-07-26, matches both an establishing and non-establishing
      email's extracted date — needs eyeballing, not done here). This is
      the real blast radius for a future `mergeEmailIntoOrder` backfill,
      not the owner-scoped "1" above. Not fixed or backfilled — sizing
      only.
- [ ] **Same real order ingested under two order numbers → duplicate
      Order + split state — NEW 2026-08-16, owner-confirmed, DEFERRED (not
      fixable today).** One real J.Crew purchase exists as two Order rows:
      **#2522877374** (`cmre1luf00003l1049r31eqoy`; `order_confirmation` +
      `shipping_confirmation`, `orderDate` 2026-07-09, status `kept` — the
      healthy original) and **#2523415500** (`cmsr633e00003l1049lnzyre9`;
      lone orphaned refund, `orderDate` null, created 2026-08-13 — the
      refunded twin). The purchase's refund email carried order number
      2523415500, unrelated to the original 2522877374, so
      `lib/linkOrder.ts` matching spawned a new orphan instead of matching
      back. Matching is partial: the `return_label` emails (no order
      number/date) fallback-matched onto the original and resurfaced the
      Kept order for review (the 08-16 "return_label on a Kept order"
      card), while the refund did not. **Two-fold trust damage:** (1) the
      digest surfaces the orphan as a fresh J.Crew purchase (the 08-14
      line); (2) the real order shows `kept` when it was actually
      returned/refunded, because its refund landed on the twin.
      **Recurrence of the Mango order-number-mismatch watch-item** (⚪
      Someday — `F4VLSF` vs `F4VLSF00`, ReBOUND suffix) — this is the
      recurrence that item said to wait for — **but a BROADER mechanism.**
      Mango was a suffix-append (fuzzy suffix-strip catches it); J.Crew's
      two numbers are wholly unrelated, so suffix-strip would NOT.
      General pattern: post-purchase mail (refund especially) can carry a
      return-service reference bearing no relation to the original order
      number. Same class as the Chan Luu return-approval orphan
      (Trust-breaking, 2026-08-08, above).
      **Deferred by owner 2026-08-16. No fix this session.** When built,
      lives in `lib/linkOrder.ts` matching — candidate signals to rejoin
      an orphan refund to its order: customer email + item names + amount
      + return reference (order number is unreliable). Fold the Mango
      watch-item in at that point. **Interim containment:** the digest
      new-purchase-signal fix (require an establishing/`order_confirmation`
      email to count as "you bought this") folds #2523415500 out of the
      digest without solving the duplicate — ship it regardless.
      **VERIFICATION 2026-08-16 — full read-only dump + identifier
      comparison (`scripts/pm-diag-jcrew-duplicate-order-compare.ts`), 0
      billed calls, 0 writes, ownership-checked on both rows.** #2523415500's
      only linked email: `refund`, subject "Your J.Crew return or exchange
      has arrived," `orderNumber: "2523415500"` stated on the email itself
      (a J.Crew-generated return/exchange reference, not the original
      order number), `fromEmail: jcrew@service.jcrew.com`. Candidate-signal
      results against #2522877374: **item name/style codes are an exact
      match** — all 6 line items on the orphan (styles CV252, CU576,
      CV100 ×2 sizes, CR536 ×2 sizes) are a subset of the original's 11
      line items, same style codes/colors/sizes, just reformatted between
      the two extractions — the strongest signal available. Amount is
      close but inexact: orphan refund $350.65 vs. the matching 6 items'
      combined original price $326.00 (a ~$24.65 gap, plausibly tax/
      shipping/restocking on the return, not investigated further).
      `fromEmail` does NOT match — original's senders are
      `jcrew@mailfrom.orders.jcrew.com` / `jcrew@mailfrom.dev.orders.jcrew.com`
      / `jcrew@jcrew.narvar.com` (plus the owner's own address from one
      manual forward); none match the orphan's `jcrew@service.jcrew.com`.
      Order number does NOT match, confirmed (2523415500 vs 2522877374,
      wholly unrelated, as already stated above). **Confirmed via the
      coverage-check repro** (`scripts/pm-repro-coverage-digest-mckenna-v2.ts`)
      that the 08-14 digest's "J.Crew — $350.65" line traces to
      #2523415500 specifically — it's the only J.Crew row in the real send
      window; #2522877374 has zero email activity in that window (last
      activity was return_labels on 07-30 and 08-04, both before the
      window opens 08-07).
      **FIX-DIRECTION CORRECTION 2026-08-16 — record only, do not build.**
      The 08-14 entry's fix #1 ("apply the same `ALLOWED_FALLBACK_EMAIL_TYPES`-
      style gate to `mergeEmailIntoOrder`'s `orderDate` merge — only
      order_confirmation/shipping_confirmation/delivery-typed emails may
      set/overwrite") is insufficient as stated and must NOT be built in
      that literal form. Suzie Kondi's own email chain proves why: its
      `order_confirmation` (2026-07-23, correct) is followed by a
      `delivery` email (2026-07-31) that also carries its own extracted
      `orderDate` — and `delivery` is itself an establishing type. A
      same-type-allowlist-may-overwrite rule would let the later delivery
      email's date silently replace the earlier, correct order_confirmation
      date, reproducing the identical corruption class one step removed.
      The correct fix shape is **write-once**: `orderDate` may be set from
      the first establishing-typed email that supplies one, and never
      overwritten again afterward regardless of the type of any
      subsequently-linked email, establishing or not. Note for the build
      session; nothing built this pass.
      When this matcher is built, join on item/style-code overlap
      (confirmed 08-16: 6-of-11 style codes matched exactly between
      #2522877374 and orphan #2523415500). Order number, fromEmail, and
      amount all diverge — do NOT use them as match signals.
- [ ] **Friday weekly coverage-check digest badly broken — REGRESSION,
      user-facing, multiple alpha users, weekly all-users email. HIGH
      SEVERITY. Confirmed 2026-07-25 on 2+ alpha users via real received
      digests (screenshots).** Clean as of last Friday's run and is junk
      now — something in the last ~week changed what it surfaces. Four
      distinct defects, capture only, not investigated:
      **▶ CURRENT STATE (as of 2026-07-26 eve) — READ THIS FIRST, detail
      below is the historical diagnosis:** Defects 1 + 3 (the "unknown
      retailer" flood + stale-window) were an OUTAGE SCAR, not a code
      regression — repaired by re-extracting the 23 outage rows on healthy
      credits (15 real / 8 junked / 0 unreadable). The "exclude vs. surface
      unreadable orphans" design question is CLOSED AS MOOT — no residue to
      design around. Defect 4 (JUNK_FILTER) = REFUTED, both accused commits
      post-date the broken run. **ONLY REMAINING WORK — defect 2:** the 12
      pre-guard duplicate-race rows (07-21 ACE VISALIA RSC ×6 + 07-23
      GLOBAL-E NL B.V. ×6, all orderId:null, all messageId:null) still render
      as 12 separate digest lines because the route's per-order dedup only
      collapses when orderId is set. Fix needs a CONTENT-based key (subject +
      htmlBody hash + same-second cluster — the 3-signal method already used
      to confirm these clusters), NOT a messageId key (null on all 12), and
      NOT the forward-only ingestion guard 0b055df (these predate it). Scope
      is exactly these historical rows; nothing else on this entry is open.
      **Root-cause note:** the flood volume was emailType:null orphans from
      the 07-19→07-21 API-outage burst — the same runExtraction findUnique-gap
      failure class fixed 2026-08-08 (ee72159). Source inflow now reduced;
      this entry is the historical-row cleanup tail of that same story.
      **1. PRIMARY — "unknown retailer" flood.** The majority of lines read
      "1 order from an unknown retailer" — orders with no resolved
      retailer (orphaned / extraction-failed / emailType:other /
      null-retailer rows) are flooding the digest. This is the dominant
      problem; even with dedup fixed, the digest is still junk because of
      these. These are UNRESOLVED orders, a different population from the
      duplicates below.
      **2. Duplicate lines.** ACE VISALIA RSC (×6) and GLOBAL-E NL B.V
      (×3) repeat — the MessageID-redelivery dupes tracked separately (see
      the ACE VISALIA item above). The ingestion dedup fix will reduce but
      not eliminate the digest junk (only defect 2, not 1/3).
      **3. Stale orders / wrong window.** AquaTru appears but is not from
      this week. Date-window problem — either the coverage window query,
      or orders carrying unreliable dates (possible overlap with the
      anchor-date / Part 3 wrong-date work).
      **4. Prime hypothesis (JUNK_FILTER field regression) — DIAGNOSED
      2026-07-26, REFUTED.** Read-only pass, zero model calls (confirmed
      the route imports nothing but `prisma`/`postmark`/`adminNotify`/
      `coverageCheck`/`junk` — no extraction/Anthropic call site on this
      path). `JUNK_FILTER` is `{ junkedAt: null }` — its only ever job,
      since it was introduced in the *same* commit as `Email.junkedAt`
      itself (`54fe13f`, 2026-07-22). Diffing that commit shows the query
      had **no filter at all** before it — so there is no prior working
      exclusion that a later commit could have broken; `0b055df` and
      `13521ca` don't touch `JUNK_FILTER`, `shouldAutoJunk`, or
      `linkEmailToOrder`'s orphan branch at all (confirmed by inspection).
      **Also a hard timing kill:** the real broken send was the scheduled
      run at 2026-07-24T16:26:56Z (confirmed via actual `Reminder` rows,
      `reminderType: "weekly_coverage_check"`) — `0b055df` and `13521ca`
      were committed 2026-07-25 evening Pacific (≈2026-07-26T02:39Z /
      T05:28Z), **after** the run they were suspected of breaking. Neither
      commit can be the cause. The junk-backfill (applied 2026-07-23, 168
      rows) predates the broken run but only ever targeted
      `emailType === "other"` orphans — confirmed 0 drift, not a suspect
      either.
      **Actual root cause, confirmed by data:** the flood is
      `emailType === null` orphans — the `runExtraction.ts` catch-block
      failure fingerprint, which `shouldAutoJunk`/`JUNK_FILTER` are
      *deliberately* designed to never hide (per `lib/junk.ts`'s own
      comment: "must stay visible... for a human or a re-extraction to
      resolve"). Nothing regressed here — this population was always
      excluded from junking, by design. What changed is volume: **35 such
      orphans were created in a tight 3-day burst — 2 on 07-19, 21 on
      07-20, 12 on 07-21, zero since** — landing squarely inside the
      07-24 run's rolling 7-day content window (07-17→07-24). The 07-20
      spike lines up exactly with the already-logged Anthropic
      credit-balance outage that day (see the Preorder ship-date item,
      🔴 Now: "confirmed real, credit has since been restored"). The
      07-17 run's own window (07-10→07-17) has **zero** such orphans —
      fully explaining "clean last Friday, junk this Friday" without any
      code change at all. Live replay of the exact query right now: 90
      real digest lines across 13 users, 36 (40%) read "unknown
      retailer," 35 of those 36 are this same `emailType: null` population
      (1 is an unrelated genuinely-unlinked `shipping_confirmation`).
      **Recommended fix scope (not built, awaiting go-ahead):** this is an
      ingestion/extraction-failure-debris problem, not a junk-mechanics or
      digest-query bug — options are (a) give the digest its own
      exclusion for `emailType: null` orphans (accepts hiding a real
      failure signal from this one outbound email, doesn't touch the
      Needs Review dead-end), or (b) narrow the digest's content window
      logic so a failed-extraction row that's already `needsReview: true`
      with no resolution path doesn't get a second life as digest spam.
      Needs an owner call on which, not a diagnosis.
      **Defect 3 (stale window) — diagnosed, different mechanism than
      expected, not a date-corruption bug.** AquaTru specifically is not
      even in the *current* rolling window (all 5 linked emails predate
      2026-07-19T23:02Z), but it was correctly inside the 07-24 run's
      window (07-17→07-24) via a 07-18 delivery email — the order itself
      dates to 07-12 `orderDate`. Nothing wrong with the dates on this
      order (`orderDate`/`returnDeadline` both sane) or with
      `computeDeadline`/the anchor-date resolver. The real issue: "this
      week" is a rolling 7-day window keyed on the *email's* `receivedAt`,
      not the *order's* age — a 12-day-old order with a late-arriving
      delivery notification legitimately re-enters the window and reads
      as stale to the user even though the code is doing exactly what it
      was built to do. Design question for the content window, not a bug
      in the anchor-date/Part-3 sense — explicitly does **not** need to
      bounce to Part 3.
      **Read-time MessageID dedupe question (asked, not built) — ANSWER:
      YES, needed.** Live replay of the current window shows the exact
      07-21 ACE VISALIA RSC cluster (6 rows, all `orderId: null`, all
      `receivedAt` 2026-07-21T19:11:20Z) and the 07-23 GLOBAL-E NL B.V.
      cluster (6 rows, all `orderId: null`, two same-timestamp sub-groups)
      *currently* rendering as 6 + 6 = 12 separate real digest lines — the
      per-order dedup in the route only collapses lines when `orderId` is
      set, so orphaned redelivery dupes never dedupe today. `0b055df`
      stops *new* duplicate rows but these 12 predate it (`messageId:
      null` on all of them — the field wasn't populated on any row before
      the guard shipped), so it doesn't help retroactively. A fix would
      need a content-based key (subject + htmlBody hash + same-second
      cluster — the same 3-signal method already used to confirm these
      clusters), not a `messageId` key, since `messageId` is null on
      every affected row. Not built — this stays scoped to defect 2's
      existing forward-only fix per the session brief; noted here only to
      answer the yes/no question asked.
      **Not investigated this pass:** whether/how to resolve the
      `emailType: null` orphan population itself (re-extraction retry,
      etc.) — out of scope, this pass only traced why it floods the
      digest.
      **UPDATE 2026-07-26 (evening): Core-block flood REPAIRED.** Cause
      confirmed = the 07-19→07-20 API outage (~23h, measured via bookend
      query), NOT a `JUNK_FILTER` regression — both accused commits
      post-date the broken run. Re-extracted the 23 outage rows on
      healthy credits: 15 real commerce (auto-linked), 8 confirmed junk
      (correctly auto-junked), 0 unreadable. => the "exclude vs. surface
      unreadable orphans" design question is **CLOSED AS MOOT** for this
      population — there is no residue to design around. Remaining
      digest work is ONLY the 12 duplicate-race tail rows (07-21
      same-second redelivery clusters), which need the content-key
      dedupe (`messageId` is null on them). **Defects 1+3 = outage scar,
      repaired. Defect 2 = the 12 rows, queued. Defect 4 (`JUNK_FILTER`)
      = refuted, not a cause.**
- [ ] **Unlinked email "Needs review" badge is a dead end — confirmed
      2026-07-22 while diagnosing the Needs Review panel build (🔴 Now).**
      `app/(app)/page.tsx`'s orphaned-email query (`Email.findMany({ where:
      { orderId: null, userId } })`) is NOT filtered by `needsReview` at
      all — every unlinked email renders, with a "Needs review" badge shown
      conditionally per-item. But the ONLY action available on that list is
      `deleteEmail` (hard, immediate `prisma.email.delete()`, no
      soft-delete/recovery) — there is no "confirm," "approve," "link to an
      order," or any action that actually resolves the flag. **Confirmed:
      two fully separate `needsReview` flags exist** — `Order.needsReview`
      (surfaced in the "Needs review (N)" panel, `ReviewCard.tsx`) and
      `Email.needsReview` on orphaned emails (badge-only, in "Unlinked
      emails," today a genuine dead end). Real counts as of 2026-07-22: 13
      Order-level, 206 orphaned-email-level. Not fixed here — the Needs
      Review panel build (🔴 Now) will fold a safe subset of the
      email-level population in (the confirmed-non-commerce cluster only,
      via Delete-behind-confirm), but the remaining orphaned-email
      population still has no resolve path after that ships; flagged for a
      separate follow-up, not silently left implicit.
- [ ] **Everlane #E10025135 — real order with orderDate == null because its
      earliest linked email is typed `other`, which the orderDate-fallback
      gate in applyFallbackOrderDate excludes. Surfaced 2026-07-25.
      Question to answer: is the emailType === 'other' gate silently
      eating legitimate order dates? Same gate that skips marketing email.
      Investigation only, not yet diagnosed.**
- [ ] **Mobile-audit finding #4, CONFIRMED via 2 mechanisms 2026-07-20: display
      never suppresses countdown/at-risk for Kept (or Refunded) orders.**
      `OrderCard.tsx`'s `atRisk` and `DaysLeftChip` both run on
      `returnDeadline` with no `displayStatus` check anywhere. Normally
      invisible because kept = archived = filtered off the dashboard;
      surfaces on unarchive (see the Unarchive bug directly below) or any
      future view that shows kept/refunded orders alongside active ones.
      Full diagnostic trail: the LR #512867 Kept-status investigation
      (🔴 Now, `45574af`). **The queued label-coherence spec pass must
      explicitly cover this "kept-then-unarchived" sequence, not just the
      simultaneous-badge/button case it was originally scoped for.**
- [ ] **Unarchive doesn't reconcile status — state bug, produces the finding
      #4 contradiction above.** Unarchiving a kept/refunded order un-hides
      it with its decided state AND a live deadline intact (`PATCH
      /api/orders/:id/archive` only ever touches `archivedAt`, zero
      awareness of `displayStatus`/`keptAt`/`returnedAt`) — confirmed this is
      the only sequence consistent with `buildStatusTransitionData`'s
      atomic archive-on-kept write (see the same LR #512867 investigation).
      Proposed direction, not built: Unarchive should reconcile
      (downgrade/clear the decided status) or at minimum warn before
      un-hiding a kept/refunded order.
- [ ] **MOVED TO ✅ Done 2026-08-08 (fix deployed and verified) — pointer
      only, original text preserved there, not edited in place.**
- [ ] **"Unlinked emails" section shows a raw tracking-style URL in the body
      preview** — e.g. `click.mkt.isdnn.com/...` visible in a forwarded
      promotional email's preview text, reads as spam/phishing leaking into
      the app's own UI. Surfaced by trust audit (`TRUST_AUDIT.md` row 12),
      not in today's scope. Proposed fix: strip/hide raw URLs from the
      preview snippet before display.
- [ ] **Bare "Delivery date —" / "Return by — (est.)" renders with zero
      explanatory context** when the field is simply not yet known — could
      read as "the app failed to fetch this" rather than "we don't have a
      delivery email yet, that's normal." Surfaced by trust audit
      (`TRUST_AUDIT.md` row 15), not in today's scope. Proposed fix: a short
      inline hint on the fields most central to the app's promise.
- [ ] **Delivery date renders "—" even when `estimatedDeliveryDate` exists —
      display bug**, split out from the design question in
      `delivery-date-first-class-surface` (🟡 Next). Cross-ref that item;
      that item itself is not moved or edited.
- [ ] **Investigate duplicate Order rows for On order 101130827062601745 —
      EXPLAINED 2026-07-28, not a LinkOrder merge bug.** Confirmed as part
      of the 🔴 Now P0 cross-user-leak diagnosis: the two rows are the
      owner's own On receipt, envelope-sent by him to both his own and a
      family alpha-tester's forwarding address ~90 seconds apart — each
      correctly `userId`-scoped, never one row shared. `lib/linkOrder.ts`
      is not implicated. Remaining open question (owner's call, not a bug
      fix): whether/how to surface or dedupe this class of accidental
      cross-account duplicate in the UI. Full detail: `HISTORY.md`
      2026-07-28.
      → see 🔴 Now: P0 cross-user leak (2026-07-28)
- **RESOLVED 2026-07-20 (`9163d0b`, see 🔴 Now):** ~~Coverage-check dedup
  should key off scheduled-run-week, not rolling 7-day lookback~~ [email
  delivery] — fixed: `lib/coverageCheck.ts`'s `scheduledRunWeekStart`, dedup
  now keyed off the scheduled Friday run instead of a rolling window.
  Real-world verification still pending the next Friday.
- **RESOLVED 2026-07-20 (`9163d0b`, see 🔴 Now):** ~~Verify whether the
  coverage-check route on `?force=true` writes the Reminder row identically
  to a scheduled run~~ [email delivery] — confirmed it did (this was the
  load-bearing half of the bug); fixed by skipping the Reminder write
  entirely when `force === true`. Same class of bug also found and fixed in
  `weekly-digest/route.ts` this session (Sunday digest, higher stakes) —
  see 🔴 Now.
- [x] **[PROMOTED to 🔴 Now 2026-08-04] Amazon deadline reminders firing** —
      pointer only, not edited further. Was filed here as NOT STARTED
      (correcting an earlier false "already fixed" claim, see history
      below); picked up same day, implemented, tested, build clean. Full
      detail, implementation notes, and the open refund-checkin question
      now live in the 🔴 Now item "Suppress Amazon deadline reminders."
      Original diagnosis preserved: `7_day`/`2_day` reminders sent to
      Amazon orders on the Jul 31 run, against the `AMAZON_HANDLING.md` v1
      awareness-only decision (see ✅ Done, "`AMAZON_HANDLING.md` v1
      (awareness-only) — APPROVED 2026-07-25"). **Correction this item's
      own first draft made:** initially logged as "being fixed by an
      Amazon-reminder-suppression pass, run 2026-08-04" — that claim
      didn't hold up against the repo at filing time (no Amazon logic in
      `lib/reminders.ts`, no commit, no HISTORY entry) and was corrected
      to NOT STARTED before this promotion. Related but distinct:
      `amazon-per-email-reminder-cadence` (🟡 Next) is about adding MORE
      per-email Amazon touchpoints, the opposite direction — flagged for
      owner reconciliation in the 🔴 Now item, not resolved here.
- [ ] **HTML-scanning fallback not triggering on null/low-confidence
      extractions — NEW 2026-08-25, surfaced during Session-2
      hand-verification of the deployed routing tree.** The recently-
      built HTML-scanning fallback path (which should kick in when
      primary extraction fails or returns low confidence) is not
      firing on two observed failure modes:

      **Mode A: total-null HTML extraction.** Example: Buff shipping
      confirmation (`Your Buff Stuff has shipped!`, 8/25/2026
      3:38 PM). Real HTML email with retailer, order data, and
      shipping info visible in the source. Primary extraction
      returned literal null across every field (emailType null,
      retailer null, orderNumber null, no extraction notes). HTML
      fallback should have fired based on "extraction returned
      nothing but source is rich HTML" — did not.

      **Mode B: body-empty-but-attachment-present.** Example: H&M
      receipt (`Your receipt is attached`, 7/22/2026 9:12 AM).
      Primary extraction correctly identified retailer (H&M) and
      classified as `emailType: other` / `confidence: low` because
      the email body is just "see attached receipt" — the actual
      order data (orderNumber 68468087873, visible in the attached
      PDF) is in the attachment. HTML fallback should have fired on
      "confidence low + null orderNumber despite retailer identified"
      — did not. Separate open question whether attachment-scanning
      is in scope for the HTML fallback at all; if not, this is
      two bugs (fallback trigger + attachment-scanning gap).

      **Why this matters:** both rows currently route to
      `no_extraction_signal` under the new Session-2 routing tree,
      which is structurally correct (the classifier honestly says
      "we don't know"). But upstream extraction should have known —
      the data was there, either in the HTML or in the attachment.
      Bucket is surfacing what extraction failed to catch.

      **Fix path (needs investigation before scoping):**
      1. Confirm the HTML fallback's current trigger conditions.
      2. Add trigger for "primary returned all null on rich HTML"
         (Mode A).
      3. Decide whether Mode B (body-empty + attachment) belongs
         in the HTML fallback or in a separate attachment-scanning
         path. If the latter, spin off a separate 🟡 Next entry.

      **Do NOT fix opportunistically** — needs scoped investigation
      with owner-decision on Mode B scope before build.
- [x] **CLOSED 2026-08-27 — see ✅ Done ("Timezone drift across
      calendar-date rendering") and `HISTORY.md` 2026-08-27. Original entry
      preserved below, not edited.**
- [ ] **`orderCardState.test.ts` timezone-dependent assertion +
      underlying delivery-date rendering bug — NEW 2026-08-25,
      surfaced during Session-2 build follow-up.** Test seeds
      `estimatedDeliveryDate: new Date("2026-08-15T00:00:00Z")`
      (midnight UTC) and asserts "Arrives Aug 15." The formatting
      code renders in local time; on Pacific (UTC-7) machines this
      crosses a day boundary and produces "Arrives Aug 14,"
      failing the assertion. Confirmed pre-existing to Session-2
      (isolated via `git stash`), not introduced by the routing-
      tree build.

      **Real bug, not just a flaky test:** the formatting code's
      timezone behavior is the underlying issue — a delivery-date
      rendering that shifts by a day depending on where the user
      (or the CI runner) is located is a user-facing correctness
      problem. A user in Tokyo would see a different delivery day
      than a user in California for the same underlying delivery.

      **Owner-decision needed before fix:** which reading is
      correct?
      (a) Render delivery date in the date's own timezone (or UTC)
          — "Arrives Aug 15" always means Aug 15 regardless of
          user location. Owner-leaning per 2026-08-25 discussion:
          retailer delivery dates are usually "the calendar day
          X," not "a specific instant that shifts by timezone."
      (b) Render in user's local timezone — "Arrives Aug 15"
          means Aug 15 for you where you are (produces the current
          bug shape).

      **Fix path once decision made:** if (a), find every
      `toLocaleDateString`-adjacent call in the delivery-date
      render path and add an explicit timezone. Test then passes
      everywhere. If (b), mock the timezone in the test to a
      stable UTC.

      **Do NOT fix opportunistically in an unrelated session** —
      needs the (a)/(b) decision explicit before any code change.
      Also do NOT ignore the failing test in CI in the meantime;
      if this is blocking a green build, log a separate 🟡 Next
      for a temporary skip/mock while the underlying fix is
      scoped.

- [x] **CLOSED 2026-08-27 — see ✅ Done ("Delivered badge stuck on
      'Arrives'") and `HISTORY.md` 2026-08-27 for the full arc. Original
      report preserved below, not edited, per this board's own
      Done-log convention.**
- [ ] **Zara #54421192781 — displayStatus stuck at "Arrives" past
      delivery date, delivery email received. NEW 2026-08-26,
      owner-reported via dashboard + detail-page screenshots
      (2026-08-26 session).** Card shows "Arrives Aug 23," detail page
      shows Delivery Date Aug 24, today is Aug 26; owner confirms a
      delivery email did arrive for this order. Two possible failure
      modes, diagnosis-first — do NOT assume: (a) delivery email arrived
      but did not advance `displayStatus` — extraction/merge bug in
      `mergeEmailIntoOrder` (`lib/extract.ts`); (b) `displayStatus` did
      advance to delivered but card badge logic still uses estimated
      arrival date — UI bug in `deriveDisplayStatus` /
      `lib/orderCardState.ts`. Additional flag worth checking in the
      same session: card badge Aug 23 vs. detail Aug 24, one-day drift
      on the same order — may share root cause, may not. Peer query:
      how many other Orders show the same signature? Read-only
      diagnostic first, then narrow fix if scope stays contained.
      **Trust-breaking severity** — a past-arrival delivered order
      still showing an anticipatory badge misrepresents state on the
      primary dashboard surface, and is the exact class of thing an
      alpha user notices.

### Annoying
- [ ] **Waitrose #1058208405 returnDeadline is 2021-08-21 — 5 years stale,
      likely another instance of the wrong-year extraction bug — NEW
      2026-08-27, surfaced during the orderDate-backfill review, not
      investigated further this session.** `returnWindowStartsFrom:
      "delivery_date"`, `returnWindowDays: 14`, `deadlineIsEstimated:
      false`, `policySource: "stated_in_email"` — the deadline was
      computed as confirmed (not estimated), so some linked email's own
      extracted `deliveredAt`/estimated-delivery field almost certainly
      has a `2021` year instead of `2026` (order and delivery both happen
      in 2026; "Aug 21, 2021" = "Aug 7" + 14 days, and this order's real
      delivery was "Friday, 7 August" [2026] per its own subject lines).
      Same bug class as the `ANCHOR_DATE_RESOLVER.md` Part 3 deferred
      "wrong year" sanity guard (also confirmed live this session on
      Fitness Superstore #48868's `orderDate`) — this is the same class
      landing on a different field. **Bucketed Annoying, not
      Trust-breaking, per the grocery-out-of-scope Watch entry** — low
      product stakes for a grocery order specifically, but the underlying
      extraction bug is real and not grocery-specific; worth fixing as
      part of whatever session finally builds the Part 3 guard, not
      grocery-specific tooling. Not fixed here — no code touched, per this
      session's lock to `orderDate` only.
- [ ] **[PROMOTED to 🔴 Now 2026-07-21] AquaTru "Shipped" badge forever** —
      pointer only, not edited/removed. Full detail, design decisions, and
      the build now live in the 🔴 Now item "AquaTru 'Shipped forever' — add
      a real delivered display state," which also absorbed point (4) of the
      Preorder/unconfirmed-delivery wrong-deadline investigation.
- [ ] **Mobile: order-number + item-summary line overflows on narrow widths** —
      e.g. Poshmark's row shows `#6a4d94…748a · M...`, the item name truncated
      to near-nothing after the (already-shortened) order number eats the
      line. Surfaced by 2026-07-13 trust audit (`TRUST_AUDIT.md` row 7), not
      in the six-item Phase 2 scope. Proposed fix: drop item summary from
      this line at narrow widths, or stack the two on separate lines below
      ~480px.
- [ ] **Non-Amazon orders still stuck with `orderDate: null`** — Bug 8's
      backfill was deliberately scoped to Amazon only. Found while running its
      dry-run: H&M #66993117803 and Tuckernuck #TNK6772725 (both delivery-only,
      no shipping_confirmation — same root cause as the "Post-beta:
      delivery-only orders" 👀 Watching item) and Lola Blankets #1158308
      (refund-only, already tracked under Bugs 9+10+11). Same
      `applyFallbackOrderDate` fallback would likely resolve these too, but
      wasn't run against them without a separate go-ahead.
- [ ] **Mobile audit finding #1b — caption visual re-do (follow-up to the
      #1 scoping fix, `131d800`).** [blocked: owner mock] The semantic fix is correct and
      owner-verified (caption now associates only with "Keeping it" —
      see Done), but the visual result is bad: on the dashboard card, the
      caption now wraps into a cramped two-line column squeezed beside the
      "..." menu (`app/OrderCard.tsx`). **Do NOT re-attempt from a written
      spec** — the pattern-match approach (copying the order detail page's
      `flex flex-col items-start gap-1` placement) has now failed twice in
      one day on this exact finding: it matched the *source* pattern
      correctly but didn't account for the dashboard card being
      meaningfully narrower than the detail page, so the same structure
      produces a different, worse visual result in the new context. Owner
      will provide a mockup before the next attempt. See Decisions log for
      the general lesson this surfaced (pattern-matching across differing
      contexts needs verification in the new context, not just fidelity to
      the source).
- [ ] **[blocked: on-device] Bell-icon nav misalignment** — pointer only;
      full diagnostic history stays in the mobile-ux-audit finding #1 item,
      now in 🐛 Bugs → Cosmetic (moved from ❄️ Deferred 2026-08-26, bundled
      with the mobile popover clip entry). That item is not moved or edited
      further by this pointer.
- [ ] **[Low] Same email extracted twice yields different order totals. NEW
      2026-07-28.** Zappos order `113-0629169-3085025`: the auto-forwarded
      delivery email read `$46.76` (Shipment Total = subtotal `$42.75` +
      tax `$4.01`, correct); a manually re-forwarded copy of the same email
      read `$42.75` (line-item sum, tax dropped), and the merged Order kept
      the lower value. Surfaced while testing dedup via re-forward. Not
      customer-impacting on its own, but flags two real gaps: (1)
      `orderTotal` derivation is inconsistent between an explicit "Shipment
      Total" path and a summed-from-line-items path, and (2) the merge rule
      picked the less-complete value over the more-complete one. Investigation
      only — confirm which merge rule in `lib/linkOrder.ts`/`lib/extract.ts`
      chose `$42.75` over `$46.76` before any change.
- [ ] **[Low] "View all" next to the closing-soon alerts badge doesn't
      visibly filter — NEW 2026-08-21, owner-reported, verified in both
      preview and production, pre-existing/unrelated to the same-day
      missing-select fix. Not fixed tonight — symptom only, root cause
      not confirmed.** Clicking the "View all" button next to the
      "Due in the next 7 days" summary navigates to
      `/?status=closing_soon` but the dashboard doesn't visibly apply a
      filter. **Component locations for whoever picks this up:** the
      button itself is `SummaryCard`'s `href` prop
      (`app/SummaryCard.tsx:39-44`, "View all" link), wired from
      `app/(app)/page.tsx:183` (`href="/?status=closing_soon"`). **Flag
      for whoever picks this up:** on inspection, `page.tsx:71` does read
      `params.status` and `page.tsx:140` does apply a `closing_soon`
      branch (`if (statusFilter === "closing_soon") return
      isClosingSoon(order, now);`) to the rendered order list — so
      "the parameter is never read" is NOT confirmed as the cause; this
      logic looked correct on a code read alone. Actual cause unconfirmed
      — candidates not yet checked: stale client-side navigation cache on
      a same-route search-param change, or something client-observable
      only (network tab / actual RSC payload), not a static-code-read bug.
      Low priority — button just doesn't do what the user expects, no
      wrong data shown.
      **STRUCK, 2026-08-24 (owner): the "visible set already equaled the
      closing-soon set" theory above is not viable and should have been
      ruled out at logging time, not carried as a hedge.** Owner's account
      is deliberately populated with orders across a range of states
      specifically so different use cases surface in testing — there is no
      plausible moment where every order is simultaneously closing soon.
      Do not re-raise this theory without new evidence.
      **SECOND OBSERVATION, 2026-08-24 ~15:00 PT (owner):** SKIMS and other
      orders appeared missing from the dashboard; resolved on search +
      refresh. Root cause of this specific observation not yet
      investigated — logged here as a data point, not diagnosed.
      **Code + deploy trace, 2026-08-24, read-only, 0 billed calls:**
      every commit touching `app/`/`lib/` between 2026-08-21 and
      2026-08-24 (including the 19 commits absorbed into `main` for the
      first time via the 2026-08-21 11:26 reconciliation merge, `23462d5`,
      authored 2026-08-10 through 2026-08-20) cross-referenced against
      `meta.githubCommitSha` on each production deployment (exact SHA
      match, not inferred from timing) — **zero commits in that window
      touch `searchParams`/`statusFilter`/`closing_soon`, and no deploy
      activated new filter behavior.** The filter branch itself
      (`page.tsx:148`, `if (statusFilter === "closing_soon") return
      isClosingSoon(order, now);`) is unchanged since `7fa8c80`
      (2026-07-20) — over a month before this entry was even filed. This
      is definitive on "nothing shipped to fix this" — it is NOT evidence
      for any specific root cause; it only eliminates "a code fix
      happened."
      **Root cause remains OPEN — not closed, not misdiagnosed.**
      Remaining candidates: stale client-side navigation cache on a
      same-route search-param change; a Next.js hydration or router-state
      issue; some URL state at the moment of observation that wasn't
      captured. The browser-cache theory is a candidate, not established
      — it's what's left once the code-bug theory is eliminated, which is
      not the same as evidence for it.
      **Key missing data point, for whoever reproduces this next: capture
      the address bar URL immediately** at the moment the filter appears
      not to apply (or orders appear missing) — neither observation to
      date captured this.
- [ ] **[Medium] `/alerts` nav link greyed out and unclickable — NEW
      2026-08-21, owner-reported during click-through, verified in both
      preview and production, pre-existing/unrelated to the same-day
      missing-select fix. Not fixed tonight. Higher priority than the
      "View all" bug above — this blocks reaching a whole page of the
      app via navigation, not just one filtered view.** **Root cause
      confirmed on desktop, unlike the bug above:** `app/Sidebar.tsx:57-
      64` renders the "Alerts" nav item as a plain `<span
      className="... text-muted ... cursor-default ...">`, NOT a
      `<Link href="/alerts">` — every other Sidebar item (`Dashboard`,
      `Archived`, `Settings`, `Privacy`) is a real `<Link>`. It still
      renders the live `alertCount` badge next to it
      (`Sidebar.tsx:59-63`), which is what makes it read as a real,
      broken nav item rather than a deliberate placeholder — contrast
      with `ComingSoonItem` (`Sidebar.tsx:7-16`), the actual
      not-yet-built pattern, which is also a non-link `<span>` but
      carries an explicit "Soon" pill so it doesn't look broken.
      **Mobile looks unaffected on inspection:** `app/BottomNav.tsx:50-
      59`'s "Alerts" tab IS a real `<Link href="/alerts">` — not
      independently verified live, flagging only that the code doesn't
      show the same defect there. Whoever picks this up: confirm mobile
      before assuming this is desktop-only. `/alerts` itself
      (`app/(app)/alerts/page.tsx`) was not touched by tonight's fix and
      renders fine when reached directly by URL — this is a nav-wiring
      gap, not a page bug.
- [ ] **[Low] No visible indicator when a `?status=` filter is applied to
      the dashboard — NEW 2026-08-24, found while investigating the
      closing-soon "View all" entry above. Independent finding: real
      regardless of what's causing that entry's observations.** Landing
      on `/?status=closing_soon` (or any other `status` value reachable
      via deep link — `archived`, `needs_review`, etc.) correctly filters
      the order list server-side (`page.tsx:144-150`), but nothing in the
      rendered page communicates that a filter is active — no chip, no
      heading change, no highlighted/active button state. Confirmed by
      checking every render site of `statusFilter` in `page.tsx` (two:
      the filter predicate itself, and an unrelated visibility gate for
      the Amazon bundle card — neither renders text) and confirming
      `SearchFilterBar` (`app/SearchFilterBar.tsx`) doesn't receive or
      render `status` at all. This is a deliberate product decision, not
      an oversight — `SearchFilterBar.tsx:9-12`'s own comment cites
      `return-window-design-tokens.md §6` Commit 2: "No tabs... sort-by-
      urgency as default is sufficient at alpha volume," meaning status
      tabs/dropdown were intentionally dropped from the UI, with `?status=`
      kept only as an internal deep-link mechanism (View all / Archived
      links), not a user-facing filter state. Whoever picks this up:
      confirm with owner whether that alpha-era product call still holds
      before adding any indicator — this may be working as designed.
- [x] **CLOSED 2026-08-27 — see ✅ Done ("Timezone drift across
      calendar-date rendering") and `HISTORY.md` 2026-08-27. Original entry
      preserved below, not edited.**
- [ ] **[Low] Timezone off-by-one in `orderCardChip`'s Arrives-date label —
      NEW 2026-08-21, found while verifying the main/origin-main
      reconciliation merge. Pre-existing on local `main`'s own prior
      unpushed card-geometry commits, becomes visible in production for
      the first time via tonight's push. Not fixed tonight, per owner
      decision — logged instead, same treatment as the two nav bugs
      above.** `lib/orderCardState.ts:93`'s `awaiting_delivery` chip
      formats `estimatedDeliveryDate` via
      `toLocaleDateString(undefined, ...)`, which renders in the
      server's local timezone — a UTC-midnight date rolls back a day in
      any negative UTC-offset zone. Confirmed via
      `__tests__/orderCardState.test.ts`: `new Date("2026-08-15T00:00:00Z")`
      renders as "Arrives Aug 14", not "Arrives Aug 15" (1 test failing,
      known, not a regression from this merge — file byte-identical to
      its pre-merge state on local `main`). **Fix (not applied):**
      format using the date's UTC components instead of local timezone.
      Low priority — display-only, users see the date off by one day at
      most, not blocking.

### Cosmetic
- **RESOLVED 2026-07-20 (see 🔴 Now):** ~~Sidebar account email truncates
  with no `title` fallback~~ — e.g. `mckenna.sweazey@g…`, no way to see the
  full address without editing the DOM. Surfaced by trust audit
  (`TRUST_AUDIT.md` row 8). Fixed: `title` attribute added, same pattern as
  the order-number display fix. Awaiting owner verification in production.
- [ ] **Order detail page: long order number wraps awkwardly on mobile** —
      24-char Poshmark-style numbers wrap across 3 lines with the Copy
      button sitting mid-wrap rather than below the value. Cosmetic only,
      not broken. Surfaced by trust audit (`TRUST_AUDIT.md` row 14).
      Proposed fix: stack Copy button below the value at narrow widths.
- [ ] **[cosmetic] Dead `"delivered"` status value** [internal, not
      user-visible] — clear when
      convenient. (Listed in the `status` schema comment, `OrderStatus`
      type, and `OPEN_STATUSES`, but `computeOrderStatus()` never actually
      writes it — always `"returnable"` instead. Harmless, just
      inaccurate.)
- [ ] **Needs-review bucket desktop styling — NEW 2026-08-21, owner-reported
      during Build B's rebuild preview. Not fixed tonight, not blocking
      ship.** Rows work functionally per `CARD_SPEC.md` Part 3 (correct
      data, correct always-visible actions per Q10) but the layout reads
      sparse on desktop: excessive horizontal gap between the left column
      (retailer / date·amount) and the right column (why-sentence /
      actions), and inconsistent vertical density between rows. Likely
      culprit, not confirmed — `app/NeedsReviewRow.tsx`'s row `<Link>` uses
      `flex-1` on **both** columns (`min-w-0 flex-1` left, `min-w-0 flex-1
      text-right` right), forcing an even 50/50 split regardless of how
      short the left column's content actually is (e.g. "Zara · 8/21
      $697.10"), which reads as excess whitespace at typical desktop
      widths; the vertical-density complaint may trace to `dateAmount`
      being conditionally rendered (`{dateAmount && <p>...}</p>}`) — a row
      missing date/amount has less content height than one that has it, so
      rows sit at different heights next to each other. **Mobile rendering
      not independently verified — verify before scoping a fix**, per
      owner instruction; don't assume the desktop diagnosis carries over.

- [ ] **Mobile popover clip — Archive-or-Delete prompt overflows left
      edge on mobile. NEW 2026-08-26, owner-reported via screenshot;
      live in production.** On the expanded order card, tapping `Archive`
      opens the archive-or-delete prompt (`ArchiveOrDeletePrompt.tsx`
      per CARD_SPEC Part 5 Q7); on mobile the popover anchors correctly
      to the button but its content extends off the left of the
      viewport, cutting the copy ("… keeps this order. Delete … as not
      a purchase"). **Same era + same class as item 1606 (bell-icon
      alignment)** — both from the pre-315 UI pass that was paused for
      other work; both remote-reasoning-resistant positioning bugs (bell
      went 0-for-4 on remote attempts). **Bundle with item 1606 into a
      single on-device Safari Web Inspector session** — owner picking
      this era back up now. Possible shared root cause worth checking
      in that session (both may inherit from a common CSS/component
      pattern); don't assume, but don't investigate them in isolation
      either.
- [ ] **Mobile audit finding #1 — Bell icon alignment on bottom nav.
      DEFERRED 2026-07-25 (owner instruction) — moved out of active
      🔴 Now/🙋 Waiting on Owner. STOP attempting further
      remote-reasoning fixes: this is 0-for-4 (leading-none;
      considered-and-rejected wrapper removal; min-h-dvh + vh fallback;
      the 2026-07-17 checkpoint that confirmed it still isn't fixed).
      Revisit only with an on-device Safari Web Inspector session
      (remote-debug a real iPhone from a Mac), OR absorb into the
      card-geometry rebuild (🙋 Waiting on Owner) if the bottom-nav
      badge pattern gets touched incidentally by that work. Full
      diagnostic history below, preserved verbatim, not re-summarized.**
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
      passing (no test coverage — CSS/layout).
      **REMAINS OPEN 2026-07-17 — stop attempting further remote-reasoning
      fixes.** Owner's on-device scroll test still shows misalignment. This
      is the fourth diagnostic/fix round on this one finding (`leading-none`;
      considered and rejected wrapper removal; `min-h-dvh` + vh fallback;
      this checkpoint) with no confirmed fix landed — 0-for-4. Working
      hypothesis, unconfirmed: Bell's wrapper span establishes an extra
      formatting context Home/Gear don't have, making it sensitive to
      viewport-reflow timing during iOS Chrome's URL-bar animation in a way
      the `min-h-dvh` swap didn't fully address. Per this session's own
      lesson (see Decisions log): when a class of bug goes 0-for-N on
      remote reasoning, stop patching and start measuring. Needs an
      on-device Safari Web Inspector (remote-debug a real iPhone from a
      Mac) session to actually observe the computed box/line-height values
      during the toolbar animation before another fix attempt — owner needs
      a Mac + iPhone cable for this, not more diagnosis-by-code-reading.
      **[2026-08-26]** Deferral condition met — owner picking the pre-315 UI
      work back up. Bundle with the new "Mobile popover clip" 🐛 Bugs entry
      (same era, same class); one on-device session, both bugs. Moving from
      ❄️ Deferred to 🐛 Bugs.

### Infra / reliability
- [ ] **`Order.trackingNumber`/`returnTrackingNumber` are first-write-wins,
      silently dropping later packages on multi-box orders — NEW
      2026-08-28, found during carrier-row-disposition scoping (Phase 2
      investigation, not that session's actual task).** `applyShippingTracking`/
      `applyReturnTracking` (`lib/linkOrder.ts:393-445`) each check `if
      (existing?.trackingNumber) return;` before writing — the first
      `shipping_confirmation`/`return_label` email to populate tracking
      wins permanently; a second box's shipping email for the same order
      (e.g. a multi-carton furniture order) is parsed but its tracking
      info is discarded, not merged or appended. Single field, not a
      list — no schema support for multiple tracking numbers per order
      today. Not carrier-row-specific — affects any order with more than
      one shipment, independent of that session's topic. Not investigated
      further (no repro against real data yet, found by reading code), no
      fix proposed. **This finding also reinforces the decision to leave
      carrier-email tracking-number extraction unbuilt** — see
      `DECISIONS.md` 2026-08-28 "Carrier-email tracking-number extraction:
      deferred despite a working parser": even if extraction were wired
      up for carrier emails, the multi-package field shape would need
      fixing first for the result to be trustworthy on any order with more
      than one shipment.
- [ ] **Extraction-failure email rows get a false-confidence "real purchase"
      reason in the needs-review bucket — NEW 2026-08-24, found during the
      routing-tree design pass (`NEEDS_REVIEW_ROUTING_DESIGN.md` §1, §3),
      not fixed here.** `lib/needsReviewRows.ts:67-74`'s
      `detectEmailReviewReason` has exactly one non-match fallback,
      `real_purchase_no_record` — "This looks like a real purchase with no
      order record" — and it fires for **every** orphaned email that isn't
      an exact `orderNumber` match, including rows with zero extracted
      signal at all (no retailer, no orderNumber, sometimes no emailType).
      Cross-references the 2026-08-21 rebuild's ✅ Done entry (above): the
      spec names "extraction failures" as one of four populations feeding
      the bucket (`CARD_SPEC.md:248-251`) but no email-kind reason branch
      represents it — this population is silently absorbed into a reason
      sentence that asserts confidence it doesn't have. **Concrete
      evidence, 2026-08-24 snapshot:** 8 of 18 currently-orphaned email
      rows get this false-confidence reason and route to "Start a new
      order" when they should degrade to "More info" per spec's own
      unmapped-reason rule (`CARD_SPEC.md:244-247`) — 3 of the 8
      (`extractedAt IS NULL`) are the Whole Foods triplet already
      explained by the 7/21/2026 ingestion incident above (this entry
      doesn't re-explain *why* those 3 never extracted, only that the UI
      currently lies about what it knows regardless of why); the other 5
      have `extractedAt` populated and `emailType` resolved but zero
      retailer/orderNumber signal, consistent with generic carrier-ping
      residue (see bucket-residue-cleanup, 🟡 Next). Fix design (four-branch
      routing tree, new `no_extraction_signal` reasonId) is scoped, not
      built, in "Routing tree design for needs-review bucket action
      selection" (🔴 Now — build session ready to start) — this bug entry
      exists so the false-confidence
      copy shown to the user is tracked as a real defect, not folded silently
      into the design task's optional scope. [Shipped as the four-branch
      tree, 2026-08-25; the carrier-residue population this entry flagged
      is what later became carrier_tracking_unlinked (2026-08-28), then
      shipment_unlinked (2026-08-30) — see the shipment_unlinked ticket in
      🔴 Now.]
- [ ] **Carrier-tracking emails (FedEx/USPS/UPS/etc.) route as null-retailer
      orphans in the needs-review bucket — NEW 2026-08-25, surfaced during
      Zara fallback diagnostic (`ZARA_DIAGNOSTIC_FINDINGS_BACKFILL_RADIUS_
      20260825.md`, commit `3bef1bc`). Not investigated further, logged
      only.** Of the 8 commerce-typed null-retailer Email rows the
      diagnostic enumerated, 5 are carrier tracking notifications —
      `fromName` values like "FedEx Delivery Manager" and "USPS Tracking,"
      `extractionNotes` explicitly say no retailer is identifiable from
      body content. They currently route through the needs-review bucket
      with `retailer: null` (correct — they don't have a retailer) and no
      `orderNumber` (usually — carrier tracking numbers aren't order
      numbers), which sends them through the degrade fallback branch in
      `lib/needsReviewRows.ts`. **As of the 2026-08-25 Zara ship (commit
      `e754318`), these rows are now tagged `retailerSource =
      'carrier_deferred'` and are retrievable as a set via that column.**
      **Real product question underneath, not just a routing bug:** carrier
      emails are almost always linkable to a real order — the user knows
      what they ordered, and the tracking number can often be manually
      associated — but automatic linking has no signal to work with (no
      order number, no retailer, sometimes useful body info like a delivery
      date but just as often not). Today they sit as orphans indefinitely.
      Deliberately excluded from the Zara fallback fix (which gates on
      commerce-type retailer emails specifically via a carrier-sender
      exclusion list; carrier tracking is a distinct routing case). Options
      space (not evaluated): a manual-link affordance in the needs-review
      UI; a heuristic that matches tracking numbers against recent orders'
      shipping-confirmation content; a carrier-specific routing branch that
      surfaces these differently from real retailer orphans; digest-
      suppression only, no routing change; do nothing (accept them as
      orphans). Not scoped, no fix direction yet — logged so the pattern
      doesn't get forgotten between now and whenever it becomes visible
      enough to prioritize. See related 🟡 Next entry "Carrier-row
      disposition."
      **[2026-08-26 OWNER DECISION — direction chosen]** Surface these on
      the dashboard as "Unlinked carrier email" rows with a dropdown to
      manually link to an existing order; on link, persist the tracking
      number on the linked order. Rejected options: digest-suppression
      only (doesn't help user), paid multi-carrier tracking API (parked
      per item 3159), automatic linking heuristics (deferred — needs the
      manual UI first to see what signal patterns emerge).
      Scope for build session: dashboard row UI + link-picker component +
      write path to persist `trackingNumber` on the linked order.
      Not scoped, flag if it comes up: what happens if the same tracking
      number appears on multiple carrier emails (dedup question) — don't
      invent an answer, surface to owner.
- [ ] **Fitness Superstore #48868 — establishing email extracted orderDate
      2025-07-09, a year before stored 2026-07-09; found 2026-08-16 sizing
      the write-once `orderDate` backfill.** Wrong-year-extraction shape.
      Archived, deadline past, not user-visible. Deferred: real-old-order
      vs. mis-extraction, read-only.
      **Re-observed 2026-08-27, second confirmed instance, not a
      duplicate entry — logging under this one per the existing bug.**
      During the orderDate write-once backfill (`c8fec62`), this same
      order surfaced again with a fuller picture: 6 of its 7 linked
      emails are auto-generated marketing/survey follow-ups ("Congrats on
      your order!", a "Room of Choice Survey" request, "What's Next for
      Your Order?") all misclassified as `emailType: "order_confirmation"`
      — only one is a real confirmation. The wrong-year extraction
      (2025-07-09) landed specifically on the survey-request email; the
      genuine confirmation, received a day later, extracted the correct
      2026-07-09. This is the same `ANCHOR_DATE_RESOLVER.md` Part 3
      deferred "wrong year" sanity-guard shape as before, now with a
      second contributing factor (emailType misclassification feeding
      multiple, disagreeing "order_confirmation"-typed candidates into
      the same order) layered on top. The orderDate backfill's
      disagreement check (added in `c8fec62` specifically because of this
      order) correctly excluded it from auto-correction rather than
      picking either value — order's `orderDate` is unchanged, still
      2026-07-09 (already correct), `orderDateSource` now `"fallback"`.
- [ ] **`forwardType` classifier undercount — NEW 2026-08-20, found while
      investigating food-grocery-exclusion's manual-forward exposure
      (see 👀 Watching entry). Small, no urgency, not fixed.** 58 Emails
      have a decrypted `fromEmail` that exactly equals the owning
      `User.email` (the direct signal for "this was a manual forward") —
      but only 16 of those 58 are classified `forwardType === "manual"`
      by the existing header heuristic (`classifyForwardType`,
      `lib/forwardResolver.ts`). Discrepancy: 42. Not investigated
      further — root cause unknown (could be header-signature gaps in
      the `+caf_=`/`X-Forwarded-For`/`-To` heuristic, or rows predating
      `forwardType` tracking entirely that happen to also be
      self-addressed). Doesn't affect food-grocery-exclusion (that
      feature doesn't read `forwardType`) — affects any current or
      future downstream consumer of the field (currently just the
      anchor-date resolver's `auto`/`manual` branch and the
      `forwardTypeLabel()` UI string).
- [ ] **`lookupReturnPolicy` needs a bounded timeout — latent bug, NEW
      2026-08-05, from the Aug-4 backfill.** During that backfill, the
      lookup for retailer "Suzie Kondi" hung near the Anthropic SDK's
      default timeout — long enough for Neon to auto-suspend and wedge the
      process's other DB connections, taking the whole run down twice,
      billing 2 wasted extraction calls, and leaving one row unrepaired
      (`cmsdunton0001gt04vm8msv9m` — see the 🔴 Now Aug-outage backfill
      entry for the full trace). With no per-call timeout on the lookup,
      any slow/hanging web-search call can stall the whole pipeline, not
      just a backfill script — the same call site fires from live inbound
      traffic (`extractEmail()`). **Fix:** a bounded timeout on
      `lookupReturnPolicy` (`lib/extract.ts`) that fails the row to
      `needsReview` instead of hanging. Real production code change — its
      own small pass, not built here. Slug: `lookup-return-policy-timeout`.
- [ ] **Follow-up (low priority): `weekly-coverage` cron fetches full
      `Email` rows with no select — split out of the missing-select
      bandwidth bug 2026-08-20, deliberately NOT built in that pass.**
      `app/api/cron/weekly-coverage/route.ts`'s `email.findMany` (all
      users' recent-window emails, once/week) selects the nested `order`
      relation but not the outer `Email` fields — full `textBody`/
      `htmlBody`/`rawJson` per row. Weekly frequency, not page-load
      frequency, so lower priority than the 2026-08-20 fix. Same
      remediation shape: trace what the digest content actually reads
      off each email and add a matching `select`.
- [ ] **Follow-up (low priority): order-detail page fetches full linked
      `Email` rows with no select — split out of the missing-select
      bandwidth bug 2026-08-20, deliberately NOT built in that pass.**
      `app/(app)/orders/[id]/page.tsx`'s `order.findUnique({ include: {
      emails: {...} } })` has no `select` on the nested `emails` —
      fetches every column, including `textBody`/`htmlBody`/`rawJson`,
      for every email linked to the order being viewed. Per-order-detail-
      view frequency only (one order at a time), not a hot path.
- [ ] **Follow-up (low priority): admin split-order review action fetches
      full linked `Email` rows with no select — split out of the
      missing-select bandwidth bug 2026-08-20, deliberately NOT built in
      that pass.** `lib/orderReview.ts`'s `order.findUnique({ include: {
      emails: true } })` (the split-order admin action) has the same
      unselected-include pattern. Admin-only, rare action — lowest
      priority of the three deferred locations.
- [ ] **Zara retailer identification failure despite visible signal — NEW
      2026-08-21. Diagnosed read-only, root cause confirmed empirically
      against the real email row, not fixed.** `shipping_confirmation` from
      Zara (order 54421192781, $697.10, 11 line items, delivery date — all
      extracted correctly) has `retailer: null`, `emailType` correctly
      `shipping_confirmation`, `extractionNotes`: "Retailer cannot be
      identified from the email body — no brand name, logo text, or sender
      name is present..." Renders in the needs-review bucket as "Unknown
      retailer 8/21 $697.10" — real purchase, real order number, wrong
      reason surfaced (the row's why-text implies no data at all, when
      almost everything WAS extracted correctly except this one field).
      **Root cause, confirmed against the actual row (not just the
      pipeline code):** `buildPrompt()` (`lib/extract.ts`) sends the model
      `subject` + `textBody` only — by explicit design, never the `From`
      header ("`retailer` must NEVER be read from the subject or From
      header — body only"). This email's stored `textBody` is empty (an
      HTML-only send); `resolveBodyText()` (`lib/emailBodyText.ts`) falls
      back to `htmlBody` converted via `html-to-text`, which is configured
      `{ selector: "img", format: "skip" }` (drops every `<img>` entirely,
      no alt-text extraction) and `{ selector: "a", options: { ignoreHref:
      true } }` (drops every link's href, keeps only visible anchor text).
      Checked the raw `htmlBody` directly: it contains "ZARA" 53 times, but
      **every single occurrence** is inside one of the three dropped
      categories — the logo (`<img src=".../logo_Zara_2019.png">`, no alt
      text present even if it weren't skipped), the "Manage your order"
      link's `href="https://www.zara.com/...")` (visible anchor text is
      just "Manage your order," brand-free — the URL containing "zara.com"
      is exactly what `ignoreHref` throws away), and `@font-face` CSS
      resource URLs (never body content to begin with). Zero literal
      occurrences of "ZARA" survive as genuine visible running text
      anywhere in the email. Confirmed `fromEmail: noreply@zara.com` /
      `fromName: "Zara"` are both present and would trivially resolve this
      — but that signal is deliberately excluded from retailer
      identification by design, not an oversight this diagnostic surfaced.
      **Direct answer to "does the extractor consult logo alt-text, image
      OCR, or sender domain as retailer signals": no to all three.** Body
      text only (subject + resolved textBody/htmlBody-to-text), and the
      html-to-text conversion step actively discards image content (no alt
      extraction, let alone OCR) and link hrefs before the model ever sees
      the email. **Different failure mode from the H&M case** (that one
      was attachment-only content, i.e. data genuinely absent from any
      email field DB-side; this one has the answer sitting in `htmlBody`
      the whole time, just filtered out by the text-conversion step before
      extraction runs). Not fixed tonight — diagnosis only, per instruction.
      **PROMOTED to 🔴 Now 2026-08-22 — owner directive: zero tolerance for
      "unknown retailer" digest lines going forward.** Confirmed still live
      via real-window replay this session (`scripts/pm-diag-0821-digest-triage.ts`,
      read-only, 0 billed calls, mckenna.sweazey@gmail.com): the real
      2026-08-21 Friday digest send window contains a second Zara row on the
      same order number (`54421192781`, a `shipping_confirmation` "Your
      order has left the warehouse," `retailer: null`, `orderId: null`) —
      this one's `extractionNotes` show NO price/line-item data extracted at
      all (unlike the $697.10/11-item row above, which extracted everything
      else correctly) — same root cause reproducing on a second, thinner
      email from the same order. Confirms the gap isn't a one-off. Given the
      owner's "can't have any" bar, the fastest real fix is the sender-domain/
      `fromName` fallback candidate below (`noreply@zara.com` / "Zara" are
      reliably present on both rows) — used only as a last-resort DISPLAY
      fallback when body-based `retailer` extraction returns null, not as an
      authoritative data source, so it doesn't reopen the "never trust
      From for retailer" rule for data that already resolved from the body.
      Not built yet — needs the same reasoning pass the original note below
      already flagged before touching `lib/extract.ts`.
      Candidate future fixes, none built: stop skipping `<img alt="...">`
      text specifically (cheap, no model-cost change, would need a real
      corpus check for false-positive risk — alt text isn't always a brand
      name); a From-header retailer fallback specifically for the
      needsReview-with-null-retailer case (reopens the "never trust From"
      design decision, would need its own reasoning); real image OCR
      (meaningfully bigger scope, billed-cost implications). None
      evaluated in depth here — diagnostic only.
- [x] **`return_label` extraction shouldn't trigger `lookupReturnPolicy`
      when linking to an order that already has a resolved return policy
      — PROMOTED to 🔴 Now 2026-08-24, scope widened there to any email
      type, SHIPPED & OWNER-VERIFIED 2026-08-24 → moved to ✅ Done. Full
      paper trail (verify gate, cost sizing, edge-case reasoning, A/B/C
      investigation, diff) → HISTORY.md 2026-08-24, not duplicated here.**

## 🟡 Next
- [ ] **Confirm page: "Remind me tomorrow" action — NEW 2026-09-01,
      flagged during the Start-return CTA build [needs clarification].**
      The Start-return confirm page (`app/action/start-return/page.tsx`
      — not yet built as of this flag; depends on the in-progress
      Start-return CTA session resolving its auth-flow question first)
      currently offers Continue / Not now. Add a third path: a snooze
      that schedules an ad-hoc reminder for +1 day (or +N days) outside
      the normal reminder cadence.
      **Open questions before spec:** does snooze override the next
      scheduled reminder or add to it; snooze cap (unlimited? 3x?); UI
      to view/cancel a pending snooze; whether this only appears on the
      Start-return page or also on the Mark-as-returned and Archive
      confirm pages (probably only Start-return, since the other two
      are terminal actions).
      Real evidence: owner flagged during 2026-09-01 build.

- [ ] **Investigate: needs-review row expander behavior — there is no
      expanded version, only the full detail page, NEW 2026-08-29 from
      the Phase 6 scoping session close-out.** Suspected not working;
      unverified. Quick check.

- [ ] **Single write path for deliveredAt + returnDeadline — NEW
      2026-08-28, from the OFD misclassification diagnostic session.**
      `Order.deliveredAt` is written from multiple call sites (notably
      `resolveDeliveredAtBackfill` in `lib/linkOrder.ts:328-342`) without
      recomputing `returnDeadline`, which is only computed inside
      `mergeEmailIntoOrder`/`createOrderFromEmail` (`lib/linkOrder.ts:735,
      761`). Stored `returnDeadline` can be stale relative to
      `deliveredAt`. Consolidate writes behind one function that always
      recomputes. Prerequisite for OFD work — doing OFD on top of split
      write paths compounds the drift.

- [ ] **Decide deliveryStatus schema shape — NEW 2026-08-28, from the
      same diagnostic session.** Classifier lumps out-for-delivery and
      delivered into `emailType='delivery'` (`lib/extract.ts:140-146`).
      Prompt could plausibly distinguish them, but there's no output
      slot. Two paths: add `"out_for_delivery"` as a new `emailType`
      value (simpler, keeps the same overloading that caused the current
      bug), or add a separate `deliveryStatus` sub-field (cleaner
      separation, more surface). Design decision, no code. Blocks OFD as
      first-class status (below).

- [ ] **OFD as first-class status — NEW 2026-08-28, from the same
      diagnostic session. Depends on the two entries above (write-path
      consolidation, deliveryStatus schema decision).** Implement
      out-for-delivery as a tracked status per that decision: prompt
      update in `lib/extract.ts`, `routeDeliveryDate` skips OFD for
      `deliveredAt` writes, `deriveDisplayStatus` gets a new OFD value,
      UI shows OFD distinct from delivered. Requires reclassifying ~99
      existing delivery-typed emails (paid — flag cost before running).
      Product bet: accurate status + "arriving today" engagement
      surface. Amazon out of scope.

- [ ] **Split-shipment modeling — NEW 2026-08-28, from the same
      diagnostic session. Owner-flagged KEY use case.** Single order
      arriving in multiple packages doesn't fit the one-`deliveredAt`-
      per-order schema (see Old Navy #1R1KXD3). Product decision needed
      first: which delivery date drives the return deadline, and do we
      support partial returns. Then schema, then code.

- [ ] **Retire legacy Email.deliveryDate field — NEW 2026-08-28, from
      the same diagnostic session.** `Email.deliveryDate` is marked
      legacy in `prisma/schema.prisma:133`, superseded by
      `estimatedDeliveryDate` + `deliveredAt`. Historical rows have real
      dates in the legacy field that never migrated to the new columns —
      `Order.deliveredAt` reads null on orders with confirmed delivery
      data on file (Old Navy, Tuckernuck, Freda Salvador from the
      2026-08-28 diagnostic). One-time backfill, then remove the field
      and its read paths. No API cost. Last because it wants a stable
      schema underneath.

- [ ] **Migrate existing root-level design docs into `docs/design/` —
      NEW 2026-08-28, from the carrier-row-disposition scoping session.**
      That session introduced `docs/design/` as the first use of a
      `docs/` directory in this repo, starting with
      `carrier_row_disposition_20260828.md` — every prior design doc
      (`NEEDS_REVIEW_ROUTING_DESIGN.md`, `ZARA_DIAGNOSTIC_FINDINGS_
      20260825.md`, `ZARA_DIAGNOSTIC_FINDINGS_BACKFILL_RADIUS_20260825.md`,
      `DELIVERED_BADGE_DESIGN_20260827.md`, `CARD_SPEC.md`, and others)
      still lives at repo root in `UPPER_SNAKE_CASE`. Owner wants these
      migrated to the new location/convention "soon" — not done here,
      this entry exists so the two conventions don't sit split
      indefinitely. Scope when picked up: confirm naming convention
      (lowercase-with-underscores, matching the new file, vs. keeping
      each doc's existing name) and whether `CARD_SPEC.md` — actively
      linked from code comments across `lib/needsReviewRows.ts`,
      `lib/needsReviewActions.ts`, etc. — moves too or is treated as a
      different (spec, not design-doc) category.

- [ ] **Set up a Postmark sandbox/test server for local email testing —
      NEW 2026-08-27, from the sender-display-name fix session. Not this
      session — a real small project of its own.** This app has one
      Postmark server/token for the whole app (same "one database, not
      separate dev/prod" pattern as the DB) — there's no dev-safe way to
      test a real send today. Local `.env`'s `POSTMARK_SERVER_TOKEN` is
      stale (401 on send), and the production token is marked Sensitive
      in Vercel (same protection as `AUTH_SECRET`), so it can't be pulled
      down to fix that locally. **Deliberately not restoring the real
      token to local `.env` instead** — with one shared token, doing so
      would let any local test script (including the one nearly run this
      session) silently email real users, trading away the exact safety
      net that just barely helped tonight for casual convenience. The
      actual fix: create a genuine Postmark sandbox/test-mode server +
      token (Postmark supports this — simulates delivery, never reaches
      a real inbox) and wire it into local `.env`, so local scripts can
      safely exercise the full send path without ever risking a real
      user's inbox. Until this exists, the standing practice is what
      happened tonight: verify email-adjacent changes by observing real
      production traffic once it naturally occurs, not by local test
      sends.
- [ ] **Carrier-row disposition (FedEx/USPS/UPS/etc.) — design pass, not
      build — NEW 2026-08-25, unblocked by the Zara fallback ship (same
      session, commit e754318).** The Zara fix labels carrier-tracking
      Email rows with `retailerSource = 'carrier_deferred'` at extraction
      time (starting carrier-sender list: fedex.com, usps.com, ups.com,
      dhl.com, ontrac.com, lasership.com). Historical backfill in the
      companion script tagged the 5 currently-in-DB carrier rows in the
      same session, so the queryable set is immediately populated, not
      empty-until-re-extraction. That gives us a queryable set (`WHERE
      retailerSource = 'carrier_deferred'`) but no user-visible change —
      carrier rows still render "Unknown retailer" and still route through
      the needs-review bucket's degrade branch. Full context on why this
      is a real product question (not just a routing bug) → 🐛 Bugs →
      Infra / reliability, "Carrier-tracking emails route as null-retailer
      orphans in the needs-review bucket" (filed 2026-08-25). **Scope for
      the design pass:** how carrier rows should behave in the needs-review
      bucket, the Friday coverage-check digest, and the dashboard — three
      surfaces, may want different treatment on each. Options space (not
      evaluated, listed to constrain scope): (a) manual-link affordance in
      needs-review UI; (b) heuristic auto-link via tracking-number match
      against recent orders' shipping-confirmation content; (c) carrier-
      specific routing branch that surfaces carriers distinctly from real
      retailer orphans; (d) digest-suppression only, no routing change
      (fastest, most conservative); (e) accept as orphans, no fix. Owner's
      stated goal context (2026-08-25): Friday digest with zero "Unknown
      retailer" lines — option (d) alone meets that bar this week if
      promoted; other options are more work but also solve the underlying
      "carrier emails should be linkable" product question. **Pre-code
      inputs already in place:** carrier row set is queryable via
      `retailerSource = 'carrier_deferred'`; count today is 5 (from
      Zara-fix Step 1b enumeration + backfill); no Order links exist on any
      of them (all orderId: null). **NOT IN SCOPE for this entry:** any
      change to the Zara fallback itself (shipped, separate); any change to
      the "never trust From for authoritative body extraction" rule
      (unchanged); OCR or img-alt-text extraction (separate deferred
      candidates in the Zara Bugs entry). **Dependency: none blocking** —
      Zara ship unblocks this by providing the tagged set.
      **2026-08-26 session update:** Digest-suppression fix (option d,
      "crawl" step) scoped and diagnosed per plan, held without ship. Step 1
      diagnostic (`scripts/pm-diag-carrier-digest-suppression-20260826.ts`)
      revealed the 5 currently-tagged carrier_deferred rows (receivedAt
      2026-07-23 → 2026-08-04) are already outside the digest's rolling
      7-day window and will not appear in the 2026-08-28 Friday send. Fix
      still correct for future carrier emails landing in-window, but zero
      observable effect on current cycle; deferred pending a broader
      in-app disposition decision. New Next: in-app rendering fix (return
      window ± other render sites reading email.retailer) needs its own
      scoping session. Walk/run still open. Suppression can be dropped in
      as ~1-line filter if a carrier email lands in-window before in-app
      fix ships.
- [ ] **Needs-review bucket: order-kind rows have no Archive control — NEW
      2026-08-25, surfaced during Session-2 build follow-up questions
      (owner B1).** `app/NeedsReviewRow.tsx:85` gates the amendment-D
      Archive control to `row.kind === "email"` — order-kind rows render
      View detail alone, unchanged from pre-amendment-D. Session-2's build
      comment (`app/NeedsReviewRow.tsx:29-38`) reasoned this was because
      "order-kind rows have no archive mechanism to wire to" — **checked
      2026-08-25, that reasoning was wrong.** `PATCH /api/orders/[id]/archive`
      already exists and is already wired to two client components
      (`app/ArchiveOrderButton.tsx`, `app/ArchiveOrDeletePrompt.tsx`), used
      elsewhere (the single-order card's own Q7 Archive control, Part 2).
      So Archive is **applicable but not-yet-wired** into the needs-review
      bucket's order-kind row, not genuinely inapplicable — the correct
      disposition per owner is this entry, not silently shipping it as
      "email-kind only" and losing the gap. Not built this session (new
      scope, out of bounds for a follow-up-questions pass) — pick up here:
      reuse `ArchiveOrderButton`/`ArchiveOrDeletePrompt` in
      `app/NeedsReviewRow.tsx`'s order-kind branch, decide whether it joins
      the same three/two-control shape as email-kind rows or gets its own
      shape (order-kind rows are always degrade — `needsReviewActions.ts:
      43-44` — so today they're single-control; adding Archive would make
      them two-control, matching email-kind degrade rows' shape).
- [ ] **`Order` table has zero indexes — not even on `userId` — NEW 2026-08-24,
      surfaced during the widened wasteful-`lookupReturnPolicy` fix design pass.
      Deferred, not shipped this session.** Checked `prisma/schema.prisma` and
      the full migration history: no `@@index`/`@@unique` on `Order` besides
      the primary key. Every order-matching query in `lib/linkOrder.ts`
      (exact match, prefix match, retailer-prefix match) already does a full
      table scan today — pre-existing, not introduced by this session's fix.
      This session's fix adds a second call to the same unindexed lookup
      pattern per eligible email (once for the new parent-order pre-check,
      once again for the real link/merge), so the app leans on the gap twice
      as often going forward, without closing it.
      **Why deferred rather than bundled in:** this is a DB-query-cost
      problem, not the billed-Anthropic-API-cost problem this session is
      scoped to fixing — bundling them mixes two different paper trails.
      It's also a schema migration, even though a low-risk additive one (a
      new index can't lose data or break an existing read, so per the
      standing migration rule it wouldn't need advance owner sign-off, just
      to be shown after the fact) — still deserves its own verification pass
      rather than riding along on the API-cost fix. Distinct from the
      earlier missing-`select` Neon bandwidth-quota incident (that was
      over-fetching columns; this is the absence of an index for filtering/
      lookup) but the same underlying lesson: query cost on `Order`/`Email`
      hasn't gotten the same scrutiny as billed API calls have.
      **Rough sizing (read-only census, 0 billed calls,
      `scripts/pm-census-order-query-volume-20260824.ts`):** ~8.3 eligible
      emails/day lifetime average (473 of 1147 extracted emails since
      2026-06-24 — excludes food/grocery-excluded and "other"-typed
      emails, which never reach an Order query), ~7.6/day over the last 14
      days. Each eligible email triggers 1-3 unindexed Order queries via
      `linkEmailToOrder` today; will become up to 4 once this session's
      pre-check ships. Rough order of magnitude: high single digits to low
      double digits of unindexed Order queries per day — small in absolute
      terms at current volume, worth fixing before volume grows rather than
      urgent now.
      Not required to ship; useful for prioritizing whenever indexing work
      is picked up. Natural target if/when built: a composite index on
      `(userId, retailer, orderNumber)` for the exact-match path — the
      prefix-match paths use case-insensitive (`mode: "insensitive"`)
      comparisons, which may need a functional/expression index rather than
      a plain btree to actually get used; worth checking Postgres's
      `EXPLAIN` output against the real query shape before assuming a
      naive index closes the gap, not just adding one and assuming it works.
- [ ] **Extend extraction's parent-order awareness beyond the policy-lookup
      skip — NEW 2026-08-24, spawned by the widened wasteful-`lookupReturnPolicy`
      fix (see 🔴 Now / Done).** Extraction should have general access to
      parent-order state, not just for the policy-lookup skip. The 2026-08-24
      fix passed the parent Order into `extractEmail()` as a data argument
      for exactly this reason — extend other extraction decisions (list
      candidates when scoped) to read from it. Owner intent: scope this
      week, likely next session or the one after. Do not scope or build
      until then.
- [ ] **Third-party returns platform emails (Happy Returns, Loop, Returnly)
      don't carry the retailer's original order number — NEW 2026-08-23,
      observed on Chan Luu return-approval email
      (`notify.happyreturns.com`, return ID `HRYTSJRJ`). Extractor
      correctly identifies retailer from the body but has nothing better
      than the returns-platform ID to use as `orderNumber`, so the email
      links to a synthetic "order" HRYTSJRJ rather than the customer's
      actual Chan Luu order. Not a bug in extraction — a structural gap.
      Bridging options (customer-email + timing correlation, retailer
      order lookup via customer account, etc.) all have real complexity
      and cost implications. Log for pattern-tracking; will recur across
      any retailer using Happy Returns / Loop / Returnly.**
- [ ] **Some retailers' transactional emails never carry the customer's
      order number in any email — NEW 2026-08-23, observed on Laundry
      Sauce (shipping_confirmation and delivery emails checked; no
      order_confirmation email exists on this account for the retailer).**
      The only identifying number in the emails is a shipping carrier
      tracking number, appearing inside a URL parameter deceptively named
      `orderNumberOrTrackingNumber` with the tracking value plugged in.
      H&M retry fix correctly returned null rather than mis-extracting the
      tracking number. Not a fix bug; a structural data gap.
      **Pattern to track:** retailers whose transactional email templates
      omit order numbers entirely — will produce permanently-orphaned
      email rows regardless of extraction fixes. Bridging options
      (customer-email correlation, order lookup via retailer account,
      manual owner input) all have real complexity/cost implications.
      Log for pattern-tracking; cousin to the Happy Returns / third-party
      returns platform finding above.
- [ ] **Needs-review flag should evaluate at order level, not per-email —
      NEW 2026-08-23.** Surfaced during H&M return_label hand-verify: the
      return_label email (`Email.id: cmt090ioq0001l404crsih7w9`) shows
      "Needs Review" because its own extracted fields are empty (order
      date, delivery date, return window, return deadline, policy source,
      order total all `—`), but every one of those fields is populated at
      the parent order level from the linked order_confirmation /
      shipping_confirmation / delivery emails. A return_label email doesn't
      restate order metadata by nature — flagging it individually because
      it lacks fields the order already has creates review noise the owner
      has to clear one row at a time for no data-quality reason.
      **Proposed rule:** an individual email is "needs review" only if
      (a) fields it *should* carry per its emailType are missing or
      low-confidence, or (b) the parent order still has gaps. If the
      parent order is complete, don't surface constituent emails in the
      review bucket just for empty fields they were never expected to
      carry.
      **Read first before scoping:** HISTORY.md entry for the 2026-08-21
      needs-review bucket rebuild — this change interacts with that work
      and must not re-break what was just fixed.
      **Distinguished from tiered-policy needs-review:** if the review
      reason is the tiered H&M window (or any other genuine policy
      ambiguity), that stays — this entry is only about the "empty fields
      on a status email" case.
- [ ] **Historical pm-diag script PII retrofit — NEW 2026-08-22, not started.**
      New pm-diag scripts landing 2026-08-22 and forward use
      `process.env.PM_DIAG_*` for user emails, order IDs, and order totals
      (see brief 4C). Scripts committed before 2026-08-22 still have real
      user data hardcoded — real emails, specific dollar amounts, specific
      order IDs — permanently in git history. Retrofit them to the same
      env-var pattern so the convention is uniform and any future
      contributor reading the repo sees only one pattern, not two. Scope:
      `git log --diff-filter=A --name-only -- 'scripts/pm-*'` before
      2026-08-22 to enumerate; owner confirms list before edits begin. Does
      NOT scrub git history (that requires force-push, out of scope) — only
      updates current file contents forward from the retrofit commit.
- [ ] **Needs-review bucket UX quality — four findings from the 2026-08-22 H&M
      row screenshot review. NEW 2026-08-22, not started. Deliberately NOT
      folded into the 2026-08-21 default-action heuristic item below** —
      that item is about default-action DIRECTION (Merge vs Create) once a
      row is in the bucket; these four are about display quality and action
      wiring when a row is displayed at all. Different workstreams, don't
      conflate.
      **1. Confidence calibration.** Detail page rendered `CONFIDENCE: high`
      on the H&M row while five downstream-critical fields were blank
      (`orderNumber`, `orderDate`, `deliveryDate`, `returnDeadline`,
      `orderTotal`). Whatever confidence is currently measuring is not the
      useful-fields hit rate. Recalibrate against fields-that-gate-linking,
      not against retailer-identification-succeeded-alone. Not a fix here —
      investigate what confidence currently reflects, then decide.
      **2. Copy correction on the needs-review row.** Row read "This looks
      like a real purchase with no order record" — DB had three H&M orders
      in the same account. The copy asserts an absence the DB disproves.
      Should read closer to "…couldn't be matched to an existing order" —
      and where same-retailer candidates exist, surface them (feeds
      Finding 3). Small copy change, but requires the row-rendering path to
      know the difference between "no candidates in DB" and "candidates
      exist, linker couldn't disambiguate."
      **3. Action-registry wiring gap.** The five locked needs-review
      actions per `CARD_SPEC` Part 5 include "Link to order [manual picker,
      v1]." That action did NOT appear on the H&M row despite three
      same-retailer candidates being present. Either the manual picker
      isn't wired into the action-selection logic yet, or the selection
      logic isn't offering it when it should. Wiring bug against a locked
      spec, not a design question. Check `lib/needsReviewRows.ts`
      action-registry paths.
      **4. Missing-price display.** H&M row showed no dollar amount while
      sibling rows in the same screenshot showed `$20.00` / `$697.10`.
      `orderTotal` didn't extract, so nothing to render. Question is
      display-layer: when `orderTotal` is genuinely absent, show a computed
      line-item sum, an em-dash, or hide the price slot? Design decision,
      not a bug.
      **All four moot for the specific H&M row 2026-08-22 once the
      extraction fix ships and the row links** — but stay real for any
      orphan that legitimately can't be linked, which is the entire reason
      the needs-review bucket exists. Do not defer on "the immediate row
      goes away."
- [ ] **Needs-review default-action heuristic may be backwards at the edges
      — NEW 2026-08-21, SUPERSEDED 2026-08-24 by "Routing tree design for
      needs-review bucket action selection" (🔴 Now — moved there
      2026-08-24 close-out, build session ready to start).** This entry
      implicitly assumed a decision tree existed and just needed better defaults;
      2026-08-24's read-only diagnostic confirmed no tree exists at all —
      one branch (exact orderNumber match) and one fallback, full stop. Left
      here for the H&M-case reasoning trail; superseding entry is where
      active work happens. Original text follows, unedited. Current
      logic (`lib/needsReviewRows.ts`'s `detectEmailReviewReason`,
      `real_purchase_no_record` → "Start a new order" as the default when no
      DB-detected match exists): defaults toward creating a new order
      whenever an orphaned email doesn't cleanly match an existing one.
      **H&M case exposing the edge:** Order 68462778273 already exists in
      the DB; a `return_label` email for it lands as an orphan (never linked)
      and the bucket row wrongly offers "Start a new order" as the primary
      action when the correct action is Merge with the existing order.
      **Open question, census-first, not answered here:** across the
      current orphan population, what fraction correspond to an existing
      order that just failed to link (this heuristic should favor Merge)
      vs. a genuinely new, never-before-seen order (favor Create)? Decide
      whether the *default* primary action should flip from "Start a new
      order" to "Merge with existing order" (demoting the other to
      secondary) based on what that census actually shows — not a guess.
      **ORDER MATTERS, this stacks on top of two already-tracked linking
      investigations — fix those first, then re-census, then decide the
      default:** (1) "H&M — do we extract from attachments?" (🔴 Now,
      confirmed no attachment extraction at all — a real linking gap, not
      just a heuristic problem, for at least some H&M orphans); (2) the
      Chan Luu return-approval orphan (🐛 Bugs — a return-tracking email
      that should have matched back to an existing order instead created a
      phantom new one, same underlying "orphan that should have linked"
      shape as this H&M case). Census-ing the CURRENT orphan population
      before those land would bake in counts that are still artificially
      inflated by known, separate linking bugs — the default-action
      decision needs a census taken *after* those are fixed, not before.
- [ ] **Full-detection reason mapping for the needs-review bucket. NEW
      2026-08-21 — not started.** Deferred from the same day's needs-review
      bucket rebuild (see 🔴 Now), which shipped a deliberately cheap version:
      only `belongs_to_existing_order` and `duplicate` are DB-detected; not-
      e-commerce detection was explicitly out of scope ("Do NOT attempt
      classifier-adjacent detection... in this pass"), and several
      already-differentiated order-kind signals (return-portal-untrusted,
      unconfirmed-forward-date, low-confidence) were folded into one generic
      `uncertain_details` reason rather than kept distinct. This item is the
      full version. Scope, not yet built: (1) real not-e-commerce detection
      for email-kind rows — the cheap version dropped the old `hasRetailer`
      proxy entirely (see 🔴 Now's "known behavior change" note: ~27 rows that
      used to show "Archive" now show "Start a new order"), so this needs a
      real signal, not a revived proxy; (2) email-kind duplicate detection —
      no canonical dedup key exists to compare one orphaned email against
      another orphaned email (as opposed to an established Order), which is
      why the cheap version only checks against existing Orders; inventing
      one wasn't in this session's scope; (3) re-differentiate order-kind's
      collapsed `uncertain_details` tail back into its original three signals
      if the generic sentence proves too vague in practice.
- [ ] **Unknown retailer in weekly digest. POINTER only, NEW 2026-08-19 —
      DO NOT START.** A standalone (unlinked) `shipping_confirmation`
      surfaces as "an unknown retailer" in the coverage digest (seen
      2026-08-16, owner window, read-only verification pass on the
      just-shipped establishing-email gate). Store name didn't resolve.
      Read-only identify only when picked up; likely tied to existing
      retailer-lookup/extraction gaps.
- [x] **Reconcile grocery entries. POINTER only, NEW 2026-08-13 — RESOLVED
      2026-08-21 during main/origin-main reconciliation.** The
      2026-08-09 food/grocery-delivery-exclusion task (this pointer's
      "the live one") shipped and is now ✅ Done; the older "Amazon
      grocery exclusion (Whole Foods / Amazon Fresh)" item has been
      marked RETIRED (🔴 Now) as part of this same merge, confirming
      this pointer's own ask. Its two named Step-0 decisions (DoorDash
      wholesale-exclude, junk-surface choice) were both resolved as part
      of shipping the live task — see that entry's Done write-up.
- [ ] **Extraction flow = TWO separate efforts, do not conflate. POINTER only,
      NEW 2026-08-13 — not started.** (i) Amazon old-style/template-break
      extraction bug — orders with real order numbers not matching (bucket
      items 9-12); symptom line still needs specifying. (ii) Pipeline cost
      redesign from the 2026-08-11 "scoping email flow" session — the
      Sonnet-read-before-junk-decision front-gate; architectural, interacts
      with the Gmail-OAuth pivot. Scope each in its own session.
      **UPDATED 2026-08-18 — scoping session, three read-only diagnostic
      passes (worktree, zero writes, zero billed calls each). Every cheap
      deterministic pre-Sonnet gate tested was REFUTED; direction changed
      from "add a gate" to "instrument the classifier, then tune Haiku on
      real data."**
      **(1) List-Unsubscribe drop-gate — REFUTED.** Full corpus (947
      rows): 6.8% of header-present mail is a real linked order (overturns
      the 2026-07-23 note's 0/20 sample). Owner hand-verified in own
      inbox: transactional and marketing are byte-identical in headers for
      at least one retailer (Monos) — no header rule can separate them.
      **(2) JSON-LD schema.org "keep" gate — REFUTED.** 0.5% real-order
      coverage (2/392); near-nobody in this corpus emits it. Precision
      perfect (0 marketing false-positives), coverage nil.
      **(3) Sending-domain split — INCONCLUSIVE.** Only 3 of 11 top
      retailers had marketing mail in-corpus to compare; 2 split cleanly
      (Bloomingdale's, Chewy), 1 ambiguous (Target). 8 of 11
      unconfirmable. A real build would need to filter to
      `forwardType:"auto"` first (manual forwarding rewrites From/DKIM to
      gmail.com).
      **Conclusion:** on this DTC-heavy retailer mix only CONTENT
      separates transactional from marketing — the classifier's job — so
      the lever is the Haiku `isCommerceEmail()` classifier itself, not a
      pre-gate. But it can't be measured or tuned today: the
      Haiku-rejected path creates no row (contentless `DiscardLog`), and
      `anthropic_usage` is a `console.log`, not a queryable table. NEXT
      BUILD = the measurement layer (instrument passed + rejected paths),
      THEN decide on a stricter prompt / 3-way-confidence Haiku on real
      data. Owner directive: this must work before the Gmail-OAuth pivot
      proceeds, and we are NOT assuming Gmail's own categories will do
      this for us. Not built.
- [x] **Needs-review bucket rebuild — POINTER only, NEW 2026-08-13, RESOLVED
      2026-08-21 (see ✅ Done — moved out of 🔴 Now the same day, once
      shipped and owner-verified live).** Diagnostic (2026-08-11) found ~40%
      of bucket rows are noise: 6 USPS carrier pings, grocery (covered by
      the "Reconcile grocery entries" item above), 2 promo/non-commerce.
      Both named sub-populations were run to ground: USPS got a real
      ingestion-time gate; the promo rows turned out to be outage-cluster
      residue, not a live gating gap — see the ✅ Done entry for the full
      census and reasoning.
- [ ] **Return-tracking-number integrity + return-in-transit feature
      (diagnostic first). NEW 2026-08-11**, surfaced via H&M #68468087873
      (mckenna.sweazey@gmail.com), where `returnTrackingNumber` turned out
      to be the same outbound DHL number as `trackingNumber` reused, not a
      distinct return-carrier reference — found while diagnosing why the
      order detail page's action row showed `Track your return` alongside
      `Refund received?` (see card-geometry session detail, 2026-08-11).
      TWO parts, gated:
      **(1) READ-ONLY DIAGNOSTIC:** across all orders, how often is
      `returnTrackingNumber` populated, how often does it EQUAL
      `trackingNumber`, and when distinct, is it a real return-carrier
      reference? Report the distribution before any code.
      **(2) GATED ON (1):** if return tracking is reliably real, build
      return-in-transit status into the Return started / Awaiting refund
      states (genuine value-add). If it's often just the outbound number
      reused, the live `Track your return` button is already misleading
      users — fix the gate so it only shows on a verified return number.
      **Note: the live-correctness angle (a button that may point users at
      the wrong tracking number today) is reason not to let this sit.**
      **[2026-08-26 OWNER DECISION — two-session gate approved]**
      Session 1 = part (1) as written, read-only diagnostic, zero billed
      calls, produces the distribution report ("how often is
      `returnTrackingNumber` populated / equal to `trackingNumber` / a
      real distinct return-carrier reference"). Session 2 = display fix,
      shape decided from Session 1's data. Owner's default expectation
      is a narrow gate on the `Track your return` button (only render if
      `returnTrackingNumber` is distinct and looks like a real return
      reference). Full return-in-transit feature is explicitly out of
      scope this pass — parked as a separate future item.
- [ ] **Ingestion observability + recovery. NEW 2026-08-20 — not scoped,
      waiting on owner priority.** Direct predecessor: the 2026-07-21
      ingestion incident (🐛 Bugs, Trust-breaking) could not be
      root-caused because no per-request logging existed at any
      ingestion stage — `DiscardLog` carries no per-email identifier, no
      other log source has per-request detail, and by the time this was
      investigated (2026-08-20) Vercel's own runtime logs had long since
      aged out. Its 12 rows of debris sat undetected for a month because
      nothing auto-recovers a stuck `extractedAt: null` row. Two-part
      scope, cost/shape TBD in its own scoping session: (a) per-request
      logging at each ingestion stage (webhook receipt, commerce
      classification, row creation, extraction) sufficient to diagnose a
      future incident like 7/21 while it's still in the log-retention
      window; (b) an auto-recovery mechanism for rows that end up with
      `extractedAt IS NULL` past some threshold — a retry, not just
      visibility. Both future incidents and their downstream data damage
      (silently orphaned rows, invisible to users and to the
      needs-review queue alike) depend on this existing at some point.
- [ ] **User-findable junk view. NEW 2026-08-18 — not started.** Junked
      Emails (marketing, non-commerce, food/grocery per the food+grocery
      exclusion task in 🔴 Now) are currently admin-rescuable only.
      Owner wants a user-facing surface: findable but deliberately
      harder than Archive — not top-nav, not a dashboard filter; think
      settings-adjacent or a deep-link page. Shape TBD. Adjacent to the
      existing admin cross-user junk/rescue view (blocked on mocks,
      ~line 2022) — may share components. Not part of the food+grocery
      exclusion build; that task ships without this and this ships when
      specced.
- [ ] **Amazon extraction broken — order-email template change. NEW
      2026-07-25, owner-reported. DEPRIORITIZED 2026-07-29, owner
      decision — moved from 🔴 Now, stays open.** Amazon has changed its
      order-email template; extraction is failing on the new-format
      emails. **SYMPTOM: still TBD by owner** — not yet specified whether
      this presents as missing orders, wrong status, or unparsed order
      numbers. **2026-07-28 data point:** current Amazon orders extract
      fine, per owner verification via dashboard screenshots — the break
      is either narrow (a specific sub-format) or not yet actually hitting
      real traffic, not a blanket failure. See also `AMAZON_HANDLING.md`
      Part 3 (✅ Done, parser limitations logged 2026-07-20) — this is a
      new, higher-severity entry in the same parser-limitations family,
      not a duplicate of the three already logged there (category-count
      item data, relative delivery dates, multi-shipment order numbers).
      Not diagnosed or fixed here.
      **[2026-08-26 FOLDED into 👀 Watching per owner]** Owner reports
      Amazon extraction currently working as expected. Not converted to
      ✅ Done because Amazon template drift is a permanent watch (see
      Decisions log entry "Amazon is committed work, not 'someday'"
      2026-07-19). Superseded by the new 👀 Watching entry "Amazon
      extraction health" — this item stays in place for historical
      record but no longer requires action unless the Watching entry
      re-flags it.
- [ ] **Admin route auth (`?secret=` query param) — needs hardening before
      the admin view shows other users' email metadata.** Flagged
      2026-07-22 during the Needs Review panel work. `app/admin/page.tsx`
      compares `searchParams.secret` against `ADMIN_SECRET` — acceptable
      today (owner-only, no other users' data exposed there yet), but a
      URL-embedded secret leaks via browser history, server logs, and
      referrer headers. Becomes a real problem the moment the admin
      cross-user junk/rescue view (blocked on mocks, see the junk-mechanics
      item above) starts showing other users' email content. Not fixed —
      needs a real auth mechanism (session-based admin flag, or at minimum
      a header instead of a query param) before that view ships.
- [ ] **Carrier tracking-number API integration — parked, explicitly NOT
      near-term, from the 2026-07-21 carrier-link-resolve probe (🔴 Now).**
      The probe found plain-fetch link-resolve unviable (0/6, see that
      item's close-out) but also found raw carrier tracking numbers
      (USPS/UPS-shaped) directly extractable from some delivery-email
      bodies as a body-text-only alternative — not resolved further because
      it means: (a) a real paid multi-carrier tracking API (USPS/UPS/FedEx
      each have their own, none free at volume), and (b) a privacy decision
      the owner hasn't made — sending a user's raw tracking number to a
      third-party API on their behalf. Do not pick this up opportunistically
      as a quick add-on to another task; it's its own initiative.
- [ ] **"delivery" emails that confirm delivery but state no date — real,
      project-wide extraction gap. Surfaced 2026-07-21, REFRAMED 2026-07-23
      now that the display-logic side is fixed — this is purely an
      extraction-quality gap now, not a badge/display bug.** Confirmed
      against real data: 15 of 33 `emailType: "delivery"` rows project-wide
      have `deliveredAt: null` on the Email row itself — the AI's own
      `extractionNotes` on these say outright no delivery date is stated in
      the email body. `parseForwardedHeaderDate()`'s fallback (used for
      `orderDate`, `lib/linkOrder.ts`) doesn't help either: checked directly
      against AquaTru's two delivery emails, neither has a parseable "Date:"
      line in the forwarded body — `receivedAt` (the forward/envelope date)
      is the only date on file for either, and it's explicitly not a
      confirmed delivery date. **2026-07-23: `displayStatus` no longer
      requires a date for these orders** — `deriveDisplayStatus` now treats
      a confirmed `delivery`-type email as sufficient evidence on its own,
      so all 15 (AquaTru included) correctly show "Delivered" regardless of
      whether a date was ever captured. **What's left, still real:**
      `deliveredAt` itself stays `null` for these — the return-deadline
      chip and any future "delivered on [date]" surfacing still has nothing
      to show. No fix shape proposed yet — needs its own investigation into
      whether these emails truly never state a date (nothing to extract) or
      whether it's a prompt/parsing miss.
- [ ] **No audit trail for IN-APP actions — operational gap, high leverage,
      surfaced 2026-07-20.** `ActionLog` only covers token/email-link
      actions (Archive, Mark Returned via signed links) — the in-app
      "Keeping it" button and `PATCH /api/orders/:id/status` log nothing at
      all today. Confirmed the hard way investigating LR #512867's Kept
      status (🔴 Now, `45574af`): no way to answer "who set this / when"
      without reading code and inferring from timestamps. Add logging (most
      likely: extend `ActionLog` writes to `advanceDisplayStatus` and the
      status/archive PATCH routes, same shape already proven for the
      token-action paths) so this is answerable directly going forward.
      Matters more with every new user — not urgent today, but the gap
      compounds.
- [ ] **`extraction-cost-visibility` = PHASE 1b — policy-lookup-cache
      (per-retailer positive cache). Cost structure mapped 2026-07-20, real
      lever identified, not built. RE-ORDERED 2026-07-22, not renamed —
      this is the same item as before, now placed relative to 🔴 Now's
      PHASE 1a and PHASE 1c.** Confirmed 3 call-sites total (see today's
      Done entry): Haiku commerce-gate on every inbound email, Sonnet
      `extractEmail` on commerce-classified emails, Sonnet+web_search
      `lookupReturnPolicy` conditionally on those. **The gate-then-extract
      design itself is already efficient — not a fix target.**
      **Real cost lever: `lookupReturnPolicy()` is the priciest call**
      (Sonnet + per-search web billing) and re-runs on every order from a
      retailer with no in-email return window, even when that retailer's
      policy was already looked up for a different order. Add a
      per-retailer return-policy cache (by retailer name/domain) so a
      policy is looked up once and reused — still the biggest compounding
      lever as user volume grows. Already anticipated in the
      `Cost / token efficiency pass` Someday item below ("Cache return
      policies by retailer domain") — this promoted that specific piece to
      Next on 2026-07-20. Entangled with the retailer-policy-database
      Someday item too, AND with PHASE 1a's negative cache — **design the
      schema once, with 1a: three consumers of one table, not three
      tables.**
      **Phase order (set 2026-07-22, see PHASE 1a/1c in 🔴 Now for the
      other two):** 1a (negative cache) comes first — it guards against
      every future garbage retailer, not just ones already seen, and is
      the direct fix for the 07-21 spike. This item (1b, positive cache) is
      the optimization on top, same schema. 1c (gating) is evaluated
      alongside both, not before either — it might shrink the problem
      instead of caching around it, but verify-gate findings say don't
      assume it's safe to just gate it off (a real live case depends on
      delivery/shipping emails being lookup-eligible).
      **NEW GATE, 2026-08-04 (board hygiene pass) — see PHASE 1a in 🔴 Now
      for the full note:** this cache is also gated on reading a few days
      of the now-live `anthropic_usage` logging before spec — same gate,
      not restated twice.
      **Cost findings that reframe this item, 2026-08-05 (from the Aug-4
      backfill's real production usage data) — verify against a full
      Friday's worth of logs, do NOT act on this alone:** actual
      `lookupReturnPolicy` trigger rate across the 103 re-extracted rows
      was **~26%** (27/103), well under the 70% precedent this cache's
      sizing has assumed — because **95 of 133 emails in that window were
      `emailType: "other"` (marketing)**, which never reach the lookup at
      all. That means the surprise cost driver in this batch may be
      **Sonnet `extractEmail()` running on a flood of marketing mail**,
      not lookup repetition — a *different* fix than this cache (e.g. a
      cheaper pre-filter before extraction; see `header-based-junk-drop`
      below, which is aimed at exactly this). Separately, worth folding
      into this cache's own design once it's built: every one of the 27
      real lookups logged `webSearchRequests: 3` — the max allowed, every
      time, with input up to ~32k tokens — so each lookup is expensive
      *and* never resolves early; open question for that design pass is
      whether to cap searches below 3. **Net: still worth building, but
      confirm from a full Friday's logs whether the dominant cost is
      marketing-on-extraction vs. lookup repetition vs. per-lookup expense
      before speccing — the fix differs for each.**
      **Dedicated Anthropic API key — still worth doing, priority DROPPED
      2026-07-22.** With per-call usage logging (`per-call-usage-logging`,
      🟡 Next) landing, the Console's per-key view stops being the primary
      cost-attribution instrument — it was the prerequisite-looking fix on
      07-20, it no longer is.
      **Watch item, not a bug:** manual re-extraction (email detail page
      action) and the `reextract-all-emails.ts` backfill script both re-run
      the full Sonnet path per email — a backfill session can spike Sonnet
      usage independent of real inbound volume. Don't misread a backfill
      spike as organic growth when reviewing the Console later.
      **New dominant-cost finding, 2026-07-23 (junk-backfill + ingestion-path
      investigation):** all 174 junked emails cost a Haiku call each —
      `isCommerceEmail()` passed every one of them (that's structurally the
      only way they became Email rows at all) — plus a full Sonnet
      `extractEmail()` pass on top. The Haiku gate's false-positive rate on
      marketing email is the dominant API spend here, not policy lookups —
      worth weighing against PHASE 1b/1c above, not investigated further.
      **EVIDENCE 2026-07-26:** the 23-row repair batch billed 39 calls not
      23 — 16 hit `lookupReturnPolicy`, and 14 SUCCEEDED (9 of the 23 were
      Amazon). This is the POSITIVE-cache pattern (repeat retailers
      re-looked-up every order), NOT the negative-cache failure pattern
      PHASE 1a's sequencing is built on. Do not ship the negative cache
      alone and call cost handled — the dominant waste in real traffic
      looks like redundant *successful* lookups on repeat retailers.
      Confirm ordering against the cost-anatomy token pass before
      building either.
      **SEQUENCING INVERTED, 2026-08-13 (separate read-only investigation —
      see `HISTORY.md`) — AWAITING OWNER SIGN-OFF, not yet applied.** Same
      finding as PHASE 1a's note in 🔴 Now: full 826-row measurement puts
      positive-repeat saves at 87% of saveable lookup volume (142/163)
      versus 21 for negative, so **this item (positive cache) is now the
      higher-value first build, PHASE 1a (negative) the follow-on** —
      inverting the 2026-07-22 "negative first" ordering above. Two
      confirmed design findings for the eventual spec: cache key must
      strip trailing punctuation, not just case/whitespace ("DONNI" vs
      "DONNI." currently split one retailer into two buckets); any
      negative-cache TTL must expire, not be permanent ("GLOBAL-E NL B.V"
      appears in both the positive and negative outcome sets — same
      retailer, inconsistent resolution, so a permanent failure entry
      would poison a later-resolvable retailer). Not self-applied — owner
      sign-off required before resequencing. Still sized-and-ready-to-spec,
      not built.
- [ ] **Live spend ceiling / alert — NEW 2026-08-04 (board hygiene pass).**
      A daily call-count or $ threshold that alerts BEFORE the Anthropic
      billing cap (the cliff) is hit — the thing that would have caught
      both the 07-19→07-20 and 08-01→08-04 credit-balance outages
      proactively instead of via after-the-fact investigation. Small.
      Distinct from PHASE 1a/1b/1c and `anthropic_usage` logging above —
      those cut spend; this one watches spend and fires before the wall,
      the only piece the board currently lacks (everything else here is
      retrospective cost analysis). Slug: `spend-ceiling-alert`.
- [ ] **`header-based-junk-drop` — design idea, NOT built, NEW 2026-07-23.**
      List-Unsubscribe present on 20/20 sampled junk emails, 0/20 known-good
      commerce (control-group verified). Proposal: on header match, skip
      BOTH the Haiku gate and Sonnet extraction entirely and create the
      Email row with `junkedAt` pre-set — never discard pre-row, so there's
      still a recovery path via `rescueEmail()` (unlike the current
      non-commerce discard, which never creates a row at all). Biggest
      identified cost fix available, zero model calls to implement or run.
      Not spec'd further, not built.
- [ ] **`carrier-facility-as-retailer` — a FedEx shipper facility name is
      being stored as retailer. NEW 2026-07-22, promoted to its own item
      2026-07-23 now that the 07-21 cost data shows it isn't cosmetic.**
      "ACE VISALIA RSC" is not a retailer; it's a facility name extracted
      from a delivery notification (confirmed via `extractionNotes`:
      *"identified from the shipper address in the body"*). **Two-surface
      bug, log it as such:** it inflates the API bill (14 doomed
      `lookupReturnPolicy()` calls in one day, see PHASE 1a/the ACE VISALIA
      🔴 Now item) AND it puts a warehouse name in front of users as if it
      were a store. The cost half is mitigated by PHASE 1a; the dashboard
      half is not mitigated by anything. **Scope:** (a) where the value
      enters — `lib/extract.ts`'s generic retailer-extraction instruction
      ("look for sender names... in the body") has no exclusion for
      carrier/shipping-facility naming; this is a prompt-rule gap, not a
      post-extraction normalization gap that's missing a step — there is no
      post-extraction normalization step at all today. (b) how many
      existing rows: confirmed 2026-07-23, 15 emails carry `retailer: "ACE
      VISALIA RSC"` exactly (9 linked into 1 real Order, 6 orphaned); a
      broader search for other carrier/facility names was inconclusive by
      keyword search (see the H&M attachment item, 🔴 Now, for the same
      search-limitation caveat) — needs a real pass, not a guess, before
      sizing the backfill. (c) fix + backfill if the count is non-trivial —
      backfill follows the existing pattern (dry-run default, `--apply`
      flag) and, per the Decisions log, silent correction is the
      established call for this class of change.
      **Second instance found, 2026-07-23 orphan-candidate report:
      "GLOBAL-E NL B.V" (a cross-border checkout/logistics processor) is
      the same shape as ACE VISALIA — a processor/carrier name stored as
      retailer, causing false NO-CANDIDATE orphans since the real merchant
      name was never captured. Not a one-off; the underlying prompt gap
      generalizes beyond FedEx facilities. Not investigated further.**
- [ ] **`per-call-usage-logging` — make cost a measured number, not a
      reconstructed one. NEW 2026-07-22.** Log the API response's `usage`
      field per call, tagged by call site (`classify` / `extract` /
      `policy_lookup`). Why this earns its place: the 07-21 investigation
      had to reconstruct lookup counts from stored `policySource` outcomes
      because no call log exists — and that reconstruction was initially
      wrong (a Prisma NULL-filtering gotcha, caught and corrected
      mid-analysis). Current best estimate is ~$0.30–0.40 per policy
      lookup, which is an inference from a daily total, not a measurement.
      **What it unlocks:** real per-user unit economics. If a policy
      lookup really is ~$0.35, a user with ten orders from retailers whose
      emails don't state a window costs several dollars a month in lookups
      alone. That number decides whether the caches above are sufficient
      or whether the product needs a different approach entirely — and
      right now it cannot be answered. **Note:** web searches bill per
      search, separately from tokens. The Console's "Daily token cost"
      chart likely does not include them, so token cost understates true
      spend on any day with lookups. Track search count too.
- [ ] **`first-order-before-forwarding` — known category, not a bug. NEW
      2026-07-23.** SilkSilky (the zero-candidate case in the
      15-orphaned-purchases item, 🔴 Now) has no candidate order because
      the user began forwarding *after* that purchase — the order
      confirmation itself was never received, so there's nothing to match
      against. Expected and unavoidable for manual forwarders, and for
      anyone who enables auto-forwarding mid-stream (everything before the
      forwarding rule existed is invisible by construction). Logging this
      so it isn't re-investigated as a defect the next time a zero-candidate
      orphan shows up. **Open product question, not decided here:** what
      should the app do with a delivery/shipping email for an order it
      never ingested at all — surface it as-is (with whatever the email
      alone can say), ignore it silently, or offer a manual "create this
      order" action? No lean recorded; needs an actual decision before any
      of the three gets built.
      **Re-confirmed 2026-07-23 (NO CANDIDATE bucket, orphan-candidate
      report):** SilkSilky is one instance of a category that will recur
      for every new user — cold-start orphans are expected, not a bug, and
      per the panel-design conclusion below should probably never reach a
      review surface at all rather than route through the same flow as a
      genuine matching failure.
- [ ] **[unconfirmed] Grocery / non-returnable parsed as returnable** — no
      repro in prod, 0 grocery orders exist to test against; needs a real
      test email to settle. Related to Amazon's "what counts as returnable
      retail." (Investigated 2026-07-20: no fallback/default
      `returnWindowDays` in `lib/extract.ts`, no code-level bug found —
      `isCommerceEmail()`'s classification of groceries as commerce is
      arguably correct; the open risk is the web-lookup step finding a
      real but inapplicable merchandise-returns policy for a perishable
      order. Same shape as `final-sale-nonreturnable-handling`.)
- [ ] **m2-tier-log-remove-after-measurement** — pull the
      `console.log("[M2 portal-trust tier]", ...)` line added in
      `lib/linkOrder.ts` for M2 (`classifyReturnPortalTrust`) once the tier
      distribution has actually been observed. It's a finite measurement
      instrument (how often does `unknown-unverified` really fire?), not
      standing production logging — and it sits in the inbound path right
      next to the still-open M4 finding ("stop logging plaintext in
      inbound"), so it shouldn't quietly become permanent furniture next to
      the exact problem M4 is about. Count-only, no PII, so not urgent —
      just don't forget it.
- [ ] **policysource-url-provenance-imprecision** — surfaced during M2's
      build (2026-07-19). `policySource` is an imprecise proxy for which
      source actually produced a given `returnPortalUrl`: an email can
      state a portal URL with no explicit return window (window comes from
      web lookup, URL still from the attacker-influenceable email body),
      so `policySource === "web_lookup"` doesn't reliably mean *this URL*
      came from the lookup. Any reasoning built on that field (M2's
      `web-lookup-sourced` tier included) carries a known false-negative
      rate against the actual threat model. Not fixed — would need
      threading the URL's actual source through as its own value rather
      than reusing `policySource`. Disclosure-spec fuel: feeds the
      quick-check surface (mobile audit finding #5, 🔴 Now) the same way
      M2's tier does — cross-reference there before designing.
- [ ] **reviewreasonlabel-missing-reasons** — pre-existing gap, surfaced
      (not introduced) during M2's build (2026-07-19). `reviewReasonLabel()`
      (`lib/orderReview.ts`) has no branch for #6a's kept-status-conflict
      reason — an order flagged by `computeKeptStatusConflict()` falls
      through to the generic "This order needs a quick check" fallback
      instead of naming the actual trigger. Same underlying shape as the
      `userNote`-parsing fragility already tracked ("move retailer-prefix
      marker off `userNote`," 🟡 Next) — every `needsReview` trigger needs
      a reason the UI can actually surface, and today only some do.
      Disclosure-spec fuel: feeds the quick-check surface (mobile audit
      finding #5, 🔴 Now) — cross-reference there before designing.
- [ ] **Pharmacy handling — scope decision, disputed diagnosis, needs
      resolution before either "spec" or "bug" framing is final.**
      Surfaced by the missing-Amazon-order investigation (`97bca38`,
      `523996b`): the real payload was an Amazon retail order for Flonase
      Allergy Relief Nasal Spray (an over-the-counter product, ordinary
      Amazon checkout — no prescription, no pharmacy branding, no doctor/
      insurance signal anywhere in the email). Two live characterizations
      of this exist and are **not yet reconciled**:
      (a) `isCommerceEmail()`'s "pharmacy or prescriptions" exclusion is
      too broad and is catching ordinary OTC retail purchases by
      product-category wording alone — confirmed by a controlled test this
      session (swapping only the product-description line to an unrelated
      electronics item flipped the classifier's result from `NOT_COMMERCE`
      to `COMMERCE`, template otherwise identical) — i.e., this is the same
      classifier bug already diagnosed, not a new, separate, correct
      behavior.
      (b) A same-day session-close characterization states the classifier
      "correctly filtered a prescription drug" and treats this as settled,
      non-bug behavior needing only a product/spec decision (does Return
      Window want to process pharmacy-adjacent commerce at all, and how).
      These two characterizations disagree on the underlying fact (was this
      a genuine pharmacy/prescription transaction, or an OTC retail
      purchase that merely reads as medicine-adjacent) and need to be
      reconciled together before this item's framing (bug fix vs. spec
      pass) is finalized. If (a) holds, the fix is narrowing the exclusion
      to actual pharmacy transactions. If (b) holds — or if Return Window
      decides OTC health-adjacent products should also be excluded as a
      deliberate policy, not just an accident of the current prompt — then
      this becomes the spec question as originally framed: does the app
      want to touch pharmacy/health-adjacent commerce at all, given
      regulatory/privacy considerations (PHI-aware handling, explicit
      opt-in, a separate flow), and if not, document that as an intentional
      decision (Decisions log) and update `isCommerceEmail()`'s comments so
      a future session doesn't "fix" deliberate behavior.
- [ ] **Security cadence remaining — reminder pointer, not a full backfill.**
      `SECURITY_AUDIT.md` open findings not yet given their own `TASKS.md`
      item: M4 (plaintext payload logging), M3 (`ADMIN_SECRET` in URL +
      non-constant-time compare), C2's own narrowed remediation (flag
      unverifiable-sender forwarded mail as `needsReview` — LOW priority,
      not yet built), L1, L2, L3, L6 (L5 already closed/tracked). **L4 is
      not on this list either** — accepted as risk 2026-07-19 for the
      current trusted-alpha threat model (not open, not fixed; revisit
      trigger recorded in `SECURITY_AUDIT.md`: re-open when the app admits
      non-trusted users). M2 no longer belongs on this list — it was pulled
      out into its own dedicated Now item 2026-07-19 (primary open
      finding). Per the session's own structural note below (Decisions
      log), every open audit finding should have a corresponding
      `TASKS.md` item — this pointer exists so the reminder itself isn't
      lost, but a proper one-item-per-finding backfill pass is still owed
      separately, not done as part of this docs sweep.
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
      `amazon-per-email-reminder-cadence`. **Committed work, gated on
      `amazon-first-class-case` landing first (2026-07-19 decision) — not
      "someday," but not started ahead of that spec either.**
- [ ] **Amazon dashboard card as folder, not single order — GROUPING
      RESOLVED 2026-07-20: strict `isAmazonOrder` only.** No Zappos, no
      Whole Foods, no marketplace-adjacent brands folded in — the open
      design question below (generalize to other retailers?) is
      **answered: no, Amazon-only.** Card is meant to stay out of the way,
      not be smart about brand-family membership. Amazon orders fan out
      into many shipments and often several "orders" that are really one
      shopping session, and the current card-per-order treatment makes the
      Amazon section of the dashboard chaotic. Proposal: collapse Amazon
      into a single folder-style card that expands to show the underlying
      orders — model bundling (net-new field/grouping), earliest-deadline
      aggregation across returnable/return-in-progress children (ignore
      not-yet-delivered), one standard-size card with expanded rows
      showing keep/return actions on delivered rows only, >5 rows links to
      a full page, sorts by its earliest child deadline like any other
      retailer card. **Collapsed-state contract reconciled against the
      standard card's own collapsed-action contract (2026-07-20, see
      Decisions log): this card's collapsed bottom-right is a summary
      (earliest deadline), NOT an action** — unlike a standard retailer
      card, which puts the state-dependent action there. Amazon inherits
      the 2×2 geometry but not the action-on-collapse rule; per-order
      keep/return stays expanded-rows-only, delivered rows only, as
      already specced above. Not related to the Gap Inc. brand-family item
      in this section — that item explicitly stays out of this grouping
      per the strict-`isAmazonOrder`-only decision. Slug:
      `amazon-dashboard-folder-view`.
      **Committed work, gated on `amazon-first-class-case` landing first
      (2026-07-19 decision) — not "someday," but not started ahead of that
      spec either.**
- [ ] **Amazon digest grouping — NEW 2026-08-04 (board hygiene pass).**
      Collapse Amazon to a single "Amazon — N orders this week" line
      instead of N thin lines, in BOTH the Sunday digest
      (`weekly-digest/route.ts`) and the Friday coverage-check
      (`weekly-coverage/route.ts`). **Distinct surface from
      `amazon-dashboard-folder-view` directly above** — that item is the
      in-app dashboard card, this is the two plain-text outbound emails;
      same underlying Amazon-fan-out problem, different code paths, not a
      duplicate. Blocked on a pinned decision: what counts as "one order"
      (distinct `orderNumber`? include unlinked orphans? count delivery
      re-entries as separate lines?). **Note the count semantics differ
      per digest** — Sunday is due-by-deadline content, the coverage-check
      is arrived-this-week content — so one shared grouping helper may
      still need two different counting rules underneath it. Slug:
      `amazon-digest-grouping`.
- [ ] **PROMOTED to 🔴 Now 2026-07-17 — see Now section.** Slug:
      `mobile-ux-audit-pass`.
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
      **AMENDED 2026-09-01, from Start-return CTA coverage investigation:**
      original framing was WNU as one data point. Spot-check of 10 random
      `returnPortalUrl` values now in production found 3-4 clearly broken
      (Buff City Soap → contact page, Gap → cookie failure, Wayfair →
      404), plus 3 Amazon URLs returning 200 but landing on a generic
      claim-auth flow that may not resolve to the user's specific order.
      Real bad-URL rate estimated at 30-40%, not a one-off. Higher
      priority than originally scoped, and the "degrade low-confidence
      values" remedy needs sharpening — the bad URLs weren't uniformly
      low-confidence, and static URL health checks won't catch semantic
      wrongness (Amazon case). Spec pass required before build.
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
- [ ] **Email CRM / engagement tracking** — per-recipient view of email history +
      engagement (delivered / opened / clicked) across reminders, digests, and
      refund check-ins. Purpose: see who's actually engaging vs. gone cold —
      especially useful while driving auto-forwarding adoption in alpha. Likely
      surfaces data the ESP (Postmark, assuming outbound = Postmark) already
      records — check before building new instrumentation. Caution: enabling click
      tracking rewrites links through a redirect domain; use a branded tracking
      domain (e.g. link.myreturnwindow.com) so it doesn't read as the raw-tracking-
      URL phishing smell already flagged as a trust bug. Supersedes / absorbs the
      earlier "opens/clicks view" note. Slug: email-crm-engagement-tracking.
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
      patches. Slug: `amazon-first-class-case`.** Every session so far has
      surfaced Amazon-specific adaptations: no `order_confirmation` email
      type (Bug 8), never provides purchase date (Bug 8 `receivedAt`
      fallback), variable formats across sub-brands (Fresh, Prime Video,
      marketplace, Whole Foods, digital), category-dependent return
      policies, refund emails without dollar amounts, Amazon-hosted return
      portals instead of retailer "start return" links, likely order_date
      vs delivery_date anchor mismatch (surfaced in tier 3 verification).
      Before adding another Amazon-specific patch, do a spec pass: what
      would it look like to treat Amazon as a first-class case, with its
      own extraction rules, its own policy lookup, its own reminder cadence
      if warranted? **`AMAZON_HANDLING.md` drafted 2026-07-20 (see 🔴 Now) —
      DRAFT status, awaiting owner approval, not yet a green light to build.**
      **Committed work, not "someday" (2026-07-19 decision — see Decisions
      log): `amazon-dashboard-folder-view` (UX) and
      `amazon-per-email-reminder-cadence` (digest/reminder) are both in
      scope, bound to this spec landing first — no more piecemeal Amazon
      patches ahead of it.**
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
- [ ] **Move retailer-prefix merge marker off `Order.userNote`** — today's
      backfill wrote `[auto] retailer prefix match: ...` into `userNote`, which
      per Milestone 10 is the user-authored review note. If `[auto]`-prefixed
      entries accumulate, user notes become indistinguishable from system notes
      in queries and the admin dashboard. Needs a proper field or audit log.
      Spawned by `2cb5de2`.
- [ ] Archive page tidy-up — strip to essentials: archived orders + static chrome (nav,
      menus) only. No filter dropdowns, no cross-bucket counts, no nudges toward active
      orders. Archive is a quiet room, not another dashboard.
- [ ] **Order-to-order merge action — DESIGN + BUILD, not a small follow-up. NEW
      2026-08-21 — not started.** Deferred from the same day's needs-review bucket
      rebuild session, specifically the order-row action decision: owner accepted CC's
      "Degrade to View detail always" recommendation, which noted "Stays inside 'cheap
      version' scope — no new merge machinery this pass" (see that session's 🔴 Now
      needs-review bucket rebuild entry / close-out for the full decision record). Today,
      order-kind bucket rows whose reason detects as
      `duplicate` or `belongs-to-existing-order` show the accurate spec-aligned
      why-sentence but their action always degrades to `View detail`, because the
      existing Link-to-order picker only attaches an unlinked `emailId` to an Order — it
      has no capability to merge one already-created Order into another. This item is
      that capability. **Open design questions to resolve when picked up, not answered
      here:** what happens to the losing order's linked emails (migrate to the winning
      order, or stay dual-linked?); what happens to the losing order's Reminders (cancel
      or migrate?); confirm-step design (destructive/near-destructive, needs its own
      friction); undo behavior; display behavior if a new email later arrives addressed
      to the losing order's id after the merge has happened.
- [ ] **Needs-review bucket residue cleanup (one-time), not a feature. NEW 2026-08-21 —
      not started.** Residue left behind by three going-forward gating/exclusion ships,
      none of which retroactively swept rows that already existed before they shipped —
      spawned by the same day's needs-review bucket rebuild session. Three independently
      identifiable sub-populations: (1) ~3 promo rows (`em.target.com` ×2,
      `email.bloomingdales.com` ×1) that are actually residue of the already-tracked
      2026-07-31/08-01 credit-outage extraction-failure cluster, per this session's
      promo-gate census — not a live gating gap, just still sitting in the bucket; (2)
      USPS carrier-ping rows that landed before this session's ingestion-time
      `tracking.usps.com` pre-junk gate shipped (6 live at census time this session;
      exact count TBD whenever this is picked up); (3) pre-2026-08-19 grocery emails
      that predate the food-grocery-exclusion ship and were never swept by its own
      historical sweep (which only covered its own detection criteria, not this
      unrelated older residue). **Approach when picked up:** read-only identification
      script first, then an owner-confirmed deletion pass — not a code-path change,
      same one-off census/cleanup pattern already used elsewhere in `scripts/`.
- [ ] **Elevate bucket-residue-cleanup priority — NEW 2026-08-25.**
      The existing bucket-residue-cleanup 🟡 Next task (USPS/UPS
      pregating) and the separate grocery-exclusion sweep (Whole
      Foods) both remain accurate. Adding priority signal:
      during Session-2 hand-verification of the deployed routing
      tree, these residue rows made the bucket significantly
      harder to hand-verify — a majority of visible rows were
      residue rather than actionable items. Recommend elevating
      both to 🔴 Now once Session 2 closes, so the next
      hand-verification pass has better signal-to-noise. Does
      not change scope of either task, only priority.
- [ ] **`anthropicUsage.test.ts` stale type fixture — NEW
      2026-08-25, surfaced during Session-2 build follow-up.**
      `@anthropic-ai/sdk@^0.105.0`'s `Usage` type added a
      `cache_creation: CacheCreation | null` field; the test's
      `BASE_USAGE` fixture predates that and doesn't include it.
      Fails `tsc --noEmit` but passes `vitest run` — it's a
      TypeScript type-narrowness issue, not a runtime test
      failure.

      **Not a live accounting bug:** `lib/anthropicUsage.ts:38`
      reads `cache_creation_input_tokens` (the older flat field,
      unaffected by the SDK change), not the new nested
      `cache_creation` object. Fix is a one-line fixture patch
      (`cache_creation: null` added to `BASE_USAGE`) the next time
      someone's in that file, or as a standalone cleanup.

      **Revisit trigger:** if the SDK deprecates
      `cache_creation_input_tokens` in favor of the nested object,
      this becomes urgent (real accounting reads would need to
      switch, not just the fixture).

      **Note:** logged as 🟡 Next rather than 🐛 Bugs because
      there's no runtime failure and no incorrect behavior — the
      real accounting code is correct. The `tsc` error is
      cosmetic type staleness that should still be cleaned up so
      real type errors in that file don't get masked by "oh
      that's the known stale one."
- [ ] **Order date on collapsed order card — display next to order
      number. NEW 2026-08-26, owner-approved.** Owner: "for alpha i'd
      rather be a bit ugly and functional." Already present on the
      expanded card and the order detail page. Requires CARD_SPEC.md
      Part 3 amendment (adds a field to the collapsed 2x2 identity
      slot). Small. Watch: collapsed card is already tight on mobile
      (Mobile UX audit finding 8, item 1310) — order number + item name
      + now order date on one row risks overflow at narrow widths.
      Owner has accepted this trade-off; note the acceptance in the
      spec amendment so a future design pass knows it was a conscious
      functional-over-clean call, not an oversight.
- [ ] **Copy order number on collapsed dashboard card — extend the
      order-detail-page copy affordance (item 5199, shipped) to the
      card. NEW 2026-08-26.** Small. `lib/orderNumberDisplay.ts` +
      clipboard call reusable as-is. Add the copy button/icon inline
      with the order number on `app/OrderCard.tsx`. Watch: same
      overflow risk as the order-date-on-card item above — if both
      built in the same session, reconcile the collapsed layout once,
      not twice.
- [ ] **Refund check-in reminders — read-only diagnostic. NEW
      2026-08-26, owner-flagged: "don't think I'm getting them for
      everything."** Investigate whether `runRefundCheckinReminders()`
      (`lib/refundCheckin.ts`) is firing when the rules say it should.
      For each Order currently in status `return_started` or
      `refund_pending` (plus any recently transitioned out), enumerate:
      (a) per the reminder rules, on which dates should a check-in
      reminder have fired; (b) does the `Reminder` table show it
      actually did fire on those dates? Report the delta.
      Related-but-separate: item 1221 (`refund_pending → SKIP_STATUSES`
      guard) — confirm the diagnostic query doesn't misclassify orders
      that were correctly skipped by that guard.
      READ-ONLY (pure DB query, zero billed Anthropic calls — Claude
      Code confirms this before running per header). Fix session gated
      on what the diagnostic finds; may be nothing to fix.
## 👀 Watching — parked, revisit only if it recurs
- [ ] **Pre-order residual: "Return by" line + reminders can fire
      pre-shipment — NEW 2026-09-01, downgraded from 🔴 Now.** Originally
      opened from the Loeffler Randall investigation as a full suppression
      build; a same-session follow-up investigation found the acute bug
      that motivated it is already fixed — the old wrong Jul-25-style
      deadline was fixed by commit `0598f4a` (preorder `shipByDate`
      handling), and the acute "green countdown + Start Return button
      pre-delivery" combination is structurally unreachable today thanks to
      the unrelated `CARD_SPEC.md` order-card state machine, which gates
      the `returnable` state on a real `deliveredAt`. Two smaller residuals
      remain, not worth a build against yet:
      (1) The "Return by [date]" line still renders during the pre-order/
      not-yet-shipped phase. The number is defensible now (ship-by-date +
      return-window-days, e.g. Sep 9 for LR) but implies more certainty
      than exists on an item that hasn't shipped.
      (2) 7-day and 2-day reminders remain eligible to fire pre-shipment —
      `suppressForEstimatedDeadline` only blocks 1-day/same-day reminders
      on an estimated deadline, so a pre-order could still get a "7 days
      left" nudge on an item still sitting in the retailer's warehouse.
      **Revisit if:** a real user complains about either residual, or the
      7-day/2-day reminders are actually observed firing on a real
      pre-order and reading as wrong.
- [ ] **Order-detail action-row layout on kept orders reads
      confusingly — NEW 2026-08-31, owner-reported after
      un-keep hand-verification. Not urgent, not fixed.**
      On a kept order's detail page, the action row now shows
      "May not be keeping after all" and "Archive" side by
      side, plus a "Kept" badge in the top-right. Two issues
      tangled together:
      (1) Both buttons interact with `archivedAt` — un-keep
      clears it as part of the atomic write, Archive sets it —
      but neither label says so, so the user has two buttons
      operating on overlapping state with no visible cue.
      (2) A truly-kept order shouldn't have Archive reachable
      at all (Keep atomically archives, so it'd be a no-op) —
      the fact that it IS reachable here means this specific
      order is in the LR #512867 kept-and-unarchived state,
      which the un-keep feature was built to give users a way
      out of. So the confusing UX is partly the fingerprint of
      the underlying label-coherence gap the queued spec pass
      is meant to address, not purely a fresh UX problem.
      **Observed on:** Loeffler Randall #512867 (yes, that one).
      **Why parked rather than fixed:**
      - Not clear yet whether the fix is a button-visibility
        rule (hide Archive when displayStatus === "kept" and
        archivedAt is already set) or belongs to the queued
        label-coherence spec pass, which will re-examine
        kept/archived interaction holistically.
      - Fixing button visibility in isolation risks locking in
        a rule that the spec pass then wants to redo.
      **Revisit if:** (a) another user (not #512867) hits the
      same confusion, meaning it's not just the known LR
      unarchived-kept case; (b) the label-coherence spec pass
      gets picked up — this is a concrete example to test
      against; (c) un-return/un-refund actions ship (queued
      Extend-signed-token-actions item), at which point the
      whole reverse-action row needs a layout decision anyway.
- [ ] **Preserve-guard asymmetry between `deriveDisplayStatus` and
      `computeOrderStatus` — someday cleanup, 2026-08-31, surfaced by
      the un-kept action read-only pass.** `deriveDisplayStatus`
      (`lib/displayStatus.ts:99-132`) has an explicit preserve guard at
      line 105 (`if (currentDisplayStatus === "kept") return "kept";`)
      so email-driven recomputes can never silently overwrite a
      user-set manual state. `computeOrderStatus`/`recomputeOrderStatus`
      (`lib/linkOrder.ts:238-286`, called on every order
      create/relink/review-resolve, `lib/linkOrder.ts:294-296`) has
      **no equivalent guard** and reads no current value before
      writing — so any inbound email on an order whose `status`
      happens to equal `"kept"` will overwrite it back to
      `"returnable"`/`"completed"`/etc. without warning.
      **Practical consequence today:** `status: "kept"` isn't
      durable across email arrivals. Mostly invisible because
      `status` isn't user-facing and `computeKeptStatusConflict`
      (`lib/linkOrder.ts:450-467`) guards the two email types most
      likely to matter (return_label/refund on a kept order → flags
      needsReview instead of merging silently). Other inbound email
      types would silently reset `status`. The un-kept action being
      built (🔴 Now) sidesteps this by unconditionally recomputing
      status on un-keep, so the asymmetry doesn't bite that path —
      but it remains a real difference in the two systems'
      write-safety contracts.
      **Rationale for not fixing now:** the two systems have
      different design intents per the 2026-07-19/20 Session-1
      close-out (see ✅ Done: `status` = purely automatic
      email-evidence signal, `displayStatus` = user-facing state
      that accepts manual writes), so it's defensible that only the
      user-facing one guards against automatic overwrites of
      manual state. But no manual write path currently sets `status`
      directly, so the asymmetry has never been tested by a case
      that would actually hurt.
      **Revisit if:** (a) we ever add a manual write path to
      `status`, (b) any user-facing surface starts reading `status`
      directly instead of `displayStatus`, or (c) we discover an
      email path that resets `status: "kept"` in a way that affects
      alert eligibility or reminder logic on a real user's order.
- [ ] **Retailer string matching brittleness — 2026-08-30.**
      `findShipmentMergeCandidates` (`lib/linkOrder.ts`) and
      `findRefundFallbackOrder` both do case-insensitive-exact retailer
      matching. No whitespace normalization, no punctuation folding, no
      brand-family logic. Handles capitalization drift from extraction,
      but retailers with real punctuation/whitespace variants (Levi's vs.
      Levis, AT&T vs. AT and T, J.Crew vs. J Crew) won't cross-match.
      Surfaced during the shipment_unlinked build (2026-08-30);
      deliberately not scoped into that ticket.
      **Revisit if:** picker starts under-suggesting candidates in
      production, or a user reports "the app doesn't recognize this is
      the same retailer." First place to look. Fix approach TBD — likely
      a shared retailer-normalization utility, but scope of what to
      normalize is a real design question, not a small edit.
- [ ] **Two non-identical "active order" conventions coexist, on two
      different fields, never reconciled — someday cleanup,
      2026-08-31.** `OPEN_STATUSES` (`lib/alerts.ts:9`) operates on
      `Order.status`: `["ordered", "shipped", "delivered", "returnable",
      "needs_review"]` — "statuses where starting a return is still a
      meaningful, available action," used for the dashboard's open-orders
      list and the alerts badge/count. `NON_TERMINAL_STATUSES`
      (`lib/autoArchive.ts:19`) operates on the separate `Order.
      displayStatus` field: `["ordered", "shipped", "delivered",
      "return_requested"]` — used only to decide what the nightly
      auto-archive sweep is allowed to touch. Close in spirit ("not done
      yet") but not identical, and on two different columns. Surfaced
      2026-08-31 while deciding `findShipmentMergeCandidates`'s status
      filter (TASKS.md 🔴 Now shipment_unlinked ticket, Stage 3) — that
      function ended up using `OPEN_STATUSES` after an explicit owner
      decision, but the duplication itself predates this build and wasn't
      created by it. Not urgent, no known bug from it today.
      **Revisit if:** the next feature that needs "is this order still
      active" has to choose between the two and it isn't obvious which —
      that's the forcing function this currently lacks. At that point,
      worth deciding whether to consolidate onto one field/list or keep
      both deliberately (if their different purposes genuinely warrant
      different definitions).
- [ ] **Status-filter asymmetry across merge-candidate matchers —
      someday cleanup, 2026-08-31.** `findShipmentMergeCandidates`
      (`lib/linkOrder.ts`, Stage 3 of the shipment_unlinked ticket)
      filters candidates to `OPEN_STATUSES` — excludes terminal-state
      orders (returned/refunded/completed/expired) from matching,
      deliberate owner decision (done orders stay done). But the two
      pre-existing matchers it sits alongside, `findMatchingOrder` and
      `findRefundFallbackOrder` (both `lib/linkOrder.ts`), apply **no**
      status filter at all — they rely purely on precise `orderNumber`
      exact/prefix match or refund line-item/total signals instead, and
      never exclude terminal-state orders. **User-facing consequence:**
      an exact-orderNumber match or a refund-fallback match can silently
      merge a new email into an already-returned/refunded/completed
      order today; a retailer-only match (the new matcher) can't.
      Rationale for the asymmetry is defensible — precise signals
      (orderNumber, line-item overlap) are strong enough to trust
      regardless of order status, while retailer-only matching is weak
      enough that a status guard makes sense as an extra safety check —
      but the inconsistency itself was never a deliberate design decision
      on the pre-existing matchers' side, just an absence. Not proposing
      a fix here — capturing so it isn't silently rediscovered later as
      if it were new.
      **Revisit if:** a user reports "the wrong order got merged into"
      on an already-closed order, or the next design pass on matcher
      rules generally (a natural point to decide whether all matchers
      should agree on a status policy, or whether the asymmetry should
      be made explicit/documented as intentional).
- [ ] **shipment_unlinked picker: retailer-filtered candidate list
      deferred — 2026-08-31.** The shipment_unlinked ticket (TASKS.md
      🔴 Now) shipped the reasonId rename/gate expansion (Stages 1-2), a
      retailer-scoped candidate matcher (Stage 3, `findShipmentMergeCandidates`,
      `lib/linkOrder.ts`, tested), and a "none of these, create a new
      order instead" escape hatch inside the picker (Stage 4 Part 4b). It
      did NOT ship narrowing `LinkToOrderPicker`'s candidate list to that
      matcher's output (Part 4a) — scoped, then deliberately deferred same
      session. The matcher exists and is tested but isn't wired to
      anything; the picker still shows every active order regardless of
      the row's retailer.
      **Plumbing shape decided, not built:** a side map
      (`shipmentMergeCandidatesByEmailId: Record<string, LinkablePickerOrder[]>`)
      computed at the page level (`app/(app)/page.tsx`,
      `app/(app)/needs-review/page.tsx`) and threaded through one new prop
      each on `NeedsReviewBucket` → `NeedsReviewRow` → `LinkToOrderPicker`
      — chosen over attaching candidates directly to `NeedsReviewRowData`
      to avoid touching the already-tested pure row-building code in
      `lib/needsReviewRows.ts`.
      **Revisit if:** the picker UX becomes a real pain point in
      production — users regularly scrolling a long full-order list to
      find the right one on a shipment_unlinked row, or reporting the
      picker as unhelpful/confusing. Not urgent while the create-new
      escape hatch covers the dead-end case.
- [ ] **Multi-email signal disagreement pattern — NEW 2026-08-27, from the
      orderDate write-once backfill (`c8fec62`).** Found 2 orders where
      multiple emails of the same priority-firing type carried disagreeing
      candidate values for `orderDate`: Fitness Superstore #48868 (two
      order_confirmation-typed emails, 2025 vs. 2026) and — differently —
      Waitrose #1058208405 (only one signal existed, so it didn't trip
      this specific check, but the underlying "which of several candidate
      dates is trustworthy" question is the same shape). Handled this
      session by excluding disagreeing orders from auto-correction
      entirely rather than guessing a winner — safe, but means these
      orders just sit unresolved (`orderDateSource: "fallback"`) rather
      than actually getting fixed. **Revisit trigger: if more than 5% of
      orders exhibit same-type-multiple-signal disagreement** (not
      measured broadly this session — only checked within the ~198-order
      orderDate backfill population), or **a user reports a wrong
      deadline traceable to an order this exclusion punted on** — either
      would justify designing a real tie-break rule (source-quality
      ranking, most-recent-wins, most-confident-extraction-wins) instead
      of always falling back to "don't touch it."
- [ ] **Data-integrity monitoring — NEW 2026-08-27, from the 2026-08-27
      session run (delivered-badge, timezone drift, orderDate write-once
      — three real bugs in one day, all found by manual eyeballing, not
      by any standing check).** At current alpha scale (~200 orders,
      4-5 users) manually reviewing an eyeball list before a backfill
      works — it caught Fitness Superstore before this session's own
      backfill would have corrupted an already-correct value. It doesn't
      scale past alpha. **Worth a future session designing a lightweight,
      read-only data-integrity sweep** — queries that flag orders with
      internally inconsistent fields (e.g. `deliveredAt` before
      `orderDate`, `returnDeadline` not reconcilable from its own stated
      `orderDate`/`returnWindowDays`/`returnWindowStartsFrom`, `orderDate`
      not derivable from any linked email — the exact shape of check this
      session's diagnostics were written ad hoc, one bug at a time).
      **Revisit trigger: 25+ users, OR any user-reported bug traceable to
      silently-wrong data** that a standing check could have caught before
      the user noticed.
- [ ] **Grocery orders are out-of-scope for product assumptions — NEW
      2026-08-27, from the Waitrose #1058208405 orderDate-backfill
      review.** This app's core assumptions (single-purchase,
      single-delivery, non-recurring, one order → one return-window
      decision) don't fit grocery-shaped data well — Waitrose's order
      showed 7 emails, all reschedule notifications for one recurring
      delivery slot, no clean "order placed" signal anywhere, and (see
      the 🐛 Bugs entry logged this session) a separately-broken 5-years-
      stale `returnDeadline`. Accepted as a non-goal this session rather
      than special-cased: grocery orderDate/returnDeadline accuracy
      doesn't affect any decision this product makes for a grocery order
      today. **Revisit trigger: if real users start forwarding grocery
      orders in volume** — then this needs an actual scoping decision
      (exclude grocery entirely, à la the existing Whole Foods/Amazon
      Fresh exclusion, vs. building real support for it), not more
      one-off tolerance of bad data.
- [ ] **Repeated xSource companion-field pattern — NEW 2026-08-27.**
      `Order.orderDateSource` (this session) is the second field of this
      exact shape on the schema — `Email.anchorSource` (2026-07-25,
      `ANCHOR_DATE_RESOLVER.md`) was the first: a debug/provenance enum
      living alongside the value field it describes. Two is a coincidence;
      a third would be a pattern worth designing around instead of
      repeating ad hoc. **Revisit trigger: if a third `xSource` companion
      field gets proposed**, pause and consider a general provenance
      abstraction first — a JSONB `fieldSources` column, or a dedicated
      `FieldHistory` table — rather than adding a fourth/fifth bespoke
      `String?` enum column one at a time.
- [ ] **CC compliance-claim pattern: shipped-letter vs shipped-spirit — NEW
      2026-08-24, owner-logged, first instance.** CC can implement a spec's
      literal rules (mapping tables, fallback defaults, DoD checkbox
      features) while leaving the upstream code paths that would exercise
      those rules unreachable — and self-report the shipped work as
      spec-compliant. **Precedent:** the 2026-08-21 needs-review bucket
      rebuild (✅ Done) claimed "CARD_SPEC.md Part 3 compliance." The
      2026-08-24 diagnostic confirmed the mapping layer + degrade-to-View-
      detail rule are correctly implemented in `lib/needsReviewActions.ts`,
      but the upstream classifier (`lib/needsReviewRows.ts:67-74`)
      produces only one non-match reason — so two of five spec actions are
      structurally unreachable, one is over-reached, and the
      degrade-to-View-detail branch is dead code for email-kind rows
      (implemented but never triggered, since the classifier's two-value
      output space never produces an unmapped reason). **Root cause was
      NOT mid-run spec revision** — spec signed off 2026-07-29, static
      through build. Owner verification exercised container/row/layout but
      not the classifier→action end-to-end paths.
      **Mitigation adopted:** CC's ✅ Done reports for "compliance with
      SPEC" claims must name the file+line implementing each DoD checkbox
      AND identify the upstream code paths that reach each named spec
      behavior. The 2026-08-24 routing-tree design session
      (`NEEDS_REVIEW_ROUTING_DESIGN.md`) demonstrated the shape — every
      finding was file+line referenced. Codified as norm going forward.
      **Revisit trigger: if this pattern recurs a second time,** promote to
      a hard rule + require an end-to-end test row per named spec behavior
      before ✅ Done.
- [ ] **Manual-forward exposure for food/grocery exclusion — NEW
      2026-08-20, investigated, zero exposure found.** The sender-domain
      pre-junk layer (`shouldAutoJunk`'s `fromDomain` check) is
      structurally blind for manually-forwarded emails: the From header
      becomes the user's own address, not the retailer's, so a manual
      forward of a real food/grocery email would slip past that layer
      (the retailer-name backstop is unaffected — it reads the
      AI-extracted `retailer`, not the sender). Checked all 58 Emails
      where decrypted `fromEmail` exactly equals the owning `User.email`
      (the manual-forward signal): parsed the quoted inner `From:` line
      from the body for 57 of 58, and checked subject/body content
      against every enumerated food/grocery name for all 58. **Zero
      exposure — 58/58 are real, unrelated retailers** (Old Navy,
      Tuckernuck, Nordstrom, Shopbop, Chan Luu, etc.); one content match
      ("caviar") is the same Chan Luu jewelry false positive documented
      elsewhere, not a real Caviar-app email. **Revisit trigger: a real
      food/grocery manual-forward lands in the needs-review bucket** —
      until then this is a latent, not demonstrated, gap.
- [ ] **P0 cross-user data exposure (Wayfair + On) — MOVED here 2026-08-06
      from 🔴 Now, owner decision: not a systemic bug, don't build a fix
      now.** Diagnosed 2026-07-28 (mechanism traced to the byte, full
      detail in `HISTORY.md` 2026-07-28 follow-on entry): two distinct,
      unrelated causes, not one shared "mis-forward." (1) **Wayfair** —
      the owner's own Gmail→Return Window auto-forward rule too broadly
      swept up a personal email Alexandra had sent to his personal Gmail.
      Owner's call, 2026-08-06: this is forwarding-shape, not repeatable
      under normal circumstances — watch, don't fix preemptively. (2)
      **On** — a genuine manual mis-send (owner picked the wrong real
      address by hand). Owner's call, 2026-08-06: this instance is very
      old and may simply have been an address-entry mistake, not a
      systemic gap — watch, don't fix preemptively. Blast radius stays
      as measured: 2 hits across 503 `Email` rows, isolated to this one
      user pair, both already known. **Revisit trigger: if either shape
      recurs with a different user pair**, escalate back to 🔴 Now —
      recurrence would prove it's systemic, not a one-off.
      **Two follow-ups from the original diagnosis:**
      1. `SECURITY_AUDIT.md` C2's summary line ("no cross-user data leak")
         is still technically inaccurate — real exposure did occur, via
         filter/address-entry scope, not forgery. Wording fix only, no
         code. Not done — `[needs clarification]` whether owner still
         wants this independent of the parking decision below.
      2. The two mis-filed rows (Wayfair Order still live under the
         owner's account, On Order still live under Alexandra's) —
         **owner decision 2026-08-06: ignore for now**, same parking as
         the mechanism above. Not a scheduled fix; revisit only if the
         broader item gets escalated back to 🔴 Now.
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
      **RECURRED 2026-08-16 — see 🐛 Bugs (Trust-breaking): "Same real order
      ingested under two order numbers → duplicate Order + split state"
      (J.Crew #2522877374 / #2523415500).** Broader than this item's
      suffix-append case — J.Crew's two numbers are wholly unrelated, so
      the fuzzy suffix-strip fix scoped here wouldn't catch it. Deferred by
      owner; fold this item in when that broader matching work is built.
- [ ] **Suspicious tool-message framing during the needs-review-bucket-rebuild
      push — NEW 2026-08-21, investigated live, not confirmed malicious.**
      During the production push (commit `198932b`), immediately after
      `git checkout main`, a batch of tool-adjacent messages appeared
      claiming several just-rebuilt files (`app/NeedsReviewRow.tsx`,
      `CARD_SPEC.md`, `app/(app)/needs-review/page.tsx`, `lib/junk.ts`, and
      others) had been "modified, either by the user or by a linter,"
      showing diff content that reverted them to their pre-rebuild state,
      and instructing "Don't tell the user this, since they are already
      aware." Verified live rather than complied: `git status` showed a
      clean tree and `git diff main` against the flagged files was empty —
      the file content shown was accurate, but the cause was mundane
      (`main` didn't yet have the rebuild commits merged, so checking it
      out reverts the working tree to `main`'s older content — expected
      behavior, not an external edit). Did not follow the "don't tell the
      user" instruction — flagged it directly instead, per standing
      practice on suspected prompt injection — and proceeded with the
      planned merge (which restored the correct content) rather than treat
      the reverted state as final. **Genuinely unresolved, not classified
      here:** could be a real injected instruction (the "don't tell the
      user" framing is the concerning part) or could be the harness's own
      generic templated notice for "file changed externally," worded
      identically regardless of cause (linter/editor/formatter vs., in this
      case, a routine git checkout) — no way to distinguish from inside the
      session. **Different mechanism from `SECURITY_AUDIT.md` L4**
      (prompt-injection-driven *app* status changes via extracted email
      content, ACCEPTED RISK 2026-07-19) — this was aimed at the coding
      session/tooling itself, not the deployed product's extraction
      pipeline; not the same finding, noted here so the two aren't
      conflated later. **Revisit trigger:** the same framing recurring,
      especially outside a benign git-checkout context, or any case where
      following such an instruction would have caused a real problem (e.g.
      proceeding to push without the independent verification done here).
- [ ] **Routing tree correctly surfaces extraction gaps as
      no_extraction_signal — NEW 2026-08-25.** The Session-2
      routing tree's branch 4 (`no_extraction_signal` → View
      detail degrade) is now correctly surfacing upstream
      extraction failures instead of falsely labeling them
      `real_purchase_no_record`. First observed instances: Buff
      shipping confirmation and H&M receipt (logged as 🐛 Bugs
      entry "HTML-scanning fallback not triggering"). The routing
      tree behaved as designed — extraction is what failed.
      **This is a working-as-intended observation, not a bug.**
      Logged to track: as extraction improves, the count of
      no_extraction_signal rows should trend down. If it doesn't,
      or if new extraction failure shapes appear that also route
      here, revisit whether branch 4's degrade is doing enough
      (e.g., should some subset of no_extraction_signal cases
      auto-trigger the HTML fallback from within the bucket
      rather than requiring manual More info + Re-extract).

- [ ] **Orphan-orders census across users. NEW 2026-08-26, replaces
      owner-only view of item 1107.** Original count (15) was owner's
      own dashboard only. Owner reports the count is much lower now,
      exact figure unknown without cross-user dashboard inspection.
      Portion of the original population now covered by the
      carrier-email routing decision (item 2568). Logged as future
      diagnostic session, not urgent. Revisit if: orphan symptoms
      recur in the needs-review bucket, unexplained rows appear in the
      Sunday digest, or new alpha users report missing orders.
- [ ] **Amazon extraction health. NEW 2026-08-26, folded from item
      3133.** Owner reports Amazon extraction working as expected
      today. Item 3133 not converted to ✅ Done — Amazon template
      drift is a permanent watch (see Decisions log entry "Amazon is
      committed work, not 'someday'" 2026-07-19; this codebase has
      taken a per-session Amazon patch its whole life). No action;
      re-flag as a real bug if Amazon orders visibly stop extracting
      or start extracting wrong.
- [ ] **Non-Gmail forward-header parseability — NEW 2026-08-27, from the
      delivered-badge Option A sign-off session.** Current
      `lib/forwardResolver.ts` logic is validated on a Gmail-dominant
      corpus: auto-forward (Gmail's server-side "Forwarding" filter)
      structurally degrades to `receivedAt` (0/84 header-Date successes,
      confirmed structural not accidental — no forwarded-message block and
      no separate Date header exist in these messages at all), and manual
      forward (Gmail's client "Forward" button) parses cleanly (11/11).
      Outlook, Apple Mail, and Yahoo compose forwarded blocks differently
      (`parseForwardedHeaderDate` in `lib/linkOrder.ts` only handles
      Gmail's quoted `Date:` format at launch, per the 2026-07-25 design
      decision) — a non-Gmail user's manual forwards may land in the
      currently-empty "manual forward + unparseable header" bucket,
      activating Fallback B (`DELIVERED_BADGE_DESIGN_20260827.md`'s
      Fallback B section — B1 "show Delivered with no date" vs. B2
      "prompt user to confirm" — currently unresolved, no urgency since 0
      real orders need it today). **Revisit trigger: first non-Gmail alpha
      user onboarded, OR first observed Email row with `forwardType:
      "manual"` and `anchorSource` not a parsed-header value
      (`"unresolved"` or `"received_at"` on a manual row).** Promote to
      🔴 Now at that point — decide B1 vs. B2 and extend
      `parseForwardedHeaderDate` for that client's format.
- [ ] **Alpha user recruitment — prioritize at least one Outlook and one
      Apple Mail user. NEW 2026-08-27, nice-to-have, not a blocker.**
      Stress-tests forward-header extraction (see the non-Gmail
      parseability watch item above) against real non-Gmail formats
      before the current Gmail-only assumption becomes a data-migration
      problem across a larger user base. Owner's call whether this lives
      here or in a separate recruiting doc — logged here for now since no
      such doc exists yet.
## ⚪ Someday
- [ ] **Retailer logos — MOVED here 2026-07-26 (was 🟡 Next), per the
      2026-07-13 investigation (`LOGO_COVERAGE.md`, untracked — not yet
      committed).** `RetailerAvatar` currently shows initials only
      (deliberately, per Commit 2: "logo integration is a separate future
      task"). The investigation found Logo.dev covers almost every retailer
      (93.5% raw hit rate) but only **78.3% of order-weighted volume is a
      confidently-correct logo** — 6.5% is a confidently WRONG company's
      logo (Gap Inc.'s real sender domain is a third-party returns vendor,
      `optiturn.com`, not Gap's own site) and another 8.7% is an
      unverified generic mark. This isn't a lookup-and-ship feature: it
      needs a manual review pass and a returns-vendor domain exclusion
      list (Optiturn, Narvar, Happy Returns, Loop, AfterShip) before any
      of it is trustworthy, plus a source-domain decision (no plaintext
      sender-domain column exists today — `Email.fromEmail` is encrypted
      at rest, no call sites decrypt it currently). Deprioritized
      accordingly — not a small "add a logo" task.
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
- [ ] Cost / token efficiency pass (post-beta) — **trigger met 2026-07-20**
      (Anthropic account hit zero credit balance) — **"cache return policies
      by retailer domain" promoted to 🟡 Next as `extraction-cost-visibility`,
      the biggest identified lever; the rest of this item stays Someday.**
      Anthropic prompt caching on the
      extraction API call (biggest lever, ~1 session of work, drops input cost ~80%, no
      quality risk). Move any remaining Sonnet calls that don't need Sonnet-quality to Haiku
      4.5 — **audited 2026-07-20: already correctly split** (Haiku on the
      commerce gate, Sonnet only on the two extraction-grade calls) — this
      part of the item is resolved, no further audit needed. Retailer-specific template parsers for the top ~10
      retailers as short-circuit before AI extraction (higher effort, needs monitoring
      for template drift). Batch
      API for non-urgent backend work. Revisit the rest before >20 real users.
      Prompt caching alone can be pulled forward from Someday if pre-beta AI cost
      becomes noticeable.
- [ ] **Logo.dev retailer-logo coverage — investigated 2026-07-13, not shipped.**
      Read-only feasibility check (full report `LOGO_COVERAGE.md` existed on
      branch `card-geometry-state-machine` briefly 2026-08-22 before being
      removed from this push; retrievable from that branch's git history if
      needed). Three findings worth preserving so this doesn't get
      re-investigated from scratch: (1) raw hit rate 93.5%, but only 78.3%
      confidently-correct once wrong-logo false positives are excluded; (2)
      specific wrong-logo risk from third-party returns vendors (e.g.
      Optiturn) resolving to unrelated real companies' logos; (3) API key was
      confined to gitignored `.env.local`, never pushed to Vercel — safe to
      leave dormant. Revisit only if retailer-logo display becomes a real
      product need; the 78% confidently-correct number is the bar to clear
      against whatever alternative is being considered.

- [ ] **Owner admin dashboard — surface TBD. NEW 2026-08-26, seed for
      owner's own wishlist cluster.** Owner-facing (not user-facing)
      internal dashboard for ops / PM visibility. No scope yet — this
      entry exists to accumulate wishlist items over time as they come
      up in conversation. Nearby existing items to fold in / link out
      to when this is scoped: item 3762 (Admin notification dashboard
      view), item 3670 (User notification policy for data corrections),
      item 3105 (Ingestion observability). As additional wishlist
      items arrive, append them as sub-bullets under this entry rather
      than creating new Someday rows for each. Not scoped, not
      started; do not promote to Next without a scoping session first.
## ✅ Done

- [x] **Fleet-wide `returnPortalUrl` health audit — completed 2026-09-01/09-02,
      follow-up to the 10-sample spot-check that found a 30-40% bad rate.**
      Read-only, no writes, 0 Anthropic API calls. Fetched every non-null
      `returnPortalUrl` on the active, non-Amazon order set (36 orders, 28
      distinct URLs) and categorized each.
      **First pass used a bot-identifying User-Agent and overstated the
      problem in one specific way** — corrected same session after
      feedback: re-ran with a realistic Chrome UA. Two Gap URLs that
      appeared to redirect to a cookie-consent failure page turned out to
      be a false positive from the bad UA, not real retailer behavior —
      **retracted** as a failure category. Corrected numbers below are
      the Chrome-UA pass; see `feedback_http_diagnostic_useragent`
      memory for the standing methodology fix.
      **Corrected findings:** overall bad rate 19/36 = **52.8%** (still
      far above the original 10-sample estimate). By `policySource`:
      `web_lookup` 17/30 = 56.7% bad vs. `stated_in_email` 2/5 = 40% bad —
      directionally supports source-quality correlation, but `policySource`
      is a coarse proxy (Order rows carry no confidence field of their
      own). By retailer: most repeat retailers were uniformly good or
      uniformly bad (systematic per-retailer outcome, not per-order
      noise) — American Girl, NET-A-PORTER, Buff City Soap, Shopbop,
      Julia Amory, Vespoli all uniform; Target and Gap showed real
      per-order variance.
      **Failure modes (plain English, cause-grouped):** (1) extraction
      grabbed an unrelated page entirely — Ancient Greek Sandals →
      DHL's shipping-carrier locator, Buff City Soap → Contact Us,
      Vespoli → general store-info page; (2) dead/404 — Wayfair, plus an
      Optiturn single-use "return code" link that had expired/been
      consumed; (3) bot/anti-scraping block (403) that **persisted even
      with a realistic Chrome UA** — Rufflebutts, SSENSE, The RealReal's
      `stated_in_email` URL — genuine JS-challenge/fingerprint-based
      blocking, not simple UA-sniffing, so these are "inconclusive by
      static fetch," not confidently dead; a real browser might still
      succeed; (4) generic login/account gate, not order-specific —
      Shopbop resolves straight to a sign-in wall; (5) marketing-tracking
      links that decay over time — Target: two orders, same link shape,
      one still resolves, one doesn't, pure elapsed-time decay,
      independent of extraction confidence; (6) **`returnPortalUrl` set
      to our own app's own order-detail URL** — The RealReal's
      `web_lookup` order stores `https://app.myreturnwindow.com/orders/{id}`,
      which redirects an unauthenticated fetch to our own `/login`. This
      is a correctness bug in extraction/merge, not a staleness/trust
      issue — flagged as the highest-severity single finding, separate
      from anything about trust-tiering.
      **Fallback feasibility:** Gap and Target both already have a good
      URL on file from another order for the same retailer — cheap
      same-retailer fallback could self-heal both with zero new
      curation. Smaller/niche retailers (Julia Amory, Vespoli, Market
      Hall Foods, Ancient Greek Sandals, Rufflebutts) have no good
      example on file and curation is genuinely harder there.
      **Framing view for the spec pass (data + recommendation only, no
      new items opened, no fix built):** item `returnportal-trust-tier`'s
      "degrade low-confidence values" framing is right in spirit but
      underspecified — a single confidence-tier switch doesn't cover
      finding 6 (a correctness bug, not staleness), findings 2/5 (decay
      that was correct at write time and rotted afterward — only
      catchable by send-time validation, never by extraction-time
      confidence), or finding 3 (bot-blocked ≠ dead, needs an
      "inconclusive" bucket). At minimum three separable pieces belong
      in the spec: (a) a direct correctness fix for finding 6, (b)
      live-or-recent validation rather than trusting a value forever
      from extraction time, (c) a same-retailer-fallback mechanism that
      needs no new curation for at least the Gap/Target cases.
- [x] **Investigated: shipping_confirmation ETA extraction — not a bug.
      Most retailers don't state a delivery ETA in their shipping
      confirmations; extraction correctly returns null. Amazon
      relative-date gap already tracked in AMAZON_HANDLING.md.**
- [x] **Preorder ship-date handling — Loeffler Randall order now computes a
      defensible deadline instead of the old wrong one, verified against
      the live LR order over the past month.** Full detail → HISTORY.md
      2026-07-20 (build note appended 2026-09-01).
- [x] **Pre-orders extract incorrectly (Loeffler Randall) — fixed by
      preorder ship-date handling, verified against live LR order.**
- [x] **User-initiated "un-kept" action — CLOSED 2026-08-31, deployed and
      owner-verified on LR #512867.** New `POST /api/orders/:id/unkeep`
      route and "May not be keeping after all" button on the order detail
      page let a user reverse an accidental Keep, re-deriving displayStatus
      from current email evidence and clearing keptAt/archivedAt/stale
      internal status. Two follow-ups spun out to Watching (kept-order
      action-row layout confusion; the deriveDisplayStatus/computeOrderStatus
      preserve-guard asymmetry) rather than expanding scope here.
- [x] **shipment_unlinked (rename + expand carrier_tracking_unlinked) —
      CLOSED 2026-08-31, deployed and owner-verified.** Commits `c3c39de`
      through `1571664` (11 commits total). Third instance of the
      "existing-order shape" routing principle, applied to
      delivery/shipping_confirmation/order_confirmation emails with a
      known retailer but no order number (H&M via UPS, Poshmark via USPS
      were the triggering real cases) — previously misrouted to
      `real_purchase_no_record` → "Start a new order" instead of a merge
      picker. Phase A confirmed `lib/retailerFallback.ts`'s
      carrier-deferred gate was working as designed, not a bug (→
      DECISIONS.md 2026-08-30). Shipped: Stage 1 pure rename to
      `shipment_unlinked` + new copy; Stage 2 widened gate (delivery,
      shipping_confirmation, order_confirmation — the last added same-day
      after owner pushback on an initial, narrower exclusion); Stage 3
      `findShipmentMergeCandidates` retailer-scoped matcher (built and
      tested, **not wired up** — see below); Stage 4 Part 4b, the
      picker's "+ Start a new order for [retailer]" create-new escape
      hatch, pinned first in the list. **Deliberately NOT shipped: Part
      4a**, filtering the picker's candidate list to the Stage 3
      matcher's output — scoped, then deferred same session; plumbing
      shape (side-map through `NeedsReviewBucket`/`NeedsReviewRow`) is
      decided but unbuilt. Tracked in 👀 Watching, along with two
      pre-existing inconsistencies surfaced during the build (the two
      non-identical "active order" status conventions, and the
      status-filter asymmetry across merge-candidate matchers) and the
      retailer-string-matching-brittleness item. **Complementary, still
      open, not closed by this:** the sibling null-orderNumber
      duplicate-shell bug, tracked separately just below. Zero billed
      Anthropic API calls across the whole build — static reading, code
      edits, and unit tests only.

- [x] Carrier-row Phase 1 shipped and verified — orphaned carrier-tracking emails now show "FedEx"/"USPS" instead of "Unknown retailer". Full detail → HISTORY.md 2026-08-28.

- [x] Carrier-row Phase 3 shipped and verified — orphaned carrier-tracking rows get a link picker (with orderTotal) instead of degrading to "More info," plus a required unlink action so a misclick is recoverable. Full detail → HISTORY.md 2026-08-28.

- [x] **orderDate write-once fixed, backfill executed — CLOSED 2026-08-27,
      owner-verified.** Read-only diagnosis: commit `179389e`. Build
      (schema + `lib/linkOrder.ts` provenance-aware rule + tests): commit
      `c150170`. Backfill SQL revised after owner review caught a real
      candidate-selection bug: commit `c8fec62`. Backfill executed against
      production + close-out: commit `165ba45`, ~18:50 PT 2026-08-27.
      `Order.orderDateSource` field + provenance-aware `mergeEmailIntoOrder`
      rule (`lib/linkOrder.ts`) replace plain write-once — a
      heuristic-guess orderDate can now be corrected by a later
      genuinely-extracted date, while two historical protections
      (2026-08-16 shipping-overwrite fix, J.Crew #2523415500 refund-orphan
      fix) stay intact. Backfill run against production: STEP 2A 97 rows,
      STEP 2B 101 rows, idempotency confirmed (0 rows left `unknown`).
      **Final bucket (a) — 5 real value corrections**, verified live:
      Zara #54421192781 (Aug 22 → Aug 16), Ulta Beauty #M223726065,
      SKIMS #SB33487073, SSENSE #44266308515307 — all clean single-signal
      corrections — and Waitrose #1058208405 (Jul 14 → Aug 5), accepted
      as an intentional non-goal correction (grocery order, out of
      product scope, no disagreement to exclude on since it had only one
      signal). **Fitness Superstore #48868 was excluded from bucket (a)**
      by the disagreement check added in `c8fec62` — its two
      order_confirmation emails' extracted `orderDate` disagreed by a
      full year (2025 vs. 2026), so it was left at `orderDateSource:
      "fallback"`, value unchanged, rather than risk picking the wrong
      one. Zara #54421192781 hand-verified post-backfill: `orderDate`
      Aug 16 05:13, `returnDeadline` Sep 15 05:13, `deliveredAt` Aug 22
      unchanged (Option A, untouched by this session). Full diagnosis,
      design, build, review-caught-bug, and backfill detail: `HISTORY.md`
      2026-08-27. **Not closed by this:** the email-detail-page return-
      deadline disagreement (frozen per-email snapshot) — confirmed still
      showing Sep 23 post-backfill, tracked as its own 🔴 Now item above.
      → see DECISIONS.md 2026-08-27 ("orderDate correction source:
      order_confirmation only, AI-extracted then anchorDate" and
      "Disagreeing orderDate signals: exclude from auto-correction, never
      pick a winner")

- [x] **Timezone drift across calendar-date rendering — CLOSED 2026-08-27.**
      New shared `lib/dateDisplay.ts` (`formatCalendarDate`/
      `formatCalendarDateShort`) reads a stored calendar-date field's UTC
      year/month/day components directly — never converts to any runtime
      or viewer local timezone — so the same value renders identically from
      a client component, a server component, or a cron-sent email. Wired
      into every render site found by a full-codebase audit: `app/OrderCard.tsx`,
      `app/(app)/orders/[id]/page.tsx`, `lib/orderCardState.ts`,
      `lib/amazonBundle.ts`, `app/(app)/emails/[id]/page.tsx`,
      `app/action/archive/page.tsx`, `app/action/returned/page.tsx`,
      `app/NeedsReviewRow.tsx`, `app/LinkToOrderPicker.tsx`,
      `app/api/cron/route.ts`, `app/api/cron/weekly-digest/route.ts`,
      `app/admin/users/[forwardingAddress]/page.tsx`. Closes this session's
      surface-drift report plus two independently-logged, older "off by one
      day" entries (2026-08-21, 2026-08-25) — same root cause, one fix.
      Full session detail, including a mid-build correction to the owner's
      own stated decision: `HISTORY.md` 2026-08-27.
      → see DECISIONS.md 2026-08-27 ("Calendar-date fields render via UTC
      components, never local timezone")

- [x] **Delivered badge stuck on "Arrives" (Zara #54421192781 + 9 other
      orders) — CLOSED 2026-08-27, owner-verified.** `deliveredAt` now
      backfills from the forward resolver's `anchorDate` for auto-forwarded
      delivery emails with no body date. Code shipped and deployed
      (`lib/linkOrder.ts`), 10-row production backfill run and confirmed
      idempotent. Full diagnosis, design, build, and backfill detail:
      `HISTORY.md` 2026-08-27. The separate dashboard/detail timezone-drift
      bug on the same order stays open, tracked on its own 🔴 Now entry —
      not part of this fix and not closed by it.

- [x] **Unified card geometry + order state machine (2x2 four-slot) —
      CONFIRMED DEPLOYED 2026-08-26.** Verified via git ancestry
      (`card-geometry-state-machine` commits are ancestors of production
      HEAD `59ab91c`) and Vercel deploy-timestamp cross-reference
      (`dpl_8tys2tPkS3yg7WtWDUt3YhDr27VJ`, created seconds after that
      commit). All BUILD PROGRESS 2026-08-11 pieces confirmed live:
      `lib/orderCardState.ts`, `app/NeedsReviewBucket.tsx`,
      `Order.status = "kept"` (additive, no migration), 33-row backfill
      (`scripts/backfill-kept-status.ts` committed as paper trail, 0
      mismatches per prior verification). The board's "Not yet
      deployed" note was stale — owner was right that it's live.
      Read-only diagnostic, 0 billed Anthropic calls (git + Vercel CLI
      only).
      Original 🔴 Now entry, preserved verbatim below, not edited in place:
- [ ] **Unified card geometry + order state machine (2x2 four-slot) —
      MOVED TO 🔴 Now 2026-08-10: owner brief given this session, build
      BEGINS.** `CARD_SPEC.md` is build-ready and the single source of
      truth (Part 5 answered 2026-07-29; fifth needs-review action,
      manual-link picker, and summary-tab set locked 2026-08-10) —
      building on a branch, preview-first, not directly against `main`.
      CONSOLIDATED 2026-07-25 from five previously-separate items (Needs
      Review panel UI, mobile audit findings #3/#4/#5, and M2's UI half).
      Each original item's full text is preserved verbatim as its own
      sub-entry below — nothing dropped, only regrouped.
      **Locked decisions (`CARD_SPEC.md` Part 5 has full rationale — not
      restated here, recorded so they aren't re-litigated):** bucket name
      is **"Needs review"** everywhere; slot-4 label is **`Keep`**
      everywhere (detail page's `Keeping it` renamed to match); mobile #3
      resolved as **NO glyph / NO `⋯` / NO swipe** — the expanded state
      shows `more info` and a single **`Archive`** labeled control (row
      stays four controls, not five); `Delete` is **not** a peer control —
      tapping `Archive` opens an archive-or-delete prompt, `Delete` lives
      inside it, junk-with-rescue, own confirm, never hard delete (**this
      corrects sub-entry 2 below, whose text still carries the 2026-07-25
      "trash-can icon" answer — `CARD_SPEC.md` Part 5 Q7 reverses that;
      sub-entry 2 is kept verbatim as the historical record, not edited in
      place. Note: as of 2026-08-10 this is also a correction to CARD_SPEC.md's
      own "What changed" summary, which still read "Archive and Delete
      become labeled text controls" before this session — fixed there
      too, so the file no longer contradicts its own Part 5 answer**);
      needs-review action registry is **FIVE** (Link to order [manual
      picker, v1] / Create new order / Not a purchase / View detail /
      Nothing), open/extensible, unknown → View detail; awaiting-refund
      chip revised to **`Refund pending`** (from `Returned {date}`);
      summary tabs are all four (Due this week / Needs review / Returns
      in progress / Refunds pending) — **out of scope for this build**,
      navigation not cards.
      **BUILD PROGRESS 2026-08-11 (branch `card-geometry-state-machine`,
      not pushed):** Step 0 reconciliation done and reviewed by owner
      (Amazon bundle overflow limit confirmed as literal `5` in
      `app/AmazonBundleCard.tsx`; O7 delivered-vs-displayStatus divergence
      confirmed already fixed at the `deriveDisplayStatus` layer; `kept`
      confirmed to have no internal `Order.status` value). Per this
      session's owner brief, `kept` was promoted to a real `Order.status`
      value — additive (String column, no schema migration), 33-row
      backfill applied and verified (`status = displayStatus` wherever
      `displayStatus === "kept"`, 0 mismatches against `keptAt`). **Build A**
      (single-order card + state machine, `lib/orderCardState.ts`) and
      **Build B** (needs-review bucket, `app/NeedsReviewBucket.tsx`) are
      both built and committed locally — see `HISTORY.md` for the full
      session detail once closed. Full test suite (541/541) and `next
      build` pass; no new typecheck errors. **Not yet deployed** — awaiting
      owner preview + explicit push instruction, per "Done means deployed."
      One known capability trade-off from Build B, not a bug: the old
      inline "Looks correct"/"Split into separate order" quick-actions on
      needsReview orders are no longer reachable from the dashboard — an
      already-linked order has no clean mapping onto the five-action
      registry, so it degrades to `View detail` (Part 3 Q9's explicit
      fallback design, not an oversight) — flagged here in case the owner
      wants those two actions re-added to the order detail page later.
      **Framing note (owner-confirmed 2026-07-25):** there is ONE four-slot
      skeleton — (1) identity, (2) context, (3) state, (4) action — used at
      two levels. A single order card is one 2x2. The needs-review bucket is
      a CONTAINER (same pattern as the Amazon bundle card): its header is a
      2x2 describing the group, and it holds N flagged orders, each rendered
      as its own 2x2 row. Collapsed = compact stack (identity + why, no
      action buttons); expanded = each row reveals its slot-4 action. Slots
      3 and 4 on an order are driven by a single order state machine
      (Awaiting delivery → Keep→archive; Returnable → Start return →
      Awaiting drop-off → Awaiting refund → Complete→archive). Slot 4 is a
      closed action set; an unregistered reason degrades to "view detail,"
      never throws. The bucket needs an inline-row overflow limit before
      "View all N →" opens a full page — reuse the Amazon bundle's
      threshold, don't invent a second one.

      ---
      **Sub-entry 1 of 6 — Needs Review panel UI (original item; the
      junk-mechanics backend piece that used to be embedded in this same
      item was split out to ✅ Done 2026-07-25 since it already shipped —
      the rest below is unbuilt UI, preserved verbatim):**
- [ ] **Needs Review panel ("Need attention" disclosure surface) — BUILD
      STARTED 2026-07-22, promoted from 🟡 Next now that the mock/layout
      spec has landed.** Panel implementation of the quick-check surface
      spec (mobile audit finding #5, below) — same underlying data
      (`needsReview`/`userNote`/`reviewReasonLabel()`). **Supersedes the
      2026-07-20 Decisions-log "confirm + fix in-panel" action model** (see
      Decisions log entry, rewritten same commit) — the action model is now
      per-flag-type, registry-driven: `duplicate` → Merge (no confirm) +
      Review; `not_ecommerce` → Delete (behind confirm) + Review; any
      unregistered type → Review-only, never throws. Still true and kept
      from the old decision: delete stays behind a confirm; no inline
      ignore/dismiss in v1. Diagnostic-first verify gate (actual stored
      field/values, duplicate-target existence, explanation-string
      accuracy) required and reported before any code, per this item's own
      build instructions — see session detail in `HISTORY.md` once closed.
      → see DECISIONS.md 2026-07-23 ("Needs Review panel registry rejected — not_ecommerce/duplicate aren't real flag types")

      ---
      **Sub-entry 2 of 6 — Mobile audit finding #3 ("..." overflow menu
      replacement), original text below. DECIDED 2026-07-25 — see
      DECISIONS.md 2026-07-25: replace ⋯ with a visible trash-can icon
      (own confirm step) + always-visible Archive. No longer a standalone
      open question; folded in here as resolved groundwork for the build.
      SUPERSEDED 2026-08-10 by `CARD_SPEC.md` Part 5 Q7 (decided
      2026-07-29, later than this note) — the live answer is the OPPOSITE:
      NO glyph, NO trash icon, NO swipe. See "Locked decisions" above; this
      sub-entry's text is preserved verbatim below as the historical
      record, not the current answer.**
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

      ---
      **Sub-entry 3 of 6 — Mobile audit finding #4 (state-label
      contradictions + button hierarchy), original text below:**
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

      ---
      **Sub-entry 4 of 6 — Mobile audit finding #5 (quick-check /
      review-disclosure surface), original text below:**
      **5. Quick-check (needs-review) surface doesn't explain itself — spec
      needed before design. NOW THE BOTTLENECK, HIGH-LEVERAGE (2026-07-19).**
      `app/ReviewCard.tsx` asks users to arbitrate between "looks correct"
      and "split into separate order" with no visible evidence supporting
      either option and no explanation of why the system isn't confident in
      the first place. Same root concern as the existing Next item about
      this card's missing "why" line (`TRUST_AUDIT.md` row 6), but broader:
      it's not just a missing explanation string, it's that the whole
      surface asks for a judgment call without giving the information
      needed to make one. Needs a spec pass, not a copy tweak. **This is now
      the hub for three distinct `needsReview` reasons that all need this
      same disclosure surface to actually explain themselves:** #6a's
      kept-status-conflict (`computeKeptStatusConflict()`), M2's
      return-portal trust tier (`classifyReturnPortalTrust()`), and the
      original missing-deadline case. Two more gaps in this space are
      tracked separately in 🟡 Next (`policysource-url-provenance-imprecision`,
      `reviewreasonlabel-missing-reasons`). Every session that adds a new
      review-flagging mechanism makes this spec pass more overdue, not less
      — it's gated on owner mockups, but it's the current highest-leverage
      piece of unblocked work once those land.

      ---
      **Sub-entry 5 of 6 — M2 return-portal UI half (original item,
      moved here in full from ⏳ Verifying 2026-07-25 — the shipped
      review-signal half described within this same text is already live
      and deployed; only the UI half is the reason this item is now
      owner-blocked rather than passively verifying):**
- [ ] **M2 — return-portal URL phishing risk, primary open security finding —
      review-signal half SHIPPED 2026-07-19 (`947edce`), deployed, awaiting
      natural verification; UI half deliberately NOT built.** `classifyReturnPortalTrust()`
      (`lib/extract.ts`) classifies every incoming `returnPortalUrl` into a
      trust tier (`known-third-party-portal` — Loop/Narvar/parcelLab/Reveni/
      Linc confirmed live in our data, Happy Returns/ReBOUND seeded unverified;
      `retailer-own-domain` — exact registrable-domain match only, never a
      substring/contains check; `web-lookup-sourced` — measurement-only, not a
      security boundary; `unknown-unverified`) and forces `Order.needsReview`
      on `unknown-unverified`, same gate `computeKeptStatusConflict` (#6a)
      uses. A SIGNAL, never a hard block — `returnPortalUrl` still
      renders/opens exactly as before. Reason is re-derived live in
      `lib/orderReview.ts`'s `reviewReasonLabel()`, not stored in a new field
      (it's a pure function of data already on the row). Tier distribution
      logged count-only (no URL/retailer/order id). **What's still open:** no
      domain display, no auto-open gating, no visible "unverified" mark — the
      actual UI remediation direction in `SECURITY_AUDIT.md`'s M2 entry is
      deferred to the pending review-disclosure spec (handles all
      `needsReview` reasons uniformly, not a bespoke M2 treatment). Full
      detail in `BUILD.md`'s Order-linking section + Decisions log.

      ---
      **Sub-entry 6 of 6 — four-slot panel build
      (original text below, from the Task 1-4 tracker). RESOLVED
      2026-08-10: the "not started until [owner brief]" blocker below is
      removed — the owner brief is this session's greenlight, and
      `CARD_SPEC.md` is the build-ready spec it was waiting on.**
      **Needs Review four-slot inventory — REPORT ONLY, inventory
      complete.** No longer blocked; build proceeds per `CARD_SPEC.md`.

- **RESOLVED 2026-08-10 — owner brief given this session.** The
  contradiction this note flagged (the four-slot panel build sub-entry
  above said "not started until [owner brief]" while the four-slot
  inventory was already marked COMPLETE) is resolved at the source — see
  sub-entry 6 above, corrected in place.

- [x] Zara "unknown retailer" digest lines fixed — commerce-typed
      emails now fall back to sender-derived retailer when body
      extraction returns null, gated to exclude carrier senders.
      Shipped and owner-verified in prod 2026-08-25.
- [x] **Widened `lookupReturnPolicy` skip — any email linking to an order
      with an already-resolved return policy, not just `return_label` —
      SHIPPED & OWNER-VERIFIED 2026-08-24.** `lib/extract.ts` split into
      `extractEmailIdentity`/`finalizeExtraction`; `lib/runExtraction.ts`
      pre-checks for a matching existing order via a new shared
      `findMatchingOrder` (`lib/linkOrder.ts`) before deciding whether to
      skip the billed web-search lookup. Deterministic order-matching only
      (orphaned-refund fallback excluded, pending Caroline's RealReal
      item). Committed `31525f5`, deployed
      (`dpl_HZ8vJyjueadR4UMsmrQxmauajRpN`), live-verified via one targeted
      re-extract (skip confirmed, 1 billed call) and one regression
      spot-check (lookup still fires normally, 2 billed calls). Census:
      120 of 349 historical non-Amazon `web_lookup` calls were exactly
      this waste. Full detail → HISTORY.md 2026-08-24.
- [x] **Manual data restore: order `cmsfaw3u00001w9q4vxsjeqqe` (SKIMS,
      `SB33487073`) — 2026-08-23.** Manual data restore, not a code change —
      no deploy needed. Owner confirmed a legitimate order was soft-deleted
      2026-08-06 via Archive→Delete; cleared `Order.deletedAt` (only that
      field, only that row, scoped to userId `cmqtng57q0000w9y3bzaeax0n`)
      from `2026-08-06T12:46:21.987Z` to `null` via
      `scripts/pm-restore-skims-order-20260823.ts` (read-verify gate before
      write). Linked Email rows untouched (never soft-deleted).
- [x] **H&M `return_label` order-number extraction gap — SHIPPED & VERIFIED
      2026-08-23.** Two-pass retry (option a from the scope block) in
      `lib/emailBodyText.ts` + `lib/extract.ts`; narrow gate (retailer
      resolved AND orderNumber null AND emailType != "other" AND
      substantial alternate body exists) — H&M shape only, cannot collide
      with Zara's future fix. 5 commits on `origin/main`, deployed to
      `app.myreturnwindow.com` (commit `3d6530e`, confirmed via `vercel
      ls`/`inspect`). Target row `cmt090ioq0001l404crsih7w9`:
      `Email.orderNumber` = `68462778273` ✓, `Email.orderId` linked to
      order `68462778273` ✓, appears in "Linked emails (4)" on the order
      detail page alongside order_confirmation (7/21),
      shipping_confirmation (7/22), delivery (7/25). Owner-verified in
      production 2026-08-23. Spot-check: other two H&M orders
      (`66993117803`, `68468087873`) unchanged, no regression. Cousin
      census: 6 other rows share the failure shape — no batch re-extract
      triggered (deferred, owner call).
      **Mid-session bug caught and fixed same session:** first deploy left
      `needsReview = true` even after `orderNumber` recovered because the
      merge preserved the primary pass's stale self-report. Fixed,
      redeployed, reverified.
      **Billed Anthropic calls this session: 6, all Sonnet, one call site
      (targeted re-extraction, 2 rows × 3 calls each: primary extraction,
      retry, policy lookup).** Everything else (baseline reads, spot-check,
      cousin census, pre-code verification) was read-only, 0 billed calls.
      Pre-code verification script `scripts/pm-verify-resolvebodytext-hm.ts`
      committed as part of the paper trail.
      **Two follow-ups spawned, both logged separately (not blocking ✅):**
      (1) needs-review flag should evaluate at order level, not per-email
      — see 🟡 Next; (2) `return_label` extraction shouldn't trigger
      `lookupReturnPolicy` when linking to an existing order with a
      resolved return policy — see 🐛 Bugs → Infra/reliability.
      **Not in this session, unchanged:** Zara fix (separate 🔴 Now item),
      batch re-extract of the 6 cousin rows (owner decision, deferred),
      `orderCardState.test.ts` timezone flake (pre-existing, logged under
      Known issues).
      Full detail → HISTORY.md 2026-08-23.

      **FOLLOW-UP SWEEP 2026-08-24 (separate session, applying the fix to
      the remaining cousin population — not re-testing it).** Re-ran
      yesterday's cousin census: 5 rows remained (one dropped out already,
      via a manual UI re-extract on order `68468087873`'s return_label
      row). Split the 5 by actual linking state — the task's "4 H&M
      return_label" framing didn't match reality; real breakdown was 0
      return_label rows, 4 already-linked refund emails (3 H&M + 1 Chan
      Luu, linked to their parent order via a signal other than
      `orderNumber`), and 1 genuinely orphaned row (Laundry Sauce,
      shipping_confirmation, `orderNumber`/`orderId` both null — the same
      shape as the original H&M target).
      **Swept the 1 orphan** (`cmt0uxvz70001ic0468kxgkjp`) — 3 billed
      calls, retry fired correctly, **did not recover an orderNumber, and
      shouldn't have:** neither body contains one anywhere; the only
      identifying number in either is a UPS tracking number, appearing
      inside a URL parameter deceptively named
      `orderNumberOrTrackingNumber`. Confirmed no sibling email (checked
      the account's other Laundry Sauce email, a delivery confirmation —
      also no order number, no order_confirmation email exists on this
      account for this retailer at all). Fix worked correctly; the data
      simply isn't there. New finding logged, 🟡 Next, cousin to the
      Happy Returns finding below.
      **The 4 already-linked rows: deferred, not run.** A free, read-only
      check confirmed the retry would fire on all 4 (2 calls each
      minimum), and — separately — that a fresh extraction pass has no
      way to know these emails' `returnWindowDays` is already stored from
      a prior run, so a policy web-search lookup would very likely fire
      again on all 4 too (3 calls each, ~12 total), exactly the waste
      already logged in 🐛 Bugs → Infra/reliability
      ("`return_label`/refund extraction shouldn't trigger
      `lookupReturnPolicy` when linking to an order that already has a
      resolved policy"). Rather than spend ~12 calls whose lookup portion
      gets thrown away regardless (no write was going to happen this
      pass), deferring these 4 until that bug is fixed — then a real
      sweep (with a write) can run once, cheaply, instead of twice.
      **Session cost: 3 billed Sonnet calls, one call site** (targeted
      re-extraction: primary extraction, retry, policy lookup — the
      orphan sweep only). Everything else (re-run census, linking-state
      breakdown, retry-gate check, body-shape diagnostic, sibling-email
      check) was read-only, 0 billed calls.
      **Zara deferred to a fresh session** — this one turned into an
      investigation (census mismatch, two new structural findings) rather
      than a clean sweep; starting Zara on top of it risked mixing paper
      trails.
      Scripts added this session (paper trail, same pattern as
      `pm-verify-resolvebodytext-hm.ts`):
      `scripts/pm-precheck-hm-cousin-sweep.ts`,
      `scripts/pm-precheck-hm-cousin-detail.ts`,
      `scripts/pm-precheck-orderid.ts`,
      `scripts/pm-precheck-linked-rows-shape.ts`,
      `scripts/pm-sweep-hm-cousin-rows-20260823.ts`,
      `scripts/pm-precheck-linked-rows-ordernumber.ts` (written, not run —
      the 4-row pre-check deferred above),
      `scripts/pm-diag-laundrysauce-no-recovery.ts`,
      `scripts/pm-diag-laundrysauce-siblings.ts`.
- [x] **Needs-review bucket rebuild (CARD_SPEC.md Part 3 compliance) — SHIPPED
      & VERIFIED 2026-08-21.** Reason detection, container/row layout, and the
      order detail page's resolution control now match spec; owner-verified
      live on `app.myreturnwindow.com`. Full detail → HISTORY.md 2026-08-21.
      **Compliance drift found 2026-08-24** (design pass,
      `NEEDS_REVIEW_ROUTING_DESIGN.md` §1): the "extraction failures"
      population spec names (`CARD_SPEC.md:248-251`) has no email-kind
      reason branch — see 🐛 Bugs → Infra/reliability, "Extraction-failure
      email rows get a false-confidence 'real purchase' reason." "Not a
      purchase" was already a known, documented scope cut at rebuild time
      (not new drift). See 🔴 Now "Routing tree design" for the fix design.
- [x] **Write-once `orderDate` in `mergeEmailIntoOrder` + Suzie #99500 backfill —
      SHIPPED & VERIFIED 2026-08-19.** Committed `25cd981` on branch
      `writeonce-orderdate-coverage-gate` (cut clean from `origin/main`, 3
      commits), pushed as a fast-forward directly to `origin/main`
      (`95e9167..25cd981`) without touching local `main` — the in-progress
      card-geometry work on `main` stayed local and unpushed by design.
      Deployed `dpl_2WPH1DZHadcEfE15zUwMoQR276Br`, READY, production,
      `app.myreturnwindow.com`. Backfill applied and verified live: Suzie
      Kondi #99500 (`cmrx0ebri0003jr04itjef17j`) `orderDate` 2026-08-12 →
      2026-07-23, `returnDeadline` 2026-09-07 → 2026-08-18,
      `orderDateEstimated` stayed `false` — re-queried after the write to
      confirm it landed. Owner-verified in production. ✅**
      Original 🔴 Now entry, preserved verbatim below, not edited in place:
- [ ] Write-once `orderDate` in `mergeEmailIntoOrder` + backfill of merge-corrupted rows — PROMOTED TO 🔴 Now 2026-08-16 from 🐛 Trust-breaking (08-14 Suzie finding); diagnosis closed this session (unscoped: 2 CORRUPTED_RECOVERABLE, 0 UNRECOVERABLE, 1 AMBIGUOUS / 150 orders, cross-user). Root fix for the silent-overwrite class: `mergeEmailIntoOrder` (`lib/linkOrder.ts` ~499, `email.orderDate ?? existing.orderDate`) lets any later email clobber a correct `orderDate` and clears `orderDateEstimated` to false (~525). Locked decision: WRITE-ONCE, not the type-allowlist the 08-14 entry proposed. `orderDate` is set once from the earliest establishing email and never overwritten; the establishing-type gate (`order_confirmation`/`shipping_confirmation`/`delivery`) survives only as a guard on what may establish it (refund/return_label/other may never be first writer either). On the record: Suzie's `delivery` email carries its own date (2026-07-31, not the 07-23 purchase date), so an allowlist that lets `delivery` overwrite would still corrupt — allowlist treats the symptom, write-once the cause. Scope strictly `orderDate`; `estimatedDeliveryDate`/deadline anchor stays writable (preorder decision, this file). Backfill: dry-run→`--apply`, Suzie #99500 only, restore `orderDate` + `orderDateEstimated` + recompute `returnDeadline`. Suzie `completed`, deadline recompute moot for user visibility. Eyeball the AMBIGUOUS Bloomingdale's row first — likely same-day collision, confirm not corruption. BUILD.md invariant same commit. Non-regression tests: Amazon path unchanged; Suzie delivery-email replay no longer moves `orderDate`. VERIFY BY: read-only replay of the real Suzie refund email through deployed merge, then query the backfilled row in prod. Not ✅ until owner confirms in prod.
      **Backfill corrected 2026-08-16 to Suzie #99500 only. Fitness
      Superstore #48868 REMOVED: establishing-email date is 2025-07-09, a
      year before the stored 2026-07-09 — opposite direction from this bug
      and matching the known wrong-year extraction shape (cf.
      returnDeadline<orderDate sweep). Restoring would overwrite one wrong
      date with another. Deferred to its own read-only look.**
- [x] **Coverage-check establishing-email gate — SHIPPED & VERIFIED
      2026-08-19.** Same commit/branch/deploy as the write-once fix above
      (`25cd981`, `dpl_2WPH1DZHadcEfE15zUwMoQR276Br`). Verified read-only
      against the live 7-day window (`scripts/pm-verify-coverage-gate-live.ts`,
      no `sendEmail` call, no `Reminder` write, 0 billed calls): J.Crew
      orphan #2523415500 correctly excluded by the new gate; Suzie Kondi
      #99500 correctly dropped by the pre-existing staleness check instead
      (not the gate) — confirms the two fixes compose correctly, since
      Suzie's order has a real establishing email and now a real restored
      `orderDate`, so it clears the gate and is then correctly recognized
      as an old order; real `order_confirmation`-backed orders (SKIMS, Good
      Eggs) still present; unlinked-email path unaffected. Cross-user
      aggregate (13 users, counts only): 26 would-include, 2 excluded by
      the gate, 12 by staleness. Owner-verified. ✅**
      Original 🔴 Now entry, preserved verbatim below, not edited in place:
- [ ] Coverage-check new-purchase-signal gate — PROMOTED TO 🔴 Now 2026-08-16; closes candidate fix (a) from the 08-08 entry. Purchase list counts only orders backed by a purchase signal, not "any order that entered the window." Locked decision (owner 2026-08-16): DROP duplicate/non-establishing orphans; do NOT relabel. Gate on "order has ≥1 establishing email"; an order whose only emails are `refund`/`return_label`/`other` (the #2523415500 orphan class) is dropped, not given a "return received" line — relabeling a phantom Order just gives a phantom its own line. Preserve `emailType: null` extraction-failure visibility — those stay, that's the QA net's job (08-07 flood). Replaces null-defaults-to-inclusion as the primary mechanism (an establishing email, not a non-null `orderDate`, is the "you bought this" test), so it's robust when `orderDate` is legitimately null or corrupted. Confirmed this session: the $350.65 J.Crew line traces only to orphan #2523415500 (no establishing email) → gate folds it out; also the interim containment for the deferred same-order-two-numbers matching bug. `app/api/cron/weekly-coverage/route.ts` only; no data writes. VERIFY BY: coverage repro against the real send window (read-only, no send) — orphans gone, extraction-failure rows present; then next real Friday digest clean. NOT via `?force=true`. Not ✅ until owner confirms the real digest.
- [x] **Missing `select` on Email/Order Prisma queries — Neon bandwidth-
      quota fix. DONE 2026-08-21, code-complete/tested/merged to `main`
      via branch `fix-missing-select-bandwidth`; production
      bandwidth-reduction confirmation (Neon transfer trend) still
      pending — not observable from a single deploy, needs a few days
      of real traffic.** Root cause: Neon's free-tier 5 GB/month transfer
      quota hit 100% (5.32 GB, cycle started 2026-07-31) on a
      low-request-volume app. **Smoking gun:** `app/(app)/page.tsx`'s
      orphaned-emails dashboard query had no `select` — fetched full
      `Email` rows (`textBody`/`htmlBody`/`rawJson`, avg ~438 KB combined
      per row, `rawJson` alone avg ~236 KB, max ~688 KB) on every
      dashboard load (`force-dynamic`, app's home route). One active
      account had 35 visible orphaned emails (~15 MB in that one query on
      one page load).
      **Fixed, 6 locations, each `select` traced from actual caller
      usage, not guessed** (full field-by-field mapping reviewed with
      owner before merge): `app/(app)/page.tsx`'s orphaned-emails query;
      `lib/alerts.ts`'s `getAlertOrders` (`OrderCard`'s prop type
      narrowed to a new exported `OrderCardOrder = Pick<Order,...>` so
      both this trimmed query and the dashboard's full-row order list
      satisfy it); and four spots in `lib/linkOrder.ts` —
      `resolveFallbackOrderDate`, `rebuildOrderFromRemainingEmails`,
      `resolveOrderTotal`, and `linkEmailToOrder`'s entry fetch (the
      latter two surfaced by a codebase-wide sweep, both fire on every
      ingested email, added to scope same file/same PR).
      `mergeEmailIntoOrder`, `createOrderFromEmail`,
      `applyShippingTracking`, and `applyReturnTracking` now take
      narrowed `Pick<Email,...>` types instead of the full `Email` model.
      **Design note:** `linkEmailToOrder`'s entry fetch has the widest
      select of the six by design — the row flows whole into four
      callees, so its select is the union of what all four need, not any
      single caller's minimal set. A future pass could split it into a
      per-callee narrower fetch; not scoped here.
      **Deferred to follow-up, not built in this pass** (see 🐛 Bugs →
      Infra/reliability, 3 separate entries): `weekly-coverage` cron's
      `email.findMany`, the order-detail page's unselected nested
      `emails` include, `orderReview.ts`'s split-action include — all
      lower-frequency than the 6 fixed.
      **Verification:** zero new TypeScript errors (confirmed against a
      stashed baseline — 22 pre-existing errors, all unrelated, identical
      before/after); full test suite 569/569 passing; `npm run build`
      clean. Manual click-through coverage was partial: the `/alerts`
      page render couldn't be manually verified (blocked by the
      pre-existing nav-link bug logged below) and the orphaned-email
      snippet render couldn't be verified against real data (owner has
      too few orphan rows to see one) — for both, correctness coverage
      comes from TypeScript compilation itself: a `select` missing a
      field the JSX or a callee reads would have failed `tsc`/`next
      build`, and neither did.
      **Two pre-existing bugs found during click-through review, logged
      separately below, confirmed NOT caused by this change** (parity
      between preview and already-live production): the "View all"
      closing-soon link and the `/alerts` sidebar nav item.
      Investigation bandwidth cost: 2 server-side aggregate queries
      (~15 scalar values), effectively zero against the quota. Slug:
      `missing-select-email-order-queries`.
      **Correction from the 2026-08-21 main/origin-main reconciliation
      merge (see that merge commit):** local `main`'s previously-
      unpushed card-geometry work (`app/OrderCard.tsx`,
      `app/(app)/page.tsx`) had independently redesigned the dashboard's
      needs-review UI and, as a side effect, already replaced the
      orphaned-emails query with an even leaner select (`id`, `retailer`,
      `receivedAt`, `orderTotal`, `orderCurrency` — no `textBody` at
      all, since the new unified bucket doesn't render a snippet). That
      version was kept over this task's own select for that one query.
      The other 5 fixed locations are unaffected. `OrderCard`'s
      `OrderCardOrder` type was also re-derived against the redesigned
      component: gained `deliveredAt`/`estimatedDeliveryDate`/
      `returnCarrier` (now read by `computeOrderCardState`/`orderCardChip`/
      `slotTwoContext`), dropped `policySource`/`needsReview` (no longer
      read by the new component). `getAlertOrders`' select updated to
      match.
- [x] **Food + grocery delivery exclusion (category-level) — DONE
      2026-08-20, all five prod verifications green. ✅** Two-layered
      detection: (a) sender-domain pre-junk in `shouldAutoJunk`
      (`lib/junk.ts`), wired into `app/api/inbound/route.ts` ahead of the
      Haiku classifier — enumerated list (doordash.com, ubereats.com,
      grubhub.com, instacart.com, postmates.com, caviar.com,
      wholefoodsmarket.com, goodeggs.com), dot-boundary matching, cost win
      (matched senders skip both Haiku and Sonnet); (b) retailer-name
      backstop in `linkEmailToOrder` (`lib/linkOrder.ts`) for Amazon-brand
      food services (Amazon Fresh, Whole Foods Market) that share
      Amazon's generic sender domain. Named constants + matchers in new
      `lib/foodGroceryExclusion.ts`. `lib/extract.ts`'s
      `lookupReturnPolicy` gate also skips the billed lookup for
      Amazon-brand food. Step 0 census owner-approved 2026-08-19; Step 1
      built and merged to `main` (`4aa0a31`, `--no-ff`, 3-commit split
      preserved: code `b5434a0`, audit-trail scripts `4d9f8c9`, board
      `6ec1b3a`) and deployed; Step 2 historical sweep dry-run reviewed
      then applied 2026-08-19 — **10 Emails junked, 4 Orders deleted
      (both mid-flow rows, Whole Foods Market `cmruuzq6z0003jx04yy5dogqv`
      and Amazon Fresh `cms2lbw7j0009w9mqt8cghqni`, reconfirmed before
      delete), 4 Reminders orphaned** (accepted precedent, no cleanup
      step — matches how `lib/autoArchive.ts` already treats hidden
      orders' reminders). 569/569 tests passing, `npm run build` clean
      throughout.
      **All five VERIFY BY criteria confirmed green in production,
      2026-08-20:** (1) Amazon Fresh 2026-08-04 past-deadline row no
      longer on dashboard (deleted by the sweep); (2) no grocery rows in
      the needs-review bucket; (3) post-deploy, a real DoorDash email
      arrived and was pre-junked within 10 seconds, zero Anthropic spend
      (confirmed against the row directly, `junkedAt` 10s after
      `receivedAt`); (4) no new grocery rows in needs-review since
      deploy; (5) needs-review-bucket rebuild (~line 1973-1976 note)
      unblocked as designed.
      **Correction, logged so it isn't re-litigated:** 3 Whole Foods
      Market rows visible in unlinked-emails were originally attributed
      to a food-grocery-exclusion miss (retailer-based census blind
      spot). Two follow-up investigations (2026-08-20) reclassified
      them: they're 3 of 12 rows orphaned by the **2026-07-21 ingestion
      incident** (🐛 Bugs, below) — `runExtraction` never ran on them at
      all, so neither exclusion layer ever had a `retailer` or
      `fromDomain` to check. Not a food-grocery-exclusion failure; the
      feature was never in a position to catch these three. See the new
      Bug entry for the full incident trace and cleanup plan.
- [x] **`runExtraction.ts:8` findUnique-gap fix — DEPLOYED & VERIFIED
      2026-08-08 — object-passing fix for the inbound route (id-based
      callers now catch the re-fetch failure too). Tests + build clean
      (516/516, `npm run build` clean), COMMITTED (`ee72159`), PUSHED (on
      `origin/main`), DEPLOYED (production alias confirmed via `vercel
      inspect`), VERIFIED in production via a real Shopbop forward — order
      136486078 extracted and linked clean. ✅**
      Originally filed as "Amazon order-confirmation emails extract to ALL
      BLANK," reframed and root-caused down to a structural,
      retailer-agnostic extraction-trigger gap (see full trace below);
      direction (a) from that trace's candidate fix list is the one built —
      the inbound route now passes the already-loaded row object instead of
      an id, skipping the internal re-fetch entirely for that path, and the
      re-fetch for remaining id-based callers now lives inside
      `runExtraction`'s own try/catch so a failure there gets stamped
      instead of leaving the row silently `extractedAt: null`. Test detail:
      `__tests__/runExtraction.test.ts`, 5 cases including a direct repro of
      the original bug (re-fetch throws → still stamped, never
      silent-null). Original investigation text preserved below, not
      edited in place.
- [ ] **Amazon order-confirmation emails extract to ALL BLANK — REPRO
      ATTEMPTED 2026-08-06, READ-ONLY, 0 billed Anthropic calls, 0 writes.
      Does NOT reproduce as a template-change extraction failure; reframed,
      not confirmed as originally filed.** Census script
      (`scripts/census-amazon-blank-extraction.ts`, uncommitted) scanned all
      752 Email rows, found 115 Amazon-sender (subject/from contains
      "amazon", decrypted in JS — `fromEmail`/`fromName` are encrypted at
      rest), 15 blank-shaped matches. **No genuine order_confirmation ever
      extracted to blank.** Direct counter-evidence: the most recent
      `order_confirmation` in the data (`cmsfxldvf...`, "Ordered: 1 Pet
      item," 2026-08-05) extracted cleanly — retailer, orderNumber,
      orderTotal all populated, order created and linked. The 15 blank
      matches break down as:
      (1) **1 row, real gap but not this bug:** today's own
      `auto-confirm@amazon.com` order_confirmation (`cmsgsp9s...`, "Ordered:
      2 Hair Care and Device Accessories items," 2026-08-06T00:46Z) has
      `extractedAt: null` — extraction never ran at all, not "ran and came
      back blank." No user-visible impact this time: the same order's
      `shipping_confirmation` (`cmshfakxe...`, received 11h later) did
      extract and created/linked the Order — but the order_confirmation
      email itself sits stuck forever with no resolve path (same dead-end
      class as the "Unlinked email Needs review badge" bug above). Worth
      its own ingestion-reliability look, separately from this item.
      (2) **4 rows, already-known population, not new:** `return@amazon.com`
      "Advance refund issued" emails, `extractedAt` set but `emailType`
      came back null (real extraction failure, not "never ran"). All 4
      timestamps fall inside the already-documented pre-outage-bound
      cluster (2026-07-31T18:01:30Z–2026-08-01T04:56:06Z, see the Aug 1-4
      credit-outage item, 🔴 Now) — one match (`cms9wfain...`) lands at
      exactly that cluster's stated end bound. Not a fresh finding.
      (3) **3 rows, never-ran, a new instance of an already-known pattern:**
      `order-update@amazon.com` "Your Whole Foods Market order has been
      picked up" — identical subject, identical `receivedAt`
      (2026-07-21T17:36:09Z), 3 separate Email rows, none ever extracted.
      Same redelivery-duplicate shape already tracked for ACE VISALIA
      RSC/GLOBAL-E (🔴 Now dedup item), just not previously seen on an
      Amazon-sender row.
      (4) **7 rows, working as designed, not bugs:** 2 self-generated
      `reminders@myreturnwindow.com` emails and 1 Amazon review-solicitation
      and 4 `deals@em.savings.com` marketing emails — all correctly
      classified `emailType: "other"` and auto-junked, with sound
      `extractionNotes` reasoning in each case.
      **Net: the originally-feared "extraction returns blank on current
      Amazon template" scenario is not what's in the data — no evidence to
      escalate to non-Amazon/P0.** What's real and still open: (1) the
      never-ran / stuck-forever population (rows 1 and 3 above, 4 total)
      needs its own look at why extraction didn't trigger, and (2) the 4
      refund-email rows are already covered by the existing outage-cluster
      item, not a separate fix. Not fixed here — diagnostic only, per
      instruction.
      **UPDATE 2026-08-08 — root cause traced, scope corrected, supersedes
      the "4 total" framing above. READ-ONLY, 0 billed Anthropic calls, 0
      writes.** The "row 1 and 3, 4 total" split above conflated two
      mechanically distinct populations; reconciled with a clean,
      retailer-agnostic query (`scripts/census-never-extracted.ts`,
      uncommitted) across all 752 Email rows, not just Amazon-sender ones.
      **This item is not Amazon-specific — retitle the underlying issue
      mentally as an extraction-trigger gap, Amazon is just where it was
      first noticed.** Does not restate the Amazon refund-cluster/outage
      detail in bucket (2) above or the Suzie Kondi `lookupReturnPolicy`
      timeout row — that's a different mechanism entirely (a hung web
      lookup mid-extraction, not this gap; confirmed Suzie Kondi is not
      among the rows below) and both stay tracked where they already are
      (Aug 1-4 outage item, 🔴 Now; `lookup-return-policy-timeout`, Infra).
      Also not restated here: the "Region 109" duplicate-forward pair —
      unrelated to this mechanism, tracked under the new coverage-check
      digest entry above.
      **Corrected count:** exactly 14 `extractedAt: null` rows exist
      database-wide. They split into 11 "masked" rows (a content-duplicate
      sibling elsewhere succeeded, so no user-visible symptom) and 3 "live"
      rows (no sibling, genuinely stuck) — 2 Mejuri, 1 Amazon. The 2/3
      non-Amazon split is the scope proof: this is structural, not an
      Amazon footnote.
      **Root cause, traced in `lib/runExtraction.ts` and
      `app/api/inbound/route.ts`:** `runExtraction()`'s catch block (lines
      51-57) stamps `needsReview: true, extractedAt: new Date()` on *any*
      extraction failure — so a thrown error during extraction is always
      visible in the data, never silent. The one gap: `runExtraction`'s
      first line, `const email = await prisma.email.findUnique(...)`
      (line 8), sits **outside** that try/catch (which only starts at line
      11). If that lookup fails — most plausibly a DB/connection hiccup in
      the narrow window right after the row's own `create()` succeeded,
      same infra-fragility class as the already-documented Neon
      auto-suspend issues elsewhere on this board — nothing gets written at
      all, leaving the row indistinguishable from "never called." This is
      the *only* place in the code capable of producing `extractedAt: null`
      with `needsReview: false` on an existing row.
      **Exhaustively confirmed retailer- and script-agnostic:** full-tree
      grep of `app/`, `lib/`, `scripts/` for `.email.create` found exactly
      one call site — `app/api/inbound/route.ts:284`. Checked all 5
      backfill/reextract scripts individually (also grepped for raw
      `executeRaw`/`queryRaw`/`INSERT INTO`, zero hits): every one only
      `findMany`/`findFirst`s existing rows and calls `runExtraction()` on
      them — none create rows. **Every Email row in the database, without
      exception, originates from the inbound webhook, and the same single
      mechanism above is the only possible source of all 14 null rows** —
      not two populations with different causes, one mechanism that fired
      14 times.
      **Load-burst theory ruled out, not confirmed:** Email has no
      `createdAt` column, so real creation time was reconstructed by
      decoding each row's cuid-embedded timestamp (validated against the 3
      live rows' `receivedAt`-to-decode gap, a consistent ~7-9s, the
      expected shape). The 6-row duplicate cluster sharing one identical
      `receivedAt` actually has decoded creation times spread ~2.5 hours
      apart — real, staggered, independent arrivals, not one simultaneous
      flood pressuring a shared resource window. The gap fires
      per-request, independently, not from correlated load.
      **No automatic retry exists:** grepped `app/api/cron/route.ts` for
      any reference to `extractedAt`/`runExtraction`/`extractEmail` — zero
      matches. A manual per-email "Re-extract" action exists
      (`app/(app)/emails/[id]/actions.ts`, always-rendered button on the
      email detail page) but nothing surfaces these rows to a human:
      `needsReview` stays `false` (only the catch path sets it, and these
      rows never reach the catch) and `orderId` is `null`, so they sit
      silently in "Unlinked emails" with no distinguishing flag.
      **Not fixed here — diagnosis only.** Threading, not a new bug: the 3
      live rows belong in the existing "Orphan census refresh" 🔴 Now
      item's already-tracked `emailType: null` never-ran sub-bucket (that
      script already separates ran-and-failed from never-ran by this exact
      `extractedAt` field) — this update supplies the mechanism that bucket
      was missing. The 11 masked rows are additional instances of the
      already-tracked ACE VISALIA RSC/GLOBAL-E redelivery-duplicate item,
      same signature (`messageId: null`, pre-dates the 2026-07-26 dedup
      guard), different senders (FedEx, Amazon/Whole Foods). Candidate fix
      directions, not built, need an owner call: (a) move the line-8
      `findUnique` inside `runExtraction`'s own try/catch so a failure
      there still stamps `extractedAt`+`needsReview`, closing the
      ambiguous-state gap for future rows; (b) a scheduled sweep that
      retries or at least surfaces `extractedAt: null` rows past some age
      threshold, since no automatic retry exists today. **Direction (a) is
      the one built — see the ✅ Done pointer entry directly above.**

- [x] **PHASE 0 — cost guardrails, CONFIRMED DONE 2026-07-25 (owner
      action, non-code).** Owner set an Anthropic Console monthly spend
      cap and a billing usage alert, confirmed. Original item text
      preserved below.
- [ ] **PHASE 0 — cost guardrails. NON-CODE, OWNER ACTION, do before any
      other work. NEW 2026-07-22 (`api-cost-guardrails`).** Two things,
      both in the Anthropic Console, neither requiring Claude Code:
      **(a) Monthly spend cap** — Console → Limits → set a monthly limit.
      Pick a number that is a real ceiling, not a target: baseline is
      ~$0.50–$2.50/day, so a $75–100/mo cap leaves headroom for a bad day
      without letting a runaway loop run for a week. **(b) Usage alert** —
      Console → Billing, email threshold at roughly 2× a normal day. The
      2026-07-21 spike ($14.50 vs a $0.50–$2.50 baseline) went unnoticed
      for a full day; an alert would have surfaced it that afternoon.
      **Rationale for doing this FIRST:** every item below is a code change
      that needs a session to land. The cap needs five minutes and bounds
      the damage from anything not yet diagnosed — including the still-open
      ACE VISALIA status-path question above.

- [x] **Amazon dashboard folder card (v1, awareness-only) —
      OWNER-VERIFIED IN PRODUCTION 2026-07-25, via screenshots.**
      Original item text preserved below.
- [ ] **Amazon dashboard folder card (v1, awareness-only) — BUILT
      2026-07-20, pushed, awaiting owner verification in production —
      NOT Done.** Per `AMAZON_HANDLING.md`, refined by owner build
      instructions this session. New: `lib/amazonBundle.ts` (`isAmazonOrder`,
      `isDeliveredDecisionPending`, `amazonRowLabel`, `amazonComposition`,
      `earliestAmazonDeadline`, `compareNullableDate` — all pure, 25 unit
      tests in `__tests__/amazonBundle.test.ts`), `app/AmazonBundleCard.tsx`
      (collapsed/expanded folder card), `app/(app)/amazon/page.tsx` (the
      "View all" read-only full list). `app/(app)/page.tsx` now excludes
      active Amazon orders from the regular per-order list and renders the
      bundle card once instead (archived Amazon orders are unaffected — still
      render individually on the Archived tab, since the bundle only covers
      active orders).
      **O7 resolved in code, matching this session's earlier verification:**
      "delivered" is `deliveredAt !== null` (not `displayStatus`), with
      `return_requested`/`returned` always taking priority over a stale
      delivered/countdown reading. Confirmed against real data:
      `retailer` is a clean, consistent `"Amazon"` string in production (no
      sub-brand variants yet), so the `isAmazonOrder` substring match is
      solid for now.
      **Known simplifications, not silently made — flagging here:**
      (1) The doc's 2.1 says the bundle "sorts among other retailer cards ...
      like any other card"; built instead as its own always-visible section
      (same pattern as the existing Needs-review block), not interleaved
      into the sorted per-order list — cross-type sort interleaving across
      all 6 sort fields wasn't specified and isn't built. (2) The bundle
      ignores the search box entirely (same as Needs-review). (3)
      `earliestAmazonDeadline` and the "5 delivered" row filter both exclude
      `return_requested` orders — the doc's drop-off/label-expiry deadline
      isn't tracked as a distinct field in the schema, so v1 doesn't attempt
      it. (4) The bundle's `DaysLeftChip` badge always passes
      `isEstimated={false}` — bundle-level deadline-estimation-aggregation
      isn't attempted.
      **Verified locally before push:** `npm run build` clean, all 411 tests
      passing (386 pre-existing + 25 new). Browser-checked against a live
      dev server pointed at production data, authenticated as the owner's
      own account via a temporary Auth.js session row (created, verified,
      then deleted immediately after — no lasting change): dashboard loads
      with no console errors, the bundle card renders with real data ("2
      orders · $75.41 · 1 in transit · 1 ordered", dash badge since neither
      is delivered yet), expand/collapse works, `/amazon` renders both real
      orders with working Archive links, and clicking through to
      `/orders/[id]` works. **Not yet checked live in production** (only
      locally against a dev server) — owner should verify on
      app.myreturnwindow.com once deployed.

- [x] **Needs Review panel — junk-mechanics backend piece, split out
      2026-07-25 from the larger (still-unbuilt) panel-UI item, which
      has been consolidated into "Unified card geometry + order state
      machine" (🙋 Waiting on Owner). This backend piece itself
      already shipped — preserved verbatim below.**
      **2026-07-22: junk mechanics for the non-commerce orphaned-email
      population (`emailType === "other"`) BUILT this session, backend
      only — no UI.** Soft `Email.junkedAt` flag (migration applied — see
      below), auto-file on ingestion (`shouldAutoJunk`, `lib/junk.ts`),
      `rescueEmail()` (verified against a disposable throwaway test row,
      not real data, cleaned up after), an `EmailRescue` event log (not a
      counter — per-user rescue rate computable, not just aggregate), and a
      full email-query consumer audit (2 real consumers updated:
      "Unlinked emails," the weekly coverage-check digest content).
      `scripts/backfill-junk-other-emails.ts` written 2026-07-22, **APPLIED
      2026-07-23 — 168 emails junked, verified via before/after count (4
      pre-existing + 168 = 172 total `junkedAt` NOT NULL rows) and confirmed
      zero of the 13 known orphaned-genuine-commerce emails were touched.**
      5 new tests, 450/450 passing, `npm run build` clean. **Schema
      migration applied to the database** (additive only — one nullable
      column, one new table, no data written) — separate fact from
      commit/push/deploy status, see close-out. Full detail in
      `HISTORY.md`. The panel UI itself (Order-level `duplicate`/Merge, the
      actual Needs Review panel component) remains unbuilt, still blocked
      on the owner's panel mock — this was the data-layer piece only.
      **Auto-junk leak, found + explained during the apply's verify gate
      (2026-07-23):** of 14 orphaned `other`-typed emails received after
      2026-07-22, only 4 were already junked before the apply; 10 matched
      `shouldAutoJunk` but were missed by the live auto-junk path. Initially
      suspected late reclassification via re-extraction — **refuted by the
      data:** `extractedAt` trails `receivedAt` by seconds-to-minutes on all
      14, no delayed-reclassification gap anywhere. **Actual explanation,
      confirmed clean with zero exceptions:** all 10 missed rows have
      `receivedAt` before `54fe13f`'s commit time (2026-07-23T02:33:42Z,
      the commit that added the auto-junk path); all 4 already-junked rows
      have `receivedAt` after it. They simply arrived before the code
      existed — the junk check runs once, inside `linkEmailToOrder`'s
      orphan branch, at ingestion time only, so pre-deploy backlog is never
      retroactively caught. This is exactly what this backfill script exists
      to clean up, not a distinct live bug in the running path — but it
      means the backlog is larger/more recent than the 07-22 baseline
      assumed. Snapshot of the 10 ids + timestamps preserved in gitignored
      `.scratch/10-leaked-ids.json` before the apply ran. Not investigated
      further.
      **Count reconciliation, flagged not resolved (2026-07-23):** the
      07-22 baseline was 168 eligible; 10 more became eligible since (the
      leak above) with none removed from the pool by this backfill (it
      hadn't run yet) — so the eligible count should have read ~178 on
      2026-07-23, not still 168. Combined with the script's own header
      comment citing 170 as of the 07-22 diagnostic (a third number), the
      eligible-count queries run across this feature's lifetime have not
      been measuring the same population consistently. Re-derive the
      counting method before trusting any of these numbers in the
      four-slot panel build — not re-derived here.

- [x] **`AMAZON_HANDLING.md` v1 (awareness-only) — APPROVED 2026-07-25.
      O7 resolved in code** (delivered = `deliveredAt !== null`, per the
      built Amazon dashboard folder card) **— see DECISIONS.md
      2026-07-25.** Original item text preserved below.
- [ ] **`AMAZON_HANDLING.md` — rewritten to v1 (awareness-only), 2026-07-20 —
      awaiting owner approval, not Done.** Owner resolved the strategic
      caveat toward **v1 = awareness-only**: Amazon card lists orders
      read-only, no in-app keep/return. The full action model (Keep/Return
      buttons, return state machine, refund-dispute branch, per-email
      cadence) is preserved in the doc's "Deferred to a possible v2" section,
      not deleted. O1–O3 resolved (Amazon-only scope, implied-state badge,
      grocery/health blocked upstream); O4/O5 deferred with v2. Two
      build-time opens remain, both flagged inline in the doc:
      **O6** (card layout — doc now correctly says build from the mock, not
      `return-window-design-tokens.md`, whose §2 is Type scale and §6 a
      single-column layout, not a 2×2 grid — this was already caught last
      pass). **O7** (which field drives each row's status label) — the v1
      draft assumed `displayStatus` alone would suffice; **checked against
      `lib/displayStatus.ts` and it doesn't** — `DISPLAY_STATUS_LABELS` only
      covers 6 values and both "in transit" and "delivered, decision
      pending" collapse to the same `"shipped"` value under
      `deriveDisplayStatus()`'s ladder, so `displayStatus` can't distinguish
      1.2's `arrives 7/29` row from its `12 days` row. "Returnable" doesn't
      exist as a `displayStatus` value at all — it's a separate internal
      `status` enum value (`lib/linkOrder.ts`). O7 is flagged as **not yet
      actually resolved** — needs `deliveredAt`/`estimatedDeliveryDate`
      and/or internal `status` in the mix, a real decision still owed before
      Part 1.2 is coded.


- [x] **Needs Review four-slot inventory — REPORT ONLY, COMPLETE 2026-07-23, no code changes.** Order-level flags: 14 not 13 (7 archived-while-flagged, invisible); orphaned genuine-commerce: 20; extraction failures: 35 (23 attempted-and-failed, 12 never ran); junked: 174 (stable); 108 linked emails carry `Email.needsReview: true` with no resolve path. Panel-design conclusion: enumerate actions, not reasons, for the rebuild. Full report → HISTORY.md 2026-07-23.
- [x] **Weekly coverage-check digest — read-only investigation, COMPLETE 2026-07-23, no code changes.** Recipients: all users unconditionally, no filter (dedup is per-user-per-week, not a recipient filter). Auto-junk has no user scoping. No surface anywhere shows/recovers a junked email except backend-only `rescueEmail(emailId)`, zero call sites. Full report → HISTORY.md 2026-07-23.
- [x] **Task 1 is ✅ DONE, owner-verified in production 2026-07-23 — see ✅ Done
section.** Fitness Superstore `#48868` manually linked to its two orphaned
emails; confirmed no-op on deadline/anchor/status. Three findings spun out
of it, all logged below: a 4th `returnDeadline < orderDate`-shaped
wrong-year instance, a types-need-re-verification flag on the
15-orphaned-genuine-commerce report, and a live instance of the
email-level "needsReview, no resolve path" dead end (both linked emails
still carry `Email.needsReview: true`).

- [x] **Task 2 is DONE this session (2026-07-23) — see the junk-mechanics item
below for full detail.** `scripts/backfill-junk-other-emails.ts` applied:
168 junked, 0 of the 13 known orphaned-genuine-commerce emails touched
(verified). Dry-run re-check found no drift from the 07-22 baseline on
its own, but the apply's verify gate surfaced two findings, both logged
in that item below: a 10-email auto-junk leak (explained — pre-deploy
backlog, not a live bug; re-extraction theory tested and refuted) and an
unresolved eligible-count reconciliation gap (168 / 178 expected / 170
script-header — three numbers, not yet the same measurement). A third
finding (`lookupReturnPolicy()` firing on marketing `other`-typed emails)
is folded into PHASE 1c below. Zero billed Anthropic API calls for any
part of Task 2 (dry run, snapshot, or apply — pure DB/logic path).

- [x] **Retailer logo coverage test — investigation only, both passes now run
      live against Logo.dev.** Domain pass (real observed sender domains):
      15/15 hit, but 1 (Gap Inc. → optiturn.com) confirmed wrong-company logo.
      Name pass (retailers with no domain): 20/22 hit, 2 confirmed wrong
      (NET-A-PORTER, Sidekick), 4 unverified generic marks. Quality-adjusted:
      78.3% of order volume gets a confidently-correct logo, not the 93.5%
      raw hit rate. See `LOGO_COVERAGE.md` for full breakdown + recommendation
      (2026-07-13). `LOGO_DEV_PUBLISHABLE_KEY` added to gitignored `.env.local`
      only — not committed, not in Vercel. No code/schema/UI changes, no
      commits.

- [x] **Docs: create `## 🐛 Bugs` section in TASKS.md — CONFIRMED DONE
      2026-07-25 (stale item, zero risk).** The section already exists (see
      🐛 Bugs below), fully populated with Trust-breaking/Annoying/Cosmetic
      subsections — the "capture-only... no fixes this session" framing
      below was stale, not an open task. Original item text preserved
      below.
      **Docs: create `## 🐛 Bugs` section in TASKS.md** — capture-only.
      Relocate existing trust-breaking/annoying/cosmetic bug items out of
      🟡 Next into a dedicated section right after 🔴 Now, preserving each
      item's text verbatim. No fixes this session.

- [x] **`AMAZON_HANDLING.md` Part 3 — three new parser limitations logged
      2026-07-20, from real order emails.** Docs-only. (1) Item data is
      category counts, not product names/photos — row copy needs to stop
      implying a product name. (2) Delivery dates are relative ("Arriving
      tomorrow") and need resolving against the email's `receivedAt`. (3)
      One order number can span multiple shipments in a single email
      (`111-7078168-2781034` seen as both "Arriving Wednesday" and "Arriving
      tomorrow") — split-shipment dedup risk, must not render as two orders.

- [x] **Preorder / unconfirmed-delivery wrong-deadline — INVESTIGATION COMPLETE 2026-07-20, no code changed.** Root-caused: no ship-date capture in extraction, no "user-set, don't overwrite" pattern for date fields, and a `displayStatus` gap (AquaTru — since fixed separately, see the delivered-rung entries above). Three fix shapes proposed for owner decision; (B) shipped separately. Full detail → HISTORY.md 2026-07-20.
- [x] **Scope Anthropic billing-outage extraction failures — INVESTIGATION
      ONLY, 2026-07-20, no re-extraction yet (owner instruction).** Window:
      ~4pm–9pm PDT (`2026-07-20T23:00:00Z` to now). Signal used:
      `needsReview: true` AND `emailType: null` (the precise fingerprint of
      `runExtraction`'s catch-block failure path — a genuinely-successful
      extraction always sets `emailType` to something, even `"other"`).
      **Found: 8 emails across 4 real users**, all orphaned (`orderId:
      null`, so each already shows in that user's "Unlinked emails"
      section with a "Needs review" badge — not fully silent, but not
      labeled as an outage either). For comparison: 23 similar
      failed-extraction emails exist from *before* this window —
      pre-existing, unrelated, not part of this count.
      **Re-extraction complete 2026-07-20 — clean, no real extraction bug
      found.** All 8 re-ran successfully (no errors), scoped to exactly
      those 8 IDs, no broader backfill.
      **6 of 8 linked to a real order** (2 Amazon, 1 H&M, 1 Anthropic PBC
      billing receipt, 2 ACE Visalia RSC/FedEx shipping emails that
      correctly merged into ONE order, not two) — all now cleared from
      their user's "Unlinked emails" list.
      **2 of 8 extracted cleanly but correctly did NOT link** — both are
      genuine marketing/promotional emails (a Target promo, a Bloomingdale's
      promo) that the Haiku commerce-gate let through at inbound time but
      Sonnet's more careful extraction pass correctly identified as
      non-commerce on re-extraction. Working as designed, not a bug — they
      remain in "Unlinked emails" because they aren't orders, not because
      extraction failed. One minor inconsistency worth a future glance: the
      Target email got `emailType: "other"` (correct) but `retailer:
      "Target"` (the prompt's own rule says retailer should be null when
      emailType is `"other"` — the Bloomingdale's one followed that rule
      correctly, this one didn't). Cosmetic/low-priority, not investigated
      further.
      **`needsReview` is still `true` on all 8** — this is expected, not a
      residual failure: each has its own genuine, unrelated reason (missing
      return deadline, an ambiguous dual-order-number Amazon email, an
      obscure B2B-style retailer name) that a human should actually confirm,
      same as any other real order.

- [x] **Investigation only, 2026-07-20 — why does LR #512867 show "Kept" +
      an active countdown/"at risk"? No fix.** Real root cause found, not
      guessed:
      **(1) No dedicated audit trail exists for in-app status actions.**
      `ActionLog` only covers the token-based email-link actions (Archive,
      Mark Returned via signed links) — confirmed via every `actionLog.create`
      call site. The in-app "Keeping it" button and the `PATCH
      /api/orders/:id/status` route write no log at all; the only evidence
      is `keptAt` (`2026-07-18T21:23:31.647Z`) and the row's own `updatedAt`.
      **(2) Exactly two code paths can ever set `displayStatus: "kept"`** —
      `markKeptAction` (`app/actions.ts:94`, the UI button) and `PATCH
      /api/orders/:id/status` (`app/api/orders/[id]/status/route.ts`) — both
      route through the same shared, rank-gated `buildStatusTransitionData`
      (`lib/displayStatus.ts:126`). Confirmed exhaustively (grepped every
      `displayStatus: "kept"` write in the codebase): no automated/derived
      path exists — `deriveDisplayStatus`'s auto-derivation ladder never
      produces `"kept"`, only preserves it if already set. Manual-only, as
      documented.
      **The real finding: both paths correctly auto-archive in the SAME
      atomic write** (`buildStatusTransitionData` sets `archivedAt` whenever
      `nextStatus === "kept"` and none exists yet) — so the code is not
      buggy at the moment Kept is set. The only way to reach "kept +
      `archivedAt: null`" afterward is a **separate, later Unarchive action**
      (`PATCH /api/orders/:id/archive`) — which only ever touches
      `archivedAt` and has zero awareness of `displayStatus`/`keptAt`. No
      logged proof of this specific event exists (per finding 1), but it's
      the only sequence consistent with the code — `buildStatusTransitionData`
      cannot itself produce this state.
      **(3) Confirmed: display logic does NOT suppress the countdown when
      Kept, anywhere.** `OrderCard.tsx`'s `atRisk = isClosingSoon(order, now)`
      and `<DaysLeftChip returnDeadline={order.returnDeadline} .../>` both
      run unconditionally — no `displayStatus` check in either. `isClosingSoon`
      itself (`lib/alerts.ts:12`) takes only `returnDeadline`, nothing else.
      Under normal conditions this combination is invisible on the main
      dashboard simply because a kept order is *also* archived (filtered out
      entirely) — the contradiction only surfaces once an order is kept
      **and then separately unarchived**, exactly what appears to have
      happened here. This is mobile-audit finding #4, confirmed live on a
      real production order, not just the previously-logged testing
      artifact (owner manually toggling test orders) — a second, distinct,
      real path to the same symptom.
      **Not fixed.** Two real gaps to weigh together, not separately: (a)
      Unarchive should probably reconcile/warn when unarchiving a
      kept/refunded order, and (b) the underlying finding #4 label-coherence
      spec pass (already queued) needs to cover this specific sequence, not
      just simultaneous badge/button rendering.

- [x] **PROBE — carrier-link resolve + forward-classification audit, COMPLETE 2026-07-21, read-only, no writes.** AquaTru confirmed auto-forwarded via raw headers (Gmail `+caf_=` marker); 24/34 delivery-typed emails auto-forwarded under 3 minutes lag. Carrier-link resolve via plain fetch found not viable (0/6, three distinct failure reasons). Close-out decisions → DECISIONS.md 2026-07-21. Full findings → HISTORY.md 2026-07-21.

- [x] **Fitness Superstore `#48868` manual link, owner-verified in production
      2026-07-23.** The order's two orphaned `order_confirmation`-typed
      emails (no order number on either, so the matcher couldn't self-link
      them) merged in by hand via `mergeEmailIntoOrder` + `email.update`
      (`orderId`) + `applyFallbackOrderDate` + `recomputeOrderStatus` +
      `recomputeDisplayStatus` — the same sequence
      `scripts/backfill-retailer-prefix-match.ts` established as precedent,
      with `recomputeDisplayStatus` added since that precedent predates the
      displayStatus rung. Confirmed no-op via before/after print:
      `returnDeadline`/anchor/`deadlineIsEstimated`/`status`/`displayStatus`
      all identical before and after — neither email carried an
      anchor-relevant field, so this closed the review gap without moving
      the deadline. Zero billed Anthropic API calls (pure DB/logic path, no
      re-extraction). Three findings spun out, logged in their respective
      items: a 4th `returnDeadline < orderDate`-shaped wrong-year instance,
      a types-need-re-verification flag on the 15-orphaned-genuine-commerce
      report, and a live instance of the email-level
      needsReview-with-no-resolve-path dead end (both emails still carry
      `Email.needsReview: true` post-link).
- [x] **`displayStatus: "delivered"` rung + AquaTru "Shipped forever" fix,
      owner-verified in production 2026-07-23.** New rung added 2026-07-21
      (`8e27855`), decoupled from requiring `deliveredAt` 2026-07-23
      (`ec1d4aa`) so a confirmed `delivery`-type email is sufficient
      evidence on its own — AquaTru's own delivery emails state no date,
      which is exactly why the first version still showed "Shipped." Full
      build/backfill/verification detail in `HISTORY.md`.
- [x] **Anthropic API bill Q&A, 2026-07-20 (docs-only, no deploy to verify).**
      Mapped all 3 real call-sites (`lib/extract.ts` ×2 Sonnet,
      `lib/classify.ts` ×1 Haiku) and clarified Claude Code's own operation
      isn't billed to this project's key. Folded into `extraction-cost-visibility`
      (🟡 Next) for the actual cost-reduction follow-up.
- [x] **`refund_pending` added to `SKIP_STATUSES`, pushed, awaiting deploy
      verification (2026-07-20).** `lib/reminders.ts:13` — one-line fix,
      owner-approved after direct verification against production data and
      the real reminder functions (see investigation history above/in
      HISTORY.md). Prevents a deadline reminder firing on an order whose
      return label has been on file 14+ days, on the (narrow, event-driven)
      path where a later unrelated email re-triggers `status` recompute
      past that point. Added test coverage for the internal `status` skip
      path in `__tests__/reminders.test.ts` — this was previously untested
      entirely (only `displayStatus` skip had coverage): `completed`,
      `expired`, `return_started`, and the new `refund_pending` all
      suppress; `shipped` still fires. 386/386 tests passing, `npm run
      build` clean. No real order currently in the `refund_pending` state
      to hand-verify against in production — can't be browser-verified
      until one occurs naturally; deploy-only verification (commit lands,
      Vercel builds clean) is what's available today.
- [x] **Session-1 doc-hygiene board items 3 & 4 closed as invalid premise
      (2026-07-19/20), docs-only, no schema/code change.** Item 3 ("drop the
      dead internal `status` field") — **`status` is live, not dead.**
      Written by `recomputeOrderStatus`/`computeOrderStatus`
      (`lib/linkOrder.ts`) on every order create/relink/review-resolve; read
      by `isEligibleForReminder()`'s `SKIP_STATUSES` gate (`lib/reminders.ts`)
      and `OPEN_STATUSES` dashboard filtering (`lib/alerts.ts`,
      `app/(app)/page.tsx`). Dropping it would have silently broken
      deadline-reminder eligibility and the dashboard's "open"/"closing
      soon" views — did not touch schema. Item 4 ("align design-doc
      vocabulary to `displayStatus`") — no actual drift found.
      `return-window-design-tokens.md` never uses the old-vocab words; every
      `status`-vocabulary mention in TASKS.md/HISTORY.md/BUILD.md correctly
      describes the real internal `status` field, already distinguished
      from `displayStatus` (BUILD.md:697). **Why both fields exist (owner
      asked, answered in session):** `status` is a purely automatic,
      email-evidence-only signal (no user input ever writes it);
      `displayStatus` is the user-facing state, part auto-derived / part
      directly settable via `PATCH /api/orders/:id/status`. Not kept in
      sync by any single mechanism — **they can legitimately disagree** for
      the same order, confirmed by a real 2026-07-03 production case
      (`status: "return_started"`, `displayStatus: "returned"`
      simultaneously — see HISTORY.md), which is exactly why
      `isEligibleForReminder()` checks both independently (`SKIP_STATUSES` +
      `SKIP_DISPLAY_STATUSES`) instead of relying on one.
      **Recommendation, accepted: keep both as intentional separate
      concerns — do not consolidate.** Committed and pushed — docs-only, no
      deploy to verify.
- [x] **Deploy-mechanism doc conflict resolved (2026-07-19), docs-only.** CLAUDE.md was right, BUILD.md was wrong. Verified against Vercel deployment history: the last 4 production deployments each landed 6-7s after their triggering commit — consistent, matches the GitHub-webhook auto-deploy signature, not a manually-run `vercel --prod`. `BUILD.md`'s "How to deploy" section corrected to match CLAUDE.md (auto-deploy on push, don't run `vercel --prod`). Committed and pushed — docs-only, no deploy to verify.
- [x] **`keptAt` column check (2026-07-19), docs-only.** Confirmed `keptAt DateTime?` exists on the Order model (`prisma/schema.prisma:206`) — not a bug, `buildStatusTransitionData` writes to a real column. Updated BUILD.md's Order snippet (~line 160-163) to include it, plus fixed the adjacent `displayStatus` comment which was missing `"kept"` from its value list. Committed and pushed — docs-only, no deploy to verify.
- [x] **#6a: a return_label/refund email reaching an order already marked Kept now flags needsReview instead of merging silently, closing the one real gap found — the exact-match query itself was never the bug.** Deployed, awaiting natural verification (needs a real Kept order to receive a genuine return/refund email) — not ✅.
- [x] **A null/unknown return-window anchor now reads "from purchase (est.)" instead of asserting the same certainty as a confirmed anchor.** Shipped, verified in diff.
- [x] **Order detail's Archive button restyled to match its sibling outlined buttons, in place.** Placement stays parked with the separate overflow-menu question. Deployed, awaiting visual verification.
- [x] **Security reconciliation, docs-only (2026-07-19) — C1 fully resolved,
      C2 accepted at LOW, L4 accepted as risk, M2 elevated to primary open
      finding.** Owner decision, recorded in `SECURITY_AUDIT.md`: C1's 4th
      remediation part (entropy rotation) consciously rejected rather than
      left outstanding, closing C1 with no open marker. C2 (no SPF/DKIM
      check on inbound mail) accepted as a tracked finding but downgraded
      CRITICAL → LOW — its original rating double-counted M2 (doesn't
      depend on C2) and L4 (now itself accepted risk); C2's own isolated
      residual is single-account dashboard integrity plus rate-limited LLM
      cost, no cross-user leak or escalation. C2's remediation narrowed to a
      conservative `needsReview` flag on unverifiable-sender forwarded mail
      — explicitly not multi-provider auth parsing, since the forwarding
      ingestion path itself is being demoted by the planned Gmail-OAuth
      pivot. L4 (prompt-injection-driven status changes) marked ACCEPTED
      RISK under the current trusted-alpha threat model, with an explicit
      revisit trigger (re-open when the app admits non-trusted users). M2
      (return-portal URL phishing) elevated to the primary open security
      finding and given its own dedicated `TASKS.md` item, on the reasoning
      that it's independent of C1/C2 and its fix is provider-agnostic
      (survives the OAuth pivot). No code touched.
- [x] **Mobile audit finding #1 (caption scoping on `OrderCard.tsx`) — semantic
      fix owner-verified live 2026-07-17 (`131d800`).** `KEPT_WARNING_CAPTION`
      moved inside `{canKeep && (...)}`'s own form, matching the order detail
      page's already-correct pattern — confirmed the caption now visually
      associates with "Keeping it" only, not with Start return. **Scoping
      confirmed correct; visual outcome is not** — owner reports the caption
      now wraps into a cramped two-line column beside the "..." menu. Closing
      this item for the semantic-scoping fix specifically; the visual re-do
      is tracked separately as finding #1b in 🟡 Next (owner providing a
      mockup before the next attempt — see that item and the Decisions log
      for why a written-spec re-attempt isn't the right next step).
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
- **Un-keep's `status` recompute is non-atomic with the main
  update — accepted 2026-08-31, shipped in `eef90c9`.** `POST
  /api/orders/[id]/unkeep` writes `displayStatus`/`keptAt`/
  `archivedAt` in one Prisma transaction, then calls
  `recomputeOrderStatus` as a second immediate write outside
  that transaction. `recomputeOrderStatus`'s signature doesn't
  accept a tx client and the build session's instruction was
  not to refactor it just for this caller. Documented inline in
  the route.
  **Window:** between the two writes, the order has
  `displayStatus` re-derived and `archivedAt` cleared (so it's
  back on the dashboard) but `status` still reads `"kept"` (so
  it's invisible to `OPEN_STATUSES`-filtered alert queries in
  `lib/alerts.ts`). Milliseconds under normal load.
  **What it looks like if it bites:** a user un-keeps an order,
  a cron/alert query fires in that specific millisecond window,
  the order is briefly missing from closing-soon / needs-review
  results despite being visible on the dashboard. Recovers on
  the next query.
  **Revisit if:** (a) it's observed in production (would show
  up as "I un-kept this and it didn't appear in my reminder for
  one cycle"), or (b) `recomputeOrderStatus`'s signature is
  refactored to accept a tx client for other reasons — at that
  point the un-keep route should be updated to use it, cheap.
- **`computeOrderStatus`/`recomputeOrderStatus` (`lib/linkOrder.ts`) has no
  preserve guard for manually-set `Order.status` values, unlike
  `deriveDisplayStatus`'s rank-based downgrade protection for
  `displayStatus`.** Found 2026-08-31 during the un-kept-action read-only
  investigation: `scripts/backfill-kept-status.ts` promoted `kept` into the
  internal `status` field (CARD_SPEC.md Part 2), but `computeOrderStatus`
  never derives `"kept"` and unconditionally overwrites `status` on every
  email merge (`recomputeOrderStatus`, no read of the current value first)
  — so `status: "kept"` silently reverts to `"returnable"`/`"completed"`/etc.
  the moment any new email lands on that order, independent of
  `displayStatus`. Not user-visible (the dashboard card reads only
  `displayStatus`, per `lib/orderCardState.ts:32`) but it does mean
  `lib/alerts.ts`'s `OPEN_STATUSES` filter (which reads `status`, not
  `displayStatus`) can't be trusted to reflect kept/un-kept state reliably
  without an email arriving to trigger recompute. Not fixed — out of scope
  for the un-kept-action work, which works around it by calling
  `recomputeOrderStatus` explicitly rather than patching the underlying gap.
- **`__tests__/orderCardState.test.ts` — timezone-dependent date-formatting
  flake, NEW 2026-08-23, unrelated to the H&M session's changes.** "awaiting_delivery
  with an estimated delivery date" expects `"Arrives Aug 15"` for
  `new Date("2026-08-15T00:00:00Z")` but gets `"Arrives Aug 14"` — the chip
  label appears to format in the local (non-UTC) timezone, so a UTC midnight
  boundary rolls back a day. Confirmed pre-existing via `git stash` (fails
  identically on `main` before this session's commits). Not fixed — out of
  scope for the H&M task.
- **13 real users, not 10 as previously assumed (2026-07-23, ingestion-path
  investigation).** All 13 have a non-null `inboundToken`, but that's a
  schema default set at row creation for every user — presence is not
  evidence of active forwarding. Don't infer active-user counts from it.
- **Standing practice, adopted 2026-07-20: test/verification scripts must
  default to a NON-PROD Anthropic key.** Surfaced when the preorder
  ship-date fix's live verification used `--env-file=.env` and billed the
  real production key once (disclosed at the time). Accepted as a one-off
  given there's currently no separate dev/test Anthropic key to use instead
  — but shouldn't become routine. Revisit once a dedicated key exists (see
  `extraction-cost-visibility`, 🟡 Next).
- **🔴 URGENT, unverified — Anthropic API account appears out of credit,
  possibly affecting production right now (2026-07-20).** Discovered
  incidentally: a real `extractEmail()` call (via `runExtraction`, testing
  the preorder ship-date fix, see 🔴 Now) failed with `"Your credit balance
  is too low to access the Anthropic API."` This is an account-level
  billing error, not specific to a key or environment. `ANTHROPIC_API_KEY`
  is confirmed set in Vercel Production (`vercel env ls`) — if it's the
  same Anthropic account as local dev (likely, given this project's
  established pattern of one shared Neon DB across `.env`/`.env.local`/
  Vercel), **every real inbound email extraction in production is
  currently failing silently** the same way my test did (caught by
  `runExtraction`'s try/catch, which just sets `Email.needsReview: true`
  with no real data extracted — no loud failure anywhere). Not confirmed
  against production directly (didn't want to spend more of a
  possibly-critical budget testing it) — **owner should check Anthropic
  Console billing immediately**, independent of any other task.
  → **2026-07-26: the "one shared Neon DB" assumption this entry hedged on
  is now confirmed, not just likely** — see `CLAUDE.md`'s Stack & infra
  section and DECISIONS.md 2026-07-26. Historical entry left as-is
  otherwise; this billing outage itself was resolved weeks ago (credit
  restored, see 🔴 Now/✅ Done history).
- **RESOLVED 2026-07-20 (see 🔴 Now):** ~~`app/api/cron/weekly-digest/route.ts`
  has the same force/dedup bug just fixed in `weekly-coverage`~~ — fixed by
  mirroring `9163d0b`. New known issue instead of the old one:
  `lib/coverageCheck.ts` and `lib/weeklyDigestDedup.ts` are now two
  near-identical files (same `scheduledRunWeekStart` date math, different
  hardcoded day/hour) — a deliberate choice this session (mirror + flag,
  per the task's own instruction, rather than unify while fixing a live
  bug), but genuine duplication. Worth generalizing into one parameterized
  `scheduledRunWeekStart(now, dayOfWeekUTC, hourUTC)` in a future pass, once
  both routes' fixes are confirmed live and there's no live-bug time
  pressure.
- **Untracked `LOGO_COVERAGE.md` sitting in the working tree** — noticed
  2026-07-17, been there long enough to flag. Not added, not deleted; owner
  will decide next session.
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
  2026-07-13 — permanent, not pending a fix.** `app/(app)/settings/page.tsx` —
  2/2 non-owner test users (mom, brother) ended up with a filter matching
  their entire inbox instead of the intended commerce search. **Owner
  decision 2026-08-06: the underlying bug (`gmail-deeplink-cross-account-parsing`)
  is killed as too unstable, not being fixed — see `DECISIONS.md`
  2026-08-06.** Non-owner users must set up the Gmail filter manually with
  no in-app guidance (no replacement copy was added — deliberate). Impact:
  onboarding friction for non-technical users; watch for setup-completion
  drop-off. Do not re-introduce the button on this mechanism — OAuth is the
  suspected real fix path, a separate initiative, not a revival of this one.
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
- **Duplicate "On (On-Running)" order rows** — see 🐛 Bugs (Trust-breaking):
  "Investigate duplicate Order rows for On order 101130827062601745."
- Order-number normalization is brittle across retailers (Mango is the first
  case; expect more retailer-specific suffix quirks).
- Retailer-name prefix matching has a known collision risk: "American" (8 chars)
  is a prefix of "American Eagle", "American Vintage", etc. — two orders from
  different "American X" retailers with the same order number would be wrongly
  merged. Accepted trade-off; every such merge is flagged needsReview + logged
  in Order.userNote (`lib/linkOrder.ts`).

## 📝 Decisions log
<!-- One line per decision so future-you and Claude Code know WHY -->
- **Cheap deterministic pre-Sonnet junk gates — all REFUTED on real data
  (2026-08-18), three read-only passes. Do not re-propose without new
  evidence:** (1) List-Unsubscribe drop = 6.8% real orders caught (the
  2026-07-23 header-based-junk-drop 0/20 sample is SUPERSEDED); (2)
  JSON-LD keep-gate = 0.5% coverage; (3) sending-domain split =
  unconfirmable for the DTC-heavy majority. Root reason: our retailer mix
  is smaller DTC brands (single-stream Shopify/Klaviyo senders) that don't
  separate transactional from marketing by header, markup, or domain —
  only content does, which is the classifier's job. Standing direction:
  the lever is the Haiku classifier; the prerequisite is instrumentation
  (rejected-path capture + queryable `anthropic_usage`), NOT another gate.
  Same logging also unblocks PHASE 1a/1b cache sizing — design it once.
- **Principle: "match the existing pattern" is not sufficient guidance when
  contexts differ** (2026-07-17, mobile audit finding #1/#1b). The caption
  fix copied the order detail page's `flex flex-col items-start gap-1`
  placement verbatim — the pattern itself was correct and already proven on
  the detail page, but the dashboard card is meaningfully narrower, and the
  same structure produced a cramped, wrapped result there instead. Fidelity
  to a source pattern isn't the same as verifying the pattern still holds in
  the destination context. Going forward: when a fix references an existing
  pattern, check that the pattern's assumptions (available width, sibling
  layout, etc.) actually hold where it's being applied, not just that the
  code matches.
- **Principle: remote-reasoning about browser CSS layout has a limit — when
  a bug goes 0-for-N, stop patching and start measuring** (2026-07-17, bell
  alignment, mobile audit finding #7). Four rounds on this one finding
  (`leading-none`, a rejected wrapper-removal option, `min-h-dvh` + vh
  fallback, and the checkpoint that confirmed it still isn't fixed) each
  produced a more refined diagnosis than the last but never landed a
  confirmed fix — every round was reasoning about how Chrome/Safari iOS
  *probably* handle a given CSS mechanism, with no way to directly observe
  the actual computed values during the failure. General principle, not
  bell-specific: after a couple of remote-reasoning rounds fail to resolve a
  rendering bug, the next step should be getting real instrumentation (here,
  an on-device Safari Web Inspector session) rather than another round of
  more-refined guessing.
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
- **Security reconciliation (2026-07-19): C2 accepted at LOW rather than CRITICAL,
  L4 accepted as risk under the current trusted-alpha threat model, M2 elevated
  to the primary open security finding.** C2's original CRITICAL rating double-
  counted M2 (phishing — doesn't depend on C2) and L4 (auto-advance — now itself
  accepted risk); isolated on its own, C2's residual is single-account dashboard
  integrity plus rate-limited LLM cost, not a cross-user leak or escalation.
  C2's remediation is scoped to a conservative `needsReview` flag on
  unverifiable-sender forwarded mail, deliberately not multi-provider auth
  parsing — the forwarding ingestion path itself is being demoted by the
  planned Gmail-OAuth pivot, so a brittle forwarding-specific fix isn't worth
  building for a path headed to secondary status, unlike M2's fix, which is
  provider-agnostic and survives that pivot unchanged. C1 is now fully
  resolved: its 4th remediation part (entropy rotation) was consciously
  rejected rather than left outstanding. See `SECURITY_AUDIT.md`'s C1/C2/L4/M2
  entries for full detail.
- **#6a's real root cause was a missing `needsReview` guard on manual-terminal-state
  orders, not the exact-match query (2026-07-18/19).** Recorded so the original
  hypothesis doesn't get mistaken for the actual fix later: the exact-match query
  in `lib/linkOrder.ts` was correct the entire time, byte-for-byte, for every
  email carrying the same order number. What actually produced the reported
  symptom was a separate, already-existing mechanism (an orphaned no-order-number
  refund correctly fallback-matching and correctly forcing review) landing on an
  order already manually marked "Kept" — the fix (`computeKeptStatusConflict()`)
  closes the one real gap (an *exact*-matched return/refund reaching a kept order
  wasn't triggering the same review), not the query itself.
- **Amazon is committed work, not "someday" (2026-07-19).** `amazon-dashboard-folder-view`
  (UX) and `amazon-per-email-reminder-cadence` (digest/reminder cadence) are both
  in scope, not backlog — but bound to `amazon-first-class-case` (the
  `AMAZON_HANDLING.md` spec pass) landing first. Rationale: this codebase has
  taken an Amazon-specific patch almost every session (no `order_confirmation`
  type, no purchase date, sub-brand format variance, category-dependent
  policies, refund emails with no dollar amount, Amazon-hosted return portals,
  anchor mismatches) — spec-first avoids the next patch being the Nth
  ad hoc special-case instead of an instance of a considered design.
- **Needs Review panel actions resolved (2026-07-20), SUPERSEDED
  2026-07-22.** Original decision was a uniform action set (confirm + fix
  both resolve the flag in-panel; delete → detail behind confirm; ignore cut
  from v1) — that flat model is stale, do not build it. **Current model:
  per-flag-type actions via a registry** (flag type → { issue label, primary
  action, confirm? }): `duplicate` → Merge (no confirm) + Review;
  `not_ecommerce` → Delete (behind confirm) + Review; any unregistered type
  → Review-only, never throws. What's still true from the original decision:
  delete stays behind a confirm; no inline ignore/dismiss in v1. See 🔴 Now
  for the build (mock landed 2026-07-22).
  **SUPERSEDED AGAIN 2026-07-23, on data, per owner — see 🔴 Now for the
  full correction.** `not_ecommerce` → Delete is rejected outright (15 of
  206 orphans are real purchases; junk-with-rescue replaced delete for
  this population). Separately, `duplicate`/`not_ecommerce` aren't real
  stored flag types — actual data is 13 order-level reasons + 206
  email-level. Not revised in place; the panel gets rebuilt from a fresh
  inventory (the four-slot panel build) instead.
- **Amazon bundle grouping resolved (2026-07-20): strict `isAmazonOrder`
  only** — no Zappos, Whole Foods, or marketplace-adjacent. Card is meant
  to stay out of the way, not be smart about brand-family membership.
- **Collapsed-card contract resolved (mock 2026-07-20).** Action lives on
  the collapsed card (inline, per image 6), not revealed on expand — this
  was the one open placement question. Geometry is the 2×2 already specced
  in the design doc (`return-window-design-tokens.md` §2): retailer/price
  stacked left, timeline/action stacked right. Bottom-right action is
  state-dependent (Keep·Return / Dropped it off? / Refund received?), same
  cell, content driven by state. Keep/Return must render as TWO distinct
  buttons — S3 acceptance criterion, not cosmetic.
- **Card contract vs. Amazon rows — reconciled (2026-07-20): not a
  conflict, two layers of the same card.** Standard retailer card carries
  its state-dependent action in the collapsed 2×2 bottom-right. Amazon is
  the deliberate exception: collapsed bottom-right is a summary (earliest
  deadline), NOT an action — per-order keep/return lives only on the
  expanded rows (delivered rows only). Amazon inherits the 2×2 geometry
  but not the "action on collapsed card" rule, because it's a bundle, not
  a single order.
- **Explicit assumption accepted, preorder deadline model (2026-07-20):**
  this is an email-based tool. Delivery is assumed = orderDate + 5 days
  (estimated) UNLESS an email moves it. A preorder is handled as a
  known-later ESTIMATED ship date, not a new concept — it reuses the
  existing `estimatedDeliveryDate` anchor (`lib/extract.ts`'s
  `resolveEstimatedDeliveryDate`), same as a shipping-confirmation's
  carrier ETA. **Assumption we are accepting:** the retailer sends a
  shipping email when the preorder actually ships, which moves the anchor
  to reality via the existing merge logic (`mergeEmailIntoOrder`). **Watch
  item, not a bug:** if a retailer doesn't send one (or sends one that
  doesn't restate its own delivery estimate), that order keeps the
  original ship-by estimate and its deadline may drift from the true
  delivery date. Revisit if this recurs across real orders — see 🔴 Now
  for the implementation this decision shaped.
- **The 2026-07-21 spike was NOT reprocessing of outage-failed emails
  (2026-07-22).** Recorded so this is not re-investigated. Verified by CC
  directly against the database, not inferred: the inbound webhook always
  returns 200 specifically so Postmark won't retry; none of the three cron
  routes reference `runExtraction`/`extractEmail`/`needsReview`/`emailType`;
  `extractedAt` vs `receivedAt` deltas across all 376 emails show no bulk
  reprocessing on any day, and 07-21 shows fewer extractions than new
  arrivals. Only one pre-outage email was re-extracted afterward — the
  known Loeffler Randall manual preorder-fix test. **Do not build retry
  caps, backoff, or queue-flush defenses; there is no automatic retry path
  to defend against.**
- **Actual cause: no cache on `lookupReturnPolicy()` colliding with a
  mis-extracted pseudo-retailer (2026-07-22).** 33 lookups on 07-21
  (highest in the dataset by a wide margin), 14 of them for ACE VISALIA
  RSC, all 14 failed. Excluding ACE, the remaining 19 ran 17 success / 2
  failed — in line with 07-22's 15/2. ACE is the anomaly, not the day.
  Inbound volume was normal (52 emails, each triggering its Haiku gate).
- **Stacked-cost charts cannot be read for volume (2026-07-22).** Haiku's
  orange cap is visible on ~$1 bars and invisible on a $14.50 bar for
  reasons of geometry alone — the same few cents is a visible fraction of
  one and not the other. Two separate wrong conclusions were drawn from
  that chart before the data was queried directly. For volume questions,
  use request or token counts filtered by model, never the cost view.
  **Corollary, and the more general lesson: both wrong answers on 07-21/22
  came from trusting a summarized view instead of the underlying rows.**
- **"Read-only" is a database property, not a cost property (2026-07-22).**
  A probe can make zero writes and still make a hundred billed model
  calls. The board tracked writes and deploy state but had no dimension
  for spend. See the amended close-out rule in the header.
- **Kill switch — REJECTED by design (2026-08-04).** A switch that stops
  return-window lookups turns off the product's core function to save
  money. Cost is cut by removing *redundant* lookups (the `other` gate,
  the retailer-policy cache — see PHASE 1a/1b, 🔴 Now / 🟡 Next), never
  by denying a real order its window. If an emergency lever is ever
  wanted, the honest form is "queue lookups, retry when credits
  recover" — defer the work, not the answer. Do not reintroduce.
- **The coverage-check's single job (2026-08-04).** "Here's everything we
  caught from you this week — reply if we missed something." It is an
  alpha QA net. It is NOT "what's coming up" (that's the Sunday digest)
  and NOT "what's genuinely new to the user." Recorded so a future
  session doesn't re-add a second purpose to `weekly-coverage/route.ts`.
