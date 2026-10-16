// Rules tests for the named database `hko` (Phase P1: HKO.md "Phase P1 - Vertrag" 3-5,
// plan HKO-P1-PLAN.md 3.5, cases 1-18).
// Run (from backend/):
//   node scripts/emu.mjs emulators:exec --config firebase.hko-test.json --project demo-hko \
//     --only firestore "node --test test/hko-rules.test.mjs"
// firebase.hko-test.json loads ONLY firestore.hko.rules - the emulator knows one ruleset
// for all databases, see HKO.md.
//
// The rules under test are the ones the EMULATOR loaded from the config. This file
// never uploads rules itself. All uids, addresses and texts are fictional; the units
// come from test/fixtures/hko-build (build format, written past the rules).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
    console.error('FIRESTORE_EMULATOR_HOST is not set. Run through scripts/emu.mjs with firebase.hko-test.json.');
    process.exit(1);
}
const [HOST, PORT] = emulatorHost.split(':');
if (PORT !== '8320') {
    console.error(`Expected the hko test emulator on port 8320 (firebase.hko-test.json), got ${emulatorHost}.`);
    process.exit(1);
}
const PROJECT = process.env.GCLOUD_PROJECT || 'demo-hko';
const DB = 'hko';

const readJson = (rel) => JSON.parse(readFileSync(new URL(rel, import.meta.url), 'utf8'));
const unitP0 = readJson('./fixtures/unit-lj1-konsum-budget.json');   // P0 fixture, unchanged
const unit = readJson('./fixtures/hko-build/units/lj1-test-box.json');
const andere = readJson('./fixtures/hko-build/units/lj1-test-andere.json');
const solution = readJson('./fixtures/hko-build/solutions/lj1-test-box.json');
const U = unit.unitId;
const SLUG = 'testbegriff';
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
let anon, student, student2, teacher, anonSession, outsider, googleSchool, upperCase;

// ---- builders -------------------------------------------------------------------

const aid = (uid, blockId, unitId = U) => `${uid}__${unitId}__${blockId}`;
const s = (n, ch = 'a') => ch.repeat(n);
const blk = (blockId) => unit.blocks[blockId];
/** A complete answer document as the box writes it (setDoc, whole document). */
function answer(uid, blockId, value, over = {}) {
    const b = blk(blockId) || { type: 'text', kn: false };
    return {
        uid, classId: CLASS, unitId: U, blockId, unitVersion: unit.version, variante: '3J',
        type: b.type, value, status: 'entwurf', kn: b.kn === true, updatedAt: serverTimestamp(), ...over,
    };
}
const textV = (n = 10) => ({ text: s(n) });
const itemsV = (n = 3, len = 10) => ({ antworten: Array.from({ length: n }, (_, i) => ({ frageId: `testbegriff-${i + 1}`, text: s(len) })) });
const rasterV = (rows = 4, cols = 3, len = 10, befund = 'Ein Befund.') => ({
    zeilen: Array.from({ length: rows }, () => ({ c: Array.from({ length: cols }, () => s(len)) })), befund,
});
const selbstV = (stufen = { argumentation: 2, position: 3 }) => ({ stufen, begruendung: 'Weil es so ist.', verbessere: 'Mehr Gründe.' });

/** setDoc on a document that does not exist yet (so the rule under test is `create`). */
async function fresh(id) { await admin.doc(`answers/${id}`).delete(); }
async function create(db, uid, blockId, value, over = {}, id = aid(uid, blockId, over.unitId)) {
    await fresh(id);
    return setDoc(doc(db, 'answers', id), answer(uid, blockId, value, over));
}

const paste = (uid, over = {}) => ({
    uid, unitId: U, blockId: 'entscheid', feld: 'text', kind: 'paste', chars: 120,
    excerpt: 'Ein eingefügter Satz.', at: serverTimestamp(), ...over,
});
const pid = (uid, ev = 'Ev12345678', blockId = 'entscheid') => `${uid}__${U}__${blockId}__${ev}`;

before(async () => {
    adminApp = adminInit({ projectId: PROJECT }, 'admin');
    admin = adminFirestore(adminApp, DB);
    anon = client(null);
    student = client(tok('hkostud1'));
    student2 = client(tok('hkostud2'));
    teacher = client(tok('hkoteacher1', { role: 'teacher', email: 'lp.test@example.com' }));
    anonSession = client(tok('hkoanon1', { provider: 'anonymous', email: null }));
    outsider = client(tok('hkooutsider', { email: 'jemand@gmail.com' }));              // self-sign-up, foreign domain
    googleSchool = client(tok('hkogoogle', { provider: 'google.com' }));               // right domain, wrong provider
    upperCase = client(tok('hkoupper', { email: 'Test.Upper@Lernende.BBW.ch' }));      // Auth issues lowercase; this never comes

    // Fixtures written past the rules (Admin SDK).
    await admin.doc(`units/${unitP0.unitId}`).set(unitP0);
    await admin.doc(`units/${U}`).set(unit);
    await admin.doc(`units/${andere.unitId}`).set(andere);
    await admin.doc(`items/${SLUG}`).set({
        slug: SLUG, begriff: 'Testbegriff', lehrmittel_seiten: [101],
        fragen: unit.blocks['begriffe-voll'].fragen,
    });
    await admin.doc(`solutions/${U}`).set(solution);
    await admin.doc(`itemSolutions/${SLUG}`).set({ loesungen: { 'testbegriff-1': 'geheim' } });
    await admin.doc(`classes/${CLASS}`).set({ variante: '3J', lehrjahr: 1, aktiv: true });
    await admin.doc(`feedback/hkostud1__${U}__entscheid__1`).set({ uid: 'hkostud1' });
    await admin.doc(`feedbackReleased/hkostud1__${U}__entscheid`).set({ uid: 'hkostud1' });
    await admin.doc(`knGrades/hkostud1__${U}`).set({ uid: 'hkostud1' });
    await admin.doc(`unbekannt/x`).set({ a: 1 });
    await admin.doc(`students/hkostud1`).set({ classId: CLASS, active: true });
    // Stored answers for the read tests (one per person).
    await admin.doc(`answers/${aid('hkostud1', 'begriffe-a')}`).set({ ...answer('hkostud1', 'begriffe-a', itemsV()), updatedAt: new Date() });
    await admin.doc(`answers/${aid('hkostud2', 'begriffe-a')}`).set({ ...answer('hkostud2', 'begriffe-a', itemsV()), updatedAt: new Date() });
    await admin.doc(`pasteEvents/${pid('hkostud1', 'Stored0001')}`).set({ ...paste('hkostud1'), at: new Date() });
});

after(async () => {
    await Promise.all(apps.map(async (a) => { await terminate(getFirestore(a, DB)).catch(() => {}); await deleteApp(a); }));
    await adminDelete(adminApp);
});

// ---- 11. spike: expression budget (first, so a failure shows up at the top) -----
// Rules evaluate at most 1000 expressions per request; the emulator enforces it.
// The biggest documents the contract allows must still pass.

test('11 budget: full raster 8 x 6 (all cells 500 characters, befund 3000) is accepted', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'raster-voll', rasterV(8, 6, 500, s(3000))));
});

test('11 budget: 12 items with 3000 characters each are accepted', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'begriffe-voll', itemsV(12, 3000)));
});

test('11 budget: the same full documents also pass as an update (update checks more)', async () => {
    await assertSucceeds(setDoc(doc(student, 'answers', aid('hkostud1', 'raster-voll')), answer('hkostud1', 'raster-voll', rasterV(8, 6, 500, s(3000, 'b')))));
    await assertSucceeds(setDoc(doc(student, 'answers', aid('hkostud1', 'begriffe-voll')), answer('hkostud1', 'begriffe-voll', itemsV(12, 3000))));
});

// ---- 1. reading content -------------------------------------------------------

test('1 school account and teacher read units, items, classes (get and list)', async () => {
    for (const db of [student, teacher]) {
        const snap = await assertSucceeds(getDoc(doc(db, 'units', U)));
        assert.equal(snap.data().titel, unit.titel);
        await assertSucceeds(getDoc(doc(db, 'units', unitP0.unitId)));
        await assertSucceeds(getDoc(doc(db, 'items', SLUG)));
        await assertSucceeds(getDoc(doc(db, 'classes', CLASS)));
        await assertSucceeds(getDocs(collection(db, 'units')));
        await assertSucceeds(getDocs(collection(db, 'items')));
        await assertSucceeds(getDocs(collection(db, 'classes')));
    }
});

test('1 a missing unit reads as "does not exist" for a school account, not denied', async () => {
    const snap = await assertSucceeds(getDoc(doc(student, 'units', 'gibt-es-nicht')));
    assert.equal(snap.exists(), false);
});

test('1 nobody else reads units, items or classes: unauthenticated, anonymous, foreign domain, non-password', async () => {
    for (const db of [anon, anonSession, outsider, googleSchool]) {
        for (const [c, id] of [['units', U], ['items', SLUG], ['classes', CLASS]]) {
            await assertFails(getDoc(doc(db, c, id)));
            await assertFails(getDocs(collection(db, c)));
        }
    }
});

// ---- 2. closed collections -----------------------------------------------------

test('2 solutions and itemSolutions: nobody reads them in P1, teachers included', async () => {
    for (const db of [student, teacher, anon, anonSession, outsider]) {
        await assertFails(getDoc(doc(db, 'solutions', U)));
        await assertFails(getDocs(collection(db, 'solutions')));
        await assertFails(getDoc(doc(db, 'itemSolutions', SLUG)));
        await assertFails(getDocs(collection(db, 'itemSolutions')));
    }
});

test('2 nobody writes units, items, solutions, itemSolutions (content comes through the Admin SDK)', async () => {
    const existing = { units: U, items: SLUG, solutions: U, itemSolutions: SLUG };
    for (const db of [student, teacher, anon, anonSession, outsider]) {
        for (const [c, id] of Object.entries(existing)) {
            await assertFails(setDoc(doc(db, c, 'neu-x'), { a: 1 }));
            await assertFails(setDoc(doc(db, c, id), { x: 1 }));
            await assertFails(updateDoc(doc(db, c, id), { x: 1 }));
            await assertFails(deleteDoc(doc(db, c, id)));
        }
    }
});

test('2 P2+ collections and unknown collections stay closed (read and write)', async () => {
    // P0 said "nobody writes anything". P1 opens answers and pasteEvents (school accounts)
    // and classes (teachers) on purpose - those have their own tests below. Everything
    // else stays closed.
    const closed = {
        feedback: `hkostud1__${U}__entscheid__1`, feedbackReleased: `hkostud1__${U}__entscheid`,
        knGrades: `hkostud1__${U}`, feedbackLP: null, peerAssignments: null, usage: null, unbekannt: 'x',
    };
    for (const db of [student, teacher, anon, anonSession, outsider]) {
        for (const [c, id] of Object.entries(closed)) {
            await assertFails(getDocs(collection(db, c)));
            await assertFails(setDoc(doc(db, c, `hkostud1__${U}__neu`), { uid: 'hkostud1', unitId: U }));
            if (id) {
                await assertFails(getDoc(doc(db, c, id)));
                await assertFails(setDoc(doc(db, c, id), { x: 1 }));
                await assertFails(deleteDoc(doc(db, c, id)));
            }
        }
        await assertFails(setDoc(doc(db, 'students', 'hkostud1'), { classId: 'x' }));
        await assertFails(deleteDoc(doc(db, 'students', 'hkostud1')));
    }
});

// ---- 3. reading answers ---------------------------------------------------------

test('3 own answer: get and list with where uid == own uid; a missing own answer is "does not exist"', async () => {
    const snap = await assertSucceeds(getDoc(doc(student, 'answers', aid('hkostud1', 'begriffe-a'))));
    assert.equal(snap.data().uid, 'hkostud1');
    const missing = await assertSucceeds(getDoc(doc(student, 'answers', aid('hkostud1', 'gibt-es-nicht'))));
    assert.equal(missing.exists(), false);
    const list = await assertSucceeds(getDocs(query(collection(student, 'answers'), where('uid', '==', 'hkostud1'))));
    assert.ok(list.size >= 1 && list.docs.every((d) => d.data().uid === 'hkostud1'));
    await assertSucceeds(getDocs(query(collection(student, 'answers'), where('uid', '==', 'hkostud1'), where('unitId', '==', U))));
});

test('3 foreign answer: get, list by foreign uid, list without uid filter - all denied', async () => {
    await assertFails(getDoc(doc(student, 'answers', aid('hkostud2', 'begriffe-a'))));
    await assertFails(getDocs(query(collection(student, 'answers'), where('uid', '==', 'hkostud2'))));
    await assertFails(getDocs(collection(student, 'answers')));
    await assertFails(getDocs(query(collection(student, 'answers'), where('unitId', '==', U))));
    for (const db of [anon, anonSession]) {
        await assertFails(getDoc(doc(db, 'answers', aid('hkostud1', 'begriffe-a'))));
        await assertFails(getDocs(collection(db, 'answers')));
    }
});

test('3 teacher reads all answers (get and list)', async () => {
    await assertSucceeds(getDoc(doc(teacher, 'answers', aid('hkostud1', 'begriffe-a'))));
    await assertSucceeds(getDoc(doc(teacher, 'answers', aid('hkostud2', 'begriffe-a'))));
    const all = await assertSucceeds(getDocs(collection(teacher, 'answers')));
    assert.ok(all.size >= 2);
});

// ---- 4.-10. creating answers ----------------------------------------------------

test('4 a valid answer per type: items, text, raster, selbst (and text in a second unit)', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'begriffe-a', itemsV(3)));
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', { text: 'Ich nehme Angebot A, weil es günstiger ist.' }));
    await assertSucceeds(create(student, 'hkostud1', 'raster-quelle', rasterV(4, 3)));
    await assertSucceeds(create(student, 'hkostud1', 'raster-quelle', rasterV(0, 0, 0, '')));      // empty befund is allowed
    await assertSucceeds(create(student, 'hkostud1', 'selbst-entscheid', selbstV()));
    await assertSucceeds(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ position: 0 }))); // subset of kriterien
    await assertSucceeds(create(student, 'hkostud1', 'raster-3j', rasterV(3, 3)));
    await fresh(aid('hkostud1', 'notiz', andere.unitId));
    await assertSucceeds(setDoc(doc(student, 'answers', aid('hkostud1', 'notiz', andere.unitId)),
        { ...answer('hkostud1', 'notiz', textV()), unitId: andere.unitId, type: 'text', kn: false }));
});

test('5 foreign uid in the data; id of another person; id does not match unitId/blockId', async () => {
    await assertFails(create(student, 'hkostud2', 'entscheid', textV()));                                  // data and id of hkostud2
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { uid: 'hkostud2' }, aid('hkostud1', 'entscheid')));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), {}, aid('hkostud2', 'entscheid')));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), {}, aid('hkostud1', 'raster-quelle')));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), {}, aid('hkostud1', 'entscheid', andere.unitId)));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), {}, `${aid('hkostud1', 'entscheid')}__x`));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), {}, `hkostud1_${U}_entscheid`));
});

test('6 extra key, missing key, updatedAt from the client', async () => {
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { name: 'Test Person' }));
    const missing = answer('hkostud1', 'entscheid', textV());
    delete missing.classId;
    await fresh(aid('hkostud1', 'entscheid'));
    await assertFails(setDoc(doc(student, 'answers', aid('hkostud1', 'entscheid')), missing));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { updatedAt: new Date() }));
    // and the other field checks of the contract
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { classId: s(101) }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { unitVersion: 0 }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { unitVersion: '1' }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { status: 'fertig' }));
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV(), { status: 'abgegeben' }));
});

test('7 block missing, unit missing, block of type mitnahme, block of type upload', async () => {
    await assertFails(create(student, 'hkostud1', 'gibt-es-nicht', textV(), { type: 'text' }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { unitId: 'gibt-es-nicht' }));
    await assertFails(create(student, 'hkostud1', 'rueckblick', textV(), { type: 'mitnahme' }));
    await assertFails(create(student, 'hkostud1', 'rueckblick', textV(), { type: 'text' }));
    await assertFails(create(student, 'hkostud1', 'spaeter', textV(), { type: 'upload' }));
    await assertFails(create(student, 'hkostud1', 'spaeter', textV(), { type: 'text' }));
});

test('8 type differs from the block type; kn differs from the block kn', async () => {
    await assertFails(create(student, 'hkostud1', 'entscheid', itemsV(), { type: 'items' }));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', textV(), { type: 'text' }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { kn: true }));
    await assertFails(create(student, 'hkostud1', 'kn-fall', textV(), { kn: false }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { kn: 'false' }));
});

test('9 nur_variante: 4J block with variante 3J denied, with 4J allowed; variante 5J denied; 2J allowed without nur_variante', async () => {
    await assertFails(create(student, 'hkostud1', 'raster-4j', rasterV(3, 3), { variante: '3J' }));
    await assertSucceeds(create(student, 'hkostud1', 'raster-4j', rasterV(3, 3), { variante: '4J' }));
    await assertFails(create(student, 'hkostud1', 'raster-3j', rasterV(3, 3), { variante: '4J' }));
    await assertFails(create(student, 'hkostud1', 'raster-3j', rasterV(3, 3), { variante: '2J' }));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(), { variante: '5J' }));
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV(), { variante: '2J' }));
});

test('10 text: 20000 allowed, 20001 denied; only key text', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV(20000)));
    await assertFails(create(student, 'hkostud1', 'entscheid', textV(20001)));
    await assertFails(create(student, 'hkostud1', 'entscheid', { text: 'a', html: '<p>a</p>' }));
    await assertFails(create(student, 'hkostud1', 'entscheid', { text: 5 }));
    await assertFails(create(student, 'hkostud1', 'entscheid', {}));
    await assertFails(create(student, 'hkostud1', 'entscheid', 'nur ein String'));
});

test('10 items: 12 allowed, 13 denied; text 3000/3001; keys exactly frageId, text; frageId 100/101', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'begriffe-voll', itemsV(12)));
    await assertFails(create(student, 'hkostud1', 'begriffe-voll', itemsV(13)));
    await assertSucceeds(create(student, 'hkostud1', 'begriffe-a', itemsV(3, 3000)));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', itemsV(3, 3001)));
    const last = itemsV(12);
    last.antworten[11].text = s(3001);
    await assertFails(create(student, 'hkostud1', 'begriffe-voll', last));                      // the 12th index is checked too
    await assertFails(create(student, 'hkostud1', 'begriffe-a', { antworten: [{ frageId: 'testbegriff-1' }] }));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', { antworten: [{ frageId: 'testbegriff-1', text: 'a', extra: 1 }] }));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', { antworten: ['nur Text'] }));
    await assertSucceeds(create(student, 'hkostud1', 'begriffe-a', { antworten: [{ frageId: s(100), text: 'a' }] }));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', { antworten: [{ frageId: s(101), text: 'a' }] }));
    await assertFails(create(student, 'hkostud1', 'begriffe-a', { ...itemsV(1), mehr: 1 }));
});

test('10 raster: 8 x 6 allowed; 9 rows, 7 cells, cell 501, befund 3001, missing befund denied', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'raster-voll', rasterV(8, 6, 500)));
    await assertFails(create(student, 'hkostud1', 'raster-voll', rasterV(9, 6)));
    await assertFails(create(student, 'hkostud1', 'raster-voll', rasterV(8, 7)));
    const big = rasterV(8, 6, 500);
    big.zeilen[7].c[5] = s(501);
    await assertFails(create(student, 'hkostud1', 'raster-voll', big));                         // last cell of the last row
    await assertFails(create(student, 'hkostud1', 'raster-voll', rasterV(2, 2, 10, s(3001))));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [] }));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: ['a'], d: 1 }], befund: '' }));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: [1] }], befund: '' }));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zellen: [{ c: ['a'] }], befund: '' }));   // old plan name
    // the join/split check: a cell containing the separator, a non-string cell after strings
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: [`${s(400)}\u0001${s(400)}`] }], befund: '' }));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: ['a', 'b', true] }], befund: '' }));
    await assertFails(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: ['a', { x: 'b' }] }], befund: '' }));
    await assertSucceeds(create(student, 'hkostud1', 'raster-voll', { zeilen: [{ c: [] }, { c: ['', '', ''] }, { c: ['ä – «x»', '→'] }], befund: '' }));
});

test('10 raster as string[][] is rejected by the SDK already (Firestore has no list in a list)', async () => {
    await fresh(aid('hkostud1', 'raster-voll'));
    // setDoc throws synchronously; the async wrapper turns that into a rejection.
    await assert.rejects(
        async () => setDoc(doc(student, 'answers', aid('hkostud1', 'raster-voll')), answer('hkostud1', 'raster-voll', { zeilen: [['a', 'b']], befund: '' })),
        /[Nn]ested arrays/,
    );
});

test('10 selbst: kriterium the block does not have, stufe 4, stufe as string, -1, more keys - denied', async () => {
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ fachkorrektheit: 2 })));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ argumentation: 4 })));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ argumentation: '2' })));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ argumentation: -1 })));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', selbstV({ argumentation: 2.5 })));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', { ...selbstV(), begruendung: s(1501) }));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', { ...selbstV(), verbessere: s(1501) }));
    await assertSucceeds(create(student, 'hkostud1', 'selbst-entscheid', { ...selbstV(), begruendung: s(1500), verbessere: s(1500) }));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', { ...selbstV(), note: 6 }));
    await assertFails(create(student, 'hkostud1', 'selbst-entscheid', { stufen: { argumentation: 1 }, begruendung: '' }));
});

// ---- 12.-15. updating, deleting --------------------------------------------------

test('12 update: a normal update passes; unitId, blockId, type or kn changed - denied', async () => {
    const id = aid('hkostud1', 'entscheid');
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV()));
    await assertSucceeds(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV(50))));
    await assertFails(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV(), { unitId: andere.unitId })));
    await assertFails(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV(), { blockId: 'kn-fall' })));
    // type and kn: a stored document that differs from the block (e.g. an older unit
    // version). The update with the block's values must still be refused.
    await admin.doc(`answers/${id}`).set({ ...answer('hkostud1', 'entscheid', textV()), type: 'items', updatedAt: new Date() });
    await assertFails(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV())));
    await admin.doc(`answers/${id}`).set({ ...answer('hkostud1', 'entscheid', textV()), kn: true, updatedAt: new Date() });
    await assertFails(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV())));
    // updateDoc (merge) is not how the box writes, but it must not slip through either
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV()));
    await assertFails(updateDoc(doc(student, 'answers', id), { 'value.text': 'neu' }));            // updatedAt not request.time
    await assertFails(updateDoc(doc(student, 'answers', id), { type: 'items', updatedAt: serverTimestamp() }));
    // someone else's stored document under one's own id (cannot happen through the rules)
    await admin.doc(`answers/${id}`).set({ ...answer('hkostud2', 'entscheid', textV()), updatedAt: new Date() });
    await assertFails(setDoc(doc(student, 'answers', id), answer('hkostud1', 'entscheid', textV())));
});

test('13 KN lock: kn block with status abgegeben - every further update denied; before that and for kn false, updates pass', async () => {
    const kn = aid('hkostud1', 'kn-fall');
    await assertSucceeds(create(student, 'hkostud1', 'kn-fall', textV()));                      // kn: true, entwurf
    await assertSucceeds(setDoc(doc(student, 'answers', kn), answer('hkostud1', 'kn-fall', textV(20))));
    await assertSucceeds(setDoc(doc(student, 'answers', kn), answer('hkostud1', 'kn-fall', textV(30), { status: 'abgegeben' })));
    await assertFails(setDoc(doc(student, 'answers', kn), answer('hkostud1', 'kn-fall', textV(30), { status: 'abgegeben' })));
    await assertFails(setDoc(doc(student, 'answers', kn), answer('hkostud1', 'kn-fall', textV(40), { status: 'entwurf' })));
    await assertFails(deleteDoc(doc(student, 'answers', kn)));
    const snap = await admin.doc(`answers/${kn}`).get();
    assert.equal(snap.data().value.text, s(30));
    // kn: false - abgegeben may go back to entwurf
    const t = aid('hkostud1', 'entscheid');
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV(), { status: 'abgegeben' }));
    await assertSucceeds(setDoc(doc(student, 'answers', t), answer('hkostud1', 'entscheid', textV(), { status: 'entwurf' })));
});

test('14 delete by the person and by the teacher - denied', async () => {
    await assertSucceeds(create(student, 'hkostud1', 'entscheid', textV()));
    await assertFails(deleteDoc(doc(student, 'answers', aid('hkostud1', 'entscheid'))));
    await assertFails(deleteDoc(doc(teacher, 'answers', aid('hkostud1', 'entscheid'))));
    await assertFails(deleteDoc(doc(teacher, 'answers', aid('hkostud2', 'begriffe-a'))));
});

test('15 the teacher does not write answers in P1 (own uid, a student document, update)', async () => {
    await assertFails(create(teacher, 'hkoteacher1', 'entscheid', textV()));
    await assertFails(create(teacher, 'hkostud1', 'entscheid', textV()));
    await assertFails(setDoc(doc(teacher, 'answers', aid('hkostud2', 'begriffe-a')), answer('hkostud2', 'begriffe-a', itemsV())));
    await assertFails(updateDoc(doc(teacher, 'answers', aid('hkostud2', 'begriffe-a')), { status: 'abgegeben' }));
});

test('16 only a school account writes: anonymous, foreign-domain password, google, uppercase address - denied', async () => {
    await assertFails(create(anon, 'x', 'entscheid', textV()));
    await assertFails(create(anonSession, 'hkoanon1', 'entscheid', textV()));
    await assertFails(create(outsider, 'hkooutsider', 'entscheid', textV()));
    await assertFails(create(googleSchool, 'hkogoogle', 'entscheid', textV()));
    // Auth always issues the address in lowercase; an uppercase token is not a school account.
    await assertFails(create(upperCase, 'hkoupper', 'entscheid', textV()));
    await assertSucceeds(create(student2, 'hkostud2', 'entscheid', textV()));
});

// ---- 17. pasteEvents --------------------------------------------------------------

test('17 pasteEvents: a valid event is created; feld variants of the contract', async () => {
    await assertSucceeds(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000001')), paste('hkostud1')));
    await assertSucceeds(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000002', 'raster-voll')),
        paste('hkostud1', { blockId: 'raster-voll', feld: 'r7c5', kind: 'bulk', chars: 20000, excerpt: s(300) })));
    await assertSucceeds(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'a'.repeat(40))), paste('hkostud1', { kind: 'fast', chars: 0, excerpt: '' })));
});

test('17 pasteEvents: foreign uid, wrong kind, excerpt 301, bad id, extra key, client time - denied', async () => {
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud2', 'Ev00000003')), paste('hkostud2')));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000004')), paste('hkostud2')));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000005')), paste('hkostud1', { kind: 'typed' })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000006')), paste('hkostud1', { excerpt: s(301) })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000007')), paste('hkostud1', { chars: 20001 })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000008')), paste('hkostud1', { feld: '' })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000009')), paste('hkostud1', { feld: s(101) })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000010')), paste('hkostud1', { at: new Date() })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000011')), paste('hkostud1', { name: 'x' })));
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Short7')), paste('hkostud1')));          // eventId < 8
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'a'.repeat(41))), paste('hkostud1')));    // eventId > 40
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev-0000012')), paste('hkostud1')));      // not alphanumeric
    await assertFails(setDoc(doc(student, 'pasteEvents', pid('hkostud1', 'Ev00000013', 'raster-voll')), paste('hkostud1')));  // id block != data block
    await assertFails(setDoc(doc(anonSession, 'pasteEvents', pid('hkoanon1', 'Ev00000014')), paste('hkoanon1')));
    await assertFails(setDoc(doc(outsider, 'pasteEvents', pid('hkooutsider', 'Ev00000015')), paste('hkooutsider')));
    await assertFails(setDoc(doc(teacher, 'pasteEvents', pid('hkoteacher1', 'Ev00000016')), paste('hkoteacher1')));
});

test('17 pasteEvents: the person cannot read, change or delete; the teacher reads', async () => {
    const id = pid('hkostud1', 'Stored0001');
    await assertFails(getDoc(doc(student, 'pasteEvents', id)));
    await assertFails(getDocs(query(collection(student, 'pasteEvents'), where('uid', '==', 'hkostud1'))));
    await assertFails(setDoc(doc(student, 'pasteEvents', id), paste('hkostud1')));
    await assertFails(updateDoc(doc(student, 'pasteEvents', id), { chars: 1 }));
    await assertFails(deleteDoc(doc(student, 'pasteEvents', id)));
    await assertSucceeds(getDoc(doc(teacher, 'pasteEvents', id)));
    await assertSucceeds(getDocs(collection(teacher, 'pasteEvents')));
    await assertFails(deleteDoc(doc(teacher, 'pasteEvents', id)));
});

// ---- 18. classes --------------------------------------------------------------

test('18 classes: school account does not write; teacher writes valid ones; invalid values or keys denied', async () => {
    await assertFails(setDoc(doc(student, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 1, aktiv: true }));
    await assertFails(setDoc(doc(student, 'classes', CLASS), { variante: '4J', lehrjahr: 1, aktiv: true }));
    await assertFails(setDoc(doc(outsider, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 1, aktiv: true }));
    await assertSucceeds(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '2J', lehrjahr: 2, aktiv: true }));
    await assertSucceeds(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '4J', lehrjahr: 4, aktiv: false }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '5J', lehrjahr: 1, aktiv: true }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 1, aktiv: true, name: 'x' }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 1 }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 5, aktiv: true }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 0, aktiv: true }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: '1', aktiv: true }));
    await assertFails(setDoc(doc(teacher, 'classes', 'test-neu'), { variante: '3J', lehrjahr: 1, aktiv: 'ja' }));
    await assertFails(deleteDoc(doc(teacher, 'classes', 'test-neu')));                            // deactivate instead
});

// ---- emulator-only roster read ------------------------------------------------

test('students (emulator-only exception): own doc and teacher read, others not', async () => {
    await assertSucceeds(getDoc(doc(student, 'students', 'hkostud1')));
    await assertSucceeds(getDoc(doc(teacher, 'students', 'hkostud1')));
    await assertFails(getDoc(doc(student2, 'students', 'hkostud1')));
    await assertFails(getDoc(doc(outsider, 'students', 'hkostud1')));
    await assertFails(getDoc(doc(anon, 'students', 'hkostud1')));
    await assertFails(getDocs(collection(student, 'students')));
});
