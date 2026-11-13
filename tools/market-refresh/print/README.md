# VistaPrint print products: calendars, coasters, brochures, postcards, flyers, rack cards, note cards — runbook

Price ladders behind the estimator's VistaPrint comparisons:
- **UV Printing > Coasters (v34).** New coaster quotes are priced from VistaPrint ceramic coasters (like for like: Coba makes ceramic tiles). Since v36 each coaster row keeps the VistaPrint price it was quoted at, so a refresh never changes a saved quote. Changing a row's quantity re-prices it.
- **Paper tab > Calendar / Brochure references (v35).** Reference only. They never change the quote and always show the latest captured prices.
- **Paper tab > Postcards, flyers, cards & posters (v46).** Reference only, like the calendar / brochure boxes. VistaPrint first, Staples Canada second, for the same product, size, paper and sides.

The same data file holds two groups this refresh does not touch. Each has a `refresh` field, and `build-print.js` skips them:
- `refresh: "art"`: VistaPrint posters (`vp-poster-*`), copied from the Oct 30 2026 art capture (`../art/data/art-market-2026-10-30.json`).
- `refresh: "manual"`: Staples Canada paper products (`stp-*`), read by hand on Nov 13 2026 (see "Staples Canada, by hand" below).

A scheduled Claude task refreshes the rest every 4 months (March, July, November), alongside the sticker prices (`../README.md`). It uses the Claude desktop app's built-in browser on Chris's computer, because plain web fetch can't see these prices. Anyone can follow the steps by hand too.

## Files
| File | What it does |
|---|---|
| `collect-vistaprint-print.js` | Run in a built-in browser tab open on one of the product pages below. It clicks each option (size, paper, flat / folded) the way a customer would and reads the price shown for every quantity. It never logs in, uses the cart or makes requests of its own. It stops after about 35 s with `done: false`; run it again in the same tab, without reloading, and it carries on. |
| `build-print.js` | Turns the saved page results into a new dated data file `data/vistaprint-print-YYYY-MM-DD.json` and a report `../reports/print-YYYY-MM-DD.md`. Suspicious changes are held (see Safety rules). |
| `apply-print.js` | Writes the newest data file into `index.html` as `<script type="application/json" id="market-print">`, right after the sticker block. It never touches `id="market-data"`. Never hand-edit the block or the prices. |
| `seed-paper.js` | One-time (Nov 13 2026): added the v46 products to the grid. It reads `raw/2026-11-13/` (the collector's results for the four paper pages, packed as `q` = quantities and `items` = [options, prices in `q` order], plus `staples-paper.json`) and the art capture's VistaPrint posters, and writes `data/vistaprint-print-2026-11-13.json`. Running it again rebuilds that same file; once a regular refresh has written a newer data file it does nothing. |
| `raw/2026-11-13/` | The inputs `seed-paper.js` was built from, kept so the seed can be checked or rebuilt. |
| `data/` | The captured grids. Each `sellers[]` entry has `sizes[].ladder` rows of `[qty, price]`, or `[qty, list, sale]` when a sale price was showing. Paper product sizes are labelled smaller side first (`4 x 6`), with `w` = the long side. A copy of the current grid is in the claude.ai project as `claude/print-market-grid-2026-11-13.json` (the Nov 2 grid: `claude/calendar-coaster-brochure-market-grid-2026-11-02.json`). |

## Product pages (16)
| Page | What the collector picks |
|---|---|
| https://www.vistaprint.ca/photo-gifts/calendars/wall-calendars | 5 sizes: A5, A4, A3, Double A4, Large Wall Calendar |
| https://www.vistaprint.ca/photo-gifts/calendars/desk-calendars | 2 sizes: rectangular, 20x20 |
| https://www.vistaprint.ca/photo-gifts/calendars/poster-calendars | one price list |
| https://www.vistaprint.ca/marketing-materials/magnets/magnetic-calendars | one price list |
| https://www.vistaprint.ca/marketing-materials/bookmark-calendars | one price list |
| https://www.vistaprint.ca/marketing-materials/mouse-pad-calendars | 3 mm |
| https://www.vistaprint.ca/photo-gifts/paper-coasters | one price list (reference only) |
| https://www.vistaprint.ca/photo-gifts/photo-coasters | one price list (reference only) |
| https://www.vistaprint.ca/photo-gifts/custom-ceramic-coasters | one price list: **sets new coaster quotes** |
| https://www.vistaprint.ca/marketing-materials/brochures/tri-fold | 3 sizes x 4 papers |
| https://www.vistaprint.ca/marketing-materials/brochures/bi-fold | 3 sizes x 4 papers |
| https://www.vistaprint.ca/marketing-materials/brochures/z-fold | 4 papers (one size) |
| https://www.vistaprint.ca/marketing-materials/standard-postcards | 8 sizes (4x4 to 6x11) x 4 papers: Glossy (front only), Matte, Uncoated, Recycled |
| https://www.vistaprint.ca/marketing-materials/flyers | 11 sizes (2.5x4 to 11x17) x 4 papers: Glossy, Matte, Uncoated, Recycled |
| https://www.vistaprint.ca/marketing-materials/rack-cards | one size (3.74 x 8.27) x 4 papers: Glossy Front Only, Matte, Uncoated, Recycled Matte |
| https://www.vistaprint.ca/stationery/note-cards | 5.5x4 and 5x7, Flat or Folded (Folded is only sold at 5.5x4) |

## Steps (Claude, scheduled run)
1. **Already done this cycle?** Read `"captured"` at the start of the `market-print` JSON in `index.html`. If it is less than 60 days old, skip the print refresh.
2. **Collect.** For each page: open it in the built-in browser (`preview_start` for the first page, then `navigate` in the same tab) and wait about 3 s. Then run the full text of `collect-vistaprint-print.js` with `javascript_tool`. It returns a JSON string. If `done` is false, run the same text again in the same tab until it is true. The postcard and flyer pages have the most options (32 and 44), so they take a few runs each.
   - Save each result as `/tmp/market-refresh/print/<page>.json`, where `<page>` is the last part of the URL (for example `tri-fold.json`).
   - Never log in, never add to cart or order, and never enter personal or payment details.
   - Stop if VistaPrint shows a bot check or CAPTCHA.
   - Close the tab afterwards.
3. **Build.** Run `node tools/market-refresh/print/build-print.js --in /tmp/market-refresh/print --dry-run` and read the report. Then run the same command without `--dry-run`.
4. **Apply.** `node tools/market-refresh/print/apply-print.js`.
5. **Validate.** All of these must pass:
   - jsdom setup, once: `npm install jsdom --prefix /tmp/jsdom`
   - `NODE_PATH=/tmp/jsdom/node_modules node tools/smoke-uv-paper.js` (expected prices are worked out from the data, so it passes after a refresh)
   - `NODE_PATH=/tmp/jsdom/node_modules node tools/smoke-jobs.js`
   - `node tools/market-refresh/smoke-estimator.js`

   Then check `git status`: only `index.html` (the `market-print` line), the new data file and the new report may change. If anything fails, don't push. Run `git checkout -- .`, delete the new data file and report, and tell Chris what failed.
6. **Commit and push** to `main`, for example `market: print price refresh 2027-03-01`. There is no version tag for a data refresh.
7. **Tell Chris** in plain words:
   - which products changed, and roughly by how much;
   - anything held for him to check;
   - that saved coaster quotes keep their prices.

## Safety rules (build-print.js)
- A price that moved more than 30% keeps its old value and is listed.
- If more than 10% of a product's prices moved that much, the whole product keeps its old prices (a site change or a sale?).
- If every price dropped by about the same percentage (10% or more), the whole product keeps its old prices. This looks like a sale the page doesn't label as one.
- A size whose quantity list came back less than half as long as before keeps its old prices.
- A product or size that wasn't collected keeps its old prices.
- Sale prices VistaPrint labels as such are stored as `[qty, list, sale]`. Comparisons use the list price; the Paper references mention the sale price.
- Products with a `refresh` field (VistaPrint posters, Staples Canada) are left alone and listed in the report as not part of this refresh.
- Once Chris has checked a held product and it is a real price change, run the build again with `--accept <id>[,<id>]` (ids as listed in the report, e.g. `vp-coaster-ceramic`).

## When the collector breaks
VistaPrint product pages show every option (size, paper, quantity) as radio buttons in `role="radiogroup"` groups. The quantity buttons' labels hold the prices, e.g. "25 $40.29 $1.61 each", with "original price" when on sale. The collector clicks the options and reads those labels. Known behaviour as of Nov 2026:
- After a click, the quantity list disappears for about half a second while the page redraws. The collector waits for it to come back and never takes an empty list as the price (this was a real bug, on bi-fold 9x8 matte).
- Z-fold has one size (8.5 x 11 flat) and no size option.
- The standard / premium thickness choice for brochures only appears after design approval, so the prices are standard thickness.
- Postcards, flyers and rack cards: the product-page price is **Backside: Blank** (printed front only) at the page's default thickness (Standard for postcards and rack cards, Budget for flyers). A printed back and thicker stock are picked later in their designer, at prices the product page doesn't show.
- Postcards 6 x 11 are not sold in Recycled: the page keeps the previous size's prices. `seed-paper.js` left that size out; on a refresh the build reports it as "no product matches" and ignores it.
- Note cards: picking Folded switches the size back to 5.5 x 4, so the "5 x 7 Folded" result is really the 5.5 x 4 folded price. The build ignores it (reported as "no product matches"). The quantity 1 row is a one-off sample card, not an order quantity, so the build drops it. Paper: Standard Matte 271 gsm (14pt) uncoated, white envelopes included.

If VistaPrint renames an option, update the `PAGES` table at the top of the collector (the option values) and the mapping at the top of `build-print.js` (`WALL`, `DESK`, `FOLD`, `PC_STOCK`, `FLY_STOCK`, `RACK_STOCK`).

## Staples Canada, by hand (not on the scheduled refresh yet)
Read on Nov 13 2026 in the built-in browser from shop.staplescopyandprint.ca: postcard (4x6, 5x7), rack-cards (3.5x8.5), flyers (8.5x11, 11x17), folded-cards (5x7), flat-card (5x7) and enclosure-card (4.25x5.5), 1- and 2-sided, standard stock only. Stored as `stp-<product>-<sides>` with `refresh: "manual"`.
- Postcards, rack cards and flyers are sold in packs. Each product page has a price table per pack size (`input[name="input-table"]` rows such as "50 $0.40 $19.99").
- Size and sides are Shopify variants. Clicking the tiles doesn't switch them; open `?variant=<id>` for each one instead (the variant ids are in the store's `/products.json` catalogue). Paper tiles do respond to clicks.
- Cards are one price per card at any quantity, stored as a one-row ladder `[[1, price]]` (or `[[1, list, sale]]`); the estimator shows them as "same price each at any quantity".
- Their premium stocks cost more and are not included. Their catalogue (`/products.json`) lists products and variants but not pack sizes or quantity prices.

To update them: copy the newest data file to a new date, change the `stp-*` ladders and their `captured` dates, run `apply-print.js` and the tests, and say in the commit which prices were read by hand.

## Captures
- **2026-11-02, morning:** captured by hand in the built-in browser, from the configurator quantity lists, each page's "Show pricing guide" and every brochure size and paper.
- **2026-11-02, afternoon:** first run of the collector on all 12 pages. No price changes; it added the larger and in-between quantities (brochures up to 20,000, desk calendars 11 to 15, mouse pad calendars up to 20,000, wall calendars 6 to 14).
- **2026-11-13:** first capture of postcards, flyers, rack cards and note cards (the collector, in the built-in browser) and Staples Canada's paper products (by hand); VistaPrint posters copied in from the Oct 30 art capture. Seeded with `seed-paper.js` (v46).

## Like-for-like notes
- **Coasters.** VistaPrint ceramic coasters have a cork back and come as 3.9" square or 4.1" round, at the same price. The minimum is 2 and they quote above 400. Coba's tile cost should include cork to compare fairly.
  - Photo coasters (1/8" gloss board) and paper coasters (56pt pulpboard, front only) are kept in the data for reference but not compared, since Coba doesn't make them.
- **Calendars.** Wall calendar paper (standard matte or premium glossy) is picked in VistaPrint's editor at add-to-cart, so the premium upcharge isn't captured. The same applies to desk calendar glossy and the 0.6 mm premium magnet. Online maximums: wall and desk 500, poster 200.
  - A sale was running at the Nov 2026 capture (wall calendars, code FAVES25, ending Nov 8), so those rows are `[qty, list, sale]`. Comparisons use the list price.
- **Brochures.** Prices are the product-page configuration, taken as standard thickness (see above). Stocks: glossy 5pt / 9pt, matte 5pt / 9.5pt, uncoated 5.5pt / 11pt, recycled 6pt only.
  - Quirks kept as captured: the 8.5x14 recycled tri-fold is cheaper at 1,000 than at 750, and the 11x17 uncoated bi-fold is about double the matte price.
- **Postcards, flyers, cards & posters (v46).** Never mix stocks: postcards, rack cards and note cards are card stock; flyers are paper (VistaPrint's Budget thickness); posters are poster stock (premium matte 14pt, semi-gloss 9.3pt, premium glossy 8pt). VistaPrint's prices print the front only, so a 2-sided job is compared with Staples, and the box says so.
  - Two sizes count as the same when their area and their shape are both within 10%: VistaPrint's 3.74 x 8.27 rack card = Staples 3.5 x 8.5; VistaPrint's 4 x 5.5 note card = Staples' 4.25 x 5.5 enclosure card. The box labels these "closest size".
  - Staples-only sizes (folded 5x7 greeting cards) are in the size list, marked "Staples only".
- **Between quantities.** VistaPrint only sells its listed quantities. The estimator's VistaPrint price for q pieces is the cheapest way to get at least q: q at the unit price of the break at or below q, or the next break's total if that costs less (10 brochures = their 25 for $40.29). Staples packs work the same way.
