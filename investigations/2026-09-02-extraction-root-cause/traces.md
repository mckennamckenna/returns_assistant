# `returnPortalUrl` root-cause traces — 2026-09-02

Read-only investigation, 0 Anthropic API calls. Follow-up to the 2026-09-01/09-02
fleet-wide `returnPortalUrl` health audit (`TASKS.md` ~line 5181), which
categorized failure modes in plain English via live HTTP fetches but did not
trace root cause back to the source emails / extraction reasoning. This
document does that: for each bad URL, which email produced it, what
`resolveReturnPortalUrlForWrite` did with it, and whether a better URL existed
in the email and was passed over.

**Methodology note on the "19 bad URLs" figure.** The active non-Amazon order
set has grown from 36 (2026-09-01) to 44 today (8 new orders, all still
`returnPortalUrl: null` — not yet resolved by web lookup); the 36 orders that
*have* a `returnPortalUrl` are the same 36 as the original audit. Re-deriving
the bad set from the DB (not from live HTTP fetches, which are out of scope
for a read-only investigation) surfaced one correction and one addition
relative to the original plain-English list:
- **`gap.returns.optiturn.com`** (Gap order `1RL39WM`) is almost certainly
  **not** bad — it's Gap's actual third-party returns-portal vendor
  (Optiturn), a stable un-tokenized URL, not the "single-use return code"
  the original audit meant. **Removed** from the bad set.
- The original audit's "Optiturn single-use return code, expired/consumed"
  finding is actually a *different* order — Gap Inc. order `1R1KXD3`, whose
  `returnPortalUrl` is a SendGrid click-tracking-wrapped Optiturn link from a
  `return_label` email (a post-return credit-summary confirmation, not a
  portal to start a new return). **Added** in Optiturn's place.
- A second Gap order (`1RYJR48`, url `gap.com/customer-service/info.do?cid=3040265`)
  looked suspicious on inspection (a different `cid` than the two clearly-good
  Gap orders' `how-to-return-exchange-items?cid=81264` URL, from a near-empty
  order_confirmation email) and is **added**, flagged low-confidence /
  needing live verification — this investigation is DB-only and can't fetch
  it to confirm.

Net: still 19 rows, composition adjusted as above. Every entry below states
its confidence.

---

## 1. Ancient Greek Sandals — order `cmrwa20650003jt04wu1gj5eu` (#84963)

- **Stored `returnPortalUrl`:** `https://locator.dhl.com`
- **Linked emails (3, chronological):** `order_confirmation`, `shipping_confirmation`, `return_label`
- **Which email produced the stored value:** the `return_label` email (RMA
  approval, from Ancient Greek Sandals). `returnPortalUrlFromEmail` =
  `https://locator.dhl.com` on that email; `resolveReturnPortalUrlForWrite`
  prefers email-stated over lookup, and this was also the final `mergeEmailIntoOrder`
  write (last-processed non-null wins — see `categories.md` E discussion for why
  that matters elsewhere, though here the email value itself is the problem, not the merge).
- **Every URL in that email's body:** only `https://locator.dhl.com` (a DHL
  parcel drop-off locator) plus static asset/font URLs. No other candidate URL present.
- **Extraction's own reasoning (from `extractionNotes`):** *"The DHL URL
  extracted is for finding drop-off locations, not a retailer return portal,
  but it is the only URL present in the email... returnPortalUrl is left null
  rather than guessed"* — this note is self-contradictory: the prose says
  "left null," but the stored `returnPortalUrlFromEmail` field is in fact the
  DHL URL, not null.
- **Better URL available and passed over?** No — the email genuinely
  contains no retailer return-portal URL. The AI's own web-lookup pass (on
  the earlier `order_confirmation` and `shipping_confirmation` emails) also
  came up empty (best proxy found: `ancient-greek-sandals.com/policies/refund-policy`,
  itself only a policy page, not a start-return action), so there's no
  better answer sitting anywhere in this order's data.
- **Category:** C.

---

## 2. Buff City Soap — order `cmsz8qxl60003l504ztfk6wxh` (#1115563)

- **Stored `returnPortalUrl`:** `https://buffcitysoap.com/pages/contact`
- **Linked emails (1):** `order_confirmation`
- **Producing signal:** web lookup only (`returnPortalUrlFromEmail` null).
- **Extraction's reasoning:** *"Buff City Soap does not accept physical
  returns or exchanges due to the hygienic/handmade nature of products...
  customers must contact the Guest Experience team via
  buffcitysoap.com/pages/contact... there is no dedicated self-serve return
  portal."*
- **Better URL passed over?** No — by the retailer's own policy there is no
  return-initiation URL to find. Contact Us is the genuinely correct
  next-action page given the policy, just not a "start a return" page in the
  product's intended sense.
- **Category:** C.

## 3. Buff City Soap — order `cmszb381h0003la046bjugbaj` (#B1115563)

Same retailer, second order (separate Order row — order-number-suffix drift,
`B1115563` vs `1115563`, a `lib/linkOrder.ts` fuzzy-match edge case, not
germane to this investigation). Single `shipping_confirmation` email, same
web-lookup reasoning verbatim, same stored URL, same category.

- **Category:** C.

---

## 4. Vespoli USA Inc — order `cmsnbxf1y0005l1047qablyfz` (#SO86549)

- **Stored `returnPortalUrl`:** `https://store.vespoli.com/pages/returns`
- **Linked emails (1):** `shipping_confirmation`
- **Extraction's reasoning:** *"The Vespoli Online Store return policy page
  states items in new working condition may be returned within 6 months...
  no portal form was found — the page directs customers to email
  customerservice@vespoli.com."*
- **Better URL passed over?** No — this is genuinely the best page on file;
  Vespoli has no self-serve flow.
- **Category:** C.

## 5. Vespoli Online Store — order `cmsnbxo2d0007l104ysd75ggz` (#SO86549)

Duplicate-order twin of #4 (retailer string drifted "Vespoli USA Inc" vs
"Vespoli Online Store" between emails, creating two separate Order rows for
the same real order number — another `linkOrder.ts` retailer-matching
edge case). Same URL, same reasoning, same category.

- **Category:** C.

---

## 6. Wayfair — order `cmt7fxe740003ld04arvg4xx6` (#2869071480)

- **Stored `returnPortalUrl`:** `https://www.wayfair.com/my-account/orders`
- **Linked emails (2):** `order_confirmation`, then `shipping_confirmation`
- **What happened:** the `order_confirmation` email's web lookup found
  `https://www.wayfair.com/help/article/returns-c2151054779` — Wayfair's
  actual public returns-policy article, not login-gated. That value was
  written to the Order first. The `shipping_confirmation` email, processed
  second, ran its own web lookup and returned
  `https://www.wayfair.com/my-account/orders` instead — a generic,
  login-required account page, functionally the same failure mode the
  original audit's live fetch flagged as dead/inaccessible.
  `mergeEmailIntoOrder`'s write (`lib/linkOrder.ts:835`) is
  `normalizeReturnPortalUrl(returnPortalUrl) ?? normalizeReturnPortalUrl(existing.returnPortalUrl)`
  — the second email's non-null value unconditionally overwrites the first
  email's better one, no quality comparison.
- **Better URL passed over?** Yes, and it was in the Order row until the
  second email's merge clobbered it.
- **Category:** E.

---

## 7. Gap Inc. (Optiturn, SendGrid-wrapped) — order `cmrchi2ul0003kz049itfhi4f` (#1R1KXD3)

- **Stored `returnPortalUrl`:** a SendGrid click-tracking URL
  (`u24515401.ct.sendgrid.net/ls/click?...`) wrapping an Optiturn
  credit-summary link.
- **Linked emails (1):** `return_label`, from `no-reply@optiturn.com`,
  `policySource: "email"` on the Email row (→ Order `policySource:
  "stated_in_email"`).
- **Extraction's reasoning:** *"refundAmount of $398.13 is explicitly
  labeled 'Total estimated refund' in the Credit Summary; return window of
  30 days from delivery date is explicitly stated."* This is a **post-return
  refund/credit confirmation**, not a "start a return" email — the only URL
  in it is a SendGrid-wrapped, presumably session/campaign-bound Optiturn
  link tied to that specific already-completed RMA, not a durable portal
  entry point.
- **Better URL passed over?** No other URL is present in this email. The
  correct answer here is arguably null (this email type shouldn't be a
  `returnPortalUrl` source at all) rather than any URL in it.
- **Category:** C.

---

## 8. Rufflebutts + Ruggedbutts — order `cmtjcke2d0005jp04j4t1uyab` (#002098811)

- **Stored `returnPortalUrl`:** `https://www.rufflebutts.com/returns`
- **Linked emails (1):** `shipping_confirmation`
- **Extraction's reasoning:** *"The dedicated returns page at
  rufflebutts.com/returns states returns must be initiated within 45
  days... but multiple product pages display '90 days'... 45 days used as
  it appears on the authoritative policy page."* This is a genuine,
  specific returns page — extraction did its job correctly. Original
  audit's live fetch got a 403 that persisted even with a realistic Chrome
  UA, which it correctly flagged as "inconclusive by static fetch," not
  confidently dead.
- **Better URL passed over?** No — this is the right answer.
- **Category:** D.

## 9. SSENSE — order `cms89n1cm0003l604f625vuoe` (#44266308515307)

- **Stored `returnPortalUrl`:** `https://www.ssense.com/en-us/guest/self-serve`
- **Linked emails (3):** `order_confirmation`, `shipping_confirmation`, `other` (a support-ticket thread about a partial refund)
- **Extraction's reasoning:** *"the self-serve return portal at
  ssense.com/en-us/guest/self-serve is the direct page where customers
  initiate a return."* Specific, correct, exactly what the product wants.
- **Better URL passed over?** No.
- **Category:** D.

## 10. The RealReal (`stated_in_email`) — order `cmst2keat0003l504ctuu57q0` (#R284173611)

- **Stored `returnPortalUrl`:** `https://www.therealreal.com/returns`
- **Linked emails (3):** two `shipping_confirmation`, one `return_label`
- **What happened:** the two `shipping_confirmation` emails both had
  `returnPortalUrlFromEmail: null` — the email text says "returns policy,
  click here" but the link's actual `href` wasn't present in the plain-text
  body extraction saw (`"the returns link ('click here') is present but no
  actual URL was extractable from the plain text"`). The `return_label`
  email did carry the real URL directly in its body
  (`https://email.therealreal.com/ls/click?...` decoded target =
  therealreal.com/returns), matching `rawFromEmail`. Web lookup independently
  landed on the same URL across all three emails.
- **Better URL passed over?** No — this is TRR's real, official returns
  page, consistently found by both the email-stated and web-lookup paths.
  The account-gated "My Purchases" flow it leads to is inherent to TRR's
  own return process (a resale/consignment platform), not an extraction miss.
- **Category:** D.

---

## 11. Shopbop — order `cmt0igyn70003jp04ikjbwpz6` (#143793576)

- **Stored `returnPortalUrl`:** `https://www.shopbop.com/s/account`
- **Linked emails (2):** `shipping_confirmation`, `delivery`
- **What happened:** the `shipping_confirmation` email's web lookup found
  `shopbop.com/ci/aboutShopBop/customerservice.html`; the `delivery` email's
  lookup (processed second) found `shopbop.com/s/account` instead, which
  won via last-write-wins merge. Both are the same *kind* of failure
  though — Shopbop's own note says *"a standalone direct-return-initiation
  URL distinct from the customer service page was not found in search
  results"* on both passes.
- **Better URL passed over?** No genuinely better URL exists in either
  email — Shopbop's real flow is account-gated sign-in with no public
  order-specific start-return URL. (The merge did still silently swap one
  guess for another with no arbitration — see `categories.md`'s note that
  this is a milder version of the Wayfair E pattern, not scored as E here
  because neither candidate was actually better.)
- **Category:** C.

## 12. Shopbop — order `cmtfzrc5y0003lb0417quupfg` (#144038104)

- **Stored `returnPortalUrl`:** `https://www.shopbop.com/s/account`
- **Linked emails (5):** `order_confirmation`, 3× `shipping_confirmation`, `delivery`
- Same reasoning as #11 — every email's web lookup either returns null or
  the same account-page guess; no better URL ever appears.
- **Category:** C.

---

## 13. Target — order `cmsfhhlbl0003lc047rzt1uwm` (#912003615824754)

- **Stored `returnPortalUrl`:** `https://click.oe.target.com/?qs=...` (a
  marketing-email click-tracking redirect)
- **Linked emails (5):** 3× `shipping_confirmation`, `return_label`, `other` (promo)
- **What happened:** every commerce email in this order carries its own
  distinct `click.oe.target.com` tracking link (`returnPortalUrlFromEmail`
  populated directly from the email body every time, `rawFromEmail ===
  rawLookup` on each — web lookup and email extraction agree because the
  web-lookup step, per its own notes, confirmed the link shape rather than
  independently finding target.com/returns). The `return_label` email
  (processed last) is what's actually stored — a "Get started"
  button URL from a real Target Drive-Up return-instructions email. **This
  URL was correct and live at write time** — it's a genuine, order-specific
  return-initiation link Target itself generated. The original audit's live
  refetch found it 404s now — pure elapsed-time link decay (these OE
  tracking redirects appear to expire), not an extraction defect.
- **Better URL passed over?** No — the extraction pipeline did the right
  thing at write time.
- **Category:** F (new — see `categories.md`).

### Contrast case (not bad): Target — order `cmtbn4j5h0007jr04budop6kr` (#102003648964163)

Same link shape (`click.oe.target.com/?qs=...`), same extraction path, still
resolves as of the original audit's fetch. Included here only for context —
not part of the 19.

---

## 14. Julia Amory — order `cmsgcmfr20003jz043o1t38n2` (#317246)

- **Stored `returnPortalUrl`:** `https://returns.juliaamory.com/`
- **Linked emails (4):** `shipping_confirmation`, `delivery`, `return_label`, `other` (return-received confirmation)
- **What happened:** every email's web lookup independently confirms
  `returns.juliaamory.com` — a real Loop Returns–powered portal (the
  `return_label` email's own body links `api.loopreturns.com` and
  `loopreturns.com`, confirming this order actually *used* this exact
  portal to generate its return label). This is about as strong a
  "genuinely correct" signal as this dataset has.
- **Better URL passed over?** No — this is the real portal, used
  successfully by this exact order.
- **Category:** D (the original audit's 403/blocked-by-static-fetch finding
  is very likely the same JS-challenge/bot-fingerprinting pattern as
  Rufflebutts/SSENSE, not a wrong URL — Loop Returns portals commonly gate
  behind an order-lookup form that can read as a block to a bare fetch).

## 15. Julia Amory — order `cmtaagn2o0003kz04z5uf0rol` (#323611)

Same retailer, same URL, same reasoning across its 2 linked emails
(`shipping_confirmation`, `delivery`).

- **Category:** D.

---

## 16. Market Hall Foods — order `cmstaspxk0003jr04yxdnoxx7` (#101861)

- **Stored `returnPortalUrl`:** `https://www.markethallfoods.com/pages/customer-service`
- **Linked emails (3):** `shipping_confirmation`, 2× `delivery`
- **Extraction's reasoning:** *"no self-serve return portal was found —
  customers are directed to 'reach out' to initiate a return... a
  'Returns & Exchanges' footer link appears site-wide, its destination
  URL could not be confirmed."* One of the two `delivery` emails'
  lookup explicitly returned null for this same reason
  (`"so returnPortalUrl is null"`), while the other two emails' lookups
  substituted the Customer Service page instead of also returning null —
  an inconsistency in how the same underlying "no real portal exists"
  finding got resolved across otherwise-identical lookup calls.
- **Better URL passed over?** No.
- **Category:** C.

---

## 17. The RealReal (self-domain) — order `cmsm3bxhh0003js04fmocudc3` (#R332247205)

- **Stored `returnPortalUrl`:** `https://app.myreturnwindow.com/orders/cmsm3bxhh0003js04fmocudc3`
  — **this app's own order-detail URL.**
- **Linked emails (2):** `shipping_confirmation` (real TRR email, found
  `therealreal.com/returns` via lookup, `returnPortalUrlFromEmail` null),
  then an `other`-typed email that is **this app's own outbound
  return-deadline reminder**, re-ingested via the user's Gmail auto-forward
  rule (the same rule our own onboarding sets up) looping our sends back
  into our inbound webhook.
- **What happened:** extraction correctly classified this second email as
  `other` and its own notes say *"This email is not from The RealReal — it
  is a return-deadline reminder generated by a third-party app
  (myreturnwindow.com)... returnPortalUrlFromEmail points to the
  third-party app's order detail page, not a retailer return portal."*
  Despite that self-aware framing, the field was still populated with the
  self-domain URL, `resolveReturnPortalUrlForWrite` still preferred
  email-stated over lookup, and `mergeEmailIntoOrder` still wrote it
  unconditionally over the real `therealreal.com/returns` value that was
  already stored from the first email. Body also contains our own signed
  action-token links (`/action/returned?token=...`, `/action/archive?token=...`).
- **Better URL passed over?** Yes — `therealreal.com/returns` was already
  correctly stored and got overwritten.
- **Category:** E. This is the same finding already closed/superseded in
  `TASKS.md`'s 🔴 Now section under "Self-email ingestion loop" — included
  here for completeness of the per-URL trace set, not re-investigated from
  scratch.

## 18. The RealReal (self-domain) — order `cmsvzhb8k0003jz04f2z3h3dz` (#R268770184)

Same mechanism, second occurrence: 5 linked emails, 2 real TRR
`shipping_confirmation` emails (both correctly find `therealreal.com/returns`
via lookup) followed by 3 separate self-email reminder re-ingestions (`other`
type each time), each one re-writing the self-domain URL and each one aware
in its own `extractionNotes` that it's "a return deadline reminder generated
by a third-party service (Return Window), not a retailer transactional
email."

- **Category:** E.

---

## 19. Gap — order `cmtkeeq7e0003le04eqt79jcz` (#1RYJR48) — LOW CONFIDENCE

- **Stored `returnPortalUrl`:** `https://www.gap.com/customer-service/info.do?cid=3040265`
- **Linked emails (1):** `order_confirmation`, near-empty body (*"no order
  details, line items, totals, dates, or return policy are present"*)
- **What happened:** `returnPortalUrlFromEmail` null; web lookup alone
  produced `info.do?cid=3040265`. This differs in URL shape from the two
  other, clearly-good Gap orders in this dataset (`cmsx8obt2`, `cmt9hmhsq`),
  both of which independently landed on
  `gap.com/customer-service/how-to-return-exchange-items?cid=81264` — the
  same URL, same `cid`, across unrelated orders and lookup calls, a strong
  repeatability signal for a *correct* answer. `cid=3040265` appearing only
  once, on the one order with an almost entirely empty source email, is
  circumstantial evidence it's a wrong pick (a different Gap help topic
  that happens to also be customer-service-shaped) — but this investigation
  is DB-only and cannot confirm what `cid=3040265` actually renders.
- **Better URL passed over?** Possibly — the "real" answer other Gap orders
  found (`cid=81264`) was never surfaced for this order's lookup call.
- **Category:** B, tentative — flag for live verification before treating
  as confirmed.
