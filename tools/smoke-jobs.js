#!/usr/bin/env node
// Smoke test for the Jobs module with cloud sync, using a fake Firestore shared by several
// headless windows (jsdom), like two computers signed in to the same shared list.
//   NODE_PATH=/path/to/node_modules node tools/smoke-jobs.js [index.html]
// Needs jsdom (npm install jsdom in any scratch folder, then point NODE_PATH at it).
// Covers: job title box + Save updates the open job in place, Waiting / In production / Done
// statuses (old Quote / Approved jobs shown and saved in the new set), date + time taken,
// manual log, status / notes / delete propagation between devices, a job saved offline pushed
// on reconnect, first-time device merge, UV Printing jobs saved and reopened on another device,
// the To-Do / To-Invoice box (v42: add / flip / delete / undo across devices, changes made offline
// or signed out sent on reconnect), and the structured paper inventory migration. Plain ASCII only.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(SRC, 'utf8');
const PROJECT = 'coba-studios-estimator';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fake Firestore: one server, any number of client windows ----
function makeServer() { return { cols: { customers: new Map(), estimates: new Map(), reminders: new Map() }, listeners: [], writes: 0 }; }
function deliver(server, l) {
  const m = server.cols[l.name], changes = [];
  m.forEach((data, id) => {
    const j = JSON.stringify(data);
    if (l.seen.get(id) !== j) { changes.push({ type: l.seen.has(id) ? 'modified' : 'added', doc: { id, data: () => JSON.parse(j) } }); l.seen.set(id, j); }
  });
  Array.from(l.seen.keys()).forEach(id => { if (!m.has(id)) { changes.push({ type: 'removed', doc: { id, data: () => null } }); l.seen.delete(id); } });
  if (changes.length || !l.first) { l.first = true; l.cb({ docChanges: () => changes, metadata: { fromCache: false, hasPendingWrites: false } }); }
}
function makeFs(server) {
  return {
    collection: (db, name) => ({ name }),
    doc: (db, name, id) => ({ name, id }),
    onSnapshot: (col, opts, cb) => {
      const l = { name: col.name, cb, seen: new Map(), first: false };
      server.listeners.push(l);
      setTimeout(() => deliver(server, l), 5);
      return () => { const i = server.listeners.indexOf(l); if (i >= 0) server.listeners.splice(i, 1); };
    },
    writeBatch: () => {
      const ops = [];
      return {
        set(ref, data) { ops.push(['set', ref, JSON.parse(JSON.stringify(data))]); },
        delete(ref) { ops.push(['del', ref]); },
        commit() {
          return new Promise(res => setTimeout(() => {
            ops.forEach(o => { const m = server.cols[o[1].name]; server.writes++; if (o[0] === 'set') m.set(o[1].id, o[2]); else m.delete(o[1].id); });
            server.listeners.slice().forEach(l => deliver(server, l));
            res();
          }, 5));
        }
      };
    }
  };
}
function serverPoke(server) { server.listeners.slice().forEach(l => deliver(server, l)); }

// ---- windows ----
function openWin(opts) {
  opts = opts || {};
  const errs = [];
  const dom = new JSDOM(opts.html || HTML, {
    runScripts: 'dangerously', url: 'https://crepracon.github.io/Cobastudios/', pretendToBeVisual: true,
    beforeParse(w) {
      if (opts.joined) w.localStorage.setItem('coba-jobs-cloud-joined-v1', PROJECT);
      if (opts.lastsync) w.localStorage.setItem('coba-jobs-cloud-lastsync-v1', String(opts.lastsync));
      if (opts.jobs) w.localStorage.setItem('coba-jobs-v1', JSON.stringify(opts.jobs));
      if (opts.inventory) w.localStorage.setItem('coba-inventory-v2', opts.inventory);
      if (opts.reminders) w.localStorage.setItem('coba-reminders-v1', opts.reminders);
      w.addEventListener('error', e => errs.push(String(e.message)));
      w.console.error = function () { const s = Array.prototype.map.call(arguments, String).join(' '); if (!/cloud init failed/.test(s)) errs.push(s); };
      w.console.warn = function () {};
      w.scrollTo = () => {}; w.print = () => {};
      w.URL.createObjectURL = () => 'blob:x'; w.URL.revokeObjectURL = () => {};
    }
  });
  const w = dom.window;
  return { w, errs, $: id => w.document.getElementById(id), set: (id, v) => { w.document.getElementById(id).value = v; } };
}
async function connect(win, server) {
  await sleep(60);   // the real SDK import fails offline in jsdom; wait for that before plugging in the fake
  win.w.__fakeFs = makeFs(server);
  win.w.eval("fb = { app:{}, db:{}, fs: window.__fakeFs, au:{}, auth:{} }; cloudUser = { email:'chris@example.com' }; cloudStart();");
  await sleep(80);
}
const jd = win => win.w.eval('jobsData');
const firstEst = win => { const c = jd(win).customers[0]; return c && c.estimates[0]; };

(async () => {
  const server = makeServer();

  // ---------- device A: save a UV Printing job ----------
  const A = openWin({ joined: true });
  await connect(A, server);
  ok(A.w.eval('cloudActive()'), 'A connected to the fake cloud');
  A.w.switchTabByName('uv');
  ok(A.w.eval('currentTab') === 'uv', 'UV Printing tab opens');
  A.set('u0-n', 'Name tag'); A.set('u0-w', 3); A.set('u0-h', 1); A.set('u0-q', 10); A.set('u0-b', 0.5);
  A.w.uCalc();
  const quoteA = A.$('u-tt-quote').textContent;
  ok(/^\$\d/.test(quoteA) && quoteA !== '$0.00', 'UV tab prices a row (' + quoteA + ')');
  A.set('cb-name', 'Test Cust'); A.set('cb-title', '10 name tags');
  A.w.saveEstimate();
  await sleep(60);
  let e = firstEst(A);
  ok(e && e.tab === 'uv' && e.title === '10 name tags', 'saved under the title typed in the customer bar');
  ok(e && e.status === 'Waiting', 'new jobs start as Waiting');
  ok(e && /T\d\d:\d\d/.test(e.taken || ''), 'date and time taken recorded');
  ok(/Save updates it/.test(A.$('cb-active-hint').textContent), 'hint shows the saved job is open');
  ok(server.cols.estimates.size === 1 && server.cols.customers.size === 1, 'job pushed to the cloud');
  const cid = jd(A).customers[0].id, eid = e.id;

  // ---------- device B: sees it, reopens it, edits, Save updates in place ----------
  const B = openWin({ joined: true });
  await connect(B, server);
  B.w.switchTabByName('jobs');
  ok(jd(B).customers.length === 1 && firstEst(B).id === eid, 'B received the job');
  let list = B.$('jobs-list').innerHTML;
  ok(/dot-wait/.test(list) && /Taken /.test(list), 'B shows the Waiting dot and the time taken');
  B.w.loadEstimate(cid, eid, false); B.w.cobaConfirmAnswer(true);
  ok(B.w.eval('currentTab') === 'uv', 'Load opens the UV tab');
  ok(B.$('u-tt-quote').textContent === quoteA, 'UV job reopens at the same quote on another device');
  ok(B.$('cb-title').value === '10 name tags', 'Load fills the job title box');
  B.set('u0-q', 20); B.w.uCalc();
  const quoteB = B.$('u-tt-quote').textContent;
  B.w.saveEstimate();
  await sleep(80);
  ok(server.cols.estimates.size === 1, 'Save on an opened job updates it instead of adding a copy');
  ok(firstEst(A).totals.quote === quoteB && jd(A).customers[0].estimates.length === 1, 'A sees the updated quote, still one job');
  ok(firstEst(A).taken === e.taken && firstEst(A).status === 'Waiting', 'update keeps the date taken and the status');

  // duplicate = new working copy, saved as a second job
  B.w.loadEstimate(cid, eid, true); B.w.cobaConfirmAnswer(true);
  ok(/\(copy\)$/.test(B.$('cb-title').value) && B.$('cb-active-hint').textContent === '', 'Duplicate is a new unsaved copy');
  B.w.saveEstimate(); await sleep(80);
  ok(server.cols.estimates.size === 2, 'saving the duplicate adds a second job');
  const dupId = jd(B).customers[0].estimates.find(x => x.id !== eid).id;

  // ---------- old statuses: Quote shows as Waiting; status change propagates ----------
  const doc = server.cols.estimates.get(eid), j = JSON.parse(doc.json);
  j.status = 'Quote'; doc.json = JSON.stringify(j); doc.status = 'Quote';
  const doc2 = server.cols.estimates.get(dupId), j2 = JSON.parse(doc2.json);
  j2.status = 'Approved'; doc2.json = JSON.stringify(j2); doc2.status = 'Approved';
  serverPoke(server); await sleep(30);
  A.w.switchTabByName('jobs');
  list = A.$('jobs-list').innerHTML;
  ok(/dot-wait/.test(list) && /dot-go/.test(list), 'old Quote shows as Waiting and old Approved as In production');
  A.w.setEstStatus(cid, eid, 'In Production'); await sleep(80);
  ok(JSON.parse(server.cols.estimates.get(eid).json).status === 'In Production' && server.cols.estimates.get(eid).status === 'In Production', 'status change saved to the cloud');
  ok(jd(B).customers[0].estimates.find(x => x.id === eid).status === 'In Production', 'B sees the status change');
  A.w.setEstStatus(cid, eid, 'Done'); await sleep(80);
  ok(jd(B).customers[0].estimates.find(x => x.id === eid).status === 'Done', 'Done propagates');

  // ---------- notes ----------
  A.w.setCustNotes(cid, 'likes matte'); await sleep(80);
  ok(jd(B).customers[0].notes === 'likes matte', 'customer notes propagate');

  // ---------- manual log from the Jobs tab ----------
  A.set('cb-title', 'Phone order'); A.w.saveEstimate();
  ok(A.$('jobs-logform').style.display === 'block' && A.$('jl-title').value === 'Phone order', 'Jobs tab Save opens the log form with the title');
  A.set('jl-cust', 'Walk-in'); A.set('jl-amount', '45');
  A.w.jobsLogManual(); await sleep(80);
  const walk = jd(B).customers.find(c => c.name === 'Walk-in');
  ok(walk && walk.estimates[0].status === 'Waiting' && /T\d\d:\d\d/.test(walk.estimates[0].taken || ''), 'logged job reaches B as Waiting with time taken');

  // ---------- delete propagates; the open job is cleared ----------
  B.w.loadEstimate(cid, eid, false); B.w.cobaConfirmAnswer(true);
  B.w.deleteEstimate(cid, eid); B.w.cobaConfirmAnswer(true); await sleep(80);
  ok(!server.cols.estimates.has(eid), 'delete removed the cloud doc');
  ok(!jd(A).customers.find(c => c.id === cid).estimates.some(x => x.id === eid), 'A sees the delete');
  ok(B.$('cb-active-hint').textContent === '', 'deleting the open job clears the hint');

  // ---------- device C: saved while offline, pushed on reconnect ----------
  const C = openWin({ joined: true, lastsync: Date.now() - 5000, jobs: { customers: [] } });
  await sleep(60);
  C.w.switchTabByName('uv');
  C.set('u0-w', 2); C.set('u0-h', 2); C.set('u0-q', 5); C.w.uCalc();
  C.set('cb-name', 'Offline Cust'); C.set('cb-title', 'offline job');
  C.w.saveEstimate(); await sleep(20);
  ok(JSON.parse(C.w.localStorage.getItem('coba-jobs-v1')).customers.some(c => c.name === 'Offline Cust'), 'offline save kept on the device');
  await connect(C, server); await sleep(60);
  ok(Array.from(server.cols.customers.values()).some(d => d.name === 'Offline Cust'), 'offline job pushed on reconnect');
  ok(jd(A).customers.some(c => c.name === 'Offline Cust'), 'A receives the offline job');

  // ---------- device D: first time on the shared list, old local jobs merged ----------
  const D = openWin({ jobs: { customers: [{ id: 'c1700000000000', name: 'Legacy Co', phone: '', email: '', notes: '', estimates: [
    { id: 'e1700000000001', title: 'old quote', tab: 'log', date: '2026-07-01', status: 'Approved', totals: { grand: '$10.00' }, noteText: '', snap: null }] }] } });
  ok(D.w.eval('jobsData').customers[0].estimates[0].status === 'In Production', 'old local status converted on load');
  await connect(D, server);
  ok(D.$('cloud-merge').style.display === 'block', 'first-time device offers to merge its jobs');
  D.w.cloudMergeLocal(); await sleep(80);
  const leg = Array.from(server.cols.estimates.values()).find(d => d.title === 'old quote');
  ok(leg && leg.status === 'In Production', 'merged job reaches the cloud with the new status');

  // ---------- v42: To-Do / To-Invoice box ----------
  const rem = win => win.w.eval('remItems');
  const remDocs = () => Array.from(server.cols.reminders.values());
  ok(A.$('rem-box') && A.$('rem-box').closest('#panel-jobs'), 'To-Do / To-Invoice box sits on the Jobs tab');
  ok(A.$('rem-tab-todo').classList.contains('on') && /Nothing/.test(A.$('rem-list').textContent), 'box opens on To-Do, empty');
  A.set('rem-input', '   '); A.w.remAdd();
  ok(rem(A).length === 0, 'a blank name is not added');
  A.set('rem-input', '  Bob   Plumbing  '); A.w.remAdd(); await sleep(60);
  ok(rem(A).length === 1 && rem(A)[0].text === 'Bob Plumbing' && rem(A)[0].list === 'todo', 'name added to To-Do (spaces tidied)');
  ok(A.$('rem-input').value === '' && A.$('rem-n-todo').textContent === '1', 'add box cleared, To-Do count 1');
  ok(remDocs().length === 1 && remDocs()[0].list === 'todo' && remDocs()[0].text === 'Bob Plumbing' && remDocs()[0].t > 0, 'saved to the cloud as its own doc');
  ok(rem(B).some(x => x.text === 'Bob Plumbing') && B.$('rem-n-todo').textContent === '1' && /Bob Plumbing/.test(B.$('rem-list').textContent), 'B sees it in To-Do');
  A.w.remShow('invoice');
  ok(A.$('rem-box').getAttribute('data-view') === 'invoice' && A.$('rem-input').placeholder === 'Add to To-Invoice...' && A.$('rem-tab-invoice').classList.contains('on') && !A.$('rem-tab-todo').classList.contains('on'), 'header flips the box to To-Invoice');
  ok(!/Bob Plumbing/.test(A.$('rem-list').textContent) && /Nobody/.test(A.$('rem-list').textContent), 'To-Invoice does not show To-Do names');
  A.set('rem-input', 'Kelly <b>Signs</b>'); A.w.remAdd(); await sleep(60);
  ok(rem(A).find(x => x.list === 'invoice') && B.$('rem-n-invoice').textContent === '1' && B.$('rem-n-todo').textContent === '1', 'B counts 1 to do and 1 to invoice');
  ok(B.$('rem-box').getAttribute('data-view') === 'todo', 'each device keeps its own view');
  B.w.remShow('invoice');
  ok(/Kelly <b>Signs<\/b>/.test(B.$('rem-list').textContent) && !B.$('rem-list').querySelector('.rem-text b'), 'names are shown as typed, never as markup');
  const bobId = rem(B).find(x => x.text === 'Bob Plumbing').id;
  B.w.remShow('todo'); B.w.remDelete(bobId); await sleep(60);
  ok(!server.cols.reminders.has(bobId) && !rem(A).some(x => x.id === bobId) && A.$('rem-n-todo').textContent === '0', 'delete removes it everywhere');
  ok(B.$('rem-undo').style.display === 'flex' && /Bob Plumbing/.test(B.$('rem-undo-msg').textContent), 'Undo offered after a delete');
  B.w.remUndo(); await sleep(60);
  ok(server.cols.reminders.has(bobId) && rem(A).some(x => x.id === bobId) && B.$('rem-undo').style.display === 'none', 'Undo puts it back everywhere');
  ok(JSON.parse(B.w.localStorage.getItem('coba-reminders-v1')).items.length === 2, 'B keeps a local copy');

  // offline device: adds and deletes wait on the device, sent when the cloud list loads
  const kellyId = rem(A).find(x => x.list === 'invoice').id;
  const S = openWin({ joined: true, reminders: B.w.localStorage.getItem('coba-reminders-v1') });
  await sleep(60);
  ok(rem(S).length === 2 && S.$('rem-n-todo').textContent === '1' && S.$('rem-n-invoice').textContent === '1', 'offline device shows its saved copy');
  S.w.remShow('todo'); S.set('rem-input', 'Offline Co'); S.w.remAdd();
  S.set('rem-input', 'typo'); S.w.remAdd();
  const typoId = rem(S).find(x => x.text === 'typo').id;
  S.w.remDelete(typoId); S.w.remDelete(kellyId);
  const out = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(Object.keys(out.add).length === 1 && out.del[kellyId] === true && !out.add[typoId] && !out.del[typoId], 'offline changes wait on the device');
  await connect(S, server); await sleep(60);
  ok(remDocs().some(d => d.text === 'Offline Co') && !server.cols.reminders.has(kellyId) && !remDocs().some(d => d.text === 'typo'), 'offline add and delete sent on reconnect');
  ok(rem(A).some(x => x.text === 'Offline Co') && !rem(A).some(x => x.id === kellyId), 'A sees the offline changes');
  ok(rem(S).length === 2 && !rem(S).some(x => x.id === kellyId), 'reconnected device matches the cloud');
  const st = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1'));
  ok(Object.keys(st.out.add).length === 0 && Object.keys(st.out.del).length === 0, 'nothing left waiting');
  // signed out: changes wait, then go up on the next sign-in
  S.w.cloudStop(); S.w.eval('cloudUser = null');
  S.set('rem-input', 'After sign-out'); S.w.remAdd(); await sleep(30);
  ok(!remDocs().some(d => d.text === 'After sign-out') && rem(S).some(x => x.text === 'After sign-out'), 'signed out: stays on the device');
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(80);
  ok(remDocs().some(d => d.text === 'After sign-out') && rem(B).some(x => x.text === 'After sign-out'), 'sent after signing back in');
  ok(rem(B)[0].text === 'After sign-out', 'newest name at the top');

  // ---------- structured paper inventory: migration from the old name-only list ----------
  const oldInv = JSON.stringify({
    papers: [
      { name: 'Mohawk 18x12 100# eggshell', cost: 0.95, supplier: 'Spicer' },
      { name: 'Hammermill 32#', cost: 0.11, supplier: 'Spicer' },
      { name: 'My Special 80# Cover 11x17', cost: 0.33, supplier: 'Spicers' }
    ],
    toner: [{ name: 'Colour click', cost: 0.06 }]
  });
  const E = openWin({ inventory: oldInv });
  await sleep(40);
  const papers = E.w.eval('inventory.papers');
  const moh = papers.find(p => /Mohawk Eggshell/.test(p.brand || ''));
  ok(moh && moh.weight === 100 && moh.unit === '#' && moh.size === '12x18' && moh.cost === 0.95, 'known paper keeps its edited cost in the new layout');
  const my = papers.find(p => /My Special/.test(p.brand || ''));
  ok(my && my.weight === 80 && my.unit === '#' && my.size === '11x17' && my.cost === 0.33, 'custom paper parsed into brand / weight / size');
  const ham = papers.find(p => /Hammermill/.test(p.brand || '') && p.weight === 32);
  ok(ham && (ham.unsure || []).indexOf('size') >= 0, 'unknown size flagged with ?');
  ok(papers.filter(p => /Zodia/.test(p.brand || '')).length === 1, 'Zodia added once');
  ok(papers.every(p => p.name === undefined && typeof p.brand === 'string'), 'no old name-only entries left');
  const opts = Array.from(E.w.document.querySelectorAll('select option')).map(o => o.textContent);
  ok(opts.some(t => /^100# Mohawk Eggshell 12x18/.test(t)), 'paper dropdowns show weight brand size');
  ok(/flagged with \?/.test(E.$('inv-paper-flags').textContent), 'flag count shown on the Inventory tab');
  const saved = JSON.parse(E.w.localStorage.getItem('coba-inventory-v2'));
  ok(saved.papers.every(p => p.brand !== undefined), 'migrated inventory saved');

  // ---------- v37: Husky Digital Opaque 24# 11x17 reaches every inventory once ----------
  const isHusky = p => /husky/i.test(p.brand || '') && p.size === '11x17';
  const hk = papers.filter(isHusky);
  ok(hk.length === 1 && hk[0].weight === 24 && hk[0].unit === '#' && hk[0].cost === 0.05409 && saved.added.indexOf('husky-11x17-v37') >= 0, 'Husky 24# 11x17 added to a saved inventory once, and tagged');
  ok(opts.indexOf('24# Husky Digital Opaque Smooth 11x17') >= 0, 'Husky 11x17 in the Paper tab dropdowns');
  const huskyOpt = Array.from(E.$('pp-s0').options).find(o => /Husky/.test(o.textContent));
  E.$('pp-s0').value = huskyOpt.value; E.w.pSetPaper(0);
  ok(E.$('pp-c0').value === '0.054', 'choosing it fills in its cost per sheet: ' + E.$('pp-c0').value);
  const F = openWin({}); await sleep(40);   // fresh device
  ok(F.w.eval('inventory.papers').filter(isHusky).length === 1 && F.w.eval('inventory.added').indexOf('husky-11x17-v37') >= 0, 'fresh inventory has it once');
  const inv1 = JSON.parse(E.w.localStorage.getItem('coba-inventory-v2'));
  inv1.papers = inv1.papers.filter(p => !isHusky(p));   // Chris removes it
  const G = openWin({ inventory: JSON.stringify(inv1) }); await sleep(40);
  ok(G.w.eval('inventory.papers').filter(isHusky).length === 0, 'a removed Husky paper stays removed');
  const inv2 = JSON.parse(E.w.localStorage.getItem('coba-inventory-v2'));
  inv2.added = inv2.added.filter(t => t !== 'husky-11x17-v37');   // a v36 inventory with its own Husky 11x17 entry
  inv2.papers = inv2.papers.filter(p => !isHusky(p)).concat([{ brand: 'Husky', weight: 24, unit: '#', size: '11x17', cost: 0.06, supplier: 'Spicer', unsure: [] }]);
  const H = openWin({ inventory: JSON.stringify(inv2) }); await sleep(40);
  const hh = H.w.eval('inventory.papers').filter(isHusky);
  ok(hh.length === 1 && hh[0].cost === 0.06, 'an existing Husky 11x17 entry is not duplicated or changed');

  // ---------- v38: Double A 20# 11x17 + Rolland Enviro 100# cover 26x40 added; 13x19 repriced (26x40 cut 4-up) ----------
  const isDA = p => /double a/i.test(p.brand || '') && p.size === '11x17';
  const isR26 = p => /rolland/i.test(p.brand || '') && p.size === '26x40';
  const isR13 = p => +p.weight === 100 && /rolland|sustana/i.test(p.brand || '') && p.size === '13x19';
  const fp = F.w.eval('inventory.papers');
  ok(fp.filter(isDA).length === 1 && fp.filter(isDA)[0].cost === 0.02117 && fp.filter(isR26).length === 1 && fp.filter(isR26)[0].cost === 0.937, 'fresh inventory: Double A 11x17 and Rolland 26x40 at their invoice prices');
  ok(fp.filter(isR13).length === 1 && fp.filter(isR13)[0].cost === 0.23425 && !fp.some(p => /Sustana Cover/.test(p.brand || '')), 'fresh inventory: Rolland Enviro 13x19 at 937 / 4 / 1000');
  ok(papers.filter(isR13).length === 1 && papers.filter(isDA).length === 1 && papers.filter(isR26).length === 1, 'an inventory with no Rolland 100# gets all three once');
  // an inventory saved by v37: no v38 papers, the Sustana 100# default still 12x18 with the size unconfirmed
  const v37 = JSON.parse(F.w.eval('JSON.stringify(inventory)'));
  v37.added = v37.added.filter(t => !/-v38$/.test(t));
  v37.papers = v37.papers.filter(p => !isDA(p) && !isR26(p)).map(p => isR13(p) ? Object.assign({}, p, { brand: 'Sustana Cover (100% recycled)', size: '12x18', cost: 0.21, unsure: ['size'] }) : p);
  const I = openWin({ inventory: JSON.stringify(v37) }); await sleep(40);
  const ip = I.w.eval('inventory.papers'), r13 = ip.filter(isR13);
  ok(ip.filter(isDA).length === 1 && ip.filter(isR26).length === 1, 'v37 inventory gets Double A 11x17 and Rolland 26x40 once');
  ok(r13.length === 1 && r13[0].cost === 0.23425 && r13[0].brand === 'Rolland Enviro Cover' && (r13[0].unsure || []).length === 0 && !ip.some(p => /Sustana Cover/.test(p.brand || '')), 'its Sustana 100# 12x18? becomes Rolland Enviro Cover 13x19 at $0.23425');
  const iopts = Array.from(I.$('pp-s0').options).map(o => o.textContent);
  ok(['20# Double A Everyday 11x17', '100# Rolland Enviro Cover 13x19', '100# Rolland Enviro Cover 26x40'].every(t => iopts.indexOf(t) >= 0), 'all three in the Paper tab dropdowns');
  I.$('pp-s0').value = '0.23425'; I.w.pSetPaper(0);
  ok(I.$('pp-c0').value === '0.234', 'choosing the 13x19 fills in $0.234 a sheet: ' + I.$('pp-c0').value);
  // Chris's own 100# Rolland 13x19 entry gets the price; the unconfirmed Sustana default is then left alone
  const v37b = JSON.parse(JSON.stringify(v37));
  v37b.papers.push({ brand: 'Rolland Cover', weight: 100, unit: '#', size: '13x19', cost: 0.28, supplier: 'Spicer', unsure: [] });
  const J = openWin({ inventory: JSON.stringify(v37b) }); await sleep(40);
  const jp = J.w.eval('inventory.papers');
  ok(jp.filter(isR13).length === 1 && jp.filter(isR13)[0].brand === 'Rolland Cover' && jp.filter(isR13)[0].cost === 0.23425 && jp.some(p => p.brand === 'Sustana Cover (100% recycled)' && p.size === '12x18'), 'an existing 100# Rolland 13x19 gets the new price, nothing else changes');
  // once only: a price edited afterwards is kept
  const after = JSON.parse(I.w.localStorage.getItem('coba-inventory-v2'));
  after.papers.forEach(p => { if (isR13(p)) p.cost = 0.25; });
  const K = openWin({ inventory: JSON.stringify(after) }); await sleep(40);
  ok(K.w.eval('inventory.papers').filter(isR13)[0].cost === 0.25, 'the price change runs once: a later edit is kept');

  // ---------- v40: Finesse Gloss Text 100# 12x18 (Spicer FING111, $83.42 / 1000) reaches every inventory once ----------
  const isFin = p => /finesse/i.test(p.brand || '') && +p.weight === 100 && p.size === '12x18';   // v41: the 80# is 12x18 too
  const ff = F.w.eval('inventory.papers').filter(isFin);
  ok(ff.length === 1 && ff[0].weight === 100 && ff[0].unit === '#' && ff[0].cost === 0.08342 && F.w.eval('inventory.added').indexOf('finesse-12x18-v40') >= 0, 'fresh inventory: Finesse 100# 12x18 once at $83.42 / 1000');
  ok(papers.filter(isFin).length === 1 && saved.added.indexOf('finesse-12x18-v40') >= 0, 'an older saved inventory gets it once, and tagged');
  const v39 = JSON.parse(F.w.eval('JSON.stringify(inventory)'));   // an inventory saved by v39: no Finesse, no Finesse tags
  v39.added = v39.added.filter(t => !/^finesse-/.test(t));
  v39.papers = v39.papers.filter(p => !/finesse/i.test(p.brand || ''));
  const L = openWin({ inventory: JSON.stringify(v39) }); await sleep(40);
  const lf = L.w.eval('inventory.papers').filter(isFin);
  ok(lf.length === 1 && lf[0].cost === 0.08342 && L.w.eval('inventory.added').indexOf('finesse-12x18-v40') >= 0, 'v39 inventory gets Finesse 100# 12x18 once, tagged');
  const finOpt = Array.from(L.$('pp-s0').options).find(o => o.textContent === '100# UPM Finesse Gloss Text 12x18');
  ok(!!finOpt, 'Finesse in the Paper tab dropdowns as "100# UPM Finesse Gloss Text 12x18"');
  L.$('pp-s0').value = finOpt.value; L.w.pSetPaper(0);
  ok(L.$('pp-c0').value === '0.083', 'choosing it fills in $0.083 a sheet: ' + L.$('pp-c0').value);
  L.$('pp-n0').value = '1000'; L.w.pCalc();
  ok(/83\.00/.test(L.$('pp-rc0').textContent) && /249\.00/.test(L.$('pp-rr0').textContent), '1000 sheets: cost ' + L.$('pp-rc0').textContent + ', retail ' + L.$('pp-rr0').textContent + ' (x3)');
  const inv3 = JSON.parse(L.w.localStorage.getItem('coba-inventory-v2'));
  inv3.papers = inv3.papers.filter(p => !isFin(p));   // Chris removes it
  const M = openWin({ inventory: JSON.stringify(inv3) }); await sleep(40);
  ok(M.w.eval('inventory.papers').filter(isFin).length === 0, 'a removed Finesse paper stays removed');
  const v39b = JSON.parse(JSON.stringify(v39));   // a v39 inventory where Chris already typed in his own Finesse 12x18
  v39b.papers.push({ brand: 'UPM Finesse Gloss', weight: 100, unit: '#', size: '12x18', cost: 0.09, supplier: 'Spicers', unsure: [] });
  const N = openWin({ inventory: JSON.stringify(v39b) }); await sleep(40);
  const nf = N.w.eval('inventory.papers').filter(isFin);
  ok(nf.length === 1 && nf[0].brand === 'UPM Finesse Gloss' && nf[0].cost === 0.09, 'an existing Finesse 12x18 entry is not duplicated or changed');

  // ---------- v41: UPM in both Finesse names; Finesse 80# 12x18 (Spicer FING108, $66.74 / 1000) added ----------
  const isFin80 = p => /finesse/i.test(p.brand || '') && +p.weight === 80 && p.size === '12x18';
  const fp41 = F.w.eval('inventory.papers'), fa41 = F.w.eval('inventory.added');
  ok(fp41.filter(isFin80).length === 1 && fp41.filter(isFin80)[0].cost === 0.06674 && fp41.filter(isFin80)[0].unit === '#' && fa41.indexOf('finesse-80-12x18-v41') >= 0 && fa41.indexOf('finesse-upm-v41') >= 0, 'fresh inventory: Finesse 80# 12x18 once at $66.74 / 1000, tagged');
  ok(fp41.filter(p => /finesse/i.test(p.brand || '')).every(p => p.brand === 'UPM Finesse Gloss Text'), 'fresh inventory: both Finesse papers named UPM Finesse Gloss Text');
  const lp = L.w.eval('inventory.papers');
  ok(lp.filter(isFin).length === 1 && lp.filter(isFin80).length === 1, 'v39 inventory gets the 100# and the 80# once each (matched by weight, neither blocks the other)');
  const lopts = Array.from(L.$('pp-s1').options).map(o => o.textContent);
  ok(['80# UPM Finesse Gloss Text 12x18', '100# UPM Finesse Gloss Text 12x18'].every(t => lopts.indexOf(t) >= 0) && !lopts.some(t => /\d# Finesse/.test(t)), 'Paper tab dropdowns: 80# and 100# UPM Finesse Gloss Text 12x18');
  const fin80Opt = Array.from(L.$('pp-s1').options).find(o => o.textContent === '80# UPM Finesse Gloss Text 12x18');
  L.$('pp-s1').value = fin80Opt.value; L.w.pSetPaper(1); L.$('pp-n1').value = '1000'; L.w.pCalc();
  ok(L.$('pp-c1').value === '0.067' && /67\.00/.test(L.$('pp-rc1').textContent) && /201\.00/.test(L.$('pp-rr1').textContent), '80#, 1000 sheets: $' + L.$('pp-c1').value + ' a sheet, cost ' + L.$('pp-rc1').textContent + ', retail ' + L.$('pp-rr1').textContent + ' (x3)');
  // an inventory saved by v40: its 100# is still "Finesse Gloss Text" (here at a price Chris edited), no 80# yet
  const v40 = JSON.parse(F.w.eval('JSON.stringify(inventory)'));
  v40.added = v40.added.filter(t => !/-v41$/.test(t));
  v40.papers = v40.papers.filter(p => !isFin80(p)).map(p => isFin(p) ? Object.assign({}, p, { brand: 'Finesse Gloss Text', cost: 0.085 }) : p);
  const O = openWin({ inventory: JSON.stringify(v40) }); await sleep(40);
  const op = O.w.eval('inventory.papers');
  ok(op.filter(isFin).length === 1 && op.filter(isFin)[0].brand === 'UPM Finesse Gloss Text' && op.filter(isFin)[0].cost === 0.085, 'v40 inventory: the 100# is renamed UPM Finesse Gloss Text, its price left alone');
  ok(op.filter(isFin80).length === 1 && !op.some(p => p.brand === 'Finesse Gloss Text'), 'v40 inventory: the 80# added once, no old name left');
  // a v40 inventory where Chris deleted the 100#: the rename does not bring it back
  const v40b = JSON.parse(JSON.stringify(v40));
  v40b.papers = v40b.papers.filter(p => !isFin(p));
  const Q = openWin({ inventory: JSON.stringify(v40b) }); await sleep(40);
  ok(Q.w.eval('inventory.papers').filter(isFin).length === 0 && Q.w.eval('inventory.papers').filter(isFin80).length === 1, 'a deleted 100# stays deleted; the 80# still arrives');
  // a removed 80# stays removed
  const inv4 = JSON.parse(O.w.localStorage.getItem('coba-inventory-v2'));
  inv4.papers = inv4.papers.filter(p => !isFin80(p));
  const R = openWin({ inventory: JSON.stringify(inv4) }); await sleep(40);
  ok(R.w.eval('inventory.papers').filter(isFin80).length === 0, 'a removed 80# Finesse stays removed');

  // ---------- no page errors anywhere ----------
  [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, Q, R, S].forEach((x, i) => ok(x.errs.length === 0, 'window ' + 'ABCDEFGHIJKLMNOQRS'[i] + ' page errors: ' + x.errs.slice(0, 3).join(' | ')));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
