// Tests for the class analysis (klassenanalyse.js). No emulator, no model, no network beyond
// 127.0.0.1: memory deps and the fake Gemini (test/fake-gemini.js).
//
//   node --test test/klassenanalyse.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const ka = require('../klassenanalyse');
const { startFakeGemini, geminiAntwort } = require('./fake-gemini');

const AID = 'Spielfeld 9.9';
const SUB = 'W-01 Interessengruppe';
const KONTEXT = [
    'THEMA', 'Interessengruppe', '',
    'KERN', 'Eine Interessengruppe vertritt das Anliegen eines Teils der Gesellschaft.', '',
    'GESICHERTE FAKTEN', '1. Lobbying ist erlaubt. [T1]', '',
    'QUELLEN', 'T1 Spielfeld ABU, Karte W-01', '',
    'SICHTWEISEN', 'Musterlösung der Lehrperson: Ein Verband spricht für einen Teil, nicht für alle.', '',
    'BEGRIFFE', '- Interessengruppe', '',
    'LEICHT VERWECHSELT', '- Ein Verband ist eine neutrale Fachstelle', '',
    'GRENZEN', '- Namen von Lernenden sind nie Teil dieses Kontexts.',
].join('\n');
const rubrik = [{ id: 'k1', label: 'Teil statt alle', erwartung: 'Unterscheidet Teil und Ganzes', niveau: 'K2' },
    { id: 'k2', label: 'Gegenposition', erwartung: 'Nennt die Gegenposition', niveau: 'K2' }];
const ASSIGNMENT = {
    assignmentTitle: 'Spielfeld 9.9', formativ: true, klassenanalyse: true,
    subAssignments: {
        [SUB]: { type: 'quill', questions: [
            { id: 'Q-1', text: 'Wer spricht **für wen**?', formativ: { rubrik_version: 't', rubrik, kontext: KONTEXT } },
            { id: 'Q-2', text: 'Ist das Lobbying verboten?', formativ: { rubrik_version: 't', rubrik: [rubrik[0]], kontext: KONTEXT } },
        ] },
        'W-02 Anderes': { type: 'quill', questions: [{ id: 'Q-9', text: 'Andere Karte', formativ: true }] },
    },
};

const NAMEN = ['Anna Zogg', 'Beat Keller', 'Chiara Rossi', 'Dario Bianchi', 'Elena Weber', 'Fabio Graf',
    'Gina Pfister', 'Hugo Brunner', 'Iris Moser', 'Jonas Huber', 'Klara Meier'];
const KLASSE = 'TEST1';
const members = NAMEN.map((name, i) => ({ uid: `uid-${String(i).padStart(3, '0')}-geheim`, name }));
const EMAILS = members.map((m) => `${m.name.toLowerCase().replace(' ', '.')}@lernende.bbw.ch`);

function draft(m, i, voll = true) {
    return {
        uid: m.uid, classId: KLASSE, assignmentId: AID, subId: SUB,
        answers: [
            { questionId: 'Q-1', answer: `<p>Antwort ${i}: Die Gewerkschaft spricht für ihre Mitglieder und nicht für alle, sagt ${m.name}.</p>` },
            { questionId: 'Q-2', answer: voll ? `<p>Lobbying ist erlaubt, Nummer ${i}.</p>` : '<p><br></p>' },
        ],
    };
}
function usageFor(m) {
    const at = '2026-11-08T10:00:00.000Z';
    const res = (st, h) => ({ zustand: 'vollstaendig', kriterien: [{ id: 'k1', label: 'Teil statt alle', status: st, hinweis: h }, { id: 'k2', label: 'Gegenposition', status: 'fehlt', hinweis: 'Wer hält dagegen?' }] });
    return {
        uid: m.uid, assignmentId: AID, slots: {
            [`${SUB}::Q-1`]: { state: 'done', at, result: res('erfuellt', `Gut, ${m.name.split(' ')[0]}.`), gesendet: 'x', pseudonym: 'L-abcdef12',
                frueher: [{ at, result: res('teilweise', 'Für wen genau?') }] },
        },
    };
}

/** Memory deps: `fertig` students completed the card, the rest only started it. */
function memDeps({ fertig, fetchFn, now = () => Date.now(), random = Math.random }) {
    const docs = new Map();
    const drafts = members.map((m, i) => draft(m, i, i < fertig));
    return {
        docs, drafts, calls: [],
        now, random,
        gemini: { apiKey: 'test-key', model: 'gemini-test', fetchFn },
        loadAssignment: async () => ASSIGNMENT,
        loadMembers: async (c) => (c === KLASSE ? members : []),
        loadStudentClasses: async () => [KLASSE],
        loadDrafts: async (uids) => drafts.filter((d) => uids.includes(d.uid)),
        loadUsage: async (uids) => new Map(members.filter((m) => uids.includes(m.uid)).map((m) => [m.uid, usageFor(m)])),
        store: {
            async lesen(id) { return docs.has(id) ? structuredClone(docs.get(id)) : null; },
            async reservieren(id, entscheiden) {   // read + decide + write in one tick: atomic in JS
                const r = entscheiden(docs.has(id) ? structuredClone(docs.get(id)) : null);
                if (r.ok) docs.set(id, { ...(docs.get(id) || {}), ...r.daten });
                return r;
            },
            async schreiben(id, daten) { docs.set(id, { ...(docs.get(id) || {}), ...structuredClone(daten) }); },
        },
    };
}

/** fetchFn that answers like Gemini (via the fake) and records every request body. */
function fakeFetch({ delayMs = 0, bodies = [] } = {}) {
    const fn = async (url, init) => {
        const body = JSON.parse(init.body);
        bodies.push({ url, headers: init.headers, body });
        if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
        return { status: 200, json: async () => geminiAntwort(body) };
    };
    fn.bodies = bodies;
    return fn;
}
const ID = ka.analyseId(KLASSE, AID, SUB);
const MIN = 60 * 1000;

// ---------------------------------------------------------------- pure parts

test('istAntwort and completed: an empty Quill paragraph does not count', () => {
    assert.equal(ka.istAntwort('<p><br></p>'), false);
    assert.equal(ka.istAntwort('  '), false);
    assert.equal(ka.istAntwort('<p>x</p>'), true);
    const q = ASSIGNMENT.subAssignments[SUB].questions;
    assert.equal(ka.istAbgeschlossen(draft(members[0], 0, true), q), true);
    assert.equal(ka.istAbgeschlossen(draft(members[0], 0, false), q), false);
});

test('stufe: 5, 8, 11, 14 are the thresholds', () => {
    assert.deepEqual([0, 4, 5, 7, 8, 10, 11, 14].map(ka.stufe), [0, 0, 1, 1, 2, 2, 3, 4]);
});

test('kontextTeile splits the spielfeld briefing; the card takes core, facts, model answer, confusions', () => {
    const k = ka.karteBauen(ASSIGNMENT, SUB);
    assert.equal(k.karte.begriff, 'Interessengruppe');
    assert.match(k.karte.kern, /Teils der Gesellschaft/);
    assert.deepEqual(k.karte.gesicherte_fakten, ['1. Lobbying ist erlaubt. [T1]']);
    assert.equal(k.fragen[0].musterloesung, 'Ein Verband spricht für einen Teil, nicht für alle.');
    assert.deepEqual(k.fragen[0].leicht_verwechselt, ['Ein Verband ist eine neutrale Fachstelle']);
    assert.equal(k.fragen[0].text, 'Wer spricht für wen?');
    assert.deepEqual(k.fragen[0].rubrik.map((r) => r.id), ['k1', 'k2']);
    assert.ok(!JSON.stringify(k).includes('QUELLEN') && !JSON.stringify(k).includes('Namen von Lernenden'));
});

// ---------------------------------------------------------------- threshold 5 and 8

test('trigger: nothing below 5 completed, an analysis at 5', async () => {
    const f4 = fakeFetch();
    const d4 = memDeps({ fertig: 4, fetchFn: f4 });
    const r4 = await ka.beiDraft(d4.drafts[0], d4);
    assert.equal(r4[0].status, 'uebersprungen');
    assert.equal(f4.bodies.length, 0);
    assert.equal(d4.docs.size, 0);

    const f5 = fakeFetch();
    const d5 = memDeps({ fertig: 5, fetchFn: f5 });
    const r5 = await ka.beiDraft(d5.drafts[0], d5);
    assert.equal(r5[0].status, 'fertig');
    assert.equal(f5.bodies.length, 1);
    const doc = d5.docs.get(ID);
    assert.equal(doc.state, 'fertig');
    assert.deepEqual(doc.basis, { klassengroesse: 11, begonnen: 11, abgeschlossen: 5 });
    assert.equal(doc.model_version, 'gemini-fake-001');
    assert.equal(doc.tokens.gesamt, 1890);
    assert.equal(doc.ausloeser, 'auto');
});

test('trigger: a draft that is not complete starts nothing; an assignment without the flag neither', async () => {
    const f = fakeFetch();
    const d = memDeps({ fertig: 6, fetchFn: f });
    assert.deepEqual(await ka.beiDraft(d.drafts[8], d), []);           // index 8 is only started
    const ohne = { ...d, loadAssignment: async () => ({ ...ASSIGNMENT, klassenanalyse: undefined }) };
    assert.deepEqual(await ka.beiDraft(d.drafts[0], ohne), []);
    assert.equal(f.bodies.length, 0);
});

test('trigger: again at 8, not at 6 or 7, and at most once per 10 minutes', async () => {
    let t = Date.parse('2026-12-02T08:00:00Z');
    const f = fakeFetch();
    const d = memDeps({ fertig: 5, fetchFn: f, now: () => t });
    await ka.beiDraft(d.drafts[0], d);
    assert.equal(f.bodies.length, 1);

    const setFertig = (n) => { d.drafts.forEach((x, i) => { x.answers[1].answer = i < n ? '<p>ok</p>' : '<p><br></p>'; }); };
    for (const n of [6, 7]) {
        setFertig(n); t += 11 * MIN;
        const r = await ka.beiDraft(d.drafts[0], d);
        assert.equal(r[0].grund, 'schwelle', `at ${n}`);
    }
    assert.equal(f.bodies.length, 1);

    setFertig(8); t += 1 * MIN;                                        // 8, but only 1 minute after the last start? no: 23 min
    const last = Date.parse(d.docs.get(ID).gestartet);
    t = last + 5 * MIN;                                                // 5 minutes after the last start
    let r = await ka.beiDraft(d.drafts[0], d);
    assert.equal(r[0].grund, 'pause');
    t = last + 10 * MIN + 1;
    r = await ka.beiDraft(d.drafts[0], d);
    assert.equal(r[0].status, 'fertig');
    assert.equal(f.bodies.length, 2);
    assert.equal(d.docs.get(ID).basis.abgeschlossen, 8);

    setFertig(10); t += 11 * MIN;
    assert.equal((await ka.beiDraft(d.drafts[0], d))[0].grund, 'schwelle');
    setFertig(11);
    assert.equal((await ka.beiDraft(d.drafts[0], d))[0].status, 'fertig');
});

// ---------------------------------------------------------------- lock

test('lock: two runs at once, one goes to the model; a running state blocks; an old one does not', async () => {
    const f = fakeFetch({ delayMs: 50 });
    const d = memDeps({ fertig: 6, fetchFn: f });
    const job = { classId: KLASSE, assignmentId: AID, subId: SUB, modus: 'manuell' };
    const [a, b] = await Promise.allSettled([ka.analysieren(job, d), ka.analysieren(job, d)]);
    const ok = [a, b].filter((x) => x.status === 'fulfilled');
    const no = [a, b].filter((x) => x.status === 'rejected');
    assert.equal(ok.length, 1);
    assert.equal(no.length, 1);
    assert.equal(no[0].reason.code, 'laeuft');
    assert.equal(f.bodies.length, 1);

    // a fresh 'laeuft' blocks the trigger too
    const now = Date.now();
    d.docs.set(ID, { ...d.docs.get(ID), state: 'laeuft', laeuft_seit: new Date(now).toISOString(), gestartet: new Date(now - 20 * MIN).toISOString() });
    assert.equal((await ka.beiDraft(d.drafts[0], d))[0].grund, 'laeuft');
    await assert.rejects(ka.analysieren(job, d), (e) => e.code === 'laeuft');

    // a run older than the TTL counts as crashed
    d.docs.set(ID, { ...d.docs.get(ID), laeuft_seit: new Date(now - ka.LAUF_TTL_MS - 1000).toISOString() });
    assert.equal((await ka.analysieren(job, d)).status, 'fertig');
    assert.equal(f.bodies.length, 2);
});

test('manual: needs 5 completed, and a second click within a minute starts nothing', async () => {
    const f = fakeFetch();
    const d4 = memDeps({ fertig: 4, fetchFn: f });
    const job = { classId: KLASSE, assignmentId: AID, subId: SUB, modus: 'manuell' };
    await assert.rejects(ka.analysieren(job, d4), (e) => e.code === 'zu_wenige');
    const d = memDeps({ fertig: 5, fetchFn: f });
    await ka.analysieren(job, d);
    await assert.rejects(ka.analysieren(job, d), (e) => e.code === 'pause');
    assert.equal(f.bodies.length, 1);
});

test('a failed model call keeps the previous analysis and records the error', async () => {
    let fail = false;
    const ok = fakeFetch();
    const fetchFn = async (url, init) => (fail ? { status: 503, json: async () => ({}) } : ok(url, init));
    let t = Date.now();
    const d = memDeps({ fertig: 5, fetchFn, now: () => t });
    const job = { classId: KLASSE, assignmentId: AID, subId: SUB, modus: 'manuell' };
    await ka.analysieren(job, d);
    const lage = d.docs.get(ID).analyse.lage;
    fail = true; t += 2 * MIN;
    await assert.rejects(ka.analysieren(job, d), (e) => e.code === 'unavailable');
    const doc = d.docs.get(ID);
    assert.equal(doc.state, 'fehler');
    assert.equal(doc.fehler.code, 'unavailable');
    assert.equal(doc.analyse.lage, lage);
});

// ---------------------------------------------------------------- what goes to the model

test('prompt: no name, no uid, no e-mail, no classId, no timestamp, no other card; only completed students', async () => {
    const f = fakeFetch();
    const d = memDeps({ fertig: 7, fetchFn: f });
    await ka.analysieren({ classId: KLASSE, assignmentId: AID, subId: SUB, modus: 'manuell' }, d);
    const sent = JSON.stringify(f.bodies[0].body);
    for (const m of members) {
        assert.ok(!sent.includes(m.uid), `uid ${m.uid}`);
        for (const part of m.name.split(' ')) assert.ok(!sent.includes(part), `name part ${part}`);
    }
    for (const e of EMAILS) assert.ok(!sent.includes(e));
    assert.ok(!sent.includes(KLASSE), 'classId');
    assert.ok(!sent.includes('2026-11-08'), 'timestamp');
    assert.ok(!sent.includes('L-abcdef12'), 'formativ pseudonym');
    assert.ok(!sent.includes('Andere Karte') && !sent.includes('Q-9'), 'other card');
    assert.ok(sent.includes('[Name]'), 'names in answers and hints are masked');
    assert.equal(f.bodies[0].headers['x-goog-api-key'], 'test-key');
    const body = f.bodies[0].body;
    assert.equal(body.generationConfig.temperature, 0.2);
    assert.equal(body.generationConfig.responseMimeType, 'application/json');
    assert.ok(body.generationConfig.responseSchema.properties.rueckmeldung_check);
    const user = body.contents[0].parts[0].text;
    const eingabe = JSON.parse(user.slice(user.indexOf('{')));
    assert.deepEqual(eingabe.klasse, { groesse: 11, begonnen: 11, abgeschlossen: 7 });
    assert.deepEqual(eingabe.lernende.map((l) => l.pseudonym), ['L01', 'L02', 'L03', 'L04', 'L05', 'L06', 'L07']);
    const a = eingabe.lernende[0].antworten[0];
    assert.equal(a.rueckmeldungen, 2);
    assert.deepEqual(a.kriterien[0], { id: 'k1', erste: 'teilweise', letzte: 'erfuellt', hinweis_letzte: 'Gut, [Name].' });
    assert.ok(eingabe.lernende.every((l) => l.antworten.every((x) => x.antwort.length <= ka.MAX_ANTWORT)));
    assert.match(body.systemInstruction.parts[0].text, /Keine Noten/);
    assert.match(body.systemInstruction.parts[0].text, /keine Rangfolgen/);
    assert.match(body.systemInstruction.parts[0].text, /Keine Urteile über Personen/);
});

test('answers are cut to 1500 characters', () => {
    const long = members.map((m) => ({ ...draft(m, 0), answers: [{ questionId: 'Q-1', answer: `<p>${'x'.repeat(3000)}</p>` }, { questionId: 'Q-2', answer: '<p>y</p>' }] }));
    const r = ka.eingabeBauen({ assignment: ASSIGNMENT, subId: SUB, members, drafts: new Map(long.map((x) => [x.uid, x])), usage: new Map() });
    assert.equal(r.eingabe.lernende[0].antworten[0].antwort.length, 1500);
});

test('pseudonyms are shuffled per run and map back to the completed students', () => {
    const drafts = new Map(members.map((m, i) => [m.uid, draft(m, i, i < 6)]));
    let s = 1;
    const seeded = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    const a = ka.eingabeBauen({ assignment: ASSIGNMENT, subId: SUB, members, drafts, usage: new Map(), random: seeded });
    const b = ka.eingabeBauen({ assignment: ASSIGNMENT, subId: SUB, members, drafts, usage: new Map(), random: seeded });
    assert.deepEqual(new Set(a.pseudonyme.values()), new Set(members.slice(0, 6).map((m) => m.uid)));
    assert.notDeepEqual([...a.pseudonyme.values()], [...b.pseudonyme.values()]);
});

// ---------------------------------------------------------------- what comes back

test('result: unknown pseudonyms and invented quotes are dropped, the rest is stored with uids', async () => {
    const f = fakeFetch();
    const d = memDeps({ fertig: 6, fetchFn: f });
    await ka.analysieren({ classId: KLASSE, assignmentId: AID, subId: SUB, modus: 'manuell' }, d);
    const user = f.bodies[0].body.contents[0].parts[0].text;
    const eingabe = JSON.parse(user.slice(user.indexOf('{')));
    const doc = d.docs.get(ID);
    const a = doc.analyse;
    const uids = new Set(members.map((m) => m.uid));
    const stored = JSON.stringify(a);
    assert.ok(!/\bL\d{2}\b/.test(stored), 'no pseudonym is stored');

    const m = a.muster[0];
    assert.equal(m.lernende.length, 2);
    assert.ok(m.lernende.every((u) => uids.has(u)));
    assert.equal(m.belege.length, 1, 'only the verbatim quote stays');
    assert.equal(m.belege[0].zitat, eingabe.lernende[0].antworten[0].antwort.slice(0, 40).trim());
    assert.deepEqual(m.kriterien, ['Q-1/k1']);
    assert.deepEqual(m.fragen, ['Q-1']);
    assert.equal(a.gruppen[0].lernende.length, 2);
    assert.equal(a.einzelne.length, 1);
    assert.equal(a.rueckmeldung_check.length, 1);
    assert.equal(a.rueckmeldung_check[0].problem, 'zu_mild');
    assert.match(a.lage, /\{\{uid:uid-\d{3}-geheim\}\}/, 'a pseudonym in free text becomes a uid marker');
    assert.deepEqual(doc.verworfen, { pseudonyme: 4, zitate: 1, fragen: 1, kriterien: 1 });
});

test('a quote over 120 characters is dropped even if it is verbatim', () => {
    const p = new Map([['L01', 'u1']]);
    const antwort = 'a'.repeat(200);
    const r = ka.ergebnisPruefen({ lage: '', muster: [{ titel: 't', beschreibung: '', kriterien: [], fragen: [], lernende: ['L01'], belege: [{ lernende: 'L01', zitat: antwort.slice(0, 121) }], plenum_impuls: '' }], gruppen: [], einzelne: [], rueckmeldung_check: [], gelungen: [] },
        { pseudonyme: p, antwortenNachPseudonym: new Map([['L01', [antwort]]]), fragen: [] });
    assert.equal(r.analyse.muster[0].belege.length, 0);
    assert.equal(r.verworfen.zitate, 1);
});

test('a quote of another person is dropped (verbatim, but not in that person\'s answer)', () => {
    const p = new Map([['L01', 'u1'], ['L02', 'u2']]);
    const r = ka.ergebnisPruefen({ muster: [{ titel: 't', lernende: [], belege: [{ lernende: 'L02', zitat: 'nur bei L01' }] }] },
        { pseudonyme: p, antwortenNachPseudonym: new Map([['L01', ['steht nur bei L01 so']], ['L02', ['anders']]]), fragen: [] });
    assert.equal(r.analyse.muster[0].belege.length, 0);
});

// ---------------------------------------------------------------- the model call over HTTP

test('geminiAufrufen against the local fake: JSON parsed, tokens and model version kept', async () => {
    const fake = await startFakeGemini({ port: 0 });
    try {
        const d = memDeps({ fertig: 5 });
        const ein = ka.eingabeBauen({ assignment: ASSIGNMENT, subId: SUB, members, drafts: new Map(d.drafts.map((x) => [x.uid, x])), usage: new Map() });
        const r = await ka.geminiAufrufen(ka.promptBauen(ein.eingabe), { apiKey: 'k', model: 'gemini-test', baseUrl: fake.url });
        assert.equal(r.model_version, 'gemini-fake-001');
        assert.equal(r.tokens.eingabe, 1234);
        assert.ok(Array.isArray(r.roh.muster));
        assert.match(fake.calls[0].url, /gemini-test:generateContent$/);
    } finally { await fake.close(); }
});

test('geminiAufrufen: a cut-off answer is unusable, a missing key is not_configured', async () => {
    const cut = async () => ({ status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"lage":' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {} }) });
    await assert.rejects(ka.geminiAufrufen({ system: '', user: '' }, { apiKey: 'k', model: 'm', fetchFn: cut }), (e) => e.code === 'unusable');
    await assert.rejects(ka.geminiAufrufen({ system: '', user: '' }, { apiKey: '', model: 'm' }), (e) => e.code === 'not_configured');
});

// ---------------------------------------------------------------- role check on the callable

test('boxKlassenanalyse: only the teacher claim gets in', async () => {
    process.env.GCLOUD_PROJECT ||= 'demo-lmsbox';
    const { boxKlassenanalyse } = require('../index');
    const data = { classId: KLASSE, assignmentId: AID, subId: SUB };
    await assert.rejects(boxKlassenanalyse.run({ data, auth: null }), (e) => e.code === 'unauthenticated');
    await assert.rejects(boxKlassenanalyse.run({ data, auth: { uid: 's1', token: { email: 'a@lernende.bbw.ch' } } }), (e) => e.code === 'permission-denied');
    await assert.rejects(boxKlassenanalyse.run({ data, auth: { uid: 's1', token: { role: 'student' } } }), (e) => e.code === 'permission-denied');
    // a teacher passes the role check; bad input is the next thing that stops it, before any read
    await assert.rejects(boxKlassenanalyse.run({ data: { assignmentId: AID, subId: SUB }, auth: { uid: 't1', token: { role: 'teacher' } } }), (e) => e.code === 'invalid-argument');
});
