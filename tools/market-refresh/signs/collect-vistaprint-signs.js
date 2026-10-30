// Sign and banner price collector - VistaPrint Canada: lawn signs (4 mm coroplast), lawn sign stakes, vinyl banners.
// Run in a real browser tab on https://www.vistaprint.ca/signs-posters/yard-signs (any vistaprint.ca page works).
// Starts in the background and returns "started"; then run collect-result.js until it returns the JSON.
// Uses the same price requests the pages make (CAD). Plain ASCII only.
function mrCrc32(str) { var crc = -1; for (var n = 0; n < str.length; n++) { var c = (crc ^ str.charCodeAt(n)) & 255; for (var k = 0; k < 8; k++) c = (c & 1) ? ((c >>> 1) ^ 0xEDB88320) : (c >>> 1); crc = (crc >>> 8) ^ c; } return ((crc ^ -1) >>> 0).toString(16); }
// Compact output: per seller a shared quantity list q and rows [w, h, prices] or [w, h, listPrices, salePrices].
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
window.__mrJob = (async function () {
  var LAWN = { key: 'PRD-R1AJEBVL', ver: 65 };
  var STAKE = { key: 'PRD-TD5YF4R8', ver: 8 };
  var BANNER = { key: 'PRD-XKHDONHL', ver: 78 };
  // Lawn signs: VistaPrint size names, horizontal (wide side first in their names for most sizes).
  var LAWN_SIZES = [[12, 18, '12" x 18"'], [18, 24, '18" x 24"'], [24, 24, '24" x 24"'], [24, 36, '24" x 36"'], [48, 48, '48" x 48"'], [48, 96, '48" x 96"']];
  var LAWN_Q = [1, 2, 5, 10, 15, 20, 30, 50, 100];
  // Banners in inches (long side first), priced as custom sizes in feet. Grommets on; hems = their heat-welded reinforced edges.
  var BAN_SIZES = [[48, 24], [72, 24], [96, 24], [72, 36], [96, 36], [72, 48], [96, 48], [120, 48]];
  var BAN_Q = [1, 2, 5, 10];
  var BAN = [{ id: 'vp-b13', mat: 'Indoor', edges: 'Yes' }, { id: 'vp-b13n', mat: 'Indoor', edges: 'No' }, { id: 'vp-b15', mat: 'Outdoor', edges: 'Yes' }];
  var sellers = {}, errors = [], wait = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  if (location.hostname.indexOf('vistaprint.ca') < 0) { errors.push('Wrong site: open a vistaprint.ca page first'); return mrPack('vistaprint-signs', sellers, errors); }
  async function breaks(p, sel) { // quantity price breaks for fixed-price products
    var u = new URL('https://website-pricing-service.prices.cimpress.io/v4/prices/estimated/quantityPriceBreaks');
    u.searchParams.set('productKey', p.key); u.searchParams.set('productVersion', p.ver); u.searchParams.set('merchantId', 'VISTAPRINT'); u.searchParams.set('market', 'CA');
    Object.keys(sel).forEach(function (k) { u.searchParams.set('selections[' + k + ']', sel[k]); });
    u.searchParams.set('requestor', 'product-options-ubik-configurator');
    var r = await fetch(u), j = await r.json();
    if (!j.estimatedPrices) throw new Error('no prices (status ' + r.status + ')');
    return j.estimatedPrices;
  }
  async function configurator(p, sel) { // configurator data (formula-priced products like banners): total price per quantity
    var u = new URL('https://wrangler.prod.merch.vpsvc.com/api/v1/vistaprint/en-ca/configuratorData/' + p.key + '/' + p.ver);
    u.searchParams.set('merchandisingExperience', 'UploadFlow'); u.searchParams.set('responseComponents', 'standardConfigurator');
    Object.keys(sel).forEach(function (k) { u.searchParams.set('selectedAttributes[' + k + ']', sel[k]); });
    u.searchParams.set('selectedQuantity', 1); u.searchParams.set('requestor', 'pdp-ctas-fragment'); u.searchParams.set('includeVat', 'false'); u.searchParams.set('priceStyle', 'relative');
    var r = await fetch(u), j = await r.json(), sc = j.standardConfigurator;
    if (!sc || !sc.quantities) throw new Error('no prices (status ' + r.status + ')');
    var dropped = (j.userMessages || []).map(function (m) { return m.msg; }).filter(function (m) { return /Dropped/.test(m); });
    if (dropped.length) throw new Error(dropped.join('; '));
    return sc;
  }
  // Lawn signs, single and double sided
  var base = { 'Orientation': 'Horizontal', 'Shapes': 'Rectangle', 'Material': 'Corrugated Plastic', 'Grommets': 'No', 'Finish': 'None', 'Need a product fast': 'Standard', 'Is this a Sample?': 'No' };
  for (var s = 1; s <= 2; s++) {
    var out = [];
    for (var i = 0; i < LAWN_SIZES.length; i++) {
      var z = LAWN_SIZES[i];
      try {
        var sel = Object.assign({}, base, { 'Size': z[2], 'Single vs Double Sided Printing': s === 1 ? 'Single Sided' : 'Double Sided' });
        var ep = await breaks(LAWN, sel);
        out.push({ w: z[1], h: z[0], ladder: LAWN_Q.filter(function (q) { return ep[q]; }).map(function (q) { return [q, ep[q].totalListPrice.untaxed, ep[q].totalDiscountedPrice.untaxed]; }) });
      } catch (e) { errors.push('lawn ' + s + 's ' + z[2] + ': ' + e.message); }
      await wait(1000);
    }
    sellers['vp-ls' + s] = { sizes: out };
  }
  // Stakes (one size, row 0 x 0)
  try {
    var st = await configurator(STAKE, {});
    var sq = st.quantities.quantities.filter(function (q) { return LAWN_Q.indexOf(+q.quantity) >= 0; });
    sellers['vp-stake'] = { sizes: [{ w: 0, h: 0, ladder: sq.map(function (q) { return [+q.quantity, q.totalListPrice, q.totalDiscountedPrice]; }) }] };
  } catch (e) { errors.push('stake: ' + e.message); }
  await wait(1000);
  // Banners
  for (var b = 0; b < BAN.length; b++) {
    var bo = [];
    for (var j = 0; j < BAN_SIZES.length; j++) {
      var bz = BAN_SIZES[j];
      try {
        var sc = await configurator(BANNER, { 'Size': 'Custom', 'Custom Width': String(bz[0] / 12), 'Custom Height': String(bz[1] / 12), 'Product Orientation': 'Horizontal', 'Printed Sides': 'Single Sided', 'Hanging Option': 'Grommets', 'Reinforced Edges': BAN[b].edges, 'Wind Flaps': 'No', 'Material Type': BAN[b].mat });
        var mat = sc.selections.completeProduct['Material Type'];
        if (mat !== BAN[b].mat) throw new Error('material came back as ' + mat);
        bo.push({ w: bz[0], h: bz[1], ladder: sc.quantities.quantities.filter(function (q) { return BAN_Q.indexOf(+q.quantity) >= 0; }).map(function (q) { return [+q.quantity, q.totalListPrice, q.totalDiscountedPrice]; }) });
      } catch (e) { errors.push(BAN[b].id + ' ' + bz[0] + 'x' + bz[1] + ': ' + e.message); }
      await wait(1000);
    }
    sellers[BAN[b].id] = { sizes: bo };
  }
  return mrPack('vistaprint-signs', sellers, errors);
})();
'started - run collect-result.js in about a minute';
