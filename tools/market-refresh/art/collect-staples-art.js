// Art and plan price collector - Staples Canada print shop (shop.staplescopyandprint.ca):
//  - Posters, Matte and Glossy paper (CanvaPP_Poster), no finishing
//  - Photo Enlargements/Posters on Fujifilm Crystal Archive photo paper (Shopify product photo-poster)
//  - Engineering prints on 20 lb bond, B&W and colour, 3 service levels (table on /pages/engineering-prints)
// Run in a real browser tab on https://shop.staplescopyandprint.ca/pages/engineering-prints
// Staples prices are per print (no quantity breaks), so each ladder is unit price x quantity.
// Starts in the background and returns "started"; then run collect-result.js. Plain ASCII only.
function mrCrc32(str) { var crc = -1; for (var n = 0; n < str.length; n++) { var c = (crc ^ str.charCodeAt(n)) & 255; for (var k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
function mrPack(collector, sellers, errors, extra) {
  var packed = {};
  Object.keys(sellers).forEach(function (id) {
    var sizes = sellers[id].sizes, q = [];
    sizes.forEach(function (z) { z.ladder.forEach(function (r) { if (q.indexOf(r[0]) < 0) q.push(r[0]); }); });
    q.sort(function (a, b) { return a - b; });
    packed[id] = { q: q, cols: 1, rows: sizes.map(function (z) {
      return [z.w, z.h, q.map(function (qq) { for (var i = 0; i < z.ladder.length; i++) if (z.ladder[i][0] === qq) return z.ladder[i][1]; return null; })];
    }) };
  });
  var o = { collector: collector, sellers: packed, errors: errors, at: new Date().toISOString() };
  Object.keys(extra || {}).forEach(function (x) { o[x] = extra[x]; });
  o.k = mrCrc32(JSON.stringify(o));
  return JSON.stringify(o);
}
window.__mrJob = (async function () {
  var Q = [1, 2, 5, 10, 25];
  var sellers = {}, errors = [], extra = { perSqft: {} };
  if (location.hostname.indexOf('staplescopyandprint.ca') < 0) { errors.push('Wrong site: open shop.staplescopyandprint.ca first'); return mrPack('staples-art', sellers, errors); }
  var dims = function (s) { var p = String(s).split(/\s*x\s*/i).map(Number); return [Math.max(p[0], p[1]), Math.min(p[0], p[1])]; };
  var ladder = function (u) { return Q.map(function (q) { return [q, Math.round(u * q * 100) / 100]; }); };
  // posters
  try {
    var j = await (await fetch('https://www.staplescopyandprint.ca/PrintProductApps/CaPPPrintProducts/CanvaOptions?subProduct=CanvaPP_Poster', { credentials: 'include' })).json();
    if (!j.matrix || !j.matrix.length) throw new Error('no poster price matrix');
    [['stp-pmatte', 'M'], ['stp-pgloss', 'G']].forEach(function (p) {
      var rows = j.matrix.filter(function (m) { return (m.selectedValues.delivery || 'standard') === 'standard' && m.selectedValues.paper === p[1] && m.selectedValues.finition === 'NA'; });
      sellers[p[0]] = { sizes: rows.map(function (m) { var d = dims(m.selectedValues.size); return { w: d[0], h: d[1], ladder: ladder(m.itemInfo[0].Price) }; }) };
    });
  } catch (e) { errors.push('posters: ' + e.message); }
  // photo enlargements
  try {
    var pp = await (await fetch('/products/photo-poster.js')).json();
    sellers['stp-photo'] = { sizes: pp.variants.map(function (v) { var d = dims(v.title); return { w: d[0], h: d[1], ladder: ladder(v.price / 100) }; }).filter(function (z) { return z.w > 0; }) };
  } catch (e) { errors.push('photo posters: ' + e.message); }
  // engineering prints: price table text (columns: One Hour, Same-day, Complete Solution)
  try {
    // the price table is drawn by the page's own script, so read the live page (this collector must run on it)
    if (location.pathname.indexOf('/pages/engineering-prints') < 0) throw new Error('open /pages/engineering-prints and run this there');
    var t = document.body.innerText.replace(/\s+/g, ' ');
    var sec = function (a, b) { var i = t.indexOf(a), k = t.indexOf(b, i + 1); return i < 0 ? '' : t.slice(i, k > i ? k : i + 600); };
    [['bw', 'Black and White Pricing', 'Colour Pricing'], ['col', 'Colour Pricing', '*plus']].forEach(function (s) {
      var part = sec(s[1], s[2]); if (!part) throw new Error(s[1] + ' table not found');
      [['1h', 0], ['sd', 1], ['cs', 2]].forEach(function (lvl) {
        var sizes = [];
        [['18 x 24', 24, 18], ['24 x 36', 36, 24], ['36 x 48', 48, 36]].forEach(function (z) {
          var m = new RegExp(z[0].replace(/ /g, '\\s*') + '"?\\s*\\$([\\d.]+)\\s*\\$([\\d.]+)\\s*\\$([\\d.]+)').exec(part);
          if (!m) { errors.push('engineering ' + s[0] + ' ' + z[0] + ' not found'); return; }
          sizes.push({ w: z[1], h: z[2], ladder: ladder(+m[1 + lvl[1]]) });
        });
        sellers['stp-eng-' + s[0] + '-' + lvl[0]] = { sizes: sizes };
        var c = /Custom[^$]*\$([\d.]+)\s*\$([\d.]+)\s*\$([\d.]+)/.exec(part);
        if (c) extra.perSqft['stp-eng-' + s[0] + '-' + lvl[0]] = +c[1 + lvl[1]];
      });
    });
    var fee = /plus \$([\d.]+) Service and Handling Fee per order[\s\S]{0,80}plus \$([\d.]+) Service/.exec(t);
    if (fee) extra.orderFee = { oneHourSameDay: +fee[1], completeSolution: +fee[2] };
  } catch (e) { errors.push('engineering: ' + e.message); }
  return mrPack('staples-art', sellers, errors, extra);
})();
'started - run collect-result.js in a few seconds';
