// Emulator-Test fuer scripts/hko-upload.mjs --emulator (HKO-P1-PLAN.md §4): schreibt die Fixture
// test/fixtures/hko-build in die DB `hko`, ein zweiter Lauf ist idempotent.
// Run (aus backend/):
//   node scripts/emu.mjs emulators:exec --config firebase.hko-test.json --project demo-hko --only firestore "node --test test/hko-upload.emu.test.mjs"
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { COLLECTIONS, loadAndValidate, stableJson } from '../scripts/lib/hko-validate.mjs';
import { DATABASE_ID } from '../scripts/lib/hko-target.mjs';

if (process.env.FIRESTORE_EMULATOR_HOST !== '127.0.0.1:8320') {
  console.error(`Erwartet den hko-Test-Emulator auf 127.0.0.1:8320 (firebase.hko-test.json), FIRESTORE_EMULATOR_HOST=${process.env.FIRESTORE_EMULATOR_HOST ?? '(leer)'}.`);
  process.exit(1);
}
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-hko';
if (!PROJECT.startsWith('demo-')) { console.error(`Projekt ${PROJECT} ist kein demo-Projekt`); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '..');
const script = join(backend, 'scripts', 'hko-upload.mjs');
const fixture = join(here, 'fixtures', 'hko-build');

const app = initializeApp({ projectId: PROJECT }, 'hko-upload-emu-test');
const db = getFirestore(app, DATABASE_ID);
after(() => deleteApp(app));

function upload() {
  const r = spawnSync(process.execPath, [script, '--emulator', '--build', fixture], {
    cwd: backend, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, GCLOUD_PROJECT: PROJECT },
  });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  assert.equal(r.status, 0, out);
  return out;
}

async function snapshot() {
  const out = {};
  for (const coll of COLLECTIONS) {
    const snap = await db.collection(coll).get();
    for (const d of snap.docs) out[`${coll}/${d.id}`] = d.data();
  }
  return out;
}

test('--emulator schreibt die Fixture, zweiter Lauf ist idempotent', { skip: !existsSync(fixture) && 'Fixture fehlt' }, async () => {
  const { build, problems } = loadAndValidate(fixture);
  assert.deepEqual(problems.filter((p) => p.level === 'error'), []);
  const expected = Object.fromEntries(COLLECTIONS.flatMap((c) => build.docs[c].map((d) => [`${c}/${d.id}`, d.data])));

  const out1 = upload();
  assert.match(out1, /fertig: \d+ Dokument\(e\) geschrieben nach hkobox,/);
  const first = await snapshot();
  assert.deepEqual(Object.keys(first).sort(), Object.keys(expected).sort(), 'genau die Dokumente des Builds');
  for (const [k, data] of Object.entries(first)) {
    assert.ok(data.updatedAt && typeof data.updatedAt.toMillis === 'function', `${k}: updatedAt ist ein Timestamp`);
    assert.equal(stableJson(data), stableJson(expected[k]), `${k}: Inhalt 1:1 wie die Build-Datei`);
  }

  const out2 = upload();
  assert.doesNotMatch(out2, /verwaist \(nicht geloescht\)/);
  const second = await snapshot();
  assert.deepEqual(Object.keys(second).sort(), Object.keys(first).sort(), 'zweiter Lauf: gleiche Dokumente');
  for (const k of Object.keys(first)) assert.equal(stableJson(second[k]), stableJson(first[k]), `${k}: zweiter Lauf, gleicher Inhalt ohne updatedAt`);
});

test('verwaiste Dokumente werden aufgelistet, nicht geloescht', { skip: !existsSync(fixture) && 'Fixture fehlt' }, async () => {
  await db.collection('units').doc('lj9-verwaist').set({ unitId: 'lj9-verwaist', version: 1 });
  const out = upload();
  assert.match(out, /verwaist \(nicht geloescht\): hkobox\/units\/lj9-verwaist/);
  assert.ok((await db.collection('units').doc('lj9-verwaist').get()).exists, 'Dokument bleibt');
  await db.collection('units').doc('lj9-verwaist').delete();   // Aufraeumen im Emulator
});
