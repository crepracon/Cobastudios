#!/usr/bin/env node
// Smoke test for the live estimator (index.html) after a market refresh.
//   node tools/market-refresh/smoke-estimator.js
// Checks: market data is valid plain-ASCII JSON with lamination labels on every seller, the main
// script compiles and still declares const PM=3, TM=5; and, in a headless browser with the network
// blocked (like an offline shop computer): the Vinyl / Roland sticker section prices in market mode,
// laminated and unlaminated quotes equal the like-for-like market middle worked out here straight
// from the JSON, the market check names the right sellers, Classic mode still works, and there are
// no page errors. Needs Playwright (preinstalled in Claude's cloud workspace). Plain ASCII only.
const path = require('path'), fs = require('fs'), vm = require('vm');
const { chromium } = require('playwright');
const SRC = path.resolve(__dirname, '..', '..', 'index.html');

(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
  // ---- static checks ----
  const src = fs.readFileSync(SRC, 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m, data = null, main = '';
  while ((m = re.exec(src))) {
    const attrs = m[1] || '', body = m[2];
    if (/id="market-data"/.test(attrs)) {
      try { data = JSON.parse(body); ok(true); } catch (e) { ok(false, 'market data is not valid JSON: ' + e.message); }
      ok(!/[^\x00-\x7F]/.test(body), 'market data is plain ASCII');
      continue;
    }
    if (/application\/json/.test(attrs)) continue;
    try { new vm.Script(body); ok(true); } catch (e) { ok(false, 'a script does not compile: ' + e.message); }
    if (body.length > main.length) main = body;
  }
  ok(data && Array.isArray(data.sellers) && data.sellers.length >= 4, 'market data has 4+ sellers');
  ok(data && data.sellers.every(s => s.lam && s.lamLabel), 'every seller has a lamination label');
  ok(main.indexOf('const PM=3, TM=5;') >= 0, 'const PM=3, TM=5; still declared');
  ok(main.indexOf('\\' + 'u') < 0, 'main script has no backslash-u escapes');
  if (!data) { console.log(pass + ' passed, ' + fail + ' failed'); process.exit(1); }

  // Expected market middle for an exact captured size and quantity, straight from the JSON.
  const exact = (s, w, h, q) => { const z = s.sizes.find(z => Math.max(z.w, z.h) === Math.max(w, h) && Math.min(z.w, z.h) === Math.min(w, h)); const r = z && z.ladder.find(r => r[0] === q); return r ? r[1] : null; };
  const middle = (lam, w, h, q) => {
    const v = data.sellers.filter(s => lam ? s.lam === 'laminated' : s.lam !== 'laminated').map(s => exact(s, w, h, q)).filter(x => x != null).sort((a, b) => a - b);
    if (!v.length) return null; const n = v.length; return n % 2 ? v[(n - 1) / 2] : (v[n / 2 - 1] + v[n / 2]) / 2;
  };

  // ---- browser checks ----
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https?:\/\//, r => r.abort()); // fonts and Firebase blocked, as on an offline machine
  await p.goto('file://' + SRC); await p.waitForTimeout(500);
  const run = (w, h, q, lam, mode) => p.evaluate(({ w, h, q, lam, mode }) => {
    switchTabByName('vinyl');
    const pick = (id, name) => { const s = document.getElementById(id); const i = Array.from(s.options).findIndex(o => o.text.trim().startsWith(name)); s.selectedIndex = i >= 0 ? i : Math.min(1, s.options.length - 1); };
    const on = document.getElementById('r-stk-on'); if (!on.checked) { on.checked = true; rToggle('stk'); }
    pick('r-stk-vinyl', 'Matte Vinyl'); pick('r-stk-lam-type', 'Matte Laminate');
    document.getElementById('r-stk-lam').checked = lam;
    document.getElementById('r-stk-mode').value = mode;
    const id = rStkRows[0];
    document.getElementById(id + '-w').value = w; document.getElementById(id + '-h').value = h; document.getElementById(id + '-q').value = q;
    rCalc();
    return { rt: document.getElementById(id + '-rt').textContent.trim(), box: document.getElementById('r-stk-mkt').innerText };
  }, { w, h, q, lam, mode });
  const money = s => parseFloat(String(s).replace(/[^0-9.]/g, ''));
  ok(await p.evaluate(() => !!document.getElementById('r-stk-mode') && document.getElementById('r-stk-mode').value === 'market'), 'sticker pricing starts in Market mode');

  const lamR = await run(3, 3, 100, true, 'market'), lamMid = middle(true, 3, 3, 100);
  ok(money(lamR.rt) > 0, 'laminated 3 x 3 x 100 quote > 0 (got ' + lamR.rt + ')');
  if (lamMid != null) ok(money(lamR.rt) === Math.round(lamMid), 'laminated quote = market middle ' + lamMid.toFixed(2) + ' rounded (got ' + lamR.rt + ')');
  ok(/laminated stickers only/.test(lamR.box), 'market check says laminated stickers only');
  ok(/Not compared \(not laminated\)/.test(lamR.box), 'market check names the unlaminated sellers it left out');

  const rawR = await run(3, 3, 100, false, 'market'), rawMid = middle(false, 3, 3, 100);
  ok(money(rawR.rt) > 0, 'unlaminated 3 x 3 x 100 quote > 0 (got ' + rawR.rt + ')');
  if (rawMid != null) ok(money(rawR.rt) === Math.round(rawMid), 'unlaminated quote = market middle ' + rawMid.toFixed(2) + ' rounded (got ' + rawR.rt + ')');
  ok(/Not compared \(laminated\): /.test(rawR.box) && !/Not compared \(not laminated\)/.test(rawR.box), 'market check is in the unlaminated group');

  const cls = await run(3, 3, 100, true, 'classic');
  ok(money(cls.rt) > 0, 'Classic mode still prices (got ' + cls.rt + ')');
  const age = await p.evaluate(() => MKT.ageDays());
  ok(age != null && age >= 0, 'market data age readable (' + age + ' days)');
  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
