#!/usr/bin/env node
// One-time seed (Nov 13 2026) for the Paper tab's "Postcards, flyers, cards & posters" reference (v46).
// Adds new products to the market-print grid and writes data/vistaprint-print-2026-11-13.json:
//  - VistaPrint postcards, flyers, rack cards and note cards, from collect-vistaprint-print.js results saved in
//    raw/2026-11-13/ (packed: q = quantities, items = [options, prices in q order]). From then on the regular
//    refresh (collector -> build-print.js -> apply-print.js) keeps these current.
//  - VistaPrint posters from the Oct 30 2026 art capture (../art/data/art-market-2026-10-30.json), refresh: "art".
//  - Staples Canada paper products from raw/2026-11-13/staples-paper.json (read by hand), refresh: "manual".
// build-print.js leaves products with a "refresh" field alone. Run once:
//   node tools/market-refresh/print/seed-paper.js && node tools/market-refresh/print/apply-print.js
// Running it again rebuilds the same 2026-11-13 file from the same inputs (e.g. after fixing a note in raw/); once a
// regular refresh has written a newer data file it does nothing, because that file now owns these products.
// Plain ASCII only.
const fs = require('fs'), path = require('path');
const DATA = path.join(__dirname, 'data'), RAW = path.join(__dirname, 'raw', '2026-11-13');
const ART = path.resolve(__dirname, '..', 'art', 'data', 'art-market-2026-10-30.json');
const CAPT = '2026-11-13';
const newest = fs.readdirSync(DATA).filter(f => /^vistaprint-print-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop();
if (newest > 'vistaprint-print-' + CAPT + '.json') { console.log('a newer data file exists (' + newest + '): the regular refresh owns these products now; nothing to do'); process.exit(0); }
const grid = JSON.parse(fs.readFileSync(path.join(DATA, 'vistaprint-print-2026-11-02.json'), 'utf8'));
const read = f => JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
const SHIP = 'Shipping $5.99 standard (about 8 business days) or $15.99 fastest; free economy shipping over $100';
const STAPLES_SHIP = 'Service fee up to $2.99 per order; shipping $9.99 (free over $75) or free store pickup';

// "5.5 x 4" -> { label: '4 x 5.5', w: 5.5, h: 4 }: labels smaller side first, w = the long side
const dims = s => { const n = String(s).match(/[\d.]+/g).map(Number), a = Math.min(n[0], n[1]), b = Math.max(n[0], n[1]); return { label: a + ' x ' + b, w: b, h: a }; };
// packed collector result -> { 'size|option': ladder }, empty quantities and the listed quantities dropped
const unpack = (p, drop) => {
  const out = {};
  p.items.forEach(([key, prices]) => {
    out[key] = p.q.map((q, i) => {
      const v = prices[i]; if (v == null || (drop || []).indexOf(q) >= 0) return null;
      return Array.isArray(v) ? [q].concat(v) : [q, v];
    }).filter(Boolean);
  });
  return out;
};
const add = s => grid.sellers.push(s);
const STOCKS = { glossy: 'glossy', matte: 'matte', uncoated: 'uncoated', recycled: 'recycled' };

// ---- VistaPrint postcards: standard thickness, Backside Blank (printed front only) ----
const pc = unpack(read('standard-postcards.json'));
[['glossy', 'Glossy (front only)'], ['matte', 'Matte'], ['uncoated', 'Uncoated'], ['recycled', 'Recycled']].forEach(([st, name]) => {
  const sizes = Object.keys(pc).filter(k => k.split('|')[1] === name)
    .filter(k => !(st === 'recycled' && /^6 x 11\|/.test(k)))      // not offered: the page kept another size's prices
    .map(k => Object.assign(dims(k.split('|')[0]), { ladder: pc[k] }));
  add({ captured: CAPT, sizing: 'exact', name: 'VistaPrint', id: 'vp-pc-' + st, product: 'postcard', stock: STOCKS[st], sides: 1,
    label: 'Postcard, ' + (st === 'glossy' ? 'glossy front' : st) + ', standard thickness, printed front only',
    paper: 'Standard thickness card stock. Premium thickness and a printed back are picked later in their designer; those prices are not on the product page.',
    url: 'https://www.vistaprint.ca/marketing-materials/standard-postcards',
    note: 'Product-page price (Backside: Blank, Paper Thickness: Standard).' + (st === 'recycled' ? ' 6 x 11 is not offered in recycled.' : ''),
    sizes, ship: SHIP });
});

// ---- VistaPrint flyers: Budget thickness (their default, paper), Backside Blank ----
const fly = unpack(read('flyers.json'));
['glossy', 'matte', 'uncoated', 'recycled'].forEach(st => {
  const name = st.charAt(0).toUpperCase() + st.slice(1);
  const sizes = Object.keys(fly).filter(k => k.split('|')[1] === name).map(k => Object.assign(dims(k.split('|')[0]), { ladder: fly[k] }));
  add({ captured: CAPT, sizing: 'exact', name: 'VistaPrint', id: 'vp-fly-' + st, product: 'flyer', stock: st, sides: 1,
    label: 'Flyer, ' + st + ', budget thickness (paper), printed front only',
    paper: 'Budget thickness, their default flyer paper. Thicker paper and a printed back are picked later in their designer; those prices are not on the product page.',
    url: 'https://www.vistaprint.ca/marketing-materials/flyers',
    note: 'Product-page price (Backside: Blank, Paper Thickness: Budget).', sizes, ship: SHIP });
});

// ---- VistaPrint rack cards: one size, 3.74 x 8.27 ----
const rack = unpack(read('rack-cards.json'));
[['glossy', 'Glossy Front Only'], ['matte', 'Matte'], ['uncoated', 'Uncoated'], ['recycled', 'Recycled Matte']].forEach(([st, name]) => {
  if (!rack[name]) return;
  add({ captured: CAPT, sizing: 'exact', name: 'VistaPrint', id: 'vp-rack-' + st, product: 'rack', stock: st, sides: 1,
    label: 'Rack card, ' + (st === 'glossy' ? 'glossy front' : st === 'recycled' ? 'recycled matte' : st) + ', standard thickness, printed front only',
    paper: 'Standard thickness card stock; printed back picked later in their designer (price not on the product page).',
    url: 'https://www.vistaprint.ca/marketing-materials/rack-cards',
    note: 'Product-page price (Backside: Blank, Paper Thickness: Standard).',
    sizes: [Object.assign(dims('3.74 x 8.27'), { ladder: rack[name] })], ship: SHIP });
});

// ---- VistaPrint note cards: 14pt (271 gsm) uncoated matte, white envelopes included. Folded only at 4 x 5.5 ----
const note = unpack(read('note-cards.json'), [1]);      // qty 1 is a one-off sample, not an order quantity
[['flat', 'Flat'], ['folded', 'Folded']].forEach(([f, name]) => {
  const sizes = Object.keys(note).filter(k => k.split('|')[1] === name).map(k => Object.assign(dims(k.split('|')[0]), { ladder: note[k] }));
  add({ captured: CAPT, sizing: 'exact', name: 'VistaPrint', id: 'vp-note-' + f, product: f === 'flat' ? 'flat' : 'folded', stock: 'uncoated', sides: 1,
    label: (f === 'flat' ? 'Flat note card' : 'Folded note / greeting card') + ', 14pt uncoated matte, envelopes included',
    paper: 'Standard Matte 271 gsm (14pt) uncoated; white envelopes included; Backside Blank.',
    url: 'https://www.vistaprint.ca/stationery/note-cards',
    note: f === 'folded' ? 'Folded is only offered at 4 x 5.5 (5.5 x 4 horizontal). Minimum 10.' : 'Minimum 10 (a single sample card is also sold).',
    sizes, ship: SHIP });
});

// ---- VistaPrint posters (Oct 30 2026 art capture) ----
const art = JSON.parse(fs.readFileSync(ART, 'utf8'));
[['vp-pmatte', 'pmatte', 'premium matte 14pt'], ['vp-semi', 'semi', 'semi-gloss 9.3pt'], ['vp-pgloss', 'pgloss', 'premium glossy 8pt']].forEach(([src, id, stock]) => {
  const s = art.sellers.find(x => x.id === src); if (!s) throw new Error('art data has no ' + src);
  add({ captured: s.captured || art.captured, refresh: 'art', sizing: 'exact', name: 'VistaPrint', id: 'vp-poster-' + id, product: 'poster', stock, sides: 1,
    label: s.label + ' (' + stock + ')', paper: s.paper, url: s.url, note: 'From the art & plans capture; ' + (s.note || ''),
    sizes: s.sizes.map(z => Object.assign(dims(z.w + ' x ' + z.h), { ladder: z.ladder.map(r => (r.length > 2 && r[2] === r[1]) ? [r[0], r[1]] : r) })),
    ship: s.ship || SHIP });
});

// ---- Staples Canada (read by hand) ----
const stp = read('staples-paper.json');
stp.products.forEach(p => {
  [1, 2].forEach(sd => {
    const sizes = Object.keys(p.sizes).filter(k => +k.split('|')[1] === sd).map(k => Object.assign(dims(k.split('|')[0]), { ladder: p.sizes[k] }));
    if (!sizes.length) return;
    add({ captured: stp.captured, refresh: 'manual', sizing: 'exact', name: 'Staples Canada', id: p.id + '-' + sd, product: p.product, sides: sd,
      label: p.label + ', ' + sd + '-sided', url: p.url, note: p.note, sizes, ship: STAPLES_SHIP });
  });
});

grid.captured = CAPT;
grid.note = 'VistaPrint Canada (calendars, coasters, brochures, postcards, flyers, rack cards, note cards: refreshed every 4 months; posters from the Oct 30 2026 art capture) and Staples Canada paper products (refresh: manual). Prices before tax and before shipping. Rows: [qty, price] or [qty, list, sale]. Sizes in inches (w x h); brochure sizes are flat (unfolded); paper product labels put the smaller side first.';
const json = JSON.stringify(grid, null, 1).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, inner) => '[' + inner.replace(/\s*\n\s*/g, '') + ']');
if (/[^\x00-\x7F]/.test(json)) { console.log('not plain ASCII; nothing written'); process.exit(1); }
fs.writeFileSync(path.join(DATA, 'vistaprint-print-' + CAPT + '.json'), json + '\n');
const added = grid.sellers.filter(s => /^(vp-pc-|vp-fly-|vp-rack-|vp-note-|vp-poster-|stp-)/.test(s.id));
console.log('wrote data/vistaprint-print-' + CAPT + '.json: ' + added.length + ' products added (' + added.map(s => s.id + ' ' + s.sizes.length).join(', ') + ')');
