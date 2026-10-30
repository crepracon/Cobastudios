# Signs & banners market data (phase 1, Oct 2026)

Competitor price grids for lawn signs, vinyl banners, large stickers and A-frames, collected the same way as the
sticker prices (from inside a real browser tab on each site, using the requests the pages make). Not wired into the
estimator yet: the next step is a beta page, then the Vinyl / Roland Banners and Signage sections after Chris approves.

## Files
| File | What it does |
|---|---|
| `collect-vistaprint-signs.js` | vistaprint.ca: lawn signs 1 and 2 sided (6 sizes, 1-100), wire H-stakes, vinyl banners 13 oz with and without reinforced edges and 15 oz (8 sizes, 1-10). |
| `collect-staples-signs.js` | shop.staplescopyandprint.ca (Staples Canada's print shop): yard signs 1/2 sided + stake add-on, outdoor banners 13 oz and 18 oz, A-frames. Flat price per unit. |
| `collect-stickermule-signs.js` | stickermule.com/ca: rigid yard signs (24 x 18, 2 sided, stake included) and laminated die cut stickers 8-24 in. |
| `collect-bannerbuzz-signs.js` | bannerbuzz.ca: custom vinyl banners 13 oz (grommets, flush cut), with quantity discounts. |
| `collect-result.js` | Fetches a collector's result (see below). |
| `build-data.js` | Verifies checksums and builds `data/signs-market-<date>.json` with like-for-like tags per seller. |

## Running a collector
The browser tool stops waiting after 45 seconds, so these collectors start in the background:
1. Open the seller's page with `preview_start` and wait ~3 s.
2. Run the collector file's full text with `javascript_tool`; it returns `started`.
3. Run `collect-result.js` in the same tab until it returns the JSON (VistaPrint takes about a minute).
4. Save each result to a folder, then `node tools/market-refresh/signs/build-data.js --in <folder> --out tools/market-refresh/signs/data/signs-market-<date>.json --date <date>`.

## Like-for-like rules (Chris, Oct 29 2026)
- **Lawn signs:** 1 sided and 2 sided are separate groups. Stakes are an add-on: compare sign-only prices, and add each
  seller's own stake price only when the quote includes stakes. Sticker Mule always includes an H-stake (and only
  sells 2 sided 24 x 18), so it is compared only when the quote includes stakes.
- **Banners:** group by material weight (13 oz vs heavy 15-18 oz) and by finishing (hemmed/reinforced edges + grommets
  vs grommets only). BannerBuzz is flush cut (no hem), so it only compares with unhemmed quotes. VistaPrint calls its
  13 oz material "Indoor" (its "Outdoor" is 15 oz).
- **Sandwich boards:** catalogue both complete (with frame) and printed inserts only.
- **Shipping:** compare prices before shipping; show each seller's shipping as a note (local pickup is Coba's advantage).
- Staples has no quantity breaks; VistaPrint's and BannerBuzz's crossed-out prices are not used (VistaPrint list price is
  stored with the sale price next to it; BannerBuzz stores what customers pay).

## Request details (Oct 2026)
- VistaPrint lawn signs: `quantityPriceBreaks` with productKey `PRD-R1AJEBVL` v65, selections Size (e.g. `18" x 24"`),
  `Single vs Double Sided Printing`, Material `Corrugated Plastic`, Shapes, Grommets, Finish, Orientation, `Need a product fast`, `Is this a Sample?`.
- VistaPrint banners and stakes: `wrangler.prod.merch.vpsvc.com/api/v1/vistaprint/en-ca/configuratorData/<key>/<version>`
  with `selectedAttributes[...]` (banners `PRD-XKHDONHL` v78: Size `Custom` + `Custom Width`/`Custom Height` in feet,
  `Material Type` Indoor/Outdoor, `Reinforced Edges`, `Hanging Option`; stakes `PRD-TD5YF4R8` v8). Heavy-Duty 18 oz is
  refused by the configurator for custom sizes, so it is not collected.
- Staples: `www.staplescopyandprint.ca/PrintProductApps/CaPPPrintProducts/CanvaOptions?subProduct=` `CanvaPP_Sign_YardEx`,
  `CanvaPP_Banner_Outdoor`, `CanvaPP_Sign_AframeEx_DualSide` (also `CanvaPP_Banner`, `CanvaPP_Decal_Permanent`). Each
  matrix row's `itemInfo` lists the product price, then any add-on (stake holder, A-frame holder).
- Sticker Mule: `POST /core/api/products/prices` with productId `rigid-yard-signs` or `317` (die cut).
- BannerBuzz: `/staticJsonData/pdpSizeApi/ca/BBVBCB00.json` (sizes and quantity discount tiers).
