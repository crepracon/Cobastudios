#!/usr/bin/env node
// Writes the VistaPrint calendar / coaster / brochure price grid into index.html as
//   <script type="application/json" id="market-print"> ... </script>
// (placed right after the sticker block id="market-data", which this never touches).
//   node tools/market-refresh/print/apply-print.js [data/vistaprint-print-YYYY-MM-DD.json]
// With no argument the newest file in data/ is used. Plain ASCII only.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'data');
const SRC = path.resolve(__dirname, '..', '..', '..', 'index.html');
const file = process.argv[2] ? path.resolve(process.argv[2])
  : path.join(DIR, fs.readdirSync(DIR).filter(f => /^vistaprint-print-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop());
const grid = JSON.parse(fs.readFileSync(file, 'utf8'));

// sanity checks before anything is written
const need = ['vp-coaster-ceramic', 'vp-cal-wall', 'vp-cal-desk', 'vp-cal-poster', 'vp-cal-magnet', 'vp-bro-tri-glossy', 'vp-bro-bi-glossy', 'vp-bro-z-glossy'];
const ids = new Set(grid.sellers.map(s => s.id));
need.forEach(id => { if (!ids.has(id)) throw new Error('missing seller ' + id); });
grid.sellers.forEach(s => s.sizes.forEach(z => z.ladder.forEach(r => {
  if (!(r[0] > 0) || !(r[1] > 0)) throw new Error('bad ladder row in ' + s.id + ': ' + JSON.stringify(r));
})));
const json = JSON.stringify(grid);
if (/[^\x00-\x7F]/.test(json)) throw new Error('data must be plain ASCII');
if (/<\/script/i.test(json)) throw new Error('data must not contain a closing script tag');

let html = fs.readFileSync(SRC, 'utf8');
const block = '<script type="application/json" id="market-print">' + json + '</script>';
const re = /<script type="application\/json" id="market-print">[\s\S]*?<\/script>/;
if (re.test(html)) html = html.replace(re, () => block);
else {
  const anchor = html.search(/<script type="application\/json" id="market-data">[\s\S]*?<\/script>/);
  if (anchor < 0) throw new Error('sticker market-data block not found');
  const end = html.indexOf('</script>', anchor) + '</script>'.length;
  html = html.slice(0, end) + '\n' + block + html.slice(end);
}
fs.writeFileSync(SRC, html);
console.log('market-print block written from ' + path.basename(file) + ' (captured ' + grid.captured + ', ' + grid.sellers.length + ' products, ' + json.length + ' bytes)');
