// Sticker price collector - Sticker Mule (standard laminated die cut + Economy, not laminated).
// Run in a real browser tab on https://www.stickermule.com/ca/products/die-cut-stickers
// Uses the same price request the page makes (CAD, Canadian locale). Plain ASCII only.
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
var SM_SIZES = [[1,1],[1.5,1.5],[2,2],[2.5,2.5],[3,3],[3.5,3.5],[4,4],[4.5,4.5],[5,5],[6,6],[2,1],[3,2],[4,2],[4,3],[5,3],[6,4]];
var SM_QTYS = [10,25,50,100,200,250,300,500,1000,2000,3000,5000,10000];
var SM_PRODUCTS = [{ id: 'sm', productId: '317' }, { id: 'sme', productId: 'economy-stickers' }];
var smSellers = {}, smErrors = [];
if (location.hostname.indexOf('stickermule.com') < 0) { smErrors.push('Wrong site: open the Sticker Mule die cut page first'); }
else {
  for (var smP = 0; smP < SM_PRODUCTS.length; smP++) {
    var smProd = SM_PRODUCTS[smP], smOut = [];
    for (var smI = 0; smI < SM_SIZES.length; smI++) {
      var smW = SM_SIZES[smI][0], smH = SM_SIZES[smI][1];
      try {
        var smR = await fetch('https://www.stickermule.com/core/api/products/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currency: 'CAD', locale: 'ca', productId: smProd.productId, size: { width: smW, height: smH }, quantities: SM_QTYS, discount: null }) });
        var smJ = await smR.json();
        if (!Array.isArray(smJ) || !smJ.length) throw new Error('unexpected response (status ' + smR.status + ')');
        smOut.push({ w: smW, h: smH, ladder: smJ.map(function (x) { return [x.quantity, x.totalPrice]; }) });
      } catch (e) { smErrors.push(smProd.id + ' ' + smW + 'x' + smH + ': ' + e.message); }
      await new Promise(function (r) { setTimeout(r, 1200); });
    }
    smSellers[smProd.id] = { sizes: smOut };
  }
}
mrPack('stickermule', smSellers, smErrors);
