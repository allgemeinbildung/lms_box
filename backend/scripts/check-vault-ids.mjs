#!/usr/bin/env node
// Checks that every lms_box iframe in vault/ points to an assignmentId/subId that exists in content/.
// Read-only. Node built-ins only.  Usage: node check-vault-ids.mjs [--content <dir>] [--vault <dir>]
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');           // obs-allgemeinbildung
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? resolve(args[i + 1]) : d; };
const contentDir = opt('--content', join(root, 'content'));
const vaultDir = opt('--vault', join(root, 'vault'));

const isConflict = (name) => /-LYOBBW291\.json$/.test(name) || / - Kopie\.json$/.test(name);
const nfc = (s) => s.normalize('NFC');
const dashFold = (s) => nfc(s).replace(/[‐-―−﹘﹣－]/g, '-');

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.isFile() && e.name.toLowerCase().endsWith('.md')) out.push(p);
  }
  return out;
}

function lev(a, b) {
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++)
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
function closest(s, candidates) {
  let best = null, bd = Infinity;
  for (const c of candidates) {
    const d = lev(dashFold(s).toLowerCase(), dashFold(c).toLowerCase());
    if (d < bd) { bd = d; best = c; }
  }
  return best === null ? '(none)' : `${JSON.stringify(best)} (distance ${bd})`;
}
function decode(v) {
  let s = v.replace(/&amp;/g, '&');
  if (/%[0-9A-Fa-f]{2}/.test(s)) { try { s = decodeURIComponent(s); } catch { /* keep raw */ } }
  return s.trim();
}

// --- content
const content = new Map();   // assignmentId -> Set(subIds)
const skipped = [];
const badJson = [];
for (const f of readdirSync(contentDir).filter((n) => n.endsWith('.json')).sort()) {
  if (isConflict(f)) { skipped.push(f); continue; }
  try {
    const d = JSON.parse(readFileSync(join(contentDir, f), 'utf8'));
    content.set(f.slice(0, -5), new Set(Object.keys(d.subAssignments ?? {})));
  } catch (e) { badJson.push(`${f}: ${e.message}`); }
}
const aKeys = [...content.keys()];

// --- vault
const re = /lms_box\/index\.html\?([^"'<>\\\r\n]*)/g;
const refs = [];            // {file, line, a, s, extra}
for (const file of walk(vaultDir)) {
  const text = readFileSync(file, 'utf8');
  let m;
  while ((m = re.exec(text))) {
    const line = text.slice(0, m.index).split('\n').length;
    const params = {}; const extra = [];
    for (const part of m[1].split(/&(?!amp;)/)) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const k = part.slice(0, eq).trim(), v = decode(part.slice(eq + 1));
      if (k === 'assignmentId' || k === 'subId') params[k] = v; else extra.push(k);
    }
    refs.push({ file: relative(vaultDir, file), line, a: params.assignmentId, s: params.subId, extra });
  }
}

const pairs = new Set(refs.map((r) => `${r.a}\u0000${r.s}`));
const kinds = {
  'assignment missing': [], 'subId missing': [], 'param missing in iframe': [],
  'assignment differs only by dash look-alike': [], 'subId differs only by dash look-alike': [],
};
const normOnly = [];
const usedA = new Set(), usedS = new Map();
const mark = (a, s) => {
  usedA.add(a);
  if (!usedS.has(a)) usedS.set(a, new Set());
  if (s !== undefined) usedS.get(a).add(s);
};

for (const r of refs) {
  const loc = `${r.file}:${r.line}`;
  if (r.a === undefined || r.s === undefined) {
    kinds['param missing in iframe'].push(`${loc}  assignmentId=${JSON.stringify(r.a)} subId=${JSON.stringify(r.s)}`);
    continue;
  }
  let aKey = aKeys.find((k) => k === r.a);
  if (!aKey) {
    const viaNfc = aKeys.find((k) => nfc(k) === nfc(r.a));
    if (viaNfc) { aKey = viaNfc; normOnly.push(`${loc}  assignmentId ${JSON.stringify(r.a)} == ${JSON.stringify(viaNfc)} only after NFC`); }
    else {
      const viaDash = aKeys.find((k) => dashFold(k) === dashFold(r.a));
      if (viaDash) kinds['assignment differs only by dash look-alike'].push(`${loc}  ${JSON.stringify(r.a)} vs content ${JSON.stringify(viaDash)}`);
      else kinds['assignment missing'].push(`${loc}  ${JSON.stringify(r.a)}  closest: ${closest(r.a, aKeys)}`);
      continue;
    }
  }
  mark(aKey);
  const subs = [...content.get(aKey)];
  let sKey = subs.find((k) => k === r.s);
  if (!sKey) {
    const viaNfc = subs.find((k) => nfc(k) === nfc(r.s));
    if (viaNfc) { sKey = viaNfc; normOnly.push(`${loc}  subId ${JSON.stringify(r.s)} == ${JSON.stringify(viaNfc)} only after NFC`); }
    else {
      const viaDash = subs.find((k) => dashFold(k) === dashFold(r.s));
      if (viaDash) kinds['subId differs only by dash look-alike'].push(`${loc}  [${aKey}] ${JSON.stringify(r.s)} vs content ${JSON.stringify(viaDash)}`);
      else kinds['subId missing'].push(`${loc}  [${aKey}] ${JSON.stringify(r.s)}  closest: ${closest(r.s, subs)}`);
      continue;
    }
  }
  mark(aKey, sKey);
}

const out = [];
const P = (s = '') => out.push(s);
P(`content dir: ${contentDir}`);
P(`vault dir:   ${vaultDir}`);
P(`content files used: ${content.size}; skipped conflict copies: ${skipped.length}${skipped.length ? ' -> ' + skipped.join(' | ') : ''}`);
if (badJson.length) { P('UNPARSEABLE content files:'); badJson.forEach((l) => P('  ' + l)); }
P(`lms_box iframes found: ${refs.length}`);
P(`distinct (assignmentId, subId) pairs: ${pairs.size}`);
const withExtra = refs.filter((r) => r.extra.length);
if (withExtra.length) P(`iframes with extra parameters: ${withExtra.length} (${[...new Set(withExtra.flatMap((r) => r.extra))].join(', ')})`);
let missing = badJson.length;
for (const [k, list] of Object.entries(kinds)) {
  if (!list.length) continue;
  missing += list.length;
  P(); P(`== ${k}: ${list.length} iframe(s), ${new Set(list.map((l) => l.replace(/^[^ ]+  /, ''))).size} distinct`);
  list.forEach((l) => P('  ' + l));
}
if (normOnly.length) { P(); P(`== equal only after NFC (treated as match, reported): ${normOnly.length}`); normOnly.forEach((l) => P('  ' + l)); }
P();
const unusedFiles = aKeys.filter((a) => !usedA.has(a));
P(`== content files no iframe uses: ${unusedFiles.length}`);
unusedFiles.forEach((a) => P('  ' + a + '.json'));
const unusedSubs = [];
for (const [a, subs] of content) if (usedA.has(a)) for (const s of subs) if (!usedS.get(a)?.has(s)) unusedSubs.push(`${a}  ::  ${s}`);
P(); P(`== subIds in used content files that no iframe uses: ${unusedSubs.length}`);
unusedSubs.forEach((l) => P('  ' + l));
P(); P(missing ? `RESULT: ${missing} problem(s)` : 'RESULT: ok');
console.log(out.join('\n'));
process.exit(missing ? 1 : 0);
