# Art prints & plans market data (Epson tab, Oct 2026)

Competitor prices for wide-format art prints, posters and plan (bond) prints in Canada, collected from inside a real
browser tab on each site, like the sticker and sign data. Used for comparing the Epson tab's Art Reproduction and
Construction Plans pricing. Not wired into the estimator yet.

## Like-for-like paper groups (Chris, Oct 30 2026)
Coba prints art on **Epson Enhanced Matte** (192 gsm, ~10 mil) and plans on **20 lb bond**. Compare only within a group:
| Group | Coba media | Sellers |
|---|---|---|
| `em` matte inkjet art paper | Enhanced Matte | Monk Office (BC) posters on Enhanced Matte; Newfoundland Canvas giclee on Luxe Fine Art Matte 230 gsm |
| `rag` cotton rag fine art (premium) | none (above Coba's paper) | Posterjack Fine-Art (Hahnemuehle Photo Rag 308 gsm); Newfoundland Canvas Luxe Cotton Rag 310 gsm |
| `photo` satin / luster / gloss photo paper | Luster, Glossy | Posterjack Satin and Glossy; Staples photo enlargements (Fujifilm Crystal Archive); Newfoundland Canvas Glacier satin; Monk semi-gloss |
| `poster` economy poster paper (not giclee) | none | Staples posters matte/gloss; VistaPrint posters (Premium Matte 14 pt, Semi-Gloss 9.3 pt, Premium Glossy 8 pt) |
| `bond` plans / CAD | Bond 20 lb | Staples engineering prints 20 lb (B&W, colour; 1-hour, same-day, 2-4 day); Monk CAD 24 lb |

VistaPrint has no fine art paper; its posters are digitally printed poster stock. Posterjack's Fine-Art is cotton rag, a
premium paper, so it is a ceiling for Enhanced Matte, not a match. Posterjack often runs site-wide coupon codes (30% off
on capture day); stored prices are regular prices.

## Files
| File | Run on | What it reads |
|---|---|---|
| `collect-posterjack-art.js` | posterjack.ca/products/fine-art-prints | Fine-Art, Satin, Glossy (Shopify product JSON), every size |
| `collect-vistaprint-posters.js` | vistaprint.ca/signs-posters/posters | Premium Matte, Semi-Gloss, Premium Glossy; 8 sizes; qty 1-100 (quantityPriceBreaks) |
| `collect-staples-art.js` | shop.staplescopyandprint.ca/pages/engineering-prints | Posters matte/gloss (CanvaPP_Poster), photo enlargements, engineering print table (live page text) |
| `collect-monk-nlcanvas.js` | monk.ca/large-format/ AND newfoundlandcanvas.com/wideformat (run once on each) | Fixed price lists on the page |
| `collect-result.js` | same tab | Fetches a background collector's result |
| `build-data.js` | - | Verifies checksums, tags each seller with its paper group, writes `data/art-market-<date>.json` |

Run each collector with `javascript_tool`, then `collect-result.js` until it returns JSON (VistaPrint ~40 s; the others
return at once when awaited). Save each result, then:
`node tools/market-refresh/art/build-data.js --in <folder> --out tools/market-refresh/art/data/art-market-<date>.json --date <date>`
No automatic hold on big jumps yet; compare with the previous data file by hand.

## Request details (Oct 2026)
- Posterjack: `/products/<handle>.js` (fine-art-prints, satin-matte-poster-prints, glossy-poster-prints), variant title "W x H inches".
- VistaPrint posters: productKey `PRD-HSKBMXYA` v46, selections `Size` (`24" X 36"`), `Substrates`, `Product Orientation`. Rush does not change price.
- Staples: `www.staplescopyandprint.ca/PrintProductApps/CaPPPrintProducts/CanvaOptions?subProduct=CanvaPP_Poster`
  (paper M/G, finition NA); `/products/photo-poster.js`; engineering table is drawn by the page script, so the collector
  reads the live page. Order fees: $2.99 (1-hour, same-day) or $1.99 (2-4 day).
- Monk Office and Newfoundland Canvas: plain text/tables on the page.

## Art & Plans Quick Quote beta (Oct 30 2026)
`beta/art/index.html`, live at https://crepracon.github.io/Cobastudios/beta/art/. Built from `beta-template.html` by
`build-beta.js` (never hand-edit the built file): `node tools/market-refresh/art/build-beta.js`. Two tabs, like the
Epson tab: **Art reproduction** (paper Enhanced Matte / Luster / Glossy, ink colour / B&W) and **Construction plans**
(bond, ink B&W / colour, compared with Staples at the turnaround picked; Monk always). Quote = market middle (or
low / high) x adjust %, rounded; minimum is per order (default $25 for art), not per print. When no like-for-like
seller lists the size (e.g. 5 x 7 on matte), it uses your $ / sq ft rate without the per-print minimum, or (setting)
the reference market + premium. Cotton rag (above) and poster stock (below) are reference only. Material cost uses
the Epson tab's math (gang-run across the 36" roll, 1" margin). Writes only `coba-beta-art-v1`; reads
`coba-inventory-v2` (Epson papers) and never writes it. Test: `node tools/market-refresh/art/smoke-art-beta.js`.
