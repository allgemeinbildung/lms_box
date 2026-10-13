// Seeds the Firebase EMULATORS with fictional test data. Never touches the real project:
// it refuses to run unless both emulator host variables point at this machine.
//
//   inside emulators:exec:   firebase emulators:exec "npm run seed"     (variables are set for you)
//   against `npm run emulators` running in another terminal (PowerShell):
//     $env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8280'; $env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190'; npm run seed
//
// Password for all seeded accounts: env SEED_PASSWORD, default below (emulator only, not a secret).
// Safe to run twice: every user and document is overwritten in place.
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

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
const roster = getFirestore(app);              // (default): students/{uid}
const box = getFirestore(app, 'lmsbox');

// Fictional people only.
const students = [
    { uid: 'seed-anna', username: 'anna.beispiel', name: 'Anna Beispiel', classId: 'TestA' },
    { uid: 'seed-ben', username: 'ben.muster', name: 'Ben Muster', classId: 'TestA' },
    { uid: 'seed-cleo', username: 'cleo.probe', name: 'Cleo Probe', classId: 'TestB' },
];
const teacher = { uid: 'seed-teacher', email: 'tina.test@lernende.bbw.ch', name: 'Tina Test' };

async function upsertUser({ uid, email, displayName }) {
    const props = { email, password, displayName, emailVerified: true };
    try {
        await auth.updateUser(uid, props);
    } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        await auth.createUser({ uid, ...props });
    }
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
        classIds: [s.classId],
        mustSetPassword: false,
        active: true,
    });
}

await upsertUser({ uid: teacher.uid, email: teacher.email, displayName: teacher.name });
await auth.setCustomUserClaims(teacher.uid, { role: 'teacher' });

// One small fictional assignment, same shape as content/*.json plus `assignmentId`.
// The sub-assignment keys carry dots and umlauts on purpose - written as a whole map with set().
const assignmentId = '0.1 Testauftrag Müller';
await box.doc(`assignments/${encodeURIComponent(assignmentId)}`).set({
    assignmentId,
    assignmentTitle: 'Testauftrag (Emulator)',
    formativ: false,
    solution_keys: ['test'],
    subAssignments: {
        'A. Grundsätze der Übung': {
            type: 'quill',
            questions: [
                { id: 'q1', text: 'Beschreiben Sie in zwei Sätzen, was Sie hier testen.' },
                { id: 'q2', text: 'Nennen Sie einen Grund für regelmässiges Speichern.' },
            ],
            solution: { q1: 'Freie Antwort.', q2: 'Damit nichts verloren geht.' },
        },
        'B. Zweiter Teil (v1.2)': {
            type: 'quill',
            questions: [{ id: 'q1', text: 'Was würden Sie an diesem Auftrag ändern?' }],
            solution: { q1: 'Freie Antwort.' },
        },
    },
    seededAt: FieldValue.serverTimestamp(),
});

console.log(`Seeded project "${projectId}" in the emulators:`);
console.log(`  auth       ${students.length} students + 1 teacher (claim role=teacher)`);
for (const s of students) console.log(`             ${s.username}  ${s.classId}`);
console.log(`             ${teacher.email.split('@')[0]}  teacher`);
console.log(`  (default)  students/{uid} x ${students.length}`);
console.log(`  lmsbox     assignments/${encodeURIComponent(assignmentId)}`);
console.log('  password   from SEED_PASSWORD, or the default in scripts/seed-emulator.mjs');
