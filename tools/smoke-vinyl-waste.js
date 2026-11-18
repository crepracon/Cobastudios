#!/usr/bin/env node
// Smoke test for v53 roll waste in Vinyl / Roland > Stickers and Signage.
//   NODE_PATH=$(npm root -g) node tools/smoke-vinyl-waste.js [index.html]
// Needs Playwright. Headless, network blocked (like an offline shop computer). Plain ASCII only.
// Checks: vinyl + laminate charged at the full roll width and ink on the printed area; the same job costs the same in
// Stickers and Signage; Signage prices are unchanged; classic sticker prices are unchanged; pieces wider than the roll
// are split into panels; a roll size in the Inventory notes (24x50ft) is used; panels saved before v53 keep the old math
// and New estimate brings the v53 panel back.
const path = require('path');
const { chromium } = require('playwright');
const SRC = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));

(async () => {
  let pass = 0, fail = 0; const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
  const near = (a, b) => Math.abs(a - b) < 0.006;
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

  // 1. Chris's 44 x 86 window piece (Nov 18 2026): 54 x 94 in of vinyl and laminate, ink on 26.278 sq ft printed = $55.09
  const s1 = await p.evaluate(() => T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s1.sf.indexOf('35.250') === 0, 'stickers 44x86: material 35.250 sq ft (got ' + s1.sf + ')');
  ok(near(s1.co, 55.09), 'stickers 44x86: cost $55.09 (got ' + s1.co + ')');
  ok(near(s1.rt, 99.29), 'stickers 44x86: classic fallback price unchanged at $99.29 (got ' + s1.rt + ')');
  ok(/full 54 in roll width/.test(s1.roll) && /26\.278 sq ft printed/.test(s1.roll), 'stickers info says full 54 in width and ink on the printed area (got ' + s1.roll + ')');
  ok(s1.box.indexOf('$55.09') >= 0, 'quantity price breaks use the same cost');

  const g1 = await p.evaluate(() => T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate'));
  ok(near(g1.co, 55.09), 'signage 44x86: same cost as stickers, $55.09 (got ' + g1.co + ')');
  ok(near(g1.rt, 315.33), 'signage 44x86: price unchanged at $315.33 (got ' + g1.rt + ')');
  ok(/35\.250 sq ft/.test(g1.film) && /full 54 in/.test(g1.film), 'signage shows vinyl used on the full roll (got ' + g1.film + ')');
  ok(near(g1.tcost, 55.09) && near(g1.tquote, 315.33), 'Vinyl tab totals follow (cost ' + g1.tcost + ', quote ' + g1.tquote + ')');

  // 2. Wider than the roll both ways: 60 x 86 = 2 panels of 30.5 in, 2 rows x 94 in on the 54 in roll = 70.5 sq ft
  const exp2 = 70.5 * (0.56 + 0.63) + (60 * 86 / 144) * 0.5;
  const s2 = await p.evaluate(() => T.stk(60, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'));
  ok(s2.sf.indexOf('70.500') === 0 && /^2 passes/.test(s2.ps) && /2 panels/.test(s2.psTitle), 'stickers 60x86: 2 panels, 70.500 sq ft (got ' + s2.sf + ', ' + s2.ps + ')');
  ok(near(s2.co, Math.round(exp2 * 100) / 100), 'stickers 60x86: cost ' + exp2.toFixed(2) + ' (got ' + s2.co + ')');
  const g2 = await p.evaluate(() => T.sgn(60, 86, 1, 1, 'Matte Vinyl', '', 'Gloss Laminate'));
  ok(near(g2.co, s2.co), 'signage 60x86 costs the same as stickers (got ' + g2.co + ')');

  // 3. A 24 in roll from the Inventory notes (Magnetic 30mil 24x50ft): 24 x 20 in run, no laminate
  const g3 = await p.evaluate(() => T.sgn(12, 18, 1, 1, 'Magnetic', '', ''));
  const exp3 = (24 * 20 / 144) * 1.65 + (12 * 18 / 144) * 0.5;
  ok(near(g3.co, Math.round(exp3 * 100) / 100), 'magnetic 12x18 on its 24 in roll: ' + exp3.toFixed(2) + ' (got ' + g3.co + ')');
  ok(/full 24 in/.test(g3.film), 'magnetic uses the 24 in roll (got ' + g3.film + ')');

  // 4. 2 sided signs on a board: faces printed separately, board once; price formula unchanged
  const g4 = await p.evaluate(() => T.sgn(24, 18, 2, 2, 'Matte Vinyl', '4mm Coroplast', 'Matte Laminate'));
  const exp4 = (54 * 52 / 144) * (0.56 + 0.56) + (24 * 18 * 4 / 144) * 0.5 + (24 * 18 * 2 / 144) * g4.sub;
  ok(near(g4.co, Math.round(exp4 * 100) / 100), '2 sided 24x18 x2 on a board: ' + exp4.toFixed(2) + ' (got ' + g4.co + ', board ' + g4.sub + ')');
  const face = 0.56 + 0.5 + 0.56, exp4r = 6 * 12 * (face + g4.sub > 0 ? (2 * face + g4.sub) / (face + g4.sub) : 2);
  ok(near(g4.rt, Math.round(exp4r * 100) / 100), '2 sided price unchanged: ' + exp4r.toFixed(2) + ' (got ' + g4.rt + ')');

  // 5. Classic sticker prices keep the basis they were tuned on (old film math): 4 x 4 x 20, small run x2.7
  const s5 = await p.evaluate(() => T.stk(4, 4, 20, 'Matte Vinyl', 'Gloss Laminate', 'classic'));
  const old5 = 2 * 50 * (4 + 8) / 144 * (0.56 + 0.5 + 0.63), exp5 = Math.max(old5 * 2.7, 20 * 1.5);
  ok(near(s5.rt, Math.round(exp5 * 100) / 100), 'classic 4x4 x20 price unchanged at ' + exp5.toFixed(2) + ' (got ' + s5.rt + ')');

  // 6. A panel saved before v53 (no Full roll width input) keeps the old math; New estimate brings the v53 panel back
  const old = await p.evaluate(() => {
    ['r-roll-full', 'r-tile-ov'].forEach(id => { const e = document.getElementById(id); if(e) e.closest('.rate-item').remove(); });
    const st = T.stk(44, 86, 1, 'Matte Vinyl', 'Gloss Laminate', 'market'), sg = T.sgn(44, 86, 1, 1, 'Gloss Vinyl', '', 'Gloss Laminate');
    window.cobaConfirm = (m, cb) => cb(); resetRoland();
    return { st, sg, back: !!document.getElementById('r-roll-full') };
  });
  ok(old.st.sf.indexOf('32.639') === 0 && near(old.st.co, 55.16) && near(old.st.rt, 99.29), 'old sticker panel: 32.639 sq ft, $55.16, $99.29 (got ' + old.st.sf + ', ' + old.st.co + ')');
  ok(near(old.sg.co, 44.41) && near(old.sg.rt, 315.33) && old.sg.film === '', 'old signage panel: $44.41, $315.33 (got ' + old.sg.co + ')');
  ok(old.back, 'New estimate restores the v53 panel');

  ok(errs.length === 0, 'no page errors: ' + JSON.stringify(errs));
  console.log(pass + ' passed, ' + fail + ' failed'); await b.close(); process.exit(fail ? 1 : 0);
})();
