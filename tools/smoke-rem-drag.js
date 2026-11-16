#!/usr/bin/env node
// v48: real-browser test of the Jobs tab To-Do / To-Invoice drag to reorder and the ageing dates.
// Dragging needs real layout, which jsdom does not have, so this one runs headless Chromium.
//   NODE_PATH=$(npm root -g) node tools/smoke-rem-drag.js [index.html] [folder for screenshots]
// Needs Playwright with Chromium (in the cloud workspace the global modules have it). Network is
// blocked, so the page runs on its local copy as if offline. Covers: mouse drag down / up / past the
// end, the others making room, Escape cancels, a click moves nothing, order kept after a reload,
// moves made offline wait for the cloud, arrow keys on the grip, a long list scrolling while
// dragging at its edge, touch drag on a phone without scrolling the page, dates coloured by age.
// Plain ASCII only.
const { chromium } = require('playwright');
const path = require('path');
const FILE = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html')), OUT = process.argv[3] || null;
const shot = (el, name) => OUT ? el.screenshot({ path: path.join(OUT, name) }) : Promise.resolve();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

(async () => {
  const browser = await chromium.launch();
  const errs = [];
  async function open(viewport, items) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    page.on('pageerror', e => errs.push(String(e)));
    page.on('console', m => { if (m.type() === 'error' && !/cloud init failed|Failed to fetch|ERR_|net::/.test(m.text())) errs.push(m.text()); });
    // block the network so the Firebase SDK cannot load (local copy only, like being offline)
    await ctx.route(/^https?:/, r => r.abort());
    await page.addInitScript(json => { try { if (!localStorage.getItem('coba-reminders-v1')) localStorage.setItem('coba-reminders-v1', json); } catch (e) {} }, JSON.stringify({ items, out: { add: {}, del: {}, mov: {} }, view: 'todo' }));
    await page.goto('file://' + FILE);
    await page.waitForTimeout(300);
    await page.evaluate(() => switchTabByName('jobs'));
    await page.waitForTimeout(100);
    return { ctx, page };
  }
  const now = Date.now(), DAY = 864e5;
  const mk = (n, text, ageDays, list) => ({ id: 'r' + (now - Math.round(ageDays * DAY)) + '-' + n, list: list || 'todo', text, t: now - Math.round(ageDays * DAY) });
  const items = [
    mk('aaaa', 'Riverfront Dental - banner', 0.02), mk('bbbb', 'Kelly Signs', 1), mk('cccc', 'Brockville Rotary flyers', 2.5),
    mk('dddd', 'Merrickville Cookies', 4), mk('eeee', 'Smith wedding signs', 5), mk('ffff', 'Old Town Pub menus', 8),
    mk('gggg', 'Tim Hortons window decal', 3, 'invoice'), mk('hhhh', 'Coach house sign', 6.5, 'invoice')
  ];
  const texts = page => page.$$eval('#rem-list .rem-item .rem-text', els => els.map(e => e.textContent));

  // ---------- desktop ----------
  let { ctx, page } = await open({ width: 1280, height: 900 }, items);
  let t0 = await texts(page);
  ok(t0.join('|') === 'Riverfront Dental - banner|Kelly Signs|Brockville Rotary flyers|Merrickville Cookies|Smith wedding signs|Old Town Pub menus', 'starts newest first: ' + t0.join(', '));
  const colours = await page.$$eval('#rem-list .rem-date', els => els.map(e => getComputedStyle(e).backgroundColor + ' ' + e.textContent));
  ok(colours.length === 6 && colours[0].indexOf('rgb(208, 251, 208)') === 0 && colours[5].indexOf('rgb(251, 208, 208)') === 0, 'dates go from green (today) to red (8 days): ' + colours.join(' / '));
  const box = await page.$('#rem-box');
  await shot(box, 'rem-desktop.png');

  // mouse drag: grip of the 1st name down past two names
  async function drag(fromIdx, dy, steps) {
    const g = (await page.$$('#rem-list .rem-grip'))[fromIdx];
    const b = await g.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= steps; i++) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy * i / steps);
    return g;
  }
  const h = await page.$eval('#rem-list .rem-item', el => el.offsetHeight + 6);
  await drag(0, h * 2.2, 12);
  ok(await page.$eval('body', b => b.classList.contains('rem-drag-on')), 'dragging: page in drag mode');
  const mid = await texts(page);
  ok(mid[2] === 'Riverfront Dental - banner', 'the others make room while dragging: ' + mid.join(', '));
  await shot(box, 'rem-dragging.png');
  await page.mouse.up();
  await page.waitForTimeout(50);
  let t1 = await texts(page);
  ok(t1.join('|') === 'Kelly Signs|Brockville Rotary flyers|Riverfront Dental - banner|Merrickville Cookies|Smith wedding signs|Old Town Pub menus', 'mouse drag down 2: ' + t1.join(', '));
  ok(!(await page.$eval('body', b => b.classList.contains('rem-drag-on'))) && (await page.$$('.rem-dragging')).length === 0, 'drag mode off after the drop');
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem('coba-reminders-v1')));
  ok(Object.keys(st.out.mov).length === 1 && typeof st.out.mov[st.items.find(x => x.text === 'Riverfront Dental - banner').id] === 'number', 'offline: the move waits for the cloud');
  // drag the last one up to the top
  await drag(5, -h * 6, 15); await page.mouse.up(); await page.waitForTimeout(50);
  t1 = await texts(page);
  ok(t1[0] === 'Old Town Pub menus' && t1.length === 6, 'mouse drag from the bottom to the top: ' + t1.join(', '));
  // a drag past the end stops at the end
  await drag(0, h * 20, 10); await page.mouse.up(); await page.waitForTimeout(50);
  t1 = await texts(page);
  ok(t1[5] === 'Old Town Pub menus', 'drag far past the end: bottom: ' + t1.join(', '));
  // Escape cancels a drag
  const before = await texts(page);
  await drag(0, h * 3, 8);
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(50);
  ok((await texts(page)).join('|') === before.join('|') && (await page.$$('.rem-dragging')).length === 0, 'Escape puts it back');
  // a click on the grip without moving changes nothing
  await drag(1, 0, 1); await page.mouse.up(); await page.waitForTimeout(50);
  ok((await texts(page)).join('|') === before.join('|'), 'a click on the grip moves nothing');
  // reload: the order is kept on the device
  await page.reload(); await page.waitForTimeout(300);
  await page.evaluate(() => switchTabByName('jobs'));
  ok((await texts(page)).join('|') === before.join('|'), 'order kept after a reload: ' + (await texts(page)).join(', '));
  // keyboard
  await (await page.$$('#rem-list .rem-grip'))[0].focus();
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  const kt = await texts(page);
  ok(kt[2] === before[0] && await page.evaluate(() => document.activeElement.className === 'rem-grip'), 'arrow keys move it, grip keeps focus: ' + kt.join(', '));
  // To-Invoice dates coloured too
  await page.evaluate(() => remShow('invoice'));
  await shot(await page.$('#rem-box'), 'rem-invoice.png');
  await page.evaluate(() => remShow('todo'));

  // a long list scrolls while dragging near its bottom edge
  const many = [];
  for (let i = 0; i < 30; i++) many.push(mk('m' + String(i).padStart(3, '0'), 'Customer ' + (i + 1), i * 0.3));
  await ctx.close();
  ({ ctx, page } = await open({ width: 1280, height: 700 }, many));
  const sc0 = await page.$eval('#rem-list', l => l.scrollTop);
  const lb = await (await page.$('#rem-list')).boundingBox();
  const g0 = await (await page.$$('#rem-list .rem-grip'))[0].boundingBox();
  await page.mouse.move(g0.x + 10, g0.y + 10); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(g0.x + 10, g0.y + 10 + (lb.y + lb.height - 8 - g0.y - 10) * i / 10);
  await page.waitForTimeout(700);
  const sc1 = await page.$eval('#rem-list', l => l.scrollTop);
  await page.mouse.up(); await page.waitForTimeout(50);
  const lt = await texts(page);
  ok(sc1 > sc0 + 50 && lt.indexOf('Customer 1') > 8, 'long list scrolls while dragging at its edge (scrolled ' + sc1 + 'px, dropped at ' + lt.indexOf('Customer 1') + ')');
  await ctx.close();

  // ---------- phone ----------
  ({ ctx, page } = await open({ width: 390, height: 844 }, items));
  await shot(await page.$('#rem-box'), 'rem-phone.png');
  const pw = await page.evaluate(() => ({ box: document.getElementById('rem-box').getBoundingClientRect().width, sw: document.documentElement.scrollWidth }));
  ok(pw.box <= 390 && pw.box > 300, 'phone: box fits the screen (' + Math.round(pw.box) + 'px)');
  // touch-style pointer events (pen / touch path): drag the 2nd name to the top
  const gb = await (await page.$$('#rem-list .rem-grip'))[1].boundingBox();
  const cdp = await ctx.newCDPSession(page);
  const tp = (type, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x: gb.x + gb.width / 2, y }] });
  await tp('touchStart', gb.y + gb.height / 2);
  for (let i = 1; i <= 10; i++) await tp('touchMove', gb.y + gb.height / 2 - (h * 1.4) * i / 10);
  await tp('touchEnd'); await page.waitForTimeout(80);
  const tt = await texts(page);
  ok(tt[0] === 'Kelly Signs', 'touch drag on a phone: ' + tt.join(', '));
  ok(await page.evaluate(() => window.scrollY) === 0, 'touch drag on the grip does not scroll the page');
  await ctx.close();

  ok(errs.length === 0, 'page errors: ' + errs.slice(0, 3).join(' | '));
  await browser.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: crashed: ' + (e && e.stack || e)); process.exit(1); });
