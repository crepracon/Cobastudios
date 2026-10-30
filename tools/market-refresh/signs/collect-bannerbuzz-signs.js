// Banner price collector - BannerBuzz Canada: Custom Vinyl Banners (13 oz, metal grommets, flush cut - no hem).
// Run in a real browser tab on https://www.bannerbuzz.ca/custom-vinyl-banners/p
// Reads the size price list and quantity discounts the product page loads. BannerBuzz always shows a crossed-out
// "regular" price about 40% higher; we store the price a customer actually pays. Plain ASCII only.
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
  var BQ = [1, 2, 5, 10];
  var sellers = {}, errors = [], extra = {};
  if (location.hostname.indexOf('bannerbuzz.ca') < 0) { errors.push('Wrong site: open the BannerBuzz custom vinyl banners page first'); return mrPack('bannerbuzz-signs', sellers, errors); }
  try {
    var r = await fetch('/staticJsonData/pdpSizeApi/ca/BBVBCB00.json'), j = await r.json();
    var vals = j.sizes.size.field_values.filter(function (v) { return v.price > 0 && /^\d+(\.\d+)?x\d+(\.\d+)?$/.test(v.value); });
    var tiers = j.quantity.quantity_price_discount || [];
    var off = function (q) { var p = 0; tiers.forEach(function (t) { if (q >= t.min_qty && (t.max_qty == null || q <= t.max_qty)) p = t.discount_percent; }); return p / 100; };
    var seen = {}, sizes = [];
    vals.forEach(function (v) {
      var p = v.value.split('x').map(Number), W = Math.max(p[0], p[1]) * 12, H = Math.min(p[0], p[1]) * 12, k = W + 'x' + H;
      if (seen[k]) return; seen[k] = 1;
      sizes.push({ w: W, h: H, ladder: BQ.map(function (q) { return [q, Math.round(v.price * (1 - off(q)) * q * 100) / 100]; }) });
    });
    sellers['bb-b13'] = { sizes: sizes };
    extra.tiers = tiers.map(function (t) { return [t.min_qty, t.max_qty || null, t.discount_percent]; });
  } catch (e) { errors.push('banners: ' + e.message); }
  return mrPack('bannerbuzz-signs', sellers, errors, extra);
})();
'started - run collect-result.js in a few seconds';
