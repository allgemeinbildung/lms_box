#!/usr/bin/env node
// Uploads the teacher material of the nine E-B units to Firestore database "lmsbox", collection
// "teacherMaterials" (see backend/CONTRACT.md, «Teacher materials»).
//   doc id  = encodeURIComponent(einheitId)   (einheitId = lehrperson-karten.json "einheit", must equal hpTeacher.json "einheit")
//   fields  = einheitId, assignmentId, generiertAm, lehrpersonKarten, hpTeacher (both files unchanged), uploadedAt (server time)
//             -- written as a whole with set(), never update().
//
// Modes (exactly one; --dry-run is the default):
//   --dry-run                                  validate and print id, size and assignmentId per unit; needs no node_modules
//   --emulator                                 needs FIRESTORE_EMULATOR_HOST; demo project, no credentials
//   --live --key <service-account.json> --yes  real project interactive-media-2a1fc, database lmsbox
// Other: --nur <k>    only one unit, e.g. --nur 5.1.1
//        --dir <dir>  (default: ../../../weiterentwicklung-paket/varianten/E-B/obsidian relative to this file)
//
// Needs firebase-admin (only for --emulator / --live), imported dynamically.
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIVE_PROJECT = 'interactive-media-2a1fc';
const DATABASE = 'lmsbox';
const COLLECTION = 'teacherMaterials';
const MAX_DOC_BYTES = 900000;   // contract: refuse a document over 900 000 bytes (Firestore limit 1 MiB)
const UNITS = ['5.1.1', '5.1.2', '5.2.1', '5.2.2', '5.3.1', '5.3.2', '5.3.3', '5.4.1', '5.4.2'];

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error('ERROR: ' + msg); process.exit(2); };

const live = has('--live'), emulator = has('--emulator');
const dry = has('--dry-run') || (!live && !emulator);
if ([dry && has('--dry-run'), live, emulator].filter(Boolean).length > 1) die('use only one of --dry-run, --emulator, --live');
const dataDir = val('--dir') ? resolve(val('--dir')) : resolve(here, '..', '..', '..', 'weiterentwicklung-paket', 'varianten', 'E-B', 'obsidian');
const nur = val('--nur');
if (has('--nur') && !UNITS.includes(nur)) die(`--nur ${nur}: unknown unit, expected one of ${UNITS.join(' ')}`);
const units = nur ? [nur] : UNITS;

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

// --- collect and validate (only the two named files per unit; never «.vor-» copies or conflict copies)
const docs = [];      // {unit, id, assignmentId, data, bytes}
const problems = [];
const readJson = (unit, name) => {
  try {
    const v = JSON.parse(readFileSync(join(dataDir, unit, name), 'utf8'));
    if (v === null || typeof v !== 'object' || Array.isArray(v)) { problems.push(`${unit}/${name}: top level is not an object`); return null; }
    return v;
  } catch (e) { problems.push(`${unit}/${name}: ${e.message}`); return null; }
};
for (const unit of units) {
  const karten = readJson(unit, 'lehrperson-karten.json');
  const teacher = readJson(unit, 'hpTeacher.json');
  if (!karten || !teacher) continue;
  const einheitId = karten.einheit;
  if (typeof einheitId !== 'string' || !einheitId) { problems.push(`${unit}: lehrperson-karten.json has no "einheit"`); continue; }
  if (teacher.einheit !== einheitId) { problems.push(`${unit}: "einheit" differs: lehrperson-karten.json ${JSON.stringify(einheitId)} vs hpTeacher.json ${JSON.stringify(teacher.einheit)}`); continue; }
  if (typeof teacher.assignmentId !== 'string' || !teacher.assignmentId) problems.push(`${unit}: hpTeacher.json has no "assignmentId"`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(teacher.generiert_am ?? '')) problems.push(`${unit}: hpTeacher.json "generiert_am" is not YYYY-MM-DD`);
  const id = encodeURIComponent(einheitId);
  if (id === '.' || id === '..' || /^__.*__$/.test(id)) problems.push(`${unit}: document id ${JSON.stringify(id)} is not allowed`);
  if (docs.some((d) => d.id === id)) problems.push(`${unit}: document id ${id} occurs twice`);
  const data = { einheitId, assignmentId: teacher.assignmentId, generiertAm: teacher.generiert_am, lehrpersonKarten: karten, hpTeacher: teacher };
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8') + 64;   // + uploadedAt and field name
  if (bytes > MAX_DOC_BYTES) problems.push(`${unit}: document ~${bytes} bytes exceeds ${MAX_DOC_BYTES} bytes`);
  docs.push({ unit, id, assignmentId: teacher.assignmentId, data, bytes });
}

const target = live ? `LIVE project ${LIVE_PROJECT}, database ${DATABASE}`
  : emulator ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}, demo project demo-lmsbox, database ${DATABASE}`
  : `DRY RUN (nothing is written), target would be ${DATABASE}/${COLLECTION}`;
console.log(`mode: ${target}`);
console.log(`data: ${dataDir}`);
for (const d of docs) console.log(`  ${d.id}  ${d.bytes} bytes  assignmentId ${JSON.stringify(d.assignmentId)}`);
if (problems.length) { console.log(`problems: ${problems.length}`); problems.forEach((p) => console.log('  ! ' + p)); }

if (dry) {
  console.log(`\nDRY RUN: ${docs.length} document(s) would be written to ${DATABASE}/${COLLECTION}, ${problems.length} problem(s).`);
  process.exit(problems.length ? 1 : 0);
}

if (problems.length) die('fix the problems above before writing');

if (live) {
  console.log(`\nAbout to WRITE ${docs.length} documents to project ${LIVE_PROJECT}, database ${DATABASE}, collection ${COLLECTION}.`);
  if (!has('--yes')) die('refusing to touch the real project without the literal flag --yes');
}

// --- write (firebase-admin imported only here)
let initializeApp, cert, getFirestore, FieldValue;
try {
  ({ initializeApp, cert } = await import('firebase-admin/app'));
  ({ getFirestore, FieldValue } = await import('firebase-admin/firestore'));
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

const batch = db.batch();   // at most nine writes
for (const d of docs) batch.set(db.collection(COLLECTION).doc(d.id), { ...d.data, uploadedAt: FieldValue.serverTimestamp() });   // whole document, no merge
await batch.commit();
console.log(`done: ${docs.length} document(s) written to ${DATABASE}/${COLLECTION}`);
