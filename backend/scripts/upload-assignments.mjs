#!/usr/bin/env node
// Uploads content/*.json to Firestore database "lmsbox", collection "assignments" (see backend/CONTRACT.md).
//   doc id  = encodeURIComponent(assignmentId)   (assignmentId = file name without .json)
//   fields  = the content JSON unchanged + assignmentId   -- written as a whole with set(), never update().
//
// Modes (exactly one; --dry-run is the default):
//   --dry-run                                  validate and print what would be written; needs no node_modules
//   --emulator                                 needs FIRESTORE_EMULATOR_HOST; demo project, no credentials
//   --live --key <service-account.json> --yes  real project interactive-media-2a1fc, database lmsbox
// Other: --content <dir>  (default: ../../../content relative to this file)
//
// Needs firebase-admin (only for --emulator / --live), imported dynamically.
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_PROJECT = 'interactive-media-2a1fc';
const DATABASE = 'lmsbox';
const COLLECTION = 'assignments';
const MAX_DOC_BYTES = 1048576 - 4096;   // Firestore limit is 1 MiB; JSON bytes only approximate Firestore's own size, keep a margin

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error('ERROR: ' + msg); process.exit(2); };

const live = has('--live'), emulator = has('--emulator');
const dry = has('--dry-run') || (!live && !emulator);
if ([dry && has('--dry-run'), live, emulator].filter(Boolean).length > 1) die('use only one of --dry-run, --emulator, --live');
const contentDir = val('--content') ? resolve(val('--content')) : resolve(here, '..', '..', '..', 'content');

if (emulator && !process.env.FIRESTORE_EMULATOR_HOST) die('--emulator requires FIRESTORE_EMULATOR_HOST (e.g. 127.0.0.1:8080) to be set');
if (live) {
  if (process.env.FIRESTORE_EMULATOR_HOST) die('FIRESTORE_EMULATOR_HOST is set; unset it for --live so nothing is routed to an emulator by accident');
  if (!val('--key')) die('--live requires --key <path-to-service-account.json>');
  // A service-account key must never sit inside the repository (it is public). Compare real
  // paths, so a symlink or junction pointing into the repo does not get around the check.
  let keyReal, repoReal;
  try { keyReal = realpathSync(resolve(val('--key'))); } catch (e) { die(`cannot read --key ${val('--key')}: ${e.message}`); }
  repoReal = realpathSync(resolve(here, '..', '..'));
  const rel = relative(repoReal, keyReal);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    die(`--key ${val('--key')} lies inside the repository (${repoReal}). Keep the service-account key outside the repo and pass its path from there.`);
}

const isConflict = (name) => /-LYOBBW291\.json$/.test(name) || / - Kopie\.json$/.test(name);

// --- collect and validate
const docs = [];      // {file, id, data, bytes}
const skipped = [];
const problems = [];
const ids = new Map();
for (const f of readdirSync(contentDir).filter((n) => n.endsWith('.json')).sort()) {
  if (isConflict(f)) { skipped.push(f); continue; }
  const assignmentId = f.slice(0, -5);
  const id = encodeURIComponent(assignmentId);
  let content;
  try { content = JSON.parse(readFileSync(join(contentDir, f), 'utf8')); }
  catch (e) { problems.push(`${f}: invalid JSON (${e.message})`); continue; }
  if (content === null || typeof content !== 'object' || Array.isArray(content)) { problems.push(`${f}: top level is not an object`); continue; }
  if (id === '.' || id === '..') problems.push(`${f}: document id ${JSON.stringify(id)} is not allowed`);
  if (id.includes('/') || assignmentId.includes('/')) problems.push(`${f}: document id contains "/"`);
  if (/^__.*__$/.test(id)) problems.push(`${f}: document id matches reserved pattern __.*__`);
  if (id === '' ) problems.push(`${f}: empty document id`);
  if (Buffer.byteLength(id, 'utf8') > 1500) problems.push(`${f}: document id longer than 1500 bytes`);
  if (ids.has(id)) problems.push(`${f}: document id collides with ${ids.get(id)}`);
  ids.set(id, f);
  if ('assignmentId' in content && content.assignmentId !== assignmentId)
    problems.push(`${f}: content already has assignmentId ${JSON.stringify(content.assignmentId)} (will be overwritten with ${JSON.stringify(assignmentId)})`);
  const data = { ...content, assignmentId };
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > MAX_DOC_BYTES) problems.push(`${f}: document ~${bytes} bytes exceeds the Firestore limit`);
  docs.push({ file: f, id, assignmentId, data, bytes });
}

const target = live ? `LIVE project ${LIVE_PROJECT}, database ${DATABASE}`
  : emulator ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}, demo project demo-lmsbox, database ${DATABASE}`
  : `DRY RUN (nothing is written), target would be ${DATABASE}/${COLLECTION}`;
console.log(`mode:    ${target}`);
console.log(`content: ${contentDir}`);
console.log(`valid files: ${docs.length}; skipped conflict copies: ${skipped.length}`);
skipped.forEach((s) => console.log('  skipped: ' + s));
if (problems.length) { console.log(`problems: ${problems.length}`); problems.forEach((p) => console.log('  ! ' + p)); }
const largest = docs.reduce((a, b) => (b.bytes > (a?.bytes ?? -1) ? b : a), null);
if (largest) console.log(`largest document: ${largest.bytes} bytes (${(largest.bytes / 1024).toFixed(1)} KiB) -- ${largest.file}`);

if (dry) {
  for (const d of docs) console.log(`  would set ${DATABASE}/${COLLECTION}/${d.id}  (${d.bytes} bytes, ${Object.keys(d.data.subAssignments ?? {}).length} subAssignments)  <- ${d.file}`);
  console.log(`\nDRY RUN: ${docs.length} document(s) would be written, ${skipped.length} skipped, ${problems.length} problem(s).`);
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) die('fix the problems above before writing');

if (live) {
  console.log(`\nAbout to WRITE ${docs.length} documents to project ${LIVE_PROJECT}, database ${DATABASE}, collection ${COLLECTION}.`);
  if (!has('--yes')) die('refusing to touch the real project without the literal flag --yes');
}

// --- write (firebase-admin imported only here)
let initializeApp, cert, getFirestore;
try {
  ({ initializeApp, cert } = await import('firebase-admin/app'));
  ({ getFirestore } = await import('firebase-admin/firestore'));
} catch (e) {
  die(`firebase-admin is not installed (npm install firebase-admin in backend/): ${e.message}`);
}
let app;
if (live) {
  const key = JSON.parse(readFileSync(resolve(val('--key')), 'utf8'));
  if (key.project_id !== LIVE_PROJECT) die(`service account belongs to project ${JSON.stringify(key.project_id)}, expected ${LIVE_PROJECT}`);
  app = initializeApp({ credential: cert(key), projectId: LIVE_PROJECT });
} else {
  app = initializeApp({ projectId: 'demo-lmsbox' });
}
const db = getFirestore(app, DATABASE);

let done = 0;
for (let i = 0; i < docs.length; i += 400) {
  const batch = db.batch();
  for (const d of docs.slice(i, i + 400)) batch.set(db.collection(COLLECTION).doc(d.id), d.data);   // whole document, no merge
  await batch.commit();
  done += Math.min(400, docs.length - i);
  console.log(`committed ${done}/${docs.length}`);
}
console.log(`done: ${done} document(s) written to ${DATABASE}/${COLLECTION}`);
