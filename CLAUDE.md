# CLAUDE.md — Return Window

Project context for Claude Code. This file is auto-loaded every session.

## TASK TRACKING — NON-NEGOTIABLE
- Before doing anything else in any session, read `TASKS.md`.
- When given any new request, add it to `TASKS.md` under "Now" or "Next" BEFORE
  starting work.
- Move to Done only after verifying live in production. Never delete completed
  items — move them to the Done section so `TASKS.md` doubles as a lightweight
  decision log between BUILD.md milestones.
- If a session ends mid-task, it stays in Now — never auto-mark Done.
- **Proactive capture — non-negotiable:** whenever I mention a bug, follow-up,
  or feature during conversation — even mid-task, even if I don't ask — append
  it to `TASKS.md` immediately. Don't wait for an explicit "add this." If it
  belongs to the current milestone, put it in Now. If it's follow-up or later
  work, put it in Next or Someday.
- If a captured item is ambiguous, capture it anyway with a `[needs clarification]`
  tag rather than pausing to ask — clarification can happen when the item is
  picked up.
- At the end of every session, update `TASKS.md` to reflect actual current state.

**DONE MEANS DEPLOYED — NON-NEGOTIABLE:**
A task is only "Done" when it is committed AND pushed to origin AND verified live
in production. Committed-but-unpushed is not done. Pushed-but-unverified is not done.
At the end of every session: run `git status` and
`git log origin/main..main --oneline`. If anything is uncommitted or unpushed,
surface it and resolve it before ending. Never leave a session with unpushed commits.

---

## What this is
Return Window is a returns-assistant web app. A user forwards or connects their
shopping emails; the app parses order confirmations and return/refund
confirmations, links them into a single Order, and surfaces the **return window
deadline** so they never miss a return. It's the wedge product for a broader
"shopping intelligence" brand family (Closet Window, Window Shopping) — but only
Return Window matters until it has happy users.

## Stack & infra
- **Framework:** Next.js (App Router)
- **Auth:** Auth.js **v5** (magic-link / email sign-in). Use `AUTH_*` env vars
  ONLY — in practice that's just `AUTH_SECRET`; `AUTH_URL` is not set and
  isn't needed (Vercel's `trustHost` auto-detection covers it from the
  request headers). Do **not** reintroduce legacy `NEXTAUTH_*` vars; that
  caused the production redirect loop.
- **Email delivery:** Postmark (`POSTMARK_SERVER_TOKEN`) — both inbound
  (forwarded order emails arrive via a Postmark webhook) and outbound
  (magic links, reminders, admin notifications)
- **Database:** Postgres (Neon) via `DATABASE_URL` — **ORM: Prisma**
  (`prisma/schema.prisma` is the data model; migrations in `prisma/migrations/`)
- **AI extraction:** Anthropic Claude (`ANTHROPIC_API_KEY`) — `lib/extract.ts`
  parses any forwarded email generically (retailer, order number, dates,
  totals, return policy). Not retailer-specific code; the same prompt
  handles every retailer.
- **Hosting:** Vercel — production at `https://app.myreturnwindow.com`
- **Return data source:** any retailer's order-confirmation, shipping,
  delivery, return-label, or refund email the user forwards. Extraction is
  generic (see "AI extraction" above) — Mango was an early real test case
  while building order-matching, not a special integration; the app isn't
  limited to it or to ReBOUND specifically.

## Key files
- `lib/linkOrder.ts` — links order confirmations to return confirmations into one
  Order record. Order-number matching (exact, then fuzzy prefix) lives here.
- `lib/extract.ts` — the AI extraction prompt, and `computeDeadline()` (the
  return-deadline calculation: anchors on order date vs. delivery date per
  `returnWindowStartsFrom`, only estimates a delivery date via a shipping
  buffer when one is genuinely missing — a past bug here silently added
  that buffer even when it didn't apply)
- `auth.ts` — Auth.js v5 config
- `proxy.ts` — auth/route protection (Next.js renamed the `middleware.ts`
  convention to `proxy.ts`; be careful the matcher doesn't intercept
  `/api/auth/*` callback routes)
- `prisma/schema.prisma` — the data model
- `app/api/inbound/route.ts` — the Postmark inbound webhook; where a
  forwarded email enters the system
- `BUILD.md` — the full build log: every milestone, the reasoning behind
  each design decision, and what's been verified against real data. Read
  this for *why* something is built the way it is, not just *what*.

## How to run / deploy
- Dev: `npm run dev`
- Build (also type-checks): `npm run build`
- Migrate: `npx prisma migrate dev --name <description>` (Prisma + Postgres)
- Deploy: **automatic on push.** `mckennamckenna/returns_assistant` is
  connected to this Vercel project via the GitHub integration (connected
  2026-06-21) — every push to `main` triggers a production deploy on its
  own, including docs-only commits, typically live within a few seconds.
  Do **not** run `vercel --prod` — it creates a redundant duplicate
  deployment alongside the one GitHub already triggered. After pushing:
  confirm the alias updated: `npx vercel inspect returns-assistant.vercel.app`
  (or `app.myreturnwindow.com`).
- Env vars: manage via the CLI so local `.env` and all three Vercel
  environments (production/preview/development) stay in sync —
  `npx vercel env add <NAME> <environment>` (and `vercel env rm` to replace
  one). The dashboard (Settings → Environment Variables) works too, but the
  CLI is what's actually been used throughout this project. A new or changed
  env var only takes effect on the *next* deploy — redeploy after changing one.

## Conventions & gotchas
- **Order numbers vary by retailer.** The same order can appear with different
  suffixes across emails (e.g. Mango `F4VLSF` vs `F4VLSF00`). Normalize / fuzzy
  prefix-match before creating a new Order — don't assume exact equality.
- Auth.js v5 env naming is the #1 footgun here. If login breaks in prod, check
  env vars before anything else.
- Keep changes scoped to one task. For anything non-trivial, propose a plan
  first (Plan Mode) before editing.

## Working agreement
- At the start of a session, run `git status` AND `git log origin/main..main --oneline`
  AND `npx vercel inspect returns-assistant.vercel.app | grep "Git Commit"` (or
  equivalent) to report sync state: are local `main`, `origin/main`, and the live
  Vercel deploy all on the same commit? Flag any drift immediately before proceeding.
  (This is how `CLAUDE.md` and `TASKS.md` once sat uncommitted for several sessions,
  and how unpushed commits once lingered without anyone noticing.)
- Before a big or ambiguous change: outline the plan, wait for approval.
- After finishing: summarize what changed in 2–3 lines and update `TASKS.md`.
- Flag any new issue you notice into `TASKS.md` under "Known issues" even if
  it's outside the current task.
- **Verify ownership before proposing a user-scoped record as an example.**
  When suggesting a specific order (or any user-scoped record) as a
  verification example, always scope the query by the current user's userId
  before naming the record. Cross-account queries are legitimate for
  aggregate stats, but individual rows should never be surfaced as
  user-facing examples without confirming ownership first. This isn't just
  a bug-avoidance rule — it's a data-scoping discipline. Verify ownership
  first, then propose.
- **Minimize real user data in session logs and written artifacts.**
  Verification codes, email addresses, order specifics, personal names, and
  dollar amounts on real orders should be minimized in session logs and
  never appear in commit messages, `HISTORY.md` entries, or docs.
  Diagnostic prints and test outputs that name individual users are fine
  within the session but shouldn't propagate to committed artifacts. Use
  retailer names and generalized shapes ("an Amazon order," "a returned
  order at the 2-day threshold") rather than specific order numbers or user
  emails in written records, unless the specific identifier is genuinely
  necessary for the record.

## Behavioral habits
Confirmed at the close of a long, high-volume session (2026-07-08) as habits
to keep — originally captured in the memory-system file
`feedback_standing_habits.md`; this repo section is now the canonical
source (see note at the top of that file).

- **Push back before "go" on risky approvals.** Don't just execute the
  moment the user says "go"/"commit" — if something in the plan still looks
  risky (an irreversible write, an assumption not yet verified, a mismatch
  just discovered), flag it once more before acting, even after approval
  was already given.
- **Ask about underlying product assumptions on new features.** When a
  request implies an assumption about user behavior or context (e.g., "the
  user is in our dashboard" vs. "the user's actual mental context is Gmail"
  during the Gmail-setup work), surface that assumption explicitly rather
  than silently building to the literal spec.
- **Watch for late-day scope creep and tired approvals.** Later in a long
  session, be more careful about scope discipline and about whether an
  approval is a considered "yes" or a fatigued one — don't ride momentum
  into extra unrequested changes.
- **Diagnostic-first debugging.** Before writing any fix, investigate and
  report findings first — confirm the actual current state (file paths,
  existing logic, whether an assumption in the task description is even
  correct) before touching code. This repeatedly caught real discrepancies:
  a referenced file path that didn't actually exist, a doc section
  referenced as if present but missing, a stale task already shipped. Keep
  doing this even when a task doesn't explicitly say "diagnostic-first."
