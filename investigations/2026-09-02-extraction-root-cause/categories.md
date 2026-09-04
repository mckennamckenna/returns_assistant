# Category assignment — `returnPortalUrl` root-cause traces, 2026-09-02

Categories per the investigation brief:
- **A** — wrong email entirely (fix: classification)
- **B** — right email, wrong URL picked (fix: extraction prompt)
- **C** — no good URL existed, extraction should have returned null but
  substituted something (fix: prompt's null-vs-substitute instructions)
- **D** — real URL is auth-walled / bot-blocked, extraction picked the
  correct page but it can't be verified live (fix: hard or inconclusive,
  not really an extraction defect)
- **E** — merge overwrote a good value with a bad one
  (`resolveReturnPortalUrlForWrite` / `mergeEmailIntoOrder`)

Two rows didn't fit A–E and got a new category, called out explicitly below.

## Count per category

| Category | Count | Share |
|---|---|---|
| C — no good URL, substituted anyway | 9 | 47% |
| D — inconclusive (bot-block/auth-wall on an otherwise-correct pick) | 5 | 26% |
| E — merge overwrote good with bad | 3 | 16% |
| F (new) — correct at write time, decayed since | 1 | 5% |
| B — right email, wrong URL picked | 1 | 5% |
| **Total** | **19** | |

## C — no good URL existed, extraction should have returned null (9)

1. Ancient Greek Sandals — `cmrwa20650003jt04wu1gj5eu` — DHL locator, the
   only URL in a `return_label` email; extraction's own notes admit it's not
   a retailer return portal.
2. Buff City Soap — `cmsz8qxl60003l504ztfk6wxh` — Contact Us; retailer has
   no self-serve returns by policy.
3. Buff City Soap — `cmszb381h0003la046bjugbaj` — same, second order.
4. Vespoli USA Inc — `cmsnbxf1y0005l1047qablyfz` — general returns-info
   page; retailer has no portal, directs to email.
5. Vespoli Online Store — `cmsnbxo2d0007l104ysd75ggz` — same, second order.
6. Gap Inc. (Optiturn/SendGrid) — `cmrchi2ul0003kz049itfhi4f` — the only URL
   in a post-return credit-summary email is a single-use, SendGrid-wrapped
   transactional link, not a durable "start a return" portal.
7. Shopbop — `cmt0igyn70003jp04ikjbwpz6` — account page substituted;
   extraction's own notes say no standalone return-initiation URL was found.
8. Shopbop — `cmtfzrc5y0003lb0417quupfg` — same, second order.
9. Market Hall Foods — `cmstaspxk0003jr04yxdnoxx7` — Customer Service page
   substituted; extraction's own notes say no self-serve portal was found,
   and on one of this same order's four lookup calls the AI *did* correctly
   return null for the identical underlying finding — inconsistent handling
   of the same "no real portal" conclusion within one order.

**Judgment call:** rows 1–5 and 9 are "the retailer genuinely has no
self-serve return-initiation page" — the substituted URL (a policy page or a
Contact Us page) is arguably the *correct next step for a human*, just not
the "direct URL to start a return" the prompt explicitly asks for
(`lib/extract.ts:224`: *"NOT the homepage, NOT a general help-center search
page"*). Rows 6–8 are a narrower case: a specific URL exists but is either
single-use/transactional (6) or an account-gated page with no
return-specific counterpart (7, 8). All were grouped under C because in
every case the prompt's own escape hatch — return null when no real
start-a-return URL exists — was available and not used.

## D — inconclusive, likely correct pick blocked by bot-detection/auth-wall at fetch time (5)

10. Rufflebutts + Ruggedbutts — `cmtjcke2d0005jp04j4t1uyab` — specific,
    correctly-typed returns page; 403 persisted even with a realistic
    Chrome UA per the original audit.
11. SSENSE — `cms89n1cm0003l604f625vuoe` — specific self-serve page;
    same 403 pattern.
12. The RealReal (`stated_in_email`) — `cmst2keat0003l504ctuu57q0` —
    official returns page, confirmed by both the email-stated link and
    independent web lookup across 3 emails; 403 pattern.
13. Julia Amory — `cmsgcmfr20003jz043o1t38n2` — real Loop Returns portal,
    confirmed *used* by this exact order (return_label email body links
    `api.loopreturns.com`).
14. Julia Amory — `cmtaagn2o0003kz04z5uf0rol` — same portal, second order.

**Judgment call:** the brief's category D description is "auth-walled,
extraction picked the login page" — none of these 5 are logically a login
page; they're specific returns/self-serve pages that a static fetch (even
with a good UA) couldn't get past. Grouped under D anyway because the
underlying situation is the same as the brief intends: extraction did its
job correctly, live verification is what's failing, and "confidently
call this wrong" is not supportable from this data. Julia Amory in
particular looks like a false negative in the *original* audit, not a
finding needing a code fix at all.

## E — merge overwrote a good value with a bad one (3)

15. Wayfair — `cmt7fxe740003ld04arvg4xx6` — `order_confirmation` email's
    lookup wrote the real help-article URL first; `shipping_confirmation`
    email's lookup (processed second) returned a generic, login-gated
    account page instead, and `mergeEmailIntoOrder`'s unconditional
    "new non-null value always wins" (`lib/linkOrder.ts:835`) overwrote the
    better value with no quality comparison.
16. The RealReal (self-domain) — `cmsm3bxhh0003js04fmocudc3` — the
    already-closed self-email-ingestion-loop bug: our own outbound reminder
    email re-entered the inbound pipeline via the user's Gmail auto-forward
    rule, got classified `other`, and its self-aware-but-still-populated
    `returnPortalUrlFromEmail` (pointing at our own app) overwrote the
    already-correct `therealreal.com/returns` value from a real TRR email.
17. The RealReal (self-domain) — `cmsvzhb8k0003jz04f2z3h3dz` — same
    mechanism, 3 separate self-email re-ingestions on this one order.

**Note:** rows 16–17 are not new findings — they're the same bug TASKS.md's
🔴 Now section already closed as "superseded, fully absorbed into the
Self-email ingestion loop item," included here so the per-URL trace set is
complete. Row 15 (Wayfair) is a *new* finding this session: the same
`resolveReturnPortalUrlForWrite`/`mergeEmailIntoOrder` "last non-null value
always wins" mechanism, but triggered by ordinary multi-email merge
sequencing, not a self-email loop. This means the "always prefers the
latest signal" merge behavior is a structural risk beyond the self-email
case specifically — see `fix-recommendation.md`.

## F — new category: correct at write time, decayed since (1)

18. Target — `cmsfhhlbl0003lc047rzt1uwm` — the stored URL is a genuine,
    order-specific "Get started" return-initiation link from a real Target
    Drive-Up `return_label` email, live and correct when written. The
    original audit's live refetch found it now 404s — a `click.oe.target.com`
    marketing/transactional-tracking redirect that appears to expire after
    some elapsed time, independent of extraction confidence at write time.

None of A–E fit this: it isn't a classification error (A), isn't a wrong
pick (B), a real "start a return" URL genuinely existed and was correctly
found (not C), it isn't currently blocked in a bot/auth sense the way D's
rows are (D's rows are blocked-but-plausibly-still-live; this one
positively 404s), and no merge overwrote anything (E). This is the same
phenomenon the original audit called "marketing-tracking links that decay
over time" for both Target rows — only one of the two Target orders in this
dataset is bad (see `traces.md`'s Target contrast-case note), consistent
with pure time-decay rather than an extraction defect.

## B — right email, wrong URL picked (1, low confidence)

19. Gap — `cmtkeeq7e0003le04eqt79jcz` — web lookup on a near-empty
    `order_confirmation` email returned `info.do?cid=3040265`, a different
    Gap help-center `cid` than the `how-to-return-exchange-items?cid=81264`
    URL two *other*, unrelated Gap orders in this same dataset both
    independently and consistently found. The repeatability of `cid=81264`
    across separate orders/lookups is circumstantial evidence it's the real
    answer and `cid=3040265` is a miss — but this investigation is DB-only
    and can't confirm what `cid=3040265` actually renders, so this is
    flagged low-confidence, not certain.
