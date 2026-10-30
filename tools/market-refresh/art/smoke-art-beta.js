#!/usr/bin/env node
// Smoke test for beta/art/index.html (Art & Plans Quick Quote).
//   node tools/market-refresh/art/smoke-art-beta.js [--shots <dir>]
// Checks the like-for-like paper groups (art: Enhanced Matte vs matte art paper, Luster/Glossy vs photo paper;
// plans: same ink, Staples by turnaround), quotes, fallbacks, reference-only boxes, local prices, material cost
// (same math as the Epson tab), that the live estimator's inventory is never written, and phone layout.
// Needs Playwright (preinstalled in Claude's cloud workspace). Plain ASCII only.
const path = require('path'), fs = require('fs');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const PAGE = 'file://' + path.join(ROOT, 'beta', 'art', 'index.html');
const args = process.argv.slice(2), si = args.indexOf('--shots'), SHOTS = si >= 0 ? args[si + 1] : null;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL ' + m); } };
const near = (a, b, t) => Math.abs(a - b) <= (t == null ? 0.011 : t);
const dollars = s => parseFloat(String(s).replace(/[^0-9.\-]/g, ''));

// Independent copy of the Epson tab art cost math (index.html eCalc art rows)
function artCost(w, h, q, media, ink) {
  const roll = 36, m = 1, W = Math.max(w, h), H = Math.min(w, h);
  const across = W <= roll ? W : H, feed = W <= roll ? H : W;
  const ipp = Math.max(1, Math.floor(roll / (across + m * 2))), passes = Math.ceil(q / ipp);
  return passes * roll * (feed + m * 2) / 144 * (media + ink);
}

(async () => {
  const html = fs.readFileSync(path.join(ROOT, 'beta', 'art', 'index.html'), 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let mm, ascii = true;
  while ((mm = re.exec(html))) if (/[^\x00-\x7F]/.test(mm[2])) ascii = false;
  ok(ascii, 'scripts are plain ASCII');
  ok(html.indexOf('localStorage.setItem(INVENTORY_KEY') < 0 && html.indexOf("setItem('coba-inventory-v2'") < 0, 'no code writes the inventory key');

  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(PAGE);
  await page.evaluate(() => localStorage.clear()); await page.reload();
  const st = () => page.evaluate(() => {
    const t = id => document.getElementById(id).textContent;
    return { cost: t('c-cost'), quote: t('c-quote'), qsub: t('c-quote-sub'), check: document.getElementById('check').className, group: t('mk-group'),
      mid: document.getElementById('mk-stats').hidden ? null : t('mk-mid'), empty: !document.getElementById('mk-empty').hidden, rule: t('rule-line'), est: t('est-price'), excl: t('mk-excl'),
      sellers: [...document.querySelectorAll('#sellers .seller')].map(s => ({ name: s.querySelector('.nm').firstChild.textContent, badge: s.querySelector('.badge').textContent, lb: s.querySelector('.lb').textContent, pr: s.querySelector('.pr').textContent, na: s.classList.contains('na'), used: s.classList.contains('used') })),
      refs: [...document.querySelectorAll('#refs .market')].map(m => ({ head: m.querySelector('.mk-head').textContent, badges: [...m.querySelectorAll('.badge')].map(b => b.textContent) })),
      breaks: document.querySelectorAll('#breaks tr').length };
  });
  const setJob = async (w, h, q) => { await page.fill('#j-w', String(w)); await page.fill('#j-h', String(h)); await page.fill('#j-q', String(q)); await page.dispatchEvent('#j-q', 'input'); };

  // 1. Default: 24 x 18 Enhanced Matte, qty 1 -> matte art paper group only (Monk Enhanced Matte $22, NLC fine art matte $35.84)
  let s = await st();
  ok(s.sellers.length === 2 && s.sellers.every(x => x.badge === 'Matte art paper'), 'EM compares matte art paper only: ' + s.sellers.map(x => x.name + '/' + x.badge).join(','));
  ok(near(dollars(s.mid), (22 + 35.84) / 2), 'EM 24x18 market middle ' + s.mid);
  ok(dollars(s.quote) === 29, 'EM 24x18 quote rounds the middle to $29: ' + s.quote);
  ok(near(dollars(s.cost), artCost(24, 18, 1, 0.59, 0.41)), 'EM material cost matches Epson math ' + s.cost);
  ok(near(dollars(s.est), 42), 'estimator now = 3 sq ft x $14 = $42: ' + s.est);
  ok(s.refs.length === 3 && s.refs[0].badges.every(b => b === 'Cotton rag') && s.refs[1].badges.every(b => b === 'Poster stock'), 'reference boxes: rag above, poster below, photo other');
  ok(s.sellers.every(x => x.used), 'market sellers marked as used');
  ok(s.breaks === 7, 'quantity table has 6 rows + header: ' + s.breaks);

  // 2. 5 x 7 Enhanced Matte: no matte seller lists it -> your $/sq ft rate, no per-print minimum, minimum order $25
  await page.click('#size-chips .chip[data-w="7"]');
  s = await st();
  ok(s.empty && s.mid === null, '5x7 EM: no like-for-like market');
  ok(dollars(s.quote) === 25 && /minimum order/.test(s.qsub), '5x7 x1 raised to the $25 minimum order: ' + s.quote + ' ' + s.qsub);
  ok(/\$14\/sq ft rate/.test(s.rule), 'rule names the $/sq ft fallback: ' + s.rule);
  ok(/\$25 minimum per print/.test(s.est), 'estimator now shows the per-print minimum: ' + s.est);
  await page.click('#qty-chips .chip[data-q="10"]');
  s = await st();
  ok(dollars(s.quote) === Math.round(35 / 144 * 14 * 10), '10 x 5x7 = 10 x 35/144 sq ft x $14, rounded: ' + s.quote);
  ok(near(dollars(s.est), 250), 'estimator now charges $25 x 10 = $250: ' + s.est);
  ok(near(dollars(s.cost), artCost(7, 5, 10, 0.59, 0.41)), '10 x 5x7 cost gangs 4 across the roll ' + s.cost);
  // reference fallback option: cotton rag middle (Posterjack $4 each) + premium
  await page.click('#set-toggle'); await page.selectOption('#s-nomk', 'ref');
  s = await st();
  ok(dollars(s.quote) === 40 && /reference middle/.test(s.rule), 'reference fallback uses cotton rag middle: ' + s.quote + ' ' + s.rule);
  await page.fill('#s-prem', '-20'); await page.dispatchEvent('#s-prem', 'input');
  s = await st();
  ok(dollars(s.quote) === 32, 'reference premium -20% -> $32: ' + s.quote);
  await page.click('#s-reset');

  // 3. 20 x 30 Enhanced Matte: Monk between sizes (by area), NLC listed
  await page.click('#size-chips .chip[data-w="30"]'); await page.click('#qty-chips .chip[data-q="1"]');
  s = await st();
  const monk = s.sellers.find(x => x.name === 'Monk Office'), nlc = s.sellers.find(x => x.name === 'Newfoundland Canvas');
  const monkExp = 22 + (600 - 432) / (864 - 432) * (28 - 22);
  ok(monk && near(dollars(monk.pr), monkExp) && nlc && near(dollars(nlc.pr), 47.6), '20x30: Monk by area ' + (monk && monk.pr) + ', NLC ' + (nlc && nlc.pr));
  ok(dollars(s.quote) === Math.round((monkExp + 47.6) / 2), '20x30 quote = rounded middle: ' + s.quote);
  // adjust %: 110
  await page.fill('#s-pct', '110'); await page.dispatchEvent('#s-pct', 'input');
  s = await st();
  ok(dollars(s.quote) === Math.round((monkExp + 47.6) / 2 * 1.1), 'adjust 110%: ' + s.quote);
  await page.selectOption('#s-at', 'low');
  s = await st();
  ok(dollars(s.quote) === Math.round(monkExp * 1.1), 'market low x 110%: ' + s.quote);
  await page.click('#s-reset');

  // 4. Luster: photo paper group only; Enhanced Matte becomes a reference box
  await page.click('#opt-a button[data-v="luster"]');
  s = await st();
  ok(s.sellers.length === 5 && s.sellers.every(x => x.badge === 'Photo paper'), 'Luster compares photo paper only: ' + s.sellers.map(x => x.name).join(','));
  ok(s.sellers.filter(x => x.name === 'Posterjack').length === 2 && /Satin/.test(s.sellers[0].lb) && /Glossy/.test(s.sellers[1].lb), 'two Posterjack papers told apart by their label');
  ok(near(dollars(s.cost), artCost(30, 20, 1, 0.74, 0.41)), 'Luster material cost ' + s.cost);
  ok(s.refs.some(r => r.badges.length && r.badges.every(b => b === 'Matte art paper')), 'matte art paper shown as reference for Luster');
  await page.click('#opt-b button[data-v="bw"]');
  s = await st();
  ok(near(dollars(s.cost), artCost(30, 20, 1, 0.74, 0.04)), 'B&W ink cost ' + s.cost);

  // 5. Plans: B&W 24 x 36 x 5, Staples same day + Monk
  await page.click('#tab-plan');
  s = await st();
  ok(s.sellers.length === 2 && s.sellers.every(x => /bond/.test(x.badge)), 'plans compare bond only: ' + s.sellers.map(x => x.name + '/' + x.badge).join(','));
  ok(near(dollars(s.mid), (5.99 * 5 + 5 * 5) / 2), 'plans B&W same day middle ' + s.mid);
  ok(dollars(s.quote) === 27 && near(dollars(s.est), 27), 'plans quote $27, estimator $27 (6 sq ft x $0.90 x 5): ' + s.quote + ' / ' + s.est);
  ok(/2-4 days/.test(s.excl) && /1 hour/.test(s.excl), 'other Staples turnarounds listed as not compared: ' + s.excl);
  ok(near(dollars(s.cost), (0.13 + 0.04) * 6 * 5), 'plans B&W material cost ' + s.cost);
  await page.click('#opt-b button[data-v="1h"]');
  s = await st();
  ok(near(dollars(s.sellers[0].pr), 6.79 * 5), 'Staples 1-hour B&W 24x36 x5 = $33.95: ' + s.sellers[0].pr);
  await page.click('#opt-a button[data-v="colour"]');
  s = await st();
  ok(near(dollars(s.sellers[0].pr), 25.99 * 5) && near(dollars(s.sellers[1].pr), 30), 'colour: Staples 1-hour $129.95, Monk $30: ' + s.sellers.map(x => x.pr).join(','));
  // custom size 30 x 42: Staples per sq ft in store, Monk $2/sq ft other sizes
  await setJob(30, 42, 5);
  s = await st();
  ok(near(dollars(s.sellers[0].pr), 4.25 * 8.75 * 5) && near(dollars(s.sellers[1].pr), 2 * 8.75 * 5), 'custom 30x42 per sq ft: ' + s.sellers.map(x => x.pr).join(','));
  // 18 x 24: Monk only lists 24 x 36, $2/sq ft other sizes
  await page.click('#size-chips .chip[data-w="24"]');
  s = await st();
  ok(near(dollars(s.sellers[1].pr), 2 * 3 * 5), 'Monk 18x24 at $2/sq ft: ' + s.sellers[1].pr);

  // 6. Local price: shown next to the market, saved in the beta key, removable
  await page.fill('#lp-name', 'Test Shop'); await page.fill('#lp-price', '60'); await page.fill('#lp-q', '5'); await page.click('#lp-add');
  let loc = await page.evaluate(() => ({ shown: !document.getElementById('mk-local').hidden, txt: document.getElementById('local-sellers').textContent, saved: JSON.parse(localStorage.getItem('coba-beta-art-v1')).local.length }));
  ok(loc.shown && /\$60\.00/.test(loc.txt) && loc.saved === 1, 'local price shown and saved: ' + loc.txt);
  await page.click('#tab-art');
  loc = await page.evaluate(() => document.getElementById('mk-local').hidden);
  ok(loc, 'local plan price not shown on an art job');
  await page.click('#tab-plan'); await page.click('#local-list [data-del="0"]');
  loc = await page.evaluate(() => JSON.parse(localStorage.getItem('coba-beta-art-v1')).local.length);
  ok(loc === 0, 'local price removed');

  // 7. Saved inventory: read for paper costs, never written
  const INV = JSON.stringify({ vinyl: [], epsonPapers: [{ name: '36in 20# Bond', cost: 0.10 }, { name: 'Enhanced Matte', cost: 0.70 }, { name: 'Luster', cost: 0.80 }] });
  await page.evaluate(v => { localStorage.clear(); localStorage.setItem('coba-inventory-v2', v); }, INV);
  await page.reload();
  s = await st();
  ok(near(dollars(s.cost), artCost(24, 18, 1, 0.70, 0.41)), 'art cost reads Enhanced Matte from saved inventory: ' + s.cost);
  await page.click('#tab-plan');
  s = await st();
  ok(near(dollars(s.cost), (0.10 + 0.04) * 6 * 5), 'plans read bond from saved inventory: ' + s.cost);
  await page.click('#opt-a button[data-v="colour"]'); await page.click('#tab-art'); await page.click('#opt-a button[data-v="glossy"]'); await page.click('#btn-new');
  const after = await page.evaluate(() => localStorage.getItem('coba-inventory-v2'));
  ok(after === INV, 'inventory untouched');
  const keys = await page.evaluate(() => Object.keys(localStorage).sort().join(','));
  ok(keys === 'coba-beta-art-v1,coba-inventory-v2', 'only the beta key is written: ' + keys);
  const reset = await page.evaluate(() => [document.getElementById('j-w').value, document.getElementById('j-h').value, document.querySelector('#opt-a .on').textContent].join('|'));
  ok(reset === '24|18|Enhanced Matte', 'New quote resets the art job: ' + reset);

  // 8. Stale badge after 150 days
  const stale = await ctx.newPage();
  await stale.addInitScript(() => { const D = Date, off = 200 * 86400000; Date = class extends D { constructor(...a) { if (!a.length) super(D.now() + off); else super(...a); } static now() { return D.now() + off; } }; });
  await stale.goto(PAGE);
  ok(await stale.evaluate(() => !document.getElementById('stale-pill').hidden), 'stale badge shows after 150 days');
  await stale.close();

  // 9. Phone width: no sideways scroll on either tab
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await phone.goto(PAGE);
  for (const tab of ['art', 'plan']) {
    await phone.click('#tab-' + tab);
    const w = await phone.evaluate(() => document.documentElement.scrollWidth);
    ok(w <= 390, 'phone ' + tab + ' fits 390px: ' + w);
    if (SHOTS) await phone.screenshot({ path: path.join(SHOTS, 'art-beta-phone-' + tab + '.png'), fullPage: true });
  }
  if (SHOTS) { await page.click('#tab-art'); await page.screenshot({ path: path.join(SHOTS, 'art-beta-desktop.png'), fullPage: true }); }
  ok(errors.length === 0, 'no page errors: ' + errors.join(' | '));
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
