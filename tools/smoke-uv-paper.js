#!/usr/bin/env node
// Smoke test for UV Printing > Coasters (v34) and the Paper tab calendar / brochure references (v35).
//   NODE_PATH=/path/to/node_modules node tools/smoke-uv-paper.js [index.html]
// Needs jsdom. Checks prices against the VistaPrint ladders in the JSON block id="market-print"
// worked out here straight from the JSON (tier at or below the quantity), the all-in coaster rules
// (no job setup fee for coasters), totals, save / reopen through Jobs, and no page errors. Plain ASCII.
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
const vpCost = (ladder, q, col) => {
  col = col || 1; const P = r => (r[col] != null ? r[col] : r[1]);
  const lower = ladder.filter(r => r[0] <= q), upper = ladder.filter(r => r[0] > q);
  const a = lower.length ? q * P(lower[lower.length - 1]) / lower[lower.length - 1][0] : Infinity;
  const b = upper.length ? P(upper[0]) : Infinity;
  return Math.min(a, b);
};
const tier = (ladder, q, col) => vpCost(ladder, q, col) / q;   // each

function openWin(ls) {
  const errs = [];
  const dom = new JSDOM(HTML, {
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
  const cer = seller('vp-coaster-ceramic').sizes[0].ladder;
  const A = openWin(); await sleep(40);
  A.w.switchTabByName('uv');
  const baseQuote = money(A.$('u-tt-quote').textContent);

  // ---------- coasters: market mode ----------
  A.chk('uc-on', true); A.w.ucToggle();
  ok(A.$('uc-section').style.display === '' && A.w.eval('ucRows.length') === 1, 'Coasters switch shows the section with one row');
  const cases = [1, 2, 10, 20, 30, 100, 400, 500];
  cases.forEach(q => {
    A.set('uc0-q', q); A.set('uc0-b', 1.25); A.w.uCalc();
    const vp = tier(cer, q);
    ok(near(money(A.$('uc0-vp').textContent), Math.round(vp * 100) / 100), 'VistaPrint each at ' + q + ': ' + A.$('uc0-vp').textContent + ' vs ' + vp.toFixed(4));
    ok(near(money(A.$('uc0-pe').textContent), Math.round(vp * 100) / 100), 'match price each at ' + q);
    ok(near(money(A.$('uc0-rt').textContent), q * Math.round(vp * 100) / 100), 'retail total at ' + q);
  });
  ok(/minimum is 2/.test(A.$('uc0-vp').title) === false, 'title cleared for normal tiers');
  A.set('uc0-q', 1); A.w.uCalc();
  ok(/minimum is 2/.test(A.$('uc0-vp').title), 'qty 1 notes VistaPrint minimum of 2');
  A.set('uc0-q', 500); A.w.uCalc();
  ok(/over 400/.test(A.$('uc0-vp').title), 'qty over 400 noted');
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
  ok(R.w.eval('ucRows.length') === 3 && !!R.$('uc2-q'), 'adding a coaster row after reopening continues the ids');
  R.w.resetUV(); R.w.cobaConfirmAnswer(true);
  ok(R.w.eval('ucRows.length') === 0 && !R.$('uc-on').checked && R.$('uc-section').style.display === 'none', 'New estimate clears the coasters');
  ok(near(money(R.$('u-tt-quote').textContent), baseQuote), 'New estimate is back to an empty UV job');

  // ---------- Paper > Calendar / Brochure references (v35) ----------
  const P = openWin(); await sleep(40);
  const calSel = P.$('p-cal-type'), calOpts = Array.from(calSel.options).map(o => o.textContent);
  ok(calOpts.length === 10, 'calendar types listed: ' + calOpts.length);
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
  ok(out.indexOf('$' + tier(wall, 30).toFixed(2) + ' each') >= 0 && out.indexOf('$750.00 for 30') >= 0, 'wall calendar at 30: list price each and total');
  ok(/on sale when captured: \$15\.00 each/.test(out), 'sale price at capture shown');
  const q30 = money(P.$('p-quote-total').textContent);
  ok(out.indexOf('$' + (q30 / 30).toFixed(2) + ' each (') >= 0, 'your price per calendar = quote / finished pieces');
  ok(/Defend/.test(out), 'calendars default to Defend guidance');
  P.set('p-finished-qty', 50); P.w.pCalc(); out = P.$('p-cal-out').innerHTML;
  ok(/their price break at 30/.test(out) && out.indexOf('$1250.00 for 50') >= 0, 'between breaks: 50 at the 30-break unit price');
  P.set('p-finished-qty', 1); P.w.pCalc(); out = P.$('p-cal-out').innerHTML;
  ok(/set Finished pieces to the number of calendars/.test(out), 'hint when Finished pieces is 1 but press sets are more');
  P.set('p-finished-qty', 100);
  calSel.value = Array.from(calSel.options).find(o => /^Desk, Square/.test(o.textContent)).value; P.w.pCalc();
  ok(P.$('p-cal-out').innerHTML.indexOf('$' + tier(seller('vp-cal-desk').sizes[1].ladder, 100).toFixed(2) + ' each') >= 0, 'desk square calendar at 100');
  P.set('p-finished-qty', 300);
  calSel.value = Array.from(calSel.options).find(o => /^Poster/.test(o.textContent)).value; P.w.pCalc();
  ok(/over 200 they quote larger runs/.test(P.$('p-cal-out').innerHTML), 'poster calendar over their 200 maximum noted');

  // brochures
  P.set('p-finished-qty', 250); P.w.pCalc();
  P.chk('p-bro-on', true); P.w.pRefToggle('bro');
  ok(P.$('p-bro-size').value === '8.5x11 flat' && P.$('p-bro-stock').value === 'glossy', 'brochure defaults: tri-fold 8.5x11 glossy');
  out = P.$('p-bro-out').innerHTML;
  const tg = s => seller('vp-bro-tri-' + s).sizes[0].ladder;
  ok(out.indexOf('$197.59 for 250') >= 0 && out.indexOf('$' + tier(tg('glossy'), 250).toFixed(2) + ' each') >= 0, 'tri-fold 8.5x11 glossy at 250');
  ok(['matte', 'uncoated', 'recycled'].every(x => out.indexOf(x + ' $' + tier(tg(x), 250).toFixed(2)) >= 0), 'other papers at the same quantity');
  ok(/Compete/.test(out), 'brochures default to Compete guidance');
  P.set('p-finished-qty', 10); P.w.pCalc(); out = P.$('p-bro-out').innerHTML;
  ok(/cheaper to buy their 25 for \$40\.29/.test(out) && out.indexOf('$40.29 for 10') >= 0, '10 brochures: their 25-pack is the comparison');
  P.set('p-bro-stock', 'recycled'); P.w.pCalc();
  ok(/their minimum is 25 for \$72\.79/.test(P.$('p-bro-out').innerHTML), 'recycled minimum of 25 noted');
  P.set('p-bro-fold', 'bi'); P.w.pRefSizes(); P.w.pCalc();
  ok(Array.from(P.$('p-bro-size').options).map(o => o.value).join(',') === '9x8 flat,8.5x11 flat,11x17 flat' && P.$('p-bro-size').value === '8.5x11 flat', 'bi-fold sizes, keeps 8.5x11');
  P.set('p-bro-fold', 'z'); P.w.pRefSizes(); P.w.pCalc();
  ok(P.$('p-bro-size').options.length === 1, 'Z-fold has one size');
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
  ok(Q.$('p-quote-total').textContent === quoteSaved && Q.$('p-cal-on').checked && Q.$('p-bro-on').checked && /\$750\.00 for 30/.test(Q.$('p-cal-out').innerHTML), 'paper job reopens with its references');
  Q.w.loadEstimate(cc.id, byTitle('old style job'), false); Q.w.cobaConfirmAnswer(true);
  ok(Q.$('p-quote-total').textContent === quoteSaved && !!Q.$('p-cal-box') && Q.$('p-cal-type').options.length === 10 && !Q.$('p-cal-on').checked, 'old paper job reopens at its price with the reference boxes put back');
  Q.w.resetPaper(); Q.w.cobaConfirmAnswer(true);
  ok(!Q.$('p-cal-on').checked && Q.$('p-cal-body').style.display === 'none', 'New estimate switches the references off');

  [A, B, R, P, Q].forEach((x, i) => ok(x.errs.length === 0, 'page errors in window ' + i + ': ' + x.errs.slice(0, 3).join(' | ')));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
