#!/usr/bin/env node
// Smoke test for roll waste in Vinyl / Roland > Stickers and Signage (v53 full roll width, v54 real spacing).
//   NODE_PATH=$(npm root -g) node tools/smoke-vinyl-waste.js [index.html]
// Needs Playwright. Headless, network blocked (like an offline shop computer). Plain ASCII only.
// Checks: vinyl + laminate charged at the full roll width and ink on the printed area; v54 spacing (Gap between prints
// 0.5 in, Start + end margin 2 in per job, each piece whichever way round uses the least roll); the same job costs the
// same in Stickers and Signage; Signage prices and classic sticker prices are unchanged; pieces wider than the roll are
// split into panels; a roll size in the Inventory notes (24x50ft) is used; panels saved before v53 keep the old math,
// panels saved in v53 keep 8 in per row, and New estimate brings the v54 panel back.
const path = require('path');
const { chromium } = require('playwright');
const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));

(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
  const near = (a, b) => Math.abs(a - b) < 0.006, r2 = x => Math.round(x * 100) / 100;
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1200, height: 900 } }); const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/^https?:\/\//, r => r.abort());
  await p.goto('file://' + SRC); await p.waitForTimeout(500);
  await p.evaluate(() => {
    window.T = {
      pick(id, name){ const s = document.getElementById(id); const i = Array.from(s.options).findIndex(o => o.text.trim().startsWith(name)); s.selectedIndex = i; return i >= 0; },
      money(id){ const e = document.getElementById(id); return e ? parseFloat(e.textContent.replace(/[^0-9.]/g, '')) : NaN; },
      text(id){ const e = document.getElementById(id); return e ? e.textContent : ''; },
      on(t){ const c = document.getElementById('r-' + t + '-on'); if(!c.checked){ c.checked = true; rToggle(t); } },
      off(t){ const c = document.getElementById('r-' + t + '-on'); if(c.checked){ c.checked = false; rToggle(t); } },
      row(t, w, h, q, sides){ const id = (t === 'stk' ? rStkRows : rSgnRows)[0];
        document.getElementById(id + '-w').value = w; document.getElementById(id + '-h').value = h; document.getElementById(id + '-q').value = q;
        const sd = document.getElementById(id + '-sd'); if(sd) sd.value = String(sides || 1); rCalc(); return id; },
      stk(w, h, q, vinyl, lam, mode){ T.off('sgn'); T.on('stk'); T.pick('r-stk-vinyl', vinyl); if(lam) T.pick('r-stk-lam-type', lam); else document.getElementById('r-stk-lam-type').value = '';
        document.getElementById('r-stk-mode').value = mode || 'market'; const id = T.row('stk', w, h, q);
        return { sf: T.text(id + '-sf'), co: T.money(id + '-co'), rt: T.money(id + '-rt'), ps: T.text(id + '-ps'), psTitle: (document.getElementById(id + '-ps') || {}).title || '', roll: T.text('r-stk-roll'), box: document.getElementById('r-stk-mkt').innerHTML }; },
      sgn(w, h, q, sides, vinyl, sub, lam){ T.off('stk'); T.on('sgn'); T.pick('r-sgn-vinyl', vinyl);
        if(sub) T.pick('r-sgn-sub', sub); else document.getElementById('r-sgn-sub').value = '';
        if(lam) T.pick('r-sgn-lam-type', lam); else document.getElementById('r-sgn-lam-type').value = '';
        const id = T.row('sgn', w, h, q, sides);
        return { co: T.money(id + '-co'), rt: T.money(id + '-rt'), film: T.text('r-sgn-film'), sub: parseFloat(document.getElementById('r-sgn-sub').value) || 0,
          tcost: T.money('r-tt-cost'), tquote: T.money('r-tt-quote') }; }
    };
    switchTabByName('vinyl');
  });
  const set = await p.evaluate(() => ({ gap: document.getElementById('r-gap').value, edge: document.getElementById('r-job-feed').value, reg: !!document.getElementById('r-reg-overhead') }));
  ok(set.gap === '0.5' && set.edge === '2' && !set.reg, 'settings: Gap between prints 0.5, Start + end margin 2, no Registry / cut overhead (got ' + JSON.stringify(set) + ')');

  // 1. Chris's 44 x 86 window piece: one row, 86 + 2 = 88 in of the 54 in roll (33 sq ft), ink on 26.278 sq ft printed
  const exp1 = r2((54 * 88 / 144) * (0.56 + 0.63) + (44 * 86 / 144) * 0.5);
  const s1 = await p.evaluate(() => T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s1.sf.indexOf('33.000') === 0 && /^1 pass/.test(s1.ps), 'stickers 44x86: 1 row, material 33.000 sq ft (got ' + s1.sf + ', ' + s1.ps + ')');
  ok(near(s1.co, exp1), 'stickers 44x86: cost $' + exp1 + ' (got ' + s1.co + ')');
  ok(near(s1.rt, 99.29), 'stickers 44x86: classic fallback price unchanged at $99.29 (got ' + s1.rt + ')');
  ok(/full 54 in roll width/.test(s1.roll) && /26\.278 sq ft printed/.test(s1.roll), 'stickers info says full 54 in width and ink on the printed area (got ' + s1.roll + ')');
  ok(s1.box.indexOf('$' + exp1.toFixed(2)) >= 0, 'quantity price breaks use the same cost');

  const g1 = await p.evaluate(() => T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate'));
  ok(near(g1.co, exp1), 'signage 44x86: same cost as stickers, $' + exp1 + ' (got ' + g1.co + ')');
  ok(near(g1.rt, 315.33), 'signage 44x86: price unchanged at $315.33 (got ' + g1.rt + ')');
  ok(/33\.000 sq ft/.test(g1.film) && /full 54 in/.test(g1.film), 'signage shows vinyl used on the full roll (got ' + g1.film + ')');
  ok(near(g1.tcost, exp1) && near(g1.tquote, 315.33), 'Vinyl tab totals follow (cost ' + g1.tcost + ', quote ' + g1.tquote + ')');

  // 2. Chris's VersaWorks screenshot (Nov 19 2026): 8 x 12 sheets sit 5 across, short side across, in one row (12 + 2 = 14 in)
  const s2 = await p.evaluate(() => T.stk(8, 12, 5, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(/^1 pass/.test(s2.ps) && s2.sf.indexOf('5.250') === 0, '8x12 x5: one row of 5, 5.250 sq ft (got ' + s2.ps + ', ' + s2.sf + ')');

  // 3. Wider than the roll both ways: 60 x 86 = 2 panels of 60 x 43.5 (horizontal seam, the least roll), 2 x 60 + 0.5 + 2 = 122.5 in
  const exp3 = r2((54 * 122.5 / 144) * (0.56 + 0.63) + (60 * 86 / 144) * 0.5);
  const s3 = await p.evaluate(() => T.stk(60, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s3.sf.indexOf('45.938') === 0 && /^2 passes/.test(s3.ps) && /2 panels/.test(s3.psTitle), 'stickers 60x86: 2 panels, 45.938 sq ft (got ' + s3.sf + ', ' + s3.ps + ')');
  ok(near(s3.co, exp3), 'stickers 60x86: cost ' + exp3 + ' (got ' + s3.co + ')');
  const g3 = await p.evaluate(() => T.sgn(60, 86, 1, 1, 'Matte Vinyl', '', 'Gloss Laminate'));
  ok(near(g3.co, s3.co), 'signage 60x86 costs the same as stickers (got ' + g3.co + ')');

  // 4. A 24 in roll from the Inventory notes (Magnetic 30mil 24x50ft, 20 in usable): 18 across, 12 + 2 = 14 in, no laminate
  const exp4 = r2((24 * 14 / 144) * 1.65 + (12 * 18 / 144) * 0.5);
  const g4 = await p.evaluate(() => T.sgn(12, 18, 1, 1, 'Magnetic', '', ''));
  ok(near(g4.co, exp4), 'magnetic 12x18 on its 24 in roll: ' + exp4 + ' (got ' + g4.co + ')');
  ok(/full 24 in/.test(g4.film), 'magnetic uses the 24 in roll (got ' + g4.film + ')');

  // 5. 2 sided signs on a board: faces printed together, board once; price formula unchanged
  const g5 = await p.evaluate(() => T.sgn(24, 18, 2, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate'));
  const exp5 = r2((54 * 38.5 / 144) * (0.56 + 0.56) + (24 * 18 * 4 / 144) * 0.5 + (24 * 18 * 2 / 144) * g5.sub);
  ok(near(g5.co, exp5), '2 sided 24x18 x2 on a board: ' + exp5 + ' (got ' + g5.co + ', board ' + g5.sub + ')');
  const face = 0.56 + 0.5 + 0.56, exp5r = r2(6 * 12 * (face + g5.sub > 0 ? (2 * face + g5.sub) / (face + g5.sub) : 2));
  ok(near(g5.rt, exp5r), '2 sided price unchanged: ' + exp5r + ' (got ' + g5.rt + ')');

  // 6. Chris's Nov 19 sign job: 24 x 18 x 10, 2 sided, 4mm Coroplast ($0.52): 10 rows x 18 + 9 gaps + 2 = 186.5 in = $123.93 (v53: $154.80)
  const g6 = await p.evaluate(() => T.sgn(24, 18, 10, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate'));
  ok(g6.sub === 0.52 && near(g6.co, 123.93) && near(g6.rt, 632.52), '24x18 x10 2 sided on coroplast: $123.93, price $632.52 (got ' + g6.co + ', ' + g6.rt + ')');
  ok(/69\.938 sq ft/.test(g6.film), 'sign job uses 69.938 sq ft of vinyl (got ' + g6.film + ')');

  // 7. Classic sticker prices keep the basis they were tuned on (old film math, 8 in per row): 4 x 4 x 20, small run x2.7
  const s7 = await p.evaluate(() => T.stk(4, 4, 20, 'Matte Vinyl', 'Gloss Laminate', 'classic'));
  const old7 = 2 * 50 * (4 + 8) / 144 * (0.56 + 0.5 + 0.63), exp7 = r2(Math.max(old7 * 2.7, 20 * 1.5));
  ok(near(s7.rt, exp7), 'classic 4x4 x20 price unchanged at ' + exp7 + ' (got ' + s7.rt + ')');

  // 8. A panel saved in v53 (Registry / cut overhead 8, no Gap input) keeps 8 in per row; New estimate brings the v54 panel back
  const v53 = await p.evaluate(() => {
    ['r-gap', 'r-job-feed'].forEach(id => { const e = document.getElementById(id); if(e) e.closest('.rate-item').remove(); });
    const d = document.createElement('div'); d.className = 'rate-item';
    d.innerHTML = 'Registry / cut overhead: <input type="number" id="r-reg-overhead" value="8" oninput="rCalc()"> in';
    document.getElementById('r-roll-w').closest('.rate-bar').appendChild(d);
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), sg = T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate');
    const job = T.sgn(24, 18, 10, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, sg, job, back: !!document.getElementById('r-gap') && !document.getElementById('r-reg-overhead') };
  });
  ok(v53.st.sf.indexOf('35.250') === 0 && near(v53.st.co, 55.09), 'v53 sticker panel: 35.250 sq ft, $55.09 (got ' + v53.st.sf + ', ' + v53.st.co + ')');
  ok(near(v53.sg.co, 55.09) && near(v53.job.co, 154.80), 'v53 signage panel: $55.09 and the sign job $154.80 (got ' + v53.sg.co + ', ' + v53.job.co + ')');
  ok(v53.back, 'New estimate restores the v54 panel');

  // 9. A panel saved before v53 (no Full roll width input) keeps the old math; New estimate brings the v54 panel back
  const old = await p.evaluate(() => {
    ['r-roll-full', 'r-tile-ov', 'r-gap', 'r-job-feed'].forEach(id => { const e = document.getElementById(id); if(e) e.closest('.rate-item').remove(); });
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), sg = T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, sg, back: !!document.getElementById('r-roll-full') && !!document.getElementById('r-gap') };
  });
  ok(old.st.sf.indexOf('32.639') === 0 && near(old.st.co, 55.16) && near(old.st.rt, 99.29), 'old sticker panel: 32.639 sq ft, $55.16, $99.29 (got ' + old.st.sf + ', ' + old.st.co + ')');
  ok(near(old.sg.co, 44.41) && near(old.sg.rt, 315.33) && old.sg.film === '', 'old signage panel: $44.41, $315.33 (got ' + old.sg.co + ')');
  ok(old.back, 'New estimate restores the v54 panel');

  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
