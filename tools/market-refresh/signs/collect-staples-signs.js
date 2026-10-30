// Sign and banner price collector - Staples Canada print shop (shop.staplescopyandprint.ca): yard signs, outdoor banners, A-frames.
// Run in a real browser tab on https://shop.staplescopyandprint.ca/products/yard-sign
// Starts in the background and returns "started"; then run collect-result.js until it returns the JSON.
// Reads the same option/price matrix the product pages load. Staples prices are per unit (no quantity breaks),
// so each ladder is unit price x quantity. Plain ASCII only.
function mrCrc32(str) { var crc = -1; for (var n = 0; n < str.length; n++) { var c = (crc ^ str.charCodeAt(n)) & 255; for (var k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
function mrPack(collector, sellers, errors, extra) {
  var packed = {};
  Object.keys(sellers).forEach(function (id) {
    var sizes = sellers[id].sizes, q = sizes.length ? sizes[0].ladder.map(function (r) { return r[0]; }) : [], two = sizes.length && sizes[0].ladder[0].length > 2;
    packed[id] = { q: q, cols: two ? 2 : 1, rows: sizes.map(function (z) {
      var find = function (qq) { for (var i = 0; i < z.ladder.length; i++) if (z.ladder[i][0] === qq) return z.ladder[i]; return null; };
      var a = q.map(function (qq) { var r = find(qq); return r ? r[1] : null; });
      if (!two) return [z.w, z.h, a];
      return [z.w, z.h, a, q.map(function (qq) { var r = find(qq); return r ? r[2] : null; })];
    }) };
  });
  var o = { collector: collector, sellers: packed, errors: errors, at: new Date().toISOString() };
  Object.keys(extra || {}).forEach(function (x) { o[x] = extra[x]; });
  o.k = mrCrc32(JSON.stringify(o));
  return JSON.stringify(o);
}
window.__mrJob = (async function () {
  var API = 'https://www.staplescopyandprint.ca/PrintProductApps/CaPPPrintProducts/CanvaOptions?subProduct=';
  var Q = [1, 2, 5, 10, 25, 50, 100], BQ = [1, 2, 5, 10];
  var sellers = {}, errors = [], extra = { addons: {} }, wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (location.hostname.indexOf('staplescopyandprint.ca') < 0) { errors.push('Wrong site: open shop.staplescopyandprint.ca first'); return mrPack('staples-signs', sellers, errors); }
  async function matrix(sub) {
    var r = await fetch(API + sub, { credentials: 'include' }), j = await r.json();
    if (!j.matrix || !j.matrix.length) throw new Error(sub + ': no price matrix (status ' + r.status + ')');
    return j.matrix.filter(function (m) { return (m.selectedValues.delivery || 'standard') === 'standard'; });
  }
  var dims = function (s) { var p = String(s).split('x').map(Number); return [Math.max(p[0], p[1]), Math.min(p[0], p[1])]; };
  var unit = function (m) { return m.itemInfo[0].Price; };
  var ladder = function (u, qs) { return qs.map(function (q) { return [q, Math.round(u * q * 100) / 100]; }); };
  // Yard signs: 4 mm coroplast, no finishing; stake holders are an add-on (second item in the matrix row)
  try {
    var ym = await matrix('CanvaPP_Sign_YardEx');
    [1, 2].forEach(function (side) {
      var rows = ym.filter(function (m) { return m.selectedValues.finition === 'NA' && String(m.selectedValues.side) === String(side) && m.selectedValues.paper === '4mmCPlast'; });
      sellers['stp-ls' + side] = { sizes: rows.map(function (m) { var d = dims(m.selectedValues.size); return { w: d[0], h: d[1], ladder: ladder(unit(m), Q) }; }) };
    });
    var stake = {};
    ym.filter(function (m) { return (m.selectedValues.finition === 'H1' || m.selectedValues.finition === 'H2') && String(m.selectedValues.side) === '1'; }).forEach(function (m) {
      var d = dims(m.selectedValues.size); if (m.itemInfo[1]) stake[d[0] + 'x' + d[1]] = [m.selectedValues.finition === 'H2' ? 2 : 1, m.itemInfo[1].Price];
    });
    extra.addons['stp-stake'] = stake; // size -> [stakes per sign, price per sign]
  } catch (e) { errors.push('yard signs: ' + e.message); }
  await wait(1000);
  // Outdoor banners: 13 oz super smooth and 18 oz heavy duty vinyl, 1 inch sewn edge + grommets every 2 ft, 1 sided
  try {
    var bm = await matrix('CanvaPP_Banner_Outdoor');
    [['stp-b13', '13SSVinyl'], ['stp-b18', '18HDVinyl']].forEach(function (b) {
      var rows = bm.filter(function (m) { return m.selectedValues.paper === b[1] && m.selectedValues.finition === 'EG'; });
      sellers[b[0]] = { sizes: rows.map(function (m) { var d = dims(m.selectedValues.size); return { w: d[0], h: d[1], ladder: ladder(unit(m), BQ) }; }) };
    });
  } catch (e) { errors.push('outdoor banners: ' + e.message); }
  await wait(1000);
  // A-frames: coroplast prints + A-frame holder (two items per row: prints, frame)
  try {
    var am = await matrix('CanvaPP_Sign_AframeEx_DualSide');
    var af = am.filter(function (m) { return m.selectedValues.finition === 'AH'; });
    sellers['stp-af'] = { sizes: af.map(function (m) { var d = dims(m.selectedValues.size); var t = m.itemInfo.reduce(function (s, i) { return s + i.Price; }, 0); return { w: d[0], h: d[1], ladder: ladder(t, BQ) }; }) };
    extra.addons['stp-af-parts'] = af.map(function (m) { return [m.selectedValues.size, m.selectedValues.side, m.itemInfo.map(function (i) { return i.Price; })]; });
  } catch (e) { errors.push('a-frames: ' + e.message); }
  return mrPack('staples-signs', sellers, errors, extra);
})();
'started - run collect-result.js in a few seconds';
