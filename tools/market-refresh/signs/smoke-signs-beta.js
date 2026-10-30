#!/usr/bin/env node
// Smoke test for beta/signs/index.html (Signs & Banners Quick Quote).
//   node tools/market-refresh/signs/smoke-signs-beta.js [--shots <dir>]
// Checks the like-for-like groups (banner weight and edges; lawn sign print method, sides, stakes), quotes,
// reference-only direct-print prices, local prices, that the live estimator's inventory is never written,
// and phone layout. Needs Playwright (preinstalled in Claude's cloud workspace). Plain ASCII only.
const path = require('path'), fs = require('fs'), vm = require('vm');
const { chromium } = require('playwright');
const FILE = path.resolve(__dirname, '..', '..', '..', 'beta', 'signs', 'index.html');
const args = process.argv.slice(2), shots = args.indexOf('--shots') >= 0 ? args[args.indexOf('--shots') + 1] : null;

(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
  const src = fs.readFileSync(FILE, 'utf8'); const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m;
  while ((m = re.exec(src))) {
    if (/application\/json/.test(m[1] || '')) { try { JSON.parse(m[2]); ok(true); } catch (e) { ok(false, 'data is not valid JSON'); } continue; }
    try { new vm.Script(m[2]); ok(true); } catch (e) { ok(false, 'script does not compile: ' + e.message); }
    ok(!/[^\x00-\x7F]/.test(m[2]), 'script is plain ASCII'); ok(m[2].indexOf('\\' + 'u') < 0, 'no backslash-u escapes');
  }
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1100, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.goto('file://' + FILE); await p.waitForTimeout(300);
  const T = id => p.$eval('#' + id, e => e.textContent.trim());
  const money = s => parseFloat(String(s).replace(/[^0-9.]/g, ''));
  const names = sel => p.$$eval(sel + ' .seller .nm', es => es.map(e => e.childNodes[0].textContent.trim()));
  const set = async (w, h, q) => { await p.fill('#j-w', String(w)); await p.fill('#j-h', String(h)); await p.fill('#j-q', String(q)); await p.waitForTimeout(40); };
  const seg = async (id, v) => { await p.click('#' + id + ' button[data-v="' + v + '"]'); await p.waitForTimeout(40); };

  // Banners: 4 x 2 ft, 1, 13 oz hemmed -> VistaPrint list $45.25 and Staples $84.99, middle $65.12 -> $65
  ok((await T('mk-group')) === '13 oz vinyl, hemmed + grommets', 'banner group label');
  ok(JSON.stringify(await names('#sellers')) === JSON.stringify(['VistaPrint', 'Staples']), 'banner 13 oz hemmed sellers: ' + await names('#sellers'));
  ok(money(await T('c-quote')) === 65, 'banner 4x2 quote $65: ' + await T('c-quote'));
  ok(/BannerBuzz \(no hem/.test(await T('mk-excl')), 'BannerBuzz listed as not compared (no hem)');
  await seg('o-hem', '0');
  ok(JSON.stringify(await names('#sellers')) === JSON.stringify(['VistaPrint', 'BannerBuzz']), 'grommets-only sellers: ' + await names('#sellers'));
  await seg('o-hem', '1'); await seg('o-mat', 'heavy');
  ok(JSON.stringify(await names('#sellers')) === JSON.stringify(['VistaPrint', 'Staples']) && /heavy/.test(await T('mk-group')), 'heavy banner sellers');
  await seg('o-mat', '13oz'); await set(8, 4, 1);
  ok(/\$192\.00/.test(await T('est-price')), 'estimator banner rate 8x4 = $192: ' + await T('est-price'));

  // Lawn signs: vinyl + laminate has no like-for-like seller; quote falls back to the estimator rate
  await p.click('#tab-lawn'); await p.waitForTimeout(60);
  await set(24, 18, 10);
  ok(!(await p.$eval('#mk-empty', e => e.hidden)) && /No one found sells signs made your way/.test(await T('mk-empty')), 'vinyl + laminate: no like-for-like seller message');
  ok((await names('#sellers')).length === 0, 'no sellers in the main comparison');
  ok(!(await p.$eval('#mk-ref', e => e.hidden)), 'direct-print reference box shown');
  ok(JSON.stringify(await names('#ref-sellers')) === JSON.stringify(['VistaPrint', 'Staples', 'Kelly Signs']), 'reference sellers (1 sided): ' + await names('#ref-sellers'));
  ok(money(await T('c-quote')) === 360, 'quote = signage rate 3 sq ft x $12 x 10 = $360: ' + await T('c-quote'));
  ok(/your estimator rate/.test(await T('rule-line')), 'rule line says estimator rate');
  ok(/Sticker Mule \(2 sided only\)/.test(await T('mk-excl')), 'Sticker Mule not compared for 1 sided');
  // cost: (0.56 + 0.50 + 0.56) x 1 side + 0.52 board = 2.14 / sq ft x 3 sq ft x 10 = $64.20
  ok(money(await T('c-cost')) === 64.2, 'vinyl + laminate cost $64.20: ' + await T('c-cost'));
  await seg('o-sides', '2');
  ok(money(await T('c-cost')) === 112.8, '2 sided cost doubles the face only ($112.80): ' + await T('c-cost'));
  // direct print, 2 sided, with stakes: VistaPrint 290 + 40 stakes, Staples 609.90 + 24.90, Sticker Mule 99 (stake included)
  await seg('o-meth', 'direct'); await seg('o-stake', '1');
  const lawnNames = await names('#sellers');
  ok(JSON.stringify(lawnNames) === JSON.stringify(['VistaPrint', 'Staples', 'Sticker Mule', 'Kelly Signs']), 'direct 2 sided sellers: ' + lawnNames);
  ok(money(await T('mk-mid')) === 330, 'direct 2 sided + stakes middle $330: ' + await T('mk-mid'));
  ok(money(await T('c-quote')) === 330, 'quote at the middle $330');
  ok((await T('c-cost-lbl')) === 'Your outsourcing cost' && money(await T('c-cost')) === 99 && /Sticker Mule/.test(await T('c-cost-sub')), 'outsourced cost = cheapest seller (Sticker Mule $99): ' + await T('c-cost') + ' ' + await T('c-cost-sub'));
  // back to vinyl + laminate; quote from direct-print middle + 50%
  await seg('o-meth', 'vinyl');
  await p.click('#set-toggle'); await p.selectOption('#s-nomk', 'ref'); await p.waitForTimeout(40);
  ok(money(await T('c-quote')) === 495, 'direct-print middle $330 + 50% = $495: ' + await T('c-quote'));
  await p.selectOption('#s-nomk', 'rate');
  // Auto: 20 signs or fewer in-house (vinyl + laminate), more than 20 outsourced (direct print, like for like)
  await seg('o-meth', 'auto'); await seg('o-sides', '1'); await seg('o-stake', '0'); await set(24, 18, 20);
  ok(/in-house/.test(await T('mk-group')) && money(await T('c-quote')) === 720, 'Auto, 20 signs: in-house at the estimator rate ($720): ' + await T('c-quote'));
  await set(24, 18, 25);
  ok(/outsourced/.test(await T('mk-group')) && /over 20 signs/.test(await T('meth-note')), 'Auto, 25 signs: outsourced');
  ok(money(await T('mk-mid')) === 487.5 && money(await T('c-quote')) === 488, 'outsourced quote = direct-print middle (Kelly $487.50) -> $488: ' + await T('c-quote'));
  ok((await T('c-cost-lbl')) === 'Your outsourcing cost' && /VistaPrint/.test(await T('c-cost-sub')), 'outsourced cost from the cheapest seller (VistaPrint): ' + await T('c-cost-sub'));
  const made = await p.$$eval('#breaks tr', trs => trs.slice(1).map(tr => tr.children[0].textContent + ':' + tr.children[1].textContent));
  ok(made.indexOf('10:In-house') >= 0 && made.indexOf('50:Outsourced') >= 0, 'quantity table shows In-house / Outsourced: ' + made.join(' '));
  await p.fill('#s-outsrc', '30'); await p.waitForTimeout(40);
  ok(/in-house/.test(await T('mk-group')), 'raising the limit to 30 brings 25 signs in-house');
  await p.fill('#s-outsrc', '20'); await seg('o-meth', 'vinyl'); await set(24, 18, 10);

  // local prices
  await seg('o-sides', '1'); await seg('o-stake', '0');
  await p.fill('#lp-name', 'Test Shop'); await p.fill('#lp-price', '250'); await p.fill('#lp-q', '10'); await p.click('#lp-add'); await p.waitForTimeout(40);
  ok(!(await p.$eval('#mk-local', e => e.hidden)) && /Test Shop/.test(await T('local-sellers')), 'local price shown for the same job');
  await set(36, 24, 10);
  ok(await p.$eval('#mk-local', e => e.hidden), 'local price hidden for a different size');
  ok(await p.evaluate(() => localStorage.getItem('coba-inventory-v2')) === null, 'estimator inventory never written');
  ok(/Test Shop/.test(await p.evaluate(() => localStorage.getItem('coba-beta-signs-v1'))), 'beta saves to its own key');
  if (shots) await p.screenshot({ path: path.join(shots, 'signs-desktop.png'), fullPage: true });

  // phone layout
  const ph = await b.newPage({ viewport: { width: 390, height: 844 } }); ph.on('pageerror', e => errs.push(e.message));
  await ph.route(/^https?:\/\//, r => r.abort()); await ph.goto('file://' + FILE); await ph.waitForTimeout(300);
  ok(await ph.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no sideways scroll on a phone');
  if (shots) await ph.screenshot({ path: path.join(shots, 'signs-phone.png'), fullPage: true });
  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
