# BUILD.md — Returns Assistant

This file is the spec. The goal is to point a coding agent (Claude Code) at it and build incrementally. Work through it top to bottom. Don't skip ahead to features that aren't in the current milestone.

**Status:** Milestone 1 ✅ complete — verified in production with a real forwarded H&M order confirmation. Milestone 2 ✅ complete — AI extraction, return-policy web lookup, and order value all validated against ~16 real forwarded orders. Milestone 3 ✅ complete — 16 real emails aggregated into 8 Order cards. Milestone 4 ✅ complete — daily cron verified end-to-end with a real reminder send, landing in the inbox after DKIM/SPF/DMARC setup. Currently on **Milestone 5: Pre-Alpha Privacy Features**.

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
- **Known limitation: order-number drift across email types.** A return/RMA confirmation email sometimes cites a return-authorization number instead of the original order number (e.g. Chan Luu's "your return is approved" email used a different reference than its order confirmation). Matching on order number alone will create a second, fragmented Order in that case. This is a real accuracy gap to watch for during review, not something to silently paper over — flag it, don't guess which number is "real."
- **Orphaned emails stay visible, not hidden.** An email that couldn't be matched to retailer + order number (marketing, parsing failure, etc.) gets `orderId = null` and `needsReview = true`, but still shows on the dashboard in an "Unlinked emails" section — nothing should disappear silently.

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
6. **Fallback orderDate from the forwarded header, order_confirmation only.** If the Order still has no `orderDate` after merging, look at its linked emails for the earliest one with `emailType: "order_confirmation"` and parse the `Date:` line Gmail embeds in the `"---------- Forwarded message ---------"` block of its `textBody` (e.g. `"Date: Tue, May 19, 2026 at 4:21 PM"`). That's the retailer's actual send time, unlike `receivedAt`/Postmark's `Date` field, which is just when the customer forwarded it — those can be the same instant in testing but are wrong in general, since a real customer might forward an order from weeks ago. Scoped to `order_confirmation` only: a confirmation email is normally sent right when the order is placed, but a shipping/delivery/return email's send date has no such relationship to the order date, so never apply this fallback using those. The resulting `returnDeadline` is always marked `deadlineIsEstimated = true` — the date it's based on is inferred, not stated.
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

## What comes after Milestone 3 (not now)

- Per-user `+tag` addresses and real auth
- The guided Gmail forwarding onboarding (the filter milestone)
- Resolving order-number drift across email types (e.g. return/RMA numbers vs. original order numbers) — likely needs a secondary matching signal beyond exact order-number equality, such as retailer + approximate order date + line-item overlap

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
- Resolving order-number drift across email types (e.g. return/RMA numbers vs. original order numbers) — likely needs a secondary matching signal beyond exact order-number equality, such as retailer + approximate order date + line-item overlap
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
- Resolving order-number drift across email types (e.g. return/RMA numbers vs. original order numbers)
- Configurable per-user reminder cadence and channel (SMS, not just email)
- Snoozing or dismissing a reminder, and a way to mark an order "returned" manually

### Privacy hardening (before opening to public users)

Everything so far has been single-user (me), where `fromEmail`/`fromName` is always my own address and `rawJson` is convenient debugging. Neither assumption holds once other people's data is in this database. Required before any public launch:

- **Hash or encrypt `fromEmail` and `fromName` at write time.** These are the one piece of PII guaranteed to be on every row (it's the forwarding user's own address). Don't store them in plaintext once there's more than one user — hash for lookup/display needs that tolerate it, encrypt (with a key outside the database) if the original value must ever be recovered.
- **Audit `rawJson` for PII exposure.** It was flagged back in Milestone 1 as "for early debugging, must stay prunable/deletable — don't treat it as permanent." Milestone 5 made deletion easy; this is the remaining half — go through what Postmark's payload contains beyond what we already extract (full headers, attachment metadata, etc.) and decide what's safe to keep, what to strip, and a concrete retention policy, not just a TODO.
- **Per-user `+tag` addresses must use random hashes, not user IDs.** Milestone 1 noted that `MailboxHash` will eventually carry a per-user identifier so one inbox can route everyone. If that identifier is a sequential or guessable user ID, anyone can enumerate or guess other users' forwarding addresses. Generate an opaque random token per user instead, with no structural relationship to their account ID.

