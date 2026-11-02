// VistaPrint (CA) calendars, coasters and brochures price collector.
// Run this file's full text with javascript_tool in a built-in browser tab that is already open on ONE of the
// product pages listed in README.md (wait ~3 s after opening). It picks each option the way a customer would,
// one radio at a time, waits for the shown prices to change, and reads the price VistaPrint shows for every
// quantity (the quantity list, or the "Show pricing guide" list, which is in the page even while closed).
// No logins, no cart, no requests of its own.
// Returns a JSON string { page, url, captured, done, items: [ { opts, ladder } ], notes: [] }; ladder rows are
// [qty, price] or [qty, list, sale] when a sale price is showing. It stops after about 35 s with done: false;
// run the same text again in the same tab (do not reload) and it carries on where it stopped.
// build-print.js turns the saved results into a new data file. Plain ASCII only.
(async () => {
  const start = Date.now();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const SAMPLE_NO = v => v === 'No';                                       // "Is this a Sample Order?" = No (if asked)
  const SIZE = ['size', v => /^\d+(\.\d+)?" x \d+(\.\d+)?"$/.test(v)];
  const STOCK = ['stock', v => ['Glossy', 'Matte', 'Uncoated', 'Recycled'].indexOf(v) >= 0];
  const BRO = { fixed: [SAMPLE_NO], opts: [SIZE, STOCK] };
  const PAGES = {
    'wall-calendars': { opts: [['size', v => ['A5', 'A4', 'A3', 'Double A4', 'Large Wall Calendar'].indexOf(v) >= 0]] },
    'desk-calendars': { opts: [['size', v => v === 'Rectangular desk calendar' || v === '20x20']] },
    'poster-calendars': {},
    'magnetic-calendars': {},
    'bookmark-calendars': {},
    'mouse-pad-calendars': { fixed: [v => v === '3 mm'] },
    'paper-coasters': {},
    'photo-coasters': {},
    'custom-ceramic-coasters': {},
    'tri-fold': BRO, 'bi-fold': BRO,
    'z-fold': { fixed: [SAMPLE_NO], opts: [STOCK] }                          // one size (8.5 x 11 flat), no size option
  };
  const page = location.pathname.replace(/\/+$/, '').split('/').pop();
  const d = new Date(), z = n => (n < 10 ? '0' : '') + n;
  const conf = PAGES[page];
  let out = window.__vpPrint && window.__vpPrint.page === page ? window.__vpPrint : null;   // resume a stopped run
  if (!out) out = { page, url: location.origin + location.pathname, captured: d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()), done: false, items: [], notes: [] };
  if (!conf) { out.notes.push('not a known page: ' + page); out.done = true; return JSON.stringify(out); }

  const groups = () => Array.from(document.querySelectorAll('[role="radiogroup"]'));
  const radios = g => Array.from(g.querySelectorAll('input[type="radio"]'));
  const labelOf = i => i.closest('label') || (i.id && document.querySelector('label[for="' + i.id + '"]')) || i.nextElementSibling;
  const qtyGroup = () => groups().find(g => { const r = radios(g); return r.length > 1 && r.every(i => /^\d+$/.test(i.value)) && r.some(i => /\$/.test((labelOf(i) || {}).textContent || '')); });
  const groupFor = test => groups().find(g => radios(g).some(i => test(i.value)));
  const readLadder = () => {
    const g = qtyGroup(); if (!g) return null;
    const rows = [];
    radios(g).forEach(i => {
      const t = ((labelOf(i) || {}).textContent || '').replace(/,/g, '');
      const a = (t.match(/\$\d+(?:\.\d+)?/g) || []).map(x => +x.slice(1));
      if (!a.length) return;                                               // quantity offered without a price: skip
      // on sale: [qty, list, sale], the list price being the higher of the two whichever order the label uses
      rows.push(/original price/i.test(t) && a.length >= 2 ? [+i.value, Math.max(a[0], a[1]), Math.min(a[0], a[1])] : [+i.value, a[0]]);
    });
    return rows.sort((p, q) => p[0] - q[0]);
  };
  // after a click, wait until the shown prices change (up to 3 s; some options really cost the same), then settle.
  // The quantity list disappears for a moment while the page redraws, so an empty list never counts as new prices.
  const settle = async before => {
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) { await sleep(250); const now = readLadder(); if (now && now.length && JSON.stringify(now) !== before) break; }
    await sleep(400);
  };
  // the prices once two reads 300 ms apart agree (up to about 6 s); empty while the page is still redrawing
  const readStable = async () => {
    for (let t = 0; t < 20; t++) {
      const a = readLadder();
      if (a && a.length) { await sleep(300); if (JSON.stringify(readLadder()) === JSON.stringify(a)) return a; }
      else await sleep(250);
    }
    return readLadder();
  };
  const pick = async test => {
    const g = groupFor(test); if (!g) return null;                        // option not on this page
    const i = radios(g).find(x => test(x.value)); if (!i) return null;
    if (!i.checked) { const before = JSON.stringify(readLadder()); i.click(); await settle(before); }
    return i.checked;
  };

  for (const f of (conf.fixed || [])) { if ((await pick(f)) === false) out.notes.push('a fixed option could not be picked'); }
  let combos = [{}];
  for (const [key, test] of (conf.opts || [])) {
    const g = groupFor(test);
    if (!g) { if (out.notes.indexOf('no ' + key + ' option on the page') < 0) out.notes.push('no ' + key + ' option on the page'); continue; }
    const vals = radios(g).map(i => i.value).filter(test);
    const next = [];
    combos.forEach(c => vals.forEach(v => next.push(Object.assign({}, c, { [key]: v }))));
    combos = next;
  }
  const have = new Set(out.items.map(it => JSON.stringify(it.opts)));
  for (const c of combos) {
    if (have.has(JSON.stringify(c))) continue;
    if (Date.now() - start > 35000) { window.__vpPrint = out; return JSON.stringify(out); }   // done: false - run again
    let ok = true;
    for (const [key, test] of (conf.opts || [])) {
      if (!(key in c)) continue;
      if ((await pick(v => v === c[key] && test(v))) !== true) { ok = false; out.notes.push('could not pick ' + key + ' ' + c[key]); }
    }
    if (!ok) continue;
    const ladder = await readStable();
    if (!ladder || !ladder.length) { out.notes.push('no prices for ' + JSON.stringify(c)); continue; }
    out.items.push({ opts: c, ladder });
  }
  out.done = true; window.__vpPrint = null;
  return JSON.stringify(out);
})();
