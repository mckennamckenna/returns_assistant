# BUILD.md — Returns Assistant

This file is the spec. The goal is to point a coding agent (Claude Code) at it and build incrementally. Work through it top to bottom. Don't skip ahead to features that aren't in the current milestone.

**Status:** Milestone 1 ✅ complete — verified in production with a real forwarded H&M order confirmation. Currently on **Milestone 2: AI Extraction**.

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
2. **The backend must honor the promise even when the filter doesn't.** A filter can't guarantee nothing sensitive slips through, so the app must: discard anything that isn't clearly commerce, store the minimum needed, make per-email and full-account deletion easy, and never train models on user email content.

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
- confidence ("high" | "medium" | "low")
- notes (one sentence: your reasoning, especially any assumption or uncertainty)

Rules:
- NEVER invent, guess, or infer a date, deadline, or policy that isn't written in the email.
- Return null for any field not clearly present. Null + low confidence is always better than a wrong answer.
- Lower confidence whenever you have to infer rather than read something directly.
- For shipping confirmations: focus on deliveryDate — that's the key field.
- For order confirmations: focus on returnWindowDays and returnWindowStartsFrom.
- If the email is marketing/promotional/unrelated: set emailType to "other", retailer to null, confidence to "low".
- Leave returnWindowDays null if this email doesn't state it — don't guess based on what you know about the retailer. A separate lookup step handles that.

Respond with ONLY valid JSON. No preamble, no markdown, no explanation outside the JSON.

EMAIL BODY:
{{textBody}}
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

---

## What comes after Milestone 2 (not now)

- An `Order` model and the order state machine, once extraction is trustworthy enough to act on
- The reminder engine (daily cron → email/SMS) — needs live/recent orders to test, not backlog
- Per-user `+tag` addresses and real auth
- The guided Gmail forwarding onboarding (the filter milestone)

