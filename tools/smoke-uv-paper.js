#!/usr/bin/env node
// Smoke test for UV Printing > Coasters (v34, saved prices kept through refreshes since v36) and the Paper tab
// calendar / brochure references (v35).
//   NODE_PATH=/path/to/node_modules node tools/smoke-uv-paper.js [index.html]
// Needs jsdom. Every expected price is worked out here straight from the JSON block id="market-print" (no numbers
// typed in), so the test keeps passing after a price refresh. Checks the all-in coaster rules (no job setup fee for
// coasters), totals, save / reopen through Jobs, a saved coaster quote surviving a price refresh, and no page errors.
// Plain ASCII.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(SRC, 'utf8');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = t => parseFloat(String(t).replace(/[^0-9.\-]/g, ''));
const near = (a, b) => Math.abs(a - b) < 0.006;

const m = HTML.match(/<script type="application\/json" id="market-print">([\s\S]*?)<\/script>/);
let DATA = null;
try { DATA = JSON.parse(m[1]); ok(true); } catch (e) { ok(false, 'market-print JSON missing or invalid'); }
ok(DATA && !/[^\x00-\x7F]/.test(m[1]), 'market-print data is plain ASCII');
const seller = id => DATA.sellers.find(s => s.id === id);
// VistaPrint cost for q pieces = cheapest way to get at least q: q at the unit price of the highest break
// at or below q, or the total of the lowest break above q. col 1 = list price, col 2 = sale price.
const vpInfo = (ladder, q, col) => {
  col = col || 1; const P = r => (r[col] != null ? r[col] : r[1]);
  const lower = ladder.filter(r => r[0] <= q), upper = ladder.filter(r => r[0] > q);
  const lo = lower[lower.length - 1], hi = upper[0];
  const a = lo ? q * P(lo) / lo[0] : Infinity, b = hi ? P(hi) : Infinity;
  return a <= b ? { total: a, tier: lo[0], next: false, lo: !!lo } : { total: b, tier: hi[0], next: true, lo: !!lo };
};
const vpCost = (ladder, q, col) => vpInfo(ladder, q, col).total;
const tier = (ladder, q, col) => vpCost(ladder, q, col) / q;   // each
const lastQty = ladder => ladder[ladder.length - 1][0];
// what the Paper reference line must say for q pieces (prices as pfmt shows them: $ and 2 decimals, no commas)
const refLine = (ladder, q) => {
  const t = vpInfo(ladder, q), parts = ['$' + (t.total / q).toFixed(2) + ' each', '$' + t.total.toFixed(2) + ' for ' + q];
  if (ladder.length === 1 && ladder[0][0] === 1) { parts.push('same price each at any quantity'); return parts; }   // per-piece (Staples cards)
  if (t.tier !== q && !t.next) parts.push('their price break at ' + t.tier);
  if (t.next) parts.push((t.lo ? 'cheaper to buy their ' : 'their minimum is ') + t.tier + ' for $' + t.total.toFixed(2));
  return parts;
};
const hasAll = (html, parts) => parts.every(p => html.indexOf(p) >= 0);
const missing = (html, parts) => parts.filter(p => html.indexOf(p) < 0).join(' / ');

function openWin(ls, html) {
  const errs = [];
  const dom = new JSDOM(html || HTML, {
    runScripts: 'dangerously', url: 'https://crepracon.github.io/Cobastudios/', pretendToBeVisual: true,
    beforeParse(w) {
      Object.keys(ls || {}).forEach(k => w.localStorage.setItem(k, ls[k]));
      w.addEventListener('error', e => errs.push(String(e.message)));
      w.console.error = function () { const s = Array.prototype.map.call(arguments, String).join(' '); if (!/cloud init failed/.test(s)) errs.push(s); };
      w.console.warn = function () {}; w.scrollTo = () => {}; w.print = () => {};
    }
  });
  const w = dom.window;
  return { w, errs, $: id => w.document.getElementById(id), set: (id, v) => { w.document.getElementById(id).value = v; }, chk: (id, v) => { w.document.getElementById(id).checked = v; } };
}

(async () => {
  const cer = seller('vp-coaster-ceramic').sizes[0].ladder, cerMin = cer[0][0], cerLast = lastQty(cer);
  const A = openWin(); await sleep(40);
  A.w.switchTabByName('uv');
  const baseQuote = money(A.$('u-tt-quote').textContent);

  // ---------- coasters: market mode ----------
  A.chk('uc-on', true); A.w.ucToggle();
  ok(A.$('uc-section').style.display === '' && A.w.eval('ucRows.length') === 1, 'Coasters switch shows the section with one row');
  const cases = [1, 2, 10, 20, 30, 100, cerLast, cerLast + 100];
  cases.forEach(q => {
    A.set('uc0-q', q); A.set('uc0-b', 1.25); A.w.uCalc();
    const vp = tier(cer, q);
    ok(near(money(A.$('uc0-vp').textContent), Math.round(vp * 100) / 100), 'VistaPrint each at ' + q + ': ' + A.$('uc0-vp').textContent + ' vs ' + vp.toFixed(4));
    ok(near(money(A.$('uc0-pe').textContent), Math.round(vp * 100) / 100), 'match price each at ' + q);
    ok(near(money(A.$('uc0-rt').textContent), q * Math.round(vp * 100) / 100), 'retail total at ' + q);
  });
  A.set('uc0-q', 20); A.w.uCalc();
  ok(/minimum is/.test(A.$('uc0-vp').title) === false && /over \d+/.test(A.$('uc0-vp').title) === false, 'no tier notes at an ordinary quantity');
  if (cerMin > 1) {
    A.set('uc0-q', 1); A.w.uCalc();
    ok(new RegExp('minimum is ' + cerMin + ' ').test(A.$('uc0-vp').title), 'qty 1 notes the VistaPrint minimum of ' + cerMin);
  }
  A.set('uc0-q', cerLast + 100); A.w.uCalc();
  ok(new RegExp('over ' + cerLast).test(A.$('uc0-vp').title), 'qty over ' + cerLast + ' noted');
  A.set('uc0-q', 20); A.set('uc-pct', 90); A.w.uCalc();
  ok(near(money(A.$('uc0-pe').textContent), Math.round(tier(cer, 20) * 0.9 * 100) / 100), '90% of VistaPrint');
  A.set('uc-mode', 'each'); A.set('uc-each', 8); A.w.uCalc();
  ok(near(money(A.$('uc0-pe').textContent), 8) && A.$('uc-each-wrap').style.display === '' && A.$('uc-pct-wrap').style.display === 'none', 'my price per coaster mode');
  A.set('uc-mode', 'market'); A.set('uc-pct', 100); A.w.uCalc();

  // ---------- coasters only: no setup fee, cost includes mat + shop labour ----------
  A.set('u0-q', ''); A.w.uCalc();   // no UV item rows priced
  const q20 = 20, vp20 = Math.round(tier(cer, 20) * 100) / 100;
  ok(near(money(A.$('u-tt-quote').textContent), q20 * vp20), 'coasters-only quote = coasters retail (no setup fee): ' + A.$('u-tt-quote').textContent);
  ok(A.$('u-setup').textContent.indexOf('+') < 0, 'setup fee not applied to a coasters-only job');
  const cCost = money(A.$('uc-cost').textContent), ttCost = money(A.$('u-tt-cost').textContent);
  ok(cCost > 20 * 1.25 && near(cCost, ttCost), 'coaster cost includes tiles, mat and shop labour and equals the job cost');
  ok(/Market check/.test(A.$('uc-market-bar').innerHTML) && /Compete/.test(A.$('uc-market-bar').innerHTML), 'market check with compete guidance');
  ok(!/kept from when this was quoted/.test(A.$('uc-market-bar').innerHTML), 'no kept-price note on a fresh quote');
  A.set('uc0-b', ''); A.w.uCalc();
  ok(/enter your tile cost/.test(A.$('uc-market-bar').innerHTML) && A.$('uc0-co').style.color !== '', 'missing tile cost flagged');
  A.set('uc0-b', 1.25); A.w.uCalc();

  // ---------- items + coasters: one setup fee (items), labour shared ----------
  A.set('u0-w', 3); A.set('u0-h', 1); A.set('u0-q', 10); A.set('u0-b', 0.5); A.w.uCalc();
  const itemsRetail = money(A.$('u-retail').textContent), setupFee = money(A.$('u-setup-fee').value);
  ok(near(money(A.$('u-tt-quote').textContent), itemsRetail + setupFee + q20 * vp20), 'items + setup + coasters = quote');
  // switching coasters off gives back the items-only numbers
  A.chk('uc-on', false); A.w.ucToggle();
  const itemsOnly = A.$('u-tt-quote').textContent + '|' + A.$('u-tt-cost').textContent;
  const B = openWin(); await sleep(40); B.w.switchTabByName('uv');
  B.set('u0-w', 3); B.set('u0-h', 1); B.set('u0-q', 10); B.set('u0-b', 0.5); B.w.uCalc();
  ok(itemsOnly === B.$('u-tt-quote').textContent + '|' + B.$('u-tt-cost').textContent, 'coasters off = same as a job without coasters');
  A.chk('uc-on', true); A.w.ucToggle();

  // ---------- save and reopen a UV job with coasters ----------
  A.w.ucAddRow(); A.set('uc1-sh', 'round'); A.set('uc1-q', 8); A.set('uc1-b', 1.4); A.w.uCalc();
  const before = A.$('u-tt-quote').textContent + '|' + A.$('u-tt-cost').textContent;
  A.set('cb-name', 'Coaster Cust'); A.set('cb-title', 'coasters + tags'); A.w.saveEstimate(); await sleep(20);
  const jobs = A.w.localStorage.getItem('coba-jobs-v1');
  const R = openWin({ 'coba-jobs-v1': jobs }); await sleep(40);
  const c = R.w.eval('jobsData.customers[0]');
  R.w.loadEstimate(c.id, c.estimates[0].id, false); R.w.cobaConfirmAnswer(true);
  ok(R.$('u-tt-quote').textContent + '|' + R.$('u-tt-cost').textContent === before, 'UV job with coasters reopens at the same quote and cost');
  ok(R.w.eval('ucRows.length') === 2 && R.$('uc1-sh').value === 'round' && R.$('uc-on').checked, 'coaster rows and switch restored');
  R.w.ucAddRow();
  ok(R.w.eval('ucRows.length') === 3 && !!R.$('uc2-q') && !!R.$('uc2-mb') && !!R.$('uc2-ms'), 'adding a coaster row after reopening continues the ids');
  R.w.resetUV(); R.w.cobaConfirmAnswer(true);
  ok(R.w.eval('ucRows.length') === 0 && !R.$('uc-on').checked && R.$('uc-section').style.display === 'none', 'New estimate clears the coasters');
  ok(near(money(R.$('u-tt-quote').textContent), baseQuote), 'New estimate is back to an empty UV job');

  // ---------- v36: a saved coaster quote keeps its VistaPrint price through a price refresh ----------
  // window K quotes and saves; window F runs a copy of the page whose ceramic coaster prices all went up 20%
  const bumped = JSON.parse(JSON.stringify(DATA));
  bumped.sellers.find(s => s.id === 'vp-coaster-ceramic').sizes.forEach(z => z.ladder.forEach(r => { r[1] = Math.round(r[1] * 120) / 100; }));
  const cer2 = bumped.sellers.find(s => s.id === 'vp-coaster-ceramic').sizes[0].ladder;
  const HTML2 = HTML.replace(m[0], () => '<script type="application/json" id="market-print">' + JSON.stringify(bumped) + '</script>');
  ok(HTML2 !== HTML, 'refreshed copy of the page built');
  const K = openWin(); await sleep(40); K.w.switchTabByName('uv');
  K.set('u0-q', ''); K.chk('uc-on', true); K.w.ucToggle();
  K.set('uc0-q', 20); K.set('uc0-b', 1.25); K.w.uCalc();
  ok(K.$('uc0-ms').value === '20' && Math.abs(parseFloat(K.$('uc0-mb').value) - tier(cer, 20)) < 1e-9, 'coaster row stores the VistaPrint price it was quoted at: ' + K.$('uc0-mb').value);
  const quoteK = K.$('u-tt-quote').textContent;
  K.set('cb-name', 'Keep Cust'); K.set('cb-title', 'coasters kept'); K.w.saveEstimate(); await sleep(20);
  // the same job saved the way v34 / v35 saved it (no hidden price fields)
  K.w.document.getElementById('uc0-mb').remove(); K.w.document.getElementById('uc0-ms').remove();
  K.set('cb-title', 'coasters pre-v36'); K.w.eval('jobsActive = null'); K.w.saveEstimate(); await sleep(20);
  const kj = JSON.parse(K.w.localStorage.getItem('coba-jobs-v1')).customers[0].estimates;
  ok(kj.length === 2 && kj.find(e => e.title === 'coasters pre-v36').snap.html.indexOf('uc0-mb') < 0, 'old-style save has no hidden price fields');
  const F = openWin({ 'coba-jobs-v1': K.w.localStorage.getItem('coba-jobs-v1') }, HTML2); await sleep(40);
  const fc = F.w.eval('jobsData.customers[0]'), fBy = t => fc.estimates.find(e => e.title === t).id;
  F.w.loadEstimate(fc.id, fBy('coasters kept'), false); F.w.cobaConfirmAnswer(true);
  ok(F.$('u-tt-quote').textContent === quoteK, 'saved coaster quote reopens at its price after a VistaPrint refresh: ' + F.$('u-tt-quote').textContent + ' vs ' + quoteK);
  ok(/kept from when this was quoted/.test(F.$('uc0-vp').title) && /kept from when this was quoted/.test(F.$('uc-market-bar').innerHTML), 'kept price is flagged in the row and the market check');
  ok(F.$('uc0-vp').title.indexOf('latest: $' + tier(cer2, 20).toFixed(2)) >= 0, 'the latest VistaPrint price is shown alongside');
  F.w.loadEstimate(fc.id, fBy('coasters pre-v36'), false); F.w.cobaConfirmAnswer(true);
  ok(F.$('u-tt-quote').textContent === quoteK && !!F.$('uc0-mb') && F.$('uc0-ms').value === '20', 'coaster job saved before v36 keeps its price too (from the price it showed): ' + F.$('u-tt-quote').textContent);
  F.set('uc0-q', 40); F.w.uCalc();
  ok(near(money(F.$('uc0-pe').textContent), Math.round(tier(cer2, 40) * 100) / 100) && !/kept/.test(F.$('uc0-vp').title), 'changing the quantity re-prices from the latest data');
  F.set('uc0-q', 20); F.w.uCalc();
  ok(near(money(F.$('uc0-pe').textContent), Math.round(tier(cer2, 20) * 100) / 100) && !/kept/.test(F.$('uc-market-bar').innerHTML), 'back to 20 after an edit also uses the latest price (like stickers)');
  F.w.resetUV(); F.w.cobaConfirmAnswer(true);
  F.chk('uc-on', true); F.w.ucToggle(); F.set('uc0-q', 20); F.w.uCalc();
  ok(near(money(F.$('uc0-pe').textContent), Math.round(tier(cer2, 20) * 100) / 100), 'a new quote after the refresh uses the new prices');

  // ---------- Paper > Calendar / Brochure references (v35) ----------
  const P = openWin(); await sleep(40);
  const calSel = P.$('p-cal-type'), calOpts = Array.from(calSel.options).map(o => o.textContent);
  const calCount = DATA.sellers.filter(s => s.product === 'calendar' && ['wall', 'desk', 'poster', 'magnetic', 'bookmark'].indexOf(s.type) >= 0).reduce((n, s) => n + s.sizes.length, 0);
  ok(calOpts.length === calCount && calCount === 10, 'calendar types listed: ' + calOpts.length + ' of ' + calCount);
  ok(/^Wall, Classic, middle binding - 8\.5 x 11 in, opens to 17 x 11 in$/.test(calOpts[calSel.selectedIndex]), 'default calendar: ' + calOpts[calSel.selectedIndex]);
  ok(!P.$('p-cal-on').checked && P.$('p-cal-body').style.display === 'none', 'calendar reference off by default');
  ok(P.$('p-cal-box').classList.contains('no-print') && P.$('p-bro-box').classList.contains('no-print'), 'references never print on the customer quote');
  P.set('p-qty', 30); P.set('p-finished-qty', 30);
  P.set('pp-n0', 14); P.set('pp-c0', 0.19); P.set('pt-n0', 26); P.set('pt-c0', 0.06); P.set('p-hrs', 1);
  P.w.pCalc();
  const quote0 = P.$('p-quote-total').textContent + '|' + P.$('p-grand').textContent + '|' + P.$('p-yourcost').textContent;
  P.chk('p-cal-on', true); P.w.pRefToggle('cal');
  ok(P.$('p-quote-total').textContent + '|' + P.$('p-grand').textContent + '|' + P.$('p-yourcost').textContent === quote0, 'turning a reference on never changes the quote');
  const wall = seller('vp-cal-wall').sizes[3].ladder;
  let out = P.$('p-cal-out').innerHTML;
  ok(hasAll(out, refLine(wall, 30)), 'wall calendar at 30: list price each and total (missing: ' + missing(out, refLine(wall, 30)) + ')');
  const saleEach = wall[0].length > 2 ? tier(wall, 30, 2) : null;
  if (saleEach != null && saleEach < tier(wall, 30) - 0.005) ok(out.indexOf('on sale when captured: $' + saleEach.toFixed(2) + ' each') >= 0, 'sale price at capture shown');
  else ok(!/on sale when captured/.test(out), 'no sale note when no sale was captured');
  const q30 = money(P.$('p-quote-total').textContent);
  ok(out.indexOf('$' + (q30 / 30).toFixed(2) + ' each (') >= 0, 'your price per calendar = quote / finished pieces');
  ok(/Defend/.test(out), 'calendars default to Defend guidance');
  ok(out.indexOf('VistaPrint prices captured ' + (seller('vp-cal-wall').captured || DATA.captured)) >= 0, 'capture date shown (the product\'s own, v46)');
  P.set('p-finished-qty', 50); P.w.pCalc(); out = P.$('p-cal-out').innerHTML;
  ok(hasAll(out, refLine(wall, 50)), 'wall calendar at 50, between or on breaks (missing: ' + missing(out, refLine(wall, 50)) + ')');
  P.set('p-finished-qty', 1); P.w.pCalc(); out = P.$('p-cal-out').innerHTML;
  ok(/set Finished pieces to the number of calendars/.test(out), 'hint when Finished pieces is 1 but press sets are more');
  P.set('p-finished-qty', 100);
  calSel.value = Array.from(calSel.options).find(o => /^Desk, Square/.test(o.textContent)).value; P.w.pCalc();
  ok(hasAll(P.$('p-cal-out').innerHTML, refLine(seller('vp-cal-desk').sizes[1].ladder, 100)), 'desk square calendar at 100');
  const poster = seller('vp-cal-poster').sizes[0].ladder, pLast = lastQty(poster);
  P.set('p-finished-qty', pLast + 100);
  calSel.value = Array.from(calSel.options).find(o => /^Poster/.test(o.textContent)).value; P.w.pCalc();
  ok(new RegExp('over ' + pLast + ' they quote larger runs').test(P.$('p-cal-out').innerHTML), 'poster calendar over their ' + pLast + ' maximum noted');

  // brochures
  P.set('p-finished-qty', 250); P.w.pCalc();
  P.chk('p-bro-on', true); P.w.pRefToggle('bro');
  ok(P.$('p-bro-size').value === '8.5x11 flat' && P.$('p-bro-stock').value === 'glossy', 'brochure defaults: tri-fold 8.5x11 glossy');
  out = P.$('p-bro-out').innerHTML;
  const tg = s => seller('vp-bro-tri-' + s).sizes[0].ladder;
  ok(hasAll(out, refLine(tg('glossy'), 250)), 'tri-fold 8.5x11 glossy at 250 (missing: ' + missing(out, refLine(tg('glossy'), 250)) + ')');
  ok(['matte', 'uncoated', 'recycled'].every(x => out.indexOf(x + ' $' + tier(tg(x), 250).toFixed(2)) >= 0), 'other papers at the same quantity');
  ok(/Compete/.test(out), 'brochures default to Compete guidance');
  P.set('p-finished-qty', 10); P.w.pCalc(); out = P.$('p-bro-out').innerHTML;
  ok(hasAll(out, refLine(tg('glossy'), 10)), '10 brochures: the cheapest way to get 10 (missing: ' + missing(out, refLine(tg('glossy'), 10)) + ')');
  ok(vpInfo(tg('glossy'), 10).next === false || /cheaper to buy their|their minimum is/.test(out), 'buying a bigger pack is pointed out');
  P.set('p-bro-stock', 'recycled'); P.w.pCalc();
  ok(hasAll(P.$('p-bro-out').innerHTML, refLine(tg('recycled'), 10)), 'recycled at 10 (minimum ' + tg('recycled')[0][0] + ')');
  P.set('p-bro-fold', 'bi'); P.w.pRefSizes(); P.w.pCalc();
  ok(Array.from(P.$('p-bro-size').options).map(o => o.value).join(',') === seller('vp-bro-bi-glossy').sizes.map(z => z.label).join(',') && P.$('p-bro-size').value === '8.5x11 flat', 'bi-fold sizes, keeps 8.5x11');
  P.set('p-bro-fold', 'z'); P.w.pRefSizes(); P.w.pCalc();
  ok(P.$('p-bro-size').options.length === seller('vp-bro-z-glossy').sizes.length, 'Z-fold sizes');
  P.set('p-bro-fold', 'tri'); P.w.pRefSizes(); P.set('p-bro-stock', 'glossy'); P.set('p-finished-qty', 30); P.w.pCalc();
  calSel.value = Array.from(calSel.options).find(o => /^Wall, Classic, middle/.test(o.textContent)).value; P.w.pCalc();

  // saved with the references on -> reopens the same; old jobs without the boxes get them back
  P.set('cb-name', 'Cal Cust'); P.set('cb-title', '30 calendars'); P.w.saveEstimate(); await sleep(20);
  const quoteSaved = P.$('p-quote-total').textContent;
  P.w.document.getElementById('p-cal-box').remove(); P.w.document.getElementById('p-bro-box').remove();
  P.set('cb-title', 'old style job'); P.w.eval('jobsActive = null'); P.w.saveEstimate(); await sleep(20);
  const Q = openWin({ 'coba-jobs-v1': P.w.localStorage.getItem('coba-jobs-v1') }); await sleep(40);
  const cc = Q.w.eval('jobsData.customers[0]'), byTitle = t => cc.estimates.find(e => e.title === t).id;
  Q.w.loadEstimate(cc.id, byTitle('30 calendars'), false); Q.w.cobaConfirmAnswer(true);
  ok(Q.$('p-quote-total').textContent === quoteSaved && Q.$('p-cal-on').checked && Q.$('p-bro-on').checked && hasAll(Q.$('p-cal-out').innerHTML, refLine(wall, 30)), 'paper job reopens with its references');
  Q.w.loadEstimate(cc.id, byTitle('old style job'), false); Q.w.cobaConfirmAnswer(true);
  ok(Q.$('p-quote-total').textContent === quoteSaved && !!Q.$('p-cal-box') && Q.$('p-cal-type').options.length === calCount && !Q.$('p-cal-on').checked, 'old paper job reopens at its price with the reference boxes put back');
  Q.w.resetPaper(); Q.w.cobaConfirmAnswer(true);
  ok(!Q.$('p-cal-on').checked && Q.$('p-cal-body').style.display === 'none', 'New estimate switches the references off');

  // ---------- v46: Paper > Postcards, flyers, cards & posters (VistaPrint first, Staples Canada second) ----------
  const G = openWin(); await sleep(40);
  const pgOut = () => G.$('p-pg-out').innerHTML;
  const lad = (id, label) => { const s = seller(id); const z = s && s.sizes.find(x => x.label === label); return z ? z.ladder : null; };
  ok(G.$('p-pg-box') && G.$('p-pg-box').classList.contains('no-print') && !G.$('p-pg-on').checked && G.$('p-pg-body').style.display === 'none', 'new reference box present, off by default, never prints');
  ['vp-pc-glossy', 'vp-fly-matte', 'vp-rack-uncoated', 'vp-note-flat', 'vp-note-folded', 'vp-poster-pmatte', 'stp-pc-1', 'stp-pc-2', 'stp-fly-1', 'stp-rack-2', 'stp-folded-1', 'stp-encl-1'].forEach(id => ok(!!seller(id), 'price data has ' + id));
  G.set('p-qty', 100); G.set('p-finished-qty', 100);
  G.set('pp-n0', 25); G.set('pp-c0', 0.234); G.set('pt-n0', 100); G.set('pt-c0', 0.06); G.set('p-hrs', 0.25);
  G.w.pCalc();
  const gq0 = G.$('p-quote-total').textContent + '|' + G.$('p-grand').textContent;
  G.chk('p-pg-on', true); G.w.pRefToggle('pg');
  ok(G.$('p-quote-total').textContent + '|' + G.$('p-grand').textContent === gq0, 'turning it on never changes the quote');
  ok(G.$('p-pg-prod').value === 'postcard' && G.$('p-pg-size').value === '4 x 6' && G.$('p-pg-stock').value === 'glossy' && G.$('p-pg-sides').value === '1', 'defaults: postcard 4 x 6 glossy 1-sided');
  const pcSizes = Array.from(G.$('p-pg-size').options).map(o => o.value);
  ok(['4.2 x 5.5', '4 x 6', '5 x 7', '5.5 x 8.5', '6 x 9', '6 x 11'].every(s => pcSizes.indexOf(s) >= 0), 'postcard sizes include 4.2 x 5.5, 4 x 6, 5 x 7, 5.5 x 8.5, 6 x 9, 6 x 11: ' + pcSizes.join(', '));
  let gout = pgOut();
  ok(hasAll(gout, refLine(lad('vp-pc-glossy', '4 x 6'), 100)), 'VistaPrint 4 x 6 glossy at 100: ' + missing(gout, refLine(lad('vp-pc-glossy', '4 x 6'), 100)));
  ok(hasAll(gout, refLine(lad('stp-pc-1', '4 x 6'), 100)) && /Staples Canada<\/strong> \(4 x 6 in, 1-sided\)/.test(gout), 'Staples 4 x 6 1-sided at 100');
  const gq = money(G.$('p-quote-total').textContent);
  ok(gout.indexOf('$' + (gq / 100).toFixed(2) + ' each (') >= 0 && /% vs VistaPrint\)/.test(gout), 'your price each compared with VistaPrint for 1-sided work');
  ok(/Other VistaPrint papers at this quantity: matte \$/.test(gout) && /Compete/.test(gout), 'other papers listed; postcards default to Compete');
  // 2-sided: VistaPrint is front only, so compare with Staples
  G.set('p-pg-sides', '2'); G.w.pCalc(); gout = pgOut();
  ok(/prints the front only at this price/.test(gout) && hasAll(gout, refLine(lad('stp-pc-2', '4 x 6'), 100)) && /% vs Staples\)/.test(gout), '2-sided: front-only warning, Staples 2-sided price, compared with Staples');
  G.set('p-pg-sides', '1');
  // between quantities: 30 postcards = VistaPrint 30 at the 25 break, or their 50
  G.set('p-finished-qty', 30); G.w.pCalc();
  ok(hasAll(pgOut(), refLine(lad('vp-pc-glossy', '4 x 6'), 30)) && hasAll(pgOut(), refLine(lad('stp-pc-1', '4 x 6'), 30)), '30 postcards priced like VistaPrint and Staples sell them');
  G.set('p-finished-qty', 100);
  // 6 x 11 is not sold in recycled
  G.set('p-pg-size', '6 x 11'); G.set('p-pg-stock', 'recycled'); G.w.pCalc();
  ok(/VistaPrint<\/strong>: not sold in this size in recycled/.test(pgOut()), '6 x 11 recycled: not offered');
  // rack cards: VistaPrint 3.74 x 8.27 and Staples 3.5 x 8.5 are the same product size
  G.set('p-pg-prod', 'rack'); G.w.pPgOptions(); G.w.pCalc(); gout = pgOut();
  ok(G.$('p-pg-size').options.length === 1 && /3\.74 x 8\.27 in \(Staples 3\.5 x 8\.5\)/.test(G.$('p-pg-size').options[0].textContent), 'rack card size lists the Staples 3.5 x 8.5 beside it');
  ok(hasAll(gout, refLine(lad('vp-rack-glossy', '3.74 x 8.27'), 100)) && /3\.5 x 8\.5 in, closest size, 1-sided/.test(gout) && hasAll(gout, refLine(lad('stp-rack-1', '3.5 x 8.5'), 100)), 'rack cards: both sellers at 100');
  // flyers / prints on paper
  G.set('p-pg-prod', 'flyer'); G.w.pPgOptions();
  ok(G.$('p-pg-size').value === '8.5 x 11' && G.$('p-pg-stock').value === 'glossy', 'flyers default to 8.5 x 11');
  G.set('p-pg-size', '11 x 17'); G.set('p-pg-stock', 'matte'); G.set('p-finished-qty', 250); G.w.pCalc(); gout = pgOut();
  ok(hasAll(gout, refLine(lad('vp-fly-matte', '11 x 17'), 250)) && hasAll(gout, refLine(lad('stp-fly-1', '11 x 17'), 250)), '11 x 17 flyers at 250: VistaPrint and Staples');
  // posters: VistaPrint poster stock, no Staples poster at 8.5 x 11
  G.set('p-pg-prod', 'poster'); G.w.pPgOptions(); G.set('p-finished-qty', 5); G.w.pCalc(); gout = pgOut();
  ok(G.$('p-pg-size').value === '8.5 x 11' && hasAll(gout, refLine(lad('vp-poster-pmatte', '8.5 x 11'), 5)) && !/Staples Canada/.test(gout.split('<div')[0]) && /Defend/.test(gout), 'posters: VistaPrint premium matte 8.5 x 11 at 5, no Staples line, Defend');
  // folded greeting cards: VistaPrint folds 4 x 5.5 only; Staples sells 5 x 7 folded (with a sale on)
  G.set('p-pg-prod', 'folded'); G.w.pPgOptions(); G.set('p-finished-qty', 25); G.w.pCalc(); gout = pgOut();
  const fz = Array.from(G.$('p-pg-size').options).map(o => o.textContent);
  ok(G.$('p-pg-stock-wrap').style.display === 'none' && fz.some(t => /^4 x 5\.5 in$/.test(t)) && fz.some(t => /^5 x 7 in - Staples only$/.test(t)) && G.$('p-pg-size').value === '5 x 7', 'folded sizes: 4 x 5.5 (VistaPrint) and 5 x 7 (Staples only); paper choice hidden');
  ok(/their folded cards are 4 x 5\.5 only/.test(gout) && hasAll(gout, refLine(lad('stp-folded-1', '5 x 7'), 25)) && /on sale when captured: \$1\.25 each/.test(gout) && /% vs Staples\)/.test(gout), 'folded 5 x 7: Staples price (sale noted), compared with Staples');
  ok(!/price break at 1|over 1 they quote/.test(gout) && /Staples: Same price per card at any quantity/.test(gout) && !/Rows are/.test(gout), 'per-card Staples price: no price-break notes, plain-language note');
  G.set('p-pg-size', '4 x 5.5'); G.w.pCalc();
  ok(hasAll(pgOut(), refLine(lad('vp-note-folded', '4 x 5.5'), 25)), 'folded 4 x 5.5: VistaPrint note card price');
  // v46 fix: a Defend job under the market low says so (it used to say "no need to chase them down to $low")
  const dUnder = G.w.stratAdvice('defend', 1.33, 0.63, 2.09, 2.09), dOver = G.w.stratAdvice('defend', 2.50, 0.63, 2.09, 2.09);
  ok(/under the market low \(\$2\.09\)/.test(dUnder) && /room to charge more/.test(dUnder) && !/chase/.test(dUnder) && /at or above market/.test(dOver), 'Defend advice: under the market low says there is room to charge more');
  // flat note cards: VistaPrint 4 x 5.5 and the Staples 4.25 x 5.5 enclosure card
  G.set('p-pg-prod', 'flat'); G.w.pPgOptions(); G.set('p-pg-size', '4 x 5.5'); G.w.pCalc(); gout = pgOut();
  ok(hasAll(gout, refLine(lad('vp-note-flat', '4 x 5.5'), 25)) && /4\.25 x 5\.5 in, closest size, 1-sided/.test(gout), 'flat 4 x 5.5: VistaPrint and the Staples 4.25 x 5.5 card');
  ok(!/\$2\.00 each/.test(gout.split('<br>')[0]), 'the VistaPrint single sample card is not used as an order price');
  // save with the box on, reopen; a job saved before v46 gets the box back, switched off
  G.set('cb-name', 'Card Cust'); G.set('cb-title', '25 note cards'); G.w.saveEstimate(); await sleep(20);
  const gSavedOut = pgOut(), gSavedQuote = G.$('p-quote-total').textContent;
  G.w.document.getElementById('p-pg-box').remove();
  G.set('cb-title', 'pre-v46 job'); G.w.eval('jobsActive = null'); G.w.saveEstimate(); await sleep(20);
  const H = openWin({ 'coba-jobs-v1': G.w.localStorage.getItem('coba-jobs-v1') }); await sleep(40);
  const hc = H.w.eval('jobsData.customers[0]'), hId = t => hc.estimates.find(e => e.title === t).id;
  H.w.loadEstimate(hc.id, hId('25 note cards'), false); H.w.cobaConfirmAnswer(true);
  ok(H.$('p-quote-total').textContent === gSavedQuote && H.$('p-pg-on').checked && H.$('p-pg-prod').value === 'flat' && H.$('p-pg-out').innerHTML === gSavedOut, 'job reopens with the box as it was');
  H.w.loadEstimate(hc.id, hId('pre-v46 job'), false); H.w.cobaConfirmAnswer(true);
  ok(H.$('p-quote-total').textContent === gSavedQuote && !!H.$('p-pg-box') && !H.$('p-pg-on').checked && H.$('p-pg-size').options.length > 0, 'a job saved before v46 reopens at its price with the new box put back, off');
  ok(H.$('p-pg-box').previousElementSibling && H.$('p-pg-box').previousElementSibling.id === 'p-bro-box', 'put back right after the brochure box');
  H.chk('p-pg-on', true); H.w.pRefToggle('pg'); H.w.resetPaper(); H.w.cobaConfirmAnswer(true);
  ok(!H.$('p-pg-on').checked && H.$('p-pg-body').style.display === 'none', 'New estimate switches it off');
  // the old Market check: postcards and colour flyers moved to the new box; plan rows at Staples Canada's range
  const jt = Array.from(H.$('p-job-type').options);
  ok(!jt.some(o => o.value === 'postcards' || o.value === 'colour-flyers'), 'old Market check no longer lists postcards or colour flyers');
  const p24 = jt.find(o => o.value === 'plan-bw-24x36'), p36 = jt.find(o => o.value === 'plan-bw-36x48');
  ok(p24 && p24.dataset.low === '4.39' && p24.dataset.high === '6.79' && p36 && p36.dataset.low === '8.69' && p36.dataset.high === '13.49', 'plan rows at Staples 2-4 day to 1-hour');

  [A, B, R, K, F, P, Q, G, H].forEach((x, i) => ok(x.errs.length === 0, 'page errors in window ' + i + ': ' + x.errs.slice(0, 3).join(' | ')));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
