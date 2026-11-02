# VistaPrint print products: calendars, coasters, brochures — runbook

Price ladders behind the estimator's VistaPrint comparisons:
- **UV Printing > Coasters (v34).** New coaster quotes are priced from VistaPrint ceramic coasters (like for like: Coba makes ceramic tiles). Since v36 each coaster row keeps the VistaPrint price it was quoted at, so a refresh never changes a saved quote. Changing a row's quantity re-prices it.
- **Paper tab > Calendar / Brochure references (v35).** Reference only. They never change the quote and always show the latest captured prices.

A scheduled Claude task refreshes these every 4 months (March, July, November), alongside the sticker prices (`../README.md`). It uses the Claude desktop app's built-in browser on Chris's computer, because plain web fetch can't see these prices. Anyone can follow the steps by hand too.

## Files
| File | What it does |
|---|---|
| `collect-vistaprint-print.js` | Run in a built-in browser tab open on one of the product pages below. It clicks each option (size, paper) the way a customer would and reads the price shown for every quantity. It never logs in, uses the cart or makes requests of its own. It stops after about 35 s with `done: false`; run it again in the same tab, without reloading, and it carries on. |
| `build-print.js` | Turns the saved page results into a new dated data file `data/vistaprint-print-YYYY-MM-DD.json` and a report `../reports/print-YYYY-MM-DD.md`. Suspicious changes are held (see Safety rules). |
| `apply-print.js` | Writes the newest data file into `index.html` as `<script type="application/json" id="market-print">`, right after the sticker block. It never touches `id="market-data"`. Never hand-edit the block or the prices. |
| `data/` | The captured grids. Each `sellers[]` entry has `sizes[].ladder` rows of `[qty, price]`, or `[qty, list, sale]` when VistaPrint showed a sale price. A copy of the current grid is in the claude.ai project as `claude/calendar-coaster-brochure-market-grid-2026-11-02.json`. |

## Product pages (12)
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

## Steps (Claude, scheduled run)
1. **Already done this cycle?** Read `"captured"` at the start of the `market-print` JSON in `index.html`. If it is less than 60 days old, skip the print refresh.
2. **Collect.** For each page: open it in the built-in browser (`preview_start` for the first page, then `navigate` in the same tab) and wait about 3 s. Then run the full text of `collect-vistaprint-print.js` with `javascript_tool`. It returns a JSON string. If `done` is false, run the same text again in the same tab until it is true.
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
- Once Chris has checked a held product and it is a real price change, run the build again with `--accept <id>[,<id>]` (ids as listed in the report, e.g. `vp-coaster-ceramic`).

## When the collector breaks
VistaPrint product pages show every option (size, paper, quantity) as radio buttons in `role="radiogroup"` groups. The quantity buttons' labels hold the prices, e.g. "25 $40.29 $1.61 each", with "original price" when on sale. The collector clicks the options and reads those labels. Known behaviour as of Nov 2026:
- After a click, the quantity list disappears for about half a second while the page redraws. The collector waits for it to come back and never takes an empty list as the price (this was a real bug, on bi-fold 9x8 matte).
- Z-fold has one size (8.5 x 11 flat) and no size option.
- The standard / premium thickness choice for brochures only appears after design approval, so the prices are standard thickness.

If VistaPrint renames an option, update the `PAGES` table at the top of the collector (the option values) and the mapping at the top of `build-print.js` (`WALL`, `DESK`, `FOLD`).

## Captures
- **2026-11-02, morning:** captured by hand in the built-in browser, from the configurator quantity lists, each page's "Show pricing guide" and every brochure size and paper.
- **2026-11-02, afternoon:** first run of the collector on all 12 pages. No price changes; it added the larger and in-between quantities (brochures up to 20,000, desk calendars 11 to 15, mouse pad calendars up to 20,000, wall calendars 6 to 14).

## Like-for-like notes
- **Coasters.** VistaPrint ceramic coasters have a cork back and come as 3.9" square or 4.1" round, at the same price. The minimum is 2 and they quote above 400. Coba's tile cost should include cork to compare fairly.
  - Photo coasters (1/8" gloss board) and paper coasters (56pt pulpboard, front only) are kept in the data for reference but not compared, since Coba doesn't make them.
- **Calendars.** Wall calendar paper (standard matte or premium glossy) is picked in VistaPrint's editor at add-to-cart, so the premium upcharge isn't captured. The same applies to desk calendar glossy and the 0.6 mm premium magnet. Online maximums: wall and desk 500, poster 200.
  - A sale was running at the Nov 2026 capture (wall calendars, code FAVES25, ending Nov 8), so those rows are `[qty, list, sale]`. Comparisons use the list price.
- **Brochures.** Prices are the product-page configuration, taken as standard thickness (see above). Stocks: glossy 5pt / 9pt, matte 5pt / 9.5pt, uncoated 5.5pt / 11pt, recycled 6pt only.
  - Quirks kept as captured: the 8.5x14 recycled tri-fold is cheaper at 1,000 than at 750, and the 11x17 uncoated bi-fold is about double the matte price.
- **Between quantities.** VistaPrint only sells its listed quantities. The estimator's VistaPrint price for q pieces is the cheapest way to get at least q: q at the unit price of the break at or below q, or the next break's total if that costs less (10 brochures = their 25 for $40.29).
