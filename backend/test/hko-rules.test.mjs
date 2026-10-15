// Rules tests for the named database `hko` (Phase P0: read-only content, nothing writable).
// Run: npm run test:hko   (emulators from firebase.hko-test.json, which loads ONLY
// firestore.hko.rules - the emulator knows one ruleset for all databases, see HKO.md).
//
// The rules under test are the ones the EMULATOR loaded from the config. This file
// never uploads rules itself. All uids and addresses are fictional.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { initializeApp, deleteApp } from 'firebase/app';
import {
    getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, updateDoc, deleteDoc,
    collection, getDocs, terminate,
} from 'firebase/firestore';
import { initializeApp as adminInit, deleteApp as adminDelete } from 'firebase-admin/app';
import { getFirestore as adminFirestore } from 'firebase-admin/firestore';

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST;
if (!emulatorHost) {
    console.error('FIRESTORE_EMULATOR_HOST is not set. Run through: npm run test:hko');
    process.exit(1);
}
const [HOST, PORT] = emulatorHost.split(':');
if (PORT !== '8320') {
    console.error(`Expected the hko test emulator on port 8320 (firebase.hko-test.json), got ${emulatorHost}.`);
    process.exit(1);
}
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-hko';
const DB = 'hko';

const unit = JSON.parse(readFileSync(new URL('./fixtures/unit-lj1-konsum-budget.json', import.meta.url), 'utf8'));
const UNIT = unit.unitId;
const SLUG = 'unterversicherung';
const CLASS = 'test-3j-a';

const apps = [];
function client(token) {
    const app = initializeApp({ projectId: PROJECT }, `c${apps.length}`);
    apps.push(app);
    const db = getFirestore(app, DB);
    connectFirestoreEmulator(db, HOST, Number(PORT), token ? { mockUserToken: token } : undefined);
    return db;
}
const tok = (sub, { provider = 'password', email = `${sub}.test@lernende.bbw.ch`, ...rest } = {}) => ({
    sub, ...(email ? { email } : {}), firebase: { sign_in_provider: provider, identities: {} }, ...rest,
});

let adminApp, admin;
let anon, student, teacher, anonSession, outsider, googleSchool;

before(async () => {
    adminApp = adminInit({ projectId: PROJECT }, 'admin');
    admin = adminFirestore(adminApp, DB);
    anon = client(null);
    student = client(tok('hkostud1'));
    teacher = client(tok('hkoteacher1', { role: 'teacher', email: 'lp.test@example.com' }));
    anonSession = client(tok('hkoanon1', { provider: 'anonymous', email: null }));
    outsider = client(tok('hkooutsider', { email: 'jemand@example.com' }));          // self-sign-up, foreign domain
    googleSchool = client(tok('hkogoogle', { provider: 'google.com' }));               // right domain, wrong provider

    // Fixtures written past the rules (Admin SDK).
    await admin.doc(`units/${UNIT}`).set(unit);
    await admin.doc(`items/${SLUG}`).set({
        slug: SLUG, begriff: 'Unterversicherung', lehrmittel_seiten: [149],
        fragen: [{ id: `${SLUG}-1`, k: 1, text: 'Was versteht man unter Unterversicherung?' }],
    });
    await admin.doc(`solutions/${UNIT}`).set({ blocks: { 'produkt-entscheid': { erwartung: 'geheim' } } });
    await admin.doc(`itemSolutions/${SLUG}`).set({ loesungen: { [`${SLUG}-1`]: 'geheim' } });
    await admin.doc(`classes/${CLASS}`).set({ variante: '3J', lehrjahr: 1, aktiv: true });
    await admin.doc(`answers/hkostud1__${UNIT}__produkt-entscheid`).set({ uid: 'hkostud1', unitId: UNIT, blockId: 'produkt-entscheid' });
    await admin.doc(`feedback/hkostud1__${UNIT}__produkt-entscheid__1`).set({ uid: 'hkostud1' });
    await admin.doc(`feedbackReleased/hkostud1__${UNIT}__produkt-entscheid`).set({ uid: 'hkostud1' });
    await admin.doc(`knGrades/hkostud1__${UNIT}`).set({ uid: 'hkostud1' });
    await admin.doc(`unbekannt/x`).set({ a: 1 });
    await admin.doc(`students/hkostud1`).set({ classId: CLASS, active: true });
});

after(async () => {
    await Promise.all(apps.map(async (a) => { await terminate(getFirestore(a, DB)).catch(() => {}); await deleteApp(a); }));
    await adminDelete(adminApp);
});

// ---- reading content ----------------------------------------------------------

test('school account and teacher read units, items, classes (get and list)', async () => {
    for (const db of [student, teacher]) {
        const snap = await assertSucceeds(getDoc(doc(db, 'units', UNIT)));
        assert.equal(snap.data().titel, unit.titel);
        await assertSucceeds(getDoc(doc(db, 'items', SLUG)));
        await assertSucceeds(getDoc(doc(db, 'classes', CLASS)));
        await assertSucceeds(getDocs(collection(db, 'units')));
        await assertSucceeds(getDocs(collection(db, 'items')));
        await assertSucceeds(getDocs(collection(db, 'classes')));
    }
});

test('a missing unit reads as "does not exist" for a school account, not denied', async () => {
    const snap = await assertSucceeds(getDoc(doc(student, 'units', 'gibt-es-nicht')));
    assert.equal(snap.exists(), false);
});

test('nobody else reads units, items or classes: unauthenticated, anonymous, foreign domain, non-password', async () => {
    for (const db of [anon, anonSession, outsider, googleSchool]) {
        for (const [c, id] of [['units', UNIT], ['items', SLUG], ['classes', CLASS]]) {
            await assertFails(getDoc(doc(db, c, id)));
            await assertFails(getDocs(collection(db, c)));
        }
    }
});

// ---- closed collections -------------------------------------------------------

test('solutions and itemSolutions are closed to school accounts (get and list)', async () => {
    await assertFails(getDoc(doc(student, 'solutions', UNIT)));
    await assertFails(getDocs(collection(student, 'solutions')));
    await assertFails(getDoc(doc(student, 'itemSolutions', SLUG)));
    await assertFails(getDocs(collection(student, 'itemSolutions')));
});

test('P0: solutions and itemSolutions are closed to teachers and everyone else too', async () => {
    for (const db of [teacher, anon, anonSession, outsider]) {
        await assertFails(getDoc(doc(db, 'solutions', UNIT)));
        await assertFails(getDocs(collection(db, 'solutions')));
        await assertFails(getDoc(doc(db, 'itemSolutions', SLUG)));
        await assertFails(getDocs(collection(db, 'itemSolutions')));
    }
});

test('P0: per-person collections are not readable, not even own documents', async () => {
    for (const db of [student, teacher]) {
        await assertFails(getDoc(doc(db, 'answers', `hkostud1__${UNIT}__produkt-entscheid`)));
        await assertFails(getDocs(collection(db, 'answers')));
        await assertFails(getDoc(doc(db, 'feedback', `hkostud1__${UNIT}__produkt-entscheid__1`)));
        await assertFails(getDoc(doc(db, 'feedbackReleased', `hkostud1__${UNIT}__produkt-entscheid`)));
        await assertFails(getDoc(doc(db, 'knGrades', `hkostud1__${UNIT}`)));
    }
});

test('an unknown collection is closed', async () => {
    for (const db of [student, teacher, anon]) {
        await assertFails(getDoc(doc(db, 'unbekannt', 'x')));
        await assertFails(getDocs(collection(db, 'unbekannt')));
        await assertFails(setDoc(doc(db, 'unbekannt', 'y'), { a: 1 }));
    }
});

// ---- no writes at all ---------------------------------------------------------

const ALL = ['units', 'items', 'solutions', 'itemSolutions', 'classes', 'answers', 'feedback',
    'feedbackLP', 'feedbackReleased', 'peerAssignments', 'usage', 'pasteEvents', 'knGrades', 'students'];

test('nobody writes anything: create, update, set over existing, delete - in every collection', async () => {
    const existing = {
        units: UNIT, items: SLUG, solutions: UNIT, itemSolutions: SLUG, classes: CLASS,
        answers: `hkostud1__${UNIT}__produkt-entscheid`, feedback: `hkostud1__${UNIT}__produkt-entscheid__1`,
        feedbackReleased: `hkostud1__${UNIT}__produkt-entscheid`, knGrades: `hkostud1__${UNIT}`, students: 'hkostud1',
    };
    for (const db of [student, teacher, anon, anonSession, outsider]) {
        for (const c of ALL) {
            // own-looking id for the student, so a future "own document" rule would be the only thing that opens it
            await assertFails(setDoc(doc(db, c, `hkostud1__${UNIT}__neu`), { uid: 'hkostud1', unitId: UNIT }));
            if (existing[c]) {
                await assertFails(setDoc(doc(db, c, existing[c]), { x: 1 }));
                await assertFails(updateDoc(doc(db, c, existing[c]), { x: 1 }));
                await assertFails(deleteDoc(doc(db, c, existing[c])));
            }
        }
    }
});

// ---- emulator-only roster read ------------------------------------------------

test('students (emulator-only exception): own doc and teacher read, others not', async () => {
    await assertSucceeds(getDoc(doc(student, 'students', 'hkostud1')));
    await assertSucceeds(getDoc(doc(teacher, 'students', 'hkostud1')));
    await assertFails(getDoc(doc(outsider, 'students', 'hkostud1')));
    await assertFails(getDoc(doc(anon, 'students', 'hkostud1')));
    await assertFails(getDocs(collection(student, 'students')));
});
