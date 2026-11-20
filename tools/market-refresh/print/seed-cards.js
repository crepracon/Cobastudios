#!/usr/bin/env node
// One-time seed (Nov 20 2026, v58) for the Paper tab's greeting / note card comparison. Chris: "why do we only have
// Staples" for 5 x 7 folded greeting cards. VistaPrint does sell folded cards near 5 x 7, just not on the note-cards
// page the Nov 13 capture read: their Greeting Cards page (5.5 x 4, 4.6 x 7.2, 5.5 x 5.5) and their holiday cards.
// Adds, from raw/2026-11-20/cards.json (read by hand in the built-in browser), all with refresh: "manual":
//  - vp-greet-folded  VistaPrint Greeting Cards, product-page price (Premium Matte 16pt)
//  - vp-xmas-folded   VistaPrint holiday / Christmas cards, folded (4.6 x 7.2, 5.5 x 5.5; list and sale prices)
//  - vp-xmas-flat     VistaPrint holiday / Christmas cards, flat 5 x 7 (back printed free; list and sale prices)
//  - moo-greet-folded MOO greeting card (A6, 4.13 x 5.83), sanity check
//  - canva-folded     Canva folded card 5 x 7, sanity check
// and a short display name (`short`) for the two VistaPrint note-card products. VistaPrint's 4.6 x 7.2 is marked
// `as: "5 x 7"`: the estimator lists it under 5 x 7, as their closest size. Starts from the Nov 13 grid and keeps its
// "captured" date (the VistaPrint collector's last run), so the 4-monthly refresh check is unchanged.
//   node tools/market-refresh/print/seed-cards.js && node tools/market-refresh/print/apply-print.js
// Running it again rebuilds the same 2026-11-20 file; once a newer data file exists it does nothing.
// Plain ASCII only.
const fs = require('fs'), path = require('path');
const DATA = path.join(__dirname, 'data'), RAW = path.join(__dirname, 'raw', '2026-11-20', 'cards.json');
const CAPT = '2026-11-20', FROM = 'vistaprint-print-2026-11-13.json';
const newest = fs.readdirSync(DATA).filter(f => /^vistaprint-print-\d{4}-\d\d-\d\d\.json$/.test(f)).sort().pop();
if (newest > 'vistaprint-print-' + CAPT + '.json') { console.log('a newer data file exists (' + newest + '); nothing to do'); process.exit(0); }
const grid = JSON.parse(fs.readFileSync(path.join(DATA, FROM), 'utf8'));
const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const item = id => { const x = raw.items.find(i => i.id === id); if (!x) throw new Error('raw has no ' + id); return x; };
const SHIP = 'Shipping $5.99 standard (about 8 business days) or $15.99 fastest; free economy shipping over $100';

// '5.5" x 4"' -> { label: '4 x 5.5', w: 5.5, h: 4 }: labels smaller side first, w = the long side
const dims = s => { const n = String(s).match(/[\d.]+/g).map(Number), a = Math.min(n[0], n[1]), b = Math.max(n[0], n[1]); return { label: a + ' x ' + b, w: b, h: a }; };
const cents = v => Math.round(v * 100) / 100;
// [qty, each] or [qty, list each, sale each] -> totals, to the cent
const totals = rows => rows.map(r => [r[0]].concat(r.slice(1).map(p => cents(r[0] * p))));
const sizesFrom = (it, as) => Object.keys(it.sizes || it.total).map(k => {
  const z = dims(k), out = { label: z.label, w: z.w, h: z.h };
  if (as && as[z.label]) out.as = as[z.label];
  out.ladder = it.sizes ? totals(it.sizes[k]) : it.total[k].map(r => r.slice());
  return out;
});
const AS57 = { '4.6 x 7.2': '5 x 7' };   // VistaPrint's closest to a 5 x 7 card

const vpGreet = { captured: CAPT, refresh: 'manual', sizing: 'exact', name: 'VistaPrint', id: 'vp-greet-folded', product: 'folded', stock: 'premium', sides: 1,
  short: 'greeting card, premium matte 16pt',
  label: 'Greeting card, folded, Premium Matte 16pt uncoated, envelopes included',
  paper: 'Premium Matte 325 gsm (16pt), the paper their product page is priced on; their Standard Matte 14pt costs less (4.6 x 7.2: $2.00 each at 100 in their designer, vs $2.60). White envelopes included.',
  url: item('vp-greet-folded').page,
  note: 'Product-page price, read by hand (the quantity list is a dropdown the collector does not read yet). Sizes 5.5 x 4, 4.6 x 7.2 (their closest to 5 x 7) and 5.5 x 5.5. Minimum 10.',
  sizes: sizesFrom(item('vp-greet-folded'), AS57), ship: SHIP };
const vpXmasFolded = { captured: CAPT, refresh: 'manual', sizing: 'exact', name: 'VistaPrint', id: 'vp-xmas-folded', product: 'folded', stock: 'standard', sides: 1, season: 'holiday',
  short: 'seasonal holiday card, standard 14pt',
  label: 'Holiday / Christmas card, folded, Standard Uncoated 14pt, envelopes included',
  paper: 'Standard Uncoated 14pt, their base holiday-card paper (the 16pt papers cost more). Envelopes included.',
  url: item('vp-xmas-folded').page,
  note: 'Upload-your-own-design price, read by hand. Folded only in 4.6 x 7.2 and 5.5 x 5.5. A Black Friday sale was on (up to 50% off, ending Nov 22 2026), so rows are [qty, list, sale].',
  sizes: sizesFrom(item('vp-xmas-folded'), AS57), ship: SHIP };
const vpXmasFlat = { captured: CAPT, refresh: 'manual', sizing: 'exact', name: 'VistaPrint', id: 'vp-xmas-flat', product: 'flat', stock: 'standard', sides: 2, season: 'holiday',
  short: 'seasonal holiday card, standard 14pt',
  label: 'Holiday / Christmas card, flat, Standard Uncoated 14pt, printed back free, envelopes included',
  paper: 'Standard Uncoated 14pt, their base holiday-card paper (the 16pt papers cost more). Envelopes included; VistaPrint prints the back of holiday cards free.',
  url: item('vp-xmas-flat').page,
  note: 'Upload-your-own-design price, read by hand. Flat in 5 x 7 (captured), 4 x 8, 6 x 9 and 5.5 x 5.5. A Black Friday sale was on (up to 50% off, ending Nov 22 2026), so rows are [qty, list, sale].',
  sizes: sizesFrom(item('vp-xmas-flat')), ship: SHIP };
const moo = { captured: CAPT, refresh: 'manual', sizing: 'exact', name: 'MOO', id: 'moo-greet-folded', product: 'folded', stock: 'uncoated', sides: 1,
  short: 'greeting card, 16pt uncoated',
  label: 'Greeting card, folded, A6 (4.13 x 5.83), 16pt Original paper, white envelopes included',
  paper: 'Original 16pt uncoated, printed outside with the inside left to write on; white envelopes included.',
  url: item('moo-greet-folded').page,
  note: 'One size only (A6, 4.13 x 5.83). Minimum 25. Prices in CAD.',
  sizes: sizesFrom(item('moo-greet-folded')), ship: 'Shipping extra' };
const canva = { captured: CAPT, refresh: 'manual', sizing: 'exact', name: 'Canva', id: 'canva-folded', product: 'folded', stock: 'premium', sides: 0,
  short: 'folded card, envelopes extra',
  label: 'Folded card 5 x 7, product-page price, envelopes sold separately',
  paper: 'Paper is picked when you order: Premium 216-270 gsm, Deluxe 300-350 gsm or Hemp 325 gsm, matte, gloss or uncoated. Envelopes are a separate Canva product (A7 from $0.58 each).',
  url: item('canva-folded').page,
  note: 'One size (5 x 7). Their HOLIDAYCA code (15% off $75+, ends Dec 13 2026) is not applied. Free standard shipping.',
  sizes: sizesFrom(item('canva-folded')), ship: 'Free standard shipping (express extra)' };

const at = id => { const i = grid.sellers.findIndex(s => s.id === id); if (i < 0) throw new Error('grid has no ' + id); return i; };
grid.sellers = grid.sellers.filter(s => [vpGreet, vpXmasFolded, vpXmasFlat, moo, canva].every(n => n.id !== s.id));
grid.sellers[at('vp-note-flat')].short = 'flat note card, standard matte 14pt';
grid.sellers[at('vp-note-folded')].short = 'folded note card, standard matte 14pt';
grid.sellers.splice(at('vp-note-folded') + 1, 0, vpGreet, vpXmasFolded, vpXmasFlat);
grid.sellers.push(moo, canva);
grid.note = 'VistaPrint Canada (calendars, coasters, brochures, postcards, flyers, rack cards, note cards: refreshed every 4 months; posters from the Oct 30 2026 art capture; greeting and holiday cards read by hand Nov 20 2026), Staples Canada paper products and MOO / Canva greeting cards (refresh: manual). Prices before tax and before shipping. Rows: [qty, price] or [qty, list, sale]. Sizes in inches (w x h); brochure sizes are flat (unfolded); paper product labels put the smaller side first; "as" = the size a seller\'s closest product is listed under (VistaPrint 4.6 x 7.2 cards as 5 x 7).';
const json = JSON.stringify(grid, null, 1).replace(/\[\s*([^\[\]{}]*?)\s*\]/g, (m, inner) => '[' + inner.replace(/\s*\n\s*/g, '') + ']');
if (/[^\x00-\x7F]/.test(json)) { console.log('not plain ASCII; nothing written'); process.exit(1); }
fs.writeFileSync(path.join(DATA, 'vistaprint-print-' + CAPT + '.json'), json + '\n');
console.log('wrote data/vistaprint-print-' + CAPT + '.json (captured stays ' + grid.captured + '): added ' +
  [vpGreet, vpXmasFolded, vpXmasFlat, moo, canva].map(s => s.id + ' ' + s.sizes.map(z => z.label + (z.as ? ' (as ' + z.as + ')' : '') + ' ' + z.ladder.length + ' rows').join(', ')).join('; '));
