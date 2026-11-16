#!/usr/bin/env node
// Smoke test for the Walk-ins tab (v44) in a headless window (jsdom).
//   NODE_PATH=/path/to/node_modules node tools/smoke-walkin.js [index.html]
// Needs jsdom (npm install jsdom in any scratch folder, then point NODE_PATH at it).
// Covers: menu built from the price tables, tap to add / tap again for one more, quantity breaks,
// 2-sided = double, a typed price survives quantity changes, custom item, HST totals, remove,
// receipt print (receipt-only layout on, then off; never reused by another tab's print), receipt
// details saved on the device, copy as text (clipboard and fallback), New sale, and a sale saved with
// Save estimate reopening at its rung-up prices. v48: every price is 3 x the market-based one. Plain ASCII only.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

function openWin() {
  const errs = [], prints = [];
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously', url: 'https://crepracon.github.io/Cobastudios/', pretendToBeVisual: true,
    beforeParse(w) {
      w.addEventListener('error', e => errs.push(String(e.message)));
      w.console.error = function () { const s = Array.prototype.map.call(arguments, String).join(' '); if (!/cloud init failed/.test(s)) errs.push(s); };
      w.console.warn = function () {};
      w.scrollTo = () => {};
      w.print = () => { prints.push(w.document.body.classList.contains('w-printing')); };
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  const w = dom.window;
  return { w, errs, prints, $: id => w.document.getElementById(id), set: (id, v) => { w.document.getElementById(id).value = v; } };
}
const lines = X => X.w.eval('wLines.slice()');
const val = (X, id, f) => X.$(id + '-' + f).value;
const typeQty = (X, id, q) => { X.set(id + '-q', q); X.w.wQty(id); };

(async () => {
  const A = openWin();
  await sleep(80);
  const tabs = Array.from(A.w.document.querySelectorAll('.tab-btn')).map(b => b.textContent.trim());
  ok(tabs.length === 8 && /Walk-ins/.test(tabs[0]) && /Paper/.test(tabs[1]) && /Inventory/.test(tabs[6]) && /Jobs/.test(tabs[7]), 'v48: Walk-ins first, Jobs last: ' + tabs.join(' | '));
  ok(A.w.eval('currentTab') === 'paper' && /Paper/.test(A.w.document.querySelector('.tab-btn.active').textContent) && A.w.document.querySelectorAll('.tab-btn.active').length === 1 && A.$('panel-paper').classList.contains('active'), 'the app still opens on Paper');
  A.w.switchTabByName('walkin');
  ok(A.w.eval('currentTab') === 'walkin' && /Walk-ins/.test(A.w.document.querySelector('.tab-btn.active').textContent), 'Walk-ins tab opens');
  A.w.switchTabByName('jobs');
  ok(A.w.eval('currentTab') === 'jobs' && A.$('panel-jobs').classList.contains('active') && /Jobs/.test(A.w.document.querySelector('.tab-btn.active').textContent), 'Jobs tab (last) opens');
  A.w.switchTabByName('walkin');

  // ---------- menu ----------
  const pb = Array.from(A.w.document.querySelectorAll('#w-copy-body .w-pbtn')).map(b => b.textContent);
  ok(pb.length === 12, '12 copy buttons (3 sizes x B&W/colour x 1/2-sided): ' + pb.length);
  ok(pb.slice(0, 4).join(' ') === '$1.20 $2.40 $2.70 $5.40', 'letter row: ' + pb.slice(0, 4).join(' '));
  ok(pb.slice(8, 12).join(' ') === '$2.40 $4.80 $4.50 $9.00', '11x17 row: ' + pb.slice(8, 12).join(' '));
  ok(A.w.document.querySelectorAll('#w-btns-photo .w-ibtn').length === 6 && A.w.document.querySelectorAll('#w-btns-other .w-ibtn').length === 3, 'photo / poster and other buttons');
  ok(A.w.document.querySelectorAll('#w-src-body tbody tr').length === A.w.eval('W_SRC.length'), 'sources table has a row per price');
  ok(/51\+ \$0\.90/.test(A.$('w-breaks').textContent), 'quantity breaks shown under the copy table');
  // v47: Staples Canada's real copy prices (per printed side, tiers by sides in the order) and The UPS Store's list,
  // as captured Nov 13 2026. No walk-in copy price may be below BOTH at any quantity.
  const STP = { 'bw-let': [[1, .23], [500, .13], [1000, .11], [10000, .09], [20000, .07]], 'bw-leg': [[1, .26], [500, .14], [1000, .09], [20000, .08]],
    'bw-tab': [[1, .30], [500, .18], [1000, .13], [10000, .10], [20000, .08]], 'col-let': [[1, .63], [500, .51], [1000, .45], [3000, .36], [5000, .31], [8000, .23]],
    'col-leg': [[1, .90], [500, .65], [1000, .60], [3000, .42], [5000, .32], [8000, .26]], 'col-tab': [[1, 1.00], [500, .96], [1000, .91], [3000, .73], [5000, .64], [8000, .58]] };
  const UPS = { 'bw-let': [[1, .40], [51, .30], [201, .20], [501, .15], [1001, .10]], 'bw-leg': [[1, .50], [51, .40], [201, .30], [501, .20], [1001, .15]],
    'bw-tab': [[1, .80], [51, .70], [201, .60], [501, .50], [1001, .45]], 'col-let': [[1, .90], [11, .80], [200, .70]], 'col-leg': [[1, 1.00], [11, .90], [200, .80]], 'col-tab': [[1, 1.85], [11, 1.00], [200, .80]] };
  const at = (L, q) => L.reduce((p, b) => q >= b[0] ? b[1] : p, L[0][1]);
  const W = A.w.eval('JSON.parse(JSON.stringify(W_BREAKS))'), under = [];
  Object.keys(STP).forEach(k => {
    const qs = [].concat(W[k], STP[k], UPS[k]).map(b => b[0]);
    qs.forEach(q => { if (at(W[k], q) < Math.min(at(STP[k], q), at(UPS[k], q)) - 1e-9) under.push(k + ' at ' + q + ': ' + at(W[k], q)); });
  });
  ok(under.length === 0, 'v47: no copy price below both Staples Canada and The UPS Store: ' + under.join(', '));
  ok(A.w.wUnit('col-leg-1', 11) === 2.7 && A.w.wUnit('col-leg-1', 200) === 2.4 && A.w.wUnit('col-tab-1', 11) === 3 && A.w.wUnit('col-tab-1', 200) === 2.4 && A.w.wUnit('col-tab-2', 11) === 6,
    'v47 x 3: colour legal 11+ $2.70 / 200+ $2.40, colour 11x17 11+ $3.00 / 200+ $2.40 (2-sided $6.00)');
  ok(A.w.wUnit('bw-let-1', 1) === 1.2 && A.w.wUnit('bw-let-1', 51) === 0.9 && A.w.wUnit('col-let-1', 11) === 2.4 && A.w.wUnit('col-leg-1', 1) === 2.7 && A.w.wUnit('col-tab-1', 1) === 4.5 && A.w.wUnit('bw-tab-1', 1) === 2.4,
    'v48: every other copy price is 3 x its v47 price');
  // v48: the market-based tables are the v47 prices; what is charged is exactly 3 x those, to the cent
  const BB = A.w.eval('JSON.parse(JSON.stringify(W_BASE_BREAKS))'), BO = A.w.eval('JSON.parse(JSON.stringify(W_BASE_OTHER))'), WO = A.w.eval('JSON.parse(JSON.stringify(W_OTHER))');
  ok(A.w.eval('W_X') === 3 && JSON.stringify(BB['bw-let']) === '[[1,0.4],[51,0.3],[201,0.2],[501,0.15],[1001,0.1]]' && BB['col-tab'][0][1] === 1.5 && BO.find(x => x.k === 'po-24x36').price === 31.99,
    'v48: market-based prices kept as they were in v47');
  const off = [];
  Object.keys(BB).forEach(k => BB[k].forEach((b, i) => { if (W[k][i][0] !== b[0] || Math.abs(W[k][i][1] - Math.round(b[1] * 300) / 100) > 1e-9) off.push(k + ' ' + b[0]); }));
  BO.forEach((x, i) => { if (WO[i].k !== x.k || Math.abs(WO[i].price - Math.round(x.price * 300) / 100) > 1e-9) off.push(x.k); });
  ok(off.length === 0 && Object.keys(W).length === Object.keys(BB).length && WO.length === BO.length, 'v48: every walk-in price is 3 x its market-based price: ' + off.join(', '));
  ok(A.w.wUnit('ph-4x6', 1) === 1.08 && A.w.wUnit('ph-8x10', 1) === 14.55 && A.w.wUnit('po-24x36', 1) === 95.97 && A.w.wUnit('scan', 1) === 3 && A.w.wUnit('file', 1) === 6 && A.w.wUnit('custom', 1) === 0,
    'v48: photo prints, posters, scan and file fee tripled; custom item still typed');
  ok(/3 times the market-based prices/.test(A.$('w-src-body').textContent) && /3 times what Staples/.test(A.$('panel-walkin').textContent), 'v48: the tab says prices are 3 times the market');
  const srcTxt = A.$('w-src-body').textContent;
  ok(/\$0\.23 a side; \$0\.13 from 500 sides/.test(srcTxt) && /\$1\.00 a side/.test(srcTxt) && /\$2\.99 per same-day order/.test(srcTxt) && !/from&quot; prices|treat those as rough/.test(srcTxt),
    'v47: sources table shows Staples Canada per-side prices and the same-day fee');
  ok(A.$('w-empty').style.display !== 'none' && A.$('w-lines-table').style.display === 'none' && A.$('w-grand').textContent === '$0.00', 'empty sale to start');

  // ---------- tap to add, quantity breaks ----------
  A.w.wAdd('bw-let-1');
  let L = lines(A);
  ok(L.length === 1 && val(A, L[0], 'q') === '1' && val(A, L[0], 'p') === '1.20' && /^B&W 8\.5x11, 1-sided$/.test(val(A, L[0], 'd')), 'B&W letter added at $1.20');
  A.w.wAdd('bw-let-1');
  ok(lines(A).length === 1 && val(A, L[0], 'q') === '2', 'tapping again adds one more on the same line');
  typeQty(A, L[0], 60);  ok(val(A, L[0], 'p') === '0.90', '60 sheets: $' + val(A, L[0], 'p'));
  typeQty(A, L[0], 250); ok(val(A, L[0], 'p') === '0.60', '250 sheets: $' + val(A, L[0], 'p'));
  typeQty(A, L[0], 1500); ok(val(A, L[0], 'p') === '0.30' && A.$(L[0] + '-t').textContent === '$450.00', '1500 sheets: $0.30 = ' + A.$(L[0] + '-t').textContent);
  typeQty(A, L[0], 10); ok(val(A, L[0], 'p') === '1.20' && A.$(L[0] + '-t').textContent === '$12.00', 'back to 10: $1.20');
  A.w.wAdd('bw-let-2'); L = lines(A);
  typeQty(A, L[1], 60); ok(val(A, L[1], 'p') === '1.80', '2-sided is double: 60 sheets $' + val(A, L[1], 'p'));
  A.w.wAdd('col-let-1'); L = lines(A);
  typeQty(A, L[2], 12); ok(val(A, L[2], 'p') === '2.40', 'colour letter 12: $' + val(A, L[2], 'p'));
  typeQty(A, L[2], 250); ok(val(A, L[2], 'p') === '2.10', 'colour letter 250: $' + val(A, L[2], 'p'));
  // a typed price is kept when the quantity changes
  A.set(L[2] + '-p', '0.55'); A.w.wPrice(L[2]);
  typeQty(A, L[2], 5); ok(val(A, L[2], 'p') === '0.55' && A.$(L[2] + '-t').textContent === '$2.75', 'typed price kept: 5 x $0.55 = ' + A.$(L[2] + '-t').textContent);
  // photo print, custom item
  A.w.wAdd('ph-5x7'); A.w.wAdd('ph-5x7'); A.w.wAdd('ph-5x7'); L = lines(A);
  ok(val(A, L[3], 'q') === '3' && val(A, L[3], 'p') === '3.87', 'three 5x7 prints at $3.87');
  A.w.wAdd('custom'); L = lines(A);
  ok(L.length === 5 && val(A, L[4], 'd') === '' && val(A, L[4], 'p') === '0.00' && A.w.document.activeElement.id === L[4] + '-d', 'custom item: blank line, cursor in the description');
  A.set(L[4] + '-d', 'Laminate <b>menu</b>'); A.set(L[4] + '-p', '3'); A.w.wPrice(L[4]);
  A.w.wAdd('custom'); ok(lines(A).length === 6, 'a second custom item is its own line');
  A.w.wRemove(lines(A)[5]); ok(lines(A).length === 5, 'remove a line');

  // ---------- totals ----------
  // 10 x 1.20 + 60 x 1.80 + 5 x 0.55 + 3 x 3.87 + 1 x 3.00 = 12 + 108 + 2.75 + 11.61 + 3 = 137.36; HST 17.86; total 155.22
  ok(A.$('w-sub').textContent === '$137.36' && A.$('w-hst').textContent === '$17.86' && A.$('w-grand').textContent === '$155.22', 'totals: ' + [A.$('w-sub'), A.$('w-hst'), A.$('w-grand')].map(e => e.textContent).join(' / '));
  ok(A.$('w-count').textContent === '5 items' && A.$('w-lines-table').style.display === '', 'sale header counts 5 items');

  // ---------- receipt: print ----------
  A.set('cb-name', 'Riverfront Dental');
  A.w.wPrint();
  ok(A.prints.length === 1 && A.prints[0] === true, 'Print receipt prints with the receipt-only layout on');
  const rc = A.$('w-receipt');
  ok(/Coba Studios/.test(rc.querySelector('.r-biz b').textContent) && /Brockville/.test(rc.textContent), 'receipt top: Coba Studios, Brockville');
  ok(/Customer: Riverfront Dental/.test(rc.textContent) && /Receipt/.test(rc.textContent), 'customer name from the customer bar');
  ok(rc.querySelectorAll('table tr').length === 5 && /60 . \$1\.80/.test(rc.textContent) && /\$108\.00/.test(rc.textContent), 'one receipt row per line with qty x each');
  ok(/Laminate <b>menu<\/b>/.test(rc.textContent) && !rc.querySelector('td b'), 'typed text printed as text, never as markup');
  ok(/Subtotal\$137\.36/.test(rc.textContent.replace(/\s+/g, '')) && /Total\$155\.22/.test(rc.textContent.replace(/\s+/g, '')), 'receipt totals');
  A.w.dispatchEvent(new A.w.Event('afterprint'));
  ok(!A.w.document.body.classList.contains('w-printing'), 'receipt layout off after printing');
  A.w.document.body.classList.add('w-printing'); A.w.eval('wPrintAt = Date.now() - 60000');
  A.w.dispatchEvent(new A.w.Event('beforeprint'));
  ok(!A.w.document.body.classList.contains('w-printing'), 'a left-over receipt layout is never used by another print');
  const css = HTML.match(/body\.w-printing \.wrapper \{ display:none !important; \}/) && HTML.indexOf('<div id="w-receipt"></div>') > HTML.indexOf('</div><!-- /wrapper -->');
  ok(!!css, 'print CSS hides the page and the receipt sits outside it');

  ok(/HST # 822863999 RT0001/.test(rc.querySelector('.r-meta').textContent), 'v45: a fresh device prints the Coba Studios HST number');
  // ---------- receipt details ----------
  A.w.wDetailsOpen();
  ok(A.$('w-det-hst').value === '822863999 RT0001', 'Receipt details shows the built-in HST number');
  ok(A.$('w-details-wrap').style.display === 'flex' && /Coba Studios/.test(A.$('w-det-biz').value), 'Receipt details opens with the default top lines');
  A.set('w-det-hst', ' 123456789 RT0001 '); A.w.wDetailsClose(true);
  ok(JSON.parse(A.w.localStorage.getItem('coba-walkin-v1')).hst === '123456789 RT0001' && A.$('w-details-wrap').style.display === 'none', 'HST number saved on the device');
  A.w.wPrint();
  ok(/HST # 123456789 RT0001/.test(A.$('w-receipt').textContent), 'HST number on the receipt');

  // ---------- receipt: copy ----------
  let copied = null;
  Object.defineProperty(A.w.navigator, 'clipboard', { configurable: true, value: { writeText: t => { copied = t; return Promise.resolve(); } } });
  A.w.wCopy(); await sleep(20);
  ok(copied && /^Coba Studios/.test(copied) && /HST # 123456789 RT0001/.test(copied) && /Total +\$155\.22/.test(copied) && /60 x \$1\.80 +\$108\.00/.test(copied), 'Copy receipt puts a plain-text receipt on the clipboard');
  ok(/[^\x00-\x7F]/.test(copied) === false, 'copied receipt is plain ASCII');
  Object.defineProperty(A.w.navigator, 'clipboard', { configurable: true, value: undefined });
  let execd = false; A.w.document.execCommand = cmd => { execd = cmd === 'copy'; return true; };
  A.w.wCopy();
  ok(execd && /copied/.test(A.$('jobs-toast').textContent), 'no clipboard API: falls back to copy command');

  // ---------- save the sale as a job, start a new sale, reopen it ----------
  const quote = A.$('w-grand').textContent;
  A.set('cb-title', 'Counter copies');
  A.w.saveEstimate(); await sleep(20);
  const cust = A.w.eval('jobsData').customers.find(c => c.name === 'Riverfront Dental');
  const est = cust && cust.estimates[0];
  ok(est && est.tab === 'walkin' && est.totals.grand === quote, 'Save estimate keeps the sale under the customer (' + (est && est.totals.grand) + ')');
  A.w.resetWalkin(); A.w.cobaConfirmAnswer(true);
  ok(lines(A).length === 0 && A.$('w-grand').textContent === '$0.00' && A.$('w-empty').style.display === '', 'New sale clears it');
  A.w.wPrint();
  ok(A.prints.length === 2, 'an empty sale does not print');
  A.w.loadEstimate(cust.id, est.id, false); A.w.cobaConfirmAnswer(true);
  L = lines(A);
  ok(A.w.eval('currentTab') === 'walkin' && L.length === 5 && A.$('w-grand').textContent === quote, 'Load reopens the sale at its prices (' + A.$('w-grand').textContent + ')');
  ok(val(A, L[2], 'p') === '0.55' && val(A, L[2], 'm') === '1' && val(A, L[4], 'd') === 'Laminate <b>menu</b>', 'typed prices and custom text come back');
  typeQty(A, L[2], 300); ok(val(A, L[2], 'p') === '0.55', 'a reopened typed price is still kept');
  typeQty(A, L[0], 60); ok(val(A, L[0], 'p') === '0.90', 'a reopened menu line still re-prices by quantity');
  A.w.wAdd('ph-5x7'); ok(lines(A).length === 5 && val(A, L[3], 'q') === '4', 'tapping an item already on a reopened sale adds one more');
  ok(A.w.document.querySelectorAll('#w-copy-body .w-pbtn').length === 12, 'menu rebuilt after reopening');

  // ---------- phone width: one row of tabs ----------
  ok(/@media \(max-width:680px\)\{\s*\.tab-bar \{ overflow-x:auto;/.test(HTML), 'phone tab bar scrolls sideways');

  ok(A.errs.length === 0, 'page errors: ' + A.errs.slice(0, 3).join(' | '));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
