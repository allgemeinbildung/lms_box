// Emulator test for scripts/upload-teacher-materials.mjs --emulator (CONTRACT.md, «Teacher materials»):
// nine documents with exactly the contract fields, a second run replaces, a unit whose "einheit"
// differs stops before writing (with a copy in the temp folder, never the real data).
// Run (from backend/): npm run test:teacher-materials
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (!process.env.FIRESTORE_EMULATOR_HOST) { console.error('FIRESTORE_EMULATOR_HOST fehlt: nur im Emulator laufen lassen.'); process.exit(1); }

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '..');
const script = join(backend, 'scripts', 'upload-teacher-materials.mjs');
const dataDir = resolve(backend, '..', '..', 'weiterentwicklung-paket', 'varianten', 'E-B', 'obsidian');
const UNITS = ['5.1.1', '5.1.2', '5.2.1', '5.2.2', '5.3.1', '5.3.2', '5.3.3', '5.4.1', '5.4.2'];
const FIELDS = ['assignmentId', 'einheitId', 'generiertAm', 'hpTeacher', 'lehrpersonKarten', 'uploadedAt'];

const app = initializeApp({ projectId: 'demo-lmsbox' }, 'teacher-materials-emu-test');
const db = getFirestore(app, 'lmsbox');
const coll = db.collection('teacherMaterials');
after(() => deleteApp(app));

function upload(...extra) {
  const r = spawnSync(process.execPath, [script, '--emulator', ...extra], { cwd: backend, encoding: 'utf8', timeout: 60000 });
  return { status: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') };
}
const readJson = (k, f) => JSON.parse(readFileSync(join(dataDir, k, f), 'utf8'));

test('schreibt 9 Dokumente mit genau den Vertragsfeldern', async () => {
  for (const d of (await coll.get()).docs) await d.ref.delete();
  const r = upload();
  assert.equal(r.status, 0, r.out);
  const snap = await coll.get();
  assert.equal(snap.size, 9);
  for (const k of UNITS) {
    const karten = readJson(k, 'lehrperson-karten.json'), teacher = readJson(k, 'hpTeacher.json');
    const doc = await coll.doc(encodeURIComponent(karten.einheit)).get();
    assert.ok(doc.exists, `${k}: Dokument fehlt`);
    const data = doc.data();
    assert.deepEqual(Object.keys(data).sort(), FIELDS, `${k}: Felder`);
    assert.equal(data.einheitId, karten.einheit);
    assert.equal(data.assignmentId, teacher.assignmentId);
    assert.equal(data.generiertAm, teacher.generiert_am);
    assert.deepEqual(data.lehrpersonKarten, karten, `${k}: lehrperson-karten.json unverändert`);
    assert.deepEqual(data.hpTeacher, teacher, `${k}: hpTeacher.json unverändert`);
    assert.equal(typeof data.uploadedAt?.toMillis, 'function', `${k}: uploadedAt ist ein Timestamp`);
  }
});

test('zweiter Lauf ersetzt das ganze Dokument, kein Doppel', async () => {
  const id = 'EB-5.1.1';
  await coll.doc(id).update({ fremd: 'weg damit' });
  const vorher = (await coll.doc(id).get()).data().uploadedAt.toMillis();
  const r = upload();
  assert.equal(r.status, 0, r.out);
  assert.equal((await coll.get()).size, 9);
  const data = (await coll.doc(id).get()).data();
  assert.deepEqual(Object.keys(data).sort(), FIELDS, 'Fremdfeld ist weg (set, nicht merge)');
  assert.ok(data.uploadedAt.toMillis() >= vorher);
});

test('abweichendes "einheit" bricht vor dem Schreiben ab', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'teacher-materials-'));
  try {
    mkdirSync(join(tmp, '5.1.1'));
    copyFileSync(join(dataDir, '5.1.1', 'lehrperson-karten.json'), join(tmp, '5.1.1', 'lehrperson-karten.json'));
    const teacher = readJson('5.1.1', 'hpTeacher.json');
    writeFileSync(join(tmp, '5.1.1', 'hpTeacher.json'), JSON.stringify({ ...teacher, einheit: 'EB-9.9.9', assignmentId: 'GEAENDERT' }));
    const r = upload('--dir', tmp, '--nur', '5.1.1');
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /"einheit" differs/);
    assert.notEqual((await coll.doc('EB-5.1.1').get()).data().assignmentId, 'GEAENDERT', 'nichts geschrieben');
    assert.ok(!(await coll.doc('EB-9.9.9').get()).exists);
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});
