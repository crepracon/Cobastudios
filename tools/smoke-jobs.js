#!/usr/bin/env node
// Smoke test for the Jobs module with cloud sync, using a fake Firestore shared by several
// headless windows (jsdom), like two computers signed in to the same shared list.
//   NODE_PATH=/path/to/node_modules node tools/smoke-jobs.js [index.html]
// Needs jsdom (npm install jsdom in any scratch folder, then point NODE_PATH at it).
// Covers: job title box + Save updates the open job in place, Waiting / In production / Done
// statuses (old Quote / Approved jobs shown and saved in the new set), date + time taken,
// manual log, status / notes / delete propagation between devices, a job saved offline pushed
// on reconnect, first-time device merge, UV Printing jobs saved and reopened on another device,
// and the structured paper inventory migration. Plain ASCII only.
const fs = require('fs'), path = require('path');
const { JSDOM } = require('jsdom');
const SRC = process.argv[2] || path.resolve(__dirname, '..', 'index.html');
const HTML = fs.readFileSync(SRC, 'utf8');
const PROJECT = 'coba-studios-estimator';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL: ' + m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- fake Firestore: one server, any number of client windows ----
function makeServer() { return { cols: { customers: new Map(), estimates: new Map() }, listeners: [], writes: 0 }; }
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

  // ---------- no page errors anywhere ----------
  [A, B, C, D, E].forEach((x, i) => ok(x.errs.length === 0, 'window ' + 'ABCDE'[i] + ' page errors: ' + x.errs.slice(0, 3).join(' | ')));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
