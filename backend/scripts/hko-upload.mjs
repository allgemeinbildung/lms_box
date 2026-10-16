#!/usr/bin/env node
// Laedt den hko-Build in die Firestore-DB `hko` (HKO-P1-PLAN.md §4, Vertrag HKO.md «Phase P1» §3).
//   build/units/<unitId>.json        -> units/{unitId}
//   build/solutions/<unitId>.json    -> solutions/{unitId}
//   build/items/<slug>.json          -> items/{slug}            (wenn vorhanden)
//   build/itemSolutions/<slug>.json  -> itemSolutions/{slug}    (wenn vorhanden)
// Ganze Dokumente per batch.set() ohne Merge, + updatedAt = serverTimestamp(). Geloescht wird nie;
// Dokumente in der DB ohne Build-Datei werden nur aufgelistet («verwaist»).
//
// Modi (genau einer; --dry-run ist Standard):
//   --dry-run                                  pruefen und anzeigen, schreibt nichts; braucht kein node_modules
//   --emulator                                 verlangt FIRESTORE_EMULATOR_HOST (lokal); Projekt aus GCLOUD_PROJECT
//   --live --key <service-account.json> --yes  echtes Projekt (PROJECT_ID), DB DATABASE_ID — nur Pietro
// Weitere: --build <dir> (Standard <repo>/../hko-content/build), --force-version (nur --live)
//
// Projekt und DB stehen in scripts/lib/hko-target.mjs (eine Stelle, Umzug). firebase-admin wird erst
// importiert, wenn geschrieben wird, und erst nachdem alle Schutzpruefungen bestanden sind.
import { readFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PROJECT_ID, DATABASE_ID } from './lib/hko-target.mjs';
import { COLLECTIONS, loadAndValidate, externalMitnahmeTargets, stableJson } from './lib/hko-validate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');                 // app/ bzw. app-hko/
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (msg) => { console.error('FEHLER: ' + msg); process.exit(2); };

const KNOWN = new Set(['--dry-run', '--emulator', '--live', '--key', '--yes', '--build', '--force-version']);
for (let i = 0; i < args.length; i++) {
  if (!KNOWN.has(args[i])) die(`unbekannte Option ${args[i]}`);
  if (args[i] === '--key' || args[i] === '--build') { if (args[i + 1] === undefined) die(`${args[i]} braucht einen Pfad`); i++; }
}

const live = has('--live'), emulator = has('--emulator');
if ([has('--dry-run'), live, emulator].filter(Boolean).length > 1) die('nur einer der Modi --dry-run, --emulator, --live');
const dry = !live && !emulator;
const buildDir = val('--build') ? resolve(val('--build')) : resolve(repoRoot, '..', 'hko-content', 'build');

// ---------------------------------------------------------------- Schutz (vor allem anderen)
let keyPath;
if (emulator) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  if (!host) die('--emulator verlangt FIRESTORE_EMULATOR_HOST (z. B. 127.0.0.1:8320)');
  if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(host)) die(`FIRESTORE_EMULATOR_HOST=${host} ist nicht lokal`);
}
if (live) {
  if (process.env.FIRESTORE_EMULATOR_HOST) die('FIRESTORE_EMULATOR_HOST ist gesetzt; fuer --live entfernen, damit nichts aus Versehen an einen Emulator geht (oder umgekehrt)');
  if (!val('--key')) die('--live verlangt --key <pfad-zum-service-account.json>');
  // Der Schluessel darf nie im Repo liegen (es ist oeffentlich). Echte Pfade vergleichen, damit ein
  // Symlink oder Junction ins Repo die Pruefung nicht umgeht.
  try { keyPath = realpathSync(resolve(val('--key'))); } catch (e) { die(`--key ${val('--key')} nicht lesbar: ${e.message}`); }
  const repoReal = realpathSync(repoRoot);
  const rel = relative(repoReal, keyPath);
  if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel)))
    die(`--key ${val('--key')} liegt im Repository (${repoReal}). Den Schluessel ausserhalb des Repos ablegen und den Pfad von dort angeben.`);
  if (!has('--yes')) die('--live schreibt in das echte Projekt; ohne die Option --yes wird nichts getan (zuerst den Trockenlauf ansehen)');
}
if (has('--force-version') && !live) die('--force-version gilt nur mit --live');

// ---------------------------------------------------------------- pruefen
const { build, problems } = loadAndValidate(buildDir);
const errors = problems.filter((p) => p.level === 'error');
const warns = problems.filter((p) => p.level !== 'error');
const all = COLLECTIONS.flatMap((c) => build.docs[c].map((d) => ({ ...d, coll: c })));

const target = live ? `LIVE Projekt ${PROJECT_ID}, Datenbank ${DATABASE_ID}`
  : emulator ? `EMULATOR ${process.env.FIRESTORE_EMULATOR_HOST}, Projekt ${process.env.GCLOUD_PROJECT || PROJECT_ID}, Datenbank ${DATABASE_ID}`
  : `TROCKENLAUF (es wird nichts geschrieben), Ziel waere Datenbank ${DATABASE_ID}`;
console.log(`modus:   ${target}`);
console.log(`build:   ${buildDir}`);
console.log(`dateien: ${COLLECTIONS.map((c) => `${c} ${build.present[c] ? build.docs[c].length : '–'}`).join(', ')}; uebersprungene Konfliktkopien: ${build.skipped.length}`);
build.skipped.forEach((s) => console.log('  uebersprungen: ' + s));
if (warns.length) { console.log(`warnungen: ${warns.length}`); warns.forEach((p) => console.log(`  ~ ${p.path}: ${p.msg}`)); }
if (errors.length) { console.log(`fehler: ${errors.length}`); errors.forEach((p) => console.log(`  ! ${p.path}: ${p.msg}`)); }
const largest = all.reduce((a, b) => ((b.bytes ?? 0) > (a?.bytes ?? -1) ? b : a), null);
if (largest) console.log(`groesstes Dokument: ${largest.bytes} Bytes (${(largest.bytes / 1024).toFixed(1)} KiB) -- ${largest.path}`);
const describe = (d) => d.coll === 'units' ? `${Object.keys(d.data.blocks ?? {}).length} Bloecke, version ${d.data.version}`
  : d.coll === 'solutions' ? `${Object.keys(d.data.blocks ?? {}).length} Bloecke`
  : d.coll === 'items' ? `${(d.data.fragen ?? []).length} Fragen`
  : `${Object.keys(d.data.loesungen ?? {}).length} Loesungen`;

if (dry) {
  for (const d of all) console.log(`  wuerde setzen ${DATABASE_ID}/${d.coll}/${d.id}  (${d.bytes} Bytes, ${describe(d)})  <- ${d.path}`);
  console.log(`\nTROCKENLAUF: ${all.length} Dokument(e) wuerden geschrieben, ${build.skipped.length} uebersprungen, ${errors.length} Fehler, ${warns.length} Warnung(en).`);
  process.exit(errors.length ? 1 : 0);
}
if (errors.length) die('erst die Fehler oben beheben; geschrieben wird nur ein fehlerfreier Build');
if (all.length === 0) die('der Build ist leer');

// ---------------------------------------------------------------- Schluessel (nur --live), vor dem Import
let key;
if (live) {
  try { key = JSON.parse(readFileSync(keyPath, 'utf8')); } catch (e) { die(`--key ist kein lesbares JSON: ${e.message}`); }
  if (key.project_id !== PROJECT_ID) die(`Service-Account gehoert zu Projekt ${JSON.stringify(key.project_id)}, erwartet ${PROJECT_ID}`);
}

// ---------------------------------------------------------------- schreiben (firebase-admin erst hier)
let initializeApp, cert, getFirestore, FieldValue;
try {
  ({ initializeApp, cert } = await import('firebase-admin/app'));
  ({ getFirestore, FieldValue } = await import('firebase-admin/firestore'));
} catch (e) {
  die(`firebase-admin ist nicht installiert (npm install in backend/): ${e.message}`);
}
const app = live
  ? initializeApp({ credential: cert(key), projectId: PROJECT_ID })
  : initializeApp({ projectId: process.env.GCLOUD_PROJECT || PROJECT_ID });
const db = getFirestore(app, DATABASE_ID);

// Nur --live: mitnahme-Ziele ausserhalb des Builds in der DB pruefen, Versionen vergleichen
if (live) {
  const extErrors = [];
  for (const t of externalMitnahmeTargets(build)) {
    const snap = await db.collection('units').doc(t.unitId).get();
    if (!snap.exists) extErrors.push(`${t.path}: Einheit ${t.unitId} gibt es weder im Build noch in der DB`);
    else if (!snap.get(`blocks`)?.[t.blockId]) extErrors.push(`${t.path}: Block ${t.unitId}/${t.blockId} gibt es in der DB nicht`);
  }
  for (const d of all.filter((x) => x.coll === 'units' || x.coll === 'solutions')) {
    const snap = await db.collection(d.coll).doc(d.id).get();
    if (!snap.exists) continue;
    const old = snap.data();
    if (Number.isInteger(old.version) && old.version > d.data.version && !has('--force-version'))
      extErrors.push(`${d.coll}/${d.id}: in der DB steht version ${old.version}, der Build hat ${d.data.version} (kleiner; mit --force-version trotzdem)`);
    else if (old.version === d.data.version && stableJson(old) !== stableJson(d.data))
      console.log(`  ~ ${d.coll}/${d.id}: Inhalt geaendert, Version nicht erhoeht (${d.data.version})`);
  }
  if (extErrors.length) { extErrors.forEach((m) => console.log('  ! ' + m)); die('Pruefung gegen die DB fehlgeschlagen; nichts geschrieben'); }
  console.log(`\nSchreibe ${all.length} Dokument(e) in Projekt ${PROJECT_ID}, Datenbank ${DATABASE_ID}.`);
}

let done = 0;
for (let i = 0; i < all.length; i += 400) {
  const batch = db.batch();
  for (const d of all.slice(i, i + 400)) {
    batch.set(db.collection(d.coll).doc(d.id), { ...d.data, updatedAt: FieldValue.serverTimestamp() });   // ganzes Dokument, kein Merge
  }
  await batch.commit();
  done += Math.min(400, all.length - i);
  console.log(`geschrieben ${done}/${all.length}`);
}
for (const d of all) console.log(`  gesetzt ${DATABASE_ID}/${d.coll}/${d.id}  (${d.bytes} Bytes, ${describe(d)})`);

// verwaiste Dokumente nur auflisten, nie loeschen
let orphans = 0;
for (const coll of COLLECTIONS) {
  const ids = new Set(build.docs[coll].map((d) => d.id));
  const refs = await db.collection(coll).listDocuments();
  for (const r of refs) if (!ids.has(r.id)) { orphans++; console.log(`  verwaist (nicht geloescht): ${DATABASE_ID}/${coll}/${r.id}`); }
}
console.log(`\nfertig: ${done} Dokument(e) geschrieben nach ${DATABASE_ID}, ${orphans} verwaist, ${warns.length} Warnung(en).`);
process.exit(0);
