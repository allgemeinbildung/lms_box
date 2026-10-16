// Browser test of the teacher dashboard (dashboard/liveview.html) together with the student
// page (index.html): the whole loop student -> teacher -> student, against the EMULATORS.
// Run: npm run test:e2e:dashboard
//   (= emulators:exec --only auth,firestore,functions; this file seeds, serves app/ itself,
//      starts the fake formativ model and a fake evaluator, and drives the installed Chrome)
//
// Nothing real is called: the formativ callable talks to functions/test/fake-model.js
// (FORMATIV_URL in functions/.env.local), and the dashboard's calls to http://localhost:5000
// are routed to the fake evaluator below. Needs internet only for the two CDNs the pages
// load (gstatic Firebase SDK, Quill). Every other outside request is blocked and fails the run.
// Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { publicCopy } from '../scripts/public-assignment.mjs';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { sanitizerCases } from './sanitize.test.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:dashboard`);
        process.exit(1);
    }
}
{
    const running = await (await fetch(`http://${process.env.FIREBASE_EMULATOR_HUB}/emulators`)).json();
    if (!running.functions || !running.auth || !running.firestore) {
        console.error('Refusing to run: the auth, firestore and functions emulators must all be running.');
        process.exit(1);
    }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));

// Seed (fictional accounts). The script carries its own emulator guard.
await import('../scripts/seed-emulator.mjs');
const adminApp = getApps()[0];
const box = getFirestore(adminApp, 'lmsbox');
const roster = getFirestore(adminApp);              // (default): students/{uid}

const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed
const enc = encodeURIComponent;
const A = '0.3 E2E Dashboard «Prüfung»';
const SUB = 'A. Erster Teil (v1.2)';
const ANNA = 'seed-anna';
const BEN = 'seed-ben';
const pairId = (uid) => `${uid}__${enc(A)}`;
const SOLUTION_SUFFIX = ' (Lösung: Zweiundvierzig)';

// ---- fixtures ----------------------------------------------------------------------------

const ASSIGNMENT = {
    assignmentId: A,
    assignmentTitle: 'Dashboard (E2E)',
    solution_keys: ['Zweiundvierzig'],
    subAssignments: {
        [SUB]: {
            type: 'quill',
            questions: [
                { id: 'q1', text: 'Beschreiben Sie Ihren Arbeitsweg. Nennen Sie zwei Verkehrsmittel.', formativ: true },
                { id: 'q2', text: 'Was würden Sie daran ändern?' },
            ],
            solution: { solutions: [
                { id: 'q1', answer: '<p>Freie Antwort mit zwei Verkehrsmitteln.</p>' },
                { id: 'q2', answer: '<p>Freie Antwort.</p>' },
            ] },
        },
    },
};
await box.doc(`assignments/${enc(A)}`).set(ASSIGNMENT);
await box.doc(`publicAssignments/${enc(A)}`).set(publicCopy(ASSIGNMENT));   // what the student page reads
// Leftovers of an earlier run against the same emulators.
for (const c of ['drafts', 'feedback', 'feedbackReleased', 'formativUsage', 'pasteEvents']) {
    for (const d of (await box.collection(c).get()).docs) await d.ref.delete();
}
// The roster entries steps (h) to (l) add (the seed's own three are overwritten by the seed).
for (const d of (await roster.collection('students').get()).docs) if (d.id.startsWith('e2e-')) await d.ref.delete();

// ---- hostile and odd fixtures for steps (g) to (l) -------------------------------------------
// Every payload would set window.__xss or request the host xss.invalid (which the route below
// would record in `blocked`) if it were ever run or loaded.

const xss = (tag) => `window.__xss='${tag}'`;
const MAL = 'e2e-mallory';
const WANDA = 'e2e-wanda';
const LEO = 'e2e-leo';
const MAL_NAME = `Mallory <img src="http://xss.invalid/name.png" onerror="${xss('name')}"><b>Fett</b>`;
const SEED_A = '0.1 Testauftrag Müller';            // from the seed: exists in `assignments`
const INVENTED = `9.9 Erfunden <img src="http://xss.invalid/ass.png" onerror="${xss('assignment')}">`;
const EVIL_TITLE = `Titel <img src="http://xss.invalid/title.png" onerror="${xss('title')}"><script>${xss('titlescript')}</script>`;
const EVIL_QID = `q3"]<img src="http://xss.invalid/qid.png" onerror="${xss('qid')}">`;
const EVIL_QUESTIONS = [
    { id: 'q1', text: `Frage **wichtig** <img src="http://xss.invalid/q.png" onerror="${xss('question')}">` },
    { id: 'q2', text: `Zweite <script>${xss('question2')}</script><svg onload="${xss('questionsvg')}"></svg>` },
    { id: EVIL_QID, text: 'Dritte' },
];
const EVIL_ANSWER = [
    '<p>Sichtbarer Text 7001 <strong>fett</strong> <em>kursiv</em> <u>unterstrichen</u></p>',
    '<ol><li>eins</li><li class="ql-indent-1">zwei</li></ol><ul><li>punkt</li></ul>',
    `<img src="http://xss.invalid/a.png" onerror="${xss('img')}">`,
    `<svg onload="${xss('svg')}"><circle r="1"></circle></svg>`,
    `<a href="javascript:${xss('href')}">klick-mich</a>`,
    `<p onclick="${xss('onclick')}" onmouseover="${xss('mouseover')}" id="login-overlay" class="visible ql-align-center">absatz-mit-handler</p>`,
    '<style>#live-grid, .student-card { display: none !important; }</style>',
    '<p style="position:fixed; inset:0; background:url(http://xss.invalid/style.png)">stil-absatz</p>',
    `<script>${xss('script')}</script>`,
    `<iframe srcdoc="<script>parent.__xss='iframe'</script>"></iframe>`,
    `<form action="javascript:${xss('form')}"><input name="x" autofocus onfocus="${xss('focus')}"><button>senden</button></form>`,
    `<math><mtext><img src="http://xss.invalid/m.png" onerror="${xss('math')}"></mtext></math>`,
    `<details open ontoggle="${xss('toggle')}"><summary>auf</summary>zu</details>`,
    '<object data="http://xss.invalid/o"></object><link rel="stylesheet" href="http://xss.invalid/c.css">',
].join('');
const GOOD_ANSWER = '<p>Zweite Antwort <b>b</b> und <i>i</i> 7002</p>';
const MAL_ANSWERS = [
    { questionId: 'q1', answer: EVIL_ANSWER },
    { questionId: 'q2', answer: GOOD_ANSWER },
    { questionId: EVIL_QID, answer: '<p>Dritte Antwort 7003</p>' },
];
// What the (fake) evaluator sends back for Mallory: model output is not markup either.
const EVIL_DATE = `13.10.2026 <img src="http://xss.invalid/date.png" onerror="${xss('date')}">`;
const EVIL_CONCISE = `Kurz "<img src="http://xss.invalid/c.png" onerror="${xss('concise')}">`;
const EVIL_DETAILED = `Lang </textarea></div><script>${xss('detailed')}</script><img src="http://xss.invalid/d.png" onerror="${xss('detailed2')}">`;
const EVIL_QTEXT = `Bewertete Frage <img src="http://xss.invalid/qt.png" onerror="${xss('qtext')}">`;
const TEXT_WANDA = 'Wandas Text aus der anderen Klasse 6001';
const TEXT_LEO = 'Leos Text ohne Klasse 6002';
const TEXT_GROSS = 'Text der einunddreissigsten Person 6031';
const TEXT_CLEO = 'Cleos Text mit falschem Klassenstempel 6666';
const BIG = Array.from({ length: 31 }, (_, i) => ({ uid: `e2e-g${String(i + 1).padStart(2, '0')}`, name: `Gross ${String(i + 1).padStart(2, '0')}` }));

// ---- fake formativ model (the callable's FORMATIV_URL) --------------------------------------

const envLocal = readFileSync(join(HERE, '..', 'functions', '.env.local'), 'utf8');
const modelUrl = new URL(/^FORMATIV_URL=(.+)$/m.exec(envLocal)[1].trim());
assert.ok(['127.0.0.1', 'localhost'].includes(modelUrl.hostname), 'functions/.env.local must point FORMATIV_URL at this machine');
const { startFakeModel } = createRequire(import.meta.url)('../functions/test/fake-model.js');
const model = await startFakeModel({ port: Number(modelUrl.port) });

// ---- fake evaluator: the four routes of evaluator/live_server.py, fixed fictional results ----
// Like the real one it keeps a history per class / assignment / student NAME and returns
// `student_name` and `class_name` at the top level. It also puts a `student_name` INTO the
// history entry (the real one does not) so the test can show that the dashboard strips
// names before it writes to Firestore.

const evaluatorCalls = [];
const evaluatorFiles = new Map();
const fileKey = (b) => `${b.className}/${b.assignmentId}/${b.studentName}`;
function evaluate(body) {
    const subs = body.studentData?.assignments?.[body.assignmentId] || {};
    const hostile = body.studentName === MAL_NAME;   // for Mallory the evaluator's own texts carry markup
    const results = [];
    for (const [subId, master] of Object.entries(ASSIGNMENT.subAssignments)) {
        for (const q of master.questions) {
            const given = (subs[subId]?.answers || []).some((a) => a.questionId === q.id);
            results.push({
                question_id: `${subId}_${q.id}`,
                question_text: hostile ? EVIL_QTEXT : q.text,
                score: given ? 2 : 0,
                concise_feedback: hostile ? EVIL_CONCISE : given ? `Fiktiv kurz zu ${q.id}.` : 'Keine Antwort.',
                detailed_feedback: hostile ? EVIL_DETAILED : `Fiktiv ausführlich zu ${q.id}: ein Verkehrsmittel fehlt.${SOLUTION_SUFFIX}`,
            });
        }
    }
    return results;
}
const evaluator = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    const route = new URL(req.url, 'http://x').pathname;
    evaluatorCalls.push({ route, body });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.method !== 'POST') return send(405, { error: 'POST only' });
    if (route === '/get_master_assignment') {
        return body.assignmentId === A ? send(200, ASSIGNMENT) : send(404, { error: 'Assignment not found locally' });
    }
    if (route === '/assess') {
        if (!body.assignmentId || !body.studentData || !body.studentName) return send(400, { error: 'Missing data' });
        const file = evaluatorFiles.get(fileKey(body))
            || { student_name: body.studentName, class_name: body.className, assignment_id: body.assignmentId, history: [] };
        file.history.push({ timestamp: 1791900000, date_str: body.studentName === MAL_NAME ? EVIL_DATE : '13.10.2026 15:00', student_name: body.studentName, results: evaluate(body) });
        evaluatorFiles.set(fileKey(body), file);
        return send(200, file);
    }
    if (route === '/get_feedback') {
        const file = evaluatorFiles.get(fileKey(body));
        return send(200, file ? { found: true, data: file } : { found: false });
    }
    if (route === '/update_feedback') {
        const file = evaluatorFiles.get(fileKey(body));
        const result = file?.history.at(-1).results.find((r) => r.question_id === body.questionId);
        if (!result) return send(404, { error: 'Feedback file not found' });
        Object.assign(result, { score: Number(body.score), concise_feedback: body.concise_feedback, detailed_feedback: body.detailed_feedback, manually_edited: true });
        return send(200, { status: 'success', data: file });
    }
    return send(404, { error: 'unknown route' });
});
await new Promise((resolve, reject) => { evaluator.once('error', reject); evaluator.listen(0, '127.0.0.1', resolve); });
const EVALUATOR = `http://127.0.0.1:${evaluator.address().port}`;

// ---- static server for app/ -----------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/(index\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css|dashboard\/(liveview\.html|liveview\.js|teacher\.css|modules\/[\w.-]+\.js))$/;
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !SERVED.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const PORT = server.address().port;
const STUDENT_URL = `http://127.0.0.1:${PORT}/index.html?assignmentId=${enc(A)}&subId=${enc(SUB)}`;
const DASHBOARD_URL = `http://127.0.0.1:${PORT}/dashboard/liveview.html`;

// ---- helpers ---------------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const blocked = [];
const browserLog = [];

async function newContext(browser, label) {
    const context = await browser.newContext();
    context.setDefaultTimeout(20000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        // Port 5000 is the real evaluator's address: it must be answered by the route below, never by the network.
        if (/^https?:$/.test(url.protocol) && url.port !== '5000' && ALLOWED_HOSTS.has(url.hostname)) return route.continue();
        if (!/^https?:$/.test(url.protocol)) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    // The dashboard's evaluator calls go to the fake evaluator (a real HTTP round trip from here).
    await context.route('http://localhost:5000/**', async (route) => {
        const request = route.request();
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
        const path = new URL(request.url()).pathname;
        const answer = await fetch(`${EVALUATOR}${path}`, {
            method: request.method(), headers: { 'Content-Type': 'application/json' }, body: request.postData(),
        });
        return route.fulfill({ status: answer.status, headers: { ...CORS, 'Content-Type': 'application/json' }, body: await answer.text() });
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`${label} pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`${label} console: ${m.text()}`); });
    });
    return context;
}

async function studentLogin(page, username) {
    await page.goto(STUDENT_URL);
    await page.locator('#guest-login').click();   // not signed in: the page opens as a guest
    await page.locator('#auth-username').fill(username);
    await page.locator('#auth-password').fill(PASSWORD);
    await page.locator('#auth-login-btn').click();
    await page.locator('#auth-user').waitFor();
    await page.locator('.ql-editor').first().waitFor();
}
async function dashboardLogin(page, username) {
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('#login-btn').click();
}
async function typeInto(page, n, text) {
    await page.locator('.ql-editor').nth(n).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text);
}
/** Reloads the student page and waits until the draft and everything after it has arrived. */
async function reloadStudent(page, expectText) {
    await page.reload();
    await page.locator('.ql-editor').first().waitFor();
    await page.waitForFunction((t) => document.querySelector('.ql-editor')?.innerText.includes(t), expectText);
    await page.waitForTimeout(1500);   // released feedback and formativ status are fetched after the draft
    return page.locator('#content-renderer').innerText();
}
/** Reads one document with the page's own Firestore handle and session: 'exists' | 'missing' | error code. */
const readAs = (page, collection, id) => page.evaluate(async ([c, i]) => {
    const fb = await import('/js/firebase.js');
    try { return (await fb.getDoc(fb.doc(fb.db, c, i))).exists() ? 'exists' : 'missing'; } catch (e) { return e.code; }
}, [collection, id]);

async function until(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() > end) throw new Error(`Timeout: ${what}`);
        await new Promise((r) => setTimeout(r, 150));
    }
}
const docData = async (path) => { const s = await box.doc(path).get(); return s.exists ? s.data() : null; };
const card = (page, name) => page.locator(`.student-card[data-student-name="${name}"]`);

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

// ---- the run ---------------------------------------------------------------------------------

const TEXT_1 = 'Ich fahre jeden Morgen mit dem Velo zur Arbeit 4711';
const TEXT_2 = ' und danach mit dem Zug 0815';
const TEXT_BEN = 'Bens eigener Weg führt über die Brücke 2323';
const TEXT_GHOST = 'Geistertext ohne Klassenliste 9999';
const KURZ = 'Fiktiv kurz zu q1.';
const LANG = 'Fiktiv ausführlich zu q1: ein Verkehrsmittel fehlt.';

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const teacherCtx = await newContext(browser, 'teacher');
    const annaCtx = await newContext(browser, 'anna');
    const benCtx = await newContext(browser, 'ben');
    const tp = await teacherCtx.newPage();
    const ap = await annaCtx.newPage();
    const bp = await benCtx.newPage();
    let teacherLoads = 0;
    tp.on('load', () => { teacherLoads += 1; });

    await step('(a) dashboard refuses a student account (German message, signed out); the teacher gets in', async () => {
        await tp.goto(DASHBOARD_URL);
        await tp.locator('#login-overlay.visible').waitFor();
        assert.equal(await tp.locator('#teacher-key-input').count(), 0, 'no teacher key field any more');

        await dashboardLogin(tp, 'anna.beispiel');
        await tp.locator('#login-status:not(:empty)').waitFor();
        assert.match(await tp.locator('#login-status').innerText(), /Kein Zugang: Dieses Konto ist kein Lehrpersonen-Konto/);
        await tp.waitForFunction(async () => (await import('/js/firebase.js')).auth.currentUser === null);
        assert.equal(await tp.locator('#login-overlay.visible').count(), 1);
        assert.equal(await tp.locator('#class-select').isDisabled(), true, 'no roster was loaded for the student');
        assert.equal(await tp.locator('.student-card').count(), 0);
        assert.match(await tp.locator('#login-status').innerText(), /Kein Zugang/, 'the message stays after the sign-out');

        await dashboardLogin(tp, 'tina.test');
        await tp.locator('#login-overlay').waitFor({ state: 'hidden' });
        await tp.locator('#class-select option[value="TestA"]').waitFor({ state: 'attached' });
        const classes = await tp.locator('#class-select option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
        assert.deepEqual(classes, ['TestA', 'TestB'], 'classes come from the roster, ids unchanged');
        assert.equal(await tp.evaluate(() => sessionStorage.getItem('teacherKey')), null);
    });

    await step('(b) a draft typed by Anna appears live under her name and class; a second edit updates it', async () => {
        await tp.locator('#class-select').selectOption('TestA');
        await tp.locator('#assignment-select option', { hasText: 'Keine Aufgaben gefunden.' }).waitFor({ state: 'attached' });
        const loadsBefore = teacherLoads;

        await studentLogin(ap, 'anna.beispiel');
        await typeInto(ap, 0, TEXT_1);
        await ap.locator('#save-status[data-state="cloud"]').waitFor();

        // the assignment shows up in the open dashboard by itself
        await tp.locator(`#assignment-select option[value="${A}"]`).waitFor({ state: 'attached' });
        await tp.locator('#assignment-select').selectOption(A);
        await card(tp, 'Anna Beispiel').waitFor();
        assert.equal(await tp.locator('.student-card').count(), 1, 'only students with a draft get a card');
        assert.match(await card(tp, 'Anna Beispiel').locator('.student-card-content').innerText(), new RegExp(TEXT_1));
        assert.equal(await card(tp, 'Anna Beispiel').getAttribute('data-student-key'), ANNA, 'studentKey is the uid');

        // open the card, tick it; both survive the live update
        await card(tp, 'Anna Beispiel').locator('.student-name').click();
        await card(tp, 'Anna Beispiel').locator('.student-checkbox').check();
        await typeInto(ap, 0, TEXT_2);
        await card(tp, 'Anna Beispiel').locator('.read-only-answer', { hasText: TEXT_1 + TEXT_2 }).waitFor();
        assert.equal(await tp.locator('.student-card.open[data-student-name="Anna Beispiel"]').count(), 1);
        assert.equal(await card(tp, 'Anna Beispiel').locator('.student-checkbox').isChecked(), true);

        // a draft whose uid is on no roster, then a new student: only the student gets a card
        await box.doc(`drafts/ghost-uid__${enc(A)}__${enc(SUB)}`).set({
            uid: 'ghost-uid', classId: 'TestA', assignmentId: A, subId: SUB, title: SUB, type: 'quill',
            questions: [{ id: 'q1', text: 'x' }], answers: [{ questionId: 'q1', answer: `<p>${TEXT_GHOST}</p>` }], updatedAt: Timestamp.now(),
        });
        await studentLogin(bp, 'ben.muster');
        await typeInto(bp, 0, TEXT_BEN);
        await card(tp, 'Ben Muster').locator('.read-only-answer', { hasText: TEXT_BEN }).waitFor({ state: 'attached' });   // his card is closed
        assert.deepEqual(await tp.locator('.student-card').evaluateAll((cs) => cs.map((c) => c.dataset.studentName).sort()), ['Anna Beispiel', 'Ben Muster']);
        assert.doesNotMatch(await tp.locator('body').innerText(), new RegExp(`${TEXT_GHOST}|ghost-uid`));
        assert.equal(teacherLoads, loadsBefore, 'the dashboard page was not reloaded');

        // stored shape: no name in the draft
        const d = await docData(`drafts/${ANNA}__${enc(A)}__${enc(SUB)}`);
        assert.deepEqual(Object.keys(d).sort(), ['answers', 'assignmentId', 'classId', 'questions', 'subId', 'title', 'type', 'uid', 'updatedAt']);
    });

    await step('(c) formativ through the real callable: shown to Anna, second request refused, teacher sees entry and sent text', async () => {
        await ap.locator('.formativ-button').first().click();
        await ap.locator('.formativ-panel', { hasText: 'Simulierter Hinweis' }).first().waitFor();
        assert.equal(await ap.locator('.formativ-button').first().isDisabled(), true);
        assert.equal(await ap.locator('.formativ-button').first().innerText(), 'Rückmeldung erhalten');
        assert.equal(await ap.locator('.formativ-button').count(), 1, 'only q1 has formativ switched on');

        assert.equal(model.calls.length, 1);
        const sent = model.calls[0].body;
        assert.equal(sent.antwort, TEXT_1 + TEXT_2);
        assert.doesNotMatch(JSON.stringify(sent), /Anna|Beispiel|seed-anna|TestA/, 'the model request carries no name, uid or class');

        // a second request for the same field, straight at the callable: refused, the model is not asked again
        const second = await ap.evaluate(async ([a, s]) => {
            const api = await import('/js/api.js');
            try { await api.requestFormativ(a, s, 'q1', '<p>Ein zweiter Versuch mit genug vielen Wörtern, damit die Mindestzahl von fünfzehn Wörtern sicher erreicht ist.</p>'); return { accepted: true }; }
            catch (e) { return { code: e.code, status: e.status, hasResult: Boolean(e.result?.kriterien?.length) }; }
        }, [A, SUB]);
        assert.deepEqual(second, { code: 'already_used', status: 'functions/already-exists', hasResult: true });
        assert.equal(model.calls.length, 1);

        // after a reload the page knows it from boxFormativStatus
        const text = await reloadStudent(ap, TEXT_1);
        assert.match(text, /Simulierter Hinweis/);
        assert.equal(await ap.locator('.formativ-button').first().isDisabled(), true);

        const usage = await docData(`formativUsage/${pairId(ANNA)}`);
        assert.equal(usage.uid, ANNA);
        assert.equal(usage.assignmentId, A);
        assert.deepEqual(Object.keys(usage.slots), [`${SUB}::q1`]);
        assert.equal(usage.slots[`${SUB}::q1`].state, 'done');
        assert.doesNotMatch(JSON.stringify(usage), /Anna|Beispiel/, 'no name in formativUsage');

        // the teacher: entry under Anna's answer, with the text that went to the model
        await tp.locator('#refresh-btn').click();
        const entry = card(tp, 'Anna Beispiel').locator('.formativ-teacher');
        await entry.waitFor({ state: 'attached' });
        assert.equal(await entry.count(), 1);
        const entryText = await entry.evaluate((e) => e.textContent);
        assert.match(entryText, /formativ-Rückmeldung an die lernende Person/);
        assert.match(entryText, /◐ teilweise/);
        assert.match(entryText, /Simulierter Hinweis/);
        assert.match(entryText, /An das Modell gesendeter Text/);
        assert.ok(entryText.includes(TEXT_1 + TEXT_2), 'the sent text is shown');
        assert.match(entryText, /Prompt: fake-v1/);
        assert.equal(await card(tp, 'Anna Beispiel').locator('.formativ-count-badge').innerText(), '💬 1');
        assert.equal(await card(tp, 'Ben Muster').locator('.formativ-teacher').count(), 0);

        // paste hints: an entry under Anna's answer, the excerpt as text only, nothing for Ben
        const EXCERPT = `<img src=x onerror="${xss('paste')}">Kopierter Absatz`;
        await box.doc(`pasteEvents/${ANNA}__${enc(A)}__${enc(SUB)}__E2eDash0001`).set({
            uid: ANNA, assignmentId: A, subId: SUB, questionId: 'q2',
            kind: 'bulk', chars: 400, excerpt: EXCERPT, at: new Date(),
        });
        await tp.locator('#refresh-btn').click();
        const hint = card(tp, 'Anna Beispiel').locator('.paste-teacher').filter({ hasText: 'Kopierter Absatz' });
        await hint.waitFor({ state: 'attached' });
        const hintText = await hint.evaluate((e) => e.textContent);
        assert.match(hintText, /Text eingefügt statt getippt/);
        assert.match(hintText, /Grosser Textblock auf einmal · 400 Zeichen/);
        assert.ok(hintText.includes(EXCERPT + ' …'), 'the excerpt is shown as text, marked as cut');
        assert.equal(await hint.locator('img').count(), 0);
        assert.equal(await tp.evaluate(() => window.__xss ?? null), null);
        assert.match(await card(tp, 'Anna Beispiel').locator('.paste-count-badge').innerText(), /^📋 \d+$/);
        assert.equal(await card(tp, 'Ben Muster').locator('.paste-teacher').count(), 0);
    });

    const annaPanel = () => card(tp, 'Anna Beispiel').locator('.publish-panel');
    const released = () => docData(`feedbackReleased/${pairId(ANNA)}`);

    await step('(d1) assessment through the fake evaluator: class id and roster name go out, nothing is in Firestore yet', async () => {
        const before = evaluatorCalls.length;
        await card(tp, 'Anna Beispiel').locator('.live-feedback-btn').click();
        await annaPanel().waitFor();
        const call = evaluatorCalls.slice(before).find((c) => c.route === '/assess');
        assert.equal(call.body.className, 'TestA');
        assert.equal(call.body.studentName, 'Anna Beispiel');
        assert.equal(call.body.assignmentId, A);
        assert.deepEqual(Object.keys(call.body).sort(), ['assignmentId', 'className', 'studentData', 'studentName']);
        const sub = call.body.studentData.assignments[A][SUB];
        assert.equal(sub.type, 'quill');
        assert.deepEqual(sub.answers, [{ questionId: 'q1', answer: `<p>${TEXT_1}${TEXT_2}</p>` }]);
        assert.deepEqual(sub.questions.map((q) => q.id), ['q1', 'q2']);
        // every evaluator call so far used the same class id and name
        for (const c of evaluatorCalls.filter((x) => x.route === '/get_feedback')) {
            assert.equal(c.body.className, 'TestA');
            assert.ok(['Anna Beispiel', 'Ben Muster'].includes(c.body.studentName));
        }
        assert.ok(evaluatorCalls.some((c) => c.route === '/get_master_assignment' && c.body.assignmentId === A));

        const slot = card(tp, 'Anna Beispiel').locator(`.inline-feedback[data-qid="${SUB}_q1"]`);
        assert.match(await slot.evaluate((e) => e.textContent), /Punkte: 2/);
        assert.equal(await docData(`feedback/${pairId(ANNA)}`), null);
        assert.equal(await released(), null);
    });

    await step('(d2) release without points and without solution key: Anna sees exactly that', async () => {
        await annaPanel().locator('.release-check-punkte').uncheck();
        assert.equal(await annaPanel().locator('.release-check-loesung').isChecked(), false);
        await annaPanel().locator('.release-toggle-btn').click();
        await annaPanel().locator('.release-status', { hasText: '✓ Freigegeben' }).waitFor();

        const settings = { kurzbericht: true, ausfuehrlich: true, punkte: false, loesung: false };
        assert.deepEqual(await released(), {
            uid: ANNA, assignmentId: A, date_str: '13.10.2026 15:00', releaseSettings: settings,
            // q2 was not answered: the dashboard does not release feedback on empty answers
            results: [{ question_id: `${SUB}_q1`, question_text: ASSIGNMENT.subAssignments[SUB].questions[0].text, concise_feedback: KURZ, detailed_feedback: LANG }],
        });

        const full = await docData(`feedback/${pairId(ANNA)}`);
        assert.deepEqual(Object.keys(full).sort(), ['assignmentId', 'date_str', 'publishedAt', 'releaseSettings', 'released', 'results', 'timestamp', 'uid']);
        assert.equal(full.uid, ANNA);
        assert.equal(full.released, true);
        assert.deepEqual(full.releaseSettings, settings);
        assert.ok(full.publishedAt instanceof Timestamp);
        assert.equal(full.results[0].score, 2, 'the teacher copy keeps the points');
        assert.equal(full.results[0].detailed_feedback, LANG + SOLUTION_SUFFIX, 'and the solution key');
        assert.doesNotMatch(JSON.stringify(full), /student_name|class_name|Anna|Beispiel/, 'no name in feedback (the evaluator sent one)');

        const text = await reloadStudent(ap, TEXT_1);
        assert.ok(text.includes(KURZ));
        assert.ok(text.includes(LANG));
        assert.doesNotMatch(text, /\d Punkte|Lösung:|Zweiundvierzig/);
    });

    await step('(e) Ben sees nothing of it; feedback and formativUsage are closed to students, also to Anna herself', async () => {
        const text = await reloadStudent(bp, TEXT_BEN);
        assert.doesNotMatch(text, /Fiktiv|Punkte|Simulierter Hinweis|Velo/);
        assert.equal(await bp.locator('.formativ-button').first().isDisabled(), false, 'Ben\'s own formativ request is still open');
        assert.equal(await readAs(bp, 'feedbackReleased', pairId(ANNA)), 'permission-denied');
        assert.equal(await readAs(bp, 'feedback', pairId(ANNA)), 'permission-denied');
        assert.equal(await readAs(bp, 'formativUsage', pairId(ANNA)), 'permission-denied');
        assert.equal(await readAs(bp, 'feedbackReleased', pairId(BEN)), 'missing', 'his own released feedback: readable, there is none');

        assert.equal(await readAs(ap, 'feedbackReleased', pairId(ANNA)), 'exists');
        assert.equal(await readAs(ap, 'feedback', pairId(ANNA)), 'permission-denied');
        assert.equal(await readAs(ap, 'formativUsage', pairId(ANNA)), 'permission-denied');
    });

    await step('(d3) other release setting (points and solution key on, short feedback off): Anna sees the change', async () => {
        const waitSettings = (want) => until(`releaseSettings ${JSON.stringify(want)}`, async () => {
            const r = await released();
            return r && Object.entries(want).every(([k, v]) => r.releaseSettings[k] === v);
        });
        // while released, every tick is saved at once
        await annaPanel().locator('.release-check-punkte').check();
        await waitSettings({ punkte: true });
        await annaPanel().locator('.release-check-loesung').check();
        await waitSettings({ punkte: true, loesung: true });
        await annaPanel().locator('.release-check-kurz').uncheck();
        await waitSettings({ punkte: true, loesung: true, kurzbericht: false });

        assert.deepEqual(await released(), {
            uid: ANNA, assignmentId: A, date_str: '13.10.2026 15:00',
            releaseSettings: { kurzbericht: false, ausfuehrlich: true, punkte: true, loesung: true },
            results: [{ question_id: `${SUB}_q1`, question_text: ASSIGNMENT.subAssignments[SUB].questions[0].text, score: 2, detailed_feedback: LANG + SOLUTION_SUFFIX }],
        });
        const text = await reloadStudent(ap, TEXT_1);
        assert.match(text, /2 Punkte/);
        assert.ok(text.includes(LANG + SOLUTION_SUFFIX));
        assert.ok(!text.includes(KURZ));
    });

    await step('(d4) a manual correction (/update_feedback) reaches the released copy', async () => {
        const before = evaluatorCalls.length;
        await card(tp, 'Anna Beispiel').locator(`.inline-feedback[data-qid="${SUB}_q1"] .feedback-ok-btn`).click();
        await until('released copy with score 3', async () => (await released())?.results[0].score === 3);
        const call = evaluatorCalls.slice(before).find((c) => c.route === '/update_feedback');
        assert.deepEqual(call.body, {
            className: 'TestA', assignmentId: A, studentName: 'Anna Beispiel', questionId: `${SUB}_q1`,
            score: 3, concise_feedback: '✔️ Alles korrekt.', detailed_feedback: '✔️ Alles korrekt.',
        });
        assert.equal((await released()).results[0].detailed_feedback, '✔️ Alles korrekt.');
    });

    await step('(d5) un-release: the released copy is gone, Anna sees no feedback, the teacher copy stays', async () => {
        await annaPanel().locator('.release-toggle-btn').click();
        await annaPanel().locator('.release-status', { hasText: '✓ Zurückgezogen' }).waitFor();
        assert.equal(await released(), null);
        const full = await docData(`feedback/${pairId(ANNA)}`);
        assert.equal(full.released, false);
        assert.equal(full.results[0].score, 3);
        assert.equal(await readAs(ap, 'feedbackReleased', pairId(ANNA)), 'missing');

        const text = await reloadStudent(ap, TEXT_1);
        assert.doesNotMatch(text, /Fiktiv|\d Punkte|Alles korrekt|Zweiundvierzig/);
        assert.match(text, /Simulierter Hinweis/, 'her formativ feedback is still there');
    });

    // ---- (g)–(l): hostile drafts, lookup by uid, invented assignments --------------------------

    const keyCard = (page, uid) => page.locator(`.student-card[data-student-key="${uid}"]`);
    const malCard = () => keyCard(tp, MAL);
    const xssFlag = (page) => page.evaluate(() => window.__xss ?? null);
    const info = () => tp.evaluate(async () => (await import('/dashboard/modules/api.js')).watchInfo());
    const draftId = (uid, a, s) => `${uid}__${enc(a)}__${enc(s)}`;
    /**
     * Everything that must not exist: an event-handler attribute or a script URL anywhere in the
     * document, an active or loading element inside `rootSelector`, and inside an answer
     * (`answerSelector`) anything that is not on the sanitiser's allow-list.
     */
    const forbidden = (page, rootSelector, answerSelector) => page.evaluate(([rootSel, answerSel]) => {
        const bad = [];
        for (const el of document.querySelectorAll('*')) {
            for (const a of el.attributes) {
                if (/^on/i.test(a.name)) bad.push(`${el.localName}[${a.name}]`);
                if (['href', 'src', 'action', 'formaction', 'data', 'srcdoc', 'xlink:href'].includes(a.name)
                    && /^\s*(javascript|vbscript|data):/i.test(a.value)) bad.push(`${el.localName}[${a.name}=${a.value.slice(0, 30)}]`);
            }
        }
        const root = document.querySelector(rootSel);
        for (const el of root.querySelectorAll('script, style, iframe, frame, object, embed, svg, math, form, img, video, audio, link, meta, base, template')) bad.push(`<${el.localName}> in ${rootSel}`);
        const allowed = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'span', 'a'];
        for (const el of document.querySelectorAll(`${answerSel} *`)) {
            if (!allowed.includes(el.localName)) bad.push(`<${el.localName}> in an answer`);
            for (const a of el.attributes) {
                const ok = (a.name === 'class' && /^ql-[a-z0-9-]+( ql-[a-z0-9-]+)*$/.test(a.value))
                    || (el.localName === 'a' && ['href', 'rel', 'target'].includes(a.name));
                if (!ok) bad.push(`${el.localName}[${a.name}] in an answer`);
            }
        }
        if (document.querySelectorAll('#login-overlay').length > 1) bad.push('duplicate id login-overlay');
        return bad;
    }, [rootSelector, answerSelector]);

    await step('(g) the sanitiser unit cases (test/sanitize.test.mjs) pass in this browser', async () => {
        const unitCtx = await newContext(browser, 'unit');
        const n = await sanitizerCases(await unitCtx.newPage(), `http://127.0.0.1:${PORT}`);
        assert.ok(n > 30);
        await unitCtx.close();
    });

    let written;
    await step('(h) hostile draft written by the student with the SDK, roster name with markup: nothing runs, nothing forbidden in the DOM, Quill formatting stays', async () => {
        // Roster and accounts (admin). Mallory's NAME carries markup; Wanda is in two classes;
        // Leo has no `classIds` array, only `classId`; TestGross has 31 members.
        const auth = getAuth(adminApp);
        const people = [
            { uid: MAL, username: 'mallory.muster', name: MAL_NAME, classId: 'TestA', classIds: ['TestA'] },
            { uid: WANDA, username: 'wanda.wechsel', name: 'Wanda Wechsel', classId: 'TestB', classIds: ['TestB', 'TestA'] },
            { uid: LEO, username: 'leo.leer', name: 'Leo Leer', classId: 'TestA' },
        ];
        for (const p of people) {
            const { uid, ...rosterFields } = p;
            const bbwEmail = `${p.username}@lernende.bbw.ch`;
            const props = { email: bbwEmail, password: PASSWORD, emailVerified: true };
            try { await auth.updateUser(uid, props); } catch (e) { if (e.code !== 'auth/user-not-found') throw e; await auth.createUser({ uid, ...props }); }
            await roster.doc(`students/${uid}`).set({ ...rosterFields, bbwEmail, mustSetPassword: false, active: true });
        }
        for (const g of BIG) {
            await roster.doc(`students/${g.uid}`).set({ name: g.name, username: g.uid, classId: 'TestGross', classIds: ['TestGross'], mustSetPassword: false, active: true });
        }
        const honest = { title: SUB, type: 'quill', questions: ASSIGNMENT.subAssignments[SUB].questions.map(({ id, text }) => ({ id, text })) };
        // Written by the server side (no account needed): the 31st member of the big class, and
        // Cleo — on the roster of TestB only — with a draft that claims the class TestA.
        await box.doc(`drafts/${draftId(BIG[30].uid, A, SUB)}`).set({
            uid: BIG[30].uid, classId: 'irgendeine', assignmentId: A, subId: SUB, ...honest,
            answers: [{ questionId: 'q1', answer: `<p>${TEXT_GROSS}</p>` }], updatedAt: Timestamp.now(),
        });
        await box.doc(`drafts/${draftId('seed-cleo', A, SUB)}`).set({
            uid: 'seed-cleo', classId: 'TestA', assignmentId: A, subId: SUB, ...honest,
            answers: [{ questionId: 'q1', answer: `<p>${TEXT_CLEO}</p>` }], updatedAt: Timestamp.now(),
        });

        // The students write their drafts themselves: own session, client SDK, security rules
        // in force — but not through the student page. Nothing here is typed into Quill.
        const directCtx = await newContext(browser, 'direct');
        const dp = await directCtx.newPage();
        // Any document of the app's origin that runs no app code will do (a fulfilled route would not:
        // Chrome does not let such a page talk to the loopback emulators).
        await dp.goto(`http://127.0.0.1:${PORT}/dashboard/teacher.css`);
        const writeAs = (username, drafts) => dp.evaluate(async ([u, pw, list]) => {
            const fb = await import('/js/firebase.js');
            const api = await import('/js/api.js');
            await api.signIn(u, pw);
            const uid = fb.auth.currentUser.uid;
            const out = [];
            for (const d of list) {
                const id = `${uid}__${encodeURIComponent(d.assignmentId)}__${encodeURIComponent(d.subId)}`;
                try { await fb.setDoc(fb.doc(fb.db, 'drafts', id), { ...d, uid, updatedAt: fb.serverTimestamp() }); out.push('ok'); }
                catch (e) { out.push(e.code || String(e)); }
            }
            await api.signOut();
            return out;
        }, [username, PASSWORD, drafts]);
        written = {
            mallory: await writeAs('mallory.muster', [
                { classId: 'TestA', assignmentId: A, subId: SUB, title: EVIL_TITLE, type: 'quill', questions: EVIL_QUESTIONS, answers: MAL_ANSWERS },
                { classId: 'TestA', assignmentId: INVENTED, subId: 'X', answers: [{ questionId: 'q1', answer: '<p>Erfundener Auftrag 5150</p>' }] },
            ]),
            wanda: await writeAs('wanda.wechsel', [
                { classId: 'TestB', assignmentId: A, subId: SUB, ...honest, answers: [{ questionId: 'q1', answer: `<p>${TEXT_WANDA}</p>` }] },
            ]),
            leo: await writeAs('leo.leer', [
                { classId: '', assignmentId: A, subId: SUB, ...honest, answers: [{ questionId: 'q1', answer: `<p>${TEXT_LEO}</p>` }] },
                { classId: '', assignmentId: SEED_A, subId: 'A. Grundsätze der Übung', answers: [{ questionId: 'q1', answer: '<p>Leos zweiter Auftrag 6003</p>' }] },
            ]),
        };
        await directCtx.close();
        assert.deepEqual(written, { mallory: ['ok', 'ok'], wanda: ['ok'], leo: ['ok', 'ok'] }, 'the security rules accept all of these drafts');
        assert.equal((await docData(`drafts/${draftId(MAL, A, SUB)}`)).answers[0].answer, EVIL_ANSWER, 'the payload is stored as written');

        // Fresh page load (new roster), class TestA, the assignment.
        await tp.reload();
        await tp.locator('#login-overlay').waitFor({ state: 'hidden' });
        await tp.locator('#class-select option[value="TestGross"]').waitFor({ state: 'attached' });
        assert.deepEqual(await tp.locator('#class-select option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean)), ['TestA', 'TestB', 'TestGross']);
        await tp.locator('#class-select').selectOption('TestA');
        await tp.locator(`#assignment-select option[value="${A}"]`).waitFor({ state: 'attached' });
        await tp.locator('#assignment-select').selectOption(A);
        await malCard().waitFor();
        await malCard().locator('.student-name').click();                          // open the card
        await malCard().locator('.read-only-answer').first().waitFor();
        // give every payload its chance: hover and click the paragraph that carried handlers
        await malCard().locator('.read-only-answer p', { hasText: 'absatz-mit-handler' }).hover();
        await malCard().locator('.read-only-answer p', { hasText: 'absatz-mit-handler' }).click();
        await tp.waitForTimeout(700);

        assert.equal(await xssFlag(tp), null, 'no payload was executed');
        assert.deepEqual(await forbidden(tp, '#live-content-renderer', '.read-only-answer'), []);
        assert.equal(tp.frames().length, 1, 'no frame was created');

        // the name: text, in the card header and as the card's key
        assert.equal(await malCard().locator('.student-name').evaluate((e) => e.textContent), MAL_NAME);
        assert.equal(await malCard().locator('.student-name').evaluate((e) => e.childElementCount), 0);
        assert.equal(await malCard().getAttribute('data-student-name'), MAL_NAME);
        assert.equal(await malCard().locator('.student-checkbox').getAttribute('data-student-name'), MAL_NAME);
        assert.equal(await malCard().locator('.student-header').evaluate((e) => e.querySelectorAll('img, b').length), 0);
        // title and question texts: text; **bold** is still shown bold
        assert.equal(await malCard().locator('.sub-title').evaluate((e) => e.textContent), EVIL_TITLE);
        assert.equal(await malCard().locator('.sub-title').evaluate((e) => e.childElementCount), 0);
        const q = await malCard().locator('.question-text').evaluateAll((es) => es.map((e) => ({ text: e.textContent, tags: [...e.querySelectorAll('*')].map((x) => x.localName) })));
        assert.deepEqual(q.map((x) => x.tags), [['b'], [], []]);
        assert.equal(q[0].text, `1. Frage wichtig <img src="http://xss.invalid/q.png" onerror="${xss('question')}">`);
        assert.equal(q[1].text, `2. ${EVIL_QUESTIONS[1].text}`);
        assert.equal(await malCard().locator('.inline-feedback').nth(2).getAttribute('data-qid'), `${SUB}_${EVIL_QID}`);

        // the answers: Quill formatting is there, the rest is gone, the words stay
        const answer = malCard().locator('.read-only-answer').first();
        assert.deepEqual(await answer.evaluate((e) => ({
            strong: e.querySelector('p > strong')?.textContent, em: e.querySelector('p > em')?.textContent, u: e.querySelector('p > u')?.textContent,
            ol: [...e.querySelectorAll('ol > li')].map((li) => li.textContent), indent: e.querySelector('ol > li.ql-indent-1')?.textContent,
            ul: [...e.querySelectorAll('ul > li')].map((li) => li.textContent),
            handlerParagraph: e.querySelector('p.ql-align-center')?.outerHTML,
            links: e.querySelectorAll('a').length,
        })), {
            strong: 'fett', em: 'kursiv', u: 'unterstrichen', ol: ['eins', 'zwei'], indent: 'zwei', ul: ['punkt'],
            handlerParagraph: '<p class="ql-align-center">absatz-mit-handler</p>', links: 0,
        });
        const answerText = await answer.evaluate((e) => e.textContent);
        assert.match(answerText, /Sichtbarer Text 7001.*klick-mich.*absatz-mit-handler.*stil-absatz/);
        assert.doesNotMatch(answerText, /display: none|window\.__xss|senden/, 'style, script and form content is dropped, not shown as text');
        assert.equal(await malCard().locator('.read-only-answer').nth(1).evaluate((e) => e.innerHTML), GOOD_ANSWER, 'an honest formatted answer is shown unchanged');
        assert.equal(await card(tp, 'Anna Beispiel').locator('.read-only-answer').first().evaluate((e) => e.innerHTML), `<p>${TEXT_1}${TEXT_2}</p>`, 'Anna\'s answer is shown as before');
        assert.equal(await tp.locator('#live-grid').isVisible(), true, 'the injected stylesheet did not hide the grid');
    });

    await step('(i) drafts are found by uid: wrong and empty classId are shown under the right class, a non-roster uid is not downloaded', async () => {
        assert.equal((await docData(`drafts/${draftId(WANDA, A, SUB)}`)).classId, 'TestB', 'Wanda\'s draft carries her other class');
        assert.equal((await docData(`drafts/${draftId(LEO, A, SUB)}`)).classId, '', 'Leo\'s draft carries no class');
        assert.deepEqual(await tp.locator('.student-card').evaluateAll((cs) => cs.map((c) => c.dataset.studentKey).sort()), [LEO, MAL, WANDA, ANNA, BEN].sort());
        assert.match(await keyCard(tp, WANDA).locator('.student-card-content').evaluate((e) => e.textContent), new RegExp(TEXT_WANDA));
        assert.match(await keyCard(tp, LEO).locator('.student-card-content').evaluate((e) => e.textContent), new RegExp(TEXT_LEO));
        assert.equal(await keyCard(tp, WANDA).getAttribute('data-student-name'), 'Wanda Wechsel');

        // What the listeners returned — not what the page shows.
        const seen = await info();
        assert.equal(seen.classId, 'TestA');
        assert.deepEqual([...seen.uids].sort(), [LEO, MAL, WANDA, ANNA, BEN].sort(), 'the listeners ask for the roster members of TestA, nobody else');
        assert.equal(seen.draftListeners, 1, 'five members: one listener');
        assert.deepEqual([...seen.draftIds].sort(), [
            draftId(ANNA, A, SUB), draftId(BEN, A, SUB), draftId(MAL, A, SUB), draftId(MAL, INVENTED, 'X'),
            draftId(WANDA, A, SUB), draftId(LEO, A, SUB), draftId(LEO, SEED_A, 'A. Grundsätze der Übung'),
        ].sort(), 'exactly the drafts of the five members');
        // both exist in the database and carry classId "TestA" — and were not delivered
        assert.equal((await docData(`drafts/${draftId('ghost-uid', A, SUB)}`)).classId, 'TestA');
        assert.equal((await docData(`drafts/${draftId('seed-cleo', A, SUB)}`)).classId, 'TestA');
        assert.ok(!seen.draftIds.some((id) => /^(ghost-uid|seed-cleo)__/.test(id)));
        assert.doesNotMatch(await tp.locator('body').evaluate((e) => e.textContent), new RegExp(`${TEXT_GHOST}|${TEXT_CLEO}`));

        // live: a later change of a draft with a foreign class stamp arrives
        await box.doc(`drafts/${draftId(WANDA, A, SUB)}`).update({ answers: [{ questionId: 'q1', answer: `<p>${TEXT_WANDA} live</p>` }], updatedAt: Timestamp.now() });
        await keyCard(tp, WANDA).locator('.read-only-answer', { hasText: `${TEXT_WANDA} live` }).waitFor({ state: 'attached' });
    });

    await step('(j) the assignment list offers only assignments that exist: an invented assignmentId is not in it', async () => {
        const options = () => tp.locator('#assignment-select option').evaluateAll((os) => os.map((o) => o.value).filter(Boolean));
        assert.deepEqual(await options(), [SEED_A, A], 'both exist and have a draft in the class; the invented one is missing');
        const seen = await info();
        assert.ok(seen.draftIds.includes(draftId(MAL, INVENTED, 'X')), 'the invented draft was delivered (it is Mallory\'s) — and is offered nowhere');
        assert.ok(!seen.assignmentIds.includes(INVENTED));
        assert.doesNotMatch(await tp.locator('#controls-bar').evaluate((e) => e.textContent), /Erfunden/);
        assert.equal(await tp.locator('#assignment-select').evaluate((e) => e.querySelectorAll('img').length), 0);

        // live in both directions: once the assignment is published it is offered, withdrawn it is gone
        await box.doc(`assignments/${enc(INVENTED)}`).set({ assignmentId: INVENTED, assignmentTitle: 'x', subAssignments: {} });
        await until('the newly published assignment is offered', async () => (await options()).length === 3);
        assert.deepEqual(await tp.locator('#assignment-select option').evaluateAll((os) => os.map((o) => o.textContent).filter((t) => t.includes('Erfunden'))), [INVENTED], 'as text');
        await box.doc(`assignments/${enc(INVENTED)}`).delete();
        await until('the withdrawn assignment is gone', async () => (await options()).length === 2);
        assert.equal(await tp.locator('#assignment-select').inputValue(), A, 'the selection is kept');
        assert.equal(await xssFlag(tp), null);
    });

    await step('(k) evaluator: gets the raw answer; its texts are shown, edited and printed as text; the print window carries sanitised answers', async () => {
        const before = evaluatorCalls.length;
        await malCard().locator('.live-feedback-btn').click();
        await malCard().locator('.publish-panel').waitFor();
        const call = evaluatorCalls.slice(before).find((c) => c.route === '/assess');
        assert.equal(call.body.studentName, MAL_NAME);
        assert.deepEqual(call.body.studentData.assignments[A][SUB].answers, MAL_ANSWERS, 'the evaluator receives the stored HTML, not the sanitised one');
        assert.equal(call.body.studentData.assignments[A][SUB].title, EVIL_TITLE);

        const slot = malCard().locator('.inline-feedback').first();
        await slot.locator('.feedback-edit-btn').waitFor();
        const slotText = await slot.evaluate((e) => e.textContent);
        assert.ok(slotText.includes(EVIL_CONCISE) && slotText.includes(EVIL_DETAILED), 'the feedback texts are shown literally');
        assert.ok((await malCard().locator('.feedback-controls-header').evaluate((e) => e.textContent)).includes(EVIL_DATE));

        await slot.locator('.feedback-edit-btn').click();
        assert.equal(await slot.locator('.edit-concise').inputValue(), EVIL_CONCISE);
        assert.equal(await slot.locator('.edit-detailed').inputValue(), EVIL_DETAILED);
        assert.equal(await slot.locator('textarea').count(), 1);
        await slot.locator('.edit-cancel-btn').click();
        await slot.locator('.feedback-edit-btn').waitFor();
        await tp.waitForTimeout(500);
        assert.equal(await xssFlag(tp), null);
        assert.deepEqual(await forbidden(tp, '#live-content-renderer', '.read-only-answer'), []);

        // print window of this one student, with original answers and solutions
        await malCard().locator('.print-single-btn').click();
        const [popup] = await Promise.all([teacherCtx.waitForEvent('page'), tp.locator('#print-full-context').click()]);
        await popup.waitForFunction(() => document.querySelectorAll('.context-body').length >= 2);
        await popup.waitForTimeout(700);
        assert.equal(await xssFlag(popup), null, 'nothing ran in the print window');
        assert.equal(await xssFlag(tp), null, 'nor in the dashboard');
        assert.deepEqual(await forbidden(popup, 'body', '.context-body'), []);
        assert.equal(await popup.evaluate(() => document.querySelectorAll('style').length), 1, 'only the print stylesheet of the page itself');
        const printed = await popup.evaluate(() => ({
            names: [...document.querySelectorAll('.overview-name')].map((e) => e.textContent),
            header: document.querySelector('.header p').textContent,
            h1: document.querySelector('h1').textContent,
            concise: document.querySelector('.concise').textContent,
            detailed: document.querySelector('.detailed').textContent,
            question: document.querySelector('.question').textContent,
            answer: document.querySelector('.context-body').innerHTML,
            answerText: document.querySelector('.context-body').textContent,
        }));
        assert.deepEqual(printed.names, [MAL_NAME]);
        assert.ok(printed.header.includes(MAL_NAME));
        assert.equal(printed.h1, 'TestA');
        assert.ok(printed.concise.includes(EVIL_CONCISE));
        assert.equal(printed.detailed, EVIL_DETAILED);
        assert.equal(printed.question, EVIL_QTEXT);
        assert.ok(printed.answer.startsWith('<p>Sichtbarer Text 7001 <strong>fett</strong> <em>kursiv</em> <u>unterstrichen</u></p><ol><li>eins</li><li class="ql-indent-1">zwei</li></ol><ul><li>punkt</li></ul>'), 'the printed answer keeps its formatting');
        assert.match(printed.answerText, /klick-mich.*absatz-mit-handler.*stil-absatz/);
        await popup.close();
    });

    await step('(l) a class of 31 is watched with two listeners (30 uids per `in` query); member 31 is found', async () => {
        await tp.locator('#class-select').selectOption('TestGross');
        await tp.locator(`#assignment-select option[value="${A}"]`).waitFor({ state: 'attached' });
        await tp.locator('#assignment-select').selectOption(A);
        await keyCard(tp, BIG[30].uid).locator('.read-only-answer', { hasText: TEXT_GROSS }).waitFor({ state: 'attached' });
        assert.equal(await tp.locator('.student-card').count(), 1);
        const seen = await info();
        assert.equal(seen.classId, 'TestGross');
        assert.equal(seen.uids.length, 31);
        assert.equal(seen.draftListeners, 2);
        assert.deepEqual(seen.draftIds, [draftId(BIG[30].uid, A, SUB)]);
        assert.equal(await xssFlag(tp), null);
    });

    await step('(f) after a reload the dashboard shows the stored state; logout brings the login back', async () => {
        await tp.reload();
        await tp.locator('#login-overlay').waitFor({ state: 'hidden' });   // the session survives the reload
        await tp.locator('#class-select option[value="TestA"]').waitFor({ state: 'attached' });
        await tp.locator('#class-select').selectOption('TestA');
        await tp.locator(`#assignment-select option[value="${A}"]`).waitFor({ state: 'attached' });
        await tp.locator('#assignment-select').selectOption(A);
        await annaPanel().locator('.release-toggle-btn', { hasText: 'Freigeben' }).waitFor();
        assert.equal(await annaPanel().locator('.release-check-kurz').isChecked(), false, 'release settings come back from feedback/{pairDoc}');
        assert.equal(await annaPanel().locator('.release-check-loesung').isChecked(), true);
        assert.doesNotMatch(await tp.locator('body').innerText(), new RegExp(TEXT_GHOST));

        await tp.locator('#logout-btn').click();
        await tp.locator('#login-overlay.visible').waitFor();
        await tp.waitForFunction(async () => (await import('/js/firebase.js')).auth.currentUser === null);
        assert.equal(await tp.locator('.student-card').count(), 0);
    });

    assert.equal(model.calls.length, 1, 'the model was asked exactly once');
    assert.deepEqual(blocked, [], 'a page requested a host other than the emulators, the fakes and the two CDNs');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    server.close();
    evaluator.close();
    await model.close();
}

if (!failed) console.log(`\ne2e-dashboard: ${results.length} steps passed. Only the emulators, the fake model, the fake evaluator and the two CDNs were called.`);
process.exit(failed ? 1 : 0);
