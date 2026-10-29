// Sticker price collector - StickerYou (laminated die-cut, white vinyl).
// Run in a real browser tab on https://www.stickeryou.com/en-ca/products/die-cut-stickers/623
// (paste into the page's JS console or a browser tool). Uses the same price request the page
// itself makes when a customer changes the size. Plain ASCII only.
function mrCrc32(str) { var crc = -1; for (var n = 0; n < str.length; n++) { var c = (crc ^ str.charCodeAt(n)) & 255; for (var k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
// Compact output: per seller a shared quantity list q and rows [w, h, prices] (VistaPrint: [w, h, listPrices, salePrices]).
// k is a CRC32 of the JSON without k, so the updater can prove nothing was garbled in transfer.
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
var SY_SIZES = [[1,1],[1.5,1.5],[2,2],[2.5,2.5],[3,3],[3.5,3.5],[4,4],[4.5,4.5],[5,5],[6,6],[2,1],[3,2],[4,2],[4,3],[5,3],[6,4]];
var SY_PRODUCT_ID = 38;
var syOut = [], syErrors = [];
if (location.hostname.indexOf('stickeryou.com') < 0) { syErrors.push('Wrong site: open the StickerYou die-cut page first'); }
else {
  for (var syI = 0; syI < SY_SIZES.length; syI++) {
    var syW = SY_SIZES[syI][0], syH = SY_SIZES[syI][1];
    try {
      var syR = await fetch('/pm/ProductPrice', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId: SY_PRODUCT_ID, width: syW, height: syH, currencyCode: 'CAD', accessoryDetails: [] }) });
      var syJ = await syR.json(), syRes = (syJ && syJ.result) || [];
      if (!syRes.length) throw new Error('empty price list');
      if (syRes[0].CurrencyCode !== 'CAD') throw new Error('currency is ' + syRes[0].CurrencyCode);
      syOut.push({ w: syW, h: syH, ladder: syRes.map(function (x) { return [x.Quantity, x.Price]; }) });
    } catch (e) { syErrors.push(syW + 'x' + syH + ': ' + e.message); }
    await new Promise(function (r) { setTimeout(r, 1200); });
  }
}
mrPack('stickeryou', { sy: { sizes: syOut } }, syErrors);
