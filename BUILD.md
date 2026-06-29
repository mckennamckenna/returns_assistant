# BUILD.md — Returns Assistant

This file is the spec. The goal is to point a coding agent (Claude Code) at it and build incrementally. Work through it top to bottom. Don't skip ahead to features that aren't in the current milestone.

**Status:** Milestone 1 ✅ complete — verified in production with a real forwarded H&M order confirmation. Milestone 2 ✅ complete — AI extraction, return-policy web lookup, and order value all validated against ~16 real forwarded orders. Milestone 3 ✅ complete — 16 real emails aggregated into 8 Order cards. Milestone 4 ✅ complete — daily cron verified end-to-end with a real reminder send, landing in the inbox after DKIM/SPF/DMARC setup. Milestone 5 ✅ complete — non-commerce discard gate, dashboard delete controls, full-data wipe, and the privacy page all live. Milestone 6 ✅ complete — fromEmail/fromName/textBody/htmlBody/rawJson encrypted at rest, verified against all 21 existing rows with no corruption. Milestone 7 ✅ complete — return-portal links backfilled and verified against real, resolving URLs. Milestone 8 ✅ complete — Auth.js magic-link login, per-user data isolation, and per-user inbound addresses all live in production. Fuzzy order-number prefix matching (see Milestone 3's addendum) added and verified post-Milestone 8. Milestone 9 ✅ complete — admin notifications for Gmail-verification emails, magic-link BCCs, and cron run summaries. Milestone 10 ✅ complete — user-facing Needs Review resolution (approve/split/note) and an admin dashboard. Milestone 11 ✅ complete — alpha UX polish: instant search/filter, Needs Review hidden when empty, product renamed to Return Window, stat card redesign, missing-total guidance. Milestone 12 ✅ complete — more aggressive single-email extraction (order total, line items, order date, return links from shipping/delivery confirmations), backfilled across all existing emails. Milestone 13 ✅ complete — plain-language Needs Review reasons with truncated technical detail on the dashboard, full detail kept on the admin dashboard. Milestone 14 ✅ complete — Needs Review cards collapsed to ~110px (everything but the label/retailer/buttons behind one toggle), and a fully responsive mobile dashboard (stacked order cards, bottom nav, single-column layout below 768px), verified with real screenshots at the iPhone 15 viewport. Milestone 15 ✅ complete — order detail page: combined return-policy line with a linked web-lookup source, a separate policy spot-check link, returnWindowStartsFrom finally persisted (was computed but discarded since Milestone 3), and a real duplicate-email cleanup. Milestone 16 ✅ complete — weekly alpha coverage-check email, ALPHA_MODE-gated, verified with a real send to all 3 real users. Milestone 17 ✅ complete — fixed a computeDeadline() bug that added a 7-day shipping buffer even when the policy counted from order date directly; recomputed all real orders. Milestone 18 ✅ complete — admin onboarding view listing every user's real forwarding address, identity-gated to one account. Milestone 19 ✅ complete — piloted the custom inbound domain (mail.myreturnwindow.com) on one account, including the matching-logic fix the address-display change alone would have masked. Rolled out to every user the same day after a real forwarded order confirmed the pilot worked.

---

## What we're building (context)

An AI post-purchase assistant. Users forward their shopping emails (order confirmations, shipping, refunds) to a private address. The app parses them, tracks return windows and refunds, and reminds the user before deadlines pass. No Gmail login, no inbox access — only forwarded emails.

That's the eventual product. **This milestone builds the smallest slice that proves the hardest part works: a real forwarded email arriving in the app and showing up on screen.** Everything else (AI extraction, reminders, auth, polished UI) comes after, and only once this loop is solid.

## Milestone 1 goal — the only thing that counts as "done"

> I forward a real shopping email from my own inbox, and within seconds it appears in a simple web dashboard showing the sender, subject, date, and body.

No AI, no reminders, no login yet. Just: email in → stored → visible.

---

## Privacy principle (applies to every milestone — bake it in early)

Privacy is a core feature, not a settings page added later. The product's promise is: *we never touch your inbox — only the shopping emails you choose to forward.* Two layers make that true:

1. **The filter is the visible front door.** Onboarding (a later milestone) gives users a specific, narrow Gmail filter that forwards only order/shipping/refund-type mail. It should be *shown and explained in plain language and be editable*, so a skeptical user can read exactly what reaches us. Specific and legible beats complex — a scary filter string undermines both trust and easy setup.
2. **The backend must honor the promise even when the filter doesn't.** A filter can't guarantee nothing sensitive slips through, so the app must: discard anything that isn't clearly commerce, store the minimum needed, make per-email and full-account deletion easy, and never train models on user email content. **Implemented in Milestone 5:** non-commerce discard at ingestion, per-email/per-order delete, and full-account delete are all live — see that section.

For this milestone specifically: `rawJson` storage is for early debugging and must stay prunable/deletable — don't treat it as permanent.

---

## Stack (pinned — don't substitute)

- **Framework:** Next.js (latest stable, App Router) + TypeScript
- **Styling:** Tailwind CSS
- **Database:** Postgres (use Neon for a free, simple hosted Postgres; Supabase is fine too)
- **ORM:** Prisma
- **Inbound email:** Postmark Inbound (free tier, no domain needed for now)
- **Hosting:** Vercel
- **Local tunnel for testing webhooks:** ngrok

## Project structure

```
/app
  /page.tsx              -> dashboard: lists received emails
  /api/inbound/route.ts  -> POST endpoint Postmark calls with each email
/lib
  /db.ts                 -> Prisma client
/prisma
  /schema.prisma         -> data model
.env                     -> secrets (never commit)
```

## Data model (Milestone 1 — keep it this small)

```prisma
model Email {
  id          String   @id @default(cuid())
  fromEmail   String
  fromName    String?
  toHash      String?   // the +tag from the inbound address, identifies the user later
  subject     String?
  textBody    String?   @db.Text
  htmlBody    String?   @db.Text
  receivedAt  DateTime  @default(now())
  rawJson     Json      // store the whole Postmark payload so nothing is lost
}
```

No `User` table yet. For now there's one user: me.

**Heads up on manual forwarding (the MVP intake method):** when I forward an email by hand from Gmail, `fromEmail` will be *my own address*, not the retailer's, and `subject` will start with "Fwd:". The real retailer/order info lives in the email *body*. That's expected — don't try to fix it. It also drives a design rule for the extraction milestone below: **read retailer and order details from the body content, never from the `From` header.** Body-based extraction works for both manual forwards (now) and filter-based auto-forwards (later), so the transition is seamless.

---

## The inbound email approach (read this before building the webhook)

Postmark gives every inbound stream a unique address like `abc123hash@inbound.postmarkapp.com`. Email sent there is parsed into JSON and POSTed to a webhook URL I choose.

It also supports a `+tag`: mail sent to `abc123hash+anything@inbound.postmarkapp.com` arrives at the same inbox, and the part after `+` shows up in the payload's `MailboxHash` field. Later, each user gets their own `+userId`, so one inbox routes everyone. For now I'll just use the plain address.

**Postmark POSTs JSON with these fields** (the ones we care about now):

- `FromFull.Email`, `FromFull.Name`
- `Subject`
- `TextBody`, `HtmlBody`
- `MailboxHash` (the part after `+`, may be empty)
- `Date`

The webhook must return HTTP **200**, or Postmark retries.

---

## Build steps (the order to do them in)

1. **Scaffold.** Create the Next.js + TypeScript + Tailwind app. Get it running locally and deployed to Vercel showing a placeholder page. *Deploy now, before anything works* — proving the deploy pipeline early saves pain later.
2. **Database.** Add Prisma, connect to Neon Postgres, create the `Email` model above, run the migration.
3. **Webhook.** Build `POST /api/inbound`. It reads the Postmark JSON, maps the fields above into an `Email` row, saves it, returns 200. Log the incoming payload so I can see it during testing.
4. **Dashboard.** `app/page.tsx` queries all emails newest-first and renders them as simple cards (from, subject, date, a snippet of the body). No styling polish needed — readable is enough.
5. **Local test.** Use ngrok to expose the local server, point Postmark's webhook at the ngrok URL, and send a test email through the Postmark inbound address. Confirm it lands and renders.
6. **Production test.** Set the Postmark webhook to the live Vercel URL. Forward a real shopping email from my inbox. Confirm it appears.

---

## Manual setup checklist (things the agent can't do for me — I do these in a browser)

- [ ] Create a **Postmark** account → create a Server → open its **Inbound** stream → copy the inbound email address (`...@inbound.postmarkapp.com`).
- [ ] Create a **Neon** Postgres database → copy the connection string.
- [ ] Create a **Vercel** project linked to the repo.
- [ ] Install **ngrok** for local testing.
- [ ] Put secrets in `.env` locally and in Vercel's environment variables:
  - `DATABASE_URL` (Neon connection string)
- [ ] In Postmark's Inbound stream settings, set the **Webhook URL**:
  - Local testing: `https://<your-ngrok-subdomain>.ngrok.io/api/inbound`
  - Production: `https://<your-app>.vercel.app/api/inbound`

## How to know it works

1. Send any email to the Postmark inbound address. Check Postmark's **Activity** tab — it should show the message received.
2. Check the webhook fired (Postmark Activity shows the POST result; my server logs show the payload).
3. Refresh the dashboard — the email is there.
4. Now forward a **real order confirmation** from my own inbox to that address. It should appear the same way.

Once step 4 works, this milestone is done and the foundation is real.

---

## Copy-paste prompts for Claude Code

Run these one at a time. Don't paste all at once — let each step finish and verify before the next.

**Prompt 1 — scaffold + deploy**
> Read BUILD.md. Scaffold the Milestone 1 project per the pinned stack: Next.js (App Router) + TypeScript + Tailwind. Create a placeholder homepage. Get it running locally, then help me deploy it to Vercel so I have a live URL. Don't build the database or webhook yet.

**Prompt 2 — database**
> Per BUILD.md, add Prisma and connect to my Neon Postgres database (I'll paste the connection string into .env). Create the Email model exactly as specified in BUILD.md and run the migration. Add a lib/db.ts Prisma client.

**Prompt 3 — webhook**
> Per BUILD.md, build the POST /api/inbound route. It receives Postmark's inbound JSON, maps FromFull, Subject, TextBody, HtmlBody, MailboxHash, and Date into an Email row, stores the full payload in rawJson, saves it, and returns HTTP 200. Log the incoming payload.

**Prompt 4 — dashboard**
> Per BUILD.md, make the homepage list all stored emails newest-first as simple readable cards: sender, subject, received date, and a snippet of the text body.

**Prompt 5 — test it together**
> Help me test the full loop. Walk me through using ngrok to expose my local server, setting the Postmark inbound webhook URL, sending a test email, and confirming it appears on the dashboard. Help me debug if it doesn't.

---

## What comes after this milestone (not now)

- AI classification + field extraction (retailer, order #, return deadline) using the Claude API
- An `Order` model and the order state machine
- The reminder engine (daily cron → email/SMS)
- Per-user `+tag` addresses and real auth
- The guided Gmail forwarding onboarding (including auto-capturing Gmail's verification email). The forwarding filter is a trust feature: ship a sensible default that's broad enough to catch most orders, but show it in plain language and let users tighten it. Pair it with backend discard of non-commerce mail so the privacy promise holds even when the filter doesn't. (Layering known retailer sender-domains onto subject keywords improves precision later.)

Keep each of those as its own later milestone, built and tested one at a time.

## Sequencing & validation strategy

Build intake last-to-first by friction: validate the engine with the cheapest intake, automate intake only once the engine works.

1. **Milestone 1 (this doc):** manually forward my own emails → prove they land and display.
2. **Extraction milestone:** forward 15–25 recent orders from my backlog by hand. This validates extraction accuracy (retailer, order #, deadline) across real, varied retailers.
3. **Reminders milestone:** backlog deadlines are already expired, so they can't test reminders. Validate the reminder engine + state machine with a few *recent/live* orders, or with date-shifted test data that simulates "today."
4. **Onboarding milestone (the filter), last:** only after the engine is trustworthy. The filter automates intake and scales it to other users; it validates nothing about whether the product works, so it's the final piece, not the first.

---

# Milestone 2: AI Extraction

## Goal — the only thing that counts as "done"

> I forward 15–25 real past order/shipping emails from different retailers. For each one, the dashboard shows the AI's best guess at retailer, order number, and return deadline — along with a confidence level — and I can read the original email alongside it to judge whether the AI got it right.

This milestone validates accuracy. It does not need to be perfect — it needs to be *honest about when it's unsure*, and the output needs to be checkable against the source email. Reminders, corrections UI, and the full order state machine are still later.

## Why this design (read before building)

- **Extraction reads the email body, not the headers.** Forwarded mail shows me as the sender (see Milestone 1 notes) — the real retailer, order number, and dates are only in the body text. This was already true in Milestone 1's data; now we act on it.
- **Conservative over confident.** If the email doesn't clearly state something, the AI should return `null` for that field and lower its confidence — never guess a deadline or invent a policy. A wrong deadline is worse than a missing one, since the entire product exists to prevent missed deadlines.
- **Confidence + reasoning, always.** Every extraction includes a confidence level and a one-line note on its reasoning (e.g. "return window appears to count from delivery, not order date"). This is what makes the output checkable rather than a black box.
- **Synchronous is fine for now.** At 15–25 test emails, calling the Claude API right after saving each `Email` row is simple and good enough. A background job queue is a later-scale concern, not a Milestone 2 concern.
- **Order confirmations and shipping confirmations are different emails about the same order.** The filter (later) and the inbound webhook (now) capture both. They are stored as separate `Email` rows — linking them into one `Order` record is the next milestone. For now, extract what each email contains: order confirmations give us the return policy and order date; shipping confirmations give us the estimated delivery date and tracking number. Both are valuable even unlinked.
- **When there's no delivery date, estimate conservatively.** Return windows usually start from delivery, not order date. If we only have an order confirmation and no delivery date yet, don’t leave the deadline blank — that’s unhelpful. Instead compute a conservative estimate: `orderDate + 7 days (standard shipping) + returnWindowDays`. Always mark estimated deadlines clearly as `deadlineIsEstimated: true`. Erring toward a tighter (earlier) deadline is safer — it prompts the user to act sooner rather than assuming they have more time than they do.
- **When the email doesn't state the return policy, look it up live — don't hardcode it.** Plenty of order confirmations never mention the return window at all. A static retailer → policy lookup table was considered and rejected: policies change, retailers get added constantly, and a stale hardcoded table fails silently (looks authoritative, can be wrong). Instead, once the retailer is identified, do a real-time web search via the Claude API's web search tool for "`{retailer}` return policy" and extract `returnWindowDays`/`returnWindowStartsFrom` from the result. This stays current automatically and works for any retailer, not just ones we thought to add. Mark the source (`policySource`) so it's clear whether a deadline came from the email itself or from this lookup, and if the search comes back unclear, say so (`needsReview = true`) rather than guessing.
- **Order value is the urgency signal, not just the date.** A $15 return closing in 3 days matters less than a $400 return closing in 3 days — both need attention, but the expensive one is worth surfacing first. Extract `orderTotal`, `orderCurrency`, and `lineItems` from the email body with the same conservative rules as everything else (null/empty if not clearly stated, never inferred from product names or guessed). Orders with many line items can produce long model responses — size `max_tokens` generously (4096, not 1024) so a 20-item order doesn't get truncated mid-JSON.

## Data model additions

Extend the existing `Email` model — no new table yet. One real-world email roughly equals one order at this stage; a separate `Order` model comes later once the data justifies it.

```prisma
model Email {
  id                String    @id @default(cuid())
  fromEmail         String
  fromName          String?
  toHash            String?
  subject           String?
  textBody          String?   @db.Text
  htmlBody          String?   @db.Text
  receivedAt        DateTime  @default(now())
  rawJson           Json

  // --- Milestone 2 additions ---
  retailer          String?
  orderNumber       String?
  orderDate         DateTime?
  deliveryDate      DateTime?
  returnWindowDays  Int?      // e.g. 30 — how long the return window is
  returnDeadline         DateTime? // computed — see deadline logic below
  deadlineIsEstimated    Boolean   @default(false) // true when delivery date was assumed, not confirmed
  policySource           String?   // "email" (stated in the email) | "web_lookup" (found via web search)
  confidence             String?   // "high" | "medium" | "low"
  emailType              String?   // "order_confirmation" | "shipping_confirmation" | "delivery" | "return_label" | "refund" | "other"
  orderTotal             Float?    // total order amount, from the email body
  orderCurrency          String?   // e.g. "USD"
  lineItems              Json?     // array of {name, price, quantity}, from the email body
  needsReview            Boolean   @default(false)
  extractionNotes        String?   @db.Text // AI's one-line reasoning, esp. for uncertainty
  extractionRaw          Json?     // full AI JSON response, for debugging the prompt
  extractedAt            DateTime?
}
```

## The extraction approach

Add `lib/extract.ts`: a function that takes one `Email`, calls the Claude API, and returns structured JSON to save back onto that row.

**Model:** use `claude-sonnet-4-6` — extraction accuracy matters more than cost at this volume.

**Prompt skeleton** (Claude Code should refine wording, but keep these rules intact):

```
You are extracting return/refund-relevant information from a forwarded shopping email.

IMPORTANT: This email was forwarded by the customer, so the From header shows
the customer, not the retailer. Identify the retailer from the email BODY content
only — look for sender names, logos described in text, order confirmation
language, etc.

First, identify the email type. Then extract what's relevant for that type.

EMAIL TYPES:
- "order_confirmation" — confirms a purchase was placed
- "shipping_confirmation" — confirms item has shipped, often has estimated delivery date and tracking
- "delivery" — confirms item was delivered
- "return_label" — contains a return shipping label or link
- "refund" — confirms a refund was issued
- "other" — marketing, promotional, or unrelated

From the email body below, extract:
- emailType (one of the types above)
- retailer (string or null — from body only, never the From header)
- orderNumber (string or null)
- orderDate (ISO date string or null — only if explicitly stated)
- deliveryDate (ISO date string or null — only if explicitly stated; common in shipping confirmations as "estimated delivery")
- returnWindowDays (integer or null — e.g. 30; only if explicitly stated in THIS email)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null — what the window counts from, only if stated)
- orderTotal (number or null — the total amount charged, only if explicitly stated)
- orderCurrency (string or null — e.g. "USD", only if determinable)
- lineItems (array of {name, price, quantity} — individual items in the order; empty array if none are itemized in this email)
- confidence ("high" | "medium" | "low")
- notes (one sentence: your reasoning, especially any assumption or uncertainty)

Rules:
- NEVER invent, guess, or infer a date, deadline, policy, price, or item that isn't written in the email.
- Return null for any field not clearly present. Null + low confidence is always better than a wrong answer.
- Lower confidence whenever you have to infer rather than read something directly.
- For shipping confirmations: focus on deliveryDate — that's the key field.
- For order confirmations: focus on returnWindowDays, returnWindowStartsFrom, orderTotal, and lineItems.
- If the email is marketing/promotional/unrelated: set emailType to "other", retailer to null, confidence to "low".
- Leave returnWindowDays null if this email doesn't state it — don't guess based on what you know about the retailer. A separate lookup step handles that.

Respond with ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

EMAIL BODY:
{{textBody-or-htmlText}}
```

## Return policy web lookup (when the email doesn't state it)

If the primary extraction returns `retailer` but `returnWindowDays` is null, the email itself just doesn't say — don't leave it there. Call Claude again, this time with the **web search tool** enabled, to find the retailer's current policy.

**Lookup prompt skeleton:**

```
Search the web for {{retailer}}'s current return policy.

Respond with ONLY valid JSON, no preamble, no markdown formatting:
- returnWindowDays (integer or null — only if you find a clear, specific number of days)
- returnWindowStartsFrom ("order_date" | "delivery_date" | null)
- confidence ("high" | "medium" | "low")
- notes (one sentence: what you found and roughly where, or why you couldn't find a clear answer)

Rules:
- Only report returnWindowDays if a current, official policy clearly states it.
- If the policy varies by item category, membership tier, or sale status, report the standard/default window and set confidence no higher than "medium".
- If you can't find a clear, current policy, return null for returnWindowDays and confidence "low". Never guess.
```

Use the Claude API's `web_search` server tool (`web_search_20260209`) so the model performs real searches instead of relying on training data, which goes stale.

**Resolving the lookup result:**
- **Succeeds** (`returnWindowDays` is non-null and confidence isn't `"low"`) → use the looked-up `returnWindowDays`/`returnWindowStartsFrom`, set `policySource = "web_lookup"`, fold the lookup's `notes` into `extractionNotes` for traceability.
- **Unclear** (no clear `returnWindowDays`, or confidence `"low"`) → leave `returnWindowDays` null, leave `policySource` null, and set `needsReview = true`. Never guess a policy just because the lookup came back ambiguous.
- If `returnWindowDays` was already present from the email itself, skip the lookup entirely and set `policySource = "email"`.

**Deadline computation logic (done in app code, not by the AI):**

```typescript
// Priority order for computing returnDeadline:
// 1. If we have deliveryDate + returnWindowDays → use those (most accurate)
// 2. If we have orderDate + returnWindowDays but no deliveryDate → estimate:
//    assume 7 days standard shipping, mark deadlineIsEstimated = true
// 3. If returnWindowDays is missing → leave returnDeadline null, needsReview = true

const STANDARD_SHIPPING_DAYS = 7; // conservative — errs toward tighter deadline

function computeDeadline(extracted) {
  const { orderDate, deliveryDate, returnWindowDays, returnWindowStartsFrom } = extracted;
  if (!returnWindowDays) return { returnDeadline: null, deadlineIsEstimated: false };

  // Use confirmed delivery date if available
  if (deliveryDate) {
    const start = returnWindowStartsFrom === 'order_date' && orderDate
      ? new Date(orderDate)
      : new Date(deliveryDate);
    return {
      returnDeadline: addDays(start, returnWindowDays),
      deadlineIsEstimated: false
    };
  }

  // Fall back to estimated delivery from order date
  if (orderDate) {
    const estimatedDelivery = addDays(new Date(orderDate), STANDARD_SHIPPING_DAYS);
    return {
      returnDeadline: addDays(estimatedDelivery, returnWindowDays),
      deadlineIsEstimated: true
    };
  }

  return { returnDeadline: null, deadlineIsEstimated: false };
}
```

Set `needsReview = true` whenever: confidence is `"low"`, OR retailer/orderNumber are null on what looks like a real order email, OR returnDeadline is null and emailType is "order_confirmation", OR the return policy web lookup came back unclear.

## Build steps

1. **API key.** Get an Anthropic API key, add it to `.env` locally and to Vercel's environment variables (same pattern as `DATABASE_URL` in Milestone 1).
2. **Schema.** Add the Milestone 2 fields to the `Email` model above, run the migration.
3. **Extraction function.** Build `lib/extract.ts` per the approach above. Have it return the parsed JSON plus the computed `returnDeadline`.
4. **Wire it up.** In `/api/inbound`, after saving the `Email` row, call the extraction function and update that row with the results. Keep it synchronous for now. If the API call fails, log the error and leave the row's extraction fields null with `needsReview = true` — don't break the 200 response to Postmark.
5. **Surface it.** On the dashboard cards, show retailer, order number, return deadline, `deadlineIsEstimated`, and confidence (or "Needs Review" if `needsReview`) alongside the existing sender/subject/date. On the email detail page, show all extracted fields plus `extractionNotes`, so I can compare the AI's answer against the real email body right next to it.
6. **Re-run on demand (useful for prompt tuning).** Add a simple way to re-trigger extraction for a single email without re-forwarding it — e.g. a "Re-extract" button on the detail page, or an admin script. I'll be iterating on the prompt and don't want to re-forward emails each time.
7. **Return policy web lookup.** Add the lookup step from above: when `retailer` is known but `returnWindowDays` is null, search the web for the policy via the Claude API's web search tool, and set `policySource` accordingly. After this lands, re-run extraction (the Prompt 6 "Re-extract" button) on already-forwarded emails that were missing a deadline, so existing rows benefit too.
8. **Order value.** Add `orderTotal`, `orderCurrency`, `lineItems` to the schema and the extraction prompt. Surface `orderTotal` prominently on dashboard cards, right next to the return deadline — it's the signal for whether a return is worth the effort of acting on. Sort the dashboard so that among emails with a return deadline closing soon (within 7 days), the highest-value orders appear first; everything else stays newest-first. Re-run extraction on existing emails so they backfill order value too.

## How to know it works

1. Forward 15–25 real past order/shipping emails from different retailers, spread out a bit so they're easy to review one at a time.
2. For each, open the detail page and compare the AI's extracted retailer/order number/deadline against what the actual email says.
3. Track (informally, even just in my head or a quick note) how many were right, how many were marked `needsReview` correctly (i.e. the AI was right to be unsure), and how many were confidently wrong (the dangerous category — flag these to fix the prompt).
4. This milestone is "done enough" once confidently-wrong extractions are rare and everything else is either correct or honestly flagged as uncertain. Perfect accuracy isn't the bar — honest uncertainty is.

## Manual setup checklist additions

- [ ] Get an **Anthropic API key** at console.anthropic.com.
- [ ] Add `ANTHROPIC_API_KEY` to `.env` locally and to Vercel's environment variables (Production, Preview, Development).
- [ ] Redeploy after adding the Vercel env var, same as with `DATABASE_URL`.

## Copy-paste prompts for Claude Code

**Prompt 6 — schema + extraction function**
> Per BUILD.md's Milestone 2 section, add the new extraction fields to the Email model and run the migration. Then build lib/extract.ts using the prompt skeleton in BUILD.md, calling claude-sonnet-4-6. I'll add ANTHROPIC_API_KEY to .env now.

**Prompt 7 — wire into the webhook**
> Per BUILD.md, call the extraction function from /api/inbound right after saving each Email row, and update the row with the results, including the computed returnDeadline. If extraction fails, log it and leave the row with needsReview = true rather than breaking the webhook's 200 response.

**Prompt 8 — surface on dashboard + detail page**
> Per BUILD.md, show retailer, order number, and return deadline (or "needs review") on each dashboard card, and show all extracted fields plus extractionNotes on the email detail page. Also add a simple way to re-trigger extraction for a single email without re-forwarding it.

**Prompt 9 — deploy and add the API key on Vercel**
> Help me add ANTHROPIC_API_KEY to Vercel's environment variables via the CLI, then redeploy so production has it too.

**Prompt 10 — return policy web lookup**
> Per BUILD.md, after AI extraction identifies the retailer, do a web search for "{retailer} return policy" using the Claude API's web search tool, and extract returnWindowDays and returnWindowStartsFrom from the result. Store policySource as "web_lookup" when this succeeds, or set needsReview = true when the search result is unclear. Add the policySource field to the Email model and migrate. Then re-extract existing emails so they benefit too.

**Prompt 11 — order value extraction**
> Per BUILD.md, add orderTotal, orderCurrency, and lineItems to the Email model and migrate. Update the extraction prompt to extract these from the email body, conservatively (null/empty if not stated). Show orderTotal prominently on dashboard cards next to the return deadline. Sort the dashboard so highest-value orders with a return deadline closing soon (within 7 days) appear first. Re-extract existing emails so they backfill order value too.

---

## What comes after Milestone 2 (not now)

- The reminder engine (daily cron → email/SMS) — needs live/recent orders to test, not backlog. **Spec note for whenever this is built:** include the order total in the notification subject line when known, e.g. "Your $340 Nordstrom return closes in 2 days" rather than just "Nordstrom return closes in 2 days" — `orderTotal` (Milestone 2) already carries the data this needs.
- Per-user `+tag` addresses and real auth
- The guided Gmail forwarding onboarding (the filter milestone)

---

# Milestone 3: Order Model

## Goal — the only thing that counts as "done"

> The dashboard shows one card per real-world order, not one card per email. Forwarding three emails about the same order (confirmation, shipping, delivery) results in one Order card whose data gets more complete and more accurate as each email arrives — not three disconnected cards.

This milestone introduces the aggregation Milestone 2 explicitly deferred: "One real-world email roughly equals one order at this stage; a separate `Order` model comes later once the data justifies it." With ~16 real orders validated, it's time.

## Why this design (read before building)

- **Match on retailer + order number, case-insensitively.** Retailers aren't consistent about casing across emails (e.g. "SKIMS" vs "skims"), so matching must ignore case. This is a heuristic, not a guarantee — see the known limitation below.
- **Later emails can improve earlier data, never just overwrite blindly.** A shipping confirmation arriving after an order confirmation should fill in `deliveryDate` and trigger a `returnDeadline` recompute — using the same `computeDeadline` logic from Milestone 2, now operating on the Order's merged fields instead of one email's fields. Each field merges independently: a new email's non-null value wins, but a null value never erases existing data.
- **Order-level `needsReview` reflects the Order's resolved state, not a blind OR of every linked email's flag.** A shipping-confirmation email can legitimately fail its own policy web lookup in isolation (it has no order total or return-policy text) while a sibling order-confirmation email already supplied everything needed. If Order-level `needsReview` just OR'd every child email's flag, it would falsely flag complete orders. Instead, recompute it from what the Order actually knows: does it look like a real order (has an order/shipping/delivery email) and is `returnDeadline` still null?
- **Status is derived, not stored as ground truth.** Recompute it after every link/merge from the set of `emailType`s seen on linked emails, plus the current date vs. `returnDeadline`. This keeps it self-correcting as new emails arrive, rather than something that can drift out of sync.
- **Known limitation, partially resolved: order-number drift across email types.** A return/RMA confirmation email sometimes cites a different reference than its order confirmation. Exact-match-only linking fragments these into two Orders. **Resolved for the prefix case** (e.g. Mango order `F4VLSF` vs. its ReBOUND return confirmation citing `F4VLSF00` — the return portal appends digits rather than repeating the order number) — see "Fuzzy order-number matching" below. Still unresolved: a return citing a number that *isn't* a prefix of the original (e.g. Chan Luu's case, a wholly different RMA reference) has no shared substring to match on at all; that needs a different signal entirely (retailer + approximate order date + line-item overlap), not a string heuristic.
- **Orphaned emails stay visible, not hidden.** An email that couldn't be matched to retailer + order number (marketing, parsing failure, etc.) gets `orderId = null` and `needsReview = true`, but still shows on the dashboard in an "Unlinked emails" section — nothing should disappear silently.

### Known matching limitations

- **Mango split shipments.** When a single order ships in multiple packages, Mango may generate separate shipment-confirmation emails carrying different sub-order numbers (e.g. `F4VLSF-1`, `F4VLSF-2` rather than repeating `F4VLSF`). Current matching logic (exact match, then the prefix-match fallback) creates a separate Order record per sub-order number rather than recognizing them as one order. Not fixing now — monitoring during alpha to see how often this actually occurs, and whether it's specific to Mango or shows up across other retailers, before deciding whether it's worth engineering a real solution. In the meantime, the user can manually resolve it via the existing "Looks correct" / "Split into separate order" Needs Review actions.
- **Genuine duplicate forwards aren't deduplicated.** Found two `return_label` Email rows on the real `F4VLSF` order with identical subject and body, received 8 seconds apart. Confirmed via the decrypted `rawJson` that these are two distinct Postmark inbound events (different `MessageID`s, ~21:55:46 and ~21:55:54), not a webhook retry (which would carry the *same* `MessageID`) and not a display bug — the user's mail client genuinely sent the same forward twice in quick succession. Deleted the later duplicate, kept the earlier one, recomputed the order (status, `needsReview`, `orderTotal` all unaffected, since the two rows were content-identical). There's no general dedup-by-content logic in the inbound pipeline today; this was a one-off manual cleanup, not a systemic fix — worth reconsidering if double-forwards turn out to be common rather than a one-time accidental double-click.

## Data model

```prisma
model Order {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  retailer    String?
  orderNumber String?

  orderDate           DateTime?
  deliveryDate        DateTime? // best available across all linked emails
  returnDeadline      DateTime?
  deadlineIsEstimated Boolean   @default(false)
  policySource        String?   // "web_lookup" | "stated_in_email" | "user_supplied"
  returnWindowDays    Int?

  orderTotal    Float?
  orderCurrency String?
  lineItems     Json?

  // "ordered" | "shipped" | "delivered" | "returnable" | "return_started" |
  // "refund_pending" | "completed" | "expired" | "needs_review"
  status      String  @default("ordered")
  needsReview Boolean @default(false)

  emails Email[]
}
```

Add `orderId String?` + a relation to `Email`, pointing at its parent `Order`.

## The linking approach

Add `lib/linkOrder.ts`, called from `lib/runExtraction.ts` right after an email's extraction fields are saved:

1. **No retailer or order number extracted** → leave `orderId` null, set the email's `needsReview = true`. Nothing else to do.
2. **Look for an existing Order** matching `retailer` + `orderNumber`, case-insensitively.
3. **Found one** → merge: for each field (`orderDate`, `deliveryDate`, `returnWindowDays`, `orderTotal`, `orderCurrency`), take the new email's value if non-null, else keep the Order's existing value. For `lineItems`, keep whichever array (existing or new) has more items — a fuller itemization beats a partial one. Recompute `returnDeadline`/`deadlineIsEstimated` from the merged dates via `computeDeadline` (exported from `lib/extract.ts`).
4. **Not found** → create a new Order directly from this email's extracted fields.
5. Link the email (`orderId`) to the resulting Order.
6. **Fallback orderDate from the forwarded header, order_confirmation only.** If the Order still has no `orderDate` after merging, look at its linked emails for the earliest one with `emailType: "order_confirmation"` and parse the `Date:` line embedded in its forwarded-message block — read from `textBody`, or from `htmlBody` converted to plain text when `textBody` is empty/whitespace-only (the same `textBody`-or-`htmlText` body resolution extraction uses, shared via `lib/emailBodyText.ts`'s `resolveBodyText`, so both code paths see identical text). Handles both Gmail's `"---------- Forwarded message ---------"` block (e.g. `"Date: Tue, May 19, 2026 at 4:21 PM"`) and Apple Mail/iPhone's `"Begin forwarded message:"` block (e.g. `"Date: April 22, 2026 at 9:07:10 PM PDT"`) — the latter only reachable at all once the body resolution falls back to `htmlBody`, since Apple/iPhone forwards send no plaintext part. That's the retailer's actual send time, unlike `receivedAt`/Postmark's `Date` field, which is just when the customer forwarded it — those can be the same instant in testing but are wrong in general, since a real customer might forward an order from weeks ago. Scoped to `order_confirmation` only: a confirmation email is normally sent right when the order is placed, but a shipping/delivery/return email's send date has no such relationship to the order date, so never apply this fallback using those. The resulting `returnDeadline` is always marked `deadlineIsEstimated = true` — the date it's based on is inferred, not stated.
7. **Recompute status and needsReview** from the full set of now-linked emails:

```typescript
// Priority order (first match wins), re-run after every link/merge:
// 1. any linked email is emailType "refund" -> "completed"
// 2. any linked email is emailType "return_label" ->
//      "refund_pending" if the most recent one is >14 days old (likely
//      shipped back and awaiting processing), else "return_started"
// 3. returnDeadline is set and has passed -> "expired"
// 4. any linked email is emailType "delivery" -> "returnable"
// 5. any linked email is emailType "shipping_confirmation" -> "shipped"
// 6. any linked email is emailType "order_confirmation" -> "ordered"
// 7. none of the above -> "needs_review"

// needsReview: true only when the Order looks like a real order (has an
// order/shipping/delivery email) AND its returnDeadline is still null —
// not a blind OR of every linked email's own needsReview flag.
```

## Build steps

1. **Schema.** Add the `Order` model and `Email.orderId` above, run the migration.
2. **Linking function.** Build `lib/linkOrder.ts` per the approach above. Export `computeDeadline` from `lib/extract.ts` so the linker can reuse it for Order-level recomputation.
3. **Wire it up.** Call the linker from `lib/runExtraction.ts`, right after an email's extraction fields are saved — so both the webhook and the "Re-extract" button keep Orders in sync.
4. **Dashboard.** Query `Order`, not `Email`, for the main list. Each card: retailer, order number, order total, return deadline, status, email count. Sort by `returnDeadline` ascending (soonest first, nulls last). Visually emphasize high-value orders (e.g. a colored border above some threshold). Below the Order list, keep a section for unlinked emails (`orderId = null`) so nothing disappears.
5. **Order detail page.** `app/orders/[id]/page.tsx`: all Order fields plus the list of linked emails, each linking to its email detail page.
6. **Email detail page.** Add a "View Order" link back to the parent Order when `orderId` is set. The page otherwise stays as-is — individual emails are still readable on their own.
7. **Backfill.** Write a one-off script that runs the linker against every existing email with a retailer + order number, oldest-first (so the order-confirmation email typically creates the Order before its shipping/delivery siblings arrive to merge into it).

## How to know it works

1. Forward a multi-email order again (confirmation, then shipping) and confirm both land on the same Order card, with `deliveryDate` and `returnDeadline` updating after the second email.
2. Check the backfill: every real forwarded order from Milestone 2 should now show as a grouped Order card, not a loose email.
3. Spot-check a few Order statuses against what actually happened to that order — does "expired" make sense given today's date vs. the deadline? Does "shipped" downgrade-proof against a later "delivered" email?
4. Confirm unlinked/non-commerce emails (marketing, parsing failures) still show up somewhere on the dashboard, not silently dropped.

## Copy-paste prompts for Claude Code

**Prompt 12 — Order model + linking**
> Per BUILD.md's Milestone 3 section, add the Order model and Email.orderId to schema.prisma and migrate. Build lib/linkOrder.ts implementing the matching/merging/status logic described, call it from lib/runExtraction.ts, update the dashboard to group by Order with an "Unlinked emails" section below, add app/orders/[id]/page.tsx, add a "View Order" link on the email detail page, and backfill existing emails into Orders.

---

## Fuzzy order-number matching (fix, added post-Milestone 8)

**The problem:** Mango's order confirmation cited order number `F4VLSF`; the ReBOUND return-confirmation email for the same order cited `F4VLSF00`. Exact-match-only linking created two separate Order cards for what was clearly one real-world order — the return portal appends digits to the order number rather than repeating it.

**The fix, in `lib/linkOrder.ts`:** when the exact retailer+orderNumber match fails, before creating a new Order, check every existing Order for that retailer (same `userId` scoping as the exact match — see the comment there) for a prefix relationship in either direction: the existing order's number is a prefix of the incoming one, or vice versa. The shared prefix must be at least 5 characters (`MIN_PREFIX_MATCH_LENGTH`) — short order numbers are more likely to collide coincidentally, so a short match isn't trusted.

A prefix match is a *candidate*, not a certainty — it's merged into the existing Order exactly like an exact match would be (same `mergeEmailIntoOrder` path, so later emails still only add data, never erase it), but the Order is always force-flagged `needsReview = true` afterward, overriding whatever `recomputeOrderStatus`'s normal data-completeness check would have computed. That override matters: a prefix-matched order can easily look "complete" (deadline computed, status resolved) immediately after the merge, and the normal self-correcting needsReview logic would clear the flag before a human ever saw it. The review flag here means something different — "confirm this prefix wasn't coincidental" — and needs to survive the recompute.

**What this doesn't fix:** a return email citing a number that shares no prefix with the original at all (e.g. Chan Luu's case, a wholly different RMA reference) has nothing for a string-prefix heuristic to find. That still needs a different signal — see the note carried in "What comes after" below.

**Cleanup performed:** the two real, already-fragmented Mango orders (`F4VLSF` and the orphaned `F4VLSF00`) were merged — the orphan's two return-confirmation emails were unlinked, the empty orphan Order was deleted, and the emails were re-extracted, which re-linked them onto `F4VLSF` via the new prefix match. Confirmed `F4VLSF` ended up with all three emails, status recomputed to `return_started`, and `needsReview: true`. Also confirmed the unrelated `F4VLSG` order (a different real order — last character differs, not a prefix relationship) was untouched.

**How to know it works:** check the dashboard for a single Mango card covering order `F4VLSF` showing the order confirmation and both return-confirmation emails, flagged for review. Confirm `F4VLSG` (the unrelated Mango order) is still its own separate card. Forward a brand-new return email whose order number is a different retailer's order number plus extra digits/characters — confirm it lands on the existing order, flagged `needsReview`, rather than creating a new card.

**Prompt 20 — fuzzy order-number prefix matching**
> Per BUILD.md's "Fuzzy order-number matching" addendum to Milestone 3: in lib/linkOrder.ts, when no exact retailer+orderNumber match exists, check existing Orders for that retailer for a prefix relationship in either direction (minimum 5 shared characters) before creating a new Order. Merge into a prefix match the same way as an exact match, but always force needsReview true afterward — it overrides recomputeOrderStatus's normal self-correcting flag, since a prefix match needs human confirmation regardless of how complete the merged data looks.

---

## What comes after Milestone 3 (not now)

- Per-user `+tag` addresses and real auth
- The guided Gmail forwarding onboarding (the filter milestone)
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — the prefix heuristic added post-Milestone 8 doesn't help here; needs a secondary signal like retailer + approximate order date + line-item overlap

---

# Milestone 4: Reminder Engine

## Goal — the only thing that counts as "done"

> Every day, the app checks all Orders and emails me a reminder at 7 days, 2 days, 1 day, and the same day before each return deadline — once per milestone per order, never a duplicate, and never for an order that's already closed out.

This is the payoff for everything before it: Milestones 2–3 exist so this milestone has a trustworthy `returnDeadline` to act on. No reminder logic is worth building on top of unreliable dates — that's why this came last.

## Why this design (read before building)

- **Cron, not a queue.** One Vercel Cron job, once a day, is simple and sufficient at this scale — a job queue is a later-scale concern, same reasoning as Milestone 2's synchronous extraction call.
- **A fixed reminder cadence (7/2/1/0 days), not a configurable one.** Per-user reminder preferences are a real feature eventually, but they need real users first. Hardcoding the cadence now means the cron logic ships today instead of waiting on a preferences UI that has no one to use it yet.
- **Dedup via a database table, not in-memory state.** Vercel Cron can in principle invoke the route more than once (retries, manual re-triggers, the `force` test param below) — a `Reminder` row per `(orderId, reminderType)` with a unique constraint is the only thing that reliably prevents a double-send across separate invocations, since nothing else persists between them.
- **Skip orders that don't need a reminder, not just orders that don't have a deadline.** `completed`/`expired`/`return_started` all mean the user already acted (or the window's gone) — reminding them is noise at best, confusing at worst ("return closes in 2 days" on an order they already returned). Orders flagged `needsReview` still get reminded *if* they have a confirmed `returnDeadline` — uncertainty about some other field (retailer casing, an unconfirmed line item) shouldn't suppress a deadline we're actually confident about.
- **The subject line always carries retailer + order total.** This was scoped back in Milestone 2 ("Spec note for whenever this is built") — `orderTotal` already exists on every Order for exactly this purpose. A vague "Return closing soon" email is easy to ignore; "2 days left to return: SKIMS · $210" tells me whether to care before I even open it.
- **One hardcoded recipient for now, not a real per-user system.** There's no `User` model yet (still one user: me) — `REMINDER_EMAIL` is a stand-in until per-user `+tag` addresses and auth exist. Don't build the per-user version now; there's no second user to validate it against.
- **`lib/reminders.ts` is pure logic, deliberately.** It takes an order and a date and returns a `ReminderType | null` — no DB reads, no sending. That makes it trivial to unit-test every day-offset and status-skip case without mocking Prisma or Postmark, and keeps "which reminder fires" decoupled from "how it gets sent."

## Data model

```prisma
model Reminder {
  id      String @id @default(cuid())
  orderId String
  order   Order  @relation(fields: [orderId], references: [id])

  reminderType String   // "7_day" | "2_day" | "1_day" | "same_day"
  sentAt       DateTime @default(now())

  @@unique([orderId, reminderType])
}
```

Add `reminders Reminder[]` to `Order`. The `@@unique([orderId, reminderType])` constraint is the actual duplicate-prevention mechanism — application logic should check it too (to skip work, not just to fail), but the constraint is what guarantees correctness even if that check has a bug or two cron invocations race.

## The reminder logic

`lib/reminders.ts` exports `reminderTypeForOrder(order, today)`:

1. Skip if `order.status` is `"completed"`, `"expired"`, or `"return_started"`.
2. Skip if `order.returnDeadline` is null (covers "`needsReview` with no confirmed deadline" — and any other reason the deadline might be missing).
3. Otherwise compute the calendar-day difference between `today` and `returnDeadline` (UTC dates, ignoring time-of-day, so it doesn't flicker depending on what time the cron happens to run).
4. Return `"7_day"`, `"2_day"`, `"1_day"`, or `"same_day"` if that difference matches exactly 7, 2, 1, or 0 days. Otherwise `null`.

This function never touches the database and never sends anything — it's the answer to "should *this* order get a reminder today," nothing more.

## The cron route

`app/api/cron/route.ts`, triggered by Vercel Cron daily at **14:00 UTC**:

1. Fetch all Orders.
2. For each, call `reminderTypeForOrder`. Skip if `null`.
3. If a `Reminder` row already exists for `(orderId, reminderType)`, skip (already sent).
4. Otherwise send via **Postmark outbound** (same Postmark account already used for inbound) to `REMINDER_EMAIL`, subject formatted as below, then create the `Reminder` row.

**Subject line format** (always retailer + total when known):

```
{daysLeftLabel} to return: {retailer} · {orderTotal formatted as currency}
```

| reminderType | daysLeftLabel |
|---|---|
| `7_day` | "7 days left" |
| `2_day` | "2 days left" |
| `1_day` | "1 day left" |
| `same_day` | "Last day" |

e.g. `"2 days left to return: SKIMS · $210"`. If `orderTotal` is null, drop the `· {total}` segment rather than printing "· $null".

**Auth + manual testing:** the route requires a `CRON_SECRET` (Vercel Cron sends it automatically as a bearer token on scheduled invocations; reject any request without it matching). A `?force=true` query param, gated behind the same `CRON_SECRET`, lets me trigger a real run on demand while testing — without it, there's no way to test the cron logic except waiting for 14:00 UTC or faking the system clock.

## Build steps

1. **Schema.** Add the `Reminder` model and `Order.reminders` above, run the migration.
2. **Reminder logic.** Build `lib/reminders.ts` per the approach above — pure function, no DB, no sending.
3. **Cron route.** Build `app/api/cron/route.ts`: auth via `CRON_SECRET`, fetch Orders, call `reminderTypeForOrder`, check/create `Reminder` rows, send via Postmark outbound.
4. **Vercel Cron config.** Add the daily 14:00 UTC schedule (`vercel.json` `crons` entry pointing at `/api/cron`).
5. **Manual test path.** Confirm `?force=true` + correct `CRON_SECRET` triggers a real send; confirm a second call right after doesn't double-send (the `Reminder` row should already exist).

## How to know it works

1. Hit `/api/cron?force=true` with the right `CRON_SECRET` against an Order whose `returnDeadline` is exactly 7/2/1/0 days out (date-shift a test Order if nothing in the backlog lines up — BUILD.md's own sequencing notes flagged that backlog deadlines are already expired and can't test this naturally).
2. Confirm the email arrives at `REMINDER_EMAIL` with the right subject line, including retailer and total.
3. Call the same endpoint again immediately — confirm no second email sends, and check the `Reminder` table has exactly one row for that `(orderId, reminderType)`.
4. Confirm an order with status `completed`/`expired`/`return_started`, or `needsReview` with no deadline, never produces a reminder regardless of date.

## Manual setup checklist additions

- [ ] Set `REMINDER_EMAIL` in `.env` locally and in Vercel's environment variables.
- [ ] Set `REMINDER_FROM_EMAIL` — must be a verified Sender Signature (or domain) in Postmark, or outbound sends fail. Postmark's inbound-only address won't work for this.
- [ ] Generate a `CRON_SECRET` (any random string) and set it locally and in Vercel.
- [ ] Add the `crons` entry to `vercel.json` and redeploy — Vercel only picks up cron schedules from a deployed `vercel.json`, not from `.env` or the dashboard alone.
- [ ] Confirm Postmark's **outbound** sending is enabled on the same server/account already used for inbound (it's a separate capability from the inbound stream).
- [x] ~~Known issue: reminder emails land in spam.~~ **Resolved.** Added DKIM (TXT) and Return-Path (CNAME `pm-bounces` → `pm.mtasv.net`) records for `metaxmoda.com` per Postmark's Domains setup, extended the existing root SPF record with `include:spf.mtasv.net` (without touching the GoDaddy-managed Google Workspace include already there), and added a fresh DMARC record (`p=none` to start, monitor-only). Verified end-to-end: the real scheduled cron run on 2026-06-24 sent a "1 day left to return: SKIMS · $210" reminder that landed in the inbox, not spam.

## Copy-paste prompts for Claude Code

**Prompt 13 — Reminder model + pure reminder logic**
> Per BUILD.md's Milestone 4 section, add the Reminder model to schema.prisma and migrate. Build lib/reminders.ts as pure logic — no sending, just returns which reminder type should fire today (or null) given an order and a date.

**Prompt 14 — cron route + sending**
> Per BUILD.md, build app/api/cron/route.ts: authenticate via CRON_SECRET, fetch all Orders, call reminderTypeForOrder for each, skip if a matching Reminder row already exists, otherwise send via Postmark outbound to REMINDER_EMAIL with the specified subject format and create the Reminder row. Add the ?force=true test param gated behind CRON_SECRET, and the vercel.json cron schedule for 14:00 UTC daily.

---

## What comes after Milestone 4 (not now)

- Per-user `+tag` addresses and real auth — `REMINDER_EMAIL` is a stand-in until this exists
- The guided Gmail forwarding onboarding (the filter milestone)
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — needs a secondary signal like retailer + approximate order date + line-item overlap; the prefix case is resolved, see Milestone 3's addendum
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually so it stops reminding without waiting for a `refund`/`return_label` email

---

# Milestone 5: Pre-Alpha Privacy Features

## Goal — the only thing that counts as "done"

> A non-commerce email never gets stored, not even briefly. Every email and every order can be deleted with one click. All data can be wiped in one confirmed action. Anyone can read, in five bullet points, exactly what's stored, what isn't, and how to erase it.

This makes good on the promise from Milestone 1's privacy principle ("the backend must honor the promise even when the filter doesn't") before the next milestone (auth, multiple users) makes that promise matter to anyone but me.

## Why this design (read before building)

- **Classify before storing, not after.** Milestone 2's extraction already classifies `emailType` including `"other"` — but that happens *after* the row is already in the database. A privacy filter that runs after the fact has already failed at its one job. The new gate runs first, on the raw Postmark payload, before any `prisma.email.create` call — a non-commerce email is never written, not even transiently.
- **A separate, cheap model for the gate.** This call runs on every single inbound email, including all the ones that get thrown away — it should be fast and cheap, not the same model/prompt doing full extraction. `claude-haiku-4-5` for a one-word answer is the right tool; spending a Sonnet extraction call to decide "don't keep this" first would be backwards.
- **When uncertain, discard.** The gate's prompt explicitly says "if you're not sure, answer NOT_COMMERCE." This mirrors Milestone 2's "null + low confidence is always better than a wrong answer" — except here the cost of a wrong answer in the other direction (keeping something sensitive) is much higher than the cost of occasionally dropping a legitimate but ambiguously-worded commerce email.
- **Classifier errors fail open, not closed.** If the Haiku call itself fails (API outage, rate limit), the email is kept and goes through the normal flow rather than being silently discarded. An infrastructure hiccup shouldn't quietly delete real data — that's a different failure mode than "this content looks non-commerce," and conflating them would turn a transient outage into permanent data loss.
- **Log a count, never content.** The whole point of the filter is that sensitive content never gets persisted or logged. `console.log("Discarded non-commerce email at inbound")` is the entire log line — no subject, no body, no sender. Counting discards over time (via log search) is useful for tuning the filter; logging what got discarded would defeat the filter's purpose.
- **Deletion needs two different postures.** Deleting one email or one order should be a single click, no confirmation dialog — low blast radius, and the data can usually be recreated by forwarding again. Deleting *everything* is irreversible and total, so it gets real friction: typing the word `DELETE` before the button even becomes clickable.

## What got built

1. **Non-commerce discard at ingestion** (`lib/classify.ts`, wired into `/api/inbound` before extraction). `isCommerceEmail(textBody, htmlBody)` calls `claude-haiku-4-5` with a one-word yes/no prompt. `NOT_COMMERCE` (or no body to even classify) → return 200, never create the `Email` row. Classification errors are caught separately and fail open (keep the email, log the error) rather than discarding on an infrastructure failure.
2. **Dashboard delete controls.** Every Order card and every unlinked-Email card on the dashboard has a delete (`✕`) button, structured as a sibling of the card's `Link` (not nested inside it) so it doesn't trigger navigation. `deleteOrder` (in `app/actions.ts`) deletes the Order's `Reminder` rows, then its `Email` rows, then the Order itself — in that order, since `Reminder` has no cascade on its `Order` foreign key. `deleteEmail` deletes one email and, if that was the last email linked to its Order, deletes the now-empty Order too (and its Reminders). The same `deleteEmail` action and delete button are also used on the Order detail page's linked-email list, where the unlink-and-maybe-cascade behavior is most visible.
3. **`/settings` — delete all data.** One destructive action: wipes every `Reminder`, then every `Email`, then every `Order` (same dependency order as above), gated behind typing `DELETE` into a text field — the submit button stays disabled until the input matches exactly. Redirects to the (now empty) dashboard on completion.
4. **`/privacy` page**, linked from the dashboard footer. Five bullets, plain language: what's stored, what isn't (and that the non-commerce filter runs before storage), that data is never sold, that email content never trains any model, and a link to `/settings` for full deletion.

## How to know it works

1. Forward something pharmacy/medical/financial/personal — confirm it never appears on the dashboard, and the only server log is the no-content discard line.
2. Forward a real order confirmation — confirm it still appears and extracts normally; the gate shouldn't affect legitimate commerce mail.
3. Click delete on an Order with multiple linked emails — confirm the Order and *all* its emails disappear from the dashboard.
4. Click delete on one email within a multi-email Order — confirm the Order survives with the rest of its emails. Delete the last one — confirm the Order disappears too.
5. Go to `/settings`, confirm the button stays disabled until `DELETE` is typed exactly, then confirm the dashboard is empty afterward.
6. Read `/privacy` cold (as if you'd never seen this codebase) — confirm it's accurate and actually answers "what happens to my data."

## Copy-paste prompts for Claude Code

**Prompt 15 — pre-alpha privacy features**
> Per BUILD.md's Milestone 5 section: add a fast commerce/non-commerce classification gate to /api/inbound that runs before extraction and discards (without storing) anything that isn't clearly commerce, logging only a count, never content. Add delete buttons to every email and order card on the dashboard, with the cascade/unlink behavior described. Add a /settings page that wipes all data behind a typed "DELETE" confirmation. Add a /privacy page linked from the dashboard footer with five plain-language bullets covering what's stored, what isn't, no selling, no training on email content, and how to delete everything.

---

## What comes after Milestone 5 (not now)

- Per-user `+tag` addresses and real auth — `REMINDER_EMAIL` is still a stand-in until this exists
- The guided Gmail forwarding onboarding (the filter milestone)
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — needs a secondary signal like retailer + approximate order date + line-item overlap; the prefix case is resolved, see Milestone 3's addendum
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually

---

# Milestone 6: Encryption at Rest

## Goal — the only thing that counts as "done"

> The five fields that carry actual email content or identity — `fromEmail`, `fromName`, `textBody`, `htmlBody`, `rawJson` — are ciphertext in the database, not plaintext. Reading them back through the app still works exactly as before. Anyone with read access to the database (including the app operator) sees only ciphertext without the key.

This is the other half of Milestone 5's discard gate: discarding non-commerce content protects against storing the wrong things, encryption at rest protects the right things that *are* stored, in case the database itself is ever compromised, queried by the wrong person, or backed up somewhere less controlled than expected.

## Why this design (read before building)

- **Field-level, not whole-database, encryption.** Neon/Postgres already encrypts data at rest at the storage layer — this is a different, stronger guarantee: even a query run directly against the database, or a leaked connection string, returns ciphertext for these fields rather than plaintext. The two are complementary, not redundant.
- **Encrypt content and identity, not product data.** `retailer`, `orderNumber`, dates, totals, `emailType`, `confidence`, `extractionNotes` are derived facts about a purchase — useful to query, sort, and match Orders on, and not personally sensitive on their own. `fromEmail`/`fromName` (who sent it), `textBody`/`htmlBody` (what it says), and `rawJson` (everything Postmark gave us, unfiltered) are the fields that actually carry someone's inbox content — those are what get encrypted.
- **AES-256-GCM, IV embedded in every value.** GCM gives both confidentiality and tamper detection (decryption fails loudly if ciphertext is modified, rather than silently returning garbage). Each encrypted value stores its own random IV (`iv:authTag:ciphertext`, all hex) — no separate IV table or per-row metadata needed, and no IV is ever reused across values.
- **`rawJson` changes type, not just content.** It was a Prisma/Postgres `Json` (`jsonb`) column — ciphertext isn't valid JSON, so encrypting it required migrating the column to `String`/`text` first (`ALTER COLUMN ... TYPE TEXT USING "rawJson"::TEXT`, applied before any encryption ran). Reading it back means decrypting then `JSON.parse`-ing, rather than Postgres handling JSON natively.
- **The backfill is idempotent by construction.** A value that already matches the `iv:authTag:ciphertext` shape (exact hex-digit-count pattern) is left alone rather than encrypted again — re-running the script after a partial failure, or by accident, can't double-encrypt and corrupt rows. This matters because the alternative (encrypting already-encrypted ciphertext) produces data that looks fine until someone tries to decrypt it.
- **Decryption happens at every read site, explicitly — not via Prisma middleware.** Given the relatively small number of call sites (one write path, four read paths: extraction, the order-linking date fallback, the dashboard, and the email detail page), explicit `decryptEmailContent()`/`decrypt()` calls at each site stay easier to audit than a Prisma Client Extension that transparently rewrites every query. Bugs here are easy to spot (a field renders as ciphertext) rather than silent.

## What got built

1. **`ENCRYPTION_KEY`** — a random 32-byte hex value, set in `.env` and all three Vercel environments. Losing this key means losing the ability to ever decrypt existing rows — there is no recovery path, by design.
2. **`lib/crypto.ts`** — `encrypt(text: string): string` / `decrypt(text: string): string`, AES-256-GCM via Node's built-in `crypto` module. Output format `iv:authTag:ciphertext` (hex). Tested directly: round-trips correctly for plain text, empty strings, unicode, and JSON content; a tampered ciphertext correctly throws rather than decrypting to garbage.
3. **`lib/emailEncryption.ts`** — thin field-level wrappers used at every call site: `encryptEmailContent`/`decryptEmailContent` for `fromEmail`/`fromName`/`textBody`/`htmlBody` together, and `encryptRawJson`/`decryptRawJson` for the JSON-then-encrypt/decrypt-then-parse `rawJson` path.
4. **Write path** (`/api/inbound`): encrypts all five fields before `prisma.email.create`. The full plaintext payload is still logged via `console.log` for debugging, same as before this milestone — see the residual gap noted below.
5. **Read paths updated to decrypt:** `lib/runExtraction.ts` (decrypts `textBody` before handing it to the AI), `lib/linkOrder.ts`'s forwarded-header-date fallback (decrypts the `order_confirmation` email's `textBody` before regex-parsing it), the dashboard's unlinked-email cards, and the email detail page. The Order detail page needed no changes — it only renders `subject`/`receivedAt`/`emailType` from linked emails, none of which are encrypted.
6. **`scripts/encrypt-existing-emails.ts`** — one-time, idempotent backfill. Run against the 21 existing rows: all 21 encrypted on the first run, all 21 correctly skipped (already encrypted) on a second run. Spot-checked decrypted content against known values (sender, body text, parsed `rawJson`) to confirm no corruption.
7. **`/privacy` page** updated: the "What we store" bullet now states that sender and message content are encrypted at rest and unreadable without the key, without exceeding the five-bullet limit set in Milestone 5.

## Known residual gap

The webhook still `console.log`s the full plaintext Postmark payload for every commerce email, same as it has since Milestone 1 — encrypting the database doesn't help if the same content sits in plaintext in Vercel's log aggregator. Out of scope for this milestone (which was specifically about data *at rest*), but worth addressing before this matters for anyone but me: either drop that log line in production, or redact it to structure-only (field names present/absent) rather than full content.

## How to know it works

1. Read a few existing rows directly (bypassing the app) — `fromEmail`, `fromName`, `textBody`, `htmlBody`, and `rawJson` are all `iv:authTag:ciphertext` hex strings, not readable content.
2. Forward a new email — confirm it lands on the dashboard and extracts correctly, then confirm its stored row is also ciphertext.
3. Open an existing email's detail page — confirm sender, subject line area, and body render exactly as they did before encryption.
4. Open an Order with multiple linked emails — confirm the Order card and detail page still show retailer/order number/dates/total correctly (none of that is encrypted, so this should be unaffected, but worth confirming nothing broke).
5. Re-run the backfill script a second time — confirm it reports 0 newly-encrypted rows, all skipped.

## Follow-up: stop displaying fromEmail/fromName entirely

Encrypting `fromEmail`/`fromName` at rest doesn't help if the app still decrypts and displays them on every page — every email in this system was forwarded by the one account holder, so showing their own address back to them is redundant exposure, not useful information. Fixed: the email detail page and the dashboard's "Unlinked emails" review list (the closest thing this app has to an admin/database-facing view — there's no separate `/admin` route) both show a generic **"Forwarded by you"** label instead of the decrypted sender. The Order detail page never rendered these fields and needed no change. The fields are still decrypted internally as part of `decryptEmailContent`'s bundled call (since `textBody`/`htmlBody` still need it) — they're just never passed into rendered JSX, so they never reach the client.

## Copy-paste prompts for Claude Code

**Prompt 16 — encryption at rest**
> Per BUILD.md's Milestone 6 section: generate ENCRYPTION_KEY and add it to .env and Vercel. Build lib/crypto.ts (AES-256-GCM encrypt/decrypt, IV embedded in output). Encrypt fromEmail, fromName, textBody, htmlBody, and rawJson before writing Email rows (rawJson needs a schema migration from Json to String first), decrypt them at every read site. Write and run an idempotent backfill script for existing rows. Add a note to /privacy that content is encrypted at rest.

**Prompt 17 — stop displaying fromEmail/fromName**
> On the email detail page, replace the fromName/fromEmail display with a generic "Forwarded by you" label. In any admin or database-facing views, make sure fromEmail and fromName are never displayed in plaintext.

---

## What comes after Milestone 6 (not now)

- Per-user `+tag` addresses and real auth — `REMINDER_EMAIL` is still a stand-in until this exists
- The guided Gmail forwarding onboarding (the filter milestone)
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — needs a secondary signal like retailer + approximate order date + line-item overlap; the prefix case is resolved, see Milestone 3's addendum
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually
- Stop logging full plaintext payloads to server logs (the residual gap noted above) — encryption at rest is undermined if the same content is sitting in plaintext log history
- **Audit `rawJson` for content minimization**, not just encryption. It was flagged back in Milestone 1 as "for early debugging, must stay prunable/deletable — don't treat it as permanent," and Milestone 6 encrypted it, but encryption isn't minimization: go through what Postmark's payload contains beyond what we already extract (full headers, attachment metadata, etc.) and decide what's safe to drop entirely, plus a concrete retention policy.
- **Per-user `+tag` addresses must use random hashes, not user IDs.** Milestone 1 noted that `MailboxHash` will eventually carry a per-user identifier so one inbox can route everyone. If that identifier is a sequential or guessable user ID, anyone can enumerate or guess other users' forwarding addresses. Generate an opaque random token per user instead, with no structural relationship to their account ID.
- Key rotation strategy for `ENCRYPTION_KEY` — there is currently no way to re-encrypt under a new key without decrypting every row under the old one first; fine for one key that's never been rotated, not fine indefinitely.

---

# Milestone 7: Return Portal Links

## Goal — the only thing that counts as "done"

> Every Order card and detail page that has a known return-policy page shows a "Start Return →" link straight to it — the actual page where a return begins, not the retailer's homepage.

Knowing the deadline tells you *when* to act. This tells you *where* — closing the gap between "this return closes in 2 days" and actually doing something about it.

## Why this design (read before building)

- **Extend the existing lookup, don't add a second one.** The return-policy web lookup already runs (Milestone 2) whenever an email doesn't state its own return window. Bundling the portal-URL question into that same call/prompt is one more field in the same JSON response, not a second API call, a second cost, or a second place that can fail.
- **`returnPortalUrl` lives on `Order` only, not `Email`.** It's retailer-level information (Mango's return portal is the same URL regardless of which order or email you're looking at) — it doesn't belong on a per-email row the way `returnWindowDays` does. The lookup result is threaded straight from `lib/extract.ts`'s in-memory result through `runExtraction` into `linkEmailToOrder`, which merges it onto the Order, and is never persisted on `Email` at all.
- **A known consequence of bundling, not a bug:** an order whose emails always state their own return window inline (so the web lookup never runs) won't get a `returnPortalUrl` via this path, even if one exists. Fine for now — most retailers that bother stating policy details in-email are well-known enough that this matters less. A future, independent "look up the portal URL regardless of whether we already know the day-count" pass would close this gap, listed below.
- **Never let the model construct a URL — only report one it actually found.** Same "never invent" principle as everywhere else: the prompt explicitly forbids guessing a plausible-looking URL from the retailer's domain. A wrong return-policy day estimate is bad; a wrong return-portal URL is actively harmful (someone clicks it expecting to start a return). Verified directly against a real lookup (Mango) — the URL it returned was a genuine, live page, not a guess.

## What got built

1. **`Order.returnPortalUrl` (`String?`)** — migrated.
2. **Lookup prompt extended** (`lib/extract.ts`'s `buildPolicyLookupPrompt`) to also ask for the direct return-initiation page, with the same "never guess" rule applied to it as to the day-count.
3. **Threaded through, not persisted on `Email`:** `extractEmail` returns `returnPortalUrl` on `ExtractionResult`; `runExtraction` passes it to `linkEmailToOrder(emailId, returnPortalUrl)`; `linkEmailToOrder` merges it onto the Order (new non-null value wins, else keeps whatever the Order already had).
4. **Dashboard Order card:** a "Start Return →" link (opens in a new tab) appears when `returnPortalUrl` is set, placed as a sibling of the card's main `Link` — same pattern as the delete button, so it doesn't trigger the card's own navigation.
5. **Order detail page:** the same link, styled as a prominent button, placed right after the field grid that includes the return deadline.
6. **Backfill:** re-ran extraction on existing orders' emails so they pick up `returnPortalUrl` retroactively.

## How to know it works

1. Re-extract an order for a well-known retailer with no explicit return policy in its emails — confirm `returnPortalUrl` gets set to a real, working URL (check it resolves — some retail sites 403 plain `curl` as bot-blocking, so verify with a browser or a browser-like User-Agent before concluding a URL is bad).
2. Re-extract an order for an obscure/fictitious retailer — confirm `returnPortalUrl` stays `null` rather than a guessed URL.
3. Confirm the "Start Return →" link appears on both the dashboard card and the order detail page when set, and is absent (not a broken link) when not.
4. Click it — confirm it opens in a new tab and doesn't trigger the card's own navigation to the order detail page.

## Copy-paste prompts for Claude Code

**Prompt 18 — return portal links**
> Per BUILD.md's Milestone 7 section: add returnPortalUrl to the Order model and migrate. Extend the web lookup in lib/extract.ts to also find the direct return-initiation URL, never guessed. Thread it through to Order (not stored on Email) via linkEmailToOrder. Show a "Start Return →" link on the dashboard order card and prominently on the order detail page. Re-run extraction on existing orders to backfill.

---

## What comes after Milestone 7 (not now)

- The guided Gmail forwarding onboarding (the filter milestone)
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — needs a secondary signal like retailer + approximate order date + line-item overlap; the prefix case is resolved, see Milestone 3's addendum
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually
- Stop logging full plaintext payloads to server logs — encryption at rest is undermined if the same content is sitting in plaintext log history
- Audit `rawJson` for content minimization, not just encryption — a concrete retention policy, not just a TODO

---

# Milestone 8: Authentication & Multi-User

## Goal — the only thing that counts as "done"

> Anyone can sign in with just their email (no password), gets their own private forwarding address, and only ever sees their own orders — verified by actually creating a second account and confirming it sees zero of the first account's data, not just by reasoning that the code "should" isolate them.

This is the milestone every prior one has been deferring to. Milestone 1's privacy principle, Milestone 5's discard gate, Milestone 6's encryption — all of it was building toward a product other people can actually use, not just the one account that's been testing it.

## Why this design (read before building)

- **Auth.js v5 (beta) is genuinely still beta — verify against the installed package, don't trust memory.** The Email provider was deprecated in favor of `Nodemailer` between v4 and v5; the factory throws if `server` isn't provided even when `sendVerificationRequest` is fully overridden and never touches it. Confirmed by reading the installed `@auth/core` source directly before writing `auth.ts`, not by assuming the v4 API still applies.
- **Send via Postmark's HTTP API, not SMTP.** `Nodemailer`'s `sendVerificationRequest` override calls the existing `lib/postmark.ts` `sendEmail()` — the same path used for reminder emails. No new SMTP credentials, no second way to send mail.
- **The Prisma adapter needs more than just `User`.** The request asked for a `User` model with four fields; what actually shipped also includes `Account`, `Session`, and `VerificationToken` — the standard Auth.js Prisma schema. The adapter's methods reference `prisma.account`/`prisma.session`/`prisma.verificationToken` generically regardless of which providers are configured (no OAuth is configured here, so `Account` stays empty in practice, but omitting the table would break the adapter at the type/runtime level the moment any adapter method touches it). This is required plumbing for "Auth.js with the Email provider," not scope creep beyond the literal ask.
- **The inbound `+tag` is an opaque `inboundToken`, not the raw `userId`.** The original ask was literally `...+[userId]@...`. BUILD.md had already flagged this exact pattern as a future risk (Milestone 1/5 notes: "+tag addresses must use random hashes, not user IDs") — a `cuid()` `id` encodes a timestamp and counter, which is far better than a sequential integer but isn't a fully opaque token either. Added a separate `inboundToken` field (also a `cuid()`, but with zero structural relationship exposed anywhere else) used only for the forwarding address. Flagged this tension explicitly and asked before building, rather than silently complying with the literal instruction or silently overriding it.
- **userId scoping had to be audited everywhere, not just where it was named.** The request named "dashboard queries" (item 6) and "delete all my data" (item 7) explicitly. Auditing every Prisma query in the codebase surfaced two more categories that needed the same fix or the whole feature would have a hole in it:
  - **`lib/linkOrder.ts`'s order-matching query.** Orders match by `retailer` + `orderNumber` — without `userId` in that `WHERE` clause, two different users shopping at the same retailer with a coincidentally-matching order-number format could have their orders merged onto the same row, leaking one user's purchase data onto another's dashboard. This is the single most important fix in this milestone, not a minor one.
  - **IDOR on `/orders/[id]` and `/emails/[id]`.** Fetching by `id` alone meant any logged-in user could view any other user's order/email by guessing or iterating IDs. Fixed by scoping the `findUnique` to `{ id, userId: session.user.id }` — a mismatched owner 404s exactly like a nonexistent row, never leaking that something exists at that id but belongs to someone else.
  - **Server actions re-checked ownership independently of the page that calls them.** `deleteOrder`, `deleteEmail`, `reExtract` are directly invocable endpoints, not just buttons behind an already-protected page — relying solely on "the page already checked auth" would leave the action itself open to a crafted request with someone else's id. Each one re-verifies ownership before doing anything.
- **`proxy.ts`, not `middleware.ts`.** Next.js 16 deprecated and renamed the file mid-build (confirmed via their own migration docs, not assumed) — same default-export behavior, just a different filename and a Node.js-by-default runtime instead of Edge.
- **One-off migration scripts get excluded from `tsc`, not patched forever.** `scripts/backfill-owner-user.ts` made `prisma.email.updateMany({ where: { userId: null } })` valid the moment it ran — and invalid the moment `userId` became required afterward, exactly as intended (its job was done). Rather than keep hand-patching historical scripts to satisfy a schema that's moved on, `scripts/` is now excluded from `tsconfig.json`'s type-checking scope. They still run fine via `tsx`, which doesn't enforce `tsc`'s strictness.
- **`signIn()` defaults `redirectTo` to the current page — explicitly pass `"/"`.** The first real magic-link test looped: the link correctly verified and created a session every time (confirmed in the DB across several attempts), but redirected back to `/login` because that's where the form lived and `redirectTo` wasn't set. Landing on an empty login form looks identical to a failed login. Fixed by passing `redirectTo: "/"` to `signIn()`, plus a defensive check on `/login` itself — if a session already exists, redirect to `/` instead of re-rendering the form, which also covers stale bookmarked magic links.
- **`pages.verifyRequest` / `pages.error` matter, or you get Auth.js's bare default pages.** Without configuring them, a successful send lands on an unstyled default "check your email" page (bypassing any custom client-side UI entirely, since `signIn()` does a real server redirect on success) and a reused/expired single-use token lands on an unstyled default error page — both are easy to misread as the flow looping back to square one.
- **`AUTH_TRUST_HOST` and `NEXTAUTH_URL`/`NEXTAUTH_SECRET` are not needed here, and the latter is actively risky if set wrong.** Confirmed by reading the installed `@auth/core` source: `trustHost` already auto-enables whenever the `VERCEL` env var is present (true on every Vercel deployment), so `AUTH_TRUST_HOST` is redundant. `NEXTAUTH_SECRET` (the v4 name) is never read anywhere in v5 — only `AUTH_SECRET` is. `NEXTAUTH_URL` *is* read, but only as a fallback for constructing actio­n URLs when `AUTH_URL` isn't set — an incorrect value there (stale deployment URL, wrong protocol) is a real way to get inconsistent auth behavior across routes. These three were added directly in Vercel mid-debugging based on outside advice without being verified against this version first, which produced confusing symptoms; removed after confirming none of them were needed.

## Data model

```prisma
model User {
  id            String    @id @default(cuid())
  email         String    @unique
  name          String?
  emailVerified DateTime?
  image         String?
  createdAt     DateTime  @default(now())

  // The +tag in this user's forwarding address — never `id`, see above.
  inboundToken String @unique @default(cuid())

  accounts Account[]
  sessions Session[]
  orders   Order[]
  emails   Email[]
}

model Account { /* standard Auth.js Prisma adapter shape */ }
model Session { /* standard Auth.js Prisma adapter shape */ }
model VerificationToken { /* standard Auth.js Prisma adapter shape */ }
```

`Email.userId` and `Order.userId` are both required (`String`, not `String?`) — added nullable first, backfilled via `scripts/backfill-owner-user.ts`, then tightened to required in a second migration once zero unowned rows remained. Same two-step discipline as every other risky migration in this project (e.g. Milestone 6's `rawJson` type change).

## The auth approach

1. **`auth.ts`** — `NextAuth({ adapter: PrismaAdapter(prisma), session: { strategy: "database" }, providers: [Nodemailer({...})] })`. `callbacks.session` copies the adapter's real `user.id` onto `session.user.id` (the default type doesn't include it — see `types/next-auth.d.ts` for the augmentation).
2. **`proxy.ts`** — `export default auth((req) => { if (!req.auth) redirect to /login })`, matcher covers `/`, `/orders/:path*`, `/emails/:path*`, `/settings`. `/login`, `/privacy`, `/api/inbound`, `/api/cron`, and the NextAuth routes are intentionally not matched.
3. **`/login`** — server-rendered form, `useActionState` for pending/error feedback (the one place a client component was actually necessary), calls `signIn("nodemailer", formData)` as a server action.
4. **Inbound routing**: `/api/inbound` looks up the `User` by `inboundToken` (the `+tag`/`MailboxHash`) *before* running commerce classification — cheaper to fail fast on an unroutable email than to spend an AI call on it. No match → same no-content-logged discard as the non-commerce gate, since there's nowhere safe to attribute the data.
5. **Every dashboard/detail query scoped by `session.user.id`** — both via the `WHERE` clause (so wrong-owner rows are never fetched) and, for detail pages, by treating a wrong-owner match as a 404.
6. **Settings page** shows the real forwarding address (`${POSTMARK_INBOUND_HASH}+${user.inboundToken}@inbound.postmarkapp.com`) with a copy button, and `deleteAllData` now scopes all three `deleteMany` calls (`Reminder` via its `Order` relation, `Email`, `Order`) to `session.user.id`.
7. **Cron route** now `include: { user: { select: { email: true } } }` on the Order query and sends each reminder to `order.user.email` instead of the global `REMINDER_EMAIL`. `REMINDER_FROM_EMAIL` stays global — that's the product's own sending identity, not a per-user concern.
8. **Sign-out** — not explicitly requested, but there was no way to log out once logged in. Added a minimal `signOutAction` in the sidebar.

## Manual setup checklist additions

- [ ] `AUTH_SECRET` (random) and `POSTMARK_INBOUND_HASH` (the Postmark inbound stream's hash — the prefix before any `+tag`) added to `.env` and all three Vercel environments.
- [ ] **Update your Gmail forwarding filter** to your new per-user tagged address (visible on `/settings` once logged in) — the old bare inbound address still works for routing to Postmark, but mail without a recognized `+tag` is now discarded rather than attributed to anyone.
- [ ] `REMINDER_EMAIL` is no longer read anywhere in code (superseded by per-user `user.email`) but is left set, harmlessly unused, rather than deleted.

## How to know it works

1. Sign in with a real email, confirm the magic link arrives via Postmark and clicking it logs you in.
2. Forward an email to your new tagged address — confirm it appears on your dashboard.
3. Forward something to a bare/garbled tag — confirm it's discarded (never stored) rather than landing on anyone's dashboard.
4. **Create a second account and confirm it sees zero orders/emails from the first** — this is the one test that actually matters here; everything else is secondary to "users only see their own data" being true in practice, not just in code review.
5. As the second account, try navigating directly to the first account's `/orders/<id>` — confirm a 404, not the order, not a 403 that would confirm something exists at that id.
6. Try deleting an order while logged in as a different account than the one that owns it (e.g. via a crafted request) — confirm it's a no-op.
7. Confirm `/login` and `/privacy` are reachable without a session, and every other page redirects there when signed out.

## Copy-paste prompts for Claude Code

**Prompt 19 — authentication & multi-user**
> Per BUILD.md's Milestone 8 section: install and configure Auth.js v5 with the Nodemailer/Email provider sending via Postmark. Add User/Account/Session/VerificationToken to schema.prisma, plus a required userId on Email and Order (nullable first, backfilled via script, then tightened). Protect the dashboard/orders/emails/settings pages via proxy.ts, redirecting to /login. Build a login page matching the design system. Use a separate inboundToken (not raw userId) for the per-user +tag, shown on /settings with a copy button. Scope every query — and every server action's ownership check, independent of the page that calls it — by session.user.id. Update the cron route to send to each order's own user.email. Verify cross-user isolation with an actual second account, not just by code review.

---

## What comes after Milestone 8 (not now)

- The guided Gmail forwarding onboarding (the filter milestone) — now genuinely relevant, since there's a real per-user address to onboard people onto
- Order-number drift where the new number shares no prefix with the original (e.g. a wholly different RMA reference) — needs a secondary signal like retailer + approximate order date + line-item overlap; the prefix case is resolved, see Milestone 3's addendum
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually
- Stop logging full plaintext payloads to server logs — encryption at rest is undermined if the same content is sitting in plaintext log history
- Audit `rawJson` for content minimization, not just encryption — a concrete retention policy, not just a TODO
- `/privacy` doesn't yet mention multi-user account isolation explicitly — worth a pass now that it's real, not aspirational
- Key rotation strategy for `ENCRYPTION_KEY` and `AUTH_SECRET`
- Real `Account`-linking (OAuth) support is schema-ready but unused — fine until there's a reason to add a second sign-in method
- Key rotation strategy for `ENCRYPTION_KEY`
- **An independent return-portal-URL lookup**, not gated behind "the email didn't state its own return window" — **partially closed in Milestone 12**: the email's own return link is now extracted directly regardless of whether returnWindowDays was also found in that email. Still not closed: an order whose every email links nowhere AND states its own return window inline never gets a portal URL, since the web lookup (the only other source) only runs when returnWindowDays is null.
- Include the return portal URL in reminder emails themselves (currently only the dashboard/detail pages show it) — the whole point of a reminder is prompting action, and the portal link is the most direct way to act

---

# Milestone 9: Admin Notifications

## Goal — the only thing that counts as "done"

> The admin (me) finds out immediately when something needs a human: a new user's Gmail-forwarding verification email arrives, or the daily reminder cron sends/fails something — without having to go digging through logs or the database to notice.

This is purely an operational visibility milestone, not a user-facing feature — nothing here changes what any signed-in user sees.

## Why this design (read before building)

- **Gmail's forwarding verification email is not commerce mail and must never be stored or classified as one.** It's not addressed to a real person checking an inbox — it lands straight in a user's inbound address because that's literally what the user is setting up forwarding *to*. It needs to be detected and handled before the commerce-classification step, the same way the inbound-token routing check happens before classification: there's no reason to spend an AI call on something whose sender + subject are this distinctive, and it's wrong to store something that isn't actually the user's shopping mail.
- **Detection by sender + subject, not AI.** `forwarding-noreply@google.com` plus one of two known subject strings is exact and free — no ambiguity that would justify a classifier call.
- **Extraction is best-effort; the raw email is always included as a fallback.** Gmail's confirmation code/link formatting isn't a documented, stable API — regex-based extraction could miss on a format change. Rather than risk losing the information if a pattern stops matching, the admin notification always includes the full raw subject + body underneath whatever was auto-extracted, so a missed match costs the admin one extra line of reading, not the information itself.
- **The admin notification names the user's account email AND their full inbound address.** "Which +tag address it came from" alone is a `cuid`-based token a human can't immediately place; pairing it with the account's actual email makes "which user" answerable at a glance.
- **A shared `notifyAdmin()` helper, not three separate Postmark calls.** Both the verification-email handler and the cron summary need the exact same "send to ADMIN_EMAIL, and never let a failure here break the real flow that triggered it" behavior — centralized once in `lib/adminNotify.ts` rather than duplicated with subtly different error handling in two places.
- **The magic-link BCC reuses the existing `sendEmail` call, not a separate send.** A true BCC (not a second independent email) means the admin sees exactly what the user received, in the same thread context a mail client would group it in — and it's one optional field on a call that already exists, not new code.
- **The cron summary only sends when something happened.** A daily "0 reminders sent, 0 failures" email would be pure noise for what's meant to be an exception/activity signal. It sends whenever `sent.length > 0 || failed.length > 0` — a quiet day produces no email at all. (Worth revisiting if "confirm the cron is even running" becomes a real concern — that's a different signal than this milestone's "something needs your attention.")
- **A missing user/order linkage on an order at reminder time is now treated as a failure, not a silent skip.** `userId` has been required on Order since Milestone 8; an order with no resolvable user shouldn't happen anymore, so if it does, the admin should hear about it rather than have it disappear into a `continue`.

## What got built

- `lib/gmailVerification.ts` — `isGmailForwardingVerification()` (sender + subject match) and `extractVerificationDetails()` (best-effort code/link regex extraction).
- `lib/adminNotify.ts` — `notifyAdmin(subject, textBody)`, sends to `ADMIN_EMAIL` from `REMINDER_FROM_EMAIL`, logs and swallows its own failures (a missing `ADMIN_EMAIL` or a Postmark error here never breaks the inbound webhook or the cron run).
- `lib/postmark.ts` — `sendEmail()` now accepts an optional `bcc`.
- `app/api/inbound/route.ts` — checks for a Gmail verification email right after resolving the user (so the notification can name them) and before commerce classification; on a match, notifies the admin with the user's account email, full inbound address, extracted code/link, and the raw subject + body, then returns 200 without storing anything.
- `auth.ts` — the magic-link send now BCCs `ADMIN_EMAIL`.
- `app/api/cron/route.ts` — `sent`/`failed` entries now carry `orderNumber` and `userEmail`; after the run, `buildAdminSummary()` lists every reminder sent (retailer, order number, reminder type, recipient, a direct link to the order) and every failure (same fields plus the error), and `notifyAdmin()` is called only if there's something to report.
- `ADMIN_EMAIL` added to `.env` and all three Vercel environments.

## How to know it works

1. Forward a synthetic email from `forwarding-noreply@google.com` with subject containing "Gmail Forwarding Confirmation" — confirm it never appears as an Email row, and an admin notification arrives with the code/link parsed out plus the raw body underneath.
2. Sign in via a real magic link — confirm `ADMIN_EMAIL` receives a BCC of the exact same email the user got.
3. Trigger the cron with `force=true` against a **disposable/non-production order set** — confirm the admin summary lists the right retailer, order number, reminder type, and recipient for each send. *(Caution learned the hard way while building this: `force=true` against real orders creates real `Reminder` rows for whatever threshold it nearest-matches to, even if the order isn't actually at that day-count — which then blocks the order's genuine reminder at that threshold from ever firing later. Don't force-test against real orders without deleting the resulting `Reminder` rows for any threshold that wasn't actually due.)*
4. Confirm a quiet cron run (nothing eligible) sends no admin email at all.

## Copy-paste prompts for Claude Code

**Prompt 21 — admin notifications**
> Per BUILD.md's Milestone 9 section: detect Gmail forwarding-verification emails in /api/inbound by sender + subject before commerce classification, extract the confirmation code/link best-effort, and notify ADMIN_EMAIL with the user's account email, inbound address, extracted details, and the raw email as a fallback — never store these as a normal Email row. Add a shared lib/adminNotify.ts helper. BCC ADMIN_EMAIL on every magic-link send. After each cron run, email ADMIN_EMAIL a summary of every reminder sent and failed (retailer, order number, recipient, error if any) — but only when there's something to report. Add ADMIN_EMAIL everywhere REMINDER_FROM_EMAIL already exists.

---

# Milestone 10: Needs Review Resolution + Admin Dashboard

## Goal — the only thing that counts as "done"

> A flagged order doesn't just sit there forever. Either I (the user) or the admin can look at it, understand why it was flagged, decide it's fine or actually two different orders, and resolve it — with the resolution itself, and whatever explanation was given, visible afterward, not lost.

This is the resolution half of a loop Milestone 3 only opened: prefix-match merges and missing-deadline orders get flagged, but nothing before this milestone ever let anyone *close* that flag with a real decision.

## Why this design (read before building)

- **One shared resolution engine, two front doors.** `lib/orderReview.ts`'s `approveOrder()` and `splitOrder()` contain all the actual logic and do zero access control — exactly like `linkEmailToOrder` doesn't do auth either. The user-facing dashboard action (`app/actions.ts`) checks `session.user.id` ownership; the admin action (`app/admin/actions.ts`) checks `ADMIN_SECRET` instead. Two different gates calling the same engine, not two different implementations that could quietly drift apart.
- **"Looks correct" is an explicit override; "Split" isn't.** Approving forces `needsReview: false` outright — a human directly asserted this is fine, full stop. Splitting only resolves *one* question ("are these the same order") and deliberately leaves `needsReview` to the normal data-completeness recompute on both resulting orders — confirmed by a real test: splitting a synthetic order whose remaining email still had no return deadline left it correctly flagged again, for a genuinely different (and still true) reason. Conflating "wrong match" and "incomplete data" under one flag was already a known shortcut; this milestone doesn't fix that, but it does make sure resolving one doesn't silently paper over the other.
- **Splitting re-derives the original order's fields, it doesn't just detach an email.** `mergeEmailIntoOrder`'s additive merge (Milestone 3) was built assuming emails only ever get added, never removed — split breaks that assumption. `rebuildOrderFromRemainingEmails()` replays the same fold logic from scratch over whatever emails are left, so a split order doesn't keep stale data the departing email had contributed. `createOrderFromEmail()` was extracted out of `linkEmailToOrder`'s old inline "no match" branch so both the normal linking path and the new split path build a fresh Order the same way.
- **The note lives on the Order the human was looking at, not wherever the split data ends up.** Both actions accept an optional note; it's always saved on the order the review card belonged to, regardless of which button was pressed — splitting creates a second order, but the explanation is about the *decision*, made on the order being reviewed.
- **The admin dashboard is a query param, not a login.** `ADMIN_SECRET` is checked statelessly on every page load and every action — no session, no cookie, nothing to expire or to leave logged in on a shared computer. An invalid or missing secret 404s, not a "wrong password" page, since the URL itself is meant to be unguessable and is never linked from anywhere a user would see.
- **`DiscardLog` is a count, not a record.** The non-commerce discard path has never stored what it discarded — that's the whole point of the discard. Showing "how often does this happen" without ever knowing "what was it" needed a model with no email content and no userId: just a reason and a timestamp. Anything richer would have undermined the exact privacy guarantee this milestone is supposed to make visible, not work around.

## What got built

- **Schema**: `Order.userNote` (nullable text, not encrypted — it's the user's own note about their own order, and the admin dashboard reads it directly), and a new `DiscardLog` model (`reason`, `occurredAt`, nothing else).
- **`lib/linkOrder.ts`**: `createOrderFromEmail()` and `rebuildOrderFromRemainingEmails()` exported and reused by the split path; no behavior change to the existing linking flow.
- **`lib/orderReview.ts`**: `approveOrder(orderId, note)`, `splitOrder(orderId, note)`, and `reviewReason(order)` (the same best-effort "why was this flagged" heuristic — most recent email's `extractionNotes`, falling back to a missing-deadline or prefix-match-shaped message — shared by both UIs).
- **`lib/adminAuth.ts`**: `isValidAdminSecret()`, the one place `ADMIN_SECRET` gets checked.
- **Dashboard** (`app/page.tsx`): a "Needs Review" section using a native `<details>` element — open by default only when there's something in it, so it's never a wall of empty chrome on a clean account. Each card shows the retailer/order number, the review reason, any existing note, and `app/ReviewActions.tsx` (a small client component: one textarea, two submit buttons sharing it via `formAction`).
- **`app/api/inbound/route.ts`**: a `DiscardLog` row is created on every non-commerce discard.
- **Admin dashboard** (`app/admin/page.tsx` + `app/admin/actions.ts`): Needs Review (all users, with the owning account's email, the triggering email subjects, and any user note), Recent Users (email, join date, order/email counts, last email received), Recent Sends (last 50 reminders with recipient and order), Discard Log (non-commerce discards bucketed by day, last 30 days).
- `ADMIN_SECRET` added to `.env` and all three Vercel environments (`ADMIN_EMAIL` was already there from Milestone 9).

## How to know it works

1. Create or find a real flagged order; confirm the dashboard's "Needs Review" section is expanded and shows a sensible reason.
2. Leave a note and click "Looks correct" — confirm `needsReview` clears and the note persists (re-flagging the order from a fresh prefix match later should still work normally).
3. On a multi-email flagged order, click "Split into separate order" — confirm a new Order appears with the most recently received email, the original order's data no longer reflects that email's contribution, and both orders' statuses look right independently.
4. Visit `/admin` with no secret and with a wrong secret — confirm 404 both times. Visit with the correct secret — confirm all four sections render with real data.
5. Approve or split from the admin dashboard — confirm it has the identical effect as the user-facing action (same underlying functions).
6. Forward a piece of marketing mail and confirm a `DiscardLog` row appears, bucketed under today's date in the admin Discard Log — and that nothing about its content is stored anywhere.

## Copy-paste prompts for Claude Code

**Prompt 22 — needs-review resolution + admin dashboard**
> Per BUILD.md's Milestone 10 section: add Order.userNote and a content-free DiscardLog model, migrate. Build lib/orderReview.ts with approveOrder/splitOrder (no auth inside — callers gate it) plus a shared reviewReason heuristic, extracting createOrderFromEmail and a rebuildOrderFromRemainingEmails replay helper out of lib/linkOrder.ts for the split path to reuse. Add a "Needs Review" section to the dashboard (collapsed via a native <details> when empty) with a note textarea and Approve/Split buttons, scoped by session ownership. Build /admin, gated statelessly by an ADMIN_SECRET query param (404 on mismatch, never a login form), with the same two actions plus Recent Users, Recent Sends, and a Discard Log bucketed by day. Log every non-commerce discard to DiscardLog. Add ADMIN_SECRET everywhere ADMIN_EMAIL already exists.

---

## What comes after Milestone 10 (not now)

- The "needs review for a wrong match" vs. "needs review for incomplete data" distinction is still conflated under one boolean — fine for now, but a real reason-code field would let both UIs stop guessing via heuristics like `reviewReason()`
- Admin actions don't currently let the admin leave their own note (only users can) — deliberate scope cut, not an oversight, but worth revisiting if the admin starts wanting to record their own reasoning
- The admin dashboard has no pagination on any section — fine at current volume, not at 10x
- `lastEmailByUser` in the admin page is one query per user (N+1) — acceptable today, would need a real aggregate query if the user base grows past a couple dozen

---

# Milestone 11: Alpha UX Polish

Five small, independent fixes ahead of opening up to alpha users — not a new feature, just removing friction that would otherwise be the first thing a new user notices.

- **Instant search/filter, no Apply button.** `app/SearchFilterBar.tsx` (new client component) replaces the old `<form method="get">`. The text input debounces 300ms before pushing a `router.replace` with updated `q`/`status` params; the status `<select>` updates immediately (a dropdown choice isn't "keystrokes," so no debounce). All actual filtering/sorting stays server-side exactly as before — this only changes *how* the URL params get there, not who reads them.
- **Needs Review disappears entirely when empty**, instead of showing a collapsed-but-visible bar. A truly empty state should look like nothing changed, not like there's a feature waiting to be noticed.
- **Renamed "Returns Assistant" → "Return Window" everywhere it appeared**: page title/metadata, the sidebar, both login pages, the magic-link email subject/body, the cron reminder email's signature, and the admin run-summary subject. (Milestone 8 had explicitly deferred this exact rename at the time — see that section's design notes — this is the deliberate reversal of that earlier call, not an inconsistency.)
- **Stat cards**: Playfair Display (added via `next/font/google`, exposed as `--font-playfair`/`font-playfair`) for the large number, a 3px top accent bar per card (rose for open returns, amber for closing soon, a new custom `sage` color for value at risk — Tailwind v4's default green/emerald read too saturated for the cream/blush palette, so `--color-sage` was added directly in `app/globals.css`'s `@theme` block), and more generous padding (`p-5` → `p-6`).
- **Missing-total guidance.** An order missing `orderTotal` (because only a shipping/delivery email was ever forwarded, not the order confirmation — confirmed against two real orders, Shopbop and a second Mango order) now shows "Forward your order confirmation to add the total" in small muted text under the retailer name, instead of just a blank "—" the user has to guess the meaning of.

## How to know it works

1. Type in the dashboard search box — confirm the URL updates ~300ms after the last keystroke, with no Apply button anywhere and no page flash/reload.
2. Change the status filter — confirm it updates immediately.
3. On an account with zero flagged orders, confirm there's no amber bar of any kind above the orders table.
4. Confirm "Return Window" appears on the page title, the sidebar, both login pages, and a real magic-link email (subject and body).
5. Confirm the three stat cards show a serif number, a colored top edge matching their meaning, and visibly more padding than before.
6. Find (or create) an order with no total and confirm the guidance text appears under its retailer name; confirm an order that does have a total shows nothing extra.

## Copy-paste prompts for Claude Code

**Prompt 23 — alpha UX polish**
> Per BUILD.md's Milestone 11 section: make dashboard search/filter instant via a debounced client component instead of a submit button, hide the Needs Review section entirely (not collapsed) when there's nothing in it, rename "Returns Assistant" to "Return Window" everywhere it appears in the app, redesign the stat cards with a Playfair Display number and a colored top accent bar per card, and add a small "Forward your order confirmation to add the total" note under the retailer name on any order missing its total.

---

# Milestone 12: Maximize Single-Email Extraction

## Goal — the only thing that counts as "done"

> Forwarding just one shipping or delivery confirmation — never the order confirmation — still gets a real order total, item list, order date, and return link whenever that information is actually present in the email, instead of waiting for a second forward that may never come.

The product reality this addresses: users forward whatever email happens to catch their attention, often a shipping or delivery notification, not the order confirmation. The old prompt told the model to treat shipping confirmations as a deliveryDate-only email type, leaving real, present-in-the-body data on the table.

## Why this design (read before building)

- **The old per-type guidance was the actual bug.** "For shipping confirmations: focus on deliveryDate" wasn't just unhelpful — it told the model to deprioritize fields that retailers frequently *do* restate in shipping/delivery emails (total, items, order date). Rewriting that guidance to extract aggressively from every email type, regardless of emailType, was the core fix; nothing about the web-lookup firing condition needed to change, since it was never actually gated by emailType in code — the gap was upstream, in what the model was told to bother looking for.
- **Deriving a total by summing line items is allowed, but flagged as derived, not stated.** The prompt explicitly tells the model to say so in `notes` and cap confidence at "medium" when it computes rather than reads a total — that distinction matters downstream (a derived sum can miss tax/shipping/discounts in either direction).
- **The email's own return link now wins over the web lookup**, instead of being structurally impossible to capture. `RawExtraction` gained `returnPortalUrlFromEmail`, kept distinct from `ExtractionResult.returnPortalUrl` (the final, merged value) so the two sources never get confused in `extractEmail`'s merge logic. Previously `returnPortalUrl` could *only* ever come from the web lookup, and the web lookup only ever ran when `returnWindowDays` was null in the email — meaning an order whose every email stated its policy inline could never get a portal URL at all. Now the email's own link is read independently of that.
- **A real regression, caught by testing against real data, not assumed away.** Making shipping/delivery extraction this much more aggressive immediately exposed a latent bug in `lib/linkOrder.ts`'s merge logic: a multi-package Old Navy order's correct $433.64 total (from its order_confirmation) got silently overwritten by two shipping emails' own *partial-package* totals (e.g. "Package total: $21.84" for one box of five) — because the merge rule was simply "newest non-null wins," with no concept that an order_confirmation is the only email type that reliably describes the *whole* order. `resolveOrderTotal()` now checks for an order_confirmation among the order's already-linked emails and treats its total as authoritative once present, never letting a different email type's number override it. This bug predates this milestone — the old prompt's narrow shipping guidance just meant it almost never had a chance to fire.

## What got built

- `lib/extract.ts`'s prompt rewritten: explicit instructions for harder order-total extraction (check for "total"/"amount"/"charged", sum stated subtotal+charges, sum line items as a last resort with a confidence cap), line-item extraction from any email type, order-date extraction from shipping/delivery emails when explicitly restated, and `returnPortalUrlFromEmail` extraction from any return-related link in the body.
- `extractEmail()`'s merge logic: the email's own return link is checked first, the web lookup's URL is only used as a fallback when the email had none.
- `lib/linkOrder.ts`'s `resolveOrderTotal()`: order_confirmation totals are authoritative once known; no other email type can override them. Used inside `mergeEmailIntoOrder`, so this protection applies to ordinary linking, the prefix-match path, and the split-order rebuild path identically.
- `scripts/reextract-all-emails.ts`: a permanent record of the one-time backfill, re-running extraction on every existing email.

## How to know it works

1. Forward only a shipping or delivery confirmation (no order confirmation) for an order where the email itself states a total or lists priced items — confirm the resulting Order gets a real `orderTotal`, not null, and that `extractionNotes` says whether it was read directly or summed.
2. Confirm an order with a real order_confirmation keeps that email's total even after later shipping/delivery emails for the same order are linked (this was the exact regression caught and fixed) — verified directly against real data: a real Old Navy order's total was confirmed unchanged at $433.64 after re-linking all six of its emails, while two real previously-null totals (a Shopbop order and a second Mango order) picked up real, derived totals ($112.50 and $539.97) with no other order's data disturbed.
3. Forward an email containing a return-policy or "how to return" link — confirm the Order's `returnPortalUrl` reflects that link, even when the same email also stated its own return window (previously structurally impossible).

## Copy-paste prompts for Claude Code

**Prompt 24 — maximize single-email extraction**
> Per BUILD.md's Milestone 12 section: rewrite lib/extract.ts's prompt to extract order total (try harder before nulling — check for stated totals, summed charges, or sum line items as a last resort with a confidence cap), line items, and order date aggressively from shipping/delivery confirmations, not just order confirmations, and extract any return-policy link in the email body as returnPortalUrlFromEmail, preferring it over the web lookup's URL. Fix lib/linkOrder.ts's merge logic so an order_confirmation's total, once known, can never be overwritten by a different email type's (e.g. a shipping email's partial-package total). Re-extract all existing emails to backfill, verifying against real data that nothing regresses.

---

---

# Milestone 13: Plain-Language Needs Review

## Goal — the only thing that counts as "done"

> A user looking at a flagged order understands *why* at a glance, in plain English — without reading a paragraph of AI extraction reasoning meant for debugging, not for them.

## Why this design (read before building)

- **The label and the technical note answer different questions, so they're not the same string.** `reviewReasonLabel()` translates the same underlying signals `reviewReason()` already inspects (prefix-match mismatch, missing orderDate, low confidence, missing orderTotal) into one short, human sentence — checked in priority order, most specific and actionable first. `reviewReason()` keeps returning the raw, technical text; it didn't need to change at all, just be displayed differently depending on audience.
- **"2 sentences" had to mean "actually short," not "split on periods."** Real extraction notes chain several distinct observations with semicolons into one long, period-terminated sentence (confirmed against a real flagged order: a 2-period note was ~500 characters). Splitting strictly on `.!?` would have "truncated to 2 sentences" without truncating anything meaningful. `truncateToSentences()` also splits on semicolons — an approximation, not a grammar rule, but the one that actually serves the stated goal of a short, scannable preview.
- **No new persisted reason code.** Detecting "was this a prefix match" reuses the same signal already available — does any linked email's own `orderNumber` differ from the order's `orderNumber`. No schema change needed; this is the same kind of best-effort inference `reviewReason()`'s fallback text already did.
- **The admin dashboard gets the label too, but never the truncation.** The full technical note stays exactly as useful as before for debugging; the label is just additional, cheap context layered on top, not a replacement.

## How to know it works

1. A flagged order from a prefix match shows "We matched this return email to an existing order — please confirm it's correct" on the dashboard, with a separate, visibly shorter line of technical detail below it and a "Read more" toggle that expands to the full text.
2. The admin dashboard shows the same plain-language label, but the technical detail underneath is the complete, untruncated text with no toggle.
3. Confirmed against all five cases (one real, four synthetic): prefix match, missing orderDate, low confidence, missing orderTotal, and the generic fallback each produce their distinct, correct label.

## Copy-paste prompts for Claude Code

**Prompt 25 — plain-language Needs Review reasons**
> Per BUILD.md's Milestone 13 section: add reviewReasonLabel() to lib/orderReview.ts, translating the existing needsReview signals (prefix-match order-number mismatch, missing orderDate, low confidence, missing orderTotal, generic fallback) into plain-language labels, checked in that priority order. Add truncateToSentences() (splitting on semicolons as well as sentence-ending punctuation, since real extraction notes chain clauses with semicolons) and a client-side read-more toggle component. Show the label always on the dashboard's Needs Review cards, with the truncated technical note below it; show the label plus the full untruncated note on the admin dashboard.

---

---

# Milestone 14: Compact Needs Review + Mobile Dashboard

## Goal — the only thing that counts as "done"

> The Needs Review card is a glance, not a wall of text — only the label, retailer, and the two actions are visible until you ask for more. The dashboard is genuinely usable on a phone: stacked cards instead of a horizontally-scrolling table, a bottom nav instead of a sidebar that doesn't fit, everything full-width and stacked below 768px.

## Why this design (read before building)

- **The note-writing textarea had to move behind the same toggle as the technical detail, not stay separate.** The brief named only the label, retailer, and two buttons as always-visible — the textarea wasn't on that list, and a 2-row textarea would have blown past the size target on its own. But the textarea needs to share one `<form>` with the always-visible buttons (so "Looks correct" still submits correctly whether or not the user ever expanded), so `ReviewCard.tsx` replaced both the old `ReviewActions.tsx` and a `ReviewDetail.tsx` that was started and then merged in — one client component owns the toggle state, the revealed detail, the conditionally-rendered textarea, and the form together, since splitting them across components would have meant passing the same boolean down three separate paths for no benefit.
- **"Roughly 80px" met reality: long labels wrap.** Measured directly (Playwright, not guessed): the longest label ("We matched this return email to an existing order — please confirm it's correct") wraps to two lines at 390px width, and two-line text plus padding doesn't fit in 80px no matter how tight the surrounding spacing gets. Tightened everything that could be tightened (p-3→p-2.5, smaller buttons, `leading-tight`) and landed at ~110px for that worst-case label — confirmed via real screenshots, not assumed. Shorter labels collapse closer to the original target; the height varies by label length, which is expected, not a bug.
- **One mobile breakpoint (768px/`md:`), used consistently.** The stat cards previously broke to 3 columns at 640px (`sm:`) while the table→cards switch needed to happen at 768px — left as-is, there'd have been an awkward zone between 640–768px with 3-column stat cards above a single-column card list. Moved the stat grid to `md:` too, so the whole dashboard switches layouts at exactly one width.
- **Hand-rolled SVG icons for the bottom nav, not a new icon library dependency.** Three glyphs (home, bell, gear) don't justify adding a package — matches the app's existing restrained visual language (it already uses plain Unicode for ✕, ↑, ↓, →, ▾ rather than an icon set anywhere else).
- **Verified with real screenshots, not just class names in markup.** Installed Playwright temporarily (`npm install --no-save`, removed afterward — never touched `package.json`) and rendered the actual dashboard at 390×844 (iPhone 15) and 1280×900 (desktop) against real data. This caught the actual collapsed-card height (109px, not the guessed 80px) and confirmed the desktop view has zero regressions — something markup inspection alone couldn't have shown.

## What got built

- `app/ReviewCard.tsx` (replaces `ReviewActions.tsx`): renders the retailer/order-number line, the "Read more" toggle, the conditionally-revealed extractionNotes + userNote + note textarea, and the two always-visible action buttons, all sharing one collapse state.
- `app/page.tsx`'s Needs Review card: now just the plain-language label (`leading-tight`, `p-2.5`) plus `<ReviewCard>` — no separate header row, no always-visible note text.
- `app/SearchFilterBar.tsx`: `flex-col` below `md:`, full-width input/select, row layout from `md:` up.
- Stat card grid: `sm:grid-cols-3` → `md:grid-cols-3`.
- New mobile order cards in `app/page.tsx` (`md:hidden`), alongside the existing table (now `hidden md:block`): avatar + retailer + order number, a prominent color-coded `DaysLeftChip`, a large Playfair total, return date, "Start return →", and delete — same data as the desktop table, restacked.
- `app/BottomNav.tsx` (new, `md:hidden`, fixed to the bottom): Dashboard/Alerts/Settings with hand-rolled SVG icons and the same alert-count badge the sidebar shows. `app/Sidebar.tsx` gained `hidden md:flex`.
- `<main>` gained `pb-20` on mobile so content isn't hidden behind the fixed bottom nav.

## How to know it works

1. At 390px width, the Needs Review card shows only the label, retailer/order number, "Read more," and the two buttons — nothing else — until "Read more" is tapped, which reveals the technical note, any user note, and the note textarea in place.
2. At 390px, the dashboard shows stacked order cards (not a table), the search/filter bar stacked full-width with no Apply button, single-column stat cards, and a bottom nav with Dashboard/Alerts/Settings icons instead of the sidebar.
3. At desktop widths, nothing regressed: sidebar, table, inline search bar, and 3-column stat cards all render exactly as before.

## Copy-paste prompts for Claude Code

**Prompt 26 — compact Needs Review + mobile dashboard**
> Per BUILD.md's Milestone 14 section: collapse the Needs Review card to just the plain-language label, retailer/order number, and the two action buttons, moving the technical note, user note, and the note-writing textarea behind one "Read more" toggle that still submits correctly via the same form as the always-visible buttons. Make the dashboard responsive below 768px: stacked order cards instead of the table, a fixed bottom nav (Dashboard/Alerts/Settings) instead of the sidebar, single-column stat cards, and a full-width stacked search/filter bar. Verify with real screenshots at 390×844 and at a desktop width, not just by inspecting class names.
---

# Milestone 15: Return Policy Display + Data Cleanup

## Goal — the only thing that counts as "done"

> The order detail page tells you the return policy in one readable sentence — what it is, what it counts from, and where it came from — with a spot-check link nearby, instead of two separate jargon-y fields ("Return window: 30 days", "Policy source: Web lookup") that don't say anything about what the window actually counts from.

## Why this design (read before building)

- **`returnWindowStartsFrom` had been computed and silently discarded since Milestone 3.** `lib/extract.ts` always returned it from the AI extraction, and `computeDeadline()` already had real logic to anchor on order date vs. delivery date depending on it — but neither `Email` nor `Order` had a column for it, so every call site hardcoded `returnWindowStartsFrom: null`, permanently defaulting to delivery-anchored even when an email explicitly stated otherwise. Displaying it correctly (this milestone's actual ask) required persisting it first — a one-line schema gap with a real, silent effect on computed deadlines whenever both an order date and a delivery date were known and a retailer's policy counted from the order date instead.
- **Wiring it through is a correctness fix, not just a display fix.** Once the real value is persisted and used, `returnDeadline` itself can change for orders where the policy counts from order date — verified directly: re-running the (corrected) backfill is idempotent and produces *zero* further changes against current data, confirming today's deadlines are already consistent with the now-real anchor.
- **A backfill regression, caught by diffing real data, not assumed safe.** The first version of the backfill script called `rebuildOrderFromRemainingEmails()` to pick up the new field, which (for orders whose only orderDate came from `applyFallbackOrderDate`'s forwarded-header-text parsing) re-ran that parsing. `new Date("Jun 5, 2026 12:04 PM")` resolves in whatever timezone the *current process* happens to run in — re-deriving it from a local machine instead of the Vercel function that originally processed the email silently shifted two real orders' dates and deadlines by exactly the local UTC offset (7 hours). Caught by diffing a before/after snapshot, reverted, and rewritten to be surgical: only set `returnWindowStartsFrom` and recompute `returnDeadline` from the order's *existing* `orderDate`/`deliveryDate`, never re-deriving either. The underlying `parseForwardedHeaderDate` timezone fragility is a separate, pre-existing latent bug — not fixed here, just newly visible.
- **Only "Web lookup" gets linked.** It's the one source with somewhere useful to send a skeptical user — the actual page that was searched, or a Google search as a fallback when there's no `returnPortalUrl` to point to. "Stated in email" and "user supplied" have no comparable destination, so they stay plain text.
- **The "View return policy" link reuses `returnPortalUrl`, same as "Start Return."** There's only one URL field on `Order` — the brief explicitly accepted this ("if we have a separate policy URL, otherwise the same URL is fine"), so no schema change was needed for this part. The two links serve different intents (verify the policy vs. act on it) even though they currently point to the same place.

## What got built

- `Email.returnWindowStartsFrom` / `Order.returnWindowStartsFrom` (migration), persisted in `lib/runExtraction.ts` and merged in `lib/linkOrder.ts` (same precedence pattern as every other merged field) across `mergeEmailIntoOrder`, `createOrderFromEmail`, and `rebuildOrderFromRemainingEmails`. `applyFallbackOrderDate` and `mergeEmailIntoOrder` now pass the real value into `computeDeadline()` instead of a hardcoded `null`.
- `scripts/backfill-return-window-starts-from.ts`: recovers the value for all 16 existing emails from their already-stored `extractionRaw` (no AI re-call needed), then recomputes each order's `returnWindowStartsFrom` + `returnDeadline` from existing dates only.
- `app/orders/[id]/page.tsx`: `PolicyLine()` replaces the separate "Return window" / "Policy source" fields with one "Return policy" field (e.g. "30 days from order date — Web lookup", linked); a small "View return policy →" link added under "Return deadline," distinct from the existing "Start Return →" action button.
- **Data cleanup**: confirmed two `return_label` emails on the real Mango `F4VLSF` order were a genuine duplicate (two distinct Postmark `MessageID`s 8 seconds apart, identical body — the user's mail client sent the same forward twice, not a webhook retry or a display bug). Deleted the later one. Documented under "Known matching limitations," alongside a new note about Mango split-shipment sub-order numbers (e.g. `F4VLSF-1`) fragmenting into separate Orders today — flagged for monitoring during alpha, not fixed yet.

## How to know it works

1. An order whose policy came from a web lookup shows one line like "30 days from delivery date — Web lookup," with "Web lookup" linking to the real return-policy page (or a Google search if there's no portal URL on file).
2. An order with no stated return window shows "—" for the whole line, not two separate dashes.
3. A "View return policy →" link appears under the return deadline whenever a portal URL exists, distinct from "Start Return →" elsewhere on the page.
4. Re-running `scripts/backfill-return-window-starts-from.ts` against already-backfilled data produces zero changes (confirmed) — idempotent, safe to re-run.

## Copy-paste prompts for Claude Code

**Prompt 27 — return policy display + data cleanup**
> Per BUILD.md's Milestone 15 section: add Email/Order.returnWindowStartsFrom (it was already computed during extraction but never persisted), wire it into lib/linkOrder.ts's merge logic and computeDeadline calls so it actually affects deadline anchoring, and backfill existing data from extractionRaw without re-deriving orderDate (verify any backfill script's side effects against a real before/after diff, not assumption). On the order detail page, combine the return-window and policy-source fields into one line with the web-lookup source linked to returnPortalUrl (or a Google search fallback), and add a separate small "View return policy" link near the return deadline. Separately, investigate any suspected duplicate Email rows by comparing Postmark MessageIDs in the decrypted rawJson before deleting anything.

---

# Milestone 16: Weekly Alpha Coverage Check

## Goal — the only thing that counts as "done"

> Every Friday, each alpha user gets a short, personal "did we catch everything you bought this week?" email listing what Return Window saw from them — so silent extraction gaps (a forward that got discarded, missed, or never sent) surface as a reply from the user instead of staying invisible.

This isn't a product feature — it's an alpha-only operational signal, gated so it can't accidentally reach a real user base later.

## Why this design (read before building)

- **A separate route and cron schedule, not day-of-week branching inside the existing one.** The daily deadline-reminder cron and this weekly check are genuinely different concerns (per-order vs. per-user, daily vs. weekly) — cramming both into one route would mean every invocation has to figure out which job it's actually being asked to do. `app/api/cron/weekly-coverage/route.ts` is its own route with its own `vercel.json` schedule entry (`0 16 * * 5`), reusing the same `CRON_SECRET` auth pattern as the existing one.
- **`Reminder.orderId` had to become optional, and a direct `userId` added.** This check has no specific order behind it — it's "here's everything we saw from you this week." The existing `@@unique([orderId, reminderType])` constraint doesn't (and can't, in Postgres) enforce "once per user per week" for null-orderId rows, so the actual dedupe is a code-level check: has this user already gotten a `weekly_coverage_check` reminder in the last 7 days? Since the `Reminder` table was completely empty at the time, widening the schema needed no backfill.
- **That schema change touched more than the new route.** `Reminder.orderId` going nullable meant `app/admin/page.tsx`'s "Recent Sends" section — which joined through `order.user.email` — would have crashed on any weekly-check row. Switched it to read `reminder.user` directly (now always present) and render "—" for the order column when there isn't one. `app/settings/actions.ts`'s `deleteAllData` had the same problem in reverse: it deleted reminders by `{ order: { userId } }`, which would silently *miss* weekly-check rows (no order to join through) on account deletion. Both fixed before this shipped, not discovered later.
- **`ALPHA_MODE` is a real off switch, not a vestigial flag.** Checked first, before anything else runs. The whole point of this feature is that it's appropriate for a handful of known alpha testers and inappropriate at any real scale — the gate has to default to *not* sending, and "alpha mode" has to be something a future self can flip off in one place without touching code.
- **Verified with a real send to all three real users, not a dry run.** Asked first, since it's not just testing against the one account this whole project has been built and tested with — it reaches two other real people. Confirmed: all three got their actual coverage line (5 orders, 2 orders, 0 orders this week respectively), the dedupe correctly skipped all three on a second run, and the `ALPHA_MODE=false` gate correctly no-ops without sending anything.

## What got built

- `prisma/schema.prisma`: `Reminder.orderId` now optional, `Reminder.userId` added (required) with a `User.reminders` back-relation. `reminderType` can now be `"weekly_coverage_check"` alongside the existing deadline types.
- `app/api/cron/weekly-coverage/route.ts`: for each user, checks for a `weekly_coverage_check` reminder sent in the last 7 days (skips if found, unless `?force=true`), gathers that user's emails received in the last 7 days, dedupes by order (several emails about the same order this week produce one line, not one per email), builds the email, sends via Postmark, and records the `Reminder` row. Notifies the admin with a summary, same pattern as the existing cron.
- `app/api/cron/route.ts`: now passes `userId: order.userId` when creating per-order `Reminder` rows, since the field is required.
- `app/admin/page.tsx` and `app/settings/actions.ts`: updated for the schema change (see above).
- `vercel.json`: added the Friday 16:00 UTC schedule entry.
- `ALPHA_MODE` added to `.env` and all three Vercel environments, set to `true`.

## How to know it works

1. Hitting the route with the cron secret and `ALPHA_MODE=true` sends each user their real coverage check, lists orders correctly (deduped per order, falling back to "1 order from X" when there's no total), and records one `Reminder` row per user.
2. Running it again immediately skips everyone (already sent this week) — confirmed, no duplicate sends.
3. Setting `ALPHA_MODE=false` makes the route no-op entirely (confirmed: `{"skipped":true,...}`, nothing sent, nothing recorded).
4. The admin dashboard's "Recent Sends" section shows weekly-check rows with the user's email and "—" in the order column, without crashing.

## Copy-paste prompts for Claude Code

**Prompt 28 — weekly alpha coverage check**
> Per BUILD.md's Milestone 16 section: add a new /api/cron/weekly-coverage route (own Friday 16:00 UTC schedule in vercel.json, same CRON_SECRET auth as the existing cron) that emails each user a personal "did we catch everything you bought this week?" check-in listing their orders from the last 7 days, deduped per order. Make Reminder.orderId optional and add a required Reminder.userId, since this reminder type has no order — dedupe "once per user per week" via a recent-send query, not the existing per-order unique constraint. Update every place that reads Reminder through the order relation (admin dashboard, deleteAllData) to handle a null order. Gate the whole feature behind ALPHA_MODE, defaulting to off. Before testing with real sends, confirm with the user since it reaches every real user in the database, not just the one this project is normally tested against.

---

# Milestone 17: Fix computeDeadline()'s Order-Date Shipping Buffer Bug

## Goal — the only thing that counts as "done"

> When a policy explicitly counts from order date and there's no delivery date yet, the deadline is exactly orderDate + returnWindowDays — not orderDate + 7 days of guessed shipping time + returnWindowDays.

## Why this design (read before building)

- **The 7-day buffer's only job is to guess a missing delivery date.** It exists for the case where the policy counts from delivery but we don't have one yet — STANDARD_SHIPPING_DAYS is a placeholder for "how long until this probably arrives." When the policy counts from order date instead, there's no delivery date to estimate in the first place; adding the buffer anyway was simply double-counting days that don't belong in the calculation at all. Caught on a real order (On/On-Running, ordered Jun 27, 30 days from order date) where it pushed the deadline a full week later than it should be — Aug 3 instead of Jul 27.
- **`deadlineIsEstimated` should be false here, not true.** The flag means "the date this counts from was guessed, not known." When the policy counts from order date and the order date is known (it always is, by definition, to reach this branch), nothing about the calculation is estimated — it's exact.
- **Only the second branch of `computeDeadline()` had this bug.** The first branch (deliveryDate known) already anchored on orderDate vs. deliveryDate correctly per `returnWindowStartsFrom` without ever touching the shipping buffer — that logic was right since Milestone 3. The bug was specifically: no deliveryDate, orderDate known, policy says order-date-anchored — that combination still fell through to the "estimate a delivery date" path unconditionally.
- **Recomputed real data with the same surgical discipline as Milestone 15's backfill** — `scripts/recompute-deadlines.ts` only touches `returnDeadline`/`deadlineIsEstimated`, computed from each order's already-stored `orderDate`/`deliveryDate`/`returnWindowDays`/`returnWindowStartsFrom`. Never re-derives those inputs, so it can't reintroduce the timezone-drift regression from Milestone 15. Confirmed idempotent: re-running it against already-fixed data changes nothing.

## How to know it works

1. An order with `returnWindowStartsFrom: "order_date"`, a known `orderDate`, and no `deliveryDate` shows `returnDeadline = orderDate + returnWindowDays` exactly, with `deadlineIsEstimated: false`.
2. An order with `returnWindowStartsFrom: "delivery_date"` (or null) and no `deliveryDate` still gets the 7-day buffer — confirmed unchanged behavior for that case.
3. Re-running `scripts/recompute-deadlines.ts` against real data: exactly 3 real orders changed (the ones with the buggy combination — two On orders and one Mango order), all moved earlier and from estimated to exact; the other 8 were untouched. A second run changed zero.

## Copy-paste prompts for Claude Code

**Prompt 29 — fix computeDeadline's order-date shipping buffer bug**
> Per BUILD.md's Milestone 17 section: in lib/extract.ts's computeDeadline(), when returnWindowStartsFrom is "order_date" and there's no deliveryDate, return orderDate + returnWindowDays directly with deadlineIsEstimated false — don't add the standard shipping-day buffer, which should only apply when the policy counts from delivery date (or doesn't say) and there's no delivery date to anchor on. Recompute returnDeadline/deadlineIsEstimated for all existing orders from their already-stored dates, without re-deriving orderDate/deliveryDate themselves.

---

# Milestone 18: Admin Onboarding View

## Goal — the only thing that counts as "done"

> One page that lists every user's real forwarding address, so a friend can be onboarded by copy-pasting their address straight to them — instead of needing to sign in as them or dig through the database by hand.

## Why this design (read before building)

- **This started as a different, larger plan and got corrected before any code was written.** The first draft proposed a new `InboundEmail` log model, a migration, and changes to `app/api/inbound/route.ts` to debug failed webhook calls — solving a problem the user didn't actually have. The real need was much smaller: just *see* the address that already exists per user, to hand it out during manual onboarding. Caught during plan review, before any schema or route changes were made — the corrected plan touches no schema, no migration, and no inbound route code at all.
- **One function, not duplicated logic.** `app/settings/page.tsx` already computed `${POSTMARK_INBOUND_HASH}+${inboundToken}@inbound.postmarkapp.com` inline. Rather than re-inline the same string in a second place, extracted it into `lib/inboundAddress.ts`'s `getInboundAddress()`, used by both pages. This isn't just tidiness: the user is mid-migration to a custom domain (`myreturnwindow.com`), which will almost certainly change this address's shape entirely (most likely dropping `POSTMARK_INBOUND_HASH` once the inbound domain is dedicated to this app rather than shared across every Postmark customer). One function means that migration is a one-file edit instead of a search-and-fix.
- **Identity-gated, not secret-gated.** The existing `/admin` page uses a shared `ADMIN_SECRET` query param — deliberately stateless and not tied to any specific account. This page is different on purpose: it's explicitly "just my account," and it shows every real user's actual forwarding address, which felt like it deserved the higher bar of a real session check (`auth()` + `session.user.email === process.env.ADMIN_USER_EMAIL`) over a string anyone could pass around.
- **Verified against real, growing data, not a fixture.** By the time this shipped, two more friends had self-registered (`caroline.guthrie@gmail.com`, `jennifer.m.baskin@gmail.com`) since the start of this session — the page correctly listed all five real users without any code assuming a fixed count, and a spot-check confirmed the computed address for the admin's own account matched exactly what `/settings` already showed them, proving the refactor didn't change behavior.

## What got built

- `lib/inboundAddress.ts`: `getInboundAddress(inboundToken)` — the one place this computation lives now.
- `app/settings/page.tsx`: calls the shared helper instead of inlining the string.
- `app/admin/onboarding/page.tsx` (new): lists every user (email, joined date, computed address, copy button reusing the existing `app/settings/CopyButton.tsx`), gated by `ADMIN_USER_EMAIL`.
- `ADMIN_USER_EMAIL` added to `.env` and all three Vercel environments.

## How to know it works

1. Signed in as the account matching `ADMIN_USER_EMAIL`, `/admin/onboarding` lists every real user with their address.
2. Signed in as any other real account, the same URL 404s. Signed out, it redirects to `/login`.
3. The address shown for a given user here matches exactly what that user sees on their own `/settings` page.

## Copy-paste prompts for Claude Code

**Prompt 30 — admin onboarding view**
> Per BUILD.md's Milestone 18 section: extract the inline inbound-address computation out of app/settings/page.tsx into lib/inboundAddress.ts's getInboundAddress(), and build a new app/admin/onboarding/page.tsx listing every user's email, join date, and computed forwarding address with a copy button (reuse app/settings/CopyButton.tsx). Gate it with a real session check (auth() + session.user.email === process.env.ADMIN_USER_EMAIL), not the existing shared-secret admin gate — this page shows real per-user addresses and is meant to be scoped to one specific account. No schema changes.

---

# Milestone 19: Pilot the Custom Inbound Domain

## Goal — the only thing that counts as "done"

> One account (the admin's own) sees and uses a new inbound address on a dedicated domain — `<inboundToken>@mail.myreturnwindow.com` — with everyone else completely unaffected, as a controlled test before rolling the migration out to every user.

## Why this design (read before building)

- **Changing the displayed address alone would not have worked.** The new format has no `+tag` at all — Postmark only populates `MailboxHash` from a `+` separator, which doesn't exist in `<token>@mail.myreturnwindow.com`. Without a corresponding fix to `app/api/inbound/route.ts`, every email sent to the new address would have resolved to *no user* and been silently discarded — exactly the kind of failure this whole admin-visibility effort (Milestones 18–19) exists to prevent. `extractInboundToken()` now tries `MailboxHash` first (100% unchanged for every non-pilot user), and only falls back to treating the whole local part as the token when the recipient's domain matches `INBOUND_DOMAIN` — additive, not a replacement.
- **Two new env vars, deliberately not reusing existing ones.** `INBOUND_DOMAIN` and `INBOUND_DOMAIN_PILOT_EMAIL` are new, even though `INBOUND_DOMAIN_PILOT_EMAIL` holds the same value as `ADMIN_USER_EMAIL` today. "Who's in the domain-migration pilot" and "who can see the admin pages" are different questions that happen to coincide on one person right now — collapsing them into one variable would make it harder to reason about later if the pilot expands before the admin gate does, or vice versa.
- **The pilot check lives in `getInboundAddress()` itself, not duplicated at each call site.** Every page that shows an address (`/settings`, `/admin`, `/admin/onboarding`) now passes the user's email through to the same function, which decides old vs. new format. Unset either env var and every account, including the pilot's, falls back to the old, known-working format — there's no scenario where a half-configured pilot breaks anything for anyone.
- **Verified the matching fix locally against three real shapes** before touching production: the old `+tag` format (still works, confirmed unchanged), the new bare-token format via `OriginalRecipient`, and the same via a bare `To` header (Postmark webhook field availability isn't fully predictable in advance, so both are handled) — plus a negative case (right token, wrong domain) confirmed it correctly resolves to no user rather than guessing.
- **Can't simulate the real test end-to-end.** Confirming actual mail delivery through real DNS/MX records to `mail.myreturnwindow.com` requires an actual external send, which isn't something achievable from this environment — sent the admin a real email (via the existing Postmark outbound path) stating the new address and asking them to forward something real to it and check the dashboard, rather than claiming "verified" on a test that was only ever simulated locally.

## What got built

- `lib/inboundAddress.ts`: `getInboundAddress()` now takes `userEmail` and returns the pilot-domain format when `INBOUND_DOMAIN` + `INBOUND_DOMAIN_PILOT_EMAIL` are set and match; old format otherwise. All three call sites (`app/settings/page.tsx`, `app/admin/page.tsx`, `app/admin/onboarding/page.tsx`) updated to pass the email through.
- `app/api/inbound/route.ts`: new `extractInboundToken()` — `MailboxHash` first, falling back to the local part of `OriginalRecipient`/`To` when the recipient domain matches `INBOUND_DOMAIN`. The inline address computation in the Gmail-verification-email admin notification was also switched to call `getInboundAddress()` instead of duplicating the (now-stale) hash-based string.
- `INBOUND_DOMAIN` (`mail.myreturnwindow.com`) and `INBOUND_DOMAIN_PILOT_EMAIL` added to `.env` and all three Vercel environments.
- A one-off real send to the admin's own inbox stating their new address, asking them to forward something real to confirm end-to-end delivery.

## How to know it works

1. The admin's `/settings` and their row on both admin pages show `<token>@mail.myreturnwindow.com`; every other real user's address is unchanged everywhere.
2. A synthetic webhook payload using the old `+tag` format still resolves correctly (regression check).
3. Synthetic payloads using the new bare-token format, via either `OriginalRecipient` or `To`, correctly resolve to the pilot account; a payload with the right token but the wrong domain correctly resolves to no user.
4. The real test that actually matters and that only the admin can perform: forward a genuine email to the new address and confirm it lands on the dashboard the same way forwards to the old address always have.

## Rollout (same day)

The pilot test passed — a real forwarded Coyuchi order confirmation landed
correctly through `mail.myreturnwindow.com`, matched to the right account.
`getInboundAddress()` was simplified to drop the per-email pilot check
entirely: every account now sees the new domain, not just one.
`INBOUND_DOMAIN_PILOT_EMAIL` was removed (from code and both `.env`/Vercel)
since nothing reads it anymore. `INBOUND_DOMAIN` is the only flag left, and
it now applies unconditionally when set.

This rollout carries unusually low risk for something touching every real
user at once: `extractInboundToken()` checks the old `+tag` format
(`MailboxHash`) *first*, unconditionally, regardless of this change — anyone
whose Gmail filter still points at their old `inbound.postmarkapp.com`
address keeps forwarding successfully with zero disruption. This change only
affects what address gets *displayed* going forward; nobody's existing
forwarding rule breaks because of it. Re-verified after the rollout: a
non-pilot account (Kathleen) now sees the new domain on `/settings`, and a
synthetic payload using the old `+tag` format still resolves correctly.

**Not done as part of this rollout:** the other real users' own forwarding
rules (their Gmail filters) still point at their old address — that still
works, but they won't see the new one until they check `/settings`
themselves, or the admin reaches out using `/admin/onboarding` to give it to
them directly (which is exactly what that page was built for).

## Copy-paste prompts for Claude Code

**Prompt 31 — pilot the custom inbound domain**
> Per BUILD.md's Milestone 19 section: make lib/inboundAddress.ts's getInboundAddress() pilot-aware via INBOUND_DOMAIN + INBOUND_DOMAIN_PILOT_EMAIL env vars, falling back to the existing postmarkapp.com format for everyone else. Fix app/api/inbound/route.ts's token matching to also handle a bare `<token>@INBOUND_DOMAIN` address with no `+tag` (Postmark's MailboxHash only populates from a `+` separator) by falling back to the recipient's local part when the domain matches — additive, never changing matching behavior for the existing shared domain. Verify against synthetic payloads covering the old format, the new format via both OriginalRecipient and To, and a wrong-domain negative case, before sending the pilot user their real new address.
