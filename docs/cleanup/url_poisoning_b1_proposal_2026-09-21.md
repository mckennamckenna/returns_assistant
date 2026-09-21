# URL-poisoning cleanup — Phase B1 mapping proposal

**Date:** 2026-09-21 · **Status:** awaiting owner review · **Writes performed:** none

Read-only proposal. No DB writes, no code changes, and no LLM inference were used to
produce any mapping below. Phase B2 (applying the reviewed mapping) is a separate session,
drafted only after the owner has marked up this file.

## Method

Poisoned records identified with `isUrlShapedRetailer` from `lib/retailer-normalize.ts`,
used exactly as shipped in Phase A. Each mapping is proposed by the first rule that fires:

- **(a)** a sibling `ReturnUrlReview.rawRetailer` that is itself not URL-shaped — the
  verbatim `Order.retailer` snapshot taken at queue time, i.e. the pre-poisoning value.
- **(b)** the earliest linked `Email`'s extracted retailer, when not URL-shaped.
- **(c)** strict mechanical domain transform: strip protocol, `www.`/`wwwN.` prefix and the
  trailing TLD label, then upper-case the first character of the single remaining label.
  Rejected (falls through to **(d)**) when more than one label remains, nothing remains, or
  the label holds non-alphanumeric characters. **Mechanical output is not brand styling** —
  `hm.com` → `Hm`, `jcrew.com` → `Jcrew` are expected and are the owner's to correct here.
- **(d)** no deterministic source — needs owner input.

All 31 distinct poisoned values in the database are simple shapes; none carry a multi-part
ccTLD (`.co.uk`, `.com.au`), so the single-trailing-label TLD rule is unambiguous on this data.

## Order.retailer poisoned records

| Order ID | Current retailer | Proposed clean name | Source | Notes |
|---|---|---|---|---|
| `cmts5sz3p002dw9hvg6u52y2r` | `adidas.com` | adidas | a | clean sibling `rawRetailer` snapshot |
| `cmt7nv3jz0003ky047l3smhpj` | `americangirl.com` | American Girl | a | clean sibling `rawRetailer` snapshot |
| `cmtd5swb20003jx04cg1hbl0i` | `americangirl.com` | American Girl | a | clean sibling `rawRetailer` snapshot |
| `cmtx38o2i0006lb04js6xzqjq` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmu05zs5c0003k004qpixu78f` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmu06fmzd0003l404fuqgrg6n` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmtrjpljv0003l804oig6rqo4` | `click.oe.target.com` | Target | a | clean sibling `rawRetailer` snapshot |
| `cmts60jr9005cw9hv2o696nqh` | `crateandbarrel.com` | Crate & Barrel | a | clean sibling `rawRetailer` snapshot |
| `cmts5u17c002tw9hvxik7e6y1` | `dermstore.returns.international` | Dermstore | a | clean sibling `rawRetailer` snapshot |
| `cmts5rajz0016w9hvaqbqvlkr` | `ebay.com` | eBay | a | clean sibling `rawRetailer` snapshot |
| `cmsx8obt20003jl0471e9ymc0` | `gap.com` | Gap | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (GAP, Gap) — owner to pick one |
| `cmtkeeq7e0003le04eqt79jcz` | `gap.com` | GAP | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (GAP, Gap) — owner to pick one |
| `cmt4mqd3a0003jt04jfjo9tsc` | `gap.returns.optiturn.com` | Gap | a | clean sibling `rawRetailer` snapshot |
| `cmu0ht6sk0003l504ejee5xjz` | `help.etsy.com` | Etsy | a | clean sibling `rawRetailer` snapshot |
| `cmtt5q3wo0003lf040hayry7k` | `homewiseappliance.com` | Homewise Appliance | a | clean sibling `rawRetailer` snapshot |
| `cmu0jhar90003l004tnx974wt` | `homewiseappliance.com` | Homewise Appliance | a | clean sibling `rawRetailer` snapshot |
| `cmtuv1w9v0003js0444mjj565` | `mackweldon.com` | Mack Weldon | a | clean sibling `rawRetailer` snapshot |
| `cmteyx9mg0003l904xnx0wnx8` | `margauxny.loopreturns.com` | Margaux | a | clean sibling `rawRetailer` snapshot |
| `cmts1end20003l504emtwfdef` | `mpix.com` | Mpix | a | clean sibling `rawRetailer` snapshot |
| `cmrwa20650003jt04wu1gj5eu` | `mydhl.express.dhl` | Ancient Greek Sandals | a | clean sibling `rawRetailer` snapshot |
| `cmt69da620003jr04bjht9wpi` | `net-a-porter.com` | NET-A-PORTER | a | clean sibling `rawRetailer` snapshot |
| `cmts5yr4r004gw9hv8quzq9uz` | `net-a-porter.com` | NET-A-PORTER | a | clean sibling `rawRetailer` snapshot |
| `cmsf0uowt0003l8042s48knnc` | `oakvalleydesigns.com` | Oak Valley | a | clean sibling `rawRetailer` snapshot |
| `cmtt01yb80003le04zp35cdal` | `quince.com` | Quince | a | clean sibling `rawRetailer` snapshot |
| `cmr00604q0003kv04m0crwz5x` | `returns.loefflerrandall.com` | Loeffler Randall | a | clean sibling `rawRetailer` snapshot |
| `cmtjcke2d0005jp04j4t1uyab` | `rufflebutts.com` | Rufflebutts + Ruggedbutts | a | clean sibling `rawRetailer` snapshot |
| `cmt0igyn70003jp04ikjbwpz6` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmtfzrc5y0003lb0417quupfg` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmts0v1lf0003jo04b68i9w6f` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmtu784yi0004jx04bv6sfqfu` | `shopcadets.com` | Shop Cadets | a | clean sibling `rawRetailer` snapshot |
| `cmtyrynpe0003l804vhh7g6il` | `shopcadets.com` | Shop Cadets | a | clean sibling `rawRetailer` snapshot |
| `cmsnbxf1y0005l1047qablyfz` | `store.vespoli.com` | Vespoli USA Inc | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (Vespoli Online Store, Vespoli USA Inc) — owner to pick one |
| `cmsnbxo2d0007l104ysd75ggz` | `store.vespoli.com` | Vespoli Online Store | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (Vespoli Online Store, Vespoli USA Inc) — owner to pick one |
| `cmst2keat0003l504ctuu57q0` | `therealreal.com` | The RealReal | a | clean sibling `rawRetailer` snapshot |
| `cmtsqgdr60003k004epqb89lb` | `thorne.com` | Thorne | a | clean sibling `rawRetailer` snapshot |
| `cmtuvq93z0003l804bwz4t24q` | `us.unepiece.com` | UNE PIECE | a | clean sibling `rawRetailer` snapshot |
| `cmtrngjxg0003w96wn297uiwl` | `warbyparker.com` | Warby Parker | a | clean sibling `rawRetailer` snapshot |
| `cmt7fxe740003ld04arvg4xx6` | `wayfair.com` | Wayfair | a | clean sibling `rawRetailer` snapshot |
| `cmru5viic0009w97c9q00zh0c` | `www2.hm.com` | H&M | a | clean sibling `rawRetailer` snapshot |
| `cmsphd9ez0003jv04nrgtgmeo` | `Amazon.com` | Amazon | c | no related ReturnUrlReview row; earliest linked email's retailer is also URL-shaped; domain-derived (mechanical) — owner to confirm styling |

## ReturnUrlReview.approvedRetailer poisoned records

| Review ID | Status | Raw retailer | Current approvedRetailer | Proposed clean name | Source | Notes |
|---|---|---|---|---|---|---|
| `cmtxd9ppz000pjq04adyzodla` | APPROVED | `adidas` | `adidas.com` | adidas | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9ddc0001jq04zbtkwb2s` | APPROVED | `American Girl` | `americangirl.com` | American Girl | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9l87000fjq04yqf854e1` | APPROVED | `American Girl` | `americangirl.com` | American Girl | a | clean sibling `rawRetailer` snapshot |
| `cmtxda26c001hjq042goqa456` | APPROVED | `Nordstrom` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmu0ox3nh0005l0045pczfy19` | APPROVED | `Nordstrom` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmu0ox4r30007l0047s8gzocw` | APPROVED | `Nordstrom` | `click.eml.nordstrom.com` | Nordstrom | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9mxo000jjq04h2ih3m8l` | APPROVED | `Target` | `click.oe.target.com` | Target | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9v3y0013jq041v7rgxr8` | APPROVED | `Crate & Barrel` | `crateandbarrel.com` | Crate & Barrel | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9rwm000vjq04w5zp63rp` | APPROVED | `Dermstore` | `dermstore.returns.international` | Dermstore | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9r3s000tjq04arw37fn2` | APPROVED | `eBay` | `ebay.com` | eBay | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9oww000njq04i1qghg7x` | APPROVED | `GAP` | `gap.com` | GAP | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (GAP, Gap) — owner to pick one |
| `cmtxda6xo001rjq04en9q27de` | APPROVED | `Gap` | `gap.com` | Gap | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (GAP, Gap) — owner to pick one |
| `cmtxda8zj001xjq04c24fk0r1` | APPROVED | `Gap` | `gap.returns.optiturn.com` | Gap | a | clean sibling `rawRetailer` snapshot |
| `cmu0ox5l70009l004pg00fop7` | APPROVED | `Etsy` | `help.etsy.com` | Etsy | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9x3j0017jq04kyalbzdb` | APPROVED | `Homewise Appliance` | `homewiseappliance.com` | Homewise Appliance | a | clean sibling `rawRetailer` snapshot |
| `cmu0ox6n9000bl0048p2taj0m` | APPROVED | `Homewise Appliance` | `homewiseappliance.com` | Homewise Appliance | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9zm5001bjq04cwufmp9q` | APPROVED | `Mack Weldon` | `mackweldon.com` | Mack Weldon | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9f9q0003jq04sptpjii6` | APPROVED | `Margaux` | `margauxny.loopreturns.com` | Margaux | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9spo000xjq048hpldmna` | APPROVED | `Mpix` | `mpix.com` | Mpix | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9kjf000djq04r0mh724x` | APPROVED | `Ancient Greek Sandals` | `mydhl.express.dhl` | Ancient Greek Sandals | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9m0r000hjq04ndtx271r` | APPROVED | `NET-A-PORTER` | `net-a-porter.com` | NET-A-PORTER | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9ubq0011jq04j9qa05jf` | APPROVED | `NET-A-PORTER` | `net-a-porter.com` | NET-A-PORTER | a | clean sibling `rawRetailer` snapshot |
| `cmtxda44m001ljq0499dt8ac2` | APPROVED | `Oak Valley` | `oakvalleydesigns.com` | Oak Valley | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9vx70015jq04lg67mod9` | APPROVED | `Quince` | `quince.com` | Quince | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9ipu0009jq04c240xnaa` | APPROVED | `Loeffler Randall` | `returns.loefflerrandall.com` | Loeffler Randall | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9jpw000bjq04l651utlj` | APPROVED | `Rufflebutts + Ruggedbutts` | `rufflebutts.com` | Rufflebutts + Ruggedbutts | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9g9l0005jq04kloxhlos` | APPROVED | `Shopbop` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9h2d0007jq04jwoqo9pb` | APPROVED | `Shopbop` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9qap000rjq04fuw6ub5u` | APPROVED | `Shopbop` | `shopbop.com` | Shopbop | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9xuz0019jq04a37duk99` | APPROVED | `Shop Cadets` | `shopcadets.com` | Shop Cadets | a | clean sibling `rawRetailer` snapshot |
| `cmu0ox28x0003l004jomwbla4` | APPROVED | `Shop Cadets` | `shopcadets.com` | Shop Cadets | a | clean sibling `rawRetailer` snapshot |
| `cmtxda17b001fjq04oj1oqni0` | APPROVED | `Vespoli USA Inc` | `store.vespoli.com` | Vespoli USA Inc | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (Vespoli Online Store, Vespoli USA Inc) — owner to pick one |
| `cmtxda3c5001jjq046iq1rwjg` | APPROVED | `Vespoli Online Store` | `store.vespoli.com` | Vespoli Online Store | a | clean sibling `rawRetailer` snapshot; same URL value maps to differing names across rows (Vespoli Online Store, Vespoli USA Inc) — owner to pick one |
| `cmtxda9x5001zjq04p6b4ufkf` | APPROVED | `The RealReal` | `therealreal.com` | The RealReal | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9tj2000zjq04jv3bl10y` | APPROVED | `Thorne` | `thorne.com` | Thorne | a | clean sibling `rawRetailer` snapshot |
| `cmtxda09l001djq0418gf5bkq` | APPROVED | `UNE PIECE` | `us.unepiece.com` | UNE PIECE | a | clean sibling `rawRetailer` snapshot |
| `cmtxd9ny6000ljq04sdwbii8m` | APPROVED | `Warby Parker` | `warbyparker.com` | Warby Parker | a | clean sibling `rawRetailer` snapshot |
| `cmtxda87i001vjq04nsf0695o` | APPROVED | `Wayfair` | `wayfair.com` | Wayfair | a | clean sibling `rawRetailer` snapshot |
| `cmtxda4t4001njq045esd5u0f` | APPROVED | `H&M` | `www2.hm.com` | H&M | a | clean sibling `rawRetailer` snapshot |
| `cmtxda5vt001pjq04vfve05s3` | REJECTED | `Target` | `click.oe.target.com` | Target | a | clean sibling `rawRetailer` snapshot |
| `cmtxda7jq001tjq04yddsby3t` | REJECTED | `Apple` | `store.apple.com` | Apple | a | clean sibling `rawRetailer` snapshot |

## Summary

- **Total records proposed for cleanup: 81** — 40 `Order.retailer`, 41 `ReturnUrlReview.approvedRetailer`.
- **High confidence (source a/b — clean sibling DB data): 80** (39 orders, 41 reviews).
- **Medium confidence (source c — mechanical transform, owner to confirm styling): 1** (1 orders, 0 reviews).
- **Needs owner input (source d): 0.**

The `ReturnUrlReview.rawRetailer` snapshot turned out to be clean for every poisoned review
row and for 39 of 40 poisoned orders, so nearly the whole cleanup is recoverable from data
the database already holds — no brand-name guessing required. Poisoned review rows are
confined to terminal statuses (39 APPROVED, 2 REJECTED); all 16 PENDING rows are clean.

### Duplicate-value implications (flagged, not fixed)

Cleanup would leave these retailer values shared across multiple Orders. Multiple orders from
one retailer is normal and expected, but `lib/linkOrder.ts` matches on retailer, so this is
worth a look before B2 applies anything — it is *not* in scope to fix here.

| Proposed value (normalized) | Orders sharing it after cleanup |
|---|---|
| `american girl` | 2 proposed + 0 already-clean order(s) = 2 orders sharing this retailer value |
| `shopbop` | 3 proposed + 5 already-clean order(s) = 8 orders sharing this retailer value |
| `net-a-porter` | 2 proposed + 3 already-clean order(s) = 5 orders sharing this retailer value |
| `ancient greek sandals` | 1 proposed + 1 already-clean order(s) = 2 orders sharing this retailer value |
| `target` | 1 proposed + 5 already-clean order(s) = 6 orders sharing this retailer value |
| `gap` | 3 proposed + 4 already-clean order(s) = 7 orders sharing this retailer value |
| `ebay` | 1 proposed + 5 already-clean order(s) = 6 orders sharing this retailer value |
| `homewise appliance` | 2 proposed + 1 already-clean order(s) = 3 orders sharing this retailer value |
| `shop cadets` | 2 proposed + 0 already-clean order(s) = 2 orders sharing this retailer value |
| `quince` | 1 proposed + 1 already-clean order(s) = 2 orders sharing this retailer value |
| `nordstrom` | 3 proposed + 4 already-clean order(s) = 7 orders sharing this retailer value |
| `dermstore` | 1 proposed + 2 already-clean order(s) = 3 orders sharing this retailer value |
| `etsy` | 1 proposed + 2 already-clean order(s) = 3 orders sharing this retailer value |
| `h&m` | 1 proposed + 3 already-clean order(s) = 4 orders sharing this retailer value |
| `amazon` | 1 proposed + 106 already-clean order(s) = 107 orders sharing this retailer value |
| `wayfair` | 1 proposed + 2 already-clean order(s) = 3 orders sharing this retailer value |
| `the realreal` | 1 proposed + 3 already-clean order(s) = 4 orders sharing this retailer value |

### Owner review checklist

- Confirm or correct styling on the source (c) row (`Amazon.com` → `Amazon`).
- Resolve rows where one URL value maps to differently-worded names (flagged in Notes).
- Mark up any source (a) name you disagree with — those come from a snapshot, not a decision.
- Spot-check the rows whose poisoned value is a *third-party* domain rather than the
  retailer's own — a carrier (`mydhl.express.dhl`), a returns platform
  (`*.loopreturns.com`, `*.optiturn.com`, `dermstore.returns.international`) or a
  click-tracker (`click.eml.nordstrom.com`, `click.oe.target.com`). These are the cases a
  mechanical transform could never have recovered; every one of them resolved from the
  `rawRetailer` snapshot, so they are worth confirming rather than assuming.
