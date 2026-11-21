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
// or signed out sent on reconnect; v48: reorder synced as one small write per move, moves made
// offline sent on reconnect, a name deleted elsewhere never comes back, the date added coloured by
// age; v50: move a To-Do name to To-Invoice, live and offline, with Undo; v59: every new job puts
// "Customer - Job title" on To-Do (saved, duplicated, logged, saved offline; not on an update or a
// merge), back from To-Invoice to To-Do in its old place, the x on To-Invoice files a name in the
// Archived folder (per-device open state, back to To-Invoice, delete for good, offline)), v50 Paid
// jobs (Paid section under the list, synced, per-device open state, search, Not paid), and the
// structured paper inventory migration. Plain ASCII only.
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
        update(ref, data) { ops.push(['upd', ref, JSON.parse(JSON.stringify(data))]); },
        delete(ref) { ops.push(['del', ref]); },
        commit() {
          return new Promise((res, rej) => setTimeout(() => {
            // like Firestore: an update of a missing doc fails the whole batch with not-found
            if (ops.some(o => o[0] === 'upd' && !server.cols[o[1].name].has(o[1].id))) { server.notFound = (server.notFound || 0) + 1; rej({ code: 'not-found', message: 'No document to update' }); return; }
            ops.forEach(o => { const m = server.cols[o[1].name]; server.writes++; if (o[0] === 'set') m.set(o[1].id, o[2]); else if (o[0] === 'upd') m.set(o[1].id, Object.assign({}, m.get(o[1].id), o[2])); else m.delete(o[1].id); });
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
  ok(A.$('jobs-toast').textContent === 'Saved "10 name tags" under Test Cust - added to To-Do', 'v59: the save toast says it went on To-Do: ' + A.$('jobs-toast').textContent);
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
  ok(/^Updated /.test(B.$('jobs-toast').textContent) && !/To-Do/.test(B.$('jobs-toast').textContent), 'v59: an update says nothing about To-Do');

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
  ok(Object.values(JSON.parse(C.w.localStorage.getItem('coba-reminders-v1')).out.add).some(x => x.text === 'Offline Cust - offline job' && x.list === 'todo'), 'v59: a job saved offline: its To-Do name waits on the device');
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

  // ---------- v59: every new job also went on To-Do (saved, duplicated + saved, logged, saved offline) ----------
  const autoTexts = ['Test Cust - 10 name tags', 'Test Cust - 10 name tags (copy)', 'Walk-in - Phone order', 'Offline Cust - offline job'];
  ok(remDocs().length === 4 && autoTexts.every(t => remDocs().filter(d => d.text === t).length === 1) && remDocs().every(d => d.list === 'todo'),
    'v59: each new job put one name on To-Do: ' + remDocs().map(d => d.text).join(', '));
  const auto0 = remDocs().find(d => d.text === autoTexts[0]) || {};
  ok(auto0.job === eid && auto0.cid === cid && auto0.t === Date.parse(e.taken), 'v59: the name keeps the job ids and is dated when the job was taken');
  ok(remDocs().filter(d => d.job === eid).length === 1, 'v59: saving the opened job again (an update) added no second name');
  ok((remDocs().find(d => d.text === autoTexts[1]) || {}).job === dupId && (remDocs().find(d => d.text === autoTexts[2]) || {}).job === walk.estimates[0].id, 'v59: the saved duplicate and the logged job have names of their own');
  ok(!remDocs().some(d => /Legacy Co/.test(d.text)), 'v59: jobs merged from an old device are not new jobs: no names for them');
  ok(B.$('rem-n-todo').textContent === '4' && /Test Cust - 10 name tags/.test(B.$('rem-list').textContent) && B.$('rem-list').querySelectorAll('.rem-date').length === 4, 'v59: B shows them on To-Do with their dates');
  // cleared, so the v42 checks below start from an empty box as before
  A.w.eval('remItems.slice().forEach(x => remDelete(x.id)); remUndoHide();'); await sleep(80);
  ok(remDocs().length === 0 && rem(B).length === 0 && rem(C).length === 0, 'v59: cleared for the checks below');

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

  // ---------- v48: drag to reorder (synced), date added coloured by age ----------
  const todo = win => rem(win).filter(x => x.list === 'todo').map(x => x.text);
  const shown = win => Array.from(win.$('rem-list').querySelectorAll('.rem-item .rem-text')).map(el => el.textContent);
  const rid = (win, t) => rem(win).find(x => x.text === t).id;
  A.w.remShow('todo'); B.w.remShow('todo');
  for (const t of ['Alpha', 'Bravo', 'Charlie']) { A.set('rem-input', t); A.w.remAdd(); await sleep(4); }
  await sleep(60);
  const start = ['Charlie', 'Bravo', 'Alpha', 'After sign-out', 'Offline Co', 'Bob Plumbing'];
  ok(todo(A).join() === start.join() && todo(B).join() === start.join(), 'v48: start order, newest on top: ' + todo(B).join(', '));
  const it0 = A.$('rem-list').querySelector('.rem-item');
  ok(it0 && it0.children[0].className === 'rem-grip' && it0.children[1].className === 'rem-text' && it0.children[2].className === 'rem-date' && it0.children[3].className === 'rem-mv' && it0.children[4].className === 'rem-del',
    'v48: each name = grip, text, date on the right, (v50: move to To-Invoice), delete');
  ok(it0.getAttribute('data-id') === rid(A, 'Charlie') && it0.querySelector('.rem-grip').getAttribute('onpointerdown').indexOf(rid(A, 'Charlie')) > 0, 'v48: grip wired to its name');
  let w0 = server.writes;
  ok(A.w.remMove(rid(A, 'Alpha'), 0) === true, 'v48: move Alpha to the top');
  await sleep(60);
  let want = ['Alpha', 'Charlie', 'Bravo', 'After sign-out', 'Offline Co', 'Bob Plumbing'];
  ok(todo(A).join() === want.join() && shown(A).join() === want.join(), 'v48: A shows the new order: ' + shown(A).join(', '));
  ok(todo(B).join() === want.join() && shown(B).join() === want.join(), 'v48: B gets the new order: ' + shown(B).join(', '));
  ok(server.writes === w0 + 1 && typeof server.cols.reminders.get(rid(A, 'Alpha')).o === 'number', 'v48: one move = one write (o on that name only)');
  const alpha = server.cols.reminders.get(rid(A, 'Alpha'));
  ok(alpha.text === 'Alpha' && alpha.list === 'todo' && alpha.t > 0, 'v48: a move keeps the name, list and date added');
  ok(A.w.remMove(rid(A, 'Alpha'), 0) === false && server.writes === w0 + 1, 'v48: dropping a name where it already is writes nothing');
  B.w.remMove(rid(B, 'Charlie'), 99); await sleep(60);   // past the end = bottom
  want = ['Alpha', 'Bravo', 'After sign-out', 'Offline Co', 'Bob Plumbing', 'Charlie'];
  ok(shown(A).join() === want.join() && shown(B).join() === want.join(), 'v48: move to the bottom from B, A follows: ' + shown(A).join(', '));
  A.w.remMove(rid(A, 'Bob Plumbing'), 1); await sleep(60);
  want = ['Alpha', 'Bob Plumbing', 'Bravo', 'After sign-out', 'Offline Co', 'Charlie'];
  ok(shown(B).join() === want.join(), 'v48: move into the middle: ' + shown(B).join(', '));
  ok(B.$('rem-n-todo').textContent === '6' && rem(B).filter(x => x.list === 'invoice').length === rem(A).filter(x => x.list === 'invoice').length, 'v48: counts unchanged, To-Invoice untouched');
  // keyboard: arrow keys on the grip move the name one place
  B.w.remGripKey({ key: 'ArrowDown', preventDefault() {} }, rid(B, 'Alpha')); await sleep(60);
  ok(shown(B).slice(0, 2).join() === 'Bob Plumbing,Alpha' && shown(A).slice(0, 2).join() === 'Bob Plumbing,Alpha', 'v48: Arrow Down moves a name down one (A follows)');
  ok(B.w.document.activeElement && B.w.document.activeElement.className === 'rem-grip' && B.w.document.activeElement.parentNode.getAttribute('data-id') === rid(B, 'Alpha'), 'v48: the grip keeps focus after a keyboard move');
  B.w.remGripKey({ key: 'ArrowUp', preventDefault() {} }, rid(B, 'Alpha')); await sleep(60);
  B.w.remGripKey({ key: 'ArrowUp', preventDefault() {} }, rid(B, 'Alpha')); await sleep(60);
  ok(shown(B)[0] === 'Alpha' && shown(A)[0] === 'Alpha', 'v48: Arrow Up at the top stays at the top');
  // drop lookups: under a name, over a name, or at the top
  ok(A.w.remMoveNear(rid(A, 'Charlie'), rid(A, 'Alpha'), null) === true, 'v48: drop under a name');
  await sleep(60);
  ok(shown(B).slice(0, 2).join() === 'Alpha,Charlie', 'v48: dropped right under it: ' + shown(B).join(', '));
  ok(A.w.remMoveNear(rid(A, 'Charlie'), 'gone-on-another-device', rid(A, 'Offline Co')) === true, 'v48: drop over a name when the one above is gone');
  await sleep(60);
  ok(shown(B)[shown(B).indexOf('Offline Co') - 1] === 'Charlie', 'v48: dropped right over it: ' + shown(B).join(', '));
  // a new name still lands on top, a moved name keeps its place through delete + undo
  A.set('rem-input', 'Delta'); A.w.remAdd(); await sleep(60);
  ok(shown(A)[0] === 'Delta' && shown(B)[0] === 'Delta', 'v48: a new name still lands on top');
  A.w.remMove(rid(A, 'Bravo'), 1); await sleep(60);
  const bravoAt = shown(B).indexOf('Bravo');
  A.w.remDelete(rid(A, 'Bravo')); await sleep(60);
  A.w.remUndo(); await sleep(60);
  ok(bravoAt === 1 && shown(A).indexOf('Bravo') === 1 && shown(B).indexOf('Bravo') === 1, 'v48: Undo puts a moved name back in its place');
  // no room left between two neighbours: the list is numbered again, order kept, everyone follows
  // (two names given the same o on the cloud, as if 20-odd moves had used up the room between them)
  A.w.eval("const P = remItems.filter(x => x.list === 'todo').slice(1, 3); P.forEach(x => { x.o = remKey(P[0]); }); remWriteOrder(P); remSort(); remRender();");
  await sleep(80);
  const top3 = shown(A).slice(0, 3), third = shown(A)[4];
  const w48 = server.writes;
  A.w.remMove(rid(A, third), 2); await sleep(80);
  const keys = rem(A).filter(x => x.list === 'todo').map(x => A.w.remKey(x));
  ok(shown(A).slice(0, 4).join() === [top3[0], top3[1], third, top3[2]].join() && keys.every((k, i) => !i || keys[i - 1] > k), 'v48: no room between two names: list numbered again: ' + shown(A).join(', '));
  ok(server.writes > w48 + 1 && keys[0] <= Date.now() + 5, 'v48: renumbering writes the list once and keeps new names landing on top');
  ok(shown(B).join() === shown(A).join(), 'v48: B follows the renumbered list');
  // offline: a move waits on the device and is sent on reconnect; one deleted elsewhere stays deleted
  S.w.cloudStop(); S.w.eval('cloudUser = null');
  S.w.remShow('todo');
  const sTop = shown(S)[0], sLast = shown(S)[shown(S).length - 1];
  S.w.remMove(rid(S, sLast), 0);
  S.w.remMove(rid(S, 'Alpha'), 99);
  const goneId = rid(S, 'Alpha');
  let st2 = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(typeof st2.mov[rid(S, sLast)] === 'number' && typeof st2.mov[goneId] === 'number' && shown(S)[0] === sLast, 'v48: offline moves wait on the device (' + sLast + ' to the top)');
  A.w.remDelete(goneId); await sleep(60);   // Alpha deleted on A while S is offline
  const nf48 = server.notFound || 0;
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(100);
  ok(shown(A)[0] === sLast && shown(B)[0] === sLast && shown(A)[1] === sTop, 'v48: offline move sent on reconnect: ' + shown(A).join(', '));
  ok(!server.cols.reminders.has(goneId) && !rem(S).some(x => x.id === goneId) && !rem(A).some(x => x.id === goneId), 'v48: a name moved offline but deleted elsewhere stays deleted');
  ok((server.notFound || 0) === nf48, 'v48: no write sent for the deleted name');
  st2 = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(Object.keys(st2.mov).length === 0 && Object.keys(st2.add).length === 0 && Object.keys(st2.del).length === 0, 'v48: nothing left waiting');
  // a live move of a name deleted a moment ago on another device does not bring it back
  const ghost = rid(A, 'Delta');
  A.w.remDelete(ghost); B.w.eval("remItems = remItems.concat([]);");
  B.w.eval("remCloud.set('" + ghost + "', { list:'todo', text:'Delta', t: 1 });");   // B has not heard of the delete yet
  B.w.remWriteOrder([{ id: ghost, o: 9e12 }]); await sleep(80);
  ok(!server.cols.reminders.has(ghost) && (server.notFound || 0) === nf48 + 1 && B.errs.length === 0 && !/failed/.test(B.$('cloud-status') ? B.$('cloud-status').textContent : ''), 'v48: a move of a just-deleted name fails quietly, name stays deleted');
  serverPoke(server); await sleep(30);
  // a v42 copy on a device (no mov waiting list) still loads and can wait for moves offline
  const V = openWin({ reminders: JSON.stringify({ items: [{ id: 'r1-aaaa', list: 'todo', text: 'Old one', t: 1700000000000 }, { id: 'r2-bbbb', list: 'todo', text: 'Old two', t: 1700000100000 }], out: { add: {}, del: {} }, view: 'todo' }) });
  await sleep(40);
  ok(shown(V).join() === 'Old two,Old one', 'v48: a v42 copy loads in its order');
  V.w.remMove('r1-aaaa', 0);
  ok(shown(V).join() === 'Old one,Old two' && typeof JSON.parse(V.w.localStorage.getItem('coba-reminders-v1')).out.mov['r1-aaaa'] === 'number', 'v48: and keeps an offline move waiting');
  // date added: on the right, coloured by age
  const now = Date.now(), DAY = 864e5;
  ok(A.w.remAgeHue(now, now) === 120 && A.w.remAgeHue(now + DAY, now) === 120 && A.w.remAgeHue(now - 1.5 * DAY, now) === 90 && A.w.remAgeHue(now - 3 * DAY, now) === 60 &&
    A.w.remAgeHue(now - 4.5 * DAY, now) === 30 && A.w.remAgeHue(now - 6 * DAY, now) === 0 && A.w.remAgeHue(now - 40 * DAY, now) === 0,
    'v48: colour fades green (new) - yellow (3 days) - orange (4.5) - red (6 and older)');
  const d0 = A.$('rem-list').querySelector('.rem-date');
  ok(d0 && /hsl\(120,/.test(d0.getAttribute('style')) && /^[A-Z][a-z]{2} \d{1,2}$/.test(d0.textContent) && /^Added .* \((less than an hour|\d+ hours?) ago\)$/.test(d0.title),
    'v48: a name added today shows its date in green: ' + (d0 && d0.textContent + ' / ' + d0.title));
  ok(/^Added .* \(2 days ago\)$/.test(A.w.remAgeTitle(now - 2.2 * DAY, now)) && /\(1 day ago\)$/.test(A.w.remAgeTitle(now - 1.1 * DAY, now)), 'v48: hover tells how old it is');
  d0.setAttribute('data-t', String(now - 7 * DAY)); A.w.remAgeRefresh();
  ok(/hsl\(0,/.test(d0.getAttribute('style')) && /7 days ago/.test(d0.title), 'v48: colours are refreshed while the page stays open');
  const old = { id: 'r1-cccc', list: 'invoice', text: 'Week-old invoice', t: now - 5 * DAY };
  A.w.remPut(old); await sleep(60);
  B.w.remShow('invoice');
  const dB = Array.from(B.$('rem-list').querySelectorAll('.rem-item')).find(el => /Week-old/.test(el.textContent)).querySelector('.rem-date');
  ok(/hsl\(20,/.test(dB.getAttribute('style')), 'v48: To-Invoice names are coloured too (5 days = ' + dB.getAttribute('style').slice(0, 18) + ')');
  B.w.remShow('todo'); A.w.remDelete(old.id); await sleep(60);

  // ---------- v50: move a To-Do name to To-Invoice ----------
  A.w.remShow('todo'); B.w.remShow('todo');
  A.set('rem-input', 'Move Me'); A.w.remAdd(); await sleep(60);
  const mvId = rid(A, 'Move Me'), mvT = rem(A).find(x => x.id === mvId).t;
  const nTodo = rem(A).filter(x => x.list === 'todo').length, nInv = rem(A).filter(x => x.list === 'invoice').length;
  ok(A.$('rem-list').querySelectorAll('.rem-item').length === nTodo && A.$('rem-list').querySelectorAll('.rem-mv').length === nTodo, 'v50: every To-Do name has a move button');
  const mvBtn = A.$('rem-list').querySelector('.rem-item[data-id="' + mvId + '"] .rem-mv');
  ok(mvBtn && mvBtn.title === 'Move to To-Invoice' && mvBtn.nextElementSibling.className === 'rem-del', 'v50: the move button sits just before the delete button');
  await sleep(5);
  mvBtn.click(); await sleep(60);
  let mv = rem(A).find(x => x.id === mvId), mvDoc = server.cols.reminders.get(mvId);
  ok(mv.list === 'invoice' && mv.t > mvT && !('o' in mv) && mvDoc.list === 'invoice' && mvDoc.t === mv.t && !('o' in mvDoc) && mvDoc.text === 'Move Me', 'v50: moved to To-Invoice, date restarted, saved to the cloud');
  ok(A.$('rem-n-todo').textContent === String(nTodo - 1) && A.$('rem-n-invoice').textContent === String(nInv + 1) && A.$('rem-box').getAttribute('data-view') === 'todo', 'v50: counts follow, the box stays on To-Do');
  ok(B.$('rem-n-invoice').textContent === String(nInv + 1) && rem(B).find(x => x.id === mvId).list === 'invoice', 'v50: B sees it moved');
  ok(A.$('rem-undo').style.display === 'flex' && A.$('rem-undo-msg').textContent === 'Moved Move Me to To-Invoice', 'v50: Undo offered after a move');
  B.w.remShow('invoice');
  ok(B.$('rem-list').querySelector('.rem-item').getAttribute('data-id') === mvId && B.$('rem-list').querySelectorAll('.rem-mv').length === 0, 'v50: lands on top of To-Invoice; no move buttons there');
  A.w.remToInvoice(mvId); ok(rem(A).find(x => x.id === mvId).t === mv.t, 'v50: a To-Invoice name cannot be moved again');
  A.w.remUndo(); await sleep(60);
  mv = rem(A).find(x => x.id === mvId); mvDoc = server.cols.reminders.get(mvId);
  ok(mv.list === 'todo' && mv.t === mvT && mvDoc.list === 'todo' && mvDoc.t === mvT && rem(B).find(x => x.id === mvId).list === 'todo' && A.$('rem-undo').style.display === 'none', 'v50: Undo puts it back in To-Do with its old date, everywhere');
  // a moved name deleted on another device before Undo stays deleted
  A.w.remToInvoice(mvId); await sleep(60);
  B.w.remDelete(mvId); await sleep(60);
  A.w.remUndo(); await sleep(60);
  ok(!server.cols.reminders.has(mvId) && !rem(A).some(x => x.id === mvId), 'v50: Undo of a move never brings back a name deleted elsewhere');
  B.w.remShow('todo');
  // offline: the move waits on the device and is sent when the cloud list loads
  A.set('rem-input', 'Offline Move'); A.w.remAdd(); A.set('rem-input', 'Gone Meanwhile'); A.w.remAdd(); await sleep(60);
  const omId = rid(A, 'Offline Move'), gmId = rid(A, 'Gone Meanwhile');
  await sleep(40);   // S picks them up
  S.w.cloudStop(); S.w.eval('cloudUser = null'); S.w.remShow('todo');
  S.w.remToInvoice(omId); S.w.remToInvoice(gmId);
  S.set('rem-input', 'Typed Offline'); S.w.remAdd();
  const toId = rid(S, 'Typed Offline'); S.w.remToInvoice(toId);
  let sOut = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(sOut.upd[omId] && sOut.upd[omId].list === 'invoice' && sOut.upd[gmId] && !sOut.add[omId], 'v50: an offline move waits in upd');
  ok(sOut.add[toId] && sOut.add[toId].list === 'invoice' && !sOut.upd[toId], 'v50: a name typed offline and moved is simply added as To-Invoice');
  ok(server.cols.reminders.get(omId).list === 'todo', 'v50: nothing sent while offline');
  A.w.remDelete(gmId); await sleep(60);   // deleted on A while S is offline
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(100);
  ok(server.cols.reminders.get(omId).list === 'invoice' && rem(A).find(x => x.id === omId).list === 'invoice', 'v50: offline move sent on reconnect, A follows');
  ok(!server.cols.reminders.has(gmId) && !rem(S).some(x => x.id === gmId), 'v50: a name moved offline but deleted elsewhere stays deleted');
  ok(server.cols.reminders.get(toId) && server.cols.reminders.get(toId).list === 'invoice' && rem(B).find(x => x.id === toId).list === 'invoice', 'v50: the offline-typed name arrives in To-Invoice');
  sOut = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(Object.keys(sOut.upd).length === 0 && Object.keys(sOut.add).length === 0 && Object.keys(sOut.del).length === 0 && Object.keys(sOut.mov).length === 0, 'v50: nothing left waiting');
  // offline: delete then Undo waits as the whole name (upd), not a re-add
  S.w.cloudStop(); S.w.eval('cloudUser = null'); S.w.remShow('invoice');
  S.w.remDelete(omId); S.w.remUndo();
  sOut = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(!sOut.del[omId] && sOut.upd[omId] && sOut.upd[omId].list === 'invoice' && !sOut.add[omId], 'v50: offline delete + Undo waits as an update');
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(100);
  ok(server.cols.reminders.get(omId).list === 'invoice' && rem(S).some(x => x.id === omId), 'v50: and is still there after reconnecting');
  S.w.remShow('todo');
  [omId, toId].forEach(id => A.w.remDelete(id)); await sleep(60);

  // ---------- v59: To-Invoice name back to To-Do; the x on To-Invoice = done, filed in the Archived folder ----------
  const doc59 = id => server.cols.reminders.get(id);
  const archShown = win => Array.from(win.$('rem-arch-list').querySelectorAll('.rem-arch-item .rem-text')).map(el => el.textContent);
  const rowOf = (win, id) => win.$('rem-list').querySelector('.rem-item[data-id="' + id + '"]');
  const archRow = (win, id) => win.$('rem-arch-list').querySelector('.rem-arch-item[data-id="' + id + '"]');
  const kids = el => el ? Array.from(el.children).map(c => c.className).join() : '(none)';
  A.w.remShow('todo'); B.w.remShow('todo');
  A.set('rem-input', 'Zed Graphics'); A.w.remAdd(); await sleep(60);
  const zId = rid(A, 'Zed Graphics');
  A.w.remMove(zId, 2); await sleep(60);   // a place of its own (o) on To-Do
  const zAt = shown(B).indexOf('Zed Graphics'), z0 = Object.assign({}, rem(A).find(x => x.id === zId));
  ok(zAt === 2 && typeof z0.o === 'number', 'v59: a To-Do name with a place of its own (3rd)');
  await sleep(5);
  A.w.remToInvoice(zId); await sleep(60);
  let zd = doc59(zId);
  ok(zd.list === 'invoice' && zd.pt === z0.t && zd.po === z0.o && !('o' in zd) && zd.t > z0.t, 'v59: the move to To-Invoice remembers its To-Do date and place');
  B.w.remShow('invoice');
  const zRow = rowOf(B, zId);
  ok(kids(zRow) === 'rem-grip,rem-text,rem-date,rem-back,rem-del', 'v59: a To-Invoice name = grip, text, date, back to To-Do, x: ' + kids(zRow));
  ok(zRow.querySelector('.rem-back').title === 'Back to To-Do' && zRow.querySelector('.rem-del').title === 'Done - file it in Archived', 'v59: the buttons say what they do');
  zRow.querySelector('.rem-back').click(); await sleep(60);
  zd = doc59(zId);
  ok(zd.list === 'todo' && zd.t === z0.t && zd.o === z0.o && !('pt' in zd) && !('po' in zd), 'v59: back on To-Do with its old date and place, saved to the cloud');
  ok(shown(A).indexOf('Zed Graphics') === zAt && todo(B).indexOf('Zed Graphics') === zAt, 'v59: A and B show it back in its place');
  ok(B.$('rem-undo').style.display === 'flex' && B.$('rem-undo-msg').textContent === 'Moved Zed Graphics back to To-Do' && B.$('rem-box').getAttribute('data-view') === 'invoice', 'v59: Undo offered, the box stays on To-Invoice');
  B.w.remUndo(); await sleep(60);
  zd = doc59(zId);
  ok(zd.list === 'invoice' && zd.pt === z0.t && zd.po === z0.o, 'v59: Undo puts it back on To-Invoice (its To-Do place still remembered)');
  // a name typed straight into To-Invoice never had a To-Do place: back = top of To-Do
  B.set('rem-input', 'Direct Inv'); B.w.remAdd(); await sleep(60);
  const diId = rid(B, 'Direct Inv'), tDi = Date.now();
  await sleep(5);
  B.w.remToTodo(diId); await sleep(60);
  ok(doc59(diId).list === 'todo' && doc59(diId).t >= tDi && shown(A)[0] === 'Direct Inv', 'v59: a name typed into To-Invoice goes on top of To-Do');
  let w59 = server.writes;
  B.w.remToTodo(diId); B.w.remArchive(diId); B.w.remUnarchive(zId); await sleep(30);
  ok(server.writes === w59, 'v59: back / archive / unarchive do nothing to a name not in that list');
  // the x on a To-Invoice name files it in Archived
  const nInv59 = rem(A).filter(x => x.list === 'invoice').length;
  ok(A.$('rem-n-arch').textContent === '0' && !A.$('rem-arch').classList.contains('open') && A.$('rem-arch-list').innerHTML === '' && A.$('rem-arch-hint').textContent === 'tap to show' && A.$('rem-arch-head').getAttribute('aria-expanded') === 'false',
    'v59: Archived folder at the bottom, empty and closed');
  ok(A.$('rem-arch').closest('#rem-box') === A.$('rem-box') && !A.$('rem-arch').closest('#rem-list'), 'v59: the folder is in the box, under the list');
  const zt = doc59(zId).t;
  rowOf(B, zId).querySelector('.rem-del').click(); await sleep(60);
  zd = doc59(zId);
  ok(zd && zd.list === 'archived' && zd.a > 0 && zd.t === zt && zd.text === 'Zed Graphics' && zd.pt === z0.t, 'v59: the x archives it (kept in the cloud as archived, with the time)');
  ok(A.$('rem-n-invoice').textContent === String(nInv59 - 1) && A.$('rem-n-arch').textContent === '1' && B.$('rem-n-arch').textContent === '1', 'v59: To-Invoice count down one, Archived 1, on both devices');
  ok(!rowOf(A, zId) && !rowOf(B, zId) && !rem(A).some(x => x.id === zId && x.list !== 'archived'), 'v59: an archived name is in neither list');
  ok(B.$('rem-undo-msg').textContent === 'Archived Zed Graphics', 'v59: Undo offered after archiving');
  B.w.remUndo(); await sleep(60);
  ok(doc59(zId).list === 'invoice' && !('a' in doc59(zId)) && A.$('rem-n-arch').textContent === '0', 'v59: Undo takes it back out of Archived');
  B.w.remArchive(zId); await sleep(30);
  B.set('rem-input', 'Second <i>Inv</i>'); B.w.remAdd(); await sleep(60);
  const siId = rid(B, 'Second <i>Inv</i>');
  B.w.remArchive(siId); await sleep(60);
  // the folder: closed by default, opened per device, newest archived first, under both lists
  B.w.remArchToggle();
  ok(B.$('rem-arch').classList.contains('open') && B.$('rem-box').classList.contains('arch-open') && B.w.localStorage.getItem('coba-reminders-arch-open-v1') === '1' && B.$('rem-arch-hint').textContent === 'tap to hide' && B.$('rem-arch-head').getAttribute('aria-expanded') === 'true',
    'v59: tapping Archived opens it, remembered on this device');
  ok(archShown(B).join('|') === 'Second <i>Inv</i>|Zed Graphics' && !B.$('rem-arch-list').querySelector('.rem-text i'), 'v59: newest archived first, names shown as typed: ' + archShown(B).join(', '));
  const zArch = archRow(B, zId);
  ok(kids(zArch) === 'rem-text,rem-date rem-arch-date,rem-back,rem-del' &&zArch.querySelector('.rem-back').title === 'Back to To-Invoice' && zArch.querySelector('.rem-del').title === 'Delete for good',
    'v59: an archived name = text, date archived, back to To-Invoice, delete for good: ' + kids(zArch));
  ok(/^[A-Z][a-z]{2} \d{1,2}$/.test(zArch.querySelector('.rem-date').textContent) && /^Archived .+ \(on To-Invoice since [A-Z][a-z]{2} \d{1,2}\)$/.test(zArch.querySelector('.rem-date').title), 'v59: date archived shown, hover tells when: ' + zArch.querySelector('.rem-date').title);
  ok(!A.$('rem-arch').classList.contains('open') && A.$('rem-arch-list').innerHTML === '' && A.$('rem-n-arch').textContent === '2', 'v59: A keeps its folder closed (count 2)');
  B.w.remShow('todo');
  ok(archShown(B).length === 2 && B.$('rem-list').querySelectorAll('.rem-item').length === rem(B).filter(x => x.list === 'todo').length, 'v59: the folder shows under the To-Do list too');
  // back to To-Invoice from the folder, in the place it had
  archRow(B, zId).querySelector('.rem-back').click(); await sleep(60);
  zd = doc59(zId);
  ok(zd.list === 'invoice' && !('a' in zd) && zd.t === zt && zd.pt === z0.t && zd.po === z0.o, 'v59: back to To-Invoice from Archived with its date (its To-Do place still remembered)');
  ok(rem(A).find(x => x.id === zId).list === 'invoice' && archShown(B).join() === 'Second <i>Inv</i>' && B.$('rem-undo-msg').textContent === 'Moved Zed Graphics back to To-Invoice' && B.$('rem-box').getAttribute('data-view') === 'todo',
    'v59: A follows; Undo offered; the box keeps its list');
  // delete for good from the folder, with Undo
  archRow(B, siId).querySelector('.rem-del').click(); await sleep(60);
  ok(!server.cols.reminders.has(siId) && !rem(A).some(x => x.id === siId) && B.$('rem-n-arch').textContent === '0' && /^Deleted Second/.test(B.$('rem-undo-msg').textContent), 'v59: delete for good removes it everywhere, Undo offered');
  B.w.remUndo(); await sleep(60);
  ok(doc59(siId) && doc59(siId).list === 'archived' && doc59(siId).a > 0 && B.w.eval('remView') === 'todo' && archShown(B).join() === 'Second <i>Inv</i>', 'v59: Undo puts it back in Archived; the box stays on To-Do');
  // the x on a To-Do name still deletes
  B.set('rem-input', 'Todo Delete'); B.w.remAdd(); await sleep(60);
  const tdId = rid(B, 'Todo Delete');
  ok(rowOf(B, tdId).querySelector('.rem-del').title === 'Delete', 'v59: the To-Do x is still Delete');
  rowOf(B, tdId).querySelector('.rem-del').click(); await sleep(60);
  ok(!server.cols.reminders.has(tdId) && B.$('rem-n-arch').textContent === '1', 'v59: x on a To-Do name deletes it (not archived)');
  B.w.remUndoHide();
  // a job's To-Do name keeps the job ids through every move
  A.w.switchTabByName('paper');
  A.set('cb-name', 'Linked Cust'); A.set('cb-title', 'link job'); A.w.eval('jobsActive = null'); A.w.saveEstimate(); await sleep(80);
  const lkC = jd(A).customers.find(c => c.name === 'Linked Cust'), lkE = lkC.estimates[0];
  const lkId = rid(A, 'Linked Cust - link job');
  const hasIds = () => !!doc59(lkId) && doc59(lkId).job === lkE.id && doc59(lkId).cid === lkC.id;
  ok(hasIds() && doc59(lkId).list === 'todo' && /added to To-Do$/.test(A.$('jobs-toast').textContent), 'v59: a Paper job saved: its name is on To-Do with the job ids');
  A.w.remToInvoice(lkId); await sleep(40); const s1 = hasIds() && doc59(lkId).list === 'invoice';
  A.w.remArchive(lkId); await sleep(40); const s2 = hasIds() && doc59(lkId).list === 'archived';
  A.w.remUnarchive(lkId); await sleep(40); const s3 = hasIds() && doc59(lkId).list === 'invoice';
  A.w.remToTodo(lkId); await sleep(40); const s4 = hasIds() && doc59(lkId).list === 'todo';
  ok(s1 && s2 && s3 && s4, 'v59: the ids stay through To-Invoice, Archived and back (' + [s1, s2, s3, s4].join() + ')');
  A.w.remUndoHide(); A.w.switchTabByName('jobs');
  // a logged job dated earlier goes on To-Do with that date; one dated later is dated now (never above newer names)
  const d3 = new Date(); d3.setDate(d3.getDate() - 3); d3.setHours(0, 0, 0, 0);
  A.set('jl-cust', 'Backdated Co'); A.set('jl-title', 'phone job'); A.set('jl-date', A.w.jobsLocalDate(d3)); A.w.jobsLogManual(); await sleep(60);
  const bd = rem(A).find(x => x.text === 'Backdated Co - phone job');
  ok(bd && bd.t === d3.getTime() && doc59(bd.id).t === d3.getTime() && A.$('jobs-toast').textContent === 'Logged under Backdated Co - added to To-Do', 'v59: a logged job dated 3 days ago goes on To-Do dated that day');
  const d9 = new Date(); d9.setDate(d9.getDate() + 9);
  const tFut = Date.now();
  A.set('jl-cust', 'Future Co'); A.set('jl-title', 'booked job'); A.set('jl-date', A.w.jobsLocalDate(d9)); A.w.jobsLogManual(); await sleep(60);
  const fu = rem(A).find(x => x.text === 'Future Co - booked job');
  ok(fu && fu.t >= tFut && fu.t <= Date.now(), 'v59: a logged job dated later is dated now on To-Do');
  // offline: archiving and moving back wait on the device and are sent on reconnect
  await sleep(40);
  S.w.cloudStop(); S.w.eval('cloudUser = null'); S.w.remShow('invoice');
  S.w.remArchive(zId);                       // Zed is on To-Invoice
  S.w.remUnarchive(siId);                    // Second back from Archived...
  S.w.remToTodo(siId);                       // ...and on to To-Do (typed into To-Invoice: goes on top)
  S.set('rem-input', 'Offline Archived'); S.w.remAdd();
  const oaId = rid(S, 'Offline Archived'); S.w.remArchive(oaId);
  let so = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1'));
  ok(so.out.upd[zId] && so.out.upd[zId].list === 'archived' && so.out.upd[zId].a > 0 && so.out.upd[siId] && so.out.upd[siId].list === 'todo' && so.out.add[oaId] && so.out.add[oaId].list === 'archived' && !so.out.upd[oaId],
    'v59: offline archive and moves wait on the device');
  ok(so.items.some(x => x.id === zId && x.list === 'archived') && S.$('rem-n-arch').textContent === '2', 'v59: the device keeps its archived names');
  ok(doc59(zId).list === 'invoice' && !doc59(oaId), 'v59: nothing sent while offline');
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(100);
  ok(doc59(zId).list === 'archived' && doc59(siId).list === 'todo' && doc59(oaId) && doc59(oaId).list === 'archived' && A.$('rem-n-arch').textContent === '2', 'v59: sent on reconnect, A follows');
  so = JSON.parse(S.w.localStorage.getItem('coba-reminders-v1')).out;
  ok(Object.keys(so.upd).length === 0 && Object.keys(so.add).length === 0 && Object.keys(so.del).length === 0, 'v59: nothing left waiting');
  // an archived name moved back offline but deleted on another device meanwhile stays deleted
  S.w.cloudStop(); S.w.eval('cloudUser = null');
  S.w.remUnarchive(oaId);
  A.w.remDelete(oaId); await sleep(60);
  S.w.eval("cloudUser = { email:'chris@example.com' }; cloudStart();"); await sleep(100);
  ok(!doc59(oaId) && !rem(S).some(x => x.id === oaId), 'v59: unarchived offline but deleted elsewhere: stays deleted');
  S.w.remShow('todo');
  // a saved copy with archived names loads on a device that is not connected
  const V2 = openWin({ reminders: S.w.localStorage.getItem('coba-reminders-v1') }); await sleep(40);
  ok(V2.$('rem-n-arch').textContent === '1' && !V2.$('rem-arch').classList.contains('open') && V2.$('rem-n-invoice').textContent === S.$('rem-n-invoice').textContent, 'v59: a saved copy with archived names loads (folder closed on that device)');

  // ---------- v50: Paid jobs ----------
  const inMain = (win, eid) => Array.from(win.$('jobs-list').querySelectorAll('.jobs-est[data-eid="' + eid + '"]')).some(el => !el.closest('#jobs-paid'));
  const inPaid = (win, eid) => !!(win.$('jobs-paid') && win.$('jobs-paid').querySelector('.jobs-est.is-paid[data-eid="' + eid + '"]'));
  const mainNames = win => Array.from(win.$('jobs-list').querySelectorAll('.jobs-cust')).filter(el => !el.closest('#jobs-paid')).map(el => el.querySelector('.jobs-cust-name').textContent);
  A.w.switchTabByName('paper');
  A.set('cb-name', 'Paid Cust'); A.set('cb-title', 'first job'); A.w.eval('jobsActive = null'); A.w.saveEstimate(); await sleep(30);
  A.set('cb-title', 'second job'); A.w.eval('jobsActive = null'); A.w.saveEstimate(); await sleep(80);
  A.w.switchTabByName('jobs');
  const multi = jd(A).customers.find(c => c.name === 'Paid Cust');
  ok(!!multi && multi.estimates.length === 2 && multi.estimates.every(e => e.snap) && jd(B).customers.some(c => c.name === 'Paid Cust'), 'v50: a customer with two saved jobs to work with');
  const pc = multi.id, pe1 = multi.estimates.find(e => e.snap).id, pe2 = multi.estimates.find(e => e.id !== pe1).id;
  const pStatus = multi.estimates.find(e => e.id === pe1).status, nAll = jd(A).customers.reduce((t, c) => t + c.estimates.length, 0);
  A.w.renderJobs(); B.w.renderJobs();
  ok(!A.$('jobs-paid') && A.$('jobs-list').querySelectorAll('.jobs-mini.paid').length === nAll, 'v50: no Paid section yet; every job has a Paid button');
  A.$('jobs-list').querySelector('.jobs-est[data-eid="' + pe1 + '"] .jobs-mini.paid').click(); await sleep(80);
  const pDoc = JSON.parse(server.cols.estimates.get(pe1).json);
  ok(typeof pDoc.paid === 'string' && !isNaN(new Date(pDoc.paid)) && pDoc.status === pStatus && server.cols.estimates.get(pe1).status === pStatus, 'v50: Paid saved to the cloud with the time; status kept');
  ok(/Moved ".*" to Paid/.test(A.$('jobs-toast').textContent), 'v50: toast says where it went');
  B.w.renderJobs();
  ok(!inMain(B, pe1) && inPaid(B, pe1) && inMain(B, pe2), 'v50: on B the paid job left the list for Paid, the other job stayed');
  let ph = B.$('jobs-paid');
  ok(!ph.classList.contains('open') && ph.querySelector('.jobs-paid-n').textContent === '1' && /tap to show/.test(ph.querySelector('.jobs-paid-hint').textContent) && ph.querySelector('.jobs-paid-head').getAttribute('aria-expanded') === 'false', 'v50: Paid (1), closed by default');
  const prow = ph.querySelector('.jobs-est[data-eid="' + pe1 + '"]');
  ok(!prow.querySelector('select') && !prow.querySelector('.jobs-mini.paid') && Array.from(prow.querySelectorAll('.jobs-mini')).some(b => b.textContent === 'Not paid') && /Paid [A-Z][a-z]{2}\.? \d{1,2}, \d{4}/.test(prow.textContent),
    'v50: a paid row shows when it was paid and Not paid, no status or Paid button: ' + prow.querySelector('.jobs-est-meta').textContent);
  ok(/1 paid/.test(Array.from(B.$('jobs-list').querySelectorAll('.jobs-cust')).find(el => !el.closest('#jobs-paid') && el.querySelector('.jobs-cust-name').textContent === multi.name).querySelector('.jobs-cust-head').textContent), 'v50: the main card counts the paid one');
  B.w.jobsPaidToggle();
  ok(B.$('jobs-paid').classList.contains('open') && B.w.localStorage.getItem('coba-jobs-paid-open-v1') === '1' && /tap to hide/.test(B.$('jobs-paid').textContent), 'v50: tapping the header opens Paid, remembered on this device');
  A.w.renderJobs();
  ok(A.$('jobs-paid') && !A.$('jobs-paid').classList.contains('open'), 'v50: A keeps its own Paid closed');
  // the paid copy of a customer card opens on its own
  B.$('jobs-paid').querySelector('.jobs-cust-head').click(); B.w.renderJobs();
  ok(B.$('jobs-paid').querySelector('.jobs-cust').classList.contains('open') && B.w.eval("jobsOpen.has('p:" + pc + "')") && !B.w.eval("jobsOpen.has('" + pc + "')"), 'v50: opening the card in Paid does not open it in the list');
  // every job of a customer paid: the customer is only in Paid, newest paid first
  A.w.setEstPaid(pc, pe2, true); await sleep(80); B.w.renderJobs();
  ok(!mainNames(B).includes(multi.name) && inPaid(B, pe1) && inPaid(B, pe2) && B.$('jobs-paid').querySelector('.jobs-paid-n').textContent === '2', 'v50: a customer whose jobs are all paid is only in Paid');
  const pOrder = Array.from(B.$('jobs-paid').querySelectorAll('.jobs-est')).map(el => el.getAttribute('data-eid'));
  ok(pOrder[0] === pe2 && pOrder[1] === pe1, 'v50: newest paid first');
  // a search finds paid jobs and opens Paid while it lasts
  A.set('jobs-search', multi.name); A.w.renderJobs();
  ok(A.$('jobs-paid').classList.contains('open') && inPaid(A, pe1) && /matching jobs/.test(A.$('jobs-paid').textContent) && (/No open jobs match/.test(A.$('jobs-list').textContent) || mainNames(A).length > 0), 'v50: a search finds paid jobs and opens Paid');
  A.set('jobs-search', ''); A.w.renderJobs();
  ok(!A.$('jobs-paid').classList.contains('open'), 'v50: closed again after the search');
  // reopening and saving a paid job keeps it paid
  B.w.loadEstimate(pc, pe1, false); B.w.cobaConfirmAnswer(true); await sleep(20);
  B.w.saveEstimate(); await sleep(80);
  ok(typeof JSON.parse(server.cols.estimates.get(pe1).json).paid === 'string', 'v50: reopening and saving a paid job keeps it paid');
  // Not paid moves it back, everywhere
  B.w.switchTabByName('jobs'); B.w.renderJobs();
  Array.from(B.$('jobs-paid').querySelector('.jobs-est[data-eid="' + pe1 + '"]').querySelectorAll('.jobs-mini')).find(b => b.textContent === 'Not paid').click(); await sleep(80);
  A.w.renderJobs();
  ok(!('paid' in JSON.parse(server.cols.estimates.get(pe1).json)) && inMain(A, pe1) && !inPaid(A, pe1) && inPaid(A, pe2) && mainNames(A).includes(multi.name), 'v50: Not paid moves it back to the list everywhere');
  A.w.setEstPaid(pc, pe2, false); await sleep(80); A.w.renderJobs(); B.w.renderJobs();
  ok(!A.$('jobs-paid') && !B.$('jobs-paid') && inMain(B, pe2), 'v50: no Paid section when nothing is paid');

  // ---------- v43/v45: construction plans at Staples 1-hour rates (B&W at their standard-size level, v45); ----------
  // ---------- a plan job saved at the old rates keeps its quote ----------
  const P = openWin({ joined: true }); await connect(P, server);
  P.w.switchTabByName('epson');
  ok(P.$('e-plan-bw-rate').value === '1.15' && P.$('e-plan-col-rate').value === '4.25', 'plan rates default to $1.15 B&W and $4.25 colour a sq ft');
  P.$('e-plan-on').checked = true; P.w.eToggle('plan');
  const pr = P.w.eval('ePlanRows');
  P.set(pr[0] + '-w', 24); P.set(pr[0] + '-h', 36); P.w.ePlanCalcRow(pr[0]);
  P.$(pr[1] + '-bw').value = 'colour'; P.set(pr[1] + '-w', 24); P.set(pr[1] + '-h', 36); P.w.ePlanCalcRow(pr[1]);
  ok(P.$(pr[0] + '-r').value === '6.90' && P.$(pr[1] + '-r').value === '25.50', '24x36 plans: B&W $' + P.$(pr[0] + '-r').value + ', colour $' + P.$(pr[1] + '-r').value);
  const P2 = openWin({ joined: true }); await connect(P2, server);
  P2.w.switchTabByName('epson');
  P2.set('e-plan-bw-rate', '0.90'); P2.set('e-plan-col-rate', '3.50');   // an Epson job quoted before v43
  P2.$('e-plan-on').checked = true; P2.w.eToggle('plan');
  const pr2 = P2.w.eval('ePlanRows');
  P2.set(pr2[0] + '-w', 24); P2.set(pr2[0] + '-h', 36); P2.w.ePlanCalcRow(pr2[0]);
  const oldPlanQuote = P2.$('e-tt-quote').textContent;
  P2.set('cb-name', 'Plan Cust'); P2.set('cb-title', 'old plan job'); P2.w.saveEstimate(); await sleep(80);
  const planCust = jd(P).customers.find(c => c.name === 'Plan Cust');
  P.w.loadEstimate(planCust.id, planCust.estimates[0].id, false); P.w.cobaConfirmAnswer(true);
  ok(P2.$(pr2[0] + '-r').value === '5.40' && P.$('e-tt-quote').textContent === oldPlanQuote && P.$('e-plan-bw-rate').value === '0.90', 'a plan job saved at $0.90 reopens at its quote (' + oldPlanQuote + ')');

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

  // ---------- v51: Cougar Digital Color Copy 130# cover 12x18 (COUDCCDIC1081312FSC, $482.53 / 1000) and 13x19 (COUDCCDIC123513FSC, $551.12 / 1000) ----------
  const isCou = sz => p => /cougar/i.test(p.brand || '') && +p.weight === 130 && p.size === sz;
  const fp51 = F.w.eval('inventory.papers'), fa51 = F.w.eval('inventory.added');
  const f12 = fp51.filter(isCou('12x18')), f13 = fp51.filter(isCou('13x19'));
  ok(f12.length === 1 && f12[0].cost === 0.48253 && f12[0].unit === '#' && f12[0].brand === 'Cougar Digital Color Copy Cover' && f13.length === 1 && f13[0].cost === 0.55112 &&
    fa51.indexOf('cougar-130c-12x18-v51') >= 0 && fa51.indexOf('cougar-130c-13x19-v51') >= 0, 'v51 fresh inventory: Cougar 130# cover 12x18 at $482.53 and 13x19 at $551.12 / 1000, once each');
  // an inventory saved by v50: no Cougar 130#, no v51 tags; its Cougar 100# text stays as it is
  const v50 = JSON.parse(F.w.eval('JSON.stringify(inventory)'));
  v50.added = v50.added.filter(t => !/-v51$/.test(t));
  v50.papers = v50.papers.filter(p => !isCou('12x18')(p) && !isCou('13x19')(p));
  const nCou = v50.papers.filter(p => /cougar/i.test(p.brand || '')).length;
  const U5 = openWin({ inventory: JSON.stringify(v50) }); await sleep(40);
  const up5 = U5.w.eval('inventory.papers');
  ok(up5.filter(isCou('12x18')).length === 1 && up5.filter(isCou('13x19')).length === 1 && up5.filter(p => /cougar/i.test(p.brand || '')).length === nCou + 2 &&
    up5.some(p => p.brand === 'Cougar Text' && +p.weight === 100), 'v51: a v50 inventory gets both sizes once (neither blocks the other; the 100# text untouched)');
  const u5opts = Array.from(U5.$('pp-s0').options);
  const c12 = u5opts.find(o => o.textContent === '130# Cougar Digital Color Copy Cover 12x18'), c13 = u5opts.find(o => o.textContent === '130# Cougar Digital Color Copy Cover 13x19');
  ok(!!c12 && !!c13, 'v51: both in the Paper tab dropdowns');
  U5.$('pp-s0').value = c12.value; U5.w.pSetPaper(0); U5.$('pp-n0').value = '1000';
  U5.$('pp-s1').value = c13.value; U5.w.pSetPaper(1); U5.$('pp-n1').value = '1000'; U5.w.pCalc();
  ok(U5.$('pp-c0').value === '0.483' && /483\.00/.test(U5.$('pp-rc0').textContent) && /1,?449\.00/.test(U5.$('pp-rr0').textContent),
    'v51: 12x18, 1000 sheets: $' + U5.$('pp-c0').value + ' a sheet, cost ' + U5.$('pp-rc0').textContent + ', retail ' + U5.$('pp-rr0').textContent + ' (x3)');
  ok(U5.$('pp-c1').value === '0.551' && /551\.00/.test(U5.$('pp-rc1').textContent) && /1,?653\.00/.test(U5.$('pp-rr1').textContent),
    'v51: 13x19, 1000 sheets: $' + U5.$('pp-c1').value + ' a sheet, cost ' + U5.$('pp-rc1').textContent + ', retail ' + U5.$('pp-rr1').textContent + ' (x3)');
  // one removed in Inventory stays removed; the other stays
  const inv51 = JSON.parse(U5.w.localStorage.getItem('coba-inventory-v2'));
  inv51.papers = inv51.papers.filter(p => !isCou('12x18')(p));
  const U6 = openWin({ inventory: JSON.stringify(inv51) }); await sleep(40);
  ok(U6.w.eval('inventory.papers').filter(isCou('12x18')).length === 0 && U6.w.eval('inventory.papers').filter(isCou('13x19')).length === 1, 'v51: a removed Cougar 130# stays removed');

  // ---------- v55: Hammermill Premium Color Copy 28# 12x18 (COLCDDIPHO3234FSC, $101.53 / 1000) ----------
  const isHam = p => /hammermill/i.test(p.brand || '') && +p.weight === 28 && p.size === '12x18';
  const fp55 = F.w.eval('inventory.papers'), fa55 = F.w.eval('inventory.added'), fh = fp55.filter(isHam);
  ok(fh.length === 1 && fh[0].cost === 0.10153 && fh[0].unit === '#' && fh[0].brand === 'Hammermill Premium Color Copy' && (fh[0].unsure || []).length === 0 &&
    fa55.indexOf('hammermill-pcc28-12x18-v55') >= 0, 'v55 fresh inventory: Hammermill Premium Color Copy 28# 12x18 at $101.53 / 1000, once');
  // an inventory saved by v54: no Hammermill 28#, no v55 tag; its Hammermill 32# and covers stay as they are
  const v54 = JSON.parse(F.w.eval('JSON.stringify(inventory)'));
  v54.added = v54.added.filter(t => !/-v55$/.test(t));
  v54.papers = v54.papers.filter(p => !isHam(p));
  const nHam = v54.papers.filter(p => /hammermill/i.test(p.brand || '')).length;
  const H1 = openWin({ inventory: JSON.stringify(v54) }); await sleep(40);
  const hp1 = H1.w.eval('inventory.papers');
  ok(hp1.filter(isHam).length === 1 && hp1.filter(p => /hammermill/i.test(p.brand || '')).length === nHam + 1 &&
    hp1.some(p => p.brand === 'Hammermill' && +p.weight === 32), 'v55: a v54 inventory gets it once (the Hammermill 32# untouched)');
  const hOpt = Array.from(H1.$('pp-s0').options).find(o => o.textContent === '28# Hammermill Premium Color Copy 12x18');
  ok(!!hOpt, 'v55: in the Paper tab dropdowns');
  H1.$('pp-s0').value = hOpt.value; H1.w.pSetPaper(0); H1.$('pp-n0').value = '1000'; H1.w.pCalc();
  ok(H1.$('pp-c0').value === '0.102' && /102\.00/.test(H1.$('pp-rc0').textContent) && /306\.00/.test(H1.$('pp-rr0').textContent),
    'v55: 1000 sheets: $' + H1.$('pp-c0').value + ' a sheet, cost ' + H1.$('pp-rc0').textContent + ', retail ' + H1.$('pp-rr0').textContent + ' (x3)');
  // removed in Inventory stays removed
  const inv55 = JSON.parse(H1.w.localStorage.getItem('coba-inventory-v2'));
  inv55.papers = inv55.papers.filter(p => !isHam(p));
  const H2 = openWin({ inventory: JSON.stringify(inv55) }); await sleep(40);
  ok(H2.w.eval('inventory.papers').filter(isHam).length === 0, 'v55: a removed Hammermill 28# stays removed');

  // ---------- no page errors anywhere ----------
  [A, B, C, D, E, F, G, H, I, J, K, L, M, N, O, Q, R, S, P, P2, V, V2, U5, U6, H1, H2].forEach((x, i) => ok(x.errs.length === 0, 'window ' + ['A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','Q','R','S','P','P2','V','V2','U5','U6','H1','H2'][i] + ' page errors: ' + x.errs.slice(0, 3).join(' | ')));

  console.log(pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('FAIL: test crashed: ' + (e && e.stack || e)); process.exit(1); });
