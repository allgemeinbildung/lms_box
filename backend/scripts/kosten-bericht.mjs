#!/usr/bin/env node
// Kostenbericht der Rückmeldungen — nur für die Lehrperson, nur lokal. CONTRACT.md, «Cost report».
//
// Joins, by formativ's request_id: who asked which question (formativUsage in lmsbox), what it
// cost (formativ_verbrauch in formativ's database), and the Gemini evaluator's token log. Names
// come from the roster at run time. The output carries names: it is written under .secrets/
// (outside both repos) and refused anywhere inside a repository.
//
//   node scripts/kosten-bericht.mjs --live --key <service-account.json> --formativ-db-url-file <file>
//   node scripts/kosten-bericht.mjs --emulator --formativ-json <export.json>      (tests, fictional data)
//
//   --seit YYYY-MM-DD / --bis YYYY-MM-DD   only requests in this period (both days included)
//   --formativ-db-url-file <file>          one line: postgres://formativ_bericht:…@…  (read-only role, sql/002)
//   --formativ-json <file>                 instead: rows of formativ_verbrauch as a JSON array
//   --origin <url>                         count unassigned formativ rows only from this origin (the LMS Box function)
//   --gemini-log <file>                    default ../../.secrets/kosten/gemini-verbrauch.jsonl
//   --preise <file>                        default scripts/kosten-preise.json
//   --out <folder>                         default ../../.secrets/kosten/bericht-<date>
// Without a formativ source the report still runs: formativ requests are listed «ohne Betrag».
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRequests, joinFormativ, priceGemini, aggregate, renderHtml, csvFiles } from './lib/kosten.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, '..', '..', '..');                       // obs-allgemeinbildung (not a repo)
const REPOS = [resolve(here, '..', '..'), resolve(ROOT, 'evaluator')];
const args = process.argv.slice(2);
const has = (f) => args.includes(f);
const val = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const die = (m) => { console.error(`kosten-bericht: ${m}`); process.exit(1); };

const live = has('--live'), emulator = has('--emulator');
if (live === emulator) die('use exactly one of --live or --emulator');
const day = (v, name) => { if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) die(`${name} must be YYYY-MM-DD`); return v || null; };
const seit = day(val('--seit'), '--seit');
const bis = day(val('--bis'), '--bis');

/** True when `p` lies inside one of the repositories (real paths, so a junction does not get around it). */
function insideRepo(p) {
    let real;
    try { real = realpathSync(p); } catch { real = resolve(p); }
    return REPOS.some((repo) => {
        let r;
        try { r = realpathSync(repo); } catch { return false; }
        const rel = relative(r, real);
        return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    });
}

// ---- Firestore ----------------------------------------------------------------------------

const { initializeApp, cert } = await import('firebase-admin/app');
const { getFirestore } = await import('firebase-admin/firestore');
let app;
if (emulator) {
    if (!process.env.FIRESTORE_EMULATOR_HOST) die('--emulator requires FIRESTORE_EMULATOR_HOST');
    app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'interactive-media-2a1fc' }, 'kosten');
} else {
    if (process.env.FIRESTORE_EMULATOR_HOST) die('FIRESTORE_EMULATOR_HOST is set; unset it for --live');
    const key = val('--key');
    if (!key) die('--live requires --key <service-account.json>');
    if (insideRepo(resolve(key))) die('--key lies inside a repository; keep the service-account key outside');
    app = initializeApp({ credential: cert(JSON.parse(readFileSync(key, 'utf8'))), projectId: 'interactive-media-2a1fc' }, 'kosten');
}
const box = getFirestore(app, 'lmsbox');
const rosterDb = getFirestore(app);

const usageDocs = (await box.collection('formativUsage').get()).docs.map((d) => d.data());
const requests = collectRequests(usageDocs);
const roster = new Map();
const uids = [...new Set(requests.map((r) => r.uid))];
for (let i = 0; i < uids.length; i += 300) {
    const refs = uids.slice(i, i + 300).map((u) => rosterDb.doc(`students/${u}`));
    for (const s of refs.length ? await rosterDb.getAll(...refs) : []) if (s.exists) roster.set(s.id, { name: s.get('name') || '', classId: s.get('classId') || '' });
}
// Students who only appear in the Gemini log are matched by name: load the rest of the roster too.
for (const s of (await rosterDb.collection('students').get()).docs) {
    if (!roster.has(s.id)) roster.set(s.id, { name: s.get('name') || '', classId: s.get('classId') || '' });
}

// ---- formativ -------------------------------------------------------------------------------

const hinweise = [];
let verbrauch = [];
if (val('--formativ-json')) {
    verbrauch = JSON.parse(readFileSync(val('--formativ-json'), 'utf8'));
    if (!Array.isArray(verbrauch)) die('--formativ-json must hold a JSON array');
} else if (val('--formativ-db-url-file')) {
    const url = readFileSync(val('--formativ-db-url-file'), 'utf8').trim();
    let pg;
    try { ({ default: pg } = await import('pg')); } catch { die('the package "pg" is missing: npm install in app/backend'); }
    const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
        const r = await client.query(
            `select request_id, instanz_id, herkunft, erstellt_um, modell, anbieter, versuche, eingabe_token, ausgabe_token,
                    kosten_usd, vollstaendig, zustand from formativ_verbrauch
             where ($1::date is null or erstellt_um >= $1::date) and ($2::date is null or erstellt_um < $2::date + 1)
             order by erstellt_um`, [seit, bis]);
        verbrauch = r.rows.map((x) => ({ ...x, kosten_usd: x.kosten_usd === null ? null : Number(x.kosten_usd) }));
    } finally { await client.end(); }
} else {
    hinweise.push('Ohne formativ-Protokoll erstellt (weder --formativ-db-url-file noch --formativ-json): alle formativ-Anfragen stehen ohne Betrag.');
}

// ---- Gemini ---------------------------------------------------------------------------------

const geminiLog = resolve(val('--gemini-log') || join(ROOT, '.secrets', 'kosten', 'gemini-verbrauch.jsonl'));
let geminiLines = [];
if (existsSync(geminiLog)) {
    geminiLines = readFileSync(geminiLog, 'utf8').split(/\r?\n/).filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
} else {
    hinweise.push(`Kein Gemini-Protokoll gefunden (${geminiLog}). Der Evaluator schreibt es seit dem 23.10.2026.`);
}
const preise = JSON.parse(readFileSync(resolve(val('--preise') || join(here, 'kosten-preise.json')), 'utf8'));

// ---- report ---------------------------------------------------------------------------------

const { rows, unmatched } = joinFormativ(requests, verbrauch, { seit, bis, origin: val('--origin') || null });
const gemini = priceGemini(geminiLines, preise, { seit, bis });
const rep = aggregate({ rows, unmatched, gemini, roster });
if (!val('--origin') && unmatched.length) {
    hinweise.push('«Keiner Person zugeordnet» enthält alle Aufrufer der formativ-Instanz (auch bbw-hko). Mit --origin <Origin der LMS Box> nur die eigenen.');
}

const stamp = new Date().toISOString().slice(0, 10);
const out = resolve(val('--out') || join(ROOT, '.secrets', 'kosten', `bericht-${stamp}`));
if (insideRepo(out)) die(`--out ${out} lies inside a repository; the report carries names and belongs under .secrets/`);
mkdirSync(out, { recursive: true });
const zeitraum = seit || bis ? `${seit || 'Anfang'} bis ${bis || 'heute'}` : 'alles';
writeFileSync(join(out, 'kosten.html'), renderHtml(rep, { erstellt: new Date().toLocaleString('de-CH'), zeitraum, preise, hinweise }));
for (const [name, text] of Object.entries(csvFiles(rep, rows, gemini))) writeFileSync(join(out, name), text);

const t = rep.total;
console.log(`kosten-bericht: ${out}`);
console.log(`  formativ  ${t.formativ.anfragen} Anfragen (${t.formativ.ausfaelle} Ausfälle), $${t.formativ.kosten_usd.toFixed(4)}${t.formativ.ohne_betrag ? `, ${t.formativ.ohne_betrag} ohne Betrag` : ''}`);
console.log(`  Gemini    ${t.gemini.anfragen} Bewertungen, $${t.gemini.kosten_usd.toFixed(4)}${t.gemini.ohne_betrag ? `, ${t.gemini.ohne_betrag} ohne Preis` : ''}`);
console.log(`  fremd     ${t.fremd.anfragen} formativ-Anfragen ohne Zuordnung`);
for (const h of hinweise) console.log(`  Hinweis: ${h}`);
process.exit(0);
