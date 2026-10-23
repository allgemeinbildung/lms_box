// Cost report (CONTRACT.md, «Cost report»): join and sums, plus one run of the CLI against the
// Firestore emulator when it is there.
//   node --test test/kosten.test.mjs                       (pure parts)
//   npm run test:kosten                                    (with the emulator run)
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectRequests, joinFormativ, priceFor, priceGemini, aggregate, renderHtml, csvFiles } from '../scripts/lib/kosten.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PREISE = JSON.parse(readFileSync(join(HERE, '..', 'scripts', 'kosten-preise.json'), 'utf8'));

const USAGE = [
    { uid: 'u1', assignmentId: '4.3 Test', slots: {
        'A. Teil::q1': {
            state: 'done', at: '2026-10-24T09:05:00Z', request_id: 'r2',
            frueher: [{ at: '2026-10-24T09:00:00Z', request_id: 'r1' }],
            ausfaelle: [{ at: '2026-10-24T08:59:00Z', request_id: 'rx' }],
        },
        'A. Teil::q2': { state: 'frei', ausfaelle: [{ at: '2026-10-24T09:10:00Z', request_id: 'ry' }] },
        'B. Teil::q1': { state: 'pending', at: '2026-10-24T09:11:00Z' },
    } },
    { uid: 'u2', assignmentId: '4.3 Test', slots: {
        'A. Teil::q1': { state: 'done', at: '2026-10-01T10:00:00Z' },          // before the log: no request_id
    } },
];
const VERBRAUCH = [
    { request_id: 'r1', herkunft: 'https://lms', modell: 'google/gemma-4-31b-it', anbieter: 'DeepInfra', eingabe_token: 900, ausgabe_token: 100, kosten_usd: 0.0002, vollstaendig: true, erstellt_um: '2026-10-24T09:00:01Z' },
    { request_id: 'r2', herkunft: 'https://lms', modell: 'google/gemma-4-31b-it', anbieter: 'DeepInfra', eingabe_token: 950, ausgabe_token: 110, kosten_usd: 0.0003, vollstaendig: true, erstellt_um: '2026-10-24T09:05:01Z' },
    { request_id: 'rx', herkunft: 'https://lms', modell: 'google/gemma-4-31b-it', anbieter: 'DeepInfra', eingabe_token: 900, ausgabe_token: null, kosten_usd: null, vollstaendig: false, erstellt_um: '2026-10-24T08:59:01Z' },
    { request_id: 'ry', herkunft: 'https://lms', modell: 'google/gemma-4-31b-it', anbieter: 'DeepInfra', eingabe_token: 800, ausgabe_token: 10, kosten_usd: '0.00010000', vollstaendig: true, erstellt_um: '2026-10-24T09:10:01Z' },
    { request_id: 'hko-1', herkunft: 'https://bbw-hko.ch', modell: 'google/gemma-4-31b-it', anbieter: 'DeepInfra', eingabe_token: 1, ausgabe_token: 1, kosten_usd: 0.5, vollstaendig: true, erstellt_um: '2026-10-24T09:00:00Z' },
];
const GEMINI = [
    { at: '2026-10-24T12:00:00+0200', modell: 'gemini-flash-latest', modell_version: 'gemini-3.8-flash-002', eingabe_token: 10000, ausgabe_token: 2000, gedanken_token: 1000, class_name: 'TestA', student_name: 'Anna Beispiel', assignment_id: '4.3 Test', fragen: 2 },
    { at: '2027-01-05T12:00:00+0100', modell: 'gemini-flash-latest', modell_version: 'gemini-3.8-flash', eingabe_token: 10000, ausgabe_token: 3000, gedanken_token: null, class_name: 'TestA', student_name: 'Nicht Im Roster', assignment_id: '4.3 Test', fragen: 2 },
    { at: '2026-10-24T12:00:00+0200', modell: 'gemini-flash-latest', modell_version: null, eingabe_token: 5, ausgabe_token: 5, class_name: 'TestA', student_name: 'Anna Beispiel' },
];
const ROSTER = new Map([['u1', { name: 'Anna Beispiel', classId: 'TestA' }], ['u2', { name: 'Ben Muster', classId: 'TestA' }]]);

test('collectRequests: every feedback and every failed try, nothing for pending', () => {
    const r = collectRequests(USAGE);
    assert.deepEqual(r.map((x) => `${x.uid}|${x.subId}|${x.questionId}|${x.art}|${x.versuch}|${x.request_id}`), [
        'u1|A. Teil|q1|rueckmeldung|1|r1', 'u1|A. Teil|q1|rueckmeldung|2|r2', 'u1|A. Teil|q1|ausfall|null|rx',
        'u1|A. Teil|q2|ausfall|null|ry', 'u2|A. Teil|q1|rueckmeldung|1|null',
    ]);
});

test('joinFormativ: matched rows carry model and cost; unknown stays null; others are unmatched', () => {
    const { rows, unmatched } = joinFormativ(collectRequests(USAGE), VERBRAUCH);
    const by = Object.fromEntries(rows.map((r) => [r.request_id ?? 'none', r]));
    assert.equal(by.r1.kosten_usd, 0.0002);
    assert.equal(by.ry.kosten_usd, 0.0001, 'numeric text from pg becomes a number');
    assert.equal(by.rx.kosten_usd, null);
    assert.equal(by.none.protokoll, 'kein_protokoll');
    assert.deepEqual(unmatched.map((u) => u.request_id), ['hko-1']);
    assert.deepEqual(joinFormativ(collectRequests(USAGE), VERBRAUCH, { origin: 'https://lms' }).unmatched, []);
    const oct24 = joinFormativ(collectRequests(USAGE), VERBRAUCH, { seit: '2026-10-24', bis: '2026-10-24' });
    assert.equal(oct24.rows.length, 4, 'the request of 1 October is outside');
});

test('priceFor: longest prefix, dated periods, unknown model → null', () => {
    assert.deepEqual(priceFor(PREISE, 'gemini-3.8-flash-002', '2026-10-24'), { key: 'gemini-3.8-flash', eingabe: 0.75, ausgabe: 3.75 });
    assert.equal(priceFor(PREISE, 'gemini-3.8-flash', '2027-01-05').eingabe, 1.5);
    assert.equal(priceFor(PREISE, 'gemini-2.5-flash-lite', '2026-10-24').eingabe, 0.1, 'flash-lite is not priced as flash');
    assert.equal(priceFor(PREISE, 'gemini-flash-latest', '2026-10-24'), null);
});

test('priceGemini: input plus output and thinking tokens; no price → null, flagged', () => {
    const g = priceGemini(GEMINI, PREISE);
    assert.ok(Math.abs(g[0].kosten_usd - (10000 * 0.75 + 3000 * 3.75) / 1e6) < 1e-12);
    assert.ok(Math.abs(g[1].kosten_usd - (10000 * 1.5 + 3000 * 7.5) / 1e6) < 1e-12);
    assert.deepEqual([g[2].kosten_usd, g[2].preis_fehlt], [null, true]);
});

test('aggregate: per person, per question, per model; unknown is counted apart, never as 0', () => {
    const { rows, unmatched } = joinFormativ(collectRequests(USAGE), VERBRAUCH);
    const rep = aggregate({ rows, unmatched, gemini: priceGemini(GEMINI, PREISE), roster: ROSTER });
    const anna = rep.personen.find((p) => p.name === 'Anna Beispiel');
    assert.deepEqual([anna.formativ.rueckmeldungen, anna.formativ.ausfaelle, anna.formativ.ohne_betrag], [2, 2, 1]);
    assert.ok(Math.abs(anna.formativ.kosten_usd - 0.0006) < 1e-12);
    assert.deepEqual([anna.gemini.anfragen, anna.gemini.ohne_betrag], [2, 1], 'Gemini lines are matched by name');
    assert.ok(rep.personen.some((p) => p.name === 'Nicht Im Roster' && p.gemini.anfragen === 1));
    const ben = rep.personen.find((p) => p.name === 'Ben Muster');
    assert.deepEqual([ben.formativ.anfragen, ben.formativ.ohne_betrag, ben.formativ.kosten_usd], [1, 1, 0]);
    const q1 = rep.fragen.find((q) => q.subId === 'A. Teil' && q.questionId === 'q1');
    assert.deepEqual([q1.personen, q1.rueckmeldungen, q1.ausfaelle, q1.ohne_betrag], [2, 3, 1, 2]);
    assert.ok(Math.abs(q1.durchschnitt_usd - 0.00025) < 1e-12, 'the average counts only requests with an amount');
    assert.deepEqual([rep.total.fremd.anfragen, rep.total.fremd.kosten_usd], [1, 0.5]);
    assert.ok(rep.modelle.some((m) => m.modell === 'google/gemma-4-31b-it' && m.anbieter === 'DeepInfra'));
    assert.ok(rep.modelle.some((m) => m.modell === '(kein Protokoll)'));
});

test('output: HTML escapes names, CSV opens in Excel (BOM, semicolons, quoting)', () => {
    const roster = new Map([['u1', { name: 'Anna <img src=x onerror=alert(1)>', classId: 'K;1' }]]);
    const { rows, unmatched } = joinFormativ(collectRequests(USAGE.slice(0, 1)), VERBRAUCH);
    const rep = aggregate({ rows, unmatched, gemini: [], roster });
    const html = renderHtml(rep, { erstellt: 'jetzt', zeitraum: 'alles', preise: PREISE });
    assert.ok(!html.includes('<img src=x') && html.includes('&lt;img src=x'));
    assert.match(html, /Enthält Namen von Lernenden/);
    const csv = csvFiles(rep, rows, [])['pro-person.csv'];
    assert.ok(csv.startsWith('﻿Klasse;Name;'));
    assert.match(csv, /"K;1";Anna <img/);
});

// ---- the CLI against the emulator -----------------------------------------------------------

const EMU = /^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '');
test('CLI on the emulator: reads formativUsage and roster, writes HTML and CSV, refuses an output inside the repo', { skip: EMU ? false : 'needs the Firestore emulator' }, async () => {
    const { initializeApp } = await import('firebase-admin/app');
    const { getFirestore } = await import('firebase-admin/firestore');
    const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'interactive-media-2a1fc' }, 'kosten-test');
    const box = getFirestore(app, 'lmsbox');
    const roster = getFirestore(app);
    for (const d of (await box.collection('formativUsage').get()).docs) await d.ref.delete();
    for (const u of USAGE) await box.doc(`formativUsage/${u.uid}__${encodeURIComponent(u.assignmentId)}`).set(u);
    await roster.doc('students/u1').set({ name: 'Anna Beispiel', classId: 'TestA', active: true });
    await roster.doc('students/u2').set({ name: 'Ben Muster', classId: 'TestA', active: true });

    const dir = mkdtempSync(join(tmpdir(), 'kosten-'));
    writeFileSync(join(dir, 'verbrauch.json'), JSON.stringify(VERBRAUCH));
    writeFileSync(join(dir, 'gemini.jsonl'), GEMINI.map((g) => JSON.stringify(g)).join('\n'));
    const script = join(HERE, '..', 'scripts', 'kosten-bericht.mjs');
    const out = join(dir, 'bericht');
    const log = execFileSync(process.execPath, [script, '--emulator', '--formativ-json', join(dir, 'verbrauch.json'),
        '--gemini-log', join(dir, 'gemini.jsonl'), '--origin', 'https://lms', '--out', out], { encoding: 'utf8' });
    assert.match(log, /formativ\s+5 Anfragen \(2 Ausfälle\)/);
    assert.deepEqual(readdirSync(out).sort(), ['einzeln-formativ.csv', 'einzeln-gemini.csv', 'kosten.html', 'pro-frage.csv', 'pro-modell.csv', 'pro-person.csv']);
    const html = readFileSync(join(out, 'kosten.html'), 'utf8');
    assert.match(html, /Anna Beispiel/);
    assert.match(html, /google\/gemma-4-31b-it/);

    assert.throws(() => execFileSync(process.execPath, [script, '--emulator', '--out', join(HERE, 'kosten-raus')], { encoding: 'utf8', stdio: 'pipe' }),
        (e) => /inside a repository/.test(String(e.stderr)));
});
