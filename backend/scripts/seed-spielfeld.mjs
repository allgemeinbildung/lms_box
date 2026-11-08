// Seeds the EMULATORS with a fictional Spielfeld class, for dashboard/spielfeld.html and the
// class analysis. Never touches the real project (same guards as seed-emulator.mjs).
//
//   node scripts/seed-spielfeld.mjs --content "<spielfeld>/out/lmsbox/Spielfeld 2.1.json" --bank "<spielfeld>/data/demo"
//          [--klasse SPF-Test] [--karten 6] [--langsam]
//
// --content  the exported assignment (render/export_lmsbox.py); written to assignments and
//            publicAssignments, with klassenanalyse: true.
// --bank     folder with liveview-bank-*.json (fictional answers and feedback, four variants per question).
// --karten   how many cards (sub-assignments, in content order) the class has worked on.
// --langsam  one draft at a time with a pause, so that the Firestore trigger of the class analysis
//            sees the class grow (5, 8, 11 …) as it would in a lesson.
//
// Accounts: teacher spf.lehrer@lernende.bbw.ch (role teacher), students tier.<name>@lernende.bbw.ch,
// password env SEED_PASSWORD or the default of seed-emulator.mjs. Fictional names only (animals).
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { publicCopy } from './public-assignment.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) { console.error(`Refusing to run: ${name} is not a local emulator.`); process.exit(1); }
}
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Refusing to run: GOOGLE_APPLICATION_CREDENTIALS is set.'); process.exit(1); }

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const contentPath = arg('--content');
const bankDir = arg('--bank');
if (!contentPath || !bankDir) { console.error('Usage: --content <json> --bank <folder>'); process.exit(1); }
const KLASSE = arg('--klasse', 'SPF-Test');
const KARTEN = Number(arg('--karten', '6'));
const LANGSAM = process.argv.includes('--langsam');
const password = process.env.SEED_PASSWORD || 'lmsbox-test-1234';

const app = initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'interactive-media-2a1fc' });
const auth = getAuth(app);
const roster = getFirestore(app);
const box = getFirestore(app, 'lmsbox');

const content = JSON.parse(readFileSync(contentPath, 'utf8'));
const aid = contentPath.replace(/^.*[\\/]/, '').replace(/\.json$/, '');
const bank = {};
for (const f of readdirSync(bankDir).filter((f) => /^liveview-bank-.*\.json$/.test(f))) Object.assign(bank, JSON.parse(readFileSync(join(bankDir, f), 'utf8')));

async function user(uid, email, displayName, claims) {
    const props = { email, password, displayName, emailVerified: true };
    try { await auth.updateUser(uid, props); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; await auth.createUser({ uid, ...props }); }
    await auth.setCustomUserClaims(uid, claims);
}

await user('spf-lehrer', 'spf.lehrer@lernende.bbw.ch', 'SPF Lehrer', { role: 'teacher' });
const TIERE = ['Biber', 'Dachs', 'Eule', 'Falke', 'Fuchs', 'Gämse', 'Hase', 'Hirsch', 'Igel', 'Kauz', 'Kranich', 'Luchs'];
const lernende = TIERE.map((t, i) => ({ uid: `spf-${String(i + 1).padStart(2, '0')}`, name: `${t} Test`, username: `tier.${t.toLowerCase().replace('ä', 'ae')}` }));
for (const s of lernende) {
    await user(s.uid, `${s.username}@lernende.bbw.ch`, s.name, null);
    await roster.doc(`students/${s.uid}`).set({ name: s.name, username: s.username, bbwEmail: `${s.username}@lernende.bbw.ch`, classId: KLASSE, classIds: [KLASSE], mustSetPassword: false, active: true });
}
const assignment = { ...content, assignmentId: aid, klassenanalyse: true };
await box.doc(`assignments/${encodeURIComponent(aid)}`).set(assignment);
await box.doc(`publicAssignments/${encodeURIComponent(aid)}`).set(publicCopy(assignment));

// A fixed pseudo-random sequence, so the class looks the same each time.
let seed = 2112;
const R = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const html = (t) => `<p>${String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '</p><p>')}</p>`;
const result = (q, r) => ({
    zustand: 'vollstaendig',
    kriterien: (q.formativ?.rubrik || []).map((k) => ({ id: k.id, label: k.label, status: r?.[k.id]?.status || 'nicht_beurteilbar', hinweis: r?.[k.id]?.hinweis || '', beleg: r?.[k.id]?.beleg || null, grund: null })),
});

const subs = Object.entries(content.subAssignments).slice(0, KARTEN);
const usage = new Map(lernende.map((s) => [s.uid, {}]));
let n = 0;
const entwuerfe = [];
for (const [subId, sub] of subs) {
    for (const [i, s] of lernende.entries()) {
        const x = R();
        if (x < 0.12) continue;                               // not started
        const teil = x < 0.3;                                 // started, not completed
        const answers = [];
        const tag = new Date(Date.now() - (subs.length - n) * 3600 * 1000).toISOString();
        sub.questions.forEach((q, j) => {
            if (teil && j === sub.questions.length - 1) return;
            const varianten = bank[q.id] || [{ a1: `Antwort von ${s.name.split(' ')[0]} zu ${q.id}.` }];
            const v = varianten[Math.floor(R() * varianten.length)];
            const zweit = Boolean(v.a2) && R() < 0.8;
            answers.push({ questionId: q.id, answer: html(zweit ? v.a2 : v.a1) });
            if (!v.r1 || R() < 0.08) return;                  // no feedback asked
            const erst = { at: tag, result: result(q, v.r1), gesendet: v.a1, request_id: `seed-${i}-${q.id}-1` };
            usage.get(s.uid)[`${subId}::${q.id}`] = zweit && v.r2
                ? { state: 'done', at: tag, result: result(q, v.r2), gesendet: v.a2, request_id: `seed-${i}-${q.id}-2`, frueher: [erst] }
                : { state: 'done', ...erst };
        });
        if (i === 4 && answers[0]) answers[0].answer = html(`${answers[0].answer.replace(/<[^>]+>/g, '')} Gruss, Fuchs Test`);   // signs with own name
        entwuerfe.push([`drafts/${s.uid}__${encodeURIComponent(aid)}__${encodeURIComponent(subId)}`, {
            uid: s.uid, classId: KLASSE, assignmentId: aid, subId, title: subId, type: 'quill',
            questions: sub.questions.map((q) => ({ id: q.id, text: String(q.text).slice(0, 4000) })), answers,
        }]);
    }
    n += 1;
}
// Feedback first, so that an analysis the drafts trigger already sees it.
for (const s of lernende) {
    await box.doc(`formativUsage/${s.uid}__${encodeURIComponent(aid)}`).set({ uid: s.uid, assignmentId: aid, slots: usage.get(s.uid) });
}
for (const [path, d] of entwuerfe) {
    await box.doc(path).set({ ...d, updatedAt: FieldValue.serverTimestamp() });
    if (LANGSAM) await new Promise((r) => setTimeout(r, 400));
}
// One paste hint, for the «Lernende» view.
await box.doc(`pasteEvents/spf-05__${encodeURIComponent(aid)}__${encodeURIComponent(subs[0][0])}__seedpaste01`).set({
    uid: 'spf-05', assignmentId: aid, subId: subs[0][0], questionId: subs[0][1].questions[0].id, kind: 'bulk', chars: 180, excerpt: 'eingefügter Text', at: FieldValue.serverTimestamp(),
});
console.log(`Seeded ${KLASSE}: ${lernende.length} students, ${subs.length} cards of «${aid}», teacher spf.lehrer@lernende.bbw.ch`);
process.exit(0);
