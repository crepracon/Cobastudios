# Coba Studios Estimator

Self-contained offline pricing calculator for Coba Studios (Brockville, ON). Single HTML file, no build step, no dependencies. All prices CAD with 13% HST.

**Live app:** https://crepracon.github.io/Cobastudios/ (once Pages is enabled)

## Tabs
Paper Estimator · DTF Heat Transfer · Vinyl/Roland · Epson · Inventory

## How updates work
1. Changes are made to `index.html` (with Claude, via targeted edits + Node syntax validation)
2. Commit and push to `main`
3. GitHub Pages redeploys automatically — the live URL always serves the latest version
4. Milestone versions are tagged (`v20`, `v21`, ...)

## Notes
- Inventory and settings persist per-device in browser localStorage (`coba-inventory-v2`)
- To use offline: save the page from the browser, or download `index.html` from this repo
- Version history lives in Git — old versions recoverable via tags/commits

Currently at: **v20** (v21–v22 changes pending re-import)
