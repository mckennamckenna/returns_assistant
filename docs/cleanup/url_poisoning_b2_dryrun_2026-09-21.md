# URL-poisoning cleanup — Phase B2 dry-run log

**Generated:** 2026-09-21T23:59:57.620Z · **Writes executed: NONE** (dry run)

Computed from the reviewed B1 artifact (`url_poisoning_b1_proposal_2026-09-21.md`, commit
`d3849cc`) against current DB state. Awaiting owner `GO B2` before any UPDATE runs.

## Header

| Check | Value |
|---|---|
| T3 recount — `Order.retailer` URL-shaped | 40 (B1: 40) |
| T3 recount — `ReturnUrlReview.approvedRetailer` URL-shaped | 41 (B1: 41) |
| — PENDING / APPROVED / REJECTED | 0 / 39 / 2 (B1: 0 / 39 / 2) |
| **Delta vs B1** | **ZERO** |
| Total intended writes | **81** (40 orders, 41 reviews) |
| Unmapped — skipped (needs new B1 pass) | **0** |
| `gap.com` → `Gap` override applied | **2 rows** (1 order, 1 review) |

Every write below is gated on BOTH primary key AND the current URL-shaped value, so a row
cleaned by anything else between now and execution matches zero rows and is skipped.

## Order.retailer — intended writes

| Order ID | Current (URL-shaped) | Proposed clean value | B1 source | Override |
|---|---|---|---|---|
| `cmts5sz3p002dw9hvg6u52y2r` | `adidas.com` | adidas | a | — |
| `cmsphd9ez0003jv04nrgtgmeo` | `Amazon.com` | Amazon | c | — |
| `cmtd5swb20003jx04cg1hbl0i` | `americangirl.com` | American Girl | a | — |
| `cmt7nv3jz0003ky047l3smhpj` | `americangirl.com` | American Girl | a | — |
| `cmtx38o2i0006lb04js6xzqjq` | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmu06fmzd0003l404fuqgrg6n` | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmu05zs5c0003k004qpixu78f` | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmtrjpljv0003l804oig6rqo4` | `click.oe.target.com` | Target | a | — |
| `cmts60jr9005cw9hv2o696nqh` | `crateandbarrel.com` | Crate & Barrel | a | — |
| `cmts5u17c002tw9hvxik7e6y1` | `dermstore.returns.international` | Dermstore | a | — |
| `cmts5rajz0016w9hvaqbqvlkr` | `ebay.com` | eBay | a | — |
| `cmtkeeq7e0003le04eqt79jcz` | `gap.com` | Gap | a | **yes — owner: GAP → Gap** |
| `cmsx8obt20003jl0471e9ymc0` | `gap.com` | Gap | a | — |
| `cmt4mqd3a0003jt04jfjo9tsc` | `gap.returns.optiturn.com` | Gap | a | — |
| `cmu0ht6sk0003l504ejee5xjz` | `help.etsy.com` | Etsy | a | — |
| `cmtt5q3wo0003lf040hayry7k` | `homewiseappliance.com` | Homewise Appliance | a | — |
| `cmu0jhar90003l004tnx974wt` | `homewiseappliance.com` | Homewise Appliance | a | — |
| `cmtuv1w9v0003js0444mjj565` | `mackweldon.com` | Mack Weldon | a | — |
| `cmteyx9mg0003l904xnx0wnx8` | `margauxny.loopreturns.com` | Margaux | a | — |
| `cmts1end20003l504emtwfdef` | `mpix.com` | Mpix | a | — |
| `cmrwa20650003jt04wu1gj5eu` | `mydhl.express.dhl` | Ancient Greek Sandals | a | — |
| `cmt69da620003jr04bjht9wpi` | `net-a-porter.com` | NET-A-PORTER | a | — |
| `cmts5yr4r004gw9hv8quzq9uz` | `net-a-porter.com` | NET-A-PORTER | a | — |
| `cmsf0uowt0003l8042s48knnc` | `oakvalleydesigns.com` | Oak Valley | a | — |
| `cmtt01yb80003le04zp35cdal` | `quince.com` | Quince | a | — |
| `cmr00604q0003kv04m0crwz5x` | `returns.loefflerrandall.com` | Loeffler Randall | a | — |
| `cmtjcke2d0005jp04j4t1uyab` | `rufflebutts.com` | Rufflebutts + Ruggedbutts | a | — |
| `cmtfzrc5y0003lb0417quupfg` | `shopbop.com` | Shopbop | a | — |
| `cmt0igyn70003jp04ikjbwpz6` | `shopbop.com` | Shopbop | a | — |
| `cmts0v1lf0003jo04b68i9w6f` | `shopbop.com` | Shopbop | a | — |
| `cmtu784yi0004jx04bv6sfqfu` | `shopcadets.com` | Shop Cadets | a | — |
| `cmtyrynpe0003l804vhh7g6il` | `shopcadets.com` | Shop Cadets | a | — |
| `cmsnbxo2d0007l104ysd75ggz` | `store.vespoli.com` | Vespoli Online Store | a | — |
| `cmsnbxf1y0005l1047qablyfz` | `store.vespoli.com` | Vespoli USA Inc | a | — |
| `cmst2keat0003l504ctuu57q0` | `therealreal.com` | The RealReal | a | — |
| `cmtsqgdr60003k004epqb89lb` | `thorne.com` | Thorne | a | — |
| `cmtuvq93z0003l804bwz4t24q` | `us.unepiece.com` | UNE PIECE | a | — |
| `cmtrngjxg0003w96wn297uiwl` | `warbyparker.com` | Warby Parker | a | — |
| `cmt7fxe740003ld04arvg4xx6` | `wayfair.com` | Wayfair | a | — |
| `cmru5viic0009w97c9q00zh0c` | `www2.hm.com` | H&M | a | — |

## ReturnUrlReview.approvedRetailer — intended writes

| Review ID | Status | Current (URL-shaped) | Proposed clean value | B1 source | Override |
|---|---|---|---|---|---|
| `cmtxd9ppz000pjq04adyzodla` | APPROVED | `adidas.com` | adidas | a | — |
| `cmtxd9ddc0001jq04zbtkwb2s` | APPROVED | `americangirl.com` | American Girl | a | — |
| `cmtxd9l87000fjq04yqf854e1` | APPROVED | `americangirl.com` | American Girl | a | — |
| `cmu0ox3nh0005l0045pczfy19` | APPROVED | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmu0ox4r30007l0047s8gzocw` | APPROVED | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmtxda26c001hjq042goqa456` | APPROVED | `click.eml.nordstrom.com` | Nordstrom | a | — |
| `cmtxd9mxo000jjq04h2ih3m8l` | APPROVED | `click.oe.target.com` | Target | a | — |
| `cmtxda5vt001pjq04vfve05s3` | REJECTED | `click.oe.target.com` | Target | a | — |
| `cmtxd9v3y0013jq041v7rgxr8` | APPROVED | `crateandbarrel.com` | Crate & Barrel | a | — |
| `cmtxd9rwm000vjq04w5zp63rp` | APPROVED | `dermstore.returns.international` | Dermstore | a | — |
| `cmtxd9r3s000tjq04arw37fn2` | APPROVED | `ebay.com` | eBay | a | — |
| `cmtxd9oww000njq04i1qghg7x` | APPROVED | `gap.com` | Gap | a | **yes — owner: GAP → Gap** |
| `cmtxda6xo001rjq04en9q27de` | APPROVED | `gap.com` | Gap | a | — |
| `cmtxda8zj001xjq04c24fk0r1` | APPROVED | `gap.returns.optiturn.com` | Gap | a | — |
| `cmu0ox5l70009l004pg00fop7` | APPROVED | `help.etsy.com` | Etsy | a | — |
| `cmu0ox6n9000bl0048p2taj0m` | APPROVED | `homewiseappliance.com` | Homewise Appliance | a | — |
| `cmtxd9x3j0017jq04kyalbzdb` | APPROVED | `homewiseappliance.com` | Homewise Appliance | a | — |
| `cmtxd9zm5001bjq04cwufmp9q` | APPROVED | `mackweldon.com` | Mack Weldon | a | — |
| `cmtxd9f9q0003jq04sptpjii6` | APPROVED | `margauxny.loopreturns.com` | Margaux | a | — |
| `cmtxd9spo000xjq048hpldmna` | APPROVED | `mpix.com` | Mpix | a | — |
| `cmtxd9kjf000djq04r0mh724x` | APPROVED | `mydhl.express.dhl` | Ancient Greek Sandals | a | — |
| `cmtxd9m0r000hjq04ndtx271r` | APPROVED | `net-a-porter.com` | NET-A-PORTER | a | — |
| `cmtxd9ubq0011jq04j9qa05jf` | APPROVED | `net-a-porter.com` | NET-A-PORTER | a | — |
| `cmtxda44m001ljq0499dt8ac2` | APPROVED | `oakvalleydesigns.com` | Oak Valley | a | — |
| `cmtxd9vx70015jq04lg67mod9` | APPROVED | `quince.com` | Quince | a | — |
| `cmtxd9ipu0009jq04c240xnaa` | APPROVED | `returns.loefflerrandall.com` | Loeffler Randall | a | — |
| `cmtxd9jpw000bjq04l651utlj` | APPROVED | `rufflebutts.com` | Rufflebutts + Ruggedbutts | a | — |
| `cmtxd9g9l0005jq04kloxhlos` | APPROVED | `shopbop.com` | Shopbop | a | — |
| `cmtxd9h2d0007jq04jwoqo9pb` | APPROVED | `shopbop.com` | Shopbop | a | — |
| `cmtxd9qap000rjq04fuw6ub5u` | APPROVED | `shopbop.com` | Shopbop | a | — |
| `cmu0ox28x0003l004jomwbla4` | APPROVED | `shopcadets.com` | Shop Cadets | a | — |
| `cmtxd9xuz0019jq04a37duk99` | APPROVED | `shopcadets.com` | Shop Cadets | a | — |
| `cmtxda7jq001tjq04yddsby3t` | REJECTED | `store.apple.com` | Apple | a | — |
| `cmtxda3c5001jjq046iq1rwjg` | APPROVED | `store.vespoli.com` | Vespoli Online Store | a | — |
| `cmtxda17b001fjq04oj1oqni0` | APPROVED | `store.vespoli.com` | Vespoli USA Inc | a | — |
| `cmtxda9x5001zjq04p6b4ufkf` | APPROVED | `therealreal.com` | The RealReal | a | — |
| `cmtxd9tj2000zjq04jv3bl10y` | APPROVED | `thorne.com` | Thorne | a | — |
| `cmtxda09l001djq0418gf5bkq` | APPROVED | `us.unepiece.com` | UNE PIECE | a | — |
| `cmtxd9ny6000ljq04sdwbii8m` | APPROVED | `warbyparker.com` | Warby Parker | a | — |
| `cmtxda87i001vjq04nsf0695o` | APPROVED | `wayfair.com` | Wayfair | a | — |
| `cmtxda4t4001njq045esd5u0f` | APPROVED | `www2.hm.com` | H&M | a | — |

## Unmapped — skipped

None. Every poisoned record in the DB is covered by the B1 mapping.
