// Browser test of the student page (index.html) against the EMULATORS.
// Run: npm run test:e2e:student
//   (= emulators:exec --only auth,firestore; this file seeds, serves app/ itself and drives the installed Chrome)
//
// Needs internet for the two CDNs the page loads (gstatic Firebase SDK, Quill). Every other
// outside request is blocked and fails the run - the page must talk to the emulators only.
// Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:student`);
        process.exit(1);
    }
}

// Seed (fictional accounts, one assignment). The script carries its own emulator guard.
await import('../scripts/seed-emulator.mjs');
const adminApp = getApps()[0];
const auth = getAuth(adminApp);
const box = getFirestore(adminApp, 'lmsbox');
const roster = getFirestore(adminApp);

const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed
const LOGIN_URL = 'https://allgemeinbildung.web.app/login';
const enc = encodeURIComponent;
const A1 = '0.1 Testauftrag Müller';
const A1_SUB = 'A. Grundsätze der Übung';
const A3 = '0.2 E2E Drei Teile «Übung»';
const A3_SUBS = ['A. Erster Teil', 'B. Zweiter Teil (v1.2)', 'C. Dritter Teil – Übersicht'];
const draftId = (uid, a, s) => `${uid}__${enc(a)}__${enc(s)}`;

// ---- extra fixtures ------------------------------------------------------------------

await box.doc(`assignments/${enc(A3)}`).set({
    assignmentId: A3,
    assignmentTitle: 'Drei Teile (E2E)',
    formativ: false,
    solution_keys: [],
    subAssignments: Object.fromEntries(A3_SUBS.map((s, i) => [s, {
        type: 'quill',
        questions: [{ id: 'q1', text: `Frage zu Teil ${i + 1}: Was fällt Ihnen auf?` }],
    }])),
});
// An account that still has its start password.
try { await auth.deleteUser('e2e-dora'); } catch { /* not there */ }
await auth.createUser({ uid: 'e2e-dora', email: 'dora.neu@lernende.bbw.ch', password: PASSWORD, displayName: 'Dora Neu' });
await roster.doc('students/e2e-dora').set({
    name: 'Dora Neu', username: 'dora.neu', bbwEmail: 'dora.neu@lernende.bbw.ch',
    classId: 'TestB', classIds: ['TestB'], mustSetPassword: true, active: true,
});
// One account per step that is about lost or stale work (i)-(m): each starts without drafts.
const EXTRA = [['e2e-emil', 'emil.faden', 'Emil Faden'], ['e2e-fina', 'fina.keller', 'Fina Keller'],
    ['e2e-gian', 'gian.roth', 'Gian Roth'], ['e2e-hana', 'hana.vogt', 'Hana Vogt'], ['e2e-ivo', 'ivo.lang', 'Ivo Lang']];
for (const [uid, username, name] of EXTRA) {
    const email = `${username}@lernende.bbw.ch`;
    try { await auth.deleteUser(uid); } catch { /* not there */ }
    await auth.createUser({ uid, email, password: PASSWORD, displayName: name });
    await roster.doc(`students/${uid}`).set({ name, username, bbwEmail: email, classId: 'TestB', classIds: ['TestB'], mustSetPassword: false, active: true });
}
// Released feedback for Anna, as the dashboard will write it (already filtered).
await box.doc(`feedbackReleased/seed-anna__${enc(A1)}`).set({
    uid: 'seed-anna', assignmentId: A1, date_str: '13.10.2026',
    releaseSettings: { kurzbericht: true, ausfuehrlich: false, punkte: true, loesung: false },
    results: [{ question_id: `${A1_SUB}_q1`, question_text: 'x', score: 2, concise_feedback: 'Knapp, aber richtig.' }],
});
// Drafts of an earlier run against the same emulators.
for (const d of (await box.collection('drafts').get()).docs) await d.ref.delete();

// ---- static server for app/ (both names: localhost = host page, 127.0.0.1 = the iframes) ---

const APP = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let hostPage = '';
const handler = async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__host.html') {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(hostPage);
        return;
    }
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !/^\/(index\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/.test(path)) {
        res.writeHead(404); res.end(); return;
    }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
};
const listen = (host, port) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(port, host, () => resolve(s));
});
const servers = [await listen('127.0.0.1', 0)];
const PORT = servers[0].address().port;
try { servers.push(await listen('::1', PORT)); } catch { /* localhost resolves to 127.0.0.1 then */ }

const pageUrl = (a, s, extra = '') => `http://127.0.0.1:${PORT}/index.html?assignmentId=${enc(a)}&subId=${enc(s)}${extra}`;
hostPage = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Host (wie Obsidian Publish)</title><body>
<h1>Host-Seite auf localhost</h1>
${A3_SUBS.map((s, i) => `<iframe name="f${i}" src="${pageUrl(A3, s, i === 2 ? '&mode=test' : '')}" width="100%" height="420" scrolling="no"></iframe>`).join('\n')}
</body></html>`;

// ---- helpers ---------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const blocked = [];
const browserLog = [];

async function newContext(browser) {
    const context = await browser.newContext();
    context.setDefaultTimeout(20000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!/^https?:$/.test(url.protocol) || ALLOWED_HOSTS.has(url.host.replace(/:\d+$/, ''))) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`console: ${m.text()}`); });
    });
    return context;
}

async function login(scope, username, password = PASSWORD) {
    await scope.locator('#auth-username').fill(username);
    await scope.locator('#auth-password').fill(password);
    await scope.locator('#auth-login-btn').click();
}
const editor = (scope, n = 0) => scope.locator('.ql-editor').nth(n);
async function typeInto(page, scope, n, text) {
    await editor(scope, n).click();
    await page.keyboard.type(text);
}
const saved = (scope) => scope.locator('#save-status[data-state="cloud"]').waitFor();
const state = (scope, s, timeout = 20000) => scope.locator(`#save-status[data-state="${s}"]`).waitFor({ timeout });
/** Types at the very end of the editor's text. */
async function appendTo(page, scope, text) {
    await editor(scope).click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text);
}
const shows = (frameOrPage, text, timeout = 20000) =>
    frameOrPage.waitForFunction((t) => document.querySelector('.ql-editor')?.innerText.includes(t), text, { timeout, polling: 100 });   // not rAF: an iframe that is not painted gets no frames
/**
 * Makes every draft write fail as it does without a connection (Firestore Lite: the commit
 * request). Reads keep working. Returns the function that lets writes through again.
 */
async function blockWrites(context) {
    const isCommit = (url) => url.pathname.endsWith(':commit');
    const abort = (route) => route.abort('internetdisconnected');
    await context.route(isCommit, abort);
    return () => context.unroute(isCommit, abort);
}
/** Host page with the three iframes of A3, signed in, one saved text per frame. */
async function threeFrames(context, username, texts) {
    const host = await context.newPage();
    await host.goto(`http://localhost:${PORT}/__host.html`);
    const frames = [0, 1, 2].map((i) => host.frameLocator(`iframe[name="f${i}"]`));
    for (const f of frames) await f.locator('#auth-dialog').waitFor();
    await login(frames[0], username);
    for (const f of frames) await editor(f).waitFor();
    for (const [i, f] of frames.entries()) await typeInto(host, f, 0, texts[i]);
    for (const f of frames) await saved(f);
    return { host, frames };
}

/** Rows of the page's IndexedDB cache, or null when the database does not exist. Never creates it. */
const cacheRows = (target) => target.evaluate(async () => {
    if (!(await indexedDB.databases()).some((d) => d.name === 'LMS_AssignmentsDB')) return null;
    return new Promise((resolve, reject) => {
        const open = indexedDB.open('LMS_AssignmentsDB');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            const all = db.transaction('user_data').objectStore('user_data').getAll();
            all.onsuccess = () => { db.close(); resolve(all.result); };
            all.onerror = () => { db.close(); reject(all.error); };
        };
    });
});
/** Empties one object store of an existing database; returns false when there is none. */
const clearStore = (target, dbName, storeName) => target.evaluate(async ([name, store]) => {
    if (!(await indexedDB.databases()).some((d) => d.name === name)) return false;
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(store)) { db.close(); resolve(false); return; }
            const tx = db.transaction(store, 'readwrite');
            tx.objectStore(store).clear();
            tx.oncomplete = () => { db.close(); resolve(true); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        };
    });
}, [dbName, storeName]);

async function draft(uid, a, s) {
    const snap = await box.doc(`drafts/${draftId(uid, a, s)}`).get();
    return snap.exists ? snap.data() : null;
}
async function until(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() > end) throw new Error(`Timeout: ${what}`);
        await new Promise((r) => setTimeout(r, 150));
    }
}
const answerOf = (d, q) => d?.answers?.find((x) => x.questionId === q)?.answer || '';
/** Puts one row into the page's IndexedDB cache, as an older tab of this browser could have left it. */
const putCacheRow = (target, key, value) => target.evaluate(([k, v]) => new Promise((resolve, reject) => {
    const open = indexedDB.open('LMS_AssignmentsDB');
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('user_data', 'readwrite');
        tx.objectStore('user_data').put({ key: k, value: v });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    };
}), [key, value]);

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

// ---- the run -----------------------------------------------------------------------------

const TEXT_ANNA = 'Annas Antwort zum Speichern 4711';
const TEXT_BEN = 'Bens eigener Text 0815';
let failed = false;
// Playwright starts Chrome with third-party storage partitioning switched OFF. A real
// browser has it on, and it is exactly what step (c) is about - so start Chrome with
// Playwright's own flag list minus that one entry.
async function launchChrome() {
    const probe = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await probe.newPage();
    await page.goto('chrome://version');
    const commandLine = await page.locator('#command_line').innerText();
    await probe.close();
    const off = commandLine.split(/\s+/).find((x) => x.startsWith('--disable-features=') && x.includes('ThirdPartyStoragePartitioning'));
    if (!off) return chromium.launch({ channel: 'chrome', headless: true });
    const rest = off.slice('--disable-features='.length).split(',').filter((f) => f !== 'ThirdPartyStoragePartitioning');
    return chromium.launch({ channel: 'chrome', headless: true, ignoreDefaultArgs: [off], args: [`--disable-features=${rest.join(',')}`] });
}
const browser = await launchChrome();
try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();

    await step('(e) wrong password: German error, dialog stays, no assignment', async () => {
        await page.goto(pageUrl(A1, A1_SUB));
        await page.locator('#auth-dialog').waitFor();
        for (const id of ['#auth-forgot', '#auth-first-login']) {
            assert.equal(await page.locator(id).getAttribute('href'), LOGIN_URL);
            assert.equal(await page.locator(id).getAttribute('target'), '_blank');
        }
        await login(page, 'anna.beispiel', 'ganz-falsch');
        await page.locator('#auth-status:not(:empty)').waitFor();
        assert.equal(await page.locator('#auth-status').innerText(), 'Benutzername oder Passwort ist falsch.');
        assert.equal(await page.locator('#auth-dialog').count(), 1);
        assert.equal(await page.locator('.ql-editor').count(), 0);
        assert.equal(await page.locator('#auth-user').count(), 0);
    });

    await step('(a) login, type, reload with emptied IndexedDB: text is back from Firestore', async () => {
        await login(page, 'anna.beispiel');
        await editor(page).waitFor();
        assert.equal(await page.locator('#auth-dialog').count(), 0);
        assert.match(await page.locator('#auth-user').innerText(), /Anna Beispiel/);
        await typeInto(page, page, 0, TEXT_ANNA);
        await saved(page);

        const d = await until('draft document', () => draft('seed-anna', A1, A1_SUB));
        assert.deepEqual(Object.keys(d).sort(), ['answers', 'assignmentId', 'classId', 'questions', 'subId', 'title', 'type', 'uid', 'updatedAt']);
        assert.equal(d.uid, 'seed-anna');
        assert.equal(d.classId, 'TestA');
        assert.equal(d.assignmentId, A1);
        assert.equal(d.subId, A1_SUB);
        assert.ok(d.updatedAt instanceof Timestamp);
        assert.deepEqual(d.answers, [{ questionId: 'q1', answer: `<p>${TEXT_ANNA}</p>` }]);
        assert.deepEqual(d.questions.map((q) => Object.keys(q).sort()), [['id', 'text'], ['id', 'text']]);
        const { answers, ...withoutAnswers } = d;
        assert.doesNotMatch(JSON.stringify(withoutAnswers), /Anna Beispiel|anna\.beispiel|beispiel|@/i, 'a draft carries no name');   // the seed uid "seed-anna" is not a name field
        // exactly one draft document: only the visible sub-assignment was written
        assert.equal((await box.collection('drafts').get()).size, 1);

        const before = await cacheRows(page);
        assert.ok(before.some((r) => String(r.value).includes(TEXT_ANNA)), 'cache holds the text before it is emptied');
        assert.equal(await clearStore(page, 'LMS_AssignmentsDB', 'user_data'), true);
        assert.deepEqual(await cacheRows(page), []);

        await page.reload();
        await editor(page).waitFor();
        await page.waitForFunction((t) => document.querySelector('.ql-editor')?.innerText.includes(t), TEXT_ANNA);
        assert.equal(await page.locator('#auth-dialog').count(), 0, 'session survives the reload');
        // released feedback, rendered as before
        await page.getByText('2 Punkte').waitFor();
        await page.getByText('Knapp, aber richtig.').waitFor();
    });

    await step('(d) over-limit answer: refused by the rules, error state shown, draft untouched', async () => {
        await page.evaluate(() => {
            const q = window.Quill.find(document.querySelectorAll('#content-renderer .ql-container')[1]);
            q.insertText(0, 'x'.repeat(200001), 'user');
        });
        await page.locator('#save-status[data-state="too_large"]').waitFor();
        assert.match(await page.locator('#save-status').innerText(), /zu lang/);
        const d = await draft('seed-anna', A1, A1_SUB);
        assert.deepEqual(d.answers, [{ questionId: 'q1', answer: `<p>${TEXT_ANNA}</p>` }]);
        // shortened again: saving works again
        await page.evaluate(() => {
            const q = window.Quill.find(document.querySelectorAll('#content-renderer .ql-container')[1]);
            q.deleteText(0, q.getLength(), 'user');
        });
        await saved(page);
    });

    await step('(f) logout clears the IndexedDB cache', async () => {
        const before = await cacheRows(page);
        assert.ok(before.length > 0 && before.some((r) => String(r.value).includes(TEXT_ANNA)));
        await page.locator('#auth-logout').click();
        await page.locator('#auth-dialog').waitFor();
        assert.deepEqual(await cacheRows(page), []);
        assert.equal(await page.evaluate(() => localStorage.getItem('lmsbox-last-uid')), null);
        assert.equal(await page.locator('.ql-editor').count(), 0);
    });

    await step('(b) a second student on the same browser sees none of the first one\'s text', async () => {
        // Anna again, then her session ends WITHOUT the logout button (as when an account
        // is removed): her text is still in the shared cache when Ben signs in.
        await login(page, 'anna.beispiel');
        await page.waitForFunction((t) => document.querySelector('.ql-editor')?.innerText.includes(t), TEXT_ANNA);
        const where = await page.evaluate(async () => ({
            indexedDB: (await indexedDB.databases()).map((d) => d.name).filter((n) => /firebase/i.test(n)),
            localStorage: Object.keys(localStorage).filter((k) => k.startsWith('firebase:')),
        }));
        console.log(`    Firebase session is kept in: ${JSON.stringify(where)}`);
        await clearStore(page, 'firebaseLocalStorageDb', 'firebaseLocalStorage');
        await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('firebase:')).forEach((k) => localStorage.removeItem(k)));
        await page.goto('about:blank');
        await page.goto(pageUrl(A1, A1_SUB));
        await page.locator('#auth-dialog').waitFor();
        assert.ok((await cacheRows(page)).some((r) => String(r.value).includes(TEXT_ANNA)), 'precondition: Anna\'s text is still cached');

        await login(page, 'ben.muster');
        await editor(page).waitFor();
        assert.match(await page.locator('#auth-user').innerText(), /Ben Muster/);
        await page.waitForTimeout(1500);   // anything that would still arrive has arrived
        assert.equal((await editor(page, 0).innerText()).trim(), '');
        assert.equal((await editor(page, 1).innerText()).trim(), '');
        assert.doesNotMatch(await page.locator('body').innerText(), /Annas Antwort|Anna Beispiel|2 Punkte/);
        assert.doesNotMatch(JSON.stringify(await cacheRows(page)), /Annas Antwort|Anna Beispiel/);

        await typeInto(page, page, 0, TEXT_BEN);
        await saved(page);
        await until('Ben\'s draft', async () => answerOf(await draft('seed-ben', A1, A1_SUB), 'q1').includes(TEXT_BEN));
        assert.equal(answerOf(await draft('seed-anna', A1, A1_SUB), 'q1'), `<p>${TEXT_ANNA}</p>`);
        await page.locator('#auth-logout').click();
        await page.locator('#auth-dialog').waitFor();
    });
    await ctx.close();

    await step('(c) three third-party iframes: one login serves all, each saves its own draft', async () => {
        const c = await newContext(browser);
        const host = await c.newPage();
        await host.goto(`http://localhost:${PORT}/__host.html`);
        const frames = [0, 1, 2].map((i) => host.frameLocator(`iframe[name="f${i}"]`));
        for (const f of frames) await f.locator('#auth-dialog').waitFor();

        // really cross-site: the frame cannot reach into its host page
        const inner = host.frame({ name: 'f0' });
        assert.equal(new URL(inner.url()).hostname, '127.0.0.1');
        assert.equal(new URL(host.url()).hostname, 'localhost');
        assert.equal(await inner.evaluate(() => { try { return window.top.location.href; } catch (e) { return e.name; } }), 'SecurityError');

        // sign in inside the middle frame only
        const t0 = Date.now();
        await login(frames[1], 'cleo.probe');
        const waits = await Promise.all(frames.map(async (f) => { await editor(f).waitFor(); return Date.now() - t0; }));
        for (const f of frames) {
            assert.equal(await f.locator('#auth-dialog').count(), 0);
            assert.match(await f.locator('#auth-user').innerText(), /Cleo Probe/);
        }
        console.log(`    editor visible after login in frame 2: frame1 ${waits[0]} ms, frame2 ${waits[1]} ms, frame3 ${waits[2]} ms`);

        const texts = ['Cleo schreibt in Teil eins', 'Cleo schreibt in Teil zwei', 'Cleo schreibt in Teil drei'];
        for (const [i, f] of frames.entries()) await typeInto(host, f, 0, texts[i]);
        for (const f of frames) await saved(f);
        for (const [i, s] of A3_SUBS.entries()) {
            const d = await until(`draft ${i + 1}`, () => draft('seed-cleo', A3, s));
            assert.equal(d.subId, s);
            assert.equal(d.classId, 'TestB');
            assert.deepEqual(d.answers, [{ questionId: 'q1', answer: `<p>${texts[i]}</p>` }]);
        }
        const mine = await box.collection('drafts').where('uid', '==', 'seed-cleo').get();
        assert.deepEqual(mine.docs.map((d) => d.id).sort(), A3_SUBS.map((s) => draftId('seed-cleo', A3, s)).sort());

        // the session survives a reload of the host page, in all three frames
        await host.reload();
        for (const [i, f] of frames.entries()) {
            await editor(f).waitFor();
            await host.frame({ name: `f${i}` }).waitForFunction((t) => document.querySelector('.ql-editor')?.innerText.includes(t), texts[i]);
            assert.equal(await f.locator('#auth-dialog').count(), 0);
        }

        // The frames' storage really is partitioned by the host site, as in a real browser:
        // the same page opened as its own tab does not see the session of the iframes.
        const tab = await c.newPage();
        await tab.goto(pageUrl(A3, A3_SUBS[0]));
        await Promise.race([tab.locator('#auth-dialog').waitFor(), tab.locator('.ql-editor').first().waitFor()]);
        assert.equal(await tab.locator('#auth-dialog').count(), 1, 'third-party storage partitioning is not active - this run did not test the iframe case');
        console.log('    storage is partitioned: the page as its own tab on 127.0.0.1 asks for a login');
        await tab.close();

        // logout in one frame ends the session in all of them
        await frames[2].locator('#auth-logout').click();
        for (const f of frames) await f.locator('#auth-dialog').waitFor();
        assert.deepEqual(await cacheRows(host.frame({ name: 'f0' })), []);
        await c.close();
    });

    await step('(g) account without students/{uid} (teacher): message and logout, no assignment', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(pageUrl(A1, A1_SUB));
        await login(p, 'tina.test');
        await p.locator('#auth-notice[data-reason="no-student"]').waitFor();
        assert.match(await p.locator('#auth-notice').innerText(), /keine Aufträge bearbeiten/);
        assert.equal(await p.locator('.ql-editor').count(), 0);
        assert.equal(await p.locator('#auth-dialog').count(), 0);
        await p.locator('#auth-notice .auth-logout').click();
        await p.locator('#auth-dialog').waitFor();
        await c.close();
    });

    await step('(h) mustSetPassword: hint with the Lernportal link instead of the assignment', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(pageUrl(A1, A1_SUB, '&mode=test'));
        await login(p, 'dora.neu');
        await p.locator('#auth-notice[data-reason="must-set-password"]').waitFor();
        const link = p.locator('#auth-notice a[target="_blank"]');
        assert.equal(await link.getAttribute('href'), LOGIN_URL);
        assert.equal(await p.locator('.ql-editor').count(), 0);
        assert.equal((await box.collection('drafts').where('uid', '==', 'e2e-dora').get()).size, 0);
        await c.close();
    });

    // ---- lost or stale work: a save that failed, a sibling frame that loads late, logout ----

    await step('(i) failed save, reload: the newer local text is shown, says "not saved", and reaches the server when writes work again', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        const FIRST = 'Emil erste Fassung';
        const FULL = `${FIRST} und der neue Schluss`;
        await p.goto(pageUrl(A3, A3_SUBS[0]));
        await login(p, 'emil.faden');
        await editor(p).waitFor();
        await typeInto(p, p, 0, FIRST);
        await saved(p);

        const open = await blockWrites(c);
        await appendTo(p, p, ' und der neue Schluss');
        await state(p, 'error');
        assert.equal(answerOf(await draft('e2e-emil', A3, A3_SUBS[0]), 'q1'), `<p>${FIRST}</p>`, 'precondition: the write did not arrive');

        // reload while the server still has the older answer
        await p.reload();
        await editor(p).waitFor();
        await shows(p, 'der neue Schluss', 6000);
        assert.equal((await editor(p).innerText()).trim(), FULL);
        await state(p, 'error', 6000);
        await p.waitForTimeout(3000);   // longer than the debounce: the retry failed as well
        assert.equal(await p.locator('#save-status').getAttribute('data-state'), 'error', 'never "in der Cloud gespeichert" while the write fails');
        assert.equal(answerOf(await draft('e2e-emil', A3, A3_SUBS[0]), 'q1'), `<p>${FIRST}</p>`);

        // writes work again: the next load saves the local text without a keystroke
        await open();
        await p.reload();
        await editor(p).waitFor();
        await saved(p);
        assert.equal((await editor(p).innerText()).trim(), FULL);
        assert.equal(answerOf(await draft('e2e-emil', A3, A3_SUBS[0]), 'q1'), `<p>${FULL}</p>`);
        // and from now on the server is the truth again
        await p.reload();
        await shows(p, 'der neue Schluss');
        await p.waitForTimeout(500);
        assert.notEqual(await p.locator('#save-status').getAttribute('data-state'), 'error');
        await c.close();
    });

    await step('(j) a sibling iframe that loads late with an older snapshot does not change what the typing frame saves', async () => {
        const c = await newContext(browser);
        const texts = ['Fina Teil eins', 'Fina Teil zwei', 'Fina Teil drei'];
        const { host, frames } = await threeFrames(c, 'fina.keller', texts);

        // Reload. Frame 1 gets its drafts query answered by the server at once (so it holds
        // the state of now), but the answer reaches the frame only after frame 2 has typed.
        let release;
        const gate = new Promise((r) => { release = r; });
        let heldQueries = 0;
        const isQuery = (url) => url.pathname.endsWith(':runQuery');
        const hold = async (route) => {
            if (route.request().frame().name() !== 'f0') return route.fallback();
            const response = await route.fetch();
            const body = await response.body();
            heldQueries++;
            await gate;
            return route.fulfill({ response, body });
        };
        await c.route(isQuery, hold);
        await host.reload();
        await shows(host.frame({ name: 'f1' }), texts[1]);
        await until('frame 1 holds its old snapshot', () => heldQueries > 0);
        await appendTo(host, frames[1], ' und weiter');
        await state(frames[1], 'local');
        release();                                          // inside the 2 s debounce of frame 2
        await shows(host.frame({ name: 'f0' }), texts[0]);  // frame 1 has loaded and synced its snapshot
        await saved(frames[1]);
        assert.equal(answerOf(await draft('e2e-fina', A3, A3_SUBS[1]), 'q1'), `<p>${texts[1]} und weiter</p>`);
        assert.equal((await editor(frames[1]).innerText()).trim(), `${texts[1]} und weiter`);
        await c.unroute(isQuery, hold);

        // nothing else moved, and a fresh load shows the typed text everywhere it belongs
        assert.equal(answerOf(await draft('e2e-fina', A3, A3_SUBS[0]), 'q1'), `<p>${texts[0]}</p>`);
        assert.equal(answerOf(await draft('e2e-fina', A3, A3_SUBS[2]), 'q1'), `<p>${texts[2]}</p>`);
        await host.reload();
        await shows(host.frame({ name: 'f1' }), 'und weiter');
        await c.close();
    });

    await step('(k) logout in iframes: asks when a change is unsynced, does not ask when every frame could flush, never writes an empty draft', async () => {
        const c = await newContext(browser);
        const texts = ['Gian Teil eins', 'Gian Teil zwei', 'Gian Teil drei'];
        const { host, frames } = await threeFrames(c, 'gian.roth', texts);

        // 1. a change in frame 1 that cannot be written; logout is clicked in frame 3, inside the debounce
        const open = await blockWrites(c);
        await appendTo(host, frames[0], ' und ein Nachtrag');
        await frames[2].locator('#auth-logout').click();
        await frames[2].locator('#logout-confirm').waitFor({ timeout: 10000 });
        assert.match(await frames[2].locator('#logout-confirm').innerText(), /nicht in der Cloud gespeichert/);
        assert.match(await frames[2].locator('#logout-confirm').innerText(), /\bdu\b|\bdeine/i);
        assert.ok((await cacheRows(host.frame({ name: 'f0' }))).some((r) => JSON.stringify(r.value).includes('ein Nachtrag')), 'the local copy is still there while the question is open');
        await frames[2].locator('#logout-confirm-stay').click();
        await frames[2].locator('#logout-confirm').waitFor({ state: 'detached' });
        for (const f of frames) assert.equal(await f.locator('#auth-dialog').count(), 0, 'still signed in');
        await state(frames[0], 'error');
        assert.equal((await editor(frames[0]).innerText()).trim(), `${texts[0]} und ein Nachtrag`);
        assert.equal(answerOf(await draft('e2e-gian', A3, A3_SUBS[0]), 'q1'), `<p>${texts[0]}</p>`);

        // 2. writes work again. One more change in frame 2, logout at once in frame 3:
        //    frame 1 retries, frame 2 flushes its debounce, nobody is asked.
        await open();
        await appendTo(host, frames[1], ' und ein Zusatz');
        await frames[2].locator('#auth-logout').click();
        for (const f of frames) await f.locator('#auth-dialog').waitFor();
        assert.equal(await frames[2].locator('#logout-confirm').count(), 0);
        assert.deepEqual(await cacheRows(host.frame({ name: 'f0' })), []);
        await host.waitForTimeout(2500);   // any timer that was still running has fired
        const want = [`${texts[0]} und ein Nachtrag`, `${texts[1]} und ein Zusatz`, texts[2]];
        for (const [i, s] of A3_SUBS.entries()) {
            assert.deepEqual((await draft('e2e-gian', A3, s)).answers, [{ questionId: 'q1', answer: `<p>${want[i]}</p>` }]);
        }
        assert.equal((await box.collection('drafts').where('uid', '==', 'e2e-gian').get()).size, 3);
        await c.close();
    });

    await step('(l) a deleted answer stays deleted: a stale cache entry does not bring it back', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(pageUrl(A3, A3_SUBS[0]));
        await login(p, 'hana.vogt');
        await editor(p).waitFor();
        await typeInto(p, p, 0, 'Hana schreibt und verwirft');
        await saved(p);
        await editor(p).click();
        await p.keyboard.press('Control+A');
        await p.keyboard.press('Backspace');
        await until('the empty draft', async () => (await draft('e2e-hana', A3, A3_SUBS[0])).answers.length === 0);
        await saved(p);

        await putCacheRow(p, `modular-answer_${A3}_sub_${A3_SUBS[0]}_q_q1`, '<p>Alter Rest aus dem Cache</p>');
        await p.reload();
        await editor(p).waitFor();
        await p.getByText('Frage zu Teil 1').waitFor();
        await p.waitForTimeout(3500);   // longer than the debounce
        assert.equal((await editor(p).innerText()).trim(), '');
        assert.deepEqual((await draft('e2e-hana', A3, A3_SUBS[0])).answers, []);
        assert.doesNotMatch(JSON.stringify(await cacheRows(p)), /Alter Rest/, 'the cache follows the server');
        await c.close();
    });

    await step('(m) logout with an unsynced change, "Trotzdem abmelden": signed out, cache empty, server draft untouched', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(pageUrl(A3, A3_SUBS[0]));
        await login(p, 'ivo.lang');
        await editor(p).waitFor();
        await typeInto(p, p, 0, 'Ivo gespeichert');
        await saved(p);
        await blockWrites(c);
        await appendTo(p, p, ' und ungespeichert');
        await p.locator('#auth-logout').click();
        await p.locator('#logout-confirm').waitFor({ timeout: 10000 });
        assert.equal(await p.locator('#auth-dialog').count(), 0);
        await p.locator('#logout-confirm-leave').click();
        await p.locator('#auth-dialog').waitFor();
        assert.deepEqual(await cacheRows(p), []);
        assert.equal(await p.evaluate(() => localStorage.getItem('lmsbox-last-uid')), null);
        assert.deepEqual((await draft('e2e-ivo', A3, A3_SUBS[0])).answers, [{ questionId: 'q1', answer: '<p>Ivo gespeichert</p>' }]);
        await c.close();
    });

    assert.deepEqual(blocked, [], 'the page requested hosts other than the emulators and its two CDNs');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    for (const s of servers) s.close();
}

if (!failed) console.log(`\ne2e-student: ${results.length} steps passed, no request left the emulators (except the two CDNs).`);
process.exit(failed ? 1 : 0);
