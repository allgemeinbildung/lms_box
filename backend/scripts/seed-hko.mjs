// Seeds the Firebase EMULATORS with fictional HKO test data (named database `hko`).
// Never touches the real project: it refuses to run unless both emulator host variables
// point at this machine.
//
//   npm run emu -- emulators:exec --only auth,firestore "node scripts/seed-hko.mjs"
//   (alternative: a separate HKO test config, firebase.hko-test.json with its own ports,
//    may exist - pass it with --config; this script does not depend on it)
//   against `npm run emulators` running in another terminal (PowerShell):
//     $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8280'; $env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190'; node scripts/seed-hko.mjs
//
// What it writes (all fictional):
//   hko        classes/{classId} = { variante, lehrjahr, aktiv }  (Handoff 5.1)
//   (default)  students/{uid}    one fictional learner per active class
//   auth       one account per learner + one teacher (custom claim role=teacher)
// Password for all accounts: env SEED_PASSWORD, default below (emulator only, not a secret).
// Safe to run twice: every user and document is overwritten in place (set, never add).
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    const value = process.env[name];
    if (!value || !LOCAL.test(value)) {
        console.error(`Refusing to run: ${name} is ${value ? `"${value}" (not a local emulator)` : 'not set'}.`);
        console.error('This script seeds the emulators only. See the header of this file.');
        process.exit(1);
    }
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('Refusing to run: GOOGLE_APPLICATION_CREDENTIALS is set. The seed needs no credentials.');
    process.exit(1);
}

// Must match the projectId the page uses (js/config.js), or the page will not see the data.
const projectId = process.env.GCLOUD_PROJECT || 'interactive-media-2a1fc';
const password = process.env.SEED_PASSWORD || 'lmsbox-test-1234';

const app = initializeApp({ projectId });
const auth = getAuth(app);
const roster = getFirestore(app);          // (default): students/{uid}
const hko = getFirestore(app, 'hkobox');      // named database for the HKO parallel system

// Invented class ids, recognisably fictional. Not real classes.
const classes = [
    { id: 'test-3j-a', variante: '3J', lehrjahr: 1, aktiv: true },
    { id: 'test-4j-a', variante: '4J', lehrjahr: 1, aktiv: true },
    { id: 'test-2j-a', variante: '2J', lehrjahr: 1, aktiv: true },
    { id: 'test-3j-inaktiv', variante: '3J', lehrjahr: 1, aktiv: false },
];

// Fictional people only: one learner per active class, plus one in the inactive class.
const students = [
    { uid: 'hko-seed-3j', username: 'test.3j', name: 'Test Lernende 3J', classId: 'test-3j-a' },
    { uid: 'hko-seed-4j', username: 'test.4j', name: 'Test Lernende 4J', classId: 'test-4j-a' },
    { uid: 'hko-seed-2j', username: 'test.2j', name: 'Test Lernende 2J', classId: 'test-2j-a' },
    { uid: 'hko-seed-inaktiv', username: 'test.inaktiv', name: 'Test Lernende Inaktiv', classId: 'test-3j-inaktiv' },
    // P1 (added 2026-10-16, plan 6.1/6.2 (f)): a second 3J account, a class without a
    // classes/ document, and one person in two classes of different variants (the first counts).
    { uid: 'hko-seed-3j-b', username: 'test.3jb', name: 'Test Lernende 3J B', classId: 'test-3j-a' },
    { uid: 'hko-seed-unbekannt', username: 'test.unbekannt', name: 'Test Lernende Unbekannt', classId: 'test-unbekannt' },
    { uid: 'hko-seed-zwei', username: 'test.zwei', name: 'Test Lernende Zwei Klassen', classId: 'test-3j-a', classIds: ['test-3j-a', 'test-4j-a'] },
];
const teacher = { uid: 'hko-seed-teacher', email: 'test.lehrperson@lernende.bbw.ch', name: 'Test Lehrperson' };

async function upsertUser({ uid, email, displayName }) {
    const props = { email, password, displayName, emailVerified: true };
    try {
        await auth.updateUser(uid, props);
    } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        await auth.createUser({ uid, ...props });
    }
}

for (const c of classes) {
    await hko.doc(`classes/${c.id}`).set({ variante: c.variante, lehrjahr: c.lehrjahr, aktiv: c.aktiv });
}

for (const s of students) {
    const bbwEmail = `${s.username}@lernende.bbw.ch`;
    await upsertUser({ uid: s.uid, email: bbwEmail, displayName: s.name });
    await auth.setCustomUserClaims(s.uid, null);
    await roster.doc(`students/${s.uid}`).set({
        name: s.name,
        username: s.username,
        bbwEmail,
        classId: s.classId,
        classIds: s.classIds || [s.classId],
        mustSetPassword: false,
        active: true,
    });
}

await upsertUser({ uid: teacher.uid, email: teacher.email, displayName: teacher.name });
await auth.setCustomUserClaims(teacher.uid, { role: 'teacher' });

console.log(`Seeded project "${projectId}" in the emulators:`);
console.log(`  hko        classes/{classId} x ${classes.length}`);
for (const c of classes) console.log(`             ${c.id}  ${c.variante}  LJ${c.lehrjahr}  aktiv=${c.aktiv}`);
console.log(`  (default)  students/{uid} x ${students.length}`);
console.log(`  auth       ${students.length} learners + 1 teacher (claim role=teacher)`);
for (const s of students) console.log(`             ${s.username}@lernende.bbw.ch  ${s.classId}`);
console.log(`             ${teacher.email}  teacher`);
console.log('  password   from SEED_PASSWORD, or the default in scripts/seed-hko.mjs');
