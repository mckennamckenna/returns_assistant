# Fix recommendation — `returnPortalUrl` root cause, 2026-09-02

## The data points at one dominant category

**C — "no good URL existed, extraction substituted something instead of
returning null" — is 9 of 19 (47%), the single largest category, and it's
concentrated in a specific, recognizable shape:** a retailer that genuinely
has no self-serve return-initiation URL (Buff City Soap, Vespoli, Market
Hall Foods, Shopbop) or an email whose only URL is the wrong *kind* of link
(a carrier drop-off locator, a single-use transactional/credit-summary link)
gets a URL written anyway, when the prompt's own instructions
(`lib/extract.ts:224,231`) already say not to do this: *"NOT the homepage,
NOT a general help-center search page... Only report returnPortalUrl if you
find an actual, specific URL... for starting a return."* In several of these
cases the extraction's own `extractionNotes` explicitly reasons its way to
"there is no dedicated self-serve return portal" or "no standalone
direct-return-initiation URL... was found" — and then populates the field
anyway with the nearest miss. This is a prompt-following failure, not a
capability gap: the model already has the right judgment in its own
reasoning trace, it just isn't instructed strongly enough to act on that
judgment by returning null.

**D (inconclusive, likely correct — 5, 26%) and F (correct-then-decayed — 1,
5%) are not extraction defects at all.** D's rows should mostly be retracted
from "bad" once verified from a real browser context (Julia Amory in
particular looks like a false positive in the original audit — its portal
was *used* by the traced order). F is a live-value-freshness problem
(elapsed-time link rot on marketing/tracking-style URLs), unrelated to what
was written at extraction time.

**E (merge overwrote good with bad — 3, 16%) is a second, structurally
distinct problem** worth fixing regardless of category C: `mergeEmailIntoOrder`
(`lib/linkOrder.ts:835`) and `resolveReturnPortalUrlForWrite`
(`lib/extract.ts:411`) both implement "the newest non-null value always
wins," with zero comparison of confidence, `policySource`, or trust tier
between the incoming and existing values. This session found it firing in
two different circumstances: the already-known self-email-ingestion loop
(2 orders), and — new this session — ordinary multi-email processing order
on a real order with no self-email involved at all (Wayfair: a specific
help-article URL from one email overwritten by a generic account page from
a later email). The self-email case has its own dedicated fix already
queued in `TASKS.md` (ingestion-level rejection). The Wayfair case shows the
underlying merge logic is a live risk independent of that fix — closing the
self-email loop stops one *source* of bad incoming values, but does nothing
about a later email's merely-worse (not malicious) value overwriting an
earlier email's better one.

## Recommendation: prompt fix first, merge-logic fix second — don't chase D or F

**1. Prompt iteration (addresses category C, 9/19 — the largest, cheapest,
highest-leverage fix).** Strengthen the null-vs-substitute instruction at
the two `returnPortalUrl` extraction sites (`lib/extract.ts` — the
email-body extraction prompt around line 189, and the web-lookup prompt
around line 224). The current instruction is directionally right but
evidently not forceful enough against the model's own tendency to give
"a" URL rather than admit no full match exists. A more effective version
would: (a) explicitly enumerate the failure shapes seen in this data —
carrier/logistics locator URLs, single-use transactional/credit-summary
links, generic Contact-Us/Customer-Service pages, login-gated account
pages, homepage-with-query-string — as things to actively reject, not just
"NOT the homepage"; (b) make the null path the *stated default* when the
model's own reasoning (visible in `extractionNotes` in this data) concludes
no dedicated portal exists, rather than something to fall back to only if
literally no URL is present in the source. This is a prompt-only change,
testable against this session's own eval-set (`eval-set.jsonl`) before
touching production traffic — no new call sites needed.

**2. Merge-logic fix (addresses category E, 3/19).** `mergeEmailIntoOrder`'s
returnPortalUrl write should stop being pure "latest non-null wins."
Minimal, low-risk version: don't overwrite an existing value with a new one
from a *lower or equal* trust tier (`classifyReturnPortalTrust`,
`lib/extract.ts:470`, already exists and is computed at the
`linkEmailToOrder` call site — `lib/linkOrder.ts:1116` — just not currently
consulted by the merge write itself). This is additive risk-reduction, not
a rewrite: same function signature, same call sites, one more comparison
before the unconditional overwrite. Directly prevents the Wayfair pattern
and is a second, independent layer of protection for the self-email pattern
even after ingestion-level rejection ships.

**3. Do not build anything new for D (5/19) or F (1/19) from this
investigation.** D needs live-browser verification (a headless-browser
fetch, not a plain HTTP GET) to even establish whether it's actually
broken — that's a different, larger investment (`returnportal-trust-tier`'s
"inconclusive" bucket idea, already flagged in the original audit, is the
right shape for this, not a new build here). F is link decay, addressed by
send-time/read-time freshness validation, not an extraction change — also
already named in the original audit's three-piece framing. Building either
now would be solving a problem this data doesn't actually show is
extraction's fault.

## What this leaves unaddressed

- The 1 low-confidence B row (Gap `cid=3040265`) needs a live fetch to even
  confirm it's wrong before any fix is designed around it — don't generalize
  a fix from an unconfirmed single row.
- Category C's harder subset — retailers that structurally have no
  self-serve portal at all (Buff City Soap, Vespoli, Market Hall Foods) —
  will still show `returnPortalUrl: null` after a prompt fix, correctly.
  That's a UX question (what does "Start a return" do for these orders),
  not an extraction-quality question, and is out of scope for this
  investigation.
- Fixing C and E does not touch D or F's counts at all — expect the
  "bad rate" to stay elevated after this fix ships unless D is separately
  reclassified via live verification and F is separately addressed via
  freshness validation, per the original audit's three-piece framing.
