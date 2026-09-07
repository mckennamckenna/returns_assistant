# Self-outbound guard tradeoff diagnostic — trigger verification + discard composition

**Date:** 2026-09-07. **TASKS.md 🔴 Now item:** "Diagnostic: verify 22be2d7's
original trigger + size the current guard's discard composition."

**Method:** read-only. Git history (`git show`/`git log` on `22be2d7` and
`lib/selfOutboundGuard.ts`), `TASKS.md`/`investigations/` doc search, Postmark
inbound Messages API cross-referenced against `DiscardLog` timestamps, and a
direct in-process replay of the real `classifyForwardType()` /
`detectSelfOutboundLoop()` functions against real Postmark header payloads.
**Zero DB writes. Zero Anthropic/model calls.** No fix, revert, or change to
`lib/selfOutboundGuard.ts` was made. No discarded email was reprocessed.

Reusable, read-only scripts (committed alongside this doc):
- `scripts/audits/2026-09-07-discard-timestamps.ts`
- `scripts/audits/2026-09-07-discardlog-sample-classify.ts` (20-message spot sample)
- `scripts/audits/2026-09-07-discardlog-full90-classify.ts` (full matched pool)
- `scripts/audits/2026-09-07-returnporturl-check.ts` (regression check)

---

## 1. Trigger verification

**Documented, not memory-only.** Commit `22be2d7` (2026-09-03T17:05:20-07:00),
its commit message, `TASKS.md` (~line 330-410, the closed "Self-email
ingestion loop fix" entry), and `investigations/2026-09-02-extraction-root-
cause/` all agree on one specific, narrow trigger:

> "Users' Gmail auto-forward rules ... route our own outbound reminder/
> digest/refund-check-in emails back into our own inbound pipeline,
> corrupting **`Order.returnPortalUrl`** with our own app's URL."

The investigation found **27 self-emails ingested across 5 users** in the
prior 90 days, of which **3 orders** had a confirmed corrupted
`returnPortalUrl` (Ruti, archived, plus 2 active RealReal orders — exact
count verified and nulled out in the same commit). All 3 confirmed-corrupting
emails were checked directly (decrypted, read-only) before the guard was
written, and **all 3 arrived with `fromEmail: reminders@myreturnwindow.com`**
— i.e., all 3 were caught by the guard's first condition (`from_domain`
match), not the third one.

The guard's third condition — `forwardType === "auto"` AND any header in the
chain mentions `myreturnwindow.com` (`header_chain_auto_forward` in
`lib/selfOutboundGuard.ts:75-77`, the one implicated in the 2026-09-07
ingestion diagnostic) — is documented in the commit's own code comment as a
**speculative fallback, not a confirmed-necessary check**:

> "belt-and-suspenders ... in case (a) is ever defeated by a forwarding path
> that rewrites From/Return-Path ... **Not expected to fire in current
> data** — Gmail's auto forward never rewrites From — but cheap to keep as a
> second line."

**No mention of `orderDate` anywhere in this record.** The trigger, as
documented in three independent places (commit message, TASKS.md, and the
investigation folder), was `returnPortalUrl` corruption exclusively.

**On the owner's recollection:** a real, separate `orderDate`-corruption bug
does exist in the codebase's history (`TASKS.md` ~line 6631, "Write-once
`orderDate` in `mergeEmailIntoOrder`," promoted 2026-08-16, fixed via
write-once semantics) — but it is a **different mechanism** (any later email
overwriting an order's date on merge, unrelated to self-outbound emails or
Gmail auto-forward loops) from a **different investigation**, three weeks
before `22be2d7`. It's plausible this is what's being recalled. This
diagnostic did not find any documented link between self-outbound emails and
`orderDate` specifically, in either direction.

## 2. Is the recollection supported by DB/Postmark evidence?

- **Regression check:** zero `Order` rows currently have a `returnPortalUrl`
  containing `myreturnwindow.com` (`scripts/audits/2026-09-07-
  returnporturl-check.ts`) — consistent with the guard still correctly
  catching genuine `reminders@` loops (see §3, 2 of 87 sampled matches were
  exactly this pattern) and with no new corruption having recurred since the
  2026-09-03 null-out.
- **No `orderDate`-specific evidence found or looked for beyond the record
  search in §1** — this diagnostic did not re-run extraction or inspect
  individual order histories for `orderDate` anomalies tied to self-outbound
  emails specifically (would require either DB fields this app doesn't track
  — e.g. no field records "orderDate was last written by which email" — or
  reprocessing a self-outbound email through extraction to observe what it
  would produce, which is a model call and explicitly out of scope here).
  **This is a real gap, not a negative finding** — absence of evidence here
  isn't evidence of absence, it's evidence that answering this precisely
  would require work this diagnostic wasn't scoped to do.

## 3. DiscardLog composition (2026-09-04 through 2026-09-06)

118 `self_outbound_loop` `DiscardLog` rows exist in this window (all recorded
since the guard's deploy). `DiscardLog` stores no `messageId`/`userId`, so
each row was matched to the closest Postmark inbound message by timestamp
(Postmark's `Date` header vs. `DiscardLog.occurredAt`) — **90 of 118 (76%)
matched within 15 seconds**, consistent with the sub-15-second gaps observed
for the 3 known cases in the prior diagnostic. The remaining 28 likely fall
outside the 08-25–09-07 Postmark search window used here or reflect
messages this fetch didn't capture — not investigated further (out of
scope: sizing every last discard precisely, vs. getting a reliable
proportion).

**Full classification of the 90 matches (87 unique messages, replayed
through the real `classifyForwardType()`/`detectSelfOutboundLoop()`
functions against each message's actual headers):**

| Classification | Count | % |
|---|---|---|
| Genuine self-outbound loop (`From` domain = `myreturnwindow.com`) | 2 | 2.3% |
| Misfire (`header_chain_auto_forward`, legitimate retailer mail) | 85 | 97.7% |
| Ambiguous | 0 | 0% |

An initial 20-message evenly-spaced spot sample came back 20/20 misfire
before the full 87-message pool was classified (same method, all 87 unique
matches, not just the sample) — both give the same picture.

**Example — genuine loop (2 found, both this exact shape):**
```
From: reminders@myreturnwindow.com
Subject: "🗓 What's due this week from Return Window"
-> fromDomain isOwnDomain: true (caught by the `from_domain` check, condition (a))
```

**Example — misfire (85 found; retailer domains span the full spread of
users' real shopping, not one retailer):**
```
From: sayhello@mail3.warbyparker.com
Subject: "We received your order"
-> forwardType: auto, reason: header_chain_auto_forward
   (Gmail-forwarded, headers mention myreturnwindow.com only because
   that's the app's own inbound address the mail was forwarded to)
```

Misfire sender-domain distribution (85 messages, by domain, top entries):
`amazon.com` (10), `email.bloomingdales.com` (7), `mail.ralphlauren.com` (6),
`larroude.com` (5), `mail3.warbyparker.com` (4), `jennikayne.com` (4),
`em.target.com` (4), plus 27 more domains at 1-3 each — a broad spread
across ordinary retail/marketing senders, not a narrow edge case.

---

## Tradeoff summary

- **What the guard is confirmed to have prevented, historically:** 3
  corrupted orders (`returnPortalUrl`), found once, over a 90-day lookback,
  entirely via the `from_domain` check (condition a) — which is unaffected
  by anything in this diagnostic and isn't in question.
- **What the guard's third condition (`header_chain_auto_forward`) is
  confirmed to have caught, historically:** in the documented investigation
  record, nothing — it's explicitly noted as untested/speculative at the
  time it was added.
- **What the guard's third condition is confirmed to be discarding now:**
  in a 90-discard sample spanning 3 days, 97.7% (85/87 matched messages)
  were legitimate commerce emails from ordinary retailers — the exact kind
  of email this app exists to ingest — silently and permanently lost (no
  content is retained anywhere once discarded).
- **Net, as far as this diagnostic can establish:** the third condition's
  demonstrated cost (85+ real orders/updates lost over 3 days, and counting)
  is not currently offset by any demonstrated catch it uniquely provides —
  every confirmed genuine loop in this diagnostic's own sample was also
  independently caught by the first condition (`from_domain`). This is a
  tradeoff-sizing statement only; no fix direction is being recommended
  here.

---

## Scope note — what this diagnostic did NOT do

- No fix, patch, or revert to `lib/selfOutboundGuard.ts` or any other file.
- No design work on a narrower guard shape.
- No reprocessing or recovery of any discarded email.
- No reasoning about which fix direction to take beyond presenting the
  numbers above neutrally.
- Did not chase the 28 unmatched `DiscardLog` rows (of 118) to full
  resolution — the 90 matched (76%) were judged sufficient to establish a
  reliable proportion; found no reason to expect the remaining 28 skew
  differently.
- Did not investigate `orderDate`-specific corruption via reprocessing or
  extraction replay (would require a model call — explicitly gated, not
  run).

## Follow-ups the owner decides

- **Fix shape for `lib/selfOutboundGuard.ts`.** Given the numbers above, the
  `header_chain_auto_forward` condition looks like the most promising
  target — the two conditions ahead of it appear to fully cover every
  genuine case found in the historical investigation and in this
  diagnostic's own sample. Not a recommendation to act on without owner
  sign-off; that design work is explicitly deferred to the next session per
  the paired prompt.
- **Recovery.** None of the 85+ likely-misfired emails were retained
  anywhere (`DiscardLog` is content-free by design). Whether/how to recover
  them (Postmark's own retention window, or asking affected users to
  re-forward) is a separate decision.
- **`orderDate` gap.** If the owner still wants the `orderDate`-corruption
  question answered precisely (not just "no evidence found in the written
  record"), that would need either a schema addition (tracking provenance
  of `orderDate` writes) or a gated, explicitly-approved extraction replay
  of one of the 2 confirmed genuine-loop reminder emails — a model call,
  requiring separate authorization.
- **`DiscardLog` schema.** Repeating the "adding `messageId` would make this
  a direct join instead of a timing-correlation exercise" note from the
  prior diagnostic — it would have made both diagnostics faster and more
  precise (would have resolved all 118 rows, not 90/118).
