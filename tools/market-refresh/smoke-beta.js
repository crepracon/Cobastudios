#!/usr/bin/env node
// Smoke test for beta/index.html after a market refresh.
//   node tools/market-refresh/smoke-beta.js
// Checks: page loads with no script errors, the market date shown matches the data,
// laminated and unlaminated modes each compare two sellers of the right type and give a quote,
// and the beta never writes the live estimator's inventory key. Needs Playwright (preinstalled
// in Claude's cloud workspace). Plain ASCII only.
const path = require('path');
const { chromium } = require('playwright');
const FILE = 'file://' + path.resolve(__dirname, '..', '..', 'beta', 'index.html');

(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
  // Static checks (CLAUDE.md hard rules): every script compiles, scripts are plain ASCII with no escape sequences.
  const fs = require('fs'), vm = require('vm');
  const src = fs.readFileSync(path.resolve(__dirname, '..', '..', 'beta', 'index.html'), 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(src))) {
    const attrs = m[1] || '', body = m[2]; n++;
    if (/application\/json/.test(attrs)) { try { JSON.parse(body); ok(true); } catch (e) { ok(false, 'market data is not valid JSON: ' + e.message); } continue; }
    try { new vm.Script(body); ok(true); } catch (e) { ok(false, 'script ' + n + ' does not compile: ' + e.message); }
    ok(!/[^\x00-\x7F]/.test(body), 'script ' + n + ' is plain ASCII');
    ok(body.indexOf('\\' + 'u') < 0, 'script ' + n + ' has no backslash-u escapes');
  }
  const b = await chromium.launch(); const p = await b.newPage(); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.goto(FILE); await p.waitForTimeout(400);
  const data = await p.evaluate(() => JSON.parse(document.getElementById('market-data').textContent));
  const T = async id => (await p.$eval('#' + id, e => e.textContent)).trim();
  const fill = async (w, h, q) => { await p.fill('#b-w', String(w)); await p.fill('#b-h', String(h)); await p.fill('#b-q', String(q)); await p.waitForTimeout(50); };
  ok(Array.isArray(data.sellers) && data.sellers.length >= 4, 'market data has 4+ sellers');
  ok(data.sellers.every(s => s.lam && s.lamLabel), 'every seller has a lamination label');
  const shown = await T('mk-date');
  const d = new Date(data.captured + 'T12:00:00').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
  ok(shown === d, 'header shows market date ' + d + ' (got ' + shown + ')');
  await fill(3, 3, 100);
  const money = s => parseFloat(String(s).replace(/[^0-9.]/g, ''));
  ok(money(await T('c-quote')) > 0, 'laminated quote > 0');
  ok((await T('mk-group')) === 'laminated stickers only', 'laminated group label');
  const lamNames = await p.$$eval('#sellers .seller .nm', e => e.map(x => x.textContent));
  ok(lamNames.length === 2 && lamNames.every(n => /Laminated/.test(n) && !/Not laminated/.test(n)), 'two laminated sellers: ' + lamNames.join(' | '));
  await p.selectOption('#b-lam', ''); await p.waitForTimeout(50);
  ok(money(await T('c-quote')) > 0, 'unlaminated quote > 0');
  const rawNames = await p.$$eval('#sellers .seller .nm', e => e.map(x => x.textContent));
  ok(rawNames.length === 2 && rawNames.every(n => /Not laminated/.test(n)), 'two unlaminated sellers: ' + rawNames.join(' | '));
  ok(await p.evaluate(() => localStorage.getItem('coba-inventory-v2')) === null, 'inventory key never written');
  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
