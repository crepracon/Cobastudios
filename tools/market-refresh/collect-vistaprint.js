// Sticker price collector - VistaPrint die-cut sticker singles, White Plastic (gloss-coated, not laminated).
// Run in a real browser tab on https://www.vistaprint.ca/labels-stickers/die-cut-sticker-singles
// after the page has finished loading its prices. Uses the same pricing service the page calls.
// Returns [qty, list price, sale price] per quantity (CAD, before tax). Plain ASCII only.
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
var vpErrors = [], vpOut = [], vpKey = 'PRD-XSJUFCTDY', vpVersion = '21';
if (location.hostname.indexOf('vistaprint.ca') < 0) { vpErrors.push('Wrong site: open the VistaPrint die-cut sticker singles page first'); }
else {
  // Discover the current product key and version from the page's own pricing calls (falls back to the last known ones).
  var vpSeen = performance.getEntriesByType('resource').map(function (e) { return e.name; }).filter(function (u) { return u.indexOf('productKey=') >= 0; });
  for (var vpS = 0; vpS < vpSeen.length; vpS++) {
    var vpU = new URL(vpSeen[vpS]);
    if (vpU.searchParams.get('productKey')) vpKey = vpU.searchParams.get('productKey');
    if (vpU.searchParams.get('productVersion')) vpVersion = vpU.searchParams.get('productVersion');
  }
  var vpSizes = Array.prototype.map.call(document.querySelectorAll('input[type=radio]'), function (e) { return e.value; })
    .filter(function (v) { return /^\d+(\.\d+)?"\s*x\s*\d+(\.\d+)?"$/.test(v); });
  if (!vpSizes.length) vpSizes = ['2"x2"', '2.5"x2.5"', '3"x3"', '3.5"x3.5"', '4"x4"', '4.5"x4.5"', '5"x5"'];
  for (var vpI = 0; vpI < vpSizes.length; vpI++) {
    var vpSize = vpSizes[vpI], vpDims = vpSize.replace(/"/g, '').split('x').map(function (s) { return parseFloat(s); });
    try {
      var vpUrl = 'https://website-pricing-service.prices.cimpress.io/v4/prices/estimated/quantityPriceBreaks?productKey=' + encodeURIComponent(vpKey) +
        '&productVersion=' + encodeURIComponent(vpVersion) + '&merchantId=VISTAPRINT&market=CA&selections%5BMaterial%5D=White+Plastic&selections%5BSize%5D=' +
        encodeURIComponent(vpSize) + '&requestor=product-options-ubik-configurator';
      var vpR = await fetch(vpUrl), vpJ = await vpR.json(), vpEp = vpJ.estimatedPrices || {};
      if (vpJ.currency !== 'CAD') throw new Error('currency is ' + vpJ.currency);
      var vpLadder = Object.keys(vpEp).map(function (q) { return [+q, vpEp[q].totalListPrice.untaxed, vpEp[q].totalDiscountedPrice.untaxed]; }).sort(function (a, b) { return a[0] - b[0]; });
      if (!vpLadder.length) throw new Error('empty price list');
      vpOut.push({ w: vpDims[0], h: vpDims[1], ladder: vpLadder });
    } catch (e) { vpErrors.push(vpSize + ': ' + e.message); }
    await new Promise(function (r) { setTimeout(r, 1200); });
  }
}
mrPack('vistaprint', { vp: { sizes: vpOut } }, vpErrors, { productKey: vpKey, productVersion: vpVersion });
