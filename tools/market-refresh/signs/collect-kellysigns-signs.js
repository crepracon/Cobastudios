// Sign price collector - Kelly Signs (Ottawa, kellysigns.ca): real estate and commercial coroplast signs.
// Run in a real browser tab on https://kellysigns.ca/real-estate-2/
// Reads the shop's public product prices (WooCommerce store API). Kelly sells fixed sizes, often in sets with
// minimum quantities; prices here are per sign. Their commercial signs are "printed directly onto the material".
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
  var Q = [1, 2, 5, 6, 10, 25, 50, 100];
  // product id -> seller, size (w x h, long side first), signs per item, minimum signs, sides
  var MAP = [
    { pid: 3662, id: 'ks-ls1', w: 24, h: 12, per: 1, min: 1 },
    { pid: 5719, id: 'ks-ls1', w: 24, h: 18, per: 2, min: 6 },
    { pid: 5712, id: 'ks-ls1', w: 24, h: 24, per: 2, min: 6 },
    { pid: 5698, id: 'ks-ls1', w: 32, h: 24, per: 2, min: 6 },
    { pid: 3857, id: 'ks-ls1', w: 48, h: 48, per: 1, min: 1 },
    { pid: 3704, id: 'ks-ls1', w: 72, h: 48, per: 1, min: 1 },
    { pid: 3176, id: 'ks-ls1', w: 96, h: 48, per: 1, min: 1 },
    { pid: 5653, id: 'ks-ls2', w: 32, h: 24, per: 1, min: 6 }
  ];
  var sellers = {}, errors = [], extra = { addons: {} };
  if (location.hostname.indexOf('kellysigns.ca') < 0) { errors.push('Wrong site: open kellysigns.ca first'); return mrPack('kellysigns-signs', sellers, errors); }
  try {
    var r = await fetch('/wp-json/wc/store/v1/products?per_page=100'), list = await r.json();
    if (!Array.isArray(list)) throw new Error('no product list (status ' + r.status + ')');
    var byId = {}; list.forEach(function (p) { byId[p.id] = p; });
    var price = function (p) { return p.prices.price / Math.pow(10, p.prices.currency_minor_unit || 2); };
    MAP.forEach(function (m) {
      var p = byId[m.pid];
      if (!p) { errors.push('product ' + m.pid + ' (' + m.w + 'x' + m.h + ') not found'); return; }
      var unit = price(p) / m.per;
      if (!(unit > 0)) { errors.push('product ' + m.pid + ' has no price'); return; }
      (sellers[m.id] = sellers[m.id] || { sizes: [] }).sizes.push({ w: m.w, h: m.h, ladder: Q.filter(function (q) { return q >= m.min; }).map(function (q) { return [q, Math.round(unit * q * 100) / 100]; }) });
    });
    var stake = list.filter(function (p) { return /^step stake$/i.test(p.name.trim()); })[0];
    if (stake) extra.addons['ks-stake'] = price(stake); else errors.push('step stake not found');
  } catch (e) { errors.push(e.message); }
  return mrPack('kellysigns-signs', sellers, errors, extra);
})();
'started - run collect-result.js in a few seconds';
