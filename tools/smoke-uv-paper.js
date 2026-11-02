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
// tier at or below q; below the first tier use the first; col 1 = list price
const tier = (ladder, q) => { let t = null; ladder.forEach(r => { if (r[0] <= q) t = r; }); t = t || ladder[0]; return t[1] / t[0]; };

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

  globalThis.__paperTests && await globalThis.__paperTests({ openWin, ok, near, money, tier, seller, sleep });
  [A, B, R].forEach((x, i) => ok(x.errs.length === 0, 'page errors in window ' + i + ': ' + x.errs.slice(0, 3).join(' | ')));
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
