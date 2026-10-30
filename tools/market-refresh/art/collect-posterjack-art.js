// Art print price collector - Posterjack Canada (posterjack.ca): Fine-Art (Hahnemuehle Photo Rag 308 gsm cotton),
// Satin photo paper, Glossy photo paper. Prints only (no frame, no mount).
// Run in a real browser tab on https://posterjack.ca/products/fine-art-prints
// Reads the shop's public product prices (Shopify). Posterjack charges the same per print at any quantity, so each
// ladder is unit price x quantity. Site-wide coupon codes (e.g. 30% off) are NOT applied; these are regular prices.
// Starts in the background and returns "started"; then run collect-result.js. Plain ASCII only.
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
  var Q = [1, 2, 5, 10, 25];
  var PRODUCTS = [{ id: 'pj-rag', handle: 'fine-art-prints' }, { id: 'pj-satin', handle: 'satin-matte-poster-prints' }, { id: 'pj-gloss', handle: 'glossy-poster-prints' }];
  var sellers = {}, errors = [], extra = { notes: [] };
  if (location.hostname.indexOf('posterjack.ca') < 0) { errors.push('Wrong site: open posterjack.ca first'); return mrPack('posterjack-art', sellers, errors); }
  for (var i = 0; i < PRODUCTS.length; i++) {
    var P = PRODUCTS[i];
    try {
      var r = await fetch('/products/' + P.handle + '.js'), p = await r.json();
      if (!p.variants || !p.variants.length) throw new Error('no variants (status ' + r.status + ')');
      var sizes = [];
      p.variants.forEach(function (v) {
        var m = /([\d.]+)\s*x\s*([\d.]+)/i.exec(v.title); if (!m || !(v.price > 0)) return;
        var a = +m[1], b = +m[2], unit = v.price / 100;
        sizes.push({ w: Math.max(a, b), h: Math.min(a, b), ladder: Q.map(function (q) { return [q, Math.round(unit * q * 100) / 100]; }) });
        if (v.compare_at_price && v.compare_at_price > v.price) extra.notes.push(P.id + ' ' + v.title + ' on sale (regular ' + v.compare_at_price / 100 + ')');
      });
      sellers[P.id] = { sizes: sizes };
    } catch (e) { errors.push(P.id + ': ' + e.message); }
    await new Promise(function (res) { setTimeout(res, 800); });
  }
  var banner = (document.body.innerText.match(/\d+% Off Sitewide[^\n]{0,60}/i) || [])[0];
  if (banner) extra.notes.push('Site banner on capture day: ' + banner.replace(/[^\x20-\x7E]/g, '').trim());
  return mrPack('posterjack-art', sellers, errors, extra);
})();
'started - run collect-result.js in a few seconds';
