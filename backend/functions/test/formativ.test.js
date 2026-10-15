// Tests for formativ on Firebase.
//
//   unit + store contract (in-memory fake) — no emulator needed:
//     node --test test/formativ.test.js
//   everything, incl. the real firestoreStore, concurrency and the callables (from backend/):
//     node scripts/emu.mjs emulators:exec --config firebase.fn-test.json --project demo-lmsbox
//          --only auth,firestore,functions "node --test functions/test/formativ.test.js"
//
// The emulator parts refuse to run against anything but a local emulator and a demo- project.
// The model is always a local fake (test/fake-model.js or an injected fetchFn).
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../formativ');
const { startFakeModel } = require('./fake-model');

const ASSIGNMENT = {
    assignmentTitle: '9.9 Test',
    subAssignments: {
        'A. Teil': {
            type: 'quill',
            questions: [
                { id: 'q1', text: 'Was ist ein **Vertrag**?', formativ: { rubrik_version: 't1', rubrik: [{ id: 'k1', label: 'Begriff', erwartung: 'Übereinstimmende Willensäusserung.' }] } },
                { id: 'q2', text: 'Ohne Rubrik' },
            ],
            solution: { solutions: [{ id: 'q1', answer: '<p>Eine <b>übereinstimmende</b> Willensäusserung.</p>' }] },
        },
    },
};
const AID = '9.9 Test';
const SLOT = 'A. Teil::q1';

// ---------------------------------------------------------------- stores

function memoryStore() {
    const files = new Map();
    return {
        async read(path) {
            const e = files.get(path);
            return e ? { data: JSON.parse(e.json), generation: e.gen } : { data: null, generation: 0 };
        },
        async write(path, data, generation) {
            const e = files.get(path);
            if ((e ? e.gen : 0) !== generation) { const p = new Error('precondition'); p.code = 'precondition'; throw p; }
            files.set(path, { json: JSON.stringify(data), gen: (e ? e.gen : 0) + 1 });
        },
    };
}

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
const PROJECT = process.env.GCLOUD_PROJECT || '';
const EMULATOR = LOCAL.test(process.env.FIRESTORE_EMULATOR_HOST || '')
    && PROJECT.startsWith('demo-')
    && !process.env.GOOGLE_APPLICATION_CREDENTIALS;
const SKIP = EMULATOR ? false : 'needs the Firestore emulator and a demo- project (see header)';

let admin = null;
function adminDbs() {
    if (!admin) {
        const { initializeApp } = require('firebase-admin/app');
        const { getFirestore } = require('firebase-admin/firestore');
        const app = initializeApp({ projectId: PROJECT }, 'formativ-test');
        admin = { app, roster: getFirestore(app), box: getFirestore(app, 'lmsbox') };
    }
    return admin;
}

const STORES = [
    { name: 'memory', skip: false, make: () => memoryStore() },
    { name: 'firestore', skip: SKIP, make: (fields) => f.firestoreStore(adminDbs().box, fields) },
];

// Every test gets its own student, so nothing has to be cleared between tests.
const RUN = Date.now().toString(36);
let seq = 0;
const newUid = () => `u${RUN}n${seq += 1}`;

// ---------------------------------------------------------------- fakes

function fakeFormativ(reply, delayMs = 0) {
    const calls = [];
    return {
        calls,
        fetchFn: async (url, init) => {
            calls.push({ url, init, body: JSON.parse(init.body) });
            if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
            const r = typeof reply === 'function' ? reply() : reply;
            return { status: r.status, json: async () => r.data };
        },
    };
}

const OK = {
    status: 200,
    data: { zustand: 'vollstaendig', kriterien: [{ id: 'k1', label: 'Begriff', status: 'teilweise', hinweis: 'Nenne beide Seiten.', beleg: null, grund: null }], meta: { request_id: 'r1', prompt_version: 'p-test' } },
};
const DOWN = {
    status: 200,
    data: { zustand: 'nicht_verfuegbar', kriterien: [{ id: 'k1', label: 'Begriff', status: 'nicht_beurteilbar', hinweis: '', beleg: null, grund: 'modell_ausfall' }], meta: {} },
};

function setup(S, reply, delayMs) {
    const uid = newUid();
    const fake = fakeFormativ(reply, delayMs);
    const store = S.make({ uid, assignmentId: AID });
    const req = {
        uid, studentInfo: { name: 'Anna Muster', klasse: 'K1' },
        assignmentId: AID, subId: 'A. Teil', questionId: 'q1',
        text: '<p>Ein Vertrag ist eine Abmachung zwischen zwei Parteien, die beide etwas wollen und sich darauf einigen, sagt Anna.</p>',
    };
    const deps = { store, loadAssignment: async () => ASSIGNMENT, formativ: { url: 'http://x', origin: 'https://o', fetchFn: fake.fetchFn } };
    return { uid, fake, store, req, deps, path: f.usagePath(uid, AID) };
}

const isPrecondition = (e) => e.code === 'precondition';

// ---------------------------------------------------------------- pure functions (carried over)

test('htmlToText keeps paragraphs and decodes entities', () => {
    assert.equal(f.htmlToText('<p>a&nbsp;b</p><p>c &amp; d</p>'), 'a b\nc & d');
});

test('maskOwnName replaces name parts, not substrings of other words', () => {
    const r = f.maskOwnName('Anna schreibt. Die Hannah-Regel. MUSTER sagt', 'Anna Muster');
    assert.equal(r.text, '[Name] schreibt. Die Hannah-Regel. [Name] sagt');
    assert.equal(r.masked, 2);
});

test('same question id in two sub-assignments are separate slots', () => {
    assert.notEqual(f.slotKey('A', 'q1'), f.slotKey('B', 'q1'));
});

test('pseudonym is stable per student and depends on the secret', () => {
    assert.equal(f.pseudonym('k1', 's'), f.pseudonym('k1', 's'));
    assert.notEqual(f.pseudonym('k1', 's'), f.pseudonym('k2', 's'));
    assert.notEqual(f.pseudonym('k1', 's'), f.pseudonym('k1', 't'));
    assert.match(f.pseudonym('k1', 's'), /^L-[0-9a-f]{8}$/);
    assert.equal(f.pseudonym('k1', ''), null);
});

test('autoRubrik: one criterion per question sentence, at most two, abbreviations kept', () => {
    const r = f.autoRubrik('Was sind **Überstunden** (OR 321c)? Wie werden sie abgegolten? Wann verjährt der Anspruch (S. 345)?');
    assert.equal(r.length, 2);
    assert.equal(r[0].label, 'Was sind Überstunden?');
    assert.ok(r[1].erwartung.startsWith('Wie werden sie abgegolten? Wann verjährt der Anspruch (S. 345)?'));
    assert.equal(f.autoRubrik('Erklären Sie den Grundsatz gemäss OR Art. 11. Wann ist eine Form nötig?').length, 2);
    assert.equal(f.autoRubrik('Kurz?').length, 1);
});

test('formativConfig: question beats sub beats assignment; false switches off', () => {
    const q = { id: 'q', text: 'Was ist ein Vertrag?' };
    assert.equal(f.formativConfig({}, {}, q), null);
    assert.equal(f.formativConfig({ formativ: true }, {}, q).rubrik_version, f.AUTO_RUBRIK_VERSION);
    assert.equal(f.formativConfig({}, { formativ: true }, q).rubrik.length, 1);
    assert.equal(f.formativConfig({ formativ: true }, {}, { ...q, formativ: false }), null);
    const own = { rubrik_version: 'x', rubrik: [{ id: 'k1', label: 'l', erwartung: 'e' }] };
    assert.equal(f.formativConfig({ formativ: true }, {}, { ...q, formativ: own }), own);
});

test('usagePath is formativUsage/{uid}__{enc(assignmentId)}', () => {
    assert.equal(f.usagePath('abc', '6.4 Referendum für Müller'), `formativUsage/abc__${encodeURIComponent('6.4 Referendum für Müller')}`);
    assert.equal(f.usagePath('abc', 'a/b').split('/').length, 2);
});

// ---------------------------------------------------------------- per store

for (const S of STORES) {
    test.describe(`store contract [${S.name}]`, { skip: S.skip }, () => {
        const path = () => `formativUsage/${newUid()}__contract`;

        test('absent document reads as { data: null, generation: 0 }', async () => {
            assert.deepEqual(await S.make().read(path()), { data: null, generation: 0 });
        });

        test('create with generation 0, read back; keys with dots, umlauts and :: survive', async () => {
            const store = S.make();
            const p = path();
            const data = { 'A. Grundsätze der Übung::q1': { state: 'pending', at: 'x' }, 'B. Teil (v1.2)::q.2': { state: 'done', result: { kriterien: [] } } };
            await store.write(p, data, 0);
            const back = await store.read(p);
            assert.deepEqual(back.data, data);
            assert.ok(back.generation);
        });

        test('create when the document already exists fails with precondition', async () => {
            const store = S.make();
            const p = path();
            await store.write(p, { a: 1 }, 0);
            await assert.rejects(store.write(p, { a: 2 }, 0), isPrecondition);
            assert.deepEqual((await store.read(p)).data, { a: 1 });
        });

        test('write with the current generation succeeds, with a stale one fails and changes nothing', async () => {
            const store = S.make();
            const p = path();
            await store.write(p, { a: 1 }, 0);
            const first = await store.read(p);
            await store.write(p, { a: 2 }, first.generation);
            await assert.rejects(store.write(p, { a: 3 }, first.generation), isPrecondition);
            const second = await store.read(p);
            assert.deepEqual(second.data, { a: 2 });
            await store.write(p, {}, second.generation);
            assert.deepEqual((await store.read(p)).data, {});
        });

        test('a generation from another document does not open this one', async () => {
            const store = S.make();
            const [p1, p2] = [path(), path()];
            await store.write(p1, { a: 1 }, 0);
            await store.write(p1, { a: 2 }, (await store.read(p1)).generation);
            await store.write(p2, { b: 1 }, 0);
            await assert.rejects(store.write(p2, { b: 2 }, (await store.read(p1)).generation), isPrecondition);
        });

        test('undefined values are dropped, not refused', async () => {
            const store = S.make();
            const p = path();
            await store.write(p, { k: { state: 'done', hinweis: undefined, beleg: null } }, 0);
            assert.deepEqual((await store.read(p)).data, { k: { state: 'done', beleg: null } });
        });

        test('12 parallel creates: exactly one wins', async () => {
            const store = S.make();
            const p = path();
            const r = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => store.write(p, { winner: i }, 0)));
            assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
            assert.ok(r.filter((x) => x.status === 'rejected').every((x) => isPrecondition(x.reason)));
            const winner = r.findIndex((x) => x.status === 'fulfilled');
            assert.deepEqual((await store.read(p)).data, { winner });
        });

        test('12 parallel writes from the same generation: exactly one wins', async () => {
            const store = S.make();
            const p = path();
            await store.write(p, { winner: -1 }, 0);
            const { generation } = await store.read(p);
            const r = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => store.write(p, { winner: i }, generation)));
            assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
            assert.ok(r.filter((x) => x.status === 'rejected').every((x) => isPrecondition(x.reason)));
            const winner = r.findIndex((x) => x.status === 'fulfilled');
            assert.deepEqual((await store.read(p)).data, { winner });
        });
    });

    test.describe(`feedback flow [${S.name}]`, { skip: S.skip }, () => {
        test('happy path: sends no identity, masks the name, stores the result', async () => {
            const { uid, fake, store, req, deps, path } = setup(S, OK);
            const out = await f.requestFeedback(req, deps);
            assert.equal(out.result.kriterien[0].status, 'teilweise');
            const body = fake.calls[0].body;
            const sent = JSON.stringify(body);
            assert.ok(!sent.includes(uid) && !sent.includes('Anna') && !sent.includes('K1'));
            assert.ok(body.antwort.includes('[Name]'));
            assert.equal(body.aufgabe, 'Was ist ein Vertrag?');
            assert.ok(body.kontext.includes('übereinstimmende Willensäusserung'));
            assert.equal(fake.calls[0].init.headers.origin, 'https://o');
            const saved = (await store.read(path)).data;
            assert.equal(saved[SLOT].state, 'done');
            assert.equal(saved[SLOT].prompt_version, 'p-test');
        });

        test('second request for the same field is refused and returns the stored result', async () => {
            const { fake, req, deps } = setup(S, OK);
            await f.requestFeedback(req, deps);
            await assert.rejects(f.requestFeedback(req, deps), (e) => e.code === 'already_used' && e.entry.result.kriterien.length === 1);
            assert.equal(fake.calls.length, 1);
        });

        test('two parallel clicks: exactly one reaches formativ', async () => {
            const { fake, req, deps } = setup(S, OK);
            const results = await Promise.allSettled([f.requestFeedback(req, deps), f.requestFeedback(req, deps)]);
            assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
            assert.equal(fake.calls.length, 1);
        });

        // N parallel requests for the same field, repeated for several students:
        // exactly one model call and exactly one stored result each time.
        test('concurrency: 5 rounds of 20 parallel requests → one model call, one stored result', async () => {
            for (let round = 0; round < 5; round += 1) {
                const { fake, store, req, deps, path } = setup(S, OK, 80);
                const results = await Promise.allSettled(Array.from({ length: 20 }, () => f.requestFeedback(req, deps)));
                const won = results.filter((r) => r.status === 'fulfilled');
                const lost = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
                assert.equal(won.length, 1, `round ${round}: winners`);
                assert.equal(fake.calls.length, 1, `round ${round}: model calls`);
                assert.equal(lost.length, 19);
                for (const e of lost) {
                    assert.ok(e instanceof f.FormativError && ['already_used', 'conflict'].includes(e.code), `round ${round}: ${e.code || e}`);
                }
                const saved = (await store.read(path)).data;
                assert.deepEqual(Object.keys(saved), [SLOT]);
                assert.equal(saved[SLOT].state, 'done');
                assert.deepEqual(saved[SLOT].result, won[0].value.result);
                // and it stays closed afterwards
                await assert.rejects(f.requestFeedback(req, deps), (e) => e.code === 'already_used');
                assert.equal(fake.calls.length, 1);
            }
        });

        test('parallel requests for two different fields of one assignment both get through', async () => {
            const A = JSON.parse(JSON.stringify(ASSIGNMENT));
            A.formativ = true;
            const { fake, store, req, deps, path } = setup(S, OK, 80);
            const d = { ...deps, loadAssignment: async () => A };
            const results = await Promise.allSettled([
                f.requestFeedback(req, d), f.requestFeedback({ ...req, questionId: 'q2' }, d),
            ]);
            assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled']);
            assert.equal(fake.calls.length, 2);
            const saved = (await store.read(path)).data;
            assert.deepEqual(Object.keys(saved).sort(), ['A. Teil::q1', 'A. Teil::q2']);
            assert.ok(Object.values(saved).every((e) => e.state === 'done'));
        });

        test('technical failure gives the attempt back', async () => {
            let n = 0;
            const { fake, req, deps } = setup(S, () => (n++ === 0 ? DOWN : OK));
            await assert.rejects(f.requestFeedback(req, deps), (e) => e.code === 'unavailable');
            const out = await f.requestFeedback(req, deps);
            assert.equal(out.status, 'success');
            assert.equal(fake.calls.length, 2);
        });

        test('HTTP 429 and network errors also give the attempt back', async () => {
            for (const reply of [{ status: 429, data: {} }, { status: 500, data: null }]) {
                const { store, req, deps, path } = setup(S, reply);
                await assert.rejects(f.requestFeedback(req, deps));
                assert.deepEqual((await store.read(path)).data, {});
            }
        });

        test('too short text is refused without using the attempt', async () => {
            const { fake, store, req, deps, path } = setup(S, OK);
            await assert.rejects(f.requestFeedback({ ...req, text: '<p>ja</p>' }, deps), (e) => e.code === 'too_short');
            assert.equal(fake.calls.length, 0);
            assert.equal((await store.read(path)).data, null);
        });

        test('question without rubric is refused', async () => {
            const { req, deps } = setup(S, OK);
            await assert.rejects(f.requestFeedback({ ...req, questionId: 'q2' }, deps), (e) => e.code === 'not_configured');
        });

        test('not logged in is refused', async () => {
            const { req, deps } = setup(S, OK);
            await assert.rejects(f.requestFeedback({ ...req, studentInfo: null }, deps), (e) => e.code === 'unauthenticated');
            await assert.rejects(f.requestFeedback({ ...req, uid: '' }, deps), (e) => e.code === 'unauthenticated');
        });

        test('status lists done and pending slots', async () => {
            const { uid, store, req, deps } = setup(S, OK);
            await f.requestFeedback(req, deps);
            const s = await f.status({ store, uid, assignmentId: AID });
            assert.equal(s[SLOT].state, 'done');
        });

        test('a stale pending reservation (crashed call) is free again', async () => {
            const { store, req, deps, path } = setup(S, OK);
            const old = new Date(Date.now() - 10 * 60 * 1000).toISOString();
            await store.write(path, { [SLOT]: { state: 'pending', at: old } }, 0);
            const out = await f.requestFeedback(req, deps);
            assert.equal(out.status, 'success');
        });

        test('a fresh pending reservation blocks a second call', async () => {
            const { fake, store, req, deps, path } = setup(S, OK);
            await store.write(path, { [SLOT]: { state: 'pending', at: new Date().toISOString() } }, 0);
            await assert.rejects(f.requestFeedback(req, deps), (e) => e.code === 'already_used');
            assert.equal(fake.calls.length, 0);
        });

        test('pseudonym is stored; name in text replaced by pseudonym when configured', async () => {
            const { uid, fake, store, req, deps, path } = setup(S, OK);
            await f.requestFeedback(req, { ...deps, pseudonymSecret: 'geheim', nameReplacement: 'pseudonym' });
            const p = f.pseudonym(uid, 'geheim');
            assert.ok(fake.calls[0].body.antwort.includes(p));
            assert.ok(!JSON.stringify(fake.calls[0].body).includes(uid));
            assert.equal((await store.read(path)).data[SLOT].pseudonym, p);
        });

        test('assignment-wide switch: request carries the auto rubric and the model answer as context', async () => {
            const A = JSON.parse(JSON.stringify(ASSIGNMENT));
            A.formativ = true;
            const { fake, req, deps } = setup(S, OK);
            await f.requestFeedback({ ...req, questionId: 'q2' }, { ...deps, loadAssignment: async () => A });
            const body = fake.calls[0].body;
            assert.equal(body.rubrik_version, f.AUTO_RUBRIK_VERSION);
            assert.equal(body.rubrik[0].label, 'Ohne Rubrik');
            assert.equal(f.autoRubrik('Wer ist in der Schweiz grundsätzlich steuerpflichtig und welche Voraussetzungen gelten?')[0].label, 'Wer ist in der Schweiz grundsätzlich …');
        });

        test('the text sent to the model is stored and only the teacher view returns it', async () => {
            const { uid, store, req, deps } = setup(S, OK);
            await f.requestFeedback(req, deps);
            const teacher = await f.statusTeacher({ store, uid, assignmentId: AID });
            const slot = teacher[SLOT];
            assert.ok(slot.gesendet.includes('Ein Vertrag ist eine Abmachung'));
            assert.ok(slot.gesendet.includes('[Name]') && !slot.gesendet.includes('Anna'));
            assert.equal(slot.prompt_version, 'p-test');
            const student = await f.status({ store, uid, assignmentId: AID });
            assert.equal(student[SLOT].gesendet, undefined);
        });
    });
}

// ---------------------------------------------------------------- Firestore document shape

test.describe('formativUsage document [firestore]', { skip: SKIP }, () => {
    test('carries uid and assignmentId next to the slots map, and nothing else', async () => {
        const { uid, req, deps, path } = setup(STORES[1], OK);
        await f.requestFeedback(req, { ...deps, pseudonymSecret: 's' });
        const snap = await adminDbs().box.doc(path).get();
        assert.equal(snap.id, `${uid}__${encodeURIComponent(AID)}`);
        const doc = snap.data();
        assert.deepEqual(Object.keys(doc).sort(), ['assignmentId', 'slots', 'uid']);
        assert.equal(doc.uid, uid);
        assert.equal(doc.assignmentId, AID);
        assert.deepEqual(Object.keys(doc.slots[SLOT]).sort(), [
            'at', 'duration_ms', 'gesendet', 'names_masked', 'prompt_version', 'pseudonym',
            'request_id', 'result', 'rubrik_version', 'state', 'textHash',
        ]);
    });
});

// ---------------------------------------------------------------- callables

async function emulators() {
    const res = await fetch(`http://${process.env.FIREBASE_EMULATOR_HUB}/emulators`);
    return res.json();
}

test.describe('callables, in process (index.js with FORMATIV_URL unset)', { skip: SKIP }, () => {
    test('unconfigured service → unavailable with details.code not_configured, after the caller check', async () => {
        const saved = process.env.FORMATIV_URL;
        process.env.FORMATIV_URL = '';
        process.env.FORMATIV_PSEUDONYM_SECRET ??= 'unit';
        try {
            const index = require('../index');
            const uid = newUid();
            await adminDbs().roster.doc(`students/${uid}`).set({ name: 'Anna Beispiel', active: true });
            const data = { assignmentId: AID, subId: 'A. Teil', questionId: 'q1', text: 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn' };
            await assert.rejects(index.boxFormativ.run({ auth: { uid }, data }),
                (e) => e.code === 'unavailable' && e.details.code === 'not_configured');
            await assert.rejects(index.boxFormativ.run({ auth: { uid: newUid() }, data }),
                (e) => e.code === 'permission-denied' && e.details.code === 'forbidden');
            await assert.rejects(index.boxFormativ.run({ data }),
                (e) => e.code === 'unauthenticated' && e.details.code === 'unauthenticated');
        } finally {
            if (saved === undefined) delete process.env.FORMATIV_URL; else process.env.FORMATIV_URL = saved;
        }
    });
});

test.describe('callables, in process: malformed ids are bad_request, not internal', { skip: SKIP }, () => {
    test('boxFormativ and boxFormativStatus refuse empty, over-long and path-like ids', async () => {
        const saved = process.env.FORMATIV_URL;
        process.env.FORMATIV_URL = 'http://127.0.0.1:1';      // never reached: validation comes first
        process.env.FORMATIV_PSEUDONYM_SECRET ??= 'unit';
        try {
            const index = require('../index');
            const uid = newUid();
            await adminDbs().roster.doc(`students/${uid}`).set({ name: 'Anna Beispiel', active: true });
            const ok = { assignmentId: AID, subId: 'A. Teil', questionId: 'q1', text: 'eins zwei drei vier fünf sechs sieben acht neun zehn elf zwölf dreizehn vierzehn fünfzehn sechzehn' };
            const bad = (e) => e.code === 'invalid-argument' && e.details.code === 'bad_request';
            const long = 'x'.repeat(501);
            const cases = [
                { assignmentId: '' }, { subId: '' }, { questionId: '' },
                { assignmentId: long }, { subId: long }, { questionId: long },
                { assignmentId: '.' }, { assignmentId: '..' }, { assignmentId: 'a/b' }, { assignmentId: '/' },
                { assignmentId: 5 }, { subId: {} }, { questionId: ['q1'] },
            ];
            for (const c of cases) {
                await assert.rejects(index.boxFormativ.run({ auth: { uid }, data: { ...ok, ...c } }), bad, JSON.stringify(c).slice(0, 60));
            }
            // exactly 500 characters, and "/" in subId / questionId (map keys, not paths), are not this check's business
            await assert.rejects(index.boxFormativ.run({ auth: { uid }, data: { ...ok, assignmentId: 'y'.repeat(500) } }),
                (e) => e.details?.code !== 'bad_request' || !/leer oder länger|ungültig/.test(e.message));
            await assert.rejects(index.boxFormativ.run({ auth: { uid }, data: { ...ok, subId: 'A/B', questionId: 'q/1' } }),
                (e) => !/leer oder länger|ungültig/.test(e.message));
            // status
            for (const assignmentId of ['', long, '.', '..', 'a/b', 5, undefined]) {
                await assert.rejects(index.boxFormativStatus.run({ auth: { uid }, data: { assignmentId } }), bad, String(assignmentId).slice(0, 10));
            }
            await assert.doesNotReject(index.boxFormativStatus.run({ auth: { uid }, data: { assignmentId: AID } }));
        } finally {
            if (saved === undefined) delete process.env.FORMATIV_URL; else process.env.FORMATIV_URL = saved;
        }
    });
});

test.describe('callables through the functions emulator', { skip: SKIP || (process.env.FIREBASE_EMULATOR_HUB ? false : 'no emulator hub') }, () => {
    const IAID = '0.1 Testauftrag Müller';
    const SUB = 'A. Grundsätze der Übung';
    const TEXT = '<p>Anna Beispiel meint: Wir testen hier, ob eine Rückmeldung genau einmal kommt, auch wenn man mehrmals klickt.</p>';
    let model; let fnBase; let authBase;

    async function signUp(label) {
        const res = await fetch(`${authBase}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: `${label}.${RUN}@example.test`, password: `pw-${RUN}-${label}`, returnSecureToken: true }),
        });
        const json = await res.json();
        assert.ok(json.idToken, JSON.stringify(json));
        return { uid: json.localId, token: json.idToken };
    }

    async function call(name, data, token) {
        const headers = { 'content-type': 'application/json' };
        if (token) headers.authorization = `Bearer ${token}`;
        const res = await fetch(`${fnBase}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
        return { http: res.status, ...(await res.json()) };
    }

    const callsFor = (questionId) => model.calls.filter((c) => c.body.feld_id.endsWith(`:${questionId}`));

    test.before(async () => {
        const emu = await emulators();
        assert.ok(emu.functions && emu.auth, 'functions and auth emulators must run');
        fnBase = `http://${emu.functions.host}:${emu.functions.port}/${PROJECT}/europe-west6`;
        authBase = `http://${emu.auth.host}:${emu.auth.port}`;
        model = await startFakeModel({ port: 5139, delayMs: 150 });
        await adminDbs().box.doc(`assignments/${encodeURIComponent(IAID)}`).set({
            assignmentId: IAID,
            assignmentTitle: 'Testauftrag (Emulator)',
            formativ: true,
            subAssignments: {
                [SUB]: {
                    type: 'quill',
                    questions: [
                        { id: 'q1', text: 'Beschreiben Sie in zwei Sätzen, was Sie hier testen.' },
                        { id: 'q2', text: 'Nennen Sie einen Grund für regelmässiges Speichern.' },
                    ],
                    solution: { solutions: [{ id: 'q1', answer: '<p>Freie Antwort.</p>' }] },
                },
            },
        });
    });

    test.after(async () => { await model?.close(); });

    test('student on the roster: feedback once, then refused with the stored result', async () => {
        const anna = await signUp('anna');
        await adminDbs().roster.doc(`students/${anna.uid}`).set({ name: 'Anna Beispiel', username: 'anna.beispiel', classId: 'TestA', active: true });
        const data = { assignmentId: IAID, subId: SUB, questionId: 'q1', text: TEXT };

        const first = await call('boxFormativ', data, anna.token);
        assert.equal(first.http, 200, JSON.stringify(first));
        assert.equal(first.result.status, 'success');
        assert.equal(first.result.result.zustand, 'vollstaendig');
        assert.deepEqual(Object.keys(first.result.result.kriterien[0]).sort(), ['beleg', 'grund', 'hinweis', 'id', 'label', 'status']);

        // what reached the model: no name, no uid, no email; configured origin
        assert.equal(callsFor('q1').length, 1);
        const { body, headers } = callsFor('q1')[0];
        const sent = JSON.stringify(body);
        assert.ok(!sent.includes(anna.uid) && !/Anna|Beispiel|example\.test/.test(sent), sent);
        assert.ok(body.antwort.startsWith('[Name] [Name] meint'));
        assert.equal(headers.origin, 'http://localhost');
        assert.equal(headers.authorization, undefined);

        // stored document
        const doc = (await adminDbs().box.doc(`formativUsage/${anna.uid}__${encodeURIComponent(IAID)}`).get()).data();
        assert.equal(doc.uid, anna.uid);
        assert.equal(doc.assignmentId, IAID);
        const slot = doc.slots[f.slotKey(SUB, 'q1')];
        assert.equal(slot.state, 'done');
        assert.equal(slot.names_masked, 2);
        assert.equal(slot.pseudonym, f.pseudonym(anna.uid, 'emulator-only-dummy'));
        assert.deepEqual(slot.result, first.result.result);

        // second request
        const second = await call('boxFormativ', { ...data, text: `${TEXT}<p>Noch ein Satz dazu.</p>` }, anna.token);
        assert.equal(second.http, 409, JSON.stringify(second));
        assert.equal(second.error.status, 'ALREADY_EXISTS');
        assert.equal(second.error.details.code, 'already_used');
        assert.deepEqual(second.error.details.result, first.result.result);
        assert.equal(callsFor('q1').length, 1);

        // status: public part only
        const status = await call('boxFormativStatus', { assignmentId: IAID }, anna.token);
        assert.equal(status.http, 200, JSON.stringify(status));
        assert.deepEqual(Object.keys(status.result), ['slots']);
        const st = status.result.slots[f.slotKey(SUB, 'q1')];
        assert.deepEqual(Object.keys(st).sort(), ['at', 'result', 'state']);
        assert.deepEqual(st.result, first.result.result);

        // errors keep their code
        const short = await call('boxFormativ', { ...data, questionId: 'q2', text: 'zu kurz' }, anna.token);
        assert.equal(short.error.status, 'INVALID_ARGUMENT');
        assert.equal(short.error.details.code, 'too_short');
        const missing = await call('boxFormativ', { ...data, assignmentId: 'gibt es nicht' }, anna.token);
        assert.equal(missing.error.status, 'NOT_FOUND');
        assert.equal(missing.error.details.code, 'not_found');
    });

    test('8 parallel calls for one field: one success, one model call, seven refused', async () => {
        const ben = await signUp('ben');
        await adminDbs().roster.doc(`students/${ben.uid}`).set({ name: 'Ben Muster', active: true });
        const data = { assignmentId: IAID, subId: SUB, questionId: 'q2', text: 'Damit bei einem Absturz des Rechners nichts von meiner Arbeit verloren geht, speichere ich sehr oft.' };
        const before = callsFor('q2').length;
        const results = await Promise.all(Array.from({ length: 8 }, () => call('boxFormativ', data, ben.token)));
        assert.equal(results.filter((r) => r.http === 200).length, 1, JSON.stringify(results.map((r) => r.http)));
        for (const r of results.filter((x) => x.http !== 200)) {
            assert.ok(['already_used', 'conflict'].includes(r.error.details?.code), JSON.stringify(r));
        }
        assert.equal(callsFor('q2').length - before, 1);
        const doc = (await adminDbs().box.doc(`formativUsage/${ben.uid}__${encodeURIComponent(IAID)}`).get()).data();
        assert.deepEqual(Object.keys(doc.slots), [f.slotKey(SUB, 'q2')]);
        assert.equal(doc.slots[f.slotKey(SUB, 'q2')].state, 'done');
    });

    test('signed in without roster doc, inactive, and unauthenticated are refused; no model call, nothing stored', async () => {
        const data = { assignmentId: IAID, subId: SUB, questionId: 'q1', text: TEXT };
        const before = model.calls.length;

        const stranger = await signUp('stranger');
        for (const name of ['boxFormativ', 'boxFormativStatus']) {
            const r = await call(name, data, stranger.token);
            assert.equal(r.http, 403, JSON.stringify(r));
            assert.equal(r.error.status, 'PERMISSION_DENIED');
            assert.equal(r.error.details.code, 'forbidden');
        }

        const gone = await signUp('inactive');
        await adminDbs().roster.doc(`students/${gone.uid}`).set({ name: 'Cleo Probe', active: false });
        const inactive = await call('boxFormativ', data, gone.token);
        assert.equal(inactive.error.status, 'PERMISSION_DENIED');

        for (const name of ['boxFormativ', 'boxFormativStatus']) {
            const r = await call(name, data, null);
            assert.equal(r.http, 401, JSON.stringify(r));
            assert.equal(r.error.status, 'UNAUTHENTICATED');
            assert.equal(r.error.details.code, 'unauthenticated');
        }

        assert.equal(model.calls.length, before);
        for (const uid of [stranger.uid, gone.uid]) {
            assert.equal((await adminDbs().box.doc(`formativUsage/${uid}__${encodeURIComponent(IAID)}`).get()).exists, false);
        }
    });
});

test.after(async () => {
    if (admin) await require('firebase-admin/app').deleteApp(admin.app);
});
