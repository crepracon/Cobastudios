// Art and plan price collector for two shops that publish fixed price tables on their own pages.
// Run it TWICE, once in a tab on each page (it reads only the page it is on):
//  - https://www.monk.ca/large-format/      Monk Office (BC): posters on Enhanced Matte and Semi-Gloss, CAD drawings on 24 lb bond
//  - https://newfoundlandcanvas.com/wideformat   Newfoundland Canvas (St. John's): Luxe Fine Art Matte 230 gsm, Cotton Rag 310 gsm, Glacier photo satin
// Both charge the same per print at any quantity, so each ladder is unit price x quantity.
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
  var ladder = function (u) { return Q.map(function (q) { return [q, Math.round(u * q * 100) / 100]; }); };
  var sellers = {}, errors = [], extra = { perSqft: {} };
  var host = location.hostname;
  if (host.indexOf('monk.ca') >= 0) {
    // blocks like: "Printed on Enhanced Matte Paper 18 x 24 - $22 24 x 36 - $28 36 x 48 - $35 $4 per square foot for larger sizes"
    var t = document.body.textContent.replace(/\s+/g, ' ');
    var block = function (title) { var i = t.indexOf(title); if (i < 0) return null; var end = t.indexOf('larger sizes', i); return t.slice(i, end > i ? end + 12 : i + 300); };
    var parse = function (id, title, sizesOnly) {
      var b = block(title); if (!b) { errors.push(title + ' not found'); return; }
      // "18 x 24 - $22" (their page uses inch marks, a times sign and a dash between, all skipped as non-digits)
      var re = /(\d+)[^\d$]{1,6}(\d+)([^\d$]*)\$([\d.]+)/g, m, sizes = [];
      while ((m = re.exec(b))) { var tag = /B&W/i.test(m[3]) ? 'b&w' : /Colour/i.test(m[3]) ? 'colour' : ''; if (sizesOnly && tag !== sizesOnly) continue; var a = +m[1], c = +m[2]; sizes.push({ w: Math.max(a, c), h: Math.min(a, c), ladder: ladder(+m[4]) }); }
      if (!sizes.length) errors.push(title + ': no prices read'); else sellers[id] = { sizes: sizes };
      var ps = /\$([\d.]+) per square foot/.exec(b); if (ps) extra.perSqft[id] = +ps[1];
    };
    parse('monk-em', 'Printed on Enhanced Matte Paper');
    parse('monk-semi', 'Printed on Semi-Gloss Paper');
    parse('monk-bond-bw', 'CAD Line Drawings on 24lb Bond', 'b&w');
    parse('monk-bond-col', 'CAD Line Drawings on 24lb Bond', 'colour');
    var fee = /\$([\d.]+) Digital Service fee per file applies \(1-5 files\)/.exec(t); if (fee) extra.fileFee = +fee[1];
    return mrPack('monk-art', sellers, errors, extra);
  }
  if (host.indexOf('newfoundlandcanvas.com') >= 0) {
    var cols = { 'Matte': 'nlc-matte', 'Rag': 'nlc-rag', 'Glacier': 'nlc-satin' };
    var tables = Array.from(document.querySelectorAll('table'));
    if (!tables.length) errors.push('no price tables on the page');
    tables.forEach(function (tb) {
      var head = Array.from(tb.rows[0].cells).map(function (c) { return c.textContent.trim(); });
      Array.from(tb.rows).slice(1).forEach(function (r) {
        var cells = Array.from(r.cells).map(function (c) { return c.textContent.trim(); }), m = /^([\d.]+)\s*x\s*([\d.]+)$/i.exec(cells[0]); if (!m) return;
        var a = +m[1], c = +m[2];
        head.forEach(function (h, k) {
          var id = cols[h]; if (!id) return; var p = parseFloat((cells[k] || '').replace(/[^0-9.]/g, '')); if (!(p > 0)) return;
          (sellers[id] = sellers[id] || { sizes: [] }).sizes.push({ w: Math.max(a, c), h: Math.min(a, c), ladder: ladder(p) });
        });
      });
    });
    return mrPack('nlcanvas-art', sellers, errors, extra);
  }
  errors.push('Wrong site: open monk.ca/large-format/ or newfoundlandcanvas.com/wideformat');
  return mrPack('unknown', sellers, errors);
})();
'started - run collect-result.js in a few seconds';
