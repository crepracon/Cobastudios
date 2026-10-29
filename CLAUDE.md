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

## Beta pages (separate from the live app)
- `beta/index.html` — **Sticker Quick Quote (beta 1, Oct 2026)**, live at https://crepracon.github.io/Cobastudios/beta/. Prices die-cut stickers from competitor price ladders captured 2026-10-29 and embedded as JSON in `<script type="application/json" id="market-data">`. Like for like: each product carries a `lam` tag; with a laminate chosen the quote compares only with laminated products (StickerYou die-cut, Sticker Mule die-cut), with Laminate = None only with unlaminated ones (Sticker Mule Economy, VistaPrint gloss-coated plastic). Never mix the two groups in one comparison. Quote = market middle (or low/high/one seller) × adjust %, rounded, with a material-cost check that uses the same sticker math as the Vinyl/Roland tab.
- Beta work never edits `index.html`. Same origin means shared localStorage: the beta writes only `coba-beta-sticker-v1` and READS `coba-inventory-v2` for material costs — it must never write it.
- Refreshing market data = replace the JSON block only. Pull prices quarterly through a real browser (each site's own price calculator); plain web fetch can't see configurator prices. A copy of the data is in the claude.ai project as `claude/sticker-market-grid-2026-10-29.json`.
- Merge into the main app as a tab only after Chris approves; tag that release.

## Hard rules
1. **Validate every change:** extract the `<script>` contents and run `node --check` before committing. A jsdom smoke test exists as a pattern (save/load/search cycle) — extend it when touching the Jobs module. For cloud sync, test with a fake Firestore shared between two jsdom windows (merge, status/notes/delete propagation, offline save pushed on reconnect).
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
- Market-anchored quoting: sticker beta at `/beta/` (Oct 2026). Next: Chris trials it next to the estimator, then decide on merging; extend the same approach to other products (Posterjack, Staples, more VistaPrint)

Current version: **v27** (Jobs cloud sync via Firebase: shared live jobs list across computers, survives app updates)
