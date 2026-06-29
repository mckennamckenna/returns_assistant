# CLAUDE.md — Return Window

Project context for Claude Code. This file is auto-loaded every session.

## TASK TRACKING — NON-NEGOTIABLE
- Before doing anything else in any session, read `TASKS.md`.
- When given any new request, add it to `TASKS.md` as Pending BEFORE starting work.
- Move to In Progress when starting, Done only after verifying live in production.
- If a session ends mid-task, it stays In Progress — never auto-mark Done.
- At the end of every session, update `TASKS.md` to reflect actual current state.

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
- **Hosting:** Vercel — production at `https://returns-assistant.vercel.app`
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
- Deploy: **manual, not automatic on push** — there is no GitHub auto-deploy
  configured on this Vercel project (confirmed: no Git connection shows up
  under `npx vercel project inspect returns-assistant`). After pushing to
  `main`:
  1. `npx vercel --prod` from the repo root
  2. Confirm the alias updated: `npx vercel inspect returns-assistant.vercel.app`
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
- At the start of a session, run `git status` — if anything is untracked or
  modified outside the current task, flag it before proceeding (this is how
  `CLAUDE.md` and `TASKS.md` themselves once sat uncommitted for several
  sessions without anyone noticing).
- Before a big or ambiguous change: outline the plan, wait for approval.
- After finishing: summarize what changed in 2–3 lines and update `TASKS.md`.
- Flag any new issue you notice into `TASKS.md` under "Known issues" even if
  it's outside the current task.
