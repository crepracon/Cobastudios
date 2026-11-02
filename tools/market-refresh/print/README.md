# VistaPrint print products: calendars, coasters, brochures

Price ladders for the estimator's VistaPrint references:
- **UV Printing > Coasters (v34).** Compared only with VistaPrint ceramic coasters, because Coba makes ceramic tiles.
- **Paper tab > Calendar / Brochure references (v35).** Reference only; they never change the quote.

## Files
- `data/vistaprint-print-YYYY-MM-DD.json` is the captured grid. It uses the same format as the sign and art grids: `sellers[]`, each with `sizes[].ladder` rows of `[qty, price]` or `[qty, list, sale]`. A copy is in the claude.ai project as `claude/calendar-coaster-brochure-market-grid-2026-11-02.json`.
- `apply-print.js` checks the newest data file. It then writes it into `index.html` as `<script type="application/json" id="market-print">`, right after the sticker block. It never touches `id="market-data"`. Never hand-edit the block.

## How the Nov 2 2026 capture was made
The prices came from vistaprint.ca product pages in the desktop app's built-in browser:
- the configurator quantity lists;
- each page's "Show pricing guide";
- the brochure option radios, clicked through every size and paper.

Plain web fetch can't see these prices. No collector script exists yet. To refresh, repeat the capture and save a new dated data file in the same format, then run `apply-print.js` and both smoke tests:
```
node tools/market-refresh/print/apply-print.js
NODE_PATH=<jsdom> node tools/smoke-uv-paper.js
NODE_PATH=<jsdom> node tools/smoke-jobs.js
```

## Like-for-like notes
- **Coasters.** VistaPrint ceramic coasters have a cork back and come as 3.9" square or 4.1" round, at the same price; the minimum is 2 and they quote above 400. Coba's tile cost should include cork to compare fairly.
  - Photo coasters (1/8" gloss board) and paper coasters (56pt pulpboard, front only) are kept in the data for reference but not compared, since Coba doesn't make them.
- **Calendars.** Wall calendar paper (standard matte or premium glossy) is picked in VistaPrint's editor at add-to-cart, so the premium upcharge wasn't captured. The same applies to desk calendar glossy and the 0.6 mm premium magnet. Online maximums: wall and desk 500, poster 200.
  - A sale was running at capture: wall calendar rows are `[qty, list, sale]`. Comparisons use the list price.
- **Brochures.** Prices are the product-page configuration. The standard/premium thickness choice isn't on the product page; it appears after design approval, so these are taken as standard. Stocks: glossy 5pt / 9pt, matte 5pt / 9.5pt, uncoated 5.5pt / 11pt, recycled 6pt only.
  - Quirks kept as captured: the 8.5x14 recycled tri-fold is cheaper at 1,000 than at 750, and the 11x17 uncoated bi-fold is about double the matte price.
- **Between tiers.** VistaPrint only sells its tier quantities. The fair unit price is the tier at or below the quantity; below the first tier, the first tier is used.
