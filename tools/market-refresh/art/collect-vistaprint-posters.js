// Poster price collector - VistaPrint Canada custom posters (PRD-HSKBMXYA): Premium Matte (14 pt), Semi-Gloss (9.3 pt),
// Premium Glossy (8 pt), sizes 8.5 x 11 to 36 x 48, quantities 1 to 100.
// Run in a real browser tab on https://www.vistaprint.ca/signs-posters/posters
// Uses the same quantity price-break request the page makes (CAD; list and sale price). Starts in the background and
// returns "started"; then run collect-result.js (about 40 s). Plain ASCII only.
function mrCrc32(str) { var crc = -1; for (var n = 0; n < str.length; n++) { var c = (crc ^ str.charCodeAt(n)) & 255; for (var k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
function mrPack(collector, sellers, errors, extra) {
  var packed = {};
  Object.keys(sellers).forEach(function (id) {
    var sizes = sellers[id].sizes, q = [], two = false;
    sizes.forEach(function (z) { z.ladder.forEach(function (r) { if (q.indexOf(r[0]) < 0) q.push(r[0]); if (r.length > 2) two = true; }); });
    q.sort(function (a, b) { return a - b; });
    packed[id] = { q: q, cols: two ? 2 : 1, rows: sizes.map(function (z) {
      var find = function (qq) { for (var i = 0; i < z.ladder.length; i++) if (z.ladder[i][0] === qq) return z.ladder[i]; return null; };
      var a = q.map(function (qq) { var r = find(qq); return r ? r[1] : null; });
      return two ? [z.w, z.h, a, q.map(function (qq) { var r = find(qq); return r ? (r[2] != null ? r[2] : r[1]) : null; })] : [z.w, z.h, a];
    }) };
  });
  var o = { collector: collector, sellers: packed, errors: errors, at: new Date().toISOString() };
  Object.keys(extra || {}).forEach(function (x) { o[x] = extra[x]; });
  o.k = mrCrc32(JSON.stringify(o));
  return JSON.stringify(o);
}
window.__mrJob = (async function () {
  var KEY = 'PRD-HSKBMXYA', VER = 46;
  var SIZES = [[11, 8.5, '8.5" X 11"'], [17, 11, '11" X 17"'], [20, 16, '16" X 20"'], [24, 18, '18" X 24"'], [28, 22, '22" X 28"'], [36, 24, '24" X 36"'], [40, 28, '28" X 40"'], [48, 36, '36" X 48"']];
  var SUBS = [{ id: 'vp-pmatte', s: 'Premium Matte' }, { id: 'vp-semi', s: 'Semi-Gloss' }, { id: 'vp-pgloss', s: 'Premium Glossy' }];
  var Q = [1, 2, 5, 10, 25, 50, 100];
  var sellers = {}, errors = [], wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (location.hostname.indexOf('vistaprint.ca') < 0) { errors.push('Wrong site: open a vistaprint.ca page first'); return mrPack('vistaprint-posters', sellers, errors); }
  // read the current product version from the page if it changed
  var v = (document.documentElement.innerHTML.match(/"productVersion":\s*(\d+)/) || [])[1]; if (v) VER = +v;
  for (var i = 0; i < SUBS.length; i++) {
    var out = [];
    for (var j = 0; j < SIZES.length; j++) {
      var z = SIZES[j];
      try {
        var u = new URL('https://website-pricing-service.prices.cimpress.io/v4/prices/estimated/quantityPriceBreaks');
        u.searchParams.set('productKey', KEY); u.searchParams.set('productVersion', VER); u.searchParams.set('merchantId', 'VISTAPRINT'); u.searchParams.set('market', 'CA');
        u.searchParams.set('selections[Size]', z[2]); u.searchParams.set('selections[Substrates]', SUBS[i].s); u.searchParams.set('selections[Product Orientation]', 'Vertical');
        u.searchParams.set('requestor', 'product-options-ubik-configurator');
        var r = await fetch(u), d = await r.json();
        if (!d.estimatedPrices) throw new Error('no prices (status ' + r.status + ')');
        out.push({ w: z[0], h: z[1], ladder: Q.filter(function (q) { return d.estimatedPrices[q]; }).map(function (q) { return [q, d.estimatedPrices[q].totalListPrice.untaxed, d.estimatedPrices[q].totalDiscountedPrice.untaxed]; }) });
      } catch (e) { errors.push(SUBS[i].id + ' ' + z[2] + ': ' + e.message); }
      await wait(900);
    }
    sellers[SUBS[i].id] = { sizes: out };
  }
  return mrPack('vistaprint-posters', sellers, errors, { productKey: KEY, productVersion: VER });
})();
'started - run collect-result.js in about 40 seconds';
