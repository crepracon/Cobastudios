#!/usr/bin/env node
// Builds the art prints and plans market data file from the collector outputs.
//   node tools/market-refresh/art/build-data.js --in <dir> --out <file.json> [--date YYYY-MM-DD]
// <dir> holds the JSON returned by the collect-*.js snippets (checksums are verified).
// Each seller gets a paper group so comparisons are like for like:
//   em     matte inkjet art paper (Coba's Epson Enhanced Matte, 192 gsm, and similar heavyweight matte)
//   rag    100% cotton rag fine art paper (premium; e.g. Hahnemuehle Photo Rag 308 gsm)
//   photo  resin-coated photo paper: satin / luster / semi-gloss / glossy
//   poster economy poster paper (not giclee fine art), matte or gloss
//   bond   20-24 lb bond for plans and CAD drawings (ink: bw or colour)
// Plain ASCII only.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const IN = arg('--in'), OUT = arg('--out'), DATE = arg('--date', new Date().toISOString().slice(0, 10));
if (!IN || !OUT) { console.error('Usage: node build-data.js --in <dir> --out <file.json> [--date YYYY-MM-DD]'); process.exit(2); }
function crc32(str) { let crc = -1; for (let n = 0; n < str.length; n++) { let c = (crc ^ str.charCodeAt(n)) & 255; for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }

const SHIP = {
  pj: 'Shipping extra (ships in a tube from Toronto); site-wide coupon codes often run (30% off on capture day, not applied here)',
  vp: 'Shipping extra (about $6-$35; free over $100)',
  stp: 'Free pickup at a Staples store or shipping; $1.99-$2.99 service fee per order',
  monk: 'In-store at Monk Office (BC); $1 digital file fee per file (1-5 files)',
  nlc: 'Shipping from St. John\'s, NL'
};
const flat = 'Same price per print at any quantity';
const META = {
  'monk-em':  { name: 'Monk Office', group: 'em', label: 'Poster on Epson Enhanced Matte', paper: 'Enhanced Matte (named as such)', ship: SHIP.monk, note: flat + '; $4/sq ft above 36 x 48', url: 'https://www.monk.ca/large-format/', sizing: 'area' },
  'nlc-matte': { name: 'Newfoundland Canvas', group: 'em', label: 'Giclee on Luxe Fine Art Matte', paper: '230 gsm, 10.6 mil smooth matte', ship: SHIP.nlc, note: flat, url: 'https://newfoundlandcanvas.com/wideformat' },
  'pj-rag':   { name: 'Posterjack', group: 'rag', label: 'Fine-Art Print on Hahnemuehle Photo Rag', paper: '308 gsm 100% cotton rag, Epson UltraChrome PRO12 inks', ship: SHIP.pj, note: flat, url: 'https://posterjack.ca/products/fine-art-prints' },
  'nlc-rag':  { name: 'Newfoundland Canvas', group: 'rag', label: 'Giclee on Luxe Cotton Rag', paper: '310 gsm 100% cotton, etching texture', ship: SHIP.nlc, note: flat, url: 'https://newfoundlandcanvas.com/wideformat' },
  'pj-satin': { name: 'Posterjack', group: 'photo', label: 'Photo print, Satin photo paper', paper: 'Satin (luster-like) photo paper', ship: SHIP.pj, note: flat, url: 'https://posterjack.ca/products/satin-matte-poster-prints' },
  'pj-gloss': { name: 'Posterjack', group: 'photo', label: 'Photo print, Glossy photo paper', paper: 'Glossy photo paper', ship: SHIP.pj, note: flat, url: 'https://posterjack.ca/products/glossy-poster-prints' },
  'nlc-satin': { name: 'Newfoundland Canvas', group: 'photo', label: 'Giclee on Luxe Glacier Photo Satin', paper: '300 gsm resin-coated satin photo paper', ship: SHIP.nlc, note: flat, url: 'https://newfoundlandcanvas.com/wideformat' },
  'stp-photo': { name: 'Staples', group: 'photo', label: 'Photo Enlargement/Poster', paper: 'Fujifilm Crystal Archive photo paper', ship: SHIP.stp, note: flat + '; 7-10 business days', url: 'https://shop.staplescopyandprint.ca/products/photo-poster' },
  'monk-semi': { name: 'Monk Office', group: 'photo', label: 'Poster on Semi-Gloss paper', paper: 'Semi-gloss', ship: SHIP.monk, note: flat + '; $5/sq ft above 36 x 48', url: 'https://www.monk.ca/large-format/' },
  'stp-pmatte': { name: 'Staples', group: 'poster', label: 'Poster, Matte paper', paper: 'Poster paper (weight not stated)', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/products/posters' },
  'stp-pgloss': { name: 'Staples', group: 'poster', label: 'Poster, Glossy paper', paper: 'Poster paper (weight not stated)', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/products/posters' },
  'vp-pmatte': { name: 'VistaPrint', group: 'poster', label: 'Poster, Premium Matte', paper: '14 pt matte poster stock', ship: SHIP.vp, note: 'Quantity discounts', url: 'https://www.vistaprint.ca/signs-posters/posters' },
  'vp-semi':  { name: 'VistaPrint', group: 'poster', label: 'Poster, Semi-Gloss', paper: '9.3 pt semi-gloss poster stock', ship: SHIP.vp, note: 'Quantity discounts', url: 'https://www.vistaprint.ca/signs-posters/posters' },
  'vp-pgloss': { name: 'VistaPrint', group: 'poster', label: 'Poster, Premium Glossy', paper: '8 pt high-gloss poster stock (75 or fewer)', ship: SHIP.vp, note: 'Quantity discounts', url: 'https://www.vistaprint.ca/signs-posters/posters' },
  'stp-eng-bw-cs':  { name: 'Staples', group: 'bond', ink: 'bw', label: 'Engineering print, B&W, Complete Solution (2-4 days)', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'stp-eng-bw-sd':  { name: 'Staples', group: 'bond', ink: 'bw', label: 'Engineering print, B&W, Same-day', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'stp-eng-bw-1h':  { name: 'Staples', group: 'bond', ink: 'bw', label: 'Engineering print, B&W, 1-hour (in store)', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'stp-eng-col-cs': { name: 'Staples', group: 'bond', ink: 'colour', label: 'Engineering print, Colour, Complete Solution (2-4 days)', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'stp-eng-col-sd': { name: 'Staples', group: 'bond', ink: 'colour', label: 'Engineering print, Colour, Same-day', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'stp-eng-col-1h': { name: 'Staples', group: 'bond', ink: 'colour', label: 'Engineering print, Colour, 1-hour (in store)', paper: '20 lb bond', ship: SHIP.stp, note: flat, url: 'https://shop.staplescopyandprint.ca/pages/engineering-prints' },
  'monk-bond-bw':  { name: 'Monk Office', group: 'bond', ink: 'bw', label: 'CAD line drawing, B&W', paper: '24 lb bond', ship: SHIP.monk, note: flat + '; $2/sq ft other sizes', url: 'https://www.monk.ca/large-format/' },
  'monk-bond-col': { name: 'Monk Office', group: 'bond', ink: 'colour', label: 'CAD line drawing, Colour', paper: '24 lb bond', ship: SHIP.monk, note: flat + '; $2/sq ft other sizes', url: 'https://www.monk.ca/large-format/' }
};
const sellers = [], extras = {}, errors = [];
for (const f of fs.readdirSync(IN).filter(f => f.endsWith('.json'))) {
  let j = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8').trim());
  if (typeof j === 'string') j = JSON.parse(j);
  if (j.k) { const k = j.k; delete j.k; if (crc32(JSON.stringify(j)) !== k) { console.error('CHECKSUM MISMATCH in ' + f); process.exit(3); } }
  (j.errors || []).forEach(e => errors.push((j.collector || f) + ': ' + e));
  ['perSqft', 'orderFee', 'fileFee', 'notes'].forEach(x => { if (j[x] != null) extras[(j.collector || f) + '.' + x] = j[x]; });
  for (const id of Object.keys(j.sellers || {})) {
    const s = j.sellers[id];
    if (!META[id]) { errors.push('no metadata for ' + id + ' (skipped)'); continue; }
    const sizes = s.rows.map(r => ({ w: r[0], h: r[1], ladder: s.q.map((q, i) => s.cols === 2 ? [q, r[2][i], r[3][i]] : [q, r[2][i]]).filter(x => x[1] != null) }));
    sellers.push(Object.assign({ id, captured: DATE, sizing: 'exact', flat: !/^vp-/.test(id) }, META[id], { sizes }));
  }
}
const order = Object.keys(META);
sellers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const data = { captured: DATE, currency: 'CAD', note: 'Prices before tax and shipping. Rows: [qty, price] or [qty, list, sale]. sizing exact = only listed sizes are sold online; area = custom sizes priced between.', groups: {
  em: 'Matte inkjet art paper (your Epson Enhanced Matte and similar)', rag: 'Cotton rag fine art (premium)', photo: 'Photo paper: satin / luster / semi-gloss / glossy', poster: 'Economy poster paper (not giclee)', bond: 'Bond for plans and CAD (20-24 lb)' }, extras, sellers };
const txt = JSON.stringify(data).replace(/[^\x00-\x7F]/g, '');
fs.writeFileSync(OUT, txt + '\n');
console.log(`${sellers.length} sellers, ${sellers.reduce((s, x) => s + x.sizes.length, 0)} sizes -> ${OUT}`);
if (errors.length) console.log('Collector notes:\n- ' + errors.join('\n- '));
