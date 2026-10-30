#!/usr/bin/env node
// Builds the signs and banners market data file from the collector outputs.
//   node tools/market-refresh/signs/build-data.js --in <dir> --out <file.json> [--date YYYY-MM-DD]
// <dir> holds the JSON returned by collect-*-signs.js (checksums are verified). Each seller gets the
// like-for-like tags the comparison needs: product, sides, material, hem, stake, frame, shipping.
// Plain ASCII only.
const fs = require('fs');
const path = require('path');
const args = process.argv.slice(2);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const IN = arg('--in'), OUT = arg('--out'), DATE = arg('--date', new Date().toISOString().slice(0, 10));
if (!IN || !OUT) { console.error('Usage: node build-data.js --in <dir> --out <file.json> [--date YYYY-MM-DD]'); process.exit(2); }

function crc32(str) { let crc = -1; for (let n = 0; n < str.length; n++) { let c = (crc ^ str.charCodeAt(n)) & 255; for (let k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }

const SHIP = {
  vp: 'Shipping extra (about $6-$35 by size and speed; free over $100)',
  stp: 'Shipping $9.99 (free over $75) or free pickup at a Staples store; up to $2.99 service fee per order',
  sm: 'Free shipping',
  bb: 'Free standard shipping',
  ks: 'Local pickup in Ottawa or shipping; minimum quantities on many items'
};
// Print method (lawn signs, A-frames). Coba makes signs from printed vinyl + laminate mounted on coroplast;
// every competitor found prints straight onto the coroplast with no laminate. Never compare the two as equals.
const DIRECT = { method: 'direct', methodLabel: 'Printed straight onto coroplast, no laminate' };
const NOLAM = { method: 'direct', methodLabel: 'Printed coroplast, no laminate offered' };
// Like-for-like tags per seller id. sides: 1|2. material: banner weight. hem: welded/sewn edge. stake: 'included'|'addon'.
// method: 'direct' (printed onto the board, no laminate) | 'vinyl' (printed vinyl + laminate mounted on the board).
// methodSource: the seller's own wording. sizing: 'area' (estimate between sizes) | 'exact' (fixed sizes only).
const META = {
  'vp-ls1': { name: 'VistaPrint', product: 'lawn', sides: 1, stake: 'addon', stakeId: 'vp-stake', ...DIRECT, methodSource: 'VistaPrint: "printed on 4 mm UV-resistant corrugated plastic", lasts "around 1 year outdoors"; optional glossy coating, no laminate', label: 'Lawn sign, 4 mm coroplast, 1 sided', url: 'https://www.vistaprint.ca/signs-posters/yard-signs', ship: SHIP.vp },
  'vp-ls2': { name: 'VistaPrint', product: 'lawn', sides: 2, stake: 'addon', stakeId: 'vp-stake', ...DIRECT, methodSource: 'VistaPrint: "printed on 4 mm UV-resistant corrugated plastic", lasts "around 1 year outdoors"; optional glossy coating, no laminate', label: 'Lawn sign, 4 mm coroplast, 2 sided', url: 'https://www.vistaprint.ca/signs-posters/yard-signs', ship: SHIP.vp },
  'stp-ls1': { name: 'Staples', product: 'lawn', sides: 1, stake: 'addon', stakeId: 'stp-stake', ...NOLAM, methodSource: 'Staples: 4mm Coroplast; print method not stated, no laminate option', label: 'Yard sign, 4 mm coroplast, 1 sided', url: 'https://shop.staplescopyandprint.ca/products/yard-sign', ship: SHIP.stp, note: 'Same price per sign at any quantity' },
  'stp-ls2': { name: 'Staples', product: 'lawn', sides: 2, stake: 'addon', stakeId: 'stp-stake', ...NOLAM, methodSource: 'Staples: 4mm Coroplast; print method not stated, no laminate option', label: 'Yard sign, 4 mm coroplast, 2 sided', url: 'https://shop.staplescopyandprint.ca/products/yard-sign', ship: SHIP.stp, note: 'Same price per sign at any quantity' },
  'sm-ls2': { name: 'Sticker Mule', product: 'lawn', sides: 2, stake: 'included', ...DIRECT, methodSource: 'Sticker Mule: "printed in full colour on a 4 mm thick corrugated plastic"; no laminate mentioned (their stickers say laminate)', label: 'Rigid yard sign, 4 mm coroplast, 2 sided, H-stake included', url: 'https://www.stickermule.com/ca/products/rigid-yard-signs', ship: SHIP.sm, note: 'One size only: 24 x 18 in' },
  'ks-ls1': { name: 'Kelly Signs', product: 'lawn', sides: 1, stake: 'addon', stakeId: 'ks-stake', local: true, ...DIRECT, methodSource: 'Kelly Signs: "All commercial signs are printed directly onto the material chosen"', sizing: 'exact', label: 'Real estate / commercial signs, 4 mm coroplast, 1 sided', url: 'https://kellysigns.ca/real-estate-2/', ship: SHIP.ks, note: 'Fixed sizes. Open house signs sold in sets, minimum 6 signs. Large site signs: sides not stated, priced as 1 sided' },
  'ks-ls2': { name: 'Kelly Signs', product: 'lawn', sides: 2, stake: 'addon', stakeId: 'ks-stake', local: true, ...DIRECT, methodSource: 'Kelly Signs: "All commercial signs are printed directly onto the material chosen"', sizing: 'exact', label: 'For Sale insert sign, 4 mm coroplast, 2 sided', url: 'https://kellysigns.ca/real-estate-2/', ship: SHIP.ks, note: 'Fixed size 24 x 32 in, minimum 6; shop shows the lowest (largest quantity) price' },
  'vp-b13': { name: 'VistaPrint', product: 'banner', material: '13oz', hem: true, label: '"Indoor" 13 oz vinyl, reinforced (welded) edges + grommets', url: 'https://www.vistaprint.ca/signs-posters/vinyl-banners', ship: SHIP.vp, note: 'VistaPrint calls its 13 oz material Indoor; Outdoor is 15 oz' },
  'vp-b13n': { name: 'VistaPrint', product: 'banner', material: '13oz', hem: false, label: '"Indoor" 13 oz vinyl, grommets, no reinforced edges', url: 'https://www.vistaprint.ca/signs-posters/vinyl-banners', ship: SHIP.vp },
  'vp-b15': { name: 'VistaPrint', product: 'banner', material: 'heavy', weight: '15 oz', hem: true, label: '"Outdoor" 15 oz vinyl, reinforced (welded) edges + grommets', url: 'https://www.vistaprint.ca/signs-posters/vinyl-banners', ship: SHIP.vp },
  'stp-b13': { name: 'Staples', product: 'banner', material: '13oz', hem: true, label: 'Outdoor banner, 13 oz super smooth vinyl, 1 in sewn edge + grommets every 2 ft', url: 'https://shop.staplescopyandprint.ca/products/outdoor-banners', ship: SHIP.stp, note: 'Same price per banner at any quantity' },
  'stp-b18': { name: 'Staples', product: 'banner', material: 'heavy', weight: '18 oz', hem: true, label: 'Outdoor banner, 18 oz heavy duty vinyl, 1 in sewn edge + grommets every 2 ft', url: 'https://shop.staplescopyandprint.ca/products/outdoor-banners', ship: SHIP.stp, note: 'Same price per banner at any quantity' },
  'bb-b13': { name: 'BannerBuzz', product: 'banner', material: '13oz', hem: false, label: 'Custom vinyl banner, 13 oz, metal grommets, flush cut (no hem)', url: 'https://www.bannerbuzz.ca/custom-vinyl-banners/p', ship: SHIP.bb, note: 'Always shown about 40% off a crossed-out price; this is the price customers pay' },
  'sm-big': { name: 'Sticker Mule', product: 'bigsticker', lam: 'laminated', label: 'Die cut stickers, laminated vinyl, 8 to 24 in', url: 'https://www.stickermule.com/ca/products/die-cut-stickers', ship: SHIP.sm },
  'stp-af': { name: 'Staples', product: 'aframe', sides: 2, frame: true, ...NOLAM, label: 'A-frame sign: 2 coroplast prints + plastic A-frame holder', url: 'https://shop.staplescopyandprint.ca/products/a-frame-signs', ship: SHIP.stp }
};

const sellers = [], addons = {}, errors = [];
let stakeVP = null;
for (const f of fs.readdirSync(IN).filter(f => f.endsWith('.json'))) {
  let j = JSON.parse(fs.readFileSync(path.join(IN, f), 'utf8').trim());
  if (typeof j === 'string') j = JSON.parse(j);
  if (j.k) { const k = j.k; delete j.k; if (crc32(JSON.stringify(j)) !== k) { console.error('CHECKSUM MISMATCH in ' + f); process.exit(3); } }
  (j.errors || []).forEach(e => errors.push((j.collector || f) + ': ' + e));
  Object.assign(addons, j.addons || {});
  if (j.tiers) addons['bb-tiers'] = j.tiers;
  for (const id of Object.keys(j.sellers || {})) {
    const s = j.sellers[id];
    const sizes = s.rows.map(r => ({ w: r[0], h: r[1], ladder: s.q.map((q, i) => s.cols === 2 ? [q, r[2][i], r[3][i]] : [q, r[2][i]]).filter(x => x[1] != null) }));
    if (id === 'vp-stake') { stakeVP = sizes[0].ladder; continue; }
    if (!META[id]) { errors.push('no metadata for ' + id + ' (skipped)'); continue; }
    sellers.push(Object.assign({ id, captured: DATE, sizing: 'area' }, META[id], { sizes }));
  }
}
if (stakeVP) addons['vp-stake'] = stakeVP; // [qty, list, sale] for wire H-stakes, one per sign
const order = Object.keys(META);
sellers.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
const data = { captured: DATE, currency: 'CAD', note: 'Prices before tax and before shipping. Rows: [qty, price] or [qty, list, sale].', sellers, addons };
const txt = JSON.stringify(data);
if (/[^\x00-\x7F]/.test(txt)) throw new Error('non-ASCII in data');
fs.writeFileSync(OUT, txt + '\n');
console.log(`${sellers.length} sellers, ${sellers.reduce((s, x) => s + x.sizes.length, 0)} sizes -> ${OUT}`);
if (errors.length) console.log('Collector notes:\n- ' + errors.join('\n- '));
