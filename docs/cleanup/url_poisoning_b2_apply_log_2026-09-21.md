# URL-poisoning cleanup — Phase B2 apply log

**Execution started:** 2026-09-22T02:19:25.816Z · **Authorized by owner: `GO B2`**

Bare `updateMany` on two fields only, each gated on primary key AND the current
URL-shaped value. No recompute, re-link, or status-derivation function was called.

## Order.retailer writes

| Order ID | Expected new value | updateMany count | Flag |
|---|---|---|---|
| `cmts5sz3p002dw9hvg6u52y2r` | adidas | 1 | — |
| `cmsphd9ez0003jv04nrgtgmeo` | Amazon | 1 | — |
| `cmtd5swb20003jx04cg1hbl0i` | American Girl | 1 | — |
| `cmt7nv3jz0003ky047l3smhpj` | American Girl | 1 | — |
| `cmtx38o2i0006lb04js6xzqjq` | Nordstrom | 1 | — |
| `cmu06fmzd0003l404fuqgrg6n` | Nordstrom | 1 | — |
| `cmu05zs5c0003k004qpixu78f` | Nordstrom | 1 | — |
| `cmtrjpljv0003l804oig6rqo4` | Target | 1 | — |
| `cmts60jr9005cw9hv2o696nqh` | Crate & Barrel | 1 | — |
| `cmts5u17c002tw9hvxik7e6y1` | Dermstore | 1 | — |
| `cmts5rajz0016w9hvaqbqvlkr` | eBay | 1 | — |
| `cmtkeeq7e0003le04eqt79jcz` | Gap | 1 | — |
| `cmsx8obt20003jl0471e9ymc0` | Gap | 1 | — |
| `cmt4mqd3a0003jt04jfjo9tsc` | Gap | 1 | — |
| `cmu0ht6sk0003l504ejee5xjz` | Etsy | 1 | — |
| `cmtt5q3wo0003lf040hayry7k` | Homewise Appliance | 1 | — |
| `cmu0jhar90003l004tnx974wt` | Homewise Appliance | 1 | — |
| `cmtuv1w9v0003js0444mjj565` | Mack Weldon | 1 | — |
| `cmteyx9mg0003l904xnx0wnx8` | Margaux | 1 | — |
| `cmts1end20003l504emtwfdef` | Mpix | 1 | — |
| `cmrwa20650003jt04wu1gj5eu` | Ancient Greek Sandals | 1 | — |
| `cmt69da620003jr04bjht9wpi` | NET-A-PORTER | 1 | — |
| `cmts5yr4r004gw9hv8quzq9uz` | NET-A-PORTER | 1 | — |
| `cmsf0uowt0003l8042s48knnc` | Oak Valley | 1 | — |
| `cmtt01yb80003le04zp35cdal` | Quince | 1 | — |
| `cmr00604q0003kv04m0crwz5x` | Loeffler Randall | 1 | — |
| `cmtjcke2d0005jp04j4t1uyab` | Rufflebutts + Ruggedbutts | 1 | — |
| `cmtfzrc5y0003lb0417quupfg` | Shopbop | 1 | — |
| `cmt0igyn70003jp04ikjbwpz6` | Shopbop | 1 | — |
| `cmts0v1lf0003jo04b68i9w6f` | Shopbop | 1 | — |
| `cmtu784yi0004jx04bv6sfqfu` | Shop Cadets | 1 | — |
| `cmtyrynpe0003l804vhh7g6il` | Shop Cadets | 1 | — |
| `cmsnbxo2d0007l104ysd75ggz` | Vespoli Online Store | 1 | — |
| `cmsnbxf1y0005l1047qablyfz` | Vespoli USA Inc | 1 | — |
| `cmst2keat0003l504ctuu57q0` | The RealReal | 1 | — |
| `cmtsqgdr60003k004epqb89lb` | Thorne | 1 | — |
| `cmtuvq93z0003l804bwz4t24q` | UNE PIECE | 1 | — |
| `cmtrngjxg0003w96wn297uiwl` | Warby Parker | 1 | — |
| `cmt7fxe740003ld04arvg4xx6` | Wayfair | 1 | — |
| `cmru5viic0009w97c9q00zh0c` | H&M | 1 | — |

## ReturnUrlReview.approvedRetailer writes

| Review ID | Status | Expected new value | updateMany count | Flag |
|---|---|---|---|---|
| `cmtxd9ppz000pjq04adyzodla` | APPROVED | adidas | 1 | — |
| `cmtxd9ddc0001jq04zbtkwb2s` | APPROVED | American Girl | 1 | — |
| `cmtxd9l87000fjq04yqf854e1` | APPROVED | American Girl | 1 | — |
| `cmu0ox3nh0005l0045pczfy19` | APPROVED | Nordstrom | 1 | — |
| `cmu0ox4r30007l0047s8gzocw` | APPROVED | Nordstrom | 1 | — |
| `cmtxda26c001hjq042goqa456` | APPROVED | Nordstrom | 1 | — |
| `cmtxd9mxo000jjq04h2ih3m8l` | APPROVED | Target | 1 | — |
| `cmtxda5vt001pjq04vfve05s3` | REJECTED | Target | 1 | — |
| `cmtxd9v3y0013jq041v7rgxr8` | APPROVED | Crate & Barrel | 1 | — |
| `cmtxd9rwm000vjq04w5zp63rp` | APPROVED | Dermstore | 1 | — |
| `cmtxd9r3s000tjq04arw37fn2` | APPROVED | eBay | 1 | — |
| `cmtxd9oww000njq04i1qghg7x` | APPROVED | Gap | 1 | — |
| `cmtxda6xo001rjq04en9q27de` | APPROVED | Gap | 1 | — |
| `cmtxda8zj001xjq04c24fk0r1` | APPROVED | Gap | 1 | — |
| `cmu0ox5l70009l004pg00fop7` | APPROVED | Etsy | 1 | — |
| `cmu0ox6n9000bl0048p2taj0m` | APPROVED | Homewise Appliance | 1 | — |
| `cmtxd9x3j0017jq04kyalbzdb` | APPROVED | Homewise Appliance | 1 | — |
| `cmtxd9zm5001bjq04cwufmp9q` | APPROVED | Mack Weldon | 1 | — |
| `cmtxd9f9q0003jq04sptpjii6` | APPROVED | Margaux | 1 | — |
| `cmtxd9spo000xjq048hpldmna` | APPROVED | Mpix | 1 | — |
| `cmtxd9kjf000djq04r0mh724x` | APPROVED | Ancient Greek Sandals | 1 | — |
| `cmtxd9m0r000hjq04ndtx271r` | APPROVED | NET-A-PORTER | 1 | — |
| `cmtxd9ubq0011jq04j9qa05jf` | APPROVED | NET-A-PORTER | 1 | — |
| `cmtxda44m001ljq0499dt8ac2` | APPROVED | Oak Valley | 1 | — |
| `cmtxd9vx70015jq04lg67mod9` | APPROVED | Quince | 1 | — |
| `cmtxd9ipu0009jq04c240xnaa` | APPROVED | Loeffler Randall | 1 | — |
| `cmtxd9jpw000bjq04l651utlj` | APPROVED | Rufflebutts + Ruggedbutts | 1 | — |
| `cmtxd9g9l0005jq04kloxhlos` | APPROVED | Shopbop | 1 | — |
| `cmtxd9h2d0007jq04jwoqo9pb` | APPROVED | Shopbop | 1 | — |
| `cmtxd9qap000rjq04fuw6ub5u` | APPROVED | Shopbop | 1 | — |
| `cmu0ox28x0003l004jomwbla4` | APPROVED | Shop Cadets | 1 | — |
| `cmtxd9xuz0019jq04a37duk99` | APPROVED | Shop Cadets | 1 | — |
| `cmtxda7jq001tjq04yddsby3t` | REJECTED | Apple | 1 | — |
| `cmtxda3c5001jjq046iq1rwjg` | APPROVED | Vespoli Online Store | 1 | — |
| `cmtxda17b001fjq04oj1oqni0` | APPROVED | Vespoli USA Inc | 1 | — |
| `cmtxda9x5001zjq04p6b4ufkf` | APPROVED | The RealReal | 1 | — |
| `cmtxd9tj2000zjq04jv3bl10y` | APPROVED | Thorne | 1 | — |
| `cmtxda09l001djq0418gf5bkq` | APPROVED | UNE PIECE | 1 | — |
| `cmtxd9ny6000ljq04sdwbii8m` | APPROVED | Warby Parker | 1 | — |
| `cmtxda87i001vjq04nsf0695o` | APPROVED | Wayfair | 1 | — |
| `cmtxda4t4001njq045esd5u0f` | APPROVED | H&M | 1 | — |

## T6 post-check

| Check | Result |
|---|---|
| Rows written — `Order.retailer` | 40 / 40 |
| Rows written — `ReturnUrlReview.approvedRetailer` | 41 / 41 |
| Residual URL-shaped `Order.retailer` | **0** (must be 0) |
| Residual URL-shaped `ReturnUrlReview.approvedRetailer` | **0** (must be 0) |
| updateMany calls returning a count other than 1 | **0** |
| Post-check completed | 2026-09-22T02:19:54.595Z |

Both tables hold zero URL-shaped values. Cleanup landed in full.
