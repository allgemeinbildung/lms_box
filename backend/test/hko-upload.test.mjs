// Upload-Pruefungen der hko-box (HKO-P1-PLAN.md §4), ohne Emulator, ohne Netz.
// Run: node --test test/hko-upload.test.mjs   (aus backend/)
//
// Jeder Fall baut einen kleinen Build in os.tmpdir() aus einer erfundenen Basis-Einheit und veraendert
// ihn. Die Prozess-Tests starten scripts/hko-upload.mjs mit einem Loader-Hook, der jeden Import von
// firebase-admin mit einem Fehler beantwortet: ein Lauf, der bis zum Schreiben kaeme, wuerde scheitern
// statt das Netz zu erreichen. Kein Schluessel wird gelesen; die «Schluessel» hier sind Attrappen.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadAndValidate, normalize } from '../scripts/lib/hko-validate.mjs';
import { PROJECT_ID } from '../scripts/lib/hko-target.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const backend = resolve(here, '..');
const script = join(backend, 'scripts', 'hko-upload.mjs');
const tmpRoot = mkdtempSync(join(tmpdir(), 'hko-upload-test-'));
after(() => rmSync(tmpRoot, { recursive: true, force: true }));

// Loader-Hook: firebase-admin ist in den Kindprozessen nicht importierbar.
const blocker = join(tmpRoot, 'block-firebase-admin.mjs');
writeFileSync(blocker, `import { registerHooks } from 'node:module';
registerHooks({ resolve(spec, ctx, next) {
  if (spec === 'firebase-admin' || spec.startsWith('firebase-admin/')) throw new Error('BLOCKED firebase-admin import');
  return next(spec, ctx);
} });
`);

// ---------------------------------------------------------------- erfundene Basis
const stufen = { 3: 'Vollstaendig.', 2: 'Kleinere Abweichungen.', 1: 'Groessere Abweichungen.', 0: 'Nicht nachvollziehbar.' };
const ki = { stufe: 'verboten', text: 'Hier arbeiten Sie ohne KI-Werkzeuge.' };
function baseUnit() {
  return {
    unitId: 'lj9-test-basis',
    version: 1,
    titel: 'Testeinheit Wochenmarkt',
    lehrjahr: 1,
    varianten: { '3J': { kompetenzen: ['9.9.9'] }, '4J': { kompetenzen: ['9.9.8'] } },
    kriterien: {
      sachlich: { name: 'Sachlichkeit', dimension: 'SuK', stufen },
      haltung: { name: 'Haltung', dimension: 'Ges', stufen },
    },
    quellen: {
      'video-markt': { typ: 'video', titel: 'Ein Tag am Markt', herausgeber: 'SRF Test', plattform: 'srf',
        embed_url: 'https://www.srf.ch/play/embed?urn=urn:srf:video:test', quellenverweis: 'SRF, Test: Ein Tag am Markt, 01.01.2026', lizenz: 'srf-einbettung', vault_bild: null },
    },
    blocks: {
      fragen: { type: 'items', titel: 'Begriffe', auftrag: 'Beantworten Sie die Fragen.', k: 1, nur_variante: null, kn: false, kriterien: [],
        items: [{ slug: 'markt' }], fragen: [{ id: 'markt-1', k: 1, text: 'Was ist ein Markt?' }, { id: 'markt-2', k: 2, text: 'Wer bestimmt den Preis?' }], ki_regel: ki },
      raster: { type: 'raster', titel: 'Beobachten', auftrag: 'Halten Sie fest, was Sie sehen.', k: 2, nur_variante: '3J', kn: false, kriterien: ['sachlich'],
        quelle_ref: 'video-markt', spalten: ['Szene', 'Beobachtung', '→ Begriff'], zeilen: 4, beispielzeilen: [{ c: ['Stand', 'Preisschild', '→ Angebot'] }], befund: true, ki_regel: ki },
      entscheid: { type: 'text', titel: 'Entscheid', auftrag: 'Begruenden Sie Ihren Entscheid.', k: 3, nur_variante: null, kn: false, kriterien: ['sachlich', 'haltung'],
        indikatoren: { sachlich: 'Ich nenne Gruende.' }, genre: 'Stellungnahme', min_woerter: 80, max_woerter: 250, ki_regel: ki },
      selbst: { type: 'selbst', titel: 'Einschaetzung', auftrag: 'Schaetzen Sie sich ein.', k: 3, nur_variante: '4J', kn: false, kriterien: ['sachlich', 'haltung'], bezug_block: 'entscheid', ki_regel: ki },
      rueckblick: { type: 'mitnahme', titel: 'Rueckblick', auftrag: 'Lesen Sie Ihre Antwort nochmals.', k: 1, nur_variante: null, kn: false, kriterien: [],
        quellen: [{ unitId: 'lj9-test-basis', blockId: 'entscheid', feld: 'text', label: 'Mein Entscheid' }], ki_regel: ki },
    },
    reihenfolge: ['fragen', 'raster', 'entscheid', 'selbst', 'rueckblick'],
  };
}
function baseBuild() {
  return {
    units: { 'lj9-test-basis': baseUnit() },
    solutions: { 'lj9-test-basis': { unitId: 'lj9-test-basis', version: 1, blocks: { entscheid: { erwartungshorizont: 'Erfunden.', mehrdeutigkeit: { mehrere_loesungen: true } } } } },
    items: { markt: { slug: 'markt', begriff: 'Markt', fragen: [{ id: 'markt-1', k: 1, text: 'Was ist ein Markt?' }, { id: 'markt-2', k: 2, text: 'Wer bestimmt den Preis?' }] } },
    itemSolutions: { markt: { slug: 'markt', loesungen: { 'markt-1': { musterloesung: 'Erfunden.' } } } },
  };
}

let n = 0;
function writeBuild(build) {
  const dir = join(tmpRoot, `build-${++n}`);
  for (const [coll, docs] of Object.entries(build)) {
    mkdirSync(join(dir, coll), { recursive: true });
    for (const [name, data] of Object.entries(docs)) writeFileSync(join(dir, coll, `${name}.json`), JSON.stringify(data, null, 2));
  }
  return dir;
}
function check(mutate) {
  const b = baseBuild();
  mutate?.(b, b.units['lj9-test-basis']);
  return loadAndValidate(writeBuild(b)).problems;
}
const errors = (ps) => ps.filter((p) => p.level === 'error');
function assertError(ps, re) {
  const e = errors(ps);
  assert.ok(e.some((p) => re.test(`${p.path}: ${p.msg}`)), `erwartet Fehler ${re}, bekam:\n${ps.map((p) => `${p.level} ${p.path}: ${p.msg}`).join('\n')}`);
}

// ---------------------------------------------------------------- Pruefungen (reine Funktionen)

test('gueltiger Build: keine Fehler, keine Warnungen', () => {
  const ps = check();
  assert.deepEqual(ps, []);
});

test('normalize: Identitaet fuer das Build-Format, Plan-Form beispielzeile wird umgeschrieben, Eingabe bleibt', () => {
  const u = baseUnit();
  assert.deepEqual(normalize('units', u), u);
  const alt = baseUnit();
  delete alt.blocks.raster.beispielzeilen;
  alt.blocks.raster.beispielzeile = ['a', 'b', 'c'];
  const out = normalize('units', alt);
  assert.deepEqual(out.blocks.raster.beispielzeilen, [{ c: ['a', 'b', 'c'] }]);
  assert.equal(out.blocks.raster.beispielzeile, undefined);
  assert.ok(alt.blocks.raster.beispielzeile, 'Eingabe unveraendert');
});

test('loesungen in einer Unit -> Fehler mit Pfad', () => {
  assertError(check((b, u) => { u.loesungen = { blocks: {} }; }), /units\/lj9-test-basis\.json:loesungen/);
});

test('erwartungshorizont tief verschachtelt in einer Unit -> Fehler mit Pfad', () => {
  assertError(check((b, u) => { u.blocks.raster.extra = { a: [{ b: { erwartungshorizont: 'x' } }] }; }), /blocks\.raster\.extra\.a\[0\]\.b\.erwartungshorizont/);
});

test('roleplay_verhalten und musterloesung in items -> Fehler; in solutions erlaubt', () => {
  assertError(check((b) => { b.items.markt.fragen[0].musterloesung = 'x'; }), /items\/markt\.json:fragen\[0\]\.musterloesung/);
  assertError(check((b, u) => { u.blocks.entscheid.roleplay_verhalten = 'x'; }), /roleplay_verhalten/);
  assert.deepEqual(errors(check((b) => { b.solutions['lj9-test-basis'].blocks.entscheid.roleplay_verhalten = 'x'; })), []);
});

test('Dateiname ungleich unitId -> Fehler', () => {
  assertError(check((b) => { b.units['lj9-test-anders'] = b.units['lj9-test-basis']; delete b.units['lj9-test-basis']; }), /unitId "lj9-test-basis" ist nicht gleich dem Dateinamen «lj9-test-anders»/);
});

test('Id mit Grossbuchstaben oder Leerzeichen -> Fehler', () => {
  assertError(check((b, u) => { u.blocks['Block A'] = u.blocks.entscheid; delete u.blocks.entscheid; u.reihenfolge[2] = 'Block A'; u.blocks.selbst.bezug_block = 'Block A'; u.blocks.rueckblick.quellen[0].blockId = 'raster'; u.blocks.rueckblick.quellen[0].feld = 'befund'; }),
    /blocks\.Block A: blockId passt nicht/);
  assertError(check((b) => { const u = b.units['lj9-test-basis']; u.unitId = 'LJ9-Test'; b.units['LJ9-Test'] = u; delete b.units['lj9-test-basis']; b.solutions['lj9-test-basis'].unitId = 'x'; }),
    /Dateiname «LJ9-Test» passt nicht/);
  assertError(check((b, u) => { u.blocks.fragen.fragen[0].id = 'Markt 1'; }), /fragen\[0\]\.id: frageId "Markt 1"/);
});

test('Raster mit 9 Zeilen, 7 Spalten, falscher Beispielzeile -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.raster.zeilen = 9; }), /9 Zeilen, hoechstens 8/);
  assertError(check((b, u) => { u.blocks.raster.spalten = ['a', 'b', 'c', 'd', 'e', 'f', 'g']; u.blocks.raster.beispielzeilen = []; }), /7 Spalten, hoechstens 6/);
  assertError(check((b, u) => { u.blocks.raster.beispielzeilen = [{ c: ['nur', 'zwei'] }]; }), /2 Zellen, aber 3 Spalten/);
});

test('items mit 13 Fragen -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.fragen.fragen = Array.from({ length: 13 }, (_, i) => ({ id: `q-${i}`, k: 1, text: 'Frage?' })); }), /13 Fragen, hoechstens 12/);
});

test('selbst mit unbekanntem Kriterium, mit 7 Kriterien -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.selbst.kriterien = ['sachlich', 'gibtsnicht']; }), /blocks\.selbst\.kriterien: Kriterium "gibtsnicht"/);
  assertError(check((b, u) => {
    for (let i = 0; i < 7; i++) u.kriterien[`k-${i}`] = { name: `K${i}`, dimension: 'SuK', stufen };
    u.blocks.selbst.kriterien = Object.keys(u.kriterien).slice(0, 7);
  }), /7 Kriterien, hoechstens 6/);
});

test('block.kriterien und indikatoren mit unbekanntem Key -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.entscheid.kriterien = ['sachlich', 'fehlt']; }), /blocks\.entscheid\.kriterien: Kriterium "fehlt"/);
  assertError(check((b, u) => { u.blocks.entscheid.indikatoren = { fehlt: 'x' }; }), /indikatoren\.fehlt/);
});

test('mitnahme ins Leere -> Fehler; fremde Einheit nicht im Build -> Warnung', () => {
  assertError(check((b, u) => { u.blocks.rueckblick.quellen[0].blockId = 'gibtsnicht'; }), /lj9-test-basis\/gibtsnicht: Block gibt es nicht/);
  const ps = check((b, u) => { u.blocks.rueckblick.quellen.push({ unitId: 'lj9-test-fremd', blockId: 'notiz', label: 'Notiz' }); });
  assert.deepEqual(errors(ps), []);
  assert.ok(ps.some((p) => p.level === 'warn' && /nicht im Build – im Live-Modus gegen die DB pruefen/.test(p.msg)));
});

test('mitnahme auf eine zweite Einheit im Build -> gueltig', () => {
  const ps = check((b, u) => {
    const v = baseUnit();
    v.unitId = 'lj9-test-andere'; v.blocks = { notiz: v.blocks.entscheid }; v.reihenfolge = ['notiz'];
    b.units['lj9-test-andere'] = v;
    b.solutions['lj9-test-andere'] = { unitId: 'lj9-test-andere', version: 1, blocks: {} };
    u.blocks.rueckblick.quellen.push({ unitId: 'lj9-test-andere', blockId: 'notiz', feld: 'text', label: 'Notiz' });
  });
  assert.deepEqual(ps, []);
});

test('reihenfolge: fehlender, doppelter, fremder Block -> Fehler', () => {
  assertError(check((b, u) => { u.reihenfolge.pop(); }), /Block rueckblick fehlt in reihenfolge/);
  assertError(check((b, u) => { u.reihenfolge.push('fragen'); }), /"fragen" doppelt/);
  assertError(check((b, u) => { u.reihenfolge.push('nirgends'); }), /"nirgends" ist kein Block/);
});

test('blocks als Liste -> Fehler', () => {
  assertError(check((b, u) => { u.blocks = Object.values(u.blocks); }), /blocks ist eine Liste/);
});

test('ki_regel fehlt oder hat unbekannte Stufe -> Fehler', () => {
  assertError(check((b, u) => { delete u.blocks.entscheid.ki_regel; }), /entscheid\.ki_regel: ki_regel \{stufe, text\} fehlt/);
  assertError(check((b, u) => { u.blocks.entscheid.ki_regel = { stufe: 'manchmal', text: 'x' }; }), /"manchmal" ist keine Stufe/);
});

test('Typ ausserhalb P1 und kn: true -> nur Warnung; unbekannter Typ -> Fehler', () => {
  const ps = check((b, u) => {
    u.blocks.spaeter = { type: 'upload', titel: 'Spaeter', auftrag: 'x', nur_variante: null, kn: false, kriterien: [], ki_regel: ki };
    u.blocks.kn = { type: 'text', titel: 'KN', auftrag: 'x', nur_variante: '3J', kn: true, kriterien: ['sachlich'], ki_regel: ki };
    u.reihenfolge.push('spaeter', 'kn');
  });
  assert.deepEqual(errors(ps), []);
  assert.ok(ps.some((p) => /Box zeigt Platzhalter/.test(p.msg)));
  assert.ok(ps.some((p) => /KN ausserhalb der Box \(P1\)/.test(p.msg)));
  assertError(check((b, u) => { u.blocks.entscheid.type = 'quiz'; }), /unbekannter Blocktyp "quiz"/);
});

test('SRF-Quelle ohne quellenverweis -> Fehler; http-URL -> Fehler', () => {
  assertError(check((b, u) => { u.quellen['video-markt'].quellenverweis = null; }), /quellenverweis: bei plattform srf ist quellenverweis Pflicht/);
  assertError(check((b, u) => { u.quellen['video-markt'].embed_url = 'http://www.srf.ch/x'; }), /nur https:-URLs/);
  assertError(check((b, u) => { u.quellen['video-markt'].url = 'javascript:alert(1)'; }), /nur https:-URLs/);
});

test('quelle_ref unbekannt -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.raster.quelle_ref = 'gibtsnicht'; }), /raster\.quelle_ref: Quelle "gibtsnicht"/);
});

test('nur_variante, die die Einheit nicht anbietet -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.raster.nur_variante = '2J'; }), /"2J" ist keine Variante der Einheit/);
});

test('Paarigkeit: Loesung ohne Unit -> Fehler, Unit ohne Loesung -> Warnung', () => {
  assertError(check((b) => { b.solutions['lj9-test-weg'] = { unitId: 'lj9-test-weg', version: 1, blocks: {} }; }), /Loesung ohne Einheit/);
  const ps = check((b) => { delete b.solutions['lj9-test-basis']; });
  assert.deepEqual(errors(ps), []);
  assert.ok(ps.some((p) => p.level === 'warn' && /keine Loesung solutions\/lj9-test-basis/.test(p.msg)));
  assertError(check((b) => { b.itemSolutions.weg = { slug: 'weg', loesungen: {} }; }), /Loesung ohne Item/);
});

test('Eszett -> Warnung, kein Fehler', () => {
  const ps = check((b, u) => { u.titel = 'Grosse Strasse'.replace('ss', 'ß'); });
  assert.deepEqual(errors(ps), []);
  assert.ok(ps.some((p) => p.level === 'warn' && p.path.endsWith(':titel') && /«ß»/.test(p.msg)));
});

test('Dokument ueber 1 MiB minus Marge -> Fehler', () => {
  assertError(check((b, u) => { u.blocks.entscheid.auftrag = 'x'.repeat(1048576); }), /Grenze \d+ \(1 MiB minus Marge\)/);
});

test('Array in Array -> Fehler (Firestore)', () => {
  assertError(check((b, u) => { u.blocks.raster.beispielzeilen = [['a', 'b', 'c']]; }), /Array in Array/);
});

test('items/-Slug ungleich Dateiname -> Fehler', () => {
  assertError(check((b) => { b.items.markt.slug = 'andere'; }), /slug "andere" ist nicht gleich dem Dateinamen «markt»/);
});

// ---------------------------------------------------------------- Prozess-Tests (kein Netz)

function run(args, env = {}) {
  const e = { ...process.env, ...env };
  delete e.FIRESTORE_EMULATOR_HOST;
  if (env.FIRESTORE_EMULATOR_HOST) e.FIRESTORE_EMULATOR_HOST = env.FIRESTORE_EMULATOR_HOST;
  const r = spawnSync(process.execPath, ['--import', pathToFileURL(blocker).href, script, ...args], { cwd: backend, env: e, encoding: 'utf8', timeout: 30000 });
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  assert.ok(!/BLOCKED firebase-admin/.test(out), `firebase-admin wurde importiert:\n${out}`);
  assert.ok(!/geschrieben \d+\//.test(out), `es wurde geschrieben:\n${out}`);
  return { code: r.status, out };
}
const validDir = writeBuild(baseBuild());
const fakeKey = join(tmpRoot, 'attrappe-key.json');
writeFileSync(fakeKey, JSON.stringify({ project_id: PROJECT_ID, note: 'Attrappe, kein Schluessel' }));

test('Prozess: Trockenlauf gegen gueltigen Build ohne firebase-admin -> Exit 0', () => {
  const r = run(['--build', validDir]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /TROCKENLAUF: 4 Dokument\(e\) wuerden geschrieben, 0 uebersprungen, 0 Fehler/);
});

test('Prozess: Trockenlauf gegen kaputten Build -> Exit 1', () => {
  const b = baseBuild(); b.units['lj9-test-basis'].loesungen = {};
  const r = run(['--build', writeBuild(b)]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /! units\/lj9-test-basis\.json:loesungen/);
});

test('Prozess: Schluessel im Repo -> Abbruch, bevor etwas gelesen wird', () => {
  const inRepo = join(backend, `.hko-upload-test-key-${process.pid}.json`);
  writeFileSync(inRepo, JSON.stringify({ project_id: PROJECT_ID, note: 'Attrappe' }));
  try {
    const r = run(['--live', '--key', inRepo, '--yes', '--build', validDir]);
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /liegt im Repository/);
  } finally {
    rmSync(inRepo, { force: true });
  }
  assert.ok(!existsSync(inRepo));
});

test('Prozess: --live ohne --yes -> Abbruch', () => {
  const r = run(['--live', '--key', fakeKey, '--build', validDir]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /ohne die Option --yes wird nichts getan/);
});

test('Prozess: --live mit FIRESTORE_EMULATOR_HOST -> Abbruch', () => {
  const r = run(['--live', '--key', fakeKey, '--yes', '--build', validDir], { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8320' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /FIRESTORE_EMULATOR_HOST ist gesetzt/);
});

test('Prozess: --emulator ohne FIRESTORE_EMULATOR_HOST und zwei Modi -> Abbruch', () => {
  assert.equal(run(['--emulator', '--build', validDir]).code, 2);
  assert.equal(run(['--dry-run', '--live', '--build', validDir]).code, 2);
  assert.equal(run(['--emulator', '--build', validDir], { FIRESTORE_EMULATOR_HOST: '10.0.0.5:8080' }).code, 2);
});

// ---------------------------------------------------------------- echter Build und Fixture (Trockenlauf)

const realBuild = resolve(backend, '..', '..', 'hko-content', 'build');
test('Trockenlauf gegen den echten Build (hko-content/build)', { skip: !existsSync(realBuild) && 'hko-content/build fehlt' }, () => {
  const r = run(['--dry-run', '--build', realBuild]);
  const warn = r.out.split('\n').filter((l) => l.startsWith('  ~ '));
  if (warn.length) console.log(`# Warnungen echter Build:\n${warn.map((l) => '#' + l).join('\n')}`);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, / 0 Fehler/);
});

const fixtureBuild = join(here, 'fixtures', 'hko-build');
test('Trockenlauf gegen die Fixture test/fixtures/hko-build', { skip: !existsSync(fixtureBuild) && 'Fixture fehlt noch' }, () => {
  const r = run(['--dry-run', '--build', fixtureBuild]);
  const warn = r.out.split('\n').filter((l) => l.startsWith('  ~ '));
  if (warn.length) console.log(`# Warnungen Fixture:\n${warn.map((l) => '#' + l).join('\n')}`);
  assert.equal(r.code, 0, r.out);
});
