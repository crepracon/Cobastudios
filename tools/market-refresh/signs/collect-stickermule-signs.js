// Sign price collector - Sticker Mule Canada: rigid yard signs (4 mm coroplast, printed both sides, H-stake included,
// one size 24 x 18 in) and large die cut stickers (laminated) 8 to 24 in.
// Run in a real browser tab on https://www.stickermule.com/ca/products/rigid-yard-signs
// Starts in the background and returns "started"; then run collect-result.js until it returns the JSON. Plain ASCII only.
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
  var Q = [1, 2, 5, 10, 25, 50, 100];
  var BIG = [[8, 8], [10, 10], [12, 12], [18, 18], [24, 24], [12, 6], [18, 12], [24, 12], [24, 18]];
  var sellers = {}, errors = [], wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (location.hostname.indexOf('stickermule.com') < 0) { errors.push('Wrong site: open the Sticker Mule rigid yard signs page first'); return mrPack('stickermule-signs', sellers, errors); }
  async function price(pid, w, h) {
    var r = await fetch('https://www.stickermule.com/core/api/products/prices', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency: 'CAD', locale: 'ca', productId: pid, size: { width: w, height: h }, quantities: Q, discount: null }) });
    var j = await r.json();
    if (!Array.isArray(j) || !j.length) throw new Error('unexpected response (status ' + r.status + ')');
    return j.map(function (x) { return [x.quantity, x.totalPrice]; });
  }
  try { sellers['sm-ls2'] = { sizes: [{ w: 24, h: 18, ladder: await price('rigid-yard-signs', 24, 18) }] }; } catch (e) { errors.push('yard signs: ' + e.message); }
  await wait(1200);
  var big = [];
  for (var i = 0; i < BIG.length; i++) {
    try { big.push({ w: BIG[i][0], h: BIG[i][1], ladder: await price('317', BIG[i][0], BIG[i][1]) }); } catch (e) { errors.push('die cut ' + BIG[i] + ': ' + e.message); }
    await wait(1200);
  }
  sellers['sm-big'] = { sizes: big };
  return mrPack('stickermule-signs', sellers, errors);
})();
'started - run collect-result.js in about 15 seconds';
