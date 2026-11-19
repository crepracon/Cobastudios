#!/usr/bin/env node
// Smoke test for photo-pdf/index.html (the Photo PDFs page) and its link in the estimator header.
//   NODE_PATH=$(npm root -g) node tools/smoke-photo-pdf.js [base-url]
// Serves the repo on a local port (a real http origin: the page needs a secure context for its test
// folder) unless a base URL such as https://crepracon.github.io/Cobastudios/ is given.
// Checks:
//  - static (CLAUDE.md hard rules): the script compiles, is plain ASCII with no backslash-u escapes,
//    and the page loads nothing from outside (no CDN, no fonts);
//  - the page loads with no script errors and makes no outside requests;
//  - colour: white, black and a red go through the FOGRA39 table as expected;
//  - the 4 sample photos export at 4x6 / 600 ppi into a private test folder: each PDF is checked
//    byte by byte (header, xref, page size, CMYK image size, output intent, image data inflates to
//    the right size, two colour swatches land in the right CMYK channels);
//  - exporting again skips the PDFs already there;
//  - localStorage: every call the page makes is logged, and it only ever touches coba-photo-pdf-v1;
//    seeded estimator keys stay byte-identical;
//  - no sideways scroll at phone width; the crop editor opens and closes;
//  - index.html has one Photo PDFs link in the header (new tab, hidden when printing) and
//    clicking it opens the page in a new tab.
// Plain ASCII only.
const fs = require('fs'), path = require('path'), http = require('http'), vm = require('vm');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OWN_KEY = 'coba-photo-pdf-v1';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };

// Runs inside the page: checks one PDF from the test folder. Kept as a plain function so the same
// code can be pasted into a browser console to check a deployed copy.
async function checkPdfInPage({ name, expect }) {
  const dir = await navigator.storage.getDirectory();
  const buf = await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer();
  const u8 = new Uint8Array(buf), txt = new TextDecoder('windows-1252').decode(u8), errs = [];
  if (!txt.startsWith('%PDF-1.4\n')) errs.push('header');
  const tail = /startxref\n(\d+)\n%%EOF\n$/.exec(txt);
  if (!tail) errs.push('trailer');
  const sx = tail ? +tail[1] : 0;
  if (txt.substr(sx, 4) !== 'xref') errs.push('startxref does not point at xref');
  const lines = txt.slice(sx).split('\n'), n = +(lines[1] || '').split(' ')[1];
  for (let i = 1; i < n; i++) {
    const off = parseInt(lines[2 + i].slice(0, 10), 10);
    if (!txt.startsWith(i + ' 0 obj', off)) errs.push('xref entry ' + i);
  }
  const mb = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(txt) || [];
  const im = /\/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceCMYK \/BitsPerComponent 8 \/Filter \/FlateDecode/.exec(txt) || [];
  const W = +im[1], H = +im[2];
  if (+mb[1] !== expect.w || +mb[2] !== expect.h) errs.push('page ' + mb[1] + ' x ' + mb[2]);
  if (W !== expect.pxW || H !== expect.pxH) errs.push('image ' + W + ' x ' + H);
  if (!/\/OutputIntents \[8 0 R\]/.test(txt) || !/\/DestOutputProfile 9 0 R/.test(txt)) errs.push('output intent');
  const len = +((/\n7 0 obj\n(\d+)\nendobj/.exec(txt) || [])[1]);
  const start = txt.indexOf('stream\n', txt.indexOf('\n4 0 obj')) + 7;
  if (txt.substr(start + len, 10) !== '\nendstream') errs.push('image length');
  const raw = new Uint8Array(await new Response(new Blob([u8.subarray(start, start + len)]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
  const row = W * 4 + 1;
  if (raw.length !== row * H) errs.push('image data ' + raw.length + ' bytes, expected ' + row * H);
  let filt = true;
  for (let y = 0; y < H; y++) if (raw[y * row] !== 2) { filt = false; break; }
  if (!filt) errs.push('row filters');
  const px = (fx, fy) => {   // undo the PNG Up predictor down one column
    const x = Math.floor(W * fx), y = Math.floor(H * fy), v = [0, 0, 0, 0];
    for (let r = 0; r <= y; r++) for (let c = 0; c < 4; c++) v[c] = (v[c] + raw[r * row + 1 + x * 4 + c]) & 255;
    return v;
  };
  return { errs, bytes: u8.length, swatches: expect.swatches ? [px(0.5 / 8, 0.95), px(2.5 / 8, 0.95)] : null };
}

function serve() {
  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json' };
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, path.normalize(p));
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    }).listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  // ---------- static checks ----------
  const page = fs.readFileSync(path.join(ROOT, 'photo-pdf', 'index.html'), 'utf8');
  const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m, n = 0;
  while ((m = re.exec(page))) {
    const body = m[2]; n++;
    try { new vm.Script(body); ok(true); } catch (e) { ok(false, 'script ' + n + ' does not compile: ' + e.message); }
    ok(!/[^\x00-\x7F]/.test(body), 'script ' + n + ' is plain ASCII');
    ok(body.indexOf('\\' + 'u') < 0, 'script ' + n + ' has no backslash-u escapes');
    ok(!/\ssrc=/.test(m[1] || ''), 'script ' + n + ' is inline');
  }
  ok(n === 1, 'one script block (found ' + n + ')');
  ok(!/[^\x00-\x7F]/.test(page), 'the whole page is plain ASCII (markup uses entities)');
  ok(!/<link[^>]+rel="?(stylesheet|preconnect)/i.test(page) && !/@import|url\(\s*["']?https?:/i.test(page), 'no stylesheets or fonts from outside');
  const est = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const links = est.match(/<a [^>]*href="photo-pdf\/"[^>]*>[^<]*<\/a>/g) || [];
  ok(links.length === 1, 'index.html has one link to photo-pdf/ (found ' + links.length + ')');
  ok(links.length === 1 && /target="_blank"/.test(links[0]) && /rel="noopener"/.test(links[0]) && /class="no-print"/.test(links[0]), 'the link opens a new tab and is hidden when printing');

  // ---------- browser checks ----------
  const srv = process.argv[2] ? null : await serve();
  let BASE = process.argv[2] || 'http://127.0.0.1:' + srv.address().port + '/';
  if (!BASE.endsWith('/')) BASE += '/';
  const ORIGIN = new URL(BASE).origin;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1366, height: 860 } });
  await ctx.addInitScript(() => {   // log every localStorage call the page makes
    const P = Storage.prototype, log = window.__lsLog = [];
    for (const f of ['getItem', 'setItem', 'removeItem', 'key', 'clear']) {
      const orig = P[f];
      P[f] = function (...a) { if (this === window.localStorage) log.push(f + ' ' + (a.length ? String(a[0]) : '')); return orig.apply(this, a); };
    }
  });
  const p = await ctx.newPage(), errs = [], outside = [];
  p.on('pageerror', e => errs.push(e.message));
  p.on('request', r => { const u = r.url(); if (!u.startsWith(ORIGIN) && !u.startsWith('blob:') && !u.startsWith('data:')) outside.push(u); });
  const url = BASE + 'photo-pdf/';
  await p.goto(url);
  const SEED = { 'coba-inventory-v2': '{"seed":"inventory"}', 'coba-jobs-v1': '{"seed":"jobs"}', 'coba-reminders-v1': '{"items":[]}',
    'coba-walkin-v1': '{"biz":"seed"}', 'coba-jobs-paid-open-v1': '1', 'coba-beta-signs-v1': '{"seed":"signs"}' };
  await p.evaluate(s => { for (const k in s) localStorage.setItem(k, s[k]); }, SEED);
  await p.reload();
  await p.waitForFunction(() => window.photoPdf && document.querySelector('#export'));
  ok((await p.textContent('h1')).trim() === 'Photo PDFs', 'page heading');
  ok((await p.title()).indexOf('Photo PDFs') >= 0, 'page title');
  ok(/4 . 6 in . 600 ppi . CMYK FOGRA39/.test(await p.textContent('#spec')), 'defaults: 4x6, 600 ppi, FOGRA39 (' + (await p.textContent('#spec')) + ')');

  // colour table
  const cm = await p.evaluate(async () => (await window.photoPdf.pool.run({ type: 'convert', rgb: [255, 255, 255, 0, 0, 0, 200, 60, 40], profiled: true })).cmyk);
  ok(cm.slice(0, 4).join() === '0,0,0,0', 'white -> no ink (' + cm.slice(0, 4) + ')');
  ok(cm[7] >= 200 && cm[4] + cm[5] + cm[6] + cm[7] <= 255 * 3.5, 'black -> rich black within ink limit (' + cm.slice(4, 8) + ')');
  ok(Math.abs(cm[8] - 0) <= 3 && Math.abs(cm[9] - 228) <= 3 && Math.abs(cm[10] - 236) <= 3 && Math.abs(cm[11] - 46) <= 3, 'sRGB 200,60,40 -> about 0,228,236,46 (' + cm.slice(8) + ')');

  // a settings change is saved under the page's own key
  await p.check('input[name=exists][value=replace]', { force: true });
  await p.check('input[name=exists][value=skip]', { force: true });

  // sample batch -> private test folder
  await p.click('#samples');
  await p.waitForFunction(() => window.photoPdf.items.length === 4 && window.photoPdf.items.every(i => i.status === 'ready'), null, { timeout: 120000 });
  await p.evaluate(async () => { const d = await navigator.storage.getDirectory(); for await (const [k] of d.entries()) await d.removeEntry(k); window.photoPdf.useFolder(d); });
  ok((await p.textContent('#export')).trim() === 'Export 4 PDFs', 'export button counts 4');
  const runExport = async () => {   // clear the old result first, so a fast run can't be mistaken for the last one
    await p.evaluate(() => { document.querySelector('#run-title').textContent = ''; document.querySelector('#run-stats').textContent = ''; });
    await p.click('#export');
    await p.waitForFunction(() => /finished|stopped/i.test(document.querySelector('#run-title').textContent) && !document.querySelector('#fs').disabled, null, { timeout: 300000 });
    return (await p.textContent('#run-stats')).trim();
  };
  const t0 = Date.now();
  const first = await runExport();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  ok(first === '4 saved', 'export: ' + first);
  const EXP = {
    'sample-lake-landscape.pdf': { w: 432, h: 288, pxW: 3600, pxH: 2400 },
    'sample-portrait-scan.pdf': { w: 288, h: 432, pxW: 2400, pxH: 3600, swatches: true },
    'sample-square.pdf': { w: 288, h: 432, pxW: 2400, pxH: 3600 },
    'sample-small-web-photo.pdf': { w: 432, h: 288, pxW: 3600, pxH: 2400 }
  };
  let total = 0;
  for (const name of Object.keys(EXP)) {
    const r = await p.evaluate(checkPdfInPage, { name, expect: EXP[name] }).catch(e => ({ errs: [e.message] }));
    ok(r.errs.length === 0, name + ': ' + r.errs.join(', '));
    total += r.bytes || 0;
    if (r.swatches) {
      const [cy, ye] = r.swatches;
      ok(cy[0] >= 150 && cy[1] <= 110 && cy[2] <= 60 && cy[3] <= 60, 'cyan swatch is mostly C (' + cy + ')');
      ok(ye[2] >= 180 && ye[0] <= 40 && ye[1] <= 60 && ye[3] <= 40, 'yellow swatch is mostly Y (' + ye + ')');
    }
  }
  console.log('exported 4 sample PDFs in ' + secs + ' s, ' + (total / 1e6).toFixed(1) + ' MB');

  // export again: everything is already there
  const second = await runExport();
  ok(second === '0 saved ' + String.fromCharCode(183) + ' 4 already there', 'second export skips: ' + second);

  // localStorage: only its own key, estimator keys untouched
  const st = await p.evaluate(() => {
    const log = window.__lsLog.slice(), all = {};   // copy the log first: the loop below is logged too
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); all[k] = localStorage.getItem(k); }
    return { all, log };
  });
  for (const k of Object.keys(SEED)) ok(st.all[k] === SEED[k], 'estimator key ' + k + ' unchanged');
  const extra = Object.keys(st.all).filter(k => !(k in SEED));
  ok(extra.length === 1 && extra[0] === OWN_KEY, 'only ' + OWN_KEY + ' was added (found: ' + extra.join(', ') + ')');
  let saved = {}; try { saved = JSON.parse(st.all[OWN_KEY]); } catch (e) { /* checked below */ }
  ok(saved.size === '4x6' && saved.ppi === 600, 'own key holds the job settings');
  const foreign = st.log.filter(e => e.split(' ')[1] !== OWN_KEY);
  ok(st.log.length > 0 && foreign.length === 0, 'every localStorage call was for ' + OWN_KEY + ' (others: ' + foreign.slice(0, 5).join('; ') + ')');

  // editor, phone width
  await p.locator('.card .sheet').first().click();
  ok(await p.evaluate(() => document.querySelector('#editor').open), 'crop editor opens');
  await p.keyboard.press('Escape');
  ok(!(await p.evaluate(() => document.querySelector('#editor').open)), 'Escape closes it');
  await p.setViewportSize({ width: 400, height: 860 });
  await p.waitForTimeout(200);
  ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no sideways scroll at 400 px');
  ok(errs.length === 0, 'no script errors: ' + errs.join(' | '));
  ok(outside.length === 0, 'no outside requests: ' + outside.slice(0, 3).join(', '));
  await p.evaluate(async () => { const d = await navigator.storage.getDirectory(); for await (const [k] of d.entries()) await d.removeEntry(k); });

  // estimator header link opens the page in a new tab
  const c2 = await b.newContext({ viewport: { width: 1366, height: 860 } });
  const e = await c2.newPage();
  await e.goto(BASE);
  const link = e.locator('.app-header a[href="photo-pdf/"]');
  ok(await link.count() === 1 && (await link.textContent()).indexOf('Photo PDFs') >= 0, 'Photo PDFs link in the estimator header');
  ok(await link.isVisible(), 'link visible on screen');
  const [tab] = await Promise.all([c2.waitForEvent('page'), link.click()]);
  await tab.waitForLoadState('domcontentloaded');
  ok(tab.url() === url, 'link opened ' + tab.url() + ' in a new tab');
  ok((await tab.textContent('h1')).trim() === 'Photo PDFs', 'new tab shows the Photo PDFs page');
  ok(e.url() === BASE, 'estimator tab stayed on the estimator');
  await e.emulateMedia({ media: 'print' });
  ok(!(await link.isVisible()), 'link hidden when printing');

  await b.close();
  if (srv) srv.close();
  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('TEST ERROR', e); process.exit(1); });
