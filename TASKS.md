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
- [ ] **Investigate unexplained extra Vercel production deployments** —
      **stronger evidence 2026-07-09 session close, priority raised.**
      Directly observed in real time: within ~24 seconds of a docs-only
      `git push` (TASKS.md/HISTORY.md commit, no `vercel --prod` run), a new
      Production deployment appeared in `vercel ls` with status Building,
      then went Ready and became the aliased live deployment — no explicit
      deploy command was run for it. `vercel project inspect` still confirms
      no Git Repository connection (ruling out standard GitHub auto-deploy),
      so a push-triggered deploy is happening through some *other* mechanism
      — check the Vercel dashboard directly (Settings → Git, Settings →
      Deploy Hooks, and any webhook config) since this isn't visible via
      CLI. This directly contradicts `CLAUDE.md`'s documented deploy model
      ("manual, not automatic on push") — that doc needs correcting once the
      mechanism is understood, not before (don't want to document a guess).
      Practical implication: `vercel inspect <alias> | grep "Git Commit"`
      cannot be trusted to reflect only intentional deploys anymore — every
      push may already be live before a manual `vercel --prod` runs.
      Production correctness still isn't at risk (every deploy — intentional
      or not — rebuilds whatever `main` legitimately contained at push time),
      but this needs to be understood, not just tolerated.
- [ ] **Verify brother's Gmail forwarding filter is actually built and forwarding** —
      as of session close he had verified his Return Window forwarding address
      with Google, but not confirmed to have (a) opened the deep link successfully,
      (b) built the Gmail filter using the preloaded commerce query, or (c) had
      any commerce email actually forward through. Poll him tomorrow; if he
      responds, log verbatim what he did. Step 5 UX is still unverified for
      any non-owner user.

## 🟡 Next
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
- [ ] **Gmail deep-link "empty filter" bug — reproducible on mom's account,
      root cause unknown** — owner reproduced hands-on today: clicking the
      deep link from Return Window settings loads Gmail with essentially no
      search applied; results are close to the full inbox. Byte-identical URL
      to owner's own (which works correctly). Not a "user followed
      instructions wrong" case. Deep debugging is high-cost without ability
      to instrument the browser. Next diagnostic: reproduce on a third
      account (husband or unrelated tester) to determine if per-account or
      broader. Real evidence supporting OAuth prioritization. Interim
      workaround: manual/text setup instructions bypassing the deep link.
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
- [ ] **[TOMORROW #2, spec pass first] Auto-email Gmail confirmation code** —
      deliver the confirmation code to the user via email (in addition to
      dashboard surfacing), owner BCC'd — see Decisions log for the
      "meets them where their attention actually is" rationale. Do a 15-minute
      spec pass before writing code; ship only if the spec holds up. Not
      urgent enough to skip the spec pass even under tomorrow's priority.
- [ ] **[TOMORROW #3, if time] `orderDate` column on admin dashboard user
      detail table** — small, clean addition; deferred out of admin dashboard
      v1.1. Not urgent since order date is already visible on the order
      detail page — only worth it if #1 and #2 leave room.
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
- **Dashboard visual polish: archive column overflow** — surfaced today by
  owner. Archive column falls off the visible page area on the main
  dashboard. Layout needs a cleanup pass. Not urgent but real UX friction.
  Slug: `dashboard-visual-polish-archive-overflow`.
- **CLAUDE.md's "DONE MEANS DEPLOYED" rule is written for code, ambiguous
  for docs** — docs-only changes have no "deploy" concept, but the spirit
  ("done means visible on origin/main") applies via `push`. Next time
  CLAUDE.md is touched, adjust wording to: *for code, done means deployed;
  for docs, done means pushed*. Surfaced today when the CLAUDE.md merge
  commit sat unpushed pending clarification.
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
- **`BUILD.md`'s `computeDeadline()` documentation block is stale** — still
  describes the old pre-split `deliveryDate` logic ("if deliveryDate known:
  anchor = ..."), not the `deliveredAt`/`estimatedDeliveryDate` split shipped
  two sessions ago. Found while adding the tiered-return-policy bullet to the
  Extraction section just above it; not fixed here (out of scope for a
  prompt-only task).
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
