#!/usr/bin/env node
// Turns the results of collect-vistaprint-print.js (one JSON per product page) into a new dated data file.
//   node tools/market-refresh/print/build-print.js --in /tmp/market-refresh/print [--dry-run] [--accept id,id]
// Starts from the newest data/vistaprint-print-*.json, writes data/vistaprint-print-<captured>.json and a report
// tools/market-refresh/reports/print-<captured>.md. Then run apply-print.js to put the new prices in index.html.
// Safety, like apply.js for stickers: a price that moved more than 30% keeps its old value and is listed; if more
// than 10% of a product's prices moved that much, or every price dropped by about the same amount (a sale the page
// doesn't show as one), or the product (or one of its sizes) wasn't collected, it keeps its old prices.
// --accept takes the collected prices for the listed product ids anyway (after Chris has checked the report).
// Sale prices (the third value in a row) are taken as collected. Plain ASCII only.
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const IN = args[args.indexOf('--in') + 1];
const DRY = args.indexOf('--dry-run') >= 0;
const ACCEPT = args.indexOf('--accept') >= 0 ? String(args[args.indexOf('--accept') + 1] || '').split(',').filter(Boolean) : [];
if (args.indexOf('--in') < 0 || !IN) { console.log('usage: build-print.js --in <dir with collector JSON files> [--dry-run] [--accept id,id]'); process.exit(2); }
const DATA = path.join(__dirname, 'data'), REPORTS = path.resolve(__dirname, '..', 'reports');
const newest = fs.readdirSync(DATA).filter(f => /^vistaprint-print-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop();
const grid = JSON.parse(fs.readFileSync(path.join(DATA, newest), 'utf8'));
const MOVE = 0.30, SELLER_HOLD = 0.10;

// which product + size each collected item belongs to
const WALL = { 'A5': 0, 'A4': 1, 'A3': 2, 'Double A4': 3, 'Large Wall Calendar': 4 };
const DESK = { 'Rectangular desk calendar': 0, '20x20': 1 };
const SINGLE = { 'poster-calendars': 'vp-cal-poster', 'magnetic-calendars': 'vp-cal-magnet', 'bookmark-calendars': 'vp-cal-bookmark',
  'mouse-pad-calendars': 'vp-cal-mousepad', 'paper-coasters': 'vp-coaster-paper', 'photo-coasters': 'vp-coaster-photo',
  'custom-ceramic-coasters': 'vp-coaster-ceramic' };
const FOLD = { 'tri-fold': 'tri', 'bi-fold': 'bi', 'z-fold': 'z' };
// paper products (v46, seeded by seed-paper.js): option value on the page -> stock in the seller id
const PC_STOCK = { 'Glossy (front only)': 'glossy', 'Matte': 'matte', 'Uncoated': 'uncoated', 'Recycled': 'recycled' };
const FLY_STOCK = { 'Glossy': 'glossy', 'Matte': 'matte', 'Uncoated': 'uncoated', 'Recycled': 'recycled' };
const RACK_STOCK = { 'Glossy Front Only': 'glossy', 'Matte': 'matte', 'Uncoated': 'uncoated', 'Recycled Matte': 'recycled' };
const sizeLabel = v => { const n = String(v || '').match(/[\d.]+/g); if (!n || n.length < 2) return ''; return Math.min(+n[0], +n[1]) + ' x ' + Math.max(+n[0], +n[1]); };
function targets(page, o) {
  const s = id => grid.sellers.find(x => x.id === id);
  const bySize = (id, size) => { const x = s(id); if (!x) return []; const i = x.sizes.findIndex(z => z.label === sizeLabel(size)); return i >= 0 ? [[id, i]] : []; };
  if (page === 'standard-postcards') return PC_STOCK[o.stock] ? bySize('vp-pc-' + PC_STOCK[o.stock], o.size) : [];
  if (page === 'flyers') return FLY_STOCK[o.stock] ? bySize('vp-fly-' + FLY_STOCK[o.stock], o.size) : [];
  if (page === 'rack-cards') { const id = 'vp-rack-' + RACK_STOCK[o.stock]; return s(id) ? [[id, 0]] : []; }
  // note cards: Folded switches the page back to 5.5 x 4, so a "5 x 7 Folded" result matches nothing (reported, ignored)
  if (page === 'note-cards') return o.fold === 'Folded' ? bySize('vp-note-folded', o.size) : o.fold === 'Flat' ? bySize('vp-note-flat', o.size) : [];
  if (page === 'wall-calendars') return WALL[o.size] != null ? [['vp-cal-wall', WALL[o.size]]] : [];
  if (page === 'desk-calendars') return DESK[o.size] != null ? [['vp-cal-desk', DESK[o.size]]] : [];
  if (SINGLE[page]) { const x = s(SINGLE[page]); return x ? x.sizes.map((_, i) => [x.id, i]) : []; }   // ceramic: square + round share one price
  if (FOLD[page]) {
    const id = 'vp-bro-' + FOLD[page] + '-' + String(o.stock || '').toLowerCase(), x = s(id); if (!x) return [];
    if (!o.size) return x.sizes.length === 1 ? [[id, 0]] : [];
    const m = String(o.size).match(/([\d.]+)" x ([\d.]+)"/), label = m ? m[1] + 'x' + m[2] + ' flat' : '';
    const i = x.sizes.findIndex(z => z.label === label); return i >= 0 ? [[id, i]] : [];
  }
  return [];
}

const files = fs.readdirSync(IN).filter(f => /\.json$/.test(f));
const incoming = {}, problems = []; let captured = '';
files.forEach(f => {
  let r; try { r = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8')); if (typeof r === 'string') r = JSON.parse(r); }
  catch (e) { problems.push(f + ': not valid JSON'); return; }
  (r.errors || []).concat(r.notes || []).forEach(e => problems.push(r.page + ': ' + e));
  if (r.done === false) problems.push(r.page + ': collection stopped early (done: false) - run the collector again on that tab');
  if (r.captured && (!captured || r.captured < captured)) captured = r.captured;
  (r.items || []).forEach(it => {
    if (r.page === 'note-cards') it.ladder = (it.ladder || []).filter(x => x[0] > 1);   // qty 1 = a one-off sample card
    const t = targets(r.page, it.opts || {});
    if (!t.length) problems.push(r.page + ': no product matches ' + JSON.stringify(it.opts));
    t.forEach(([id, i]) => { (incoming[id] = incoming[id] || {})[i] = it.ladder; });
  });
});
if (!captured) { console.log('No collector results in ' + IN); process.exit(1); }

const pct = (a, b) => ((b / a - 1) * 100);
const lines = [], held = [];
let changedSellers = 0;
const byHand = grid.sellers.filter(s => s.refresh).map(s => s.id);
if (byHand.length) lines.push('- not part of this refresh (refresh: manual / art): ' + byHand.join(', '));
grid.sellers.forEach(s => {
  if (s.refresh) return;   // Staples Canada paper products (read by hand) and VistaPrint posters (art capture)
  const inc = incoming[s.id];
  if (!inc) { held.push(s.id + ': not collected, kept the old prices'); return; }
  const accept = ACCEPT.indexOf(s.id) >= 0, bigMoves = [];
  let compared = 0, moved = 0, changed = 0, added = 0, dropped = 0, lo = Infinity, hi = -Infinity;
  const plan = s.sizes.map((z, i) => {
    const nw = inc[i];
    if (!nw) { held.push(s.id + ' ' + (z.label || 'size ' + i) + ': not collected, kept the old prices'); return null; }
    if (nw.length < z.ladder.length / 2 && !accept) {   // a partial quantity list: something on the page changed
      held.push(s.id + ' ' + (z.label || 'size ' + i) + ': only ' + nw.length + ' of ' + z.ladder.length + ' quantities found, kept the old prices');
      return null;
    }
    const old = {}; z.ladder.forEach(r => { old[r[0]] = r; });
    dropped += z.ladder.filter(r => !nw.some(n => n[0] === r[0])).length;
    const rows = nw.map(r => {
      const o = old[r[0]]; if (!o) { added++; return r; }
      compared++;
      const p = pct(o[1], r[1]);
      if (Math.abs(r[1] - o[1]) > 0.005) { changed++; lo = Math.min(lo, p); hi = Math.max(hi, p); }
      if (Math.abs(p) > MOVE * 100 && !accept) { moved++; bigMoves.push(s.id + ' ' + (z.label || '') + ' qty ' + r[0] + ': $' + o[1] + ' -> $' + r[1] + ' (' + p.toFixed(0) + '%), kept $' + o[1]); return o; }
      return r;
    });
    return rows;
  });
  if (compared && moved / compared > SELLER_HOLD) {
    held.push(s.id + ': ' + moved + ' of ' + compared + ' prices moved over 30% - whole product kept at the old prices (site change or a sale?)');
    return;
  }
  // every price down by about the same percentage = a sale the page doesn't label as one
  if (!accept && changed >= 3 && changed >= 0.8 * compared && hi < 0 && hi - lo <= 2 && lo <= -10) {
    held.push(s.id + ': every price dropped about ' + (-lo).toFixed(0) + '% - looks like a sale, whole product kept at the old prices (if it is a real price change, run again with --accept ' + s.id + ')');
    return;
  }
  bigMoves.forEach(h => held.push(h));
  plan.forEach((rows, i) => { if (rows) s.sizes[i].ladder = rows; });
  if (plan.every(rows => rows)) s.captured = captured;   // every size confirmed at this capture
  if (accept) lines.push('- ' + s.id + ': collected prices accepted (--accept)');
  const qn = n => n + ' quantit' + (n === 1 ? 'y' : 'ies');
  const extra = (added ? '; ' + qn(added) + ' added' : '') + (dropped ? '; ' + qn(dropped) + ' no longer offered (dropped)' : '');
  if (changed || added || dropped) changedSellers++;
  if (changed) lines.push('- ' + s.id + ': ' + changed + ' price(s) changed (' + lo.toFixed(0) + '% to ' + (hi > 0 ? '+' : '') + hi.toFixed(0) + '%)' + extra);
  else lines.push('- ' + s.id + ': no price changes' + extra);
});
grid.captured = captured;
// indented, with each price row on one line, so a refresh's git diff shows exactly which prices moved
const json = JSON.stringify(grid, null, 1).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, inner) => '[' + inner.replace(/\s*\n\s*/g, '') + ']');
if (/[^\x00-\x7F]/.test(json)) { console.log('Collected data is not plain ASCII; nothing written.'); process.exit(1); }
const report = '# VistaPrint print price refresh ' + captured + '\n\nFrom ' + files.length + ' page result(s); started from ' + newest + '.\n\n## Products\n' +
  lines.join('\n') + '\n\n## Held for Chris to check\n' + (held.length ? held.map(h => '- ' + h).join('\n') : '- nothing') +
  '\n\n## Collector notes\n' + (problems.length ? problems.map(p => '- ' + p).join('\n') : '- none') + '\n';
console.log(report);
if (DRY) { console.log('(dry run: nothing written)'); process.exit(0); }
fs.writeFileSync(path.join(DATA, 'vistaprint-print-' + captured + '.json'), json + '\n');
if (!fs.existsSync(REPORTS)) fs.mkdirSync(REPORTS);
fs.writeFileSync(path.join(REPORTS, 'print-' + captured + '.md'), report);
console.log('wrote data/vistaprint-print-' + captured + '.json and reports/print-' + captured + '.md (' + changedSellers + ' product(s) changed)');
