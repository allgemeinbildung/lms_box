// Browser test of the class overview in the teacher Live View (dashboard/liveview.html):
// class tiles, class matrix (progress and formativ Rückmeldungen), drill-down into the
// existing detail view, live update, hostile names. Against the EMULATORS only.
// Run: npm run test:e2e:uebersicht
// Drafts and formativUsage documents are written with the Admin SDK (no student page, no model).
// Fictional people and texts only. Every request outside the emulators and the two CDNs fails the run.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { publicCopy } from '../scripts/public-assignment.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:uebersicht`);
        process.exit(1);
    }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));

await import('../scripts/seed-emulator.mjs');
const adminApp = getApps()[0];
const box = getFirestore(adminApp, 'lmsbox');
const roster = getFirestore(adminApp);
const auth = getAuth(adminApp);
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';
const enc = encodeURIComponent;

const A1 = '5.1 Überblick E2E';
const A2 = '5.2 Zweites Kapitel';
const SUB = 'A. Teil (v1.0)';
const ANNA = 'seed-anna';
const BEN = 'seed-ben';
const MAL = 'e2e-ueb-mal';
const MAL_NAME = 'Mallory <img src="http://xss.invalid/n.png" onerror="window.__xss=1"><b>Fett</b>';

const assignment = (id, formativ) => ({
    assignmentId: id, assignmentTitle: `Titel ${id}`,
    subAssignments: { [SUB]: { type: 'quill', questions: [
        { id: 'q1', text: 'Erste Frage zum Thema', ...(formativ ? { formativ: true } : {}) },
        ...(formativ ? [{ id: 'q2', text: 'Zweite Frage zum Thema', formativ: true }] : []),
    ] } },
});
for (const a of [assignment(A1, true), assignment(A2, false)]) {
    await box.doc(`assignments/${enc(a.assignmentId)}`).set(a);
    await box.doc(`publicAssignments/${enc(a.assignmentId)}`).set(publicCopy(a));
}
for (const c of ['drafts', 'formativUsage']) for (const d of (await box.collection(c).get()).docs) await d.ref.delete();
await auth.createUser({ uid: MAL, email: 'mallory.e2e@lernende.bbw.ch', password: PASSWORD }).catch(() => {});
await roster.doc(`students/${MAL}`).set({ name: MAL_NAME, username: 'mallory.e2e', bbwEmail: 'mallory.e2e@lernende.bbw.ch', classId: 'TestA', classIds: ['TestA'], active: true });

const LONG = 'Das ist eine Antwort mit mehr als fünfzehn Zeichen';
const draft = (uid, a, answers, classId = 'TestA') => box.doc(`drafts/${uid}__${enc(a)}__${enc(SUB)}`).set({
    uid, classId, assignmentId: a, subId: SUB, title: 'Teil', type: 'quill', updatedAt: Timestamp.now(),
    questions: answers.map(([id]) => ({ id, text: id })),
    answers: answers.map(([questionId, answer]) => ({ questionId, answer })),
});
await draft(ANNA, A1, [['q1', `<p>${LONG}</p>`], ['q2', `<p>${LONG} zwei</p>`]]);
await draft(ANNA, A2, [['q1', '<p>kurz</p>']]);
await draft(BEN, A1, [['q1', `<p>${LONG}</p>`], ['q2', '<p></p>']]);
await draft(MAL, A1, [['q1', `<p>${LONG}</p><img src="http://xss.invalid/a.png" onerror="window.__xss=2">`], ['q2', `<p>${LONG}</p>`]]);

const attempt = (st, hint = 'h') => ({ at: '2026-10-20T08:00:00.000Z', result: { zustand: 'ok', kriterien: [{ id: 'k1', label: 'Kriterium eins', status: st, hinweis: hint }] } });
// q1: two attempts, fehlt -> erfuellt (verbessert).
// q2: one flat attempt, written before 23.10.2026 (no versuche / frueher), erfuellt (direkt).
await box.doc(`formativUsage/${ANNA}__${enc(A1)}`).set({
    uid: ANNA, assignmentId: A1,
    slots: {
        [`${SUB}::q1`]: { state: 'done', ...attempt('erfuellt'), frueher: [attempt('fehlt')] },
        [`${SUB}::q2`]: { state: 'done', ...attempt('erfuellt') },
    },
});

// ---- static server + browser ------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/(js\/[\w.-]+\.js|css\/[\w.-]+\.css|dashboard\/(liveview\.html|liveview\.js|teacher\.css|overview\.css|modules\/[\w.-]+\.js))$/;
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !SERVED.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
const URL_DASH = `http://127.0.0.1:${server.address().port}/dashboard/liveview.html`;

const ALLOWED = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const blocked = [];
const browserLog = [];
const results = [];
const shot = async (page, name) => { if (process.env.SHOT_DIR) await page.screenshot({ path: join(process.env.SHOT_DIR, `${name}.png`) }); };   // optional, for a look
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}
const until = async (what, fn, ms = 15000) => {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`Timeout: ${what}`);
        await new Promise((r) => setTimeout(r, 150));
    }
};

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    ctx.setDefaultTimeout(20000);
    await ctx.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!/^https?:$/.test(url.protocol)) return route.continue();
        // Port 5000 is the real evaluator's address: not running in this test, answered with 404.
        if (url.port === '5000' && url.hostname === 'localhost') {
            if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
            return route.fulfill({ status: 404, headers: { ...CORS, 'Content-Type': 'application/json' }, body: '{}' });
        }
        if (ALLOWED.has(url.hostname)) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => browserLog.push(`pageerror: ${e.message}`));
    let columns = [];
    const rowOf = (name) => page.locator('#overview-matrix tbody tr', { has: page.locator('th.ov-name', { hasText: name }) });
    const cell = (name, assId) => rowOf(name).locator('td').nth(columns.indexOf(assId)).locator('button');

    await step('(a) class tiles replace the dropdown: both classes with their number of students', async () => {
        await page.goto(URL_DASH);
        await page.locator('#login-username').fill('tina.test');
        await page.locator('#login-password').fill(PASSWORD);
        await page.locator('#login-btn').click();
        await page.locator('.class-tile[data-class-id="TestA"]').waitFor();
        assert.match(await page.locator('.class-tile[data-class-id="TestA"]').innerText(), /3 Lernende/);
        assert.match(await page.locator('.class-tile[data-class-id="TestB"]').innerText(), /1 Lernende/);
        assert.equal(await page.locator('#class-select').evaluate((s) => s.closest('.control-group').getBoundingClientRect().width <= 1), true, 'the old dropdown is out of the way');
        assert.equal(await page.locator('#live-content-renderer').isVisible(), false, 'no detail view before a chapter is chosen');
    });

    await step('(b) one click on a class shows the matrix: students x chapters with progress per cell', async () => {
        await page.locator('.class-tile[data-class-id="TestA"]').click();
        await page.locator('#overview-matrix .ov-table').waitFor();
        columns = await page.locator('#overview-matrix thead .ov-colbtn').allInnerTexts();
        assert.deepEqual(columns, [A1, A2], 'one column per chapter with drafts');
        assert.equal(await page.locator('.class-tile[data-class-id="TestA"]').getAttribute('aria-pressed'), 'true');
        const rows = await page.locator('#overview-matrix tbody th.ov-name').allInnerTexts();
        assert.ok(rows.includes('Anna Beispiel') && rows.includes('Ben Muster') && rows.includes(MAL_NAME), 'all class members, hostile name as text');
        assert.match(await cell('Anna Beispiel', A1).getAttribute('class'), /ov-done/);
        assert.equal((await cell('Anna Beispiel', A1).innerText()).replace(/\s/g, ''), '✓2/2');
        assert.match(await cell('Anna Beispiel', A2).getAttribute('class'), /ov-started/, '5 characters are started, not answered');
        assert.match(await cell('Ben Muster', A1).getAttribute('class'), /ov-started/);
        assert.equal((await cell('Ben Muster', A1).innerText()).replace(/\s/g, ''), '◔1/2');
        assert.match(await cell('Ben Muster', A2).getAttribute('class'), /ov-none/);
        assert.equal(await rowOf('Anna Beispiel').locator('td.ov-sumcell').innerText(), '1/2');
        await shot(page, 'matrix-fortschritt');
        assert.equal(await page.evaluate(() => window.__xss), undefined, 'nothing from the hostile draft or name ran');
        assert.equal(await page.locator('#overview-matrix img').count(), 0);
    });

    await step('(c) live: a new answer turns Ben\'s cell green without a click', async () => {
        await draft(BEN, A1, [['q1', `<p>${LONG}</p>`], ['q2', `<p>${LONG}</p>`]]);
        await until('Ben done', async () => /ov-done/.test(await cell('Ben Muster', A1).getAttribute('class')));
    });

    await step('(d) «Rückmeldungen»: attempts per student and chapter, improved marked, old one-attempt data works', async () => {
        await page.locator('[data-ov-mode="rueckmeldungen"]').click();
        await until('formativ loaded', async () => /Stand/.test(await page.locator('#ov-note').innerText()));
        const anna = await cell('Anna Beispiel', A1).innerText();
        assert.match(anna, /💬 3/, 'two attempts on q1 plus one on q2');
        assert.match(anna, /●↑1/, 'q1 improved');
        assert.match(anna, /●1/, 'q2 (flat, pre-23.10. shape) counts as «direkt erfüllt»');
        assert.match(await cell('Anna Beispiel', A1).getAttribute('title'), /Erste Frage zum Thema: 2×/);
        assert.equal((await cell('Ben Muster', A1).innerText()).trim(), '–', 'offered, none fetched');
        assert.equal((await cell('Anna Beispiel', A2).innerText()).trim(), '·', 'chapter without formativ');
        assert.match(await rowOf('Anna Beispiel').locator('td.ov-sumcell').innerText(), /💬 3\s+↑1/);
        await shot(page, 'matrix-rueckmeldungen');
    });

    await step('(e) drill-down: a cell opens the chapter and the person\'s card with the trail; back returns to the matrix', async () => {
        await cell('Anna Beispiel', A1).click();
        assert.equal(await page.locator('#overview').isVisible(), false);
        assert.equal(await page.locator('#detail-bar').isVisible(), true);
        assert.equal(await page.locator('#detail-title').innerText(), `TestA · ${A1}`);
        const card = page.locator('.student-card[data-student-name="Anna Beispiel"]');
        await card.waitFor();
        await until('card open', async () => (await card.getAttribute('class')).includes('open'));
        await card.locator('.formativ-trail-line').first().waitFor();
        assert.match(await card.locator('.formativ-trail-line').first().innerText(), /2 Rückmeldungen geholt · Spur: ●↑ verbessert/);
        assert.match(await card.locator('.formativ-trail-line').nth(1).innerText(), /1 Rückmeldung geholt/, 'older single attempt');
        assert.ok(await page.locator('.student-card').count() >= 3, 'the whole class is still there');
        await shot(page, 'detail');
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        await page.locator('#back-to-overview').click();
        await page.locator('#overview-matrix .ov-table').waitFor();
        assert.equal(await page.locator('#live-content-renderer').isVisible(), false);
    });

    await step('(f) a column header opens the chapter for the whole class; the old dropdown still drives the same view', async () => {
        await page.locator('#overview-matrix .ov-colbtn', { hasText: A2 }).click();
        await page.locator('.student-card[data-student-name="Anna Beispiel"]').waitFor();
        assert.equal(await page.locator('#detail-title').innerText(), `TestA · ${A2}`);
        await until('the second chapter is rendered', async () => /1\/1/.test(await page.locator('.student-card[data-student-name="Anna Beispiel"] .progress-badge').innerText()));
        await page.locator('#assignment-select').selectOption('');
        await page.locator('#overview-matrix .ov-table').waitFor();
    });

    await step('(g) other class: its tile, and an empty class says so', async () => {
        await page.locator('.class-tile[data-class-id="TestB"]').click();
        await page.locator('#overview-matrix .ov-empty').waitFor();
        await until('empty class message', async () => /noch keine Antworten/.test(await page.locator('#overview-matrix').innerText()));
        assert.equal(await page.locator('.class-tile[data-class-id="TestB"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('.class-tile[data-class-id="TestA"]').getAttribute('aria-pressed'), 'false');
    });

    assert.deepEqual(browserLog, [], 'no page errors');
    assert.deepEqual(blocked, [], 'a page requested a host other than the emulators and the two CDNs');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log:\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    server.close();
    await roster.doc(`students/${MAL}`).delete();
    await auth.deleteUser(MAL).catch(() => {});
}
if (!failed) console.log(`\ne2e-uebersicht: ${results.length} steps passed.`);
process.exit(failed ? 1 : 0);
