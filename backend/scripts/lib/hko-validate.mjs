// Pruefungen fuer den hko-Build (HKO-P1-PLAN.md §4, Vertrag HKO.md «Phase P1» §2–§6).
// Reine Funktionen: nur node:fs/node:path, kein Firebase. Getestet in test/hko-upload.test.mjs.
//
//   readBuild(dir)        -> { dir, docs: {units, solutions, items, itemSolutions}, present, skipped, problems }
//   normalize(coll, data) -> data in der Form, die die Box liest (einzige Stelle fuer Format-Anpassungen, Plan §7.3)
//   validateBuild(build)  -> [{ level: 'error'|'warn', path, msg }]
//   loadAndValidate(dir)  -> { build, problems }   (readBuild + normalize + validateBuild)
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const COLLECTIONS = ['units', 'solutions', 'items', 'itemSolutions'];
export const MAX_DOC_BYTES = 1048576 - 4096;          // Firestore: 1 MiB pro Dokument; JSON-Bytes sind nur eine Naeherung, daher Marge

export const UNIT_ID = /^[a-z0-9-]{1,80}$/;           // unitId, blockId
export const LONG_ID = /^[a-z0-9-]{1,100}$/;          // frageId, kritId, slug
export const VARIANTEN = ['3J', '4J', '2J'];
export const KI_STUFEN = ['verboten', 'eingeschraenkt', 'erlaubt', 'gegenstand'];
export const P1_TYPES = ['items', 'text', 'raster', 'selbst', 'mitnahme'];
export const LATER_TYPES = ['upload', 'link', 'roleplay', 'peer', 'audio'];
export const SOLUTION_KEYS = ['loesungen', 'erwartungshorizont', 'mehrdeutigkeit', 'musterloesung', 'loesung',
  'solution', 'kalibrierung', 'systemanweisung', 'roleplay_verhalten'];
export const LIMITS = { rasterZeilen: 8, rasterSpalten: 6, fragen: 12, selbstKriterien: 6 };
const MITNAHME_FELD = /^(text|befund|zeilen|stufen|begruendung|verbessere|antworten\.[a-z0-9-]{1,100})$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string';
const isNonEmptyStr = (v) => typeof v === 'string' && v.trim() !== '';
const isInt = (v) => Number.isInteger(v);
const isConflict = (name) => /-LYOBBW291\.json$/.test(name) || / - Kopie\.json$/.test(name);
const idField = (coll) => (coll === 'units' || coll === 'solutions' ? 'unitId' : 'slug');

// ---------------------------------------------------------------- lesen

export function readBuild(dir) {
  const docs = { units: [], solutions: [], items: [], itemSolutions: [] };
  const present = {};
  const skipped = [];
  const problems = [];
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    problems.push({ level: 'error', path: dir, msg: 'Build-Ordner nicht gefunden' });
    return { dir, docs, present, skipped, problems };
  }
  for (const coll of COLLECTIONS) {
    const sub = join(dir, coll);
    present[coll] = existsSync(sub) && statSync(sub).isDirectory();
    if (!present[coll]) {
      if (coll === 'units') problems.push({ level: 'error', path: `${coll}/`, msg: 'Ordner units/ fehlt im Build' });
      continue;
    }
    for (const f of readdirSync(sub).filter((n) => n.endsWith('.json')).sort()) {
      const path = `${coll}/${f}`;
      if (isConflict(f)) { skipped.push(path); continue; }
      let data;
      try { data = JSON.parse(readFileSync(join(sub, f), 'utf8')); }
      catch (e) { problems.push({ level: 'error', path, msg: `kein gueltiges JSON (${e.message})` }); continue; }
      if (!isObj(data)) { problems.push({ level: 'error', path, msg: 'oberste Ebene ist kein Objekt' }); continue; }
      docs[coll].push({ file: f, path, id: f.slice(0, -5), data });
    }
  }
  return { dir, docs, present, skipped, problems };
}

// ---------------------------------------------------------------- normalize (Plan §7.3)

// Einzige Stelle, an der ein vom Plan abweichendes Build-Format an die Form angepasst wird, die die
// Box liest (Vertrag §6). Stand 16.10.2026 entspricht der Build dem Vertrag; daher fast Identitaet.
// Die Funktion gibt immer eine Kopie zurueck und veraendert die Eingabe nicht.
export function normalize(coll, data) {
  const out = structuredClone(data);
  if (coll === 'units' && isObj(out.blocks)) {
    for (const blk of Object.values(out.blocks)) {
      if (!isObj(blk)) continue;
      // Plan-Form `beispielzeile: string[]` (eine Zeile) -> Build-Form `beispielzeilen: [{c}]` (Vertrag V4)
      if (blk.type === 'raster' && Array.isArray(blk.beispielzeile) && blk.beispielzeilen === undefined) {
        blk.beispielzeilen = [{ c: blk.beispielzeile }];
        delete blk.beispielzeile;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- Hilfen

function walk(value, path, visit) {
  visit(value, path);
  if (Array.isArray(value)) value.forEach((v, i) => walk(v, `${path}[${i}]`, visit));
  else if (isObj(value)) for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, visit);
}

function findSolutionKeys(data, base, add) {
  walk(data, '', (v, p) => {
    if (!isObj(v)) return;
    for (const k of Object.keys(v)) {
      if (SOLUTION_KEYS.includes(k)) add('error', `${base}:${p ? p + '.' : ''}${k}`, `Loesungsfeld «${k}» gehoert nach solutions/ bzw. itemSolutions/, nie in die lesbaren Dokumente`);
    }
  });
}

function findNestedArrays(data, base, add) {
  walk(data, '', (v, p) => {
    if (Array.isArray(v) && v.some(Array.isArray)) add('error', `${base}:${p}`, 'Array in Array – Firestore speichert das nicht');
  });
}

function findEszett(data, base, add) {
  walk(data, '', (v, p) => {
    if (isStr(v) && v.includes('ß')) add('warn', `${base}:${p}`, 'enthaelt «ß» (Schweizer Hochdeutsch: «ss»; massgebend ist der Check der Inhalts-Session)');
  });
}

function checkHttps(url, path, add) {
  if (url === undefined || url === null) return;
  if (!isStr(url)) { add('error', path, 'URL ist kein String'); return; }
  let u;
  try { u = new URL(url); } catch { add('error', path, `keine gueltige URL: ${url}`); return; }
  if (u.protocol !== 'https:') add('error', path, `nur https:-URLs erlaubt, nicht ${u.protocol}`);
}

// Welches mitnahme-`feld` passt zu welchem Blocktyp (Vertrag §4)
function feldPasst(feld, blk) {
  if (feld.startsWith('antworten.')) {
    return blk.type === 'items' && (!Array.isArray(blk.fragen) || blk.fragen.some((f) => f?.id === feld.slice(10)));
  }
  return ({ text: ['text'], befund: ['raster'], zeilen: ['raster'], stufen: ['selbst'], begruendung: ['selbst'], verbessere: ['selbst'] })[feld]?.includes(blk.type) ?? false;
}

// ---------------------------------------------------------------- Pruefen

export function validateBuild(build) {
  const problems = [];
  const add = (level, path, msg) => problems.push({ level, path, msg });
  const { docs } = build;
  const unitsById = new Map(docs.units.map((d) => [d.id, d.data]));
  const itemsBySlug = new Map(docs.items.map((d) => [d.id, d.data]));
  const solutionsById = new Map(docs.solutions.map((d) => [d.id, d.data]));

  // 1, 8, 9 und Firestore-Grenzen fuer jedes Dokument
  for (const coll of COLLECTIONS) {
    const pattern = coll === 'units' || coll === 'solutions' ? UNIT_ID : LONG_ID;
    for (const d of docs[coll]) {
      const f = idField(coll);
      if (!pattern.test(d.id)) add('error', d.path, `Dateiname «${d.id}» passt nicht zu ${pattern} (Dokument-Id)`);
      if (d.data[f] !== d.id) add('error', `${d.path}:${f}`, `${f} ${JSON.stringify(d.data[f])} ist nicht gleich dem Dateinamen «${d.id}»`);
      const bytes = Buffer.byteLength(JSON.stringify(d.data), 'utf8') + 64;   // + updatedAt
      d.bytes = bytes;
      if (bytes > MAX_DOC_BYTES) add('error', d.path, `Dokument ~${bytes} Bytes, Grenze ${MAX_DOC_BYTES} (1 MiB minus Marge)`);
      findNestedArrays(d.data, d.path, add);
      findEszett(d.data, d.path, add);
      if (coll === 'units' || coll === 'items') findSolutionKeys(d.data, d.path, add);
    }
  }

  for (const d of docs.units) validateUnit(d, { unitsById, itemsBySlug, present: build.present, add });

  // 3 Paarigkeit units <-> solutions
  for (const d of docs.solutions) {
    const unit = unitsById.get(d.id);
    if (!unit) { add('error', d.path, `Loesung ohne Einheit: units/${d.id}.json fehlt`); continue; }
    if (unit.version !== d.data.version) add('warn', `${d.path}:version`, `version ${JSON.stringify(d.data.version)} ist nicht die der Einheit (${JSON.stringify(unit.version)})`);
    if (d.data.blocks !== undefined && !isObj(d.data.blocks)) add('error', `${d.path}:blocks`, 'blocks ist keine Map');
    else for (const bid of Object.keys(d.data.blocks ?? {})) {
      if (!isObj(unit.blocks) || !(bid in unit.blocks)) add('warn', `${d.path}:blocks.${bid}`, `Block ${bid} gibt es in der Einheit nicht`);
    }
  }
  for (const d of docs.units) {
    if (solutionsById.has(d.id)) continue;
    const aktiv = isObj(d.data.blocks) && Object.values(d.data.blocks).some((b) => b?.feedback?.aktiv === true);
    add('warn', d.path, `keine Loesung solutions/${d.id}.json${aktiv ? ' (Bloecke mit feedback.aktiv; in P1 ohne KI-Feedback unkritisch)' : ''}`);
  }
  // items <-> itemSolutions
  for (const d of docs.items) validateItem(d, add);
  for (const d of docs.itemSolutions) {
    const item = itemsBySlug.get(d.id);
    if (!item) { add('error', d.path, `Loesung ohne Item: items/${d.id}.json fehlt`); continue; }
    if (!isObj(d.data.loesungen)) { add('error', `${d.path}:loesungen`, 'loesungen fehlt oder ist keine Map'); continue; }
    const ids = new Set((item.fragen ?? []).map((q) => q?.id));
    for (const fid of Object.keys(d.data.loesungen)) if (!ids.has(fid)) add('warn', `${d.path}:loesungen.${fid}`, `Frage ${fid} gibt es in items/${d.id} nicht`);
  }
  if (build.present.itemSolutions) {
    for (const d of docs.items) if (!docs.itemSolutions.some((s) => s.id === d.id)) add('warn', d.path, `keine Loesung itemSolutions/${d.id}.json`);
  }
  return problems;
}

function validateItem(d, add) {
  const p = d.path;
  if (!Array.isArray(d.data.fragen)) { add('error', `${p}:fragen`, 'fragen fehlt oder ist keine Liste'); return; }
  const seen = new Set();
  d.data.fragen.forEach((q, i) => {
    const qp = `${p}:fragen[${i}]`;
    if (!isObj(q)) { add('error', qp, 'Frage ist kein Objekt'); return; }
    if (!isStr(q.id) || !LONG_ID.test(q.id)) add('error', `${qp}.id`, `frageId ${JSON.stringify(q.id)} passt nicht zu ${LONG_ID}`);
    else if (seen.has(q.id)) add('error', `${qp}.id`, `frageId ${q.id} doppelt`);
    seen.add(q.id);
    if (!isNonEmptyStr(q.text)) add('error', `${qp}.text`, 'text fehlt');
  });
}

function validateUnit(d, ctx) {
  const { add, unitsById, itemsBySlug, present } = ctx;
  const u = d.data;
  const P = d.path;

  // 4 Pflichtfelder der Einheit (Vertrag §6)
  if (!isInt(u.version) || u.version < 1) add('error', `${P}:version`, 'version muss eine ganze Zahl ≥ 1 sein');
  if (!isNonEmptyStr(u.titel)) add('error', `${P}:titel`, 'titel fehlt');
  if (u.lehrjahr !== undefined && !(isInt(u.lehrjahr) && u.lehrjahr >= 1 && u.lehrjahr <= 4)) add('error', `${P}:lehrjahr`, 'lehrjahr muss 1–4 sein');
  if (!isObj(u.varianten) || Object.keys(u.varianten).length === 0) add('error', `${P}:varianten`, 'varianten fehlt oder ist keine Map {3J, 4J, …}');
  else for (const v of Object.keys(u.varianten)) if (!VARIANTEN.includes(v)) add('error', `${P}:varianten.${v}`, `unbekannte Variante (erlaubt: ${VARIANTEN.join(', ')})`);
  const varianten = isObj(u.varianten) ? Object.keys(u.varianten) : [];

  const kriterien = isObj(u.kriterien) ? u.kriterien : {};
  if (!isObj(u.kriterien)) add('error', `${P}:kriterien`, 'kriterien fehlt oder ist keine Map');
  for (const [kid, k] of Object.entries(kriterien)) {
    const kp = `${P}:kriterien.${kid}`;
    if (!LONG_ID.test(kid)) add('error', kp, `kritId passt nicht zu ${LONG_ID}`);
    if (!isObj(k)) { add('error', kp, 'Kriterium ist kein Objekt'); continue; }
    if (!isNonEmptyStr(k.name)) add('error', `${kp}.name`, 'name fehlt');
    if (!isObj(k.stufen) || !['0', '1', '2', '3'].every((s) => isNonEmptyStr(k.stufen[s]))) add('error', `${kp}.stufen`, 'stufen braucht die Texte "0" bis "3"');
  }

  const quellen = u.quellen === undefined ? {} : u.quellen;
  if (!isObj(quellen)) add('error', `${P}:quellen`, 'quellen ist keine Map');
  else for (const [qid, q] of Object.entries(quellen)) {
    const qp = `${P}:quellen.${qid}`;
    if (!isObj(q)) { add('error', qp, 'Quelle ist kein Objekt'); continue; }
    if (!isNonEmptyStr(q.titel)) add('error', `${qp}.titel`, 'titel fehlt');
    if (!isNonEmptyStr(q.herausgeber)) add('error', `${qp}.herausgeber`, 'herausgeber fehlt');
    if (!isNonEmptyStr(q.plattform)) add('error', `${qp}.plattform`, 'plattform fehlt');
    if (q.plattform === 'srf' && !isNonEmptyStr(q.quellenverweis)) add('error', `${qp}.quellenverweis`, 'bei plattform srf ist quellenverweis Pflicht');
    checkHttps(q.embed_url, `${qp}.embed_url`, add);
    checkHttps(q.url, `${qp}.url`, add);
  }

  if (!isObj(u.blocks)) {
    add('error', `${P}:blocks`, Array.isArray(u.blocks) ? 'blocks ist eine Liste; verlangt ist eine flache Map {blockId: Block}' : 'blocks fehlt oder ist keine Map');
    return;
  }
  const blocks = u.blocks;
  const blockIds = Object.keys(blocks);

  // reihenfolge enthaelt genau die blockIds
  if (!Array.isArray(u.reihenfolge)) add('error', `${P}:reihenfolge`, 'reihenfolge fehlt oder ist keine Liste von blockIds');
  else {
    const seen = new Set();
    for (const r of u.reihenfolge) {
      if (seen.has(r)) add('error', `${P}:reihenfolge`, `${JSON.stringify(r)} doppelt`);
      seen.add(r);
      if (!(r in blocks)) add('error', `${P}:reihenfolge`, `${JSON.stringify(r)} ist kein Block der Einheit`);
    }
    for (const b of blockIds) if (!seen.has(b)) add('error', `${P}:reihenfolge`, `Block ${b} fehlt in reihenfolge`);
  }

  for (const bid of blockIds) {
    const b = blocks[bid];
    const bp = `${P}:blocks.${bid}`;
    if (!UNIT_ID.test(bid)) add('error', bp, `blockId passt nicht zu ${UNIT_ID}`);
    if (!isObj(b)) { add('error', bp, 'Block ist kein Objekt (sind die Bloecke nach Phasen verschachtelt?)'); continue; }
    if (!('type' in b) && Object.values(b).some(isObj)) add('error', bp, 'Block ohne type mit Unterobjekten – nach Phasen verschachtelt? blocks muss flach sein');
    // gemeinsame Felder
    if (!isStr(b.type)) { add('error', `${bp}.type`, 'type fehlt'); continue; }
    if (!isNonEmptyStr(b.titel)) add('error', `${bp}.titel`, 'titel fehlt');
    if (!isStr(b.auftrag)) add('error', `${bp}.auftrag`, 'auftrag fehlt');
    if (b.k !== undefined && !isInt(b.k)) add('error', `${bp}.k`, 'k ist keine ganze Zahl');
    if (typeof b.kn !== 'boolean') add('error', `${bp}.kn`, 'kn muss true oder false sein');
    if (!(b.nur_variante === null || b.nur_variante === undefined || varianten.includes(b.nur_variante)))
      add('error', `${bp}.nur_variante`, `${JSON.stringify(b.nur_variante)} ist keine Variante der Einheit (${varianten.join(', ')})`);
    if (b.kriterien !== undefined && !Array.isArray(b.kriterien)) add('error', `${bp}.kriterien`, 'kriterien ist keine Liste');
    for (const k of Array.isArray(b.kriterien) ? b.kriterien : []) {
      if (!(isStr(k) && k in kriterien)) add('error', `${bp}.kriterien`, `Kriterium ${JSON.stringify(k)} gibt es in unit.kriterien nicht`);
    }
    if (b.indikatoren !== undefined) {
      if (!isObj(b.indikatoren)) add('error', `${bp}.indikatoren`, 'indikatoren ist keine Map');
      else for (const k of Object.keys(b.indikatoren)) if (!(k in kriterien)) add('error', `${bp}.indikatoren.${k}`, 'Kriterium gibt es in unit.kriterien nicht');
    }
    if (!isObj(b.ki_regel)) add('error', `${bp}.ki_regel`, 'ki_regel {stufe, text} fehlt');
    else {
      if (!KI_STUFEN.includes(b.ki_regel.stufe)) add('error', `${bp}.ki_regel.stufe`, `${JSON.stringify(b.ki_regel.stufe)} ist keine Stufe (${KI_STUFEN.join(' | ')})`);
      if (!isNonEmptyStr(b.ki_regel.text)) add('error', `${bp}.ki_regel.text`, 'text fehlt');
    }
    if (b.quelle_ref !== undefined && b.quelle_ref !== null) {
      if (!(isStr(b.quelle_ref) && isObj(quellen) && b.quelle_ref in quellen)) add('error', `${bp}.quelle_ref`, `Quelle ${JSON.stringify(b.quelle_ref)} gibt es in unit.quellen nicht`);
    }
    if (b.kn === true) add('warn', bp, 'kn: true – Box zeigt Hinweis, KN ausserhalb der Box (P1)');

    // 5 Typen
    if (LATER_TYPES.includes(b.type)) { add('warn', `${bp}.type`, `Typ ${b.type} ist nicht in P1 – Box zeigt Platzhalter`); continue; }
    if (!P1_TYPES.includes(b.type)) { add('error', `${bp}.type`, `unbekannter Blocktyp ${JSON.stringify(b.type)}`); continue; }

    // 6 Grenzen je Typ
    if (b.type === 'items') {
      if (!Array.isArray(b.fragen) || b.fragen.length === 0) add('error', `${bp}.fragen`, 'fragen [{id, k, text}] fehlt (aufgeloest, P1-E4)');
      else {
        if (b.fragen.length > LIMITS.fragen) add('error', `${bp}.fragen`, `${b.fragen.length} Fragen, hoechstens ${LIMITS.fragen}`);
        const seen = new Set();
        b.fragen.forEach((q, i) => {
          const qp = `${bp}.fragen[${i}]`;
          if (!isObj(q)) { add('error', qp, 'Frage ist kein Objekt'); return; }
          if (!isStr(q.id) || !LONG_ID.test(q.id)) add('error', `${qp}.id`, `frageId ${JSON.stringify(q.id)} passt nicht zu ${LONG_ID}`);
          else if (seen.has(q.id)) add('error', `${qp}.id`, `frageId ${q.id} doppelt im Block`);
          seen.add(q.id);
          if (!isNonEmptyStr(q.text)) add('error', `${qp}.text`, 'text fehlt');
        });
      }
      if (present.items && Array.isArray(b.items)) {
        for (const it of b.items) if (isObj(it) && isStr(it.slug) && !itemsBySlug.has(it.slug)) add('warn', `${bp}.items`, `items/${it.slug}.json fehlt im Build`);
      }
    } else if (b.type === 'text') {
      for (const f of ['min_woerter', 'max_woerter']) if (b[f] !== undefined && b[f] !== null && !(isInt(b[f]) && b[f] >= 0)) add('error', `${bp}.${f}`, 'keine ganze Zahl ≥ 0');
      if (isInt(b.min_woerter) && isInt(b.max_woerter) && b.min_woerter > b.max_woerter) add('warn', bp, 'min_woerter > max_woerter');
      if (b.konventionen !== undefined && !Array.isArray(b.konventionen)) add('error', `${bp}.konventionen`, 'keine Liste');
    } else if (b.type === 'raster') {
      const spalten = Array.isArray(b.spalten) ? b.spalten : null;
      if (!spalten || spalten.length === 0 || !spalten.every(isStr)) add('error', `${bp}.spalten`, 'spalten fehlt oder ist keine Liste von Texten');
      else if (spalten.length > LIMITS.rasterSpalten) add('error', `${bp}.spalten`, `${spalten.length} Spalten, hoechstens ${LIMITS.rasterSpalten}`);
      if (!isInt(b.zeilen) || b.zeilen < 1) add('error', `${bp}.zeilen`, 'zeilen muss eine ganze Zahl ≥ 1 sein');
      else if (b.zeilen > LIMITS.rasterZeilen) add('error', `${bp}.zeilen`, `${b.zeilen} Zeilen, hoechstens ${LIMITS.rasterZeilen}`);
      if (typeof b.befund !== 'boolean') add('error', `${bp}.befund`, 'befund muss true oder false sein');
      if (b.beispielzeilen !== undefined && b.beispielzeilen !== null) {
        if (!Array.isArray(b.beispielzeilen)) add('error', `${bp}.beispielzeilen`, 'keine Liste [{c: [...]}]');
        else b.beispielzeilen.forEach((z, i) => {
          if (!isObj(z) || !Array.isArray(z.c) || !z.c.every(isStr)) add('error', `${bp}.beispielzeilen[${i}]`, 'erwartet {c: [Text, …]}');
          else if (spalten && z.c.length !== spalten.length) add('error', `${bp}.beispielzeilen[${i}].c`, `${z.c.length} Zellen, aber ${spalten.length} Spalten`);
        });
      }
      const hatQuelle = isStr(b.quelle_ref);
      const hatSeiten = Array.isArray(b.lehrmittel_seiten) && b.lehrmittel_seiten.length > 0;
      if (!hatQuelle && !hatSeiten) add('warn', bp, 'weder quelle_ref noch lehrmittel_seiten – Box zeigt keinen Bezug');
      if (b.lehrmittel_seiten !== undefined) {
        if (!Array.isArray(b.lehrmittel_seiten)) add('error', `${bp}.lehrmittel_seiten`, 'keine Liste');
        else b.lehrmittel_seiten.forEach((s, i) => {
          if (!isObj(s) || !isStr(s.kapitel) || !Array.isArray(s.seiten)) add('error', `${bp}.lehrmittel_seiten[${i}]`, 'erwartet {kapitel, abschnitt?, seiten[]}');
        });
      }
    } else if (b.type === 'selbst') {
      const ks = Array.isArray(b.kriterien) ? b.kriterien : [];
      if (ks.length === 0) add('error', `${bp}.kriterien`, 'selbst braucht mindestens ein Kriterium');
      if (ks.length > LIMITS.selbstKriterien) add('error', `${bp}.kriterien`, `${ks.length} Kriterien, hoechstens ${LIMITS.selbstKriterien}`);
      if (new Set(ks).size !== ks.length) add('error', `${bp}.kriterien`, 'Kriterium doppelt');
      if (b.bezug_block !== undefined && b.bezug_block !== null && !(isStr(b.bezug_block) && b.bezug_block in blocks))
        add('error', `${bp}.bezug_block`, `Block ${JSON.stringify(b.bezug_block)} gibt es in der Einheit nicht`);
    } else if (b.type === 'mitnahme') {
      // 7 mitnahme-Ziele
      if (!Array.isArray(b.quellen) || b.quellen.length === 0) { add('error', `${bp}.quellen`, 'quellen [{unitId, blockId, feld?, label}] fehlt'); continue; }
      b.quellen.forEach((q, i) => {
        const qp = `${bp}.quellen[${i}]`;
        if (!isObj(q)) { add('error', qp, 'kein Objekt'); return; }
        if (!isStr(q.unitId) || !UNIT_ID.test(q.unitId)) { add('error', `${qp}.unitId`, `unitId ${JSON.stringify(q.unitId)} ungueltig`); return; }
        if (!isStr(q.blockId) || !UNIT_ID.test(q.blockId)) { add('error', `${qp}.blockId`, `blockId ${JSON.stringify(q.blockId)} ungueltig`); return; }
        if (!isNonEmptyStr(q.label)) add('error', `${qp}.label`, 'label fehlt');
        if (q.feld !== undefined && q.feld !== null && !(isStr(q.feld) && MITNAHME_FELD.test(q.feld))) add('error', `${qp}.feld`, `${JSON.stringify(q.feld)} ist kein Pfad (text, befund, zeilen, antworten.<frageId>, stufen, begruendung, verbessere)`);
        const zielUnit = q.unitId === d.id ? u : unitsById.get(q.unitId);
        if (!zielUnit) { add('warn', qp, `${q.unitId}/${q.blockId}: Einheit nicht im Build – im Live-Modus gegen die DB pruefen`); return; }
        const ziel = isObj(zielUnit.blocks) ? zielUnit.blocks[q.blockId] : undefined;
        if (!isObj(ziel)) { add('error', qp, `${q.unitId}/${q.blockId}: Block gibt es nicht`); return; }
        if (q.unitId === d.id && q.blockId === bid) add('error', qp, 'mitnahme zeigt auf sich selbst');
        if (ziel.kn === true || !['items', 'text', 'raster', 'selbst'].includes(ziel.type)) add('warn', qp, `${q.unitId}/${q.blockId}: Typ ${ziel.type}${ziel.kn ? ' mit kn: true' : ''} speichert in P1 keine Antwort`);
        else if (isStr(q.feld) && !feldPasst(q.feld, ziel)) add('warn', `${qp}.feld`, `${q.feld} passt nicht zum Typ ${ziel.type} von ${q.blockId}`);
      });
    }
  }
}

// mitnahme-Ziele, die nicht im Build liegen und im Live-Modus in der DB geprueft werden muessen
export function externalMitnahmeTargets(build) {
  const inBuild = new Set(build.docs.units.map((d) => d.id));
  const out = [];
  for (const d of build.docs.units) {
    for (const [bid, b] of Object.entries(isObj(d.data.blocks) ? d.data.blocks : {})) {
      if (b?.type !== 'mitnahme' || !Array.isArray(b.quellen)) continue;
      b.quellen.forEach((q, i) => {
        if (isObj(q) && isStr(q.unitId) && UNIT_ID.test(q.unitId) && !inBuild.has(q.unitId))
          out.push({ path: `${d.path}:blocks.${bid}.quellen[${i}]`, unitId: q.unitId, blockId: q.blockId });
      });
    }
  }
  return out;
}

export function loadAndValidate(dir) {
  const build = readBuild(dir);
  for (const coll of COLLECTIONS) for (const d of build.docs[coll]) d.data = normalize(coll, d.data);
  const problems = [...build.problems, ...validateBuild(build)];
  return { build, problems };
}

// Inhaltsvergleich ohne updatedAt und unabhaengig von der Schluesselreihenfolge
export function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (isObj(value)) return '{' + Object.keys(value).filter((k) => k !== 'updatedAt').sort().map((k) => JSON.stringify(k) + ':' + stableJson(value[k])).join(',') + '}';
  return JSON.stringify(value);
}
