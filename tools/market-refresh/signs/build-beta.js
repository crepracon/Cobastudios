#!/usr/bin/env node
// Builds beta/signs/index.html from beta-template.html + a signs market data file + the estimator's default
// materials (copied from index.html so the beta works on a device with no saved inventory).
//   node tools/market-refresh/signs/build-beta.js [--data tools/market-refresh/signs/data/signs-market-<date>.json]
// Plain ASCII only.
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..', '..');
const args = process.argv.slice(2);
const i = args.indexOf('--data');
const dataDir = path.join(__dirname, 'data');
const dataFile = i >= 0 ? args[i + 1] : path.join(dataDir, fs.readdirSync(dataDir).filter(f => /^signs-market-.*\.json$/.test(f)).sort().pop());
const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
// one seller per line, so a refresh shows up as a readable diff
const head = Object.assign({}, data); delete head.sellers; delete head.addons;
const lines = [JSON.stringify(head).slice(0, -1) + ',"addons":' + JSON.stringify(data.addons || {}) + ',"sellers":['];
data.sellers.forEach((s, k) => lines.push(JSON.stringify(s) + (k < data.sellers.length - 1 ? ',' : '')));
lines.push(']}');
const block = lines.join('\n');
JSON.parse(block);
const est = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const grab = name => { const a = est.indexOf('const ' + name + ' = ['); if (a < 0) throw new Error(name + ' not found in index.html'); const b = est.indexOf('];', a); return est.slice(est.indexOf('[', a), b + 1); };
let html = fs.readFileSync(path.join(__dirname, 'beta-template.html'), 'utf8');
html = html.replace('__SIGNS_DATA__', () => block).replace('__DEFAULT_VINYL__', () => grab('DEFAULT_VINYL')).replace('__DEFAULT_SUBSTRATES__', () => grab('DEFAULT_SUBSTRATES'));
// every script must be plain ASCII (CLAUDE.md landmines)
const re = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g; let m;
while ((m = re.exec(html))) { if (/[^\x00-\x7F]/.test(m[2])) throw new Error('non-ASCII inside a script block'); if (m[2].indexOf('\\' + 'u') >= 0 && !/application\/json/.test(m[1] || '')) throw new Error('backslash-u escape inside a script'); }
const out = path.join(ROOT, 'beta', 'signs', 'index.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log('wrote ' + path.relative(ROOT, out) + ' from ' + path.relative(ROOT, dataFile) + ' (' + data.sellers.length + ' sellers)');
