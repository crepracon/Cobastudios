# Sticker market refresh — runbook

How the competitor prices inside the Sticker Quick Quote beta (`beta/index.html`) get refreshed.
A scheduled Claude task runs this every 4 months (March, July, November). Anyone can follow it by hand too.

**Why a real browser:** StickerYou, Sticker Mule and VistaPrint only show prices through their own price
calculators, and StickerYou blocks plain web requests. So the prices are pulled from inside a real browser tab
on each site, using the same price requests the pages make when a customer picks a size. Keep the pace polite
(the collectors wait 1.2 s between requests), never log in, never order, and stop if a site shows a bot check.

## Files
| File | What it does |
|---|---|
| `collect-stickeryou.js` | Run in a tab on the StickerYou die-cut page. Laminated die-cut, 16 sizes, 1–20,000 pcs. |
| `collect-stickermule.js` | Run in a tab on Sticker Mule (CA). Standard die cut (laminated) + Economy (not laminated). |
| `collect-vistaprint.js` | Run in a tab on VistaPrint (CA) die-cut sticker singles. White Plastic, gloss-coated, not laminated. List + sale price. |
| `apply.js` | Compares collected prices with the beta's current data, applies the safe changes, writes a report. |
| `smoke-beta.js` | Checks the beta after the update (scripts compile and are ASCII, both laminate modes work). |
| `reports/` | One change report per refresh (`YYYY-MM-DD.md`). |

## Steps (Claude, scheduled run)
1. **Already done this cycle?** Read the `"captured"` date at the top of the `market-data` JSON in `beta/index.html`.
   If it is less than 60 days old, stop — nothing to do (no message needed).
2. **Is Chris's computer reachable?** The collectors need the Claude desktop app's built-in browser on his computer
   (`Claude_Browser` tools). If those tools are missing or can't reach the computer, stop and tell Chris in one line:
   "Couldn't reach your computer for the sticker price refresh; I'll try again next Monday."
3. **Collect.** For each collector, open its page with `preview_start`, wait ~3 s for prices to load, then run the
   collector file's full text with `javascript_tool` (it returns a JSON string). Save each result to
   `/tmp/market-refresh/<collector>.json`. If the browser asks for site access, request it for that site.
   - StickerYou: https://www.stickeryou.com/en-ca/products/die-cut-stickers/623
   - Sticker Mule: https://www.stickermule.com/ca/products/die-cut-stickers
   - VistaPrint: https://www.vistaprint.ca/labels-stickers/die-cut-sticker-singles
   Close the tabs afterwards.
4. **Apply.** `node tools/market-refresh/apply.js --in /tmp/market-refresh` (add `--dry-run` to preview).
   Safety rules built in: a price that moved more than 30% is held at its old value and listed; if more than 10% of a
   seller's prices moved that much, or prices are missing, that whole seller is held (likely a site change or a sale).
   Lamination labels are never touched by the script.
5. **Validate.** `node tools/market-refresh/smoke-beta.js` must pass. Never edit `index.html` (the live estimator).
6. **Commit and push** `beta/index.html` and the new report to `main` with a short message, e.g.
   `beta: sticker market refresh 2027-03-01`. GitHub Pages updates the live beta within a couple of minutes.
7. **Tell Chris** the report's summary in plain words: which sellers changed and by roughly how much, anything held
   for him to check, and the beta link https://crepracon.github.io/Cobastudios/beta/.

## When a collector breaks
Sites change. If a collector returns errors for every size, look at what the page itself requests when you change the
size (network requests), update the collector, and note the change here. Known request details as of Oct 2026:
- StickerYou: `POST /pm/ProductPrice` with `{productId: 38, width, height, currencyCode: 'CAD', accessoryDetails: []}`.
- Sticker Mule: `POST /core/api/products/prices` with `{currency: 'CAD', locale: 'ca', productId: '317' | 'economy-stickers', size: {width, height}, quantities, discount: null}`; sizes in inches.
- VistaPrint: `GET website-pricing-service.prices.cimpress.io/v4/prices/estimated/quantityPriceBreaks` with
  `productKey=PRD-XSJUFCTDY`, `productVersion` (21 in Oct 2026; the collector reads the current one from the page),
  `selections[Material]=White Plastic`, `selections[Size]=3"x3"`.

## Lamination labels (checked Oct 29, 2026)
- StickerYou die-cut: laminated (their die-cut page says the stickers have a clear lamination).
- Sticker Mule die cut (standard): laminated (their FAQ: vinyl with a protective laminate).
- Sticker Mule Economy: not laminated (their FAQ says so).
- VistaPrint die-cut singles, White Plastic: not laminated — "coated for durability", product options show Finish: Gloss and no laminate.
Re-check these if a site's wording changes; the beta never compares laminated with unlaminated prices.
