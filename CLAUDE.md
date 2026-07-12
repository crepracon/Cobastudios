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
  - `coba-jobs-v1` — customers + saved estimates (full snapshots: panel innerHTML + field values + JS row-state vars). Same rule: migrate, never break.
- **Dynamic rows:** DTF/Vinyl/Epson tabs build rows in JS with module-level `let` arrays and id counters (e.g. `dGarmentRows`, `gId`). The Jobs snapshot system (`SNAP_STATE`) saves/restores these — if you add a new dynamic-row feature, register it there or snapshots will silently corrupt.
- **Calc pattern:** inline `oninput="xCalc()"` handlers per tab (`pCalc`, `dCalc`, `rCalc`, `eCalc`). Logic should stay in these functions, separate from display.

## Hard rules
1. **Validate every change:** extract the `<script>` contents and run `node --check` before committing. A jsdom smoke test exists as a pattern (save/load/search cycle) — extend it when touching the Jobs module.
2. **Known landmines (both have caused real bugs):**
   - No special characters (multiplication sign, middle dot, curly quotes) inside JS **string literals** — plain ASCII only. HTML entities in markup strings are fine.
   - When inserting code near constant declarations (e.g. `const PM=3, TM=5;`), verify they survive the edit. This has been dropped twice.
3. **No new dependencies.** The file must stay self-contained and offline-capable. If something truly can't be done in plain HTML/CSS/JS, explain the trade-off first.
4. **Small steps, verified.** One change at a time. Multi-section changes: state the plan first.
5. **Git:** commit at every working state with a short message. Tag milestones (`v23`, `v24`, ...). Never edit the only working copy. No secrets in the repo — the file is client-side and publicly hosted.
6. **Pricing integrity:** saved estimates deliberately reopen with the rates in effect when quoted. Don't "fix" that. Validated real-world costs (from invoices/job logs) beat assumed defaults — flag before changing any calibrated number.
7. **Flag regressions and drift.** If a request contradicts an earlier decision or these rules, say so before doing it.

## End-of-session ritual
Run validation → commit and push → tag if milestone → recap what changed in 1–2 lines. Remind Chris of this.

## Roadmap
- Inventory export/import between devices (localStorage is per-device)
- VersaWorks CSV import — back-calculate real Roland ink cost/sqft and waste from job logs
- QuickBooks Online integration (needs OAuth + small backend — this is the phase where the single-file constraint gets revisited, deliberately)

Current version: **v23** (Jobs tab added — per-customer estimate database with snapshots, statuses, search, JSON backup)
