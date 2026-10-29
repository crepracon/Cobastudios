# CLAUDE.md — Coba Studios Estimator

Guidance for Claude Code (and any AI tooling) working in this repo.

## What this is
A pricing calculator + job/customer database for Coba Studios, a print shop in Brockville, Ontario. **One self-contained file: `index.html`** — embedded CSS and JS, no build step, no dependencies beyond CDN fonts. All prices CAD with 13% HST. Deployed via GitHub Pages: every push to `main` updates the live app at https://crepracon.github.io/Cobastudios/

## The owner / how to work with him
Chris is a hobbyist developer learning as he builds. Pragmatic and iterative: get it working first, polish later. Give structured options, not open-ended questions. Briefly explain new concepts when they first appear — he wants to understand his own codebase. When a bug is fixed, give the one-paragraph version of what actually went wrong.

## Architecture
- **Tabs:** Paper Estimator, DTF Heat Transfer, Vinyl/Roland, Epson, Jobs, Inventory
- **localStorage keys:**
  - `coba-inventory-v2` — materials inventory (vinyl, substrates, paper). Has migration logic; any schema change MUST migrate, never break saved data.
  - `coba-jobs-v1` — customers + saved estimates (full snapshots: panel innerHTML + field values + JS row-state vars). Same rule: migrate, never break. With cloud sync on, this becomes a local cache of the cloud list.
  - `coba-fb-config-v1`, `coba-jobs-cloud-joined-v1`, `coba-jobs-cloud-lastsync-v1` — cloud sync config and per-device sync state.
- **Cloud sync (v27, optional):** Firebase Firestore + email/password Auth, SDK loaded by dynamic `import()` from gstatic. The project config (`coba-studios-estimator`) is built in as `FB_CONFIG_BUILTIN`, so each device only signs in; if Firebase can't load (offline), the Jobs tab falls back to the local copy. Collections: `customers/{id}` and `estimates/{id}` (`cid` links to customer); the full object is stored as a JSON string in a `json` field (avoids Firestore's nested-array limits), with `name`/`title`/`status`/`date` copied out for readability in the console. `jobsSave()` → `cloudPush()` diffs `jobsData` against `cloudSent` and writes only changed docs; `onSnapshot` listeners rebuild `jobsData` via `cloudBuild()`. Mutations must keep going through `jobsSave()`, and confirm-dialog callbacks must re-find objects by id (the list may be rebuilt while a dialog is open). Access is limited by Firestore rules (email allowlist) — the web config itself is not a secret.
- **Dynamic rows:** DTF/Vinyl/Epson tabs build rows in JS with module-level `let` arrays and id counters (e.g. `dGarmentRows`, `gId`). The Jobs snapshot system (`SNAP_STATE`) saves/restores these — if you add a new dynamic-row feature, register it there or snapshots will silently corrupt.
- **Calc pattern:** inline `oninput="xCalc()"` handlers per tab (`pCalc`, `dCalc`, `rCalc`, `eCalc`). Logic should stay in these functions, separate from display.
- **Sticker market pricing (v28, Vinyl / Roland > Stickers):** `Pricing:` select `r-stk-mode` = `market` (default) or `classic` (the old markup tiers). Market mode quotes each sticker row from competitor price ladders in `<script type="application/json" id="market-data">` (just above the main script), like for like on lamination: laminate ticked compares only laminated products (StickerYou, Sticker Mule die cut), unticked only unlaminated ones (Sticker Mule Economy, VistaPrint). Engine is `const MKT` plus the `rStk*` helpers right before `rCalc()`. Settings in the Roland settings panel: `r-stk-at` (market middle/low/high/one seller), `r-stk-pct`, `r-stk-round`, `r-stk-min`, `r-stk-warn`. Sizes with no market data fall back to classic for that row. Market check box `r-stk-mkt` is `no-print`.
  - Pricing integrity: each sticker row has hidden `<id>-mb` (market price used) and `<id>-ms` (signature `w|h|q|lam|at`). If the signature is unchanged the stored price is reused, so a saved job reopens at its quoted market price even after a data refresh; editing the row re-prices it. Jobs saved before v28 have no `r-stk-mode` and reopen in the old classic layout; `resetRoland()` restores the v28 layout from `R_PANEL_PRISTINE`.
  - Never hand-edit the prices; the refresh tool (`tools/market-refresh/`) updates the JSON block in `index.html` and `beta/index.html` together.

## Beta pages (separate from the live app)
- `beta/index.html` — **Sticker Quick Quote (beta 1, Oct 2026; merged into the estimator as v28)**, live at https://crepracon.github.io/Cobastudios/beta/. Kept as a standalone quick-quote page; its market-data block must stay identical to the one in `index.html`. Prices die-cut stickers from competitor price ladders captured 2026-10-29 and embedded as JSON in `<script type="application/json" id="market-data">`. Like for like: each product carries a `lam` tag; with a laminate chosen the quote compares only with laminated products (StickerYou die-cut, Sticker Mule die-cut), with Laminate = None only with unlaminated ones (Sticker Mule Economy, VistaPrint gloss-coated plastic). Never mix the two groups in one comparison. Quote = market middle (or low/high/one seller) × adjust %, rounded, with a material-cost check that uses the same sticker math as the Vinyl/Roland tab.
- Beta work never edits `index.html` (the market refresh writing the shared market-data block is the one exception). Same origin means shared localStorage: the beta writes only `coba-beta-sticker-v1` and READS `coba-inventory-v2` for material costs — it must never write it.
- Refreshing market data = replace the JSON block only, via `tools/market-refresh/` (runbook in its README; `apply.js` holds big jumps, writes both files and a report; `smoke-estimator.js` + `smoke-beta.js` must pass). A scheduled Claude task runs it every 4 months (Mar/Jul/Nov) using the desktop app's built-in browser on Chris's computer; plain web fetch can't see configurator prices. A copy of the Oct 2026 data is in the claude.ai project as `claude/sticker-market-grid-2026-10-29.json`.
- Merge beta work into the main app only after Chris approves; tag that release (stickers: approved and merged as v28).

## Hard rules
1. **Validate every change:** extract the `<script>` contents and run `node --check` before committing. For anything touching stickers or market data also run `node tools/market-refresh/smoke-estimator.js`. A jsdom smoke test exists as a pattern (save/load/search cycle) — extend it when touching the Jobs module. For cloud sync, test with a fake Firestore shared between two jsdom windows (merge, status/notes/delete propagation, offline save pushed on reconnect).
2. **Known landmines (all three have caused real bugs):**
   - No special characters (multiplication sign, middle dot, curly quotes) inside JS **string literals** — plain ASCII only. HTML entities in markup strings are fine.
   - When inserting code near constant declarations (e.g. `const PM=3, TM=5;`), verify they survive the edit. This has been dropped twice.
   - Unicode escape sequences (backslash + u + four hex digits) inside JS strings get turned into the literal character by some write paths (the GitHub connector, file-writing tools), which breaks the ASCII rule above. Build symbols with `String.fromCharCode(...)` instead.
3. **No new dependencies.** The file must stay self-contained and offline-capable. (Deliberate exception: Firebase for Jobs cloud sync, loaded only when configured.) If something truly can't be done in plain HTML/CSS/JS, explain the trade-off first.
4. **Small steps, verified.** One change at a time. Multi-section changes: state the plan first.
5. **Git:** commit at every working state with a short message. Tag milestones (`v23`, `v24`, ...). Never edit the only working copy. No secrets in the repo — the file is client-side and publicly hosted.
6. **Pricing integrity:** saved estimates deliberately reopen with the rates in effect when quoted. Don't "fix" that. Validated real-world costs (from invoices/job logs) beat assumed defaults — flag before changing any calibrated number.
7. **Flag regressions and drift.** If a request contradicts an earlier decision or these rules, say so before doing it.

## End-of-session ritual
Run validation → commit and push → tag if milestone → recap what changed in 1–2 lines. Remind Chris of this.

## Roadmap
- Inventory sync between devices (could reuse the Firestore setup from Jobs cloud sync)
- VersaWorks CSV import — back-calculate real Roland ink cost/sqft and waste from job logs
- QuickBooks Online integration (needs OAuth + small backend — this is the phase where the single-file constraint gets revisited, deliberately)
- Market pricing strategy: defend/compete guidance in market-check bars (added v26); backed by a separate market pricing reference doc to be refreshed quarterly
- Market-anchored quoting: stickers live in v28 (Vinyl / Roland, Pricing: Market) with a scheduled refresh. Next: extend the same approach to other products (banners, posters/canvas via Posterjack, Staples, more VistaPrint), each as a beta first

Current version: **v28** (sticker market pricing in Vinyl / Roland: like-for-like competitor quotes with Classic switch; saved quotes kept through refreshes; fixed Roland settings button)
Previous: v27 (Jobs cloud sync via Firebase: shared live jobs list across computers, survives app updates)
