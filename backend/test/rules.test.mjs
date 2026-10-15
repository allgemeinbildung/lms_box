// Rules tests for the named database `lmsbox`.
// Run: npm run test:rules   (= firebase emulators:exec ... "node --test test/rules.test.mjs")
//
// The rules under test are the ones the EMULATOR loaded from firebase.json.
// This file never uploads rules itself - that is the point: it tests the
// config that would be deployed, on the database id that will be used.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, getDocs, query, where, serverTimestamp, terminate,
} from 'firebase/firestore';
import { initializeApp as adminInit, deleteApp as adminDelete } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
    console.error('FIRESTORE_EMULATOR_HOST is not set. Run through: npm run test:rules');
    process.exit(1);
}
const [HOST, PORT] = emulatorHost.split(':');
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-lmsbox';
const DB = 'lmsbox';

const enc = encodeURIComponent;
const ASSIGNMENT = '6.4 Referendum und Initiative';
const SUB = 'A. Grundsätze der Volksrechte – Übersicht';   // dots, umlauts, en dash
const draftId = (uid, a = ASSIGNMENT, s = SUB) => `${uid}__${enc(a)}__${enc(s)}`;
const pairId = (uid, a = ASSIGNMENT) => `${uid}__${enc(a)}`;

const apps = [];
/** A client Firestore handle for database `dbId`, signed in as `token` (or nobody). */
function client(token, dbId = DB) {
    const app = initializeApp({ projectId: PROJECT }, `c${apps.length}`);
    apps.push(app);
    const db = getFirestore(app, dbId);
    connectFirestoreEmulator(db, HOST, Number(PORT), token ? { mockUserToken: token } : undefined);
    return db;
}

/** An ID-token payload as Auth issues it: provider and email are part of what the rules check. */
const tok = (sub, { provider = 'password', email = `${sub}.test@lernende.bbw.ch`, ...rest } = {}) => ({
    sub, ...(email ? { email } : {}), firebase: { sign_in_provider: provider, identities: {} }, ...rest,
});

let adminApp, admin;
let anon, alice, bob, teacher, anonSession, outsider;

const draft = (uid, extra = {}) => ({
    uid,
    classId: 'TestA',
    assignmentId: ASSIGNMENT,
    subId: SUB,
    title: 'Grundsätze',
    type: 'quill',
    questions: [{ id: 'q1', text: 'Was ist ein Referendum?' }],
    answers: [{ questionId: 'q1', answer: '<p>Eine Antwort mit Ümläuten.</p>' }],
    updatedAt: serverTimestamp(),
    ...extra,
});

before(async () => {
    adminApp = adminInit({ projectId: PROJECT }, 'admin');
    admin = adminFirestore(adminApp, DB);
    anon = client(null);
    alice = client(tok('alice'));
    bob = client(tok('bob'));
    teacher = client(tok('teacher1', { role: 'teacher' }));
    anonSession = client(tok('anon1', { provider: 'anonymous', email: null }));      // anonymous sign-in is enabled on the shared project
    outsider = client(tok('outsider', { email: 'jemand@example.com' }));            // self-sign-up with a non-school address

    // Fixtures written past the rules.
    const now = new Date();
    await admin.doc(`drafts/${draftId('bob')}`).set({ ...draft('bob'), updatedAt: now });
    await admin.doc(`feedback/${pairId('alice')}`).set({ uid: 'alice', assignmentId: ASSIGNMENT, results: [], released: false });
    await admin.doc(`feedbackReleased/${pairId('alice')}`).set({ uid: 'alice', assignmentId: ASSIGNMENT, results: [] });
    await admin.doc(`feedbackReleased/${pairId('bob')}`).set({ uid: 'bob', assignmentId: ASSIGNMENT, results: [] });
    await admin.doc(`formativUsage/${pairId('alice')}`).set({ uid: 'alice', assignmentId: ASSIGNMENT });
    await admin.doc(`assignments/${enc(ASSIGNMENT)}`).set({ assignmentId: ASSIGNMENT, assignmentTitle: 'Test' });
    await admin.doc('somethingElse/x').set({ a: 1 });
    // The roster lives in `(default)`. Fictional entries.
    const roster = adminFirestore(adminApp);
    for (const uid of ['alice', 'bob']) {
        await roster.doc(`students/${uid}`).set({ name: `Test ${uid}`, username: `${uid}.test`, classId: 'TestA', mustSetPassword: false, active: true });
    }
});

after(async () => {
    await Promise.all(apps.map(async (a) => { await terminate(getFirestore(a, DB)).catch(() => {}); await deleteApp(a); }));
    await adminDelete(adminApp);
});

// ---- the emulator really enforces these rules on `lmsbox` -------------------

test('emulator enforces the lmsbox rules on the named database (not open, not deny-all)', async () => {
    // Not open: the very same document is refused without a login ...
    await assertFails(getDoc(doc(anon, 'assignments', enc(ASSIGNMENT))));
    // ... not deny-all: and served with one.
    const snap = await assertSucceeds(getDoc(doc(alice, 'assignments', enc(ASSIGNMENT))));
    assert.equal(snap.data().assignmentId, ASSIGNMENT);
    // And it is this rules file, not some other: a path it does not name is refused even for a teacher.
    await assertFails(getDoc(doc(teacher, 'somethingElse', 'x')));
    // The admin fixture is really in `lmsbox`: the same path in `(default)` is empty.
    const other = adminFirestore(adminApp);
    assert.equal((await other.doc(`assignments/${enc(ASSIGNMENT)}`).get()).exists, false);
});

// ---- unauthenticated ---------------------------------------------------------

test('unauthenticated reads nothing and writes nothing', async () => {
    for (const path of [
        `assignments/${enc(ASSIGNMENT)}`, `drafts/${draftId('bob')}`, `feedback/${pairId('alice')}`,
        `feedbackReleased/${pairId('alice')}`, `formativUsage/${pairId('alice')}`,
    ]) {
        await assertFails(getDoc(doc(anon, path)));
    }
    for (const col of ['assignments', 'drafts', 'feedback', 'feedbackReleased', 'formativUsage']) {
        await assertFails(getDocs(collection(anon, col)));
    }
    await assertFails(setDoc(doc(anon, 'drafts', draftId('anon')), draft('anon')));
});

// ---- drafts: own -------------------------------------------------------------

test('student creates, reads, updates and lists own draft', async () => {
    const ref = doc(alice, 'drafts', draftId('alice'));
    await assertSucceeds(getDoc(doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'noch nicht da'))));   // missing own doc: no error
    await assertSucceeds(setDoc(ref, draft('alice')));
    await assertSucceeds(setDoc(ref, draft('alice', { answers: [{ questionId: 'q1', answer: '<p>neu</p>' }] })));
    const snap = await assertSucceeds(getDoc(ref));
    assert.equal(snap.data().answers[0].answer, '<p>neu</p>');
    const list = await assertSucceeds(getDocs(query(collection(alice, 'drafts'),
        where('uid', '==', 'alice'), where('assignmentId', '==', ASSIGNMENT))));
    assert.equal(list.size, 1);
});

test('draft with dots and umlauts in the sub-assignment key round-trips', async () => {
    const sub = 'B. Müller & Söhne: 1.2.3 «Übung» ‒ ß/ä?';
    const id = draftId('alice', '1.1 Schule und Betrieb', sub);
    const ref = doc(alice, 'drafts', id);
    const data = draft('alice', { assignmentId: '1.1 Schule und Betrieb', subId: sub });
    await assertSucceeds(setDoc(ref, data));
    const snap = await getDoc(ref);
    assert.equal(snap.id, id);
    assert.equal(snap.data().subId, sub);
    assert.equal(decodeURIComponent(snap.id.split('__')[2]), sub);
    const { updatedAt, ...rest } = snap.data();
    const { updatedAt: _, ...sent } = data;
    assert.deepEqual(rest, sent);
    assert.ok(updatedAt.toMillis() > 0);
    // the teacher finds it by the verbatim subId
    const found = await getDocs(query(collection(teacher, 'drafts'), where('subId', '==', sub)));
    assert.equal(found.size, 1);
});

test('assignment with dotted, umlauted sub-assignment keys round-trips as a whole map', async () => {
    const id = '9.9 Prüfung «Größe»';
    const content = {
        assignmentId: id,
        assignmentTitle: 'Prüfung',
        formativ: true,
        solution_keys: ['abc'],
        subAssignments: {
            'A. Grundsätze … 1.2': { type: 'quill', questions: [{ id: 'q1', text: 'Ä?' }], solution: { 'q1': 'x.y' } },
            'B. Zweiter Teil.': { type: 'quill', questions: [] },
        },
    };
    await assertSucceeds(setDoc(doc(teacher, 'assignments', enc(id)), content));
    const snap = await assertSucceeds(getDoc(doc(alice, 'assignments', enc(id))));
    assert.deepEqual(snap.data(), content);
    assert.deepEqual(Object.keys(snap.data().subAssignments).sort(), ['A. Grundsätze … 1.2', 'B. Zweiter Teil.']);
});

// ---- drafts: foreign ---------------------------------------------------------

test('student A cannot read B\'s draft (by id, by query, by listing everything)', async () => {
    await assertFails(getDoc(doc(alice, 'drafts', draftId('bob'))));
    await assertFails(getDocs(query(collection(alice, 'drafts'), where('uid', '==', 'bob'))));
    await assertFails(getDocs(query(collection(alice, 'drafts'), where('classId', '==', 'TestA'))));
    await assertFails(getDocs(collection(alice, 'drafts')));
});

test('student A cannot write B\'s draft: foreign id, forged uid field, either way round', async () => {
    // foreign id, honest uid
    await assertFails(setDoc(doc(alice, 'drafts', draftId('bob')), draft('alice')));
    // foreign id, forged uid (would overwrite Bob's document)
    await assertFails(setDoc(doc(alice, 'drafts', draftId('bob')), draft('bob')));
    // own id, forged uid (would show up in Bob's query)
    await assertFails(setDoc(doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'forged')), draft('bob', { subId: 'forged' })));
    // a new document under Bob's prefix
    await assertFails(setDoc(doc(alice, 'drafts', draftId('bob', ASSIGNMENT, 'neu')), draft('bob', { subId: 'neu' })));
    // id that merely contains the own uid
    await assertFails(setDoc(doc(alice, 'drafts', `x__alice__${enc(ASSIGNMENT)}`), draft('alice')));
    await assertFails(setDoc(doc(alice, 'drafts', 'alice'), draft('alice')));
    await assertFails(updateDoc(doc(alice, 'drafts', draftId('bob')), { title: 'x' }));
    // Bob's document is untouched
    const snap = await admin.doc(`drafts/${draftId('bob')}`).get();
    assert.equal(snap.data().uid, 'bob');
    assert.equal(snap.data().title, 'Grundsätze');
});

test('uid prefix collision: user "ali" cannot reach documents of "ali__ce"', async () => {
    await admin.doc('drafts/ali__ce__a__b').set({ ...draft('ali__ce'), updatedAt: new Date() });
    const ali = client(tok('ali'));
    await assertFails(getDoc(doc(ali, 'drafts', 'ali__ce__a__b')));
    await assertFails(setDoc(doc(ali, 'drafts', 'ali__ce__a__b'), draft('ali')));
});

test('student cannot delete a draft, not even the own one', async () => {
    await assertFails(deleteDoc(doc(alice, 'drafts', draftId('alice'))));
    await assertFails(deleteDoc(doc(alice, 'drafts', draftId('bob'))));
});

test('student cannot move a draft to another assignment or sub-assignment', async () => {
    const ref = doc(alice, 'drafts', draftId('alice'));
    await assertFails(setDoc(ref, draft('alice', { subId: 'anderes' })));
    await assertFails(setDoc(ref, draft('alice', { assignmentId: 'anderes' })));
});

// ---- drafts: validation ------------------------------------------------------

test('draft validation: unknown keys, wrong types, missing fields are refused', async () => {
    const ref = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'val'));
    const d = (extra) => draft('alice', { subId: 'val', ...extra });
    await assertSucceeds(setDoc(ref, d({})));
    await assertFails(setDoc(ref, d({ name: 'Alice Beispiel' })));            // drafts carry no name
    await assertFails(setDoc(ref, d({ released: true })));
    await assertFails(setDoc(ref, d({ answers: 'text' })));
    await assertFails(setDoc(ref, d({ answers: { 0: { questionId: 'q1', answer: 'x' } } })));
    await assertFails(setDoc(ref, d({ answers: [{ questionId: 'q1', answer: 5 }] })));
    await assertFails(setDoc(ref, d({ answers: [{ questionId: 'q1', answer: ['x'] }] })));
    await assertFails(setDoc(ref, d({ answers: [{ questionId: 'q1', answer: 'x', extra: 1 }] })));
    await assertFails(setDoc(ref, d({ answers: [{ answer: 'x' }] })));
    await assertFails(setDoc(ref, d({ answers: ['x'] })));
    await assertFails(setDoc(ref, d({ questions: 'x' })));
    await assertFails(setDoc(ref, d({ questions: [{ id: 'q1', text: 'x', blob: 'y' }] })));
    await assertFails(setDoc(ref, d({ updatedAt: 'gestern' })));
    await assertFails(setDoc(ref, d({ classId: 7 })));
    await assertFails(setDoc(ref, d({ title: 7 })));
    await assertFails(setDoc(ref, d({ subId: '' })));
    const { answers, ...noAnswers } = d({});
    await assertFails(setDoc(ref, noAnswers));
    const { updatedAt, ...noTime } = d({});
    await assertFails(setDoc(ref, noTime));
    // title, type and questions are optional; answers may be empty
    const { title, type, questions, ...minimal } = d({ answers: [] });
    await assertSucceeds(setDoc(ref, minimal));
});

test('draft size guard: 200 000 answer characters pass, more is refused, also split over answers', async () => {
    const ref = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'gross'));
    const d = (extra) => draft('alice', { subId: 'gross', ...extra });
    const a = (n, id = 'q1') => ({ questionId: id, answer: 'ä'.repeat(n) });
    await assertSucceeds(setDoc(ref, d({ answers: [a(200000)] })));
    await assertFails(setDoc(ref, d({ answers: [a(200001)] })));
    await assertFails(setDoc(ref, d({ answers: [a(100000, 'q1'), a(100001, 'q2')] })));
    await assertFails(setDoc(ref, d({ answers: Array.from({ length: 7 }, (_, i) => a(1, `q${i}`)) })));
    await assertFails(setDoc(ref, d({ questions: Array.from({ length: 7 }, (_, i) => ({ id: `q${i}`, text: 'x' })) })));
    await assertFails(setDoc(ref, d({ questions: [{ id: 'q1', text: 'x'.repeat(4001) }] })));
    await assertFails(setDoc(ref, d({ answers: [{ questionId: 'q'.repeat(201), answer: 'x' }] })));
    await assertFails(setDoc(ref, d({ title: 'x'.repeat(501) })));
});

test('draft size guard: the largest draft the rules allow fits the rule engine and one document', async () => {
    // Everything at its cap, as an UPDATE (the most expensive evaluation): must stay
    // inside the limit of 1000 rule expressions and inside 1 MiB.
    const sub = 's'.repeat(40);
    const ref = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, sub));
    const full = (ch) => draft('alice', {
        subId: sub,
        classId: ch.repeat(100),
        title: ch.repeat(500),
        type: ch.repeat(50),
        questions: Array.from({ length: 6 }, (_, i) => ({ id: `${i}`.padEnd(200, ch), text: ch.repeat(4000) })),
        answers: Array.from({ length: 6 }, (_, i) => ({
            questionId: `${i}`.padEnd(200, ch),
            answer: ch.repeat(i === 0 ? 200000 - 5 * 33333 : 33333),
        })),
    });
    await assertSucceeds(setDoc(ref, full('a')));
    await assertSucceeds(setDoc(ref, full('ä')));          // 2 bytes per character
    await assertSucceeds(setDoc(ref, full('€')));          // 3 bytes per character: about 690 KB
    const snap = await getDoc(ref);
    assert.equal(snap.data().answers.reduce((n, x) => n + x.answer.length, 0), 200000);
});

// ---- anonymous sessions and non-school accounts --------------------------------
// The project is shared with another app; anonymous sign-in and email/password
// self-sign-up are on, so "signed in" proves nothing about being a student.
// Decision: an anonymous session reads and writes nothing. A password account with a
// non-school address cannot write a draft but CAN read assignments (and its own, empty,
// drafts / feedbackReleased): the read paths exclude only anonymous sessions.

test('anonymous session reads nothing and writes nothing', async () => {
    for (const path of [
        `assignments/${enc(ASSIGNMENT)}`, `drafts/${draftId('anon1')}`, `drafts/${draftId('bob')}`,
        `feedbackReleased/${pairId('anon1')}`, `feedbackReleased/${pairId('alice')}`,
        `feedback/${pairId('alice')}`, `formativUsage/${pairId('alice')}`,
    ]) {
        await assertFails(getDoc(doc(anonSession, path)));
    }
    await assertFails(getDocs(collection(anonSession, 'assignments')));
    await assertFails(getDocs(query(collection(anonSession, 'drafts'), where('uid', '==', 'anon1'))));
    await assertFails(getDocs(query(collection(anonSession, 'feedbackReleased'), where('uid', '==', 'anon1'))));
    await assertFails(setDoc(doc(anonSession, 'drafts', draftId('anon1')), draft('anon1')));
    await assertFails(setDoc(doc(anonSession, 'assignments', 'x'), { assignmentId: 'x' }));
    await assertFails(setDoc(doc(anonSession, 'feedbackReleased', pairId('anon1')), { uid: 'anon1' }));
});

test('password account with a non-school address: no draft, but may read assignments (by decision)', async () => {
    await assertFails(setDoc(doc(outsider, 'drafts', draftId('outsider')), draft('outsider')));
    await assertSucceeds(getDoc(doc(outsider, 'assignments', enc(ASSIGNMENT))));
    await assertSucceeds(getDocs(query(collection(outsider, 'drafts'), where('uid', '==', 'outsider'))));
    await assertFails(getDocs(query(collection(outsider, 'drafts'), where('uid', '==', 'bob'))));
    await assertFails(setDoc(doc(outsider, 'assignments', 'x'), { assignmentId: 'x' }));
    // an existing draft cannot be updated either (fixture written past the rules)
    const id = draftId('outsider', ASSIGNMENT, 'alt');
    await admin.doc(`drafts/${id}`).set({ ...draft('outsider'), subId: 'alt', updatedAt: new Date() });
    await assertFails(setDoc(doc(outsider, 'drafts', id), draft('outsider', { subId: 'alt' })));
});

test('look-alike addresses and other providers do not pass as school accounts', async () => {
    const cases = {
        'longer domain':   tok('x1', { email: 'a@lernende.bbw.ch.evil.example' }),
        'sub-domain':      tok('x2', { email: 'a@mail.lernende.bbw.ch' }),
        'dot not literal': tok('x3', { email: 'a@lernendeXbbw.ch' }),
        'no email':        tok('x4', { email: null }),
        'google provider': tok('x5', { provider: 'google.com' }),
        'custom token':    tok('x6', { provider: 'custom' }),
    };
    for (const [name, t] of Object.entries(cases)) {
        await assertFails(setDoc(doc(client(t), 'drafts', draftId(t.sub)), draft(t.sub)), name);
    }
});

test('school-address password account can create, update and read a draft', async () => {
    const ref = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'schule'));
    await assertSucceeds(setDoc(ref, draft('alice', { subId: 'schule' })));
    await assertSucceeds(setDoc(ref, draft('alice', { subId: 'schule', title: 'neu' })));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDoc(doc(alice, 'assignments', enc(ASSIGNMENT))));
});

// ---- drafts: updatedAt is the server's time -----------------------------------

test('updatedAt: the server sentinel is accepted, a client timestamp (past, future, now) is refused', async () => {
    const ref = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'zeit'));
    const d = (updatedAt) => draft('alice', { subId: 'zeit', updatedAt });
    const day = 86400000;
    await assertSucceeds(setDoc(ref, d(serverTimestamp())));                        // create
    await assertSucceeds(setDoc(ref, d(serverTimestamp())));                        // update
    await assertFails(setDoc(ref, d(new Date(Date.now() - day))));                  // update, past
    await assertFails(setDoc(ref, d(new Date(Date.now() + day))));                  // update, future
    await assertFails(setDoc(ref, d(new Date(0))));
    const fresh = doc(alice, 'drafts', draftId('alice', ASSIGNMENT, 'zeit2'));
    const f = (updatedAt) => draft('alice', { subId: 'zeit2', updatedAt });
    await assertFails(setDoc(fresh, f(new Date(Date.now() - day))));                // create, past
    await assertFails(setDoc(fresh, f(new Date(Date.now() + day))));                // create, future
    await assertFails(setDoc(fresh, f(new Date())));                                // client "now" is still not request.time
});

// ---- known and by design -------------------------------------------------------

test('KNOWN, BY DESIGN: a forged classId is accepted (the dashboard looks drafts up by uid, not by classId)', async () => {
    const id = draftId('alice', ASSIGNMENT, 'klasse');
    await assertSucceeds(setDoc(doc(alice, 'drafts', id), draft('alice', { subId: 'klasse', classId: 'EineAndereKlasse' })));
    // What the rules do guarantee: the draft is Alice's, and nobody else reads it.
    await assertFails(getDoc(doc(bob, 'drafts', id)));
});

// ---- feedback, feedbackReleased, formativUsage, assignments -------------------

test('student cannot read feedback or formativUsage, not even the own', async () => {
    await assertFails(getDoc(doc(alice, 'feedback', pairId('alice'))));
    await assertFails(getDocs(query(collection(alice, 'feedback'), where('uid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice, 'formativUsage', pairId('alice'))));
    await assertFails(getDocs(query(collection(alice, 'formativUsage'), where('uid', '==', 'alice'))));
    await assertFails(setDoc(doc(alice, 'feedback', pairId('alice')), { uid: 'alice', released: true }));
    await assertFails(setDoc(doc(alice, 'formativUsage', pairId('alice')), { uid: 'alice' }));
});

test('student reads own feedbackReleased only, and cannot write it', async () => {
    await assertSucceeds(getDoc(doc(alice, 'feedbackReleased', pairId('alice'))));
    await assertSucceeds(getDoc(doc(alice, 'feedbackReleased', pairId('alice', 'kein Feedback'))));   // missing: no error
    await assertSucceeds(getDocs(query(collection(alice, 'feedbackReleased'), where('uid', '==', 'alice'))));
    await assertFails(getDoc(doc(alice, 'feedbackReleased', pairId('bob'))));
    await assertFails(getDocs(collection(alice, 'feedbackReleased')));
    await assertFails(setDoc(doc(alice, 'feedbackReleased', pairId('alice')), { uid: 'alice', assignmentId: ASSIGNMENT, results: [{ score: 6 }] }));
    await assertFails(setDoc(doc(alice, 'feedbackReleased', pairId('alice', 'neu')), { uid: 'alice' }));
    await assertFails(deleteDoc(doc(alice, 'feedbackReleased', pairId('alice'))));
});

test('student cannot write assignments', async () => {
    await assertFails(setDoc(doc(alice, 'assignments', enc(ASSIGNMENT)), { assignmentId: ASSIGNMENT, solution_keys: [] }));
    await assertFails(setDoc(doc(alice, 'assignments', 'neu'), { assignmentId: 'neu' }));
    await assertFails(deleteDoc(doc(alice, 'assignments', enc(ASSIGNMENT))));
    await assertSucceeds(getDocs(collection(alice, 'assignments')));
});

test('a forged role that is not exactly "teacher" grants nothing', async () => {
    const fake = client(tok('mallory', { role: 'Teacher', teacher: true, admin: true }));
    await assertFails(getDoc(doc(fake, 'feedback', pairId('alice'))));
    await assertFails(getDocs(collection(fake, 'drafts')));
    await assertFails(setDoc(doc(fake, 'assignments', 'x'), { assignmentId: 'x' }));
});

// ---- teacher -----------------------------------------------------------------

test('teacher can do what the contract grants', async () => {
    // assignments: read, write
    await assertSucceeds(setDoc(doc(teacher, 'assignments', 'neu'), { assignmentId: 'neu' }));
    await assertSucceeds(getDocs(collection(teacher, 'assignments')));
    await assertSucceeds(deleteDoc(doc(teacher, 'assignments', 'neu')));
    // drafts: read all, by class
    await assertSucceeds(getDoc(doc(teacher, 'drafts', draftId('bob'))));
    const byClass = await assertSucceeds(getDocs(query(collection(teacher, 'drafts'), where('classId', '==', 'TestA'))));
    assert.ok(byClass.size >= 2);
    // feedback: read, write
    await assertSucceeds(setDoc(doc(teacher, 'feedback', pairId('bob')), {
        uid: 'bob', assignmentId: ASSIGNMENT, results: [], released: true,
        releaseSettings: { kurzbericht: true, ausfuehrlich: false, punkte: true, loesung: false },
    }));
    await assertSucceeds(getDocs(collection(teacher, 'feedback')));
    // feedbackReleased: read, write, delete (un-release)
    await assertSucceeds(setDoc(doc(teacher, 'feedbackReleased', pairId('bob', 'x')), { uid: 'bob', assignmentId: 'x', results: [] }));
    await assertSucceeds(getDoc(doc(teacher, 'feedbackReleased', pairId('bob', 'x'))));
    await assertSucceeds(deleteDoc(doc(teacher, 'feedbackReleased', pairId('bob', 'x'))));
    // formativUsage: read
    await assertSucceeds(getDoc(doc(teacher, 'formativUsage', pairId('alice'))));
    await assertSucceeds(getDocs(collection(teacher, 'formativUsage')));
});

test('teacher cannot do what the contract does not grant', async () => {
    await assertFails(setDoc(doc(teacher, 'formativUsage', pairId('alice')), { uid: 'alice' }));
    await assertFails(deleteDoc(doc(teacher, 'formativUsage', pairId('alice'))));
    // drafts are the students' own text: read only
    await assertFails(setDoc(doc(teacher, 'drafts', draftId('bob')), draft('bob')));
    await assertFails(updateDoc(doc(teacher, 'drafts', draftId('bob')), { title: 'x' }));
    await assertFails(deleteDoc(doc(teacher, 'drafts', draftId('bob'))));
});

// ---- everything else ---------------------------------------------------------

test('unknown collections and sub-collections are denied for everyone', async () => {
    for (const db of [alice, teacher]) {
        await assertFails(getDoc(doc(db, 'somethingElse', 'x')));
        await assertFails(getDocs(collection(db, 'somethingElse')));
        await assertFails(setDoc(doc(db, 'somethingElse', 'y'), { a: 1 }));
        await assertFails(setDoc(doc(db, 'students', 'alice'), { name: 'x' }));     // the roster is never written from here
        await assertFails(getDoc(doc(db, 'drafts', draftId('alice'), 'history', 'x')));
        await assertFails(setDoc(doc(db, 'assignments', 'a', 'sub', 'x'), { a: 1 }));
    }
});

// ---- roster (emulator-only exception) ------------------------------------------

test('roster in (default): a student reads the own entry only, a teacher all, nobody writes', async () => {
    // The emulator applies the lmsbox ruleset to `(default)` too; that is what the
    // read-only `students/{uid}` match exists for (CONTRACT.md, "Emulator-only exception").
    const D = '(default)';
    const [anonR, aliceR, bobR, teacherR] = [client(null, D), client(tok('alice'), D), client(tok('bob'), D), client(tok('teacher1', { role: 'teacher' }), D)];

    const own = await assertSucceeds(getDoc(doc(aliceR, 'students', 'alice')));
    assert.equal(own.data().classId, 'TestA');
    await assertFails(getDoc(doc(aliceR, 'students', 'bob')));
    await assertFails(getDocs(collection(aliceR, 'students')));
    await assertFails(getDocs(query(collection(aliceR, 'students'), where('classId', '==', 'TestA'))));
    await assertFails(getDoc(doc(anonR, 'students', 'alice')));
    await assertFails(getDocs(collection(anonR, 'students')));

    // a teacher has no entry: the read answers "does not exist", not "denied"
    const none = await assertSucceeds(getDoc(doc(teacherR, 'students', 'teacher1')));
    assert.equal(none.exists(), false);
    await assertSucceeds(getDoc(doc(teacherR, 'students', 'alice')));
    const all = await assertSucceeds(getDocs(collection(teacherR, 'students')));
    assert.equal(all.size, 2);

    // read only, for everyone
    for (const db of [aliceR, bobR, teacherR]) {
        await assertFails(setDoc(doc(db, 'students', 'alice'), { name: 'x' }));
        await assertFails(updateDoc(doc(db, 'students', 'alice'), { mustSetPassword: false }));
        await assertFails(deleteDoc(doc(db, 'students', 'alice')));
        await assertFails(setDoc(doc(db, 'students', 'neu'), { name: 'x' }));
    }
    // and the exception opens nothing else in `(default)`
    await assertFails(getDoc(doc(aliceR, 'somethingElse', 'x')));
});

test('the students match is read only in lmsbox as well', async () => {
    // Same ruleset, so the path is readable here too - it is simply empty. No write gets through.
    const snap = await assertSucceeds(getDoc(doc(alice, 'students', 'alice')));
    assert.equal(snap.exists(), false);
    await assertFails(getDoc(doc(alice, 'students', 'bob')));
    await assertFails(setDoc(doc(alice, 'students', 'alice'), { name: 'x', mustSetPassword: false }));
    await assertFails(setDoc(doc(teacher, 'students', 'alice'), { name: 'x' }));
});

// ---- pasteEvents: create-only hints for the teacher -------------------------------

const pasteId = (uid, id = 'Ev12345678') => `${draftId(uid)}__${id}`;
const pasteEvent = (uid, extra = {}) => ({
    uid, assignmentId: ASSIGNMENT, subId: SUB, questionId: 'q1',
    kind: 'bulk', chars: 120, excerpt: 'Ein eingefügter Text mit Ümläuten.', at: serverTimestamp(),
    ...extra,
});

test('pasteEvents: student creates own event, but cannot read, change or delete it', async () => {
    const ref = doc(alice, 'pasteEvents', pasteId('alice', 'Own000001'));
    await assertSucceeds(setDoc(ref, pasteEvent('alice')));
    await assertFails(getDoc(ref));
    await assertFails(getDocs(query(collection(alice, 'pasteEvents'), where('uid', '==', 'alice'))));
    await assertFails(setDoc(ref, pasteEvent('alice', { chars: 0 })));     // overwrite = update
    await assertFails(updateDoc(ref, { kind: 'paste' }));
    await assertFails(deleteDoc(ref));
});

test('pasteEvents: teacher reads them by uid and assignment', async () => {
    await assertSucceeds(setDoc(doc(alice, 'pasteEvents', pasteId('alice', 'Teach0001')), pasteEvent('alice', { kind: 'fast' })));
    const snap = await assertSucceeds(getDocs(query(collection(teacher, 'pasteEvents'),
        where('uid', '==', 'alice'), where('assignmentId', '==', ASSIGNMENT))));
    assert.ok(snap.docs.some((d) => d.get('kind') === 'fast'));
});

test('pasteEvents: foreign id or forged uid, other accounts, bad fields are refused', async () => {
    await assertFails(setDoc(doc(alice, 'pasteEvents', pasteId('bob', 'Forge0001')), pasteEvent('alice')));
    await assertFails(setDoc(doc(alice, 'pasteEvents', pasteId('alice', 'Forge0002')), pasteEvent('bob')));
    await assertFails(setDoc(doc(anon, 'pasteEvents', pasteId('anon', 'Anon00001')), pasteEvent('anon')));
    await assertFails(setDoc(doc(anonSession, 'pasteEvents', pasteId('anon1', 'Anon00002')), pasteEvent('anon1')));
    await assertFails(setDoc(doc(outsider, 'pasteEvents', pasteId('outsider', 'Out000001')), pasteEvent('outsider')));
    const bad = (extra, id) => setDoc(doc(alice, 'pasteEvents', pasteId('alice', id)), pasteEvent('alice', extra));
    await assertFails(bad({ kind: 'typed' }, 'Bad000001'));
    await assertFails(bad({ chars: '120' }, 'Bad000002'));
    await assertFails(bad({ chars: -1 }, 'Bad000003'));
    await assertFails(bad({ chars: 1.5 }, 'Bad000004'));
    await assertFails(bad({ excerpt: 'x'.repeat(301) }, 'Bad000005'));
    await assertFails(bad({ at: new Date(0) }, 'Bad000006'));
    await assertFails(bad({ name: 'Alice Beispiel' }, 'Bad000007'));
    await assertFails(bad({ assignmentId: '' }, 'Bad000008'));
    const { excerpt, ...noExcerpt } = pasteEvent('alice');
    await assertFails(setDoc(doc(alice, 'pasteEvents', pasteId('alice', 'Bad000009')), noExcerpt));
});
