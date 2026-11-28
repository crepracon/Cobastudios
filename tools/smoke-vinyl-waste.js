#!/usr/bin/env node
// Smoke test for roll and board waste in Vinyl / Roland > Stickers and Signage
// (v53 full roll width, v54 real spacing, v56 12 in start + end margin and the board strip).
//   NODE_PATH=$(npm root -g) node tools/smoke-vinyl-waste.js [index.html]
// Needs Playwright. Headless, network blocked (like an offline shop computer). Plain ASCII only.
// Checks: vinyl + laminate charged at the full roll width and ink on the printed area; spacing (Gap between prints
// 0.5 in, Start + end margin 12 in per run, each piece whichever way round uses the least roll); boards charged for the
// strip of the 4x8 sheet they use; the same job costs the same in Stickers and Signage (no board); Signage prices and
// classic sticker prices are unchanged; pieces wider than the roll are split into panels; a roll size in the Inventory
// notes (24x50ft) is used; panels saved before v53 keep the old math, v53 panels 8 in per row, v54 / v55 panels a 2 in
// margin and the board on the sign area; New estimate brings the v56 panel back.
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
        return { sf: T.text(id + '-sf'), co: T.money(id + '-co'), rt: T.money(id + '-rt'), hasPs: !!document.getElementById(id + '-ps'), sfTitle: (document.getElementById(id + '-sf') || {}).title || '',   /* v61: no Passes column; the panels note is on the Material sq ft hover */ roll: T.text('r-stk-roll'), box: document.getElementById('r-stk-mkt').innerHTML }; },
      sgn(w, h, q, sides, vinyl, sub, lam){ T.off('stk'); T.on('sgn'); T.pick('r-sgn-vinyl', vinyl);
        if(sub) T.pick('r-sgn-sub', sub); else document.getElementById('r-sgn-sub').value = '';
        if(lam) T.pick('r-sgn-lam-type', lam); else document.getElementById('r-sgn-lam-type').value = '';
        const id = T.row('sgn', w, h, q, sides);
        return { co: T.money(id + '-co'), rt: T.money(id + '-rt'), film: T.text('r-sgn-film'), sub: parseFloat(document.getElementById('r-sgn-sub').value) || 0,
          vin: parseFloat(document.getElementById('r-sgn-vinyl').value) || 0, lam: parseFloat(document.getElementById('r-sgn-lam-type').value) || 0,
          tip: (document.getElementById(id + '-sf') || {}).title || '', tcost: T.money('r-tt-cost'), tquote: T.money('r-tt-quote') }; }
    };
    switchTabByName('vinyl');
  });
  const set = await p.evaluate(() => ({ gap: document.getElementById('r-gap').value, edge: document.getElementById('r-job-feed').value,
    board: (document.getElementById('r-board-mode') || {}).value, reg: !!document.getElementById('r-reg-overhead'),
    sheet: (Array.from(document.getElementById('r-sgn-sub').options).find(o => /3mm Aluminum/.test(o.text)) || { getAttribute: () => null }).getAttribute('data-sheet') }));
  ok(set.gap === '0.5' && set.edge === '12' && set.board === 'strip' && !set.reg && set.sheet === '48x96',
    'settings: Gap 0.5, Start + end margin 12, Board cost = strip, no Registry / cut overhead, 4x8ft = 48x96 (got ' + JSON.stringify(set) + ')');

  // 1. Chris's 44 x 86 window piece: one run, 86 + 12 = 98 in of the 54 in roll (36.75 sq ft), ink on 26.278 sq ft printed
  const exp1 = r2((54 * 98 / 144) * (0.56 + 0.63) + (44 * 86 / 144) * 0.5);
  const s1 = await p.evaluate(() => T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s1.sf.indexOf('36.750') === 0 && !s1.hasPs, 'stickers 44x86: 1 row (54 x 98 in), material 36.750 sq ft, no Passes cell (got ' + s1.sf + ')');
  ok(near(s1.co, exp1), 'stickers 44x86: cost $' + exp1 + ' (got ' + s1.co + ')');
  ok(near(s1.rt, 99.29), 'stickers 44x86: classic fallback price unchanged at $99.29 (got ' + s1.rt + ')');
  ok(/full 54 in roll width/.test(s1.roll) && /26\.278 sq ft printed/.test(s1.roll), 'stickers info says full 54 in width and ink on the printed area (got ' + s1.roll + ')');
  ok(s1.box.indexOf('$' + exp1.toFixed(2)) >= 0, 'quantity price breaks use the same cost');

  const g1 = await p.evaluate(() => T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate'));
  ok(near(g1.co, exp1), 'signage 44x86 (no board): same cost as stickers, $' + exp1 + ' (got ' + g1.co + ')');
  ok(near(g1.rt, 315.33), 'signage 44x86: price unchanged at $315.33 (got ' + g1.rt + ')');
  ok(/36\.750 sq ft/.test(g1.film) && /full 54 in/.test(g1.film) && !/board/.test(g1.film), 'signage shows vinyl used on the full roll, no board (got ' + g1.film + ')');
  ok(near(g1.tcost, exp1) && near(g1.tquote, 315.33), 'Vinyl tab totals follow (cost ' + g1.tcost + ', quote ' + g1.tquote + ')');

  // 2. Chris's VersaWorks screenshot: 8 x 12 sheets sit 5 across, short side across, in one row (12 + 12 = 24 in)
  const s2 = await p.evaluate(() => T.stk(8, 12, 5, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s2.sf.indexOf('9.000') === 0 && !s2.hasPs, '8x12 x5: one row of 5 (54 x 24 in), 9.000 sq ft (got ' + s2.sf + ')');

  // 3. Wider than the roll both ways: 60 x 86 = 2 panels of 60 x 43.5 (horizontal seam, the least roll), 2 x 60 + 0.5 + 12 = 132.5 in
  const exp3 = r2((54 * 132.5 / 144) * (0.56 + 0.63) + (60 * 86 / 144) * 0.5);
  const s3 = await p.evaluate(() => T.stk(60, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s3.sf.indexOf('49.688') === 0 && /each piece is printed in 2 panels/.test(s3.sfTitle) && !s3.hasPs, 'stickers 60x86: 2 panels (said on the Material sq ft hover), 49.688 sq ft (got ' + s3.sf + ', ' + s3.sfTitle + ')');
  ok(near(s3.co, exp3), 'stickers 60x86: cost ' + exp3 + ' (got ' + s3.co + ')');
  const g3 = await p.evaluate(() => T.sgn(60, 86, 1, 1, 'Matte Vinyl', '', 'Gloss Laminate'));
  ok(near(g3.co, s3.co), 'signage 60x86 costs the same as stickers (got ' + g3.co + ')');

  // 4. A 24 in roll from the Inventory notes (Magnetic 30mil 24x50ft, 20 in usable): 18 across, 12 + 12 = 24 in, no laminate
  const exp4 = r2((24 * 24 / 144) * 1.65 + (12 * 18 / 144) * 0.5);
  const g4 = await p.evaluate(() => T.sgn(12, 18, 1, 1, 'Magnetic', '', ''));
  ok(near(g4.co, exp4), 'magnetic 12x18 on its 24 in roll: ' + exp4 + ' (got ' + g4.co + ')');
  ok(/full 24 in/.test(g4.film), 'magnetic uses the 24 in roll (got ' + g4.film + ')');

  // 5. 2 sided signs on a board: faces printed together, board once (2 across the 48 in sheet, an 18 in strip); price unchanged
  const g5 = await p.evaluate(() => T.sgn(24, 18, 2, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate'));
  const exp5 = r2((54 * 48.5 / 144) * (0.56 + 0.56) + (24 * 18 * 4 / 144) * 0.5 + (48 * 18 / 144) * g5.sub);
  ok(near(g5.co, exp5), '2 sided 24x18 x2 on a board: ' + exp5 + ' (got ' + g5.co + ', board ' + g5.sub + ')');
  const face = 0.56 + 0.5 + 0.56, exp5r = r2(6 * 12 * (face + g5.sub > 0 ? (2 * face + g5.sub) / (face + g5.sub) : 2));
  ok(near(g5.rt, exp5r), '2 sided price unchanged: ' + exp5r + ' (got ' + g5.rt + ')');

  // 6. Chris's Nov 19 sign job: 24 x 18 x 10, 2 sided, 4mm Coroplast ($0.52): 10 rows x 18 + 9 gaps + 12 = 196.5 in of roll;
  //    board 2 across x 5 rows = one whole 4x8 sheet (32 sq ft, its 6 in end scrap included)
  const exp6 = r2((54 * 196.5 / 144) * 1.12 + 60 * 0.5 + 32 * 0.52);
  const g6 = await p.evaluate(() => T.sgn(24, 18, 10, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate'));
  ok(g6.sub === 0.52 && near(g6.co, exp6) && near(g6.rt, 632.52), '24x18 x10 2 sided on coroplast: $' + exp6 + ', price $632.52 (got ' + g6.co + ', ' + g6.rt + ')');
  ok(/73\.688 sq ft/.test(g6.film) && /board used: 32\.000 sq ft \(48 in sheet width\)/.test(g6.film), 'sign job: 73.688 sq ft of vinyl, 32 sq ft of board (got ' + g6.film + ')');

  // 7. Chris's 40 x 40, 2 sided, 3mm Aluminum, Nekoosa NextBond + gloss laminate (Nov 19 2026): both faces in one run
  //    (40 + 0.5 + 40 + 12 = 92.5 in), ink on the 2 faces, board = the 48 x 40 strip of the sheet (13.333 sq ft)
  const g7 = await p.evaluate(() => T.sgn(40, 40, 1, 2, 'Nekoosa NextBond White', '3mm Aluminum', 'Nekoosa NextBond Gloss'));
  const exp7 = r2((54 * 92.5 / 144) * (g7.vin + g7.lam) + (40 * 40 * 2 / 144) * 0.5 + (48 * 40 / 144) * g7.sub);
  ok(g7.vin === 0.69 && g7.lam === 0.52 && g7.sub === 2.03 && near(g7.co, exp7) && near(exp7, 80.15) && near(g7.rt, 194.30),
    '40x40 2 sided on 3mm aluminum: $80.15, price $194.30 (got ' + g7.co + ', ' + g7.rt + ', rates ' + [g7.vin, g7.lam, g7.sub] + ')');
  ok(/34\.688 sq ft/.test(g7.film) && /board used: 13\.333 sq ft/.test(g7.film) && /48 in sheet width x 40 in/.test(g7.tip), '40x40: vinyl 34.688, board 13.333 sq ft (got ' + g7.film + ' / ' + g7.tip + ')');
  const g7s = await p.evaluate(() => { document.getElementById('r-board-mode').value = 'sign'; rCalc(); const c = T.money(rSgnRows[0] + '-co'); document.getElementById('r-board-mode').value = 'strip'; rCalc(); return c; });
  ok(near(g7s, r2((54 * 92.5 / 144) * 1.21 + (40 * 40 * 2 / 144) * 0.5 + (40 * 40 / 144) * 2.03)), 'Board cost = Just the sign: board on the 11.1 sq ft sign area (got ' + g7s + ')');

  // 8. Classic sticker prices keep the basis they were tuned on (old film math, 8 in per row): 4 x 4 x 20, small run x2.7
  const s8 = await p.evaluate(() => T.stk(4, 4, 20, 'Matte Vinyl', 'Gloss Laminate', 'classic'));
  const old8 = 2 * 50 * (4 + 8) / 144 * (0.56 + 0.5 + 0.63), exp8 = r2(Math.max(old8 * 2.7, 20 * 1.5));
  ok(near(s8.rt, exp8), 'classic 4x4 x20 price unchanged at ' + exp8 + ' (got ' + s8.rt + ')');

  // 9. A panel saved in v54 / v55 (margin 2, no Board cost select) keeps the 2 in margin and the board on the sign area
  const v54 = await p.evaluate(() => {
    const bm = document.getElementById('r-board-mode'); if(bm) bm.closest('.rate-item').remove();
    document.getElementById('r-job-feed').value = '2';
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), job = T.sgn(24, 18, 10, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, job, back: !!document.getElementById('r-board-mode') && document.getElementById('r-job-feed').value === '12' };
  });
  ok(near(v54.st.co, 52.41) && near(v54.job.co, 123.93) && !/board/.test(v54.job.film), 'v54 panel: 44x86 $52.41, sign job $123.93, board on the sign area (got ' + v54.st.co + ', ' + v54.job.co + ')');
  ok(v54.back, 'New estimate restores the v56 panel (Board cost, 12 in margin)');

  // 10. A panel saved in v53 (Registry / cut overhead 8, no Gap input) keeps 8 in per row
  const v53 = await p.evaluate(() => {
    ['r-gap', 'r-job-feed', 'r-board-mode'].forEach(id => { const e = document.getElementById(id); if(e) e.closest('.rate-item').remove(); });
    const d = document.createElement('div'); d.className = 'rate-item';
    d.innerHTML = 'Registry / cut overhead: <input type="number" id="r-reg-overhead" value="8" oninput="rCalc()"> in';
    document.getElementById('r-roll-w').closest('.rate-bar').appendChild(d);
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), sg = T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate');
    const job = T.sgn(24, 18, 10, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, sg, job, back: !!document.getElementById('r-gap') && !!document.getElementById('r-board-mode') && !document.getElementById('r-reg-overhead') };
  });
  ok(v53.st.sf.indexOf('35.250') === 0 && near(v53.st.co, 55.09), 'v53 sticker panel: 35.250 sq ft, $55.09 (got ' + v53.st.sf + ', ' + v53.st.co + ')');
  ok(near(v53.sg.co, 55.09) && near(v53.job.co, 154.80), 'v53 signage panel: $55.09 and the sign job $154.80 (got ' + v53.sg.co + ', ' + v53.job.co + ')');
  ok(v53.back, 'New estimate restores the v56 panel');

  // 11. A panel saved before v53 (no Full roll width input) keeps the old math
  const old = await p.evaluate(() => {
    ['r-roll-full', 'r-tile-ov', 'r-gap', 'r-job-feed', 'r-board-mode'].forEach(id => { const e = document.getElementById(id); if(e) e.closest('.rate-item').remove(); });
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), sg = T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, sg, back: !!document.getElementById('r-roll-full') && !!document.getElementById('r-board-mode') };
  });
  ok(old.st.sf.indexOf('32.639') === 0 && near(old.st.co, 55.16) && near(old.st.rt, 99.29), 'old sticker panel: 32.639 sq ft, $55.16, $99.29 (got ' + old.st.sf + ', ' + old.st.co + ')');
  ok(near(old.sg.co, 44.41) && near(old.sg.rt, 315.33) && old.sg.film === '', 'old signage panel: $44.41, $315.33 (got ' + old.sg.co + ')');
  ok(old.back, 'New estimate restores the v56 panel');

  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
