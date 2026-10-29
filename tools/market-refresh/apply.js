#!/usr/bin/env node
// Applies freshly collected competitor prices to the estimator (index.html, Vinyl / Roland stickers)
// and keeps the sticker beta (beta/index.html) in step. Both files carry the same market-data block.
//
//   node tools/market-refresh/apply.js --in <dir> [--date YYYY-MM-DD] [--dry-run]
//
// <dir> holds the JSON returned by the collectors (any file names, *.json). Each file looks like
// { collector, sellers: { <id>: { sizes: [{w,h,ladder}] } }, errors: [...] }.
//
// Safety rules (no silent price changes):
//  - A price point that moved more than 30% is held at its old value and listed in the report.
//  - If more than 10% of a seller's points moved more than 30%, or the shape changed (sizes or
//    quantities missing), the whole seller is held: likely a site change or a sale, check by hand.
//  - Lamination labels and product notes are never touched by this script.
// Writes the report to tools/market-refresh/reports/<date>.md and prints it. Plain ASCII only.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const arg = (name, dflt) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : dflt; };
const DRY = args.includes('--dry-run');
const IN_DIR = arg('--in');
const DATE = arg('--date', new Date().toISOString().slice(0, 10));
const ROOT = path.resolve(__dirname, '..', '..');
const TARGETS = [path.join(ROOT, 'index.html'), path.join(ROOT, 'beta', 'index.html')]; // first one is the reference copy
const BIG = 0.30, MAX_BIG_SHARE = 0.10;
if (!IN_DIR) { console.error('Usage: node tools/market-refresh/apply.js --in <dir> [--date YYYY-MM-DD] [--dry-run]'); process.exit(2); }

// ---- read current data from the estimator (index.html is the reference copy) ----
const OPEN = '<script type="application/json" id="market-data">', CLOSE = '</script>';
function readBlock(file) {
  const html = fs.readFileSync(file, 'utf8');
  const a = html.indexOf(OPEN); if (a < 0) throw new Error('market-data block not found in ' + path.relative(ROOT, file));
  const b = html.indexOf(CLOSE, a);
  return { html, a, b, json: html.slice(a + OPEN.length, b) };
}
const blocks = TARGETS.filter(f => fs.existsSync(f)).map(f => Object.assign({ file: f }, readBlock(f)));
const current = JSON.parse(blocks[0].json);
const outOfStep = blocks.slice(1).filter(x => JSON.stringify(JSON.parse(x.json)) !== JSON.stringify(current));

// ---- read collected data ----
const collected = {}, collectorErrors = [];
for (const f of fs.readdirSync(IN_DIR).filter(f => f.endsWith('.json'))) {
  let j = JSON.parse(fs.readFileSync(path.join(IN_DIR, f), 'utf8').trim());
  if (typeof j === 'string') j = JSON.parse(j); // tolerate a JSON string wrapped in quotes
  if (j.k) { // compact collector output: verify the checksum before trusting a single number
    const k = j.k; delete j.k;
    if (crc32(JSON.stringify(j)) !== k) { console.error('CHECKSUM MISMATCH in ' + f + ': the data was changed in transfer. Copy it again from the collector output.'); process.exit(3); }
  }
  (j.errors || []).forEach(e => collectorErrors.push((j.collector || f) + ': ' + e));
  for (const id of Object.keys(j.sellers || {})) {
    const s = j.sellers[id];
    if (s.rows) s.sizes = s.rows.map(r => ({ w: r[0], h: r[1], ladder: s.q.map((qq, i) => s.cols === 2 ? [qq, r[2][i], r[3][i]] : [qq, r[2][i]]).filter(row => row[1] != null) }));
    if ((s.sizes || []).length) collected[id] = s;
  }
}

function crc32(str) { let crc = -1; for (let n = 0; n < str.length; n++) { let c = (crc ^ str.charCodeAt(n)) & 255; for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
const key = (w, h) => Math.max(w, h) + 'x' + Math.min(w, h);
const money = v => '$' + Number(v).toFixed(2);
const report = [`# Sticker market refresh ${DATE}${DRY ? ' (dry run, nothing written)' : ''}`, ''];
let anyApplied = false;
const summary = [];

for (const seller of current.sellers) {
  const fresh = collected[seller.id];
  const lines = [];
  if (!fresh) { summary.push(`- **${seller.name}**: not collected, kept prices from ${seller.captured}`); continue; }
  const freshBySize = {}; fresh.sizes.forEach(z => { freshBySize[key(z.w, z.h)] = z; });
  let points = 0, missing = 0, changed = 0; const moves = [], held = [];
  const nextSizes = seller.sizes.map(z => {
    const nz = freshBySize[key(z.w, z.h)];
    const nextLadder = z.ladder.map(row => {
      points++;
      const nrow = nz && nz.ladder.find(r => r[0] === row[0]);
      if (!nrow || !(nrow[1] > 0)) { missing++; return row; }
      const ch = nrow[1] / row[1] - 1;
      if (Math.abs(ch) > BIG) { held.push({ z, q: row[0], from: row[1], to: nrow[1], ch }); return row; }
      if (Math.abs(nrow[1] - row[1]) >= 0.005 || (row.length > 2 && Math.abs((nrow[2] || 0) - (row[2] || 0)) >= 0.005)) {
        changed++; moves.push({ z, q: row[0], from: row[1], to: nrow[1], ch });
      }
      return row.length > 2 ? [row[0], nrow[1], nrow[2] != null ? nrow[2] : nrow[1]] : [row[0], nrow[1]];
    });
    return Object.assign({}, z, { ladder: nextLadder });
  });
  const shapeBroken = missing > points * MAX_BIG_SHARE;
  const tooManyBig = held.length > points * MAX_BIG_SHARE;
  if (shapeBroken || tooManyBig) {
    summary.push(`- **${seller.name}**: HELD, nothing changed. ${shapeBroken ? missing + ' of ' + points + ' prices missing (site layout changed?)' : held.length + ' of ' + points + ' prices moved more than 30% (site change or big sale?)'}. Check by hand.`);
    held.slice(0, 8).forEach(m => lines.push(`  - ${m.z.w}" x ${m.z.h}" x ${m.q}: ${money(m.from)} -> ${money(m.to)} (${(m.ch * 100).toFixed(0)}%)`));
    summary.push(...lines);
    continue;
  }
  seller.sizes = nextSizes;
  seller.captured = DATE;
  anyApplied = true;
  moves.sort((x, y) => Math.abs(y.ch) - Math.abs(x.ch));
  const avg = moves.length ? moves.reduce((s, m) => s + m.ch, 0) / moves.length : 0;
  summary.push(`- **${seller.name}**: ${changed ? changed + ' of ' + points + ' prices changed, average ' + (avg >= 0 ? '+' : '') + (avg * 100).toFixed(1) + '%' : 'no price changes'}${held.length ? '; ' + held.length + ' big jump' + (held.length === 1 ? '' : 's') + ' held at old price' : ''}${missing ? '; ' + missing + ' prices missing, kept old' : ''}.`);
  moves.slice(0, 6).forEach(m => lines.push(`  - ${m.z.w}" x ${m.z.h}" x ${m.q}: ${money(m.from)} -> ${money(m.to)} (${m.ch >= 0 ? '+' : ''}${(m.ch * 100).toFixed(1)}%)`));
  held.forEach(m => lines.push(`  - HELD ${m.z.w}" x ${m.z.h}" x ${m.q}: stays ${money(m.from)} (site shows ${money(m.to)}, ${(m.ch * 100).toFixed(0)}%)`));
  if (lines.length) { summary.push(...lines); }
}
if (anyApplied) current.captured = DATE;

report.push('## Summary', '', ...summary, '');
if (collectorErrors.length) report.push('## Collector errors', '', ...collectorErrors.map(e => '- ' + e), '');
if (outOfStep.length) report.push('Note: ' + outOfStep.map(x => path.relative(ROOT, x.file)).join(', ') + ' had different market data; it now gets the same data as index.html.', '');
report.push(anyApplied ? `Market data date is now ${current.captured}.` : 'No seller was updated; the estimator is unchanged.');
const text = report.join('\n') + '\n';

// ---- write back in the one-size-per-line layout ----
function layout(d) {
  const c = o => JSON.stringify(o);
  const head = Object.assign({}, d); delete head.sellers;
  const out = [c(head).slice(0, -1) + ',"sellers":['];
  d.sellers.forEach((s, si) => {
    const meta = Object.assign({}, s); delete meta.sizes;
    out.push(c(meta).slice(0, -1) + ',"sizes":[');
    s.sizes.forEach((z, zi) => out.push(c(z) + (zi < s.sizes.length - 1 ? ',' : '')));
    out.push(']}' + (si < d.sellers.length - 1 ? ',' : ''));
  });
  out.push(']}');
  const txt = out.join('\n');
  JSON.parse(txt);
  return txt;
}
if (!DRY && (anyApplied || outOfStep.length)) {
  const txt = layout(current);
  if (/[^\x00-\x7F]/.test(txt)) throw new Error('non-ASCII in market data');
  for (const x of blocks) { // only the JSON between the tags changes; the rest of each file is untouched
    const next = x.html.slice(0, x.a + OPEN.length) + '\n' + txt + '\n' + x.html.slice(x.b);
    if (next !== x.html) fs.writeFileSync(x.file, next);
  }
}
if (!DRY) {
  fs.mkdirSync(path.join(__dirname, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'reports', DATE + '.md'), text);
}
process.stdout.write(text);
