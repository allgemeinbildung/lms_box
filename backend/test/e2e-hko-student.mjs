// Browser test of the HKO student page (hko.html) against the EMULATORS (HKO-P1-PLAN.md §6.2).
// Run from backend/ (port lock: the same ports as `npm run test:all`, never both at once):
//   node scripts/emu.mjs emulators:exec --config firebase.hko-e2e.json --project interactive-media-2a1fc \
//     --only auth,firestore "node test/e2e-hko-student.mjs"
//
// This file seeds (scripts/seed-hko.mjs), uploads the fixture (scripts/hko-upload.mjs --emulator
// --build test/fixtures/hko-build), serves app-hko/ itself and drives the installed Chrome with
// third-party storage partitioning ON. Host page on localhost, iframes on 127.0.0.1 (cross-site).
// Needs internet for the two CDNs (gstatic Firebase SDK, Quill). Every other outside request is
// blocked and fails the run. Fictional people and texts only.
//
// Structure (to add steps): one `step(name, fn)` per case, helpers per pattern below
// (person, hostWith, frameOf, textEditor, typeText, state, blockWrites, holdAnswerRead,
// answerDoc, cacheRows, clearStore, until). Steps for items/raster/selbst/mitnahme/print/load
// go after the marker «more steps» at the end of the run.
import assert from 'node:assert/strict';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
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
        console.error(`Refusing to run: ${name} does not point at a local emulator. See the header of this file.`);
        process.exit(1);
    }
}
const BACKEND = normalize(join(dirname(fileURLToPath(import.meta.url)), '..'));
const APP = normalize(join(BACKEND, '..'));

// ---- seed + fixture -----------------------------------------------------------------------

await import('../scripts/seed-hko.mjs');   // carries its own emulator guard
execFileSync(process.execPath, ['scripts/hko-upload.mjs', '--emulator', '--build', 'test/fixtures/hko-build'], {
    cwd: BACKEND, stdio: ['ignore', 'ignore', 'inherit'],
    env: { ...process.env, GCLOUD_PROJECT: process.env.GCLOUD_PROJECT || 'interactive-media-2a1fc' },
});
const adminApp = getApps()[0];
const auth = getAuth(adminApp);
const hko = getFirestore(adminApp, 'hko');
const roster = getFirestore(adminApp);

const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, the seed's default
const UNIT = 'lj1-test-box';
const OTHER = 'lj1-test-andere';
const KN_TEXT = 'Dieser Teil ist der Kompetenznachweis. Er findet nicht hier statt; Ihre Lehrperson gibt Ihnen die Unterlagen.';
const ANSWER_KEYS = ['blockId', 'classId', 'kn', 'status', 'type', 'uid', 'unitId', 'unitVersion', 'updatedAt', 'value', 'variante'];
const PASTE_KEYS = ['at', 'blockId', 'chars', 'excerpt', 'feld', 'kind', 'uid', 'unitId'];

for (const d of (await hko.collection('answers').get()).docs) await d.ref.delete();
for (const d of (await hko.collection('pasteEvents').get()).docs) await d.ref.delete();

/** A fictional learner with roster entry; one per step that needs a clean slate. */
async function person(uid, username, name, classId = 'test-3j-a', classIds = [classId]) {
    const email = `${username}@lernende.bbw.ch`;
    try { await auth.deleteUser(uid); } catch { /* not there */ }
    await auth.createUser({ uid, email, password: PASSWORD, displayName: name });
    await roster.doc(`students/${uid}`).set({ name, username, bbwEmail: email, classId, classIds, mustSetPassword: false, active: true });
    return { uid, username, name };
}

// ---- static server for app-hko/ (localhost = host page, 127.0.0.1 = the iframes) -----------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.woff2': 'font/woff2' };
const ALLOWED_PATH = /^\/(index\.html|hko\.html|js\/[\w.-]+\.js|js\/hko\/[\w.-]+\.js|js\/hko\/blocks\/[\w.-]+\.js|css\/[\w.-]+\.css|fonts\/[\w.-]+\.woff2)$/;
const hostPages = new Map();
const handler = async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const host = /^\/__host-([\w-]+)\.html$/.exec(path);
    if (host && hostPages.has(host[1])) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(hostPages.get(host[1]));
        return;
    }
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !ALLOWED_PATH.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
};
const listen = (h, port) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(port, h, () => resolve(s));
});
const servers = [await listen('127.0.0.1', 0)];
const PORT = servers[0].address().port;
try { servers.push(await listen('::1', PORT)); } catch { /* localhost resolves to 127.0.0.1 then */ }

const enc = encodeURIComponent;
const hkoUrl = (unit, block, extra = '') => `http://127.0.0.1:${PORT}/hko.html?unit=${enc(unit)}&block=${enc(block)}${extra}`;
const boxUrl = (a, s) => `http://127.0.0.1:${PORT}/index.html?assignmentId=${enc(a)}&subId=${enc(s)}`;

/**
 * Registers a host page (as Obsidian Publish) with named iframes and returns its URL.
 * frames: [{ name, src }]. The page records the height messages per frame in window.__heights.
 */
function hostWith(id, frames) {
    hostPages.set(id, `<!doctype html><html lang="de"><meta charset="utf-8"><title>Host ${id}</title><body>
<h1>Host-Seite auf localhost</h1>
<script>window.__heights = {};
addEventListener('message', (e) => {
  if (!e.data || e.data.type !== 'lmsbox-height') return;
  for (const f of document.querySelectorAll('iframe')) if (f.contentWindow === e.source) (window.__heights[f.name] ||= []).push(e.data.height);
});</script>
${frames.map((f) => `<iframe name="${f.name}" src="${f.src}" width="100%" height="460" scrolling="no"></iframe>`).join('\n')}
</body></html>`);
    return `http://localhost:${PORT}/__host-${id}.html`;
}

// ---- helpers --------------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const blocked = [];
const browserLog = [];
const warnings = [];

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
        page.on('response', (r) => { if (r.status() === 404 && !/favicon\.ico$/.test(r.url())) browserLog.push(`404: ${r.url()}`); });
        page.on('console', (m) => {
            if (m.type() === 'error') browserLog.push(`console: ${m.text()}`);
            if (m.type() === 'warning') warnings.push(m.text());
        });
    });
    return context;
}

async function login(scope, username, password = PASSWORD) {
    await scope.locator('#auth-username').fill(username);
    await scope.locator('#auth-password').fill(password);
    await scope.locator('#auth-login-btn').click();
}
const ready = (scope) => scope.locator('#content-renderer[data-modus]').waitFor();
const textEditor = (scope) => scope.locator('.hko-text .ql-editor');
/**
 * Clicks a field and makes sure it has the keyboard focus before anything is typed. The iframes
 * are cross-site, so out-of-process: a click there is routed and the focus moved asynchronously,
 * and on a page with several iframes it now and then did not arrive. The keys then went to the
 * frame focused before (seen as rare timeouts in (d) and (o): status never set, editor empty,
 * focus on <body>). No page code moves the focus (only the logout dialog, which is not open here).
 */
async function clickFocus(target) {
    for (let attempt = 1; ; attempt++) {
        await target.click();
        const focused = await target.evaluate((el) => new Promise((resolve) => {
            const end = Date.now() + 2000;
            const check = () => {
                const has = document.hasFocus() && (el === document.activeElement || el.contains(document.activeElement));
                if (has || Date.now() > end) resolve(has);
                else setTimeout(check, 20);
            };
            check();
        }));
        if (focused) return;
        if (attempt === 3) throw new Error('the clicked field did not get the keyboard focus');
        console.log(`    (click did not focus the field, attempt ${attempt}; clicking again)`);
    }
}
async function typeText(page, scope, text) {
    await clickFocus(textEditor(scope));
    await page.keyboard.press('Control+End');
    await page.keyboard.type(text);
}
async function state(scope, s, timeout = 20000) {
    try {
        await scope.locator(`#save-status[data-state="${s}"]`).waitFor({ timeout });
    } catch (e) {
        const now = await scope.locator('#save-status').getAttribute('data-state', { timeout: 1000 }).catch(() => '?');
        const page = await scope.locator('body').evaluate(() => JSON.stringify({
            modus: document.querySelector('#content-renderer')?.dataset.modus,
            hinweis: document.querySelector('#hko-hinweis')?.dataset.reason,
            dialog: !!document.getElementById('auth-dialog'),
            disabled: !!document.querySelector('.ql-container.ql-disabled'),
            text: document.querySelector('.ql-editor')?.innerText.slice(0, 80),
            focus: `${document.hasFocus()} ${document.activeElement?.className}`,
        }), undefined, { timeout: 1000 }).catch(() => '?');
        throw new Error(`save status "${s}" not reached (shown: "${now}", page: ${page}): ${e.message}`);
    }
}
const saved = (scope) => state(scope, 'cloud');
const frameOf = (host, name) => host.frame({ name });
/** Waits until the text editor of a frame or page shows `text` (polling: hidden iframes get no rAF). */
const shows = (target, text, timeout = 20000) =>
    target.waitForFunction((t) => document.querySelector('.hko-text .ql-editor')?.innerText.includes(t), text, { timeout, polling: 100 });

/** Every Firestore Lite write fails as without a connection; reads keep working. Returns "open again". */
async function blockWrites(context) {
    const isCommit = (url) => url.pathname.endsWith(':commit');
    const abort = (route) => route.abort('internetdisconnected');
    await context.route(isCommit, abort);
    return () => context.unroute(isCommit, abort);
}
/**
 * The answers read of frame `frameName` is answered by the server at once (state of now) but
 * reaches the frame only after release(). Returns { release, held(), done() }.
 */
async function holdAnswerRead(context, frameName) {
    let release;
    const gate = new Promise((r) => { release = r; });
    let held = 0;
    const isRead = (url) => url.pathname.endsWith(':batchGet');
    const hold = async (route) => {
        const req = route.request();
        if (req.frame().name() !== frameName || !String(req.postData() || '').includes('/answers/')) return route.fallback();
        const response = await route.fetch();
        const body = await response.body();
        held++;
        await gate;
        return route.fulfill({ response, body });
    };
    await context.route(isRead, hold);
    return { release: () => release(), held: () => held, done: () => context.unroute(isRead, hold) };
}

async function answerDoc(uid, block, unit = UNIT) {
    const snap = await hko.doc(`answers/${uid}__${unit}__${block}`).get();
    return snap.exists ? snap.data() : null;
}
const answersOf = async (uid) => (await hko.collection('answers').where('uid', '==', uid).get()).docs.map((d) => d.data());
const pasteOf = async (uid) => (await hko.collection('pasteEvents').where('uid', '==', uid).get())
    .docs.map((d) => d.data()).sort((a, b) => a.at.toMillis() - b.at.toMillis());

async function until(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() > end) throw new Error(`Timeout: ${what}`);
        await new Promise((r) => setTimeout(r, 150));
    }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
const markersIn = async (target) => ((await cacheRows(target)) || []).filter((r) => String(r.key).startsWith('unsynced_hko_'));
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

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

// Playwright starts Chrome with third-party storage partitioning OFF; a real browser has it on.
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

// ---- the run ----------------------------------------------------------------------------------

let failed = false;
const browser = await launchChrome();
try {
    await step('(l1) a link with markup in the unit id shows it as text; nothing runs, no login asked', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl('<img src=x onerror="window.__pwned=1">', 'entscheid'));
        await p.locator('#hko-hinweis[data-reason="ungueltiger-link"]').waitFor();
        assert.match(await p.locator('#hko-hinweis').innerText(), /<img src=x onerror="window.__pwned=1">/);
        assert.equal(await p.locator('#content-renderer img, #assignment-container img').count(), 0);
        await sleep(300);
        assert.equal(await p.evaluate(() => window.__pwned), undefined);
        assert.equal(await p.locator('#auth-dialog').count(), 0);
        await c.close();
    });

    await step('(a) four HKO iframes: one login serves all; the same link as its own tab asks for a login (partitioned)', async () => {
        const c = await newContext(browser);
        const host = await c.newPage();
        const frames = [['f0', 'entscheid'], ['f1', 'begriffe-a'], ['f2', 'kn-fall'], ['f3', 'spaeter']];
        await host.goto(hostWith('a', frames.map(([name, block]) => ({ name, src: hkoUrl(UNIT, block) }))));
        const fl = Object.fromEntries(frames.map(([n]) => [n, host.frameLocator(`iframe[name="${n}"]`)]));
        for (const n of Object.keys(fl)) await fl[n].locator('#auth-dialog').waitFor();

        const inner = frameOf(host, 'f0');
        assert.equal(new URL(inner.url()).hostname, '127.0.0.1');
        assert.equal(new URL(host.url()).hostname, 'localhost');
        assert.equal(await inner.evaluate(() => { try { return window.top.location.href; } catch (e) { return e.name; } }), 'SecurityError');

        await login(fl.f1, 'test.3j');
        for (const n of Object.keys(fl)) {
            await ready(fl[n]);
            assert.equal(await fl[n].locator('#auth-dialog').count(), 0, n);
            assert.match(await fl[n].locator('#auth-user').innerText(), /Test Lernende 3J/);
        }
        await textEditor(fl.f0).waitFor();
        assert.equal(await fl.f0.locator('#content-renderer').getAttribute('data-modus'), 'bearbeiten');

        // (l) KI rule above every block, placeholder for `upload`, kn hint instead of input
        for (const n of Object.keys(fl)) {
            const box = fl[n].locator('#hko-ki-regel');
            assert.equal(await box.isVisible(), true, `KI rule visible in ${n}`);
            assert.equal(await box.getAttribute('data-stufe'), 'verboten');
            assert.match(await box.innerText(), /KI nicht erlaubt/);
        }
        assert.match(await fl.f0.locator('#hko-ki-regel').innerText(), /Den Entscheid treffen Sie selbst/);
        assert.equal(await fl.f3.locator('#hko-platzhalter').innerText(), 'Dieser Auftragstyp ist in der Box noch nicht verfügbar.');
        assert.equal(await fl.f2.locator('#content-renderer').getAttribute('data-modus'), 'kn');
        assert.equal(await fl.f2.locator('#hko-hinweis[data-reason="kn"]').innerText(), KN_TEXT);
        assert.equal(await fl.f2.locator('.ql-editor, textarea, input').count(), 0, 'kn: nothing to type in');
        assert.equal(await fl.f0.locator('#sub-title').innerText(), 'Mein Entscheid');

        // the same page as its own tab does not see the iframes' session
        const tab = await c.newPage();
        await tab.goto(hkoUrl(UNIT, 'entscheid'));
        await Promise.race([tab.locator('#auth-dialog').waitFor(), ready(tab)]);
        assert.equal(await tab.locator('#auth-dialog').count(), 1, 'third-party storage partitioning is not active - this run did not test the iframe case');
        await tab.close();

        // (m) height protocol: the host receives lmsbox-height, growing while the text grows
        const lastHeight = () => host.evaluate(() => window.__heights.f0?.at(-1) ?? 0);
        await until('first height from f0', lastHeight);
        await sleep(400);   // the dialog is gone; the last report is the page itself
        const before = await lastHeight();
        await clickFocus(textEditor(fl.f0));
        for (let i = 0; i < 14; i++) { await host.keyboard.type(`Zeile ${i}`); await host.keyboard.press('Enter'); }
        const after = await until('a larger height', async () => {
            const h = await lastHeight();
            return h > before + 150 ? h : null;
        });
        console.log(`    height of the entscheid frame: ${before} px -> ${after} px`);
        await saved(fl.f0);

        // logout in the kn frame (no saver of its own) ends the session everywhere
        await fl.f2.locator('#auth-logout').click();
        for (const n of Object.keys(fl)) await fl[n].locator('#auth-dialog').waitFor();
        await c.close();
    });

    await step('(b) text: typed, saved with exactly the fields of contract §4; reload with emptied IndexedDB brings it from the server, without a write', async () => {
        const me = await person('hko-e2e-b', 'hko.bea', 'Test Bea');
        const TEXT = 'Ich entscheide mich fuer Angebot A, weil es guenstiger ist.';
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, me.username);
        await textEditor(p).waitFor();
        assert.equal(await p.locator('.hko-woerter').getAttribute('data-words'), '0');
        await typeText(p, p, TEXT);
        await saved(p);

        const d = await until('answer', () => answerDoc(me.uid, 'entscheid'));
        assert.deepEqual(Object.keys(d).sort(), ANSWER_KEYS);
        assert.equal(d.uid, me.uid);
        assert.equal(d.classId, 'test-3j-a');
        assert.equal(d.unitId, UNIT);
        assert.equal(d.blockId, 'entscheid');
        assert.equal(d.unitVersion, 1);
        assert.equal(d.variante, '3J');
        assert.equal(d.type, 'text');
        assert.equal(d.status, 'entwurf');
        assert.equal(d.kn, false);
        assert.ok(d.updatedAt instanceof Timestamp);
        assert.deepEqual(d.value, { text: TEXT });
        assert.doesNotMatch(JSON.stringify({ ...d, value: null }), /Bea|hko\.bea|@/, 'an answer carries no name');
        assert.equal((await answersOf(me.uid)).length, 1, 'only the visible block was written');
        assert.deepEqual(await markersIn(p), [], 'the marker is gone once the server has the text');
        assert.equal(await p.locator('.hko-woerter').getAttribute('data-words'), '10');

        assert.equal(await clearStore(p, 'LMS_AssignmentsDB', 'user_data'), true);
        await p.reload();
        await shows(p, TEXT);
        assert.equal(await p.locator('#auth-dialog').count(), 0);
        await sleep(3000);   // longer than the debounce: loading must not write
        const again = await answerDoc(me.uid, 'entscheid');
        assert.equal(again.updatedAt.toMillis(), d.updatedAt.toMillis(), 'restore() wrote nothing');
        assert.ok([null, ''].includes(await p.locator('#save-status').getAttribute('data-state')), 'no save on load');
        await c.close();
    });

    await step('(h) text over 20 000 characters: "zu lang", nothing written; shortened again it saves', async () => {
        const me = await person('hko-e2e-h', 'hko.hugo', 'Test Hugo');
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, me.username);
        await textEditor(p).waitFor();
        await typeText(p, p, 'Kurz und gut.');
        await saved(p);
        await p.evaluate(() => window.Quill.find(document.querySelector('.hko-text .ql-container')).insertText(0, 'x'.repeat(20001), 'user'));
        await state(p, 'too_large');
        assert.match(await p.locator('#save-status').innerText(), /zu lang/);
        assert.match(await p.locator('#save-status').innerText(), /Ihre/);
        assert.deepEqual((await answerDoc(me.uid, 'entscheid')).value, { text: 'Kurz und gut.' });
        assert.equal((await markersIn(p))[0]?.value?.state, 'too_large');
        await p.evaluate(() => window.Quill.find(document.querySelector('.hko-text .ql-container')).setText('Wieder kurz.', 'user'));
        await saved(p);
        assert.deepEqual((await answerDoc(me.uid, 'entscheid')).value, { text: 'Wieder kurz.' });
        await c.close();
    });

    await step('(c) writes fail: "nicht gespeichert", local marker; reload shows the local text; when writes work again it reaches the server', async () => {
        const me = await person('hko-e2e-c', 'hko.cem', 'Test Cem');
        const FIRST = 'Cem erste Fassung';
        const FULL = `${FIRST} und der neue Schluss`;
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, me.username);
        await textEditor(p).waitFor();
        await typeText(p, p, FIRST);
        await saved(p);

        const open = await blockWrites(c);
        await typeText(p, p, ' und der neue Schluss');
        await state(p, 'error');
        assert.match(await p.locator('#save-status').innerText(), /Nicht gespeichert/);
        const [marker] = await markersIn(p);
        assert.equal(marker.key, `unsynced_hko_${UNIT}_entscheid`);
        assert.equal(marker.value.state, 'error');
        assert.deepEqual(marker.value.value, { text: FULL });
        assert.equal((await answerDoc(me.uid, 'entscheid')).value.text, FIRST);

        await p.reload();
        await shows(p, 'der neue Schluss', 8000);
        await state(p, 'error', 8000);
        await sleep(2500);
        assert.equal(await p.locator('#save-status').getAttribute('data-state'), 'error', 'never "saved" while writes fail');
        assert.equal((await answerDoc(me.uid, 'entscheid')).value.text, FIRST);

        await open();
        await p.reload();
        await saved(p);
        assert.equal((await textEditor(p).innerText()).trim(), FULL);
        assert.equal((await answerDoc(me.uid, 'entscheid')).value.text, FULL);
        assert.deepEqual(await markersIn(p), []);
        await c.close();
    });

    await step('(d) isInitializing: a second frame of the same block that loads late with the older state writes nothing; siblings do not write on load', async () => {
        const me = await person('hko-e2e-d', 'hko.dana', 'Test Dana');
        const c = await newContext(browser);
        const host = await c.newPage();
        await host.goto(hostWith('d', [
            { name: 'f0', src: hkoUrl(UNIT, 'entscheid') },
            { name: 'f1', src: hkoUrl(UNIT, 'entscheid') },
            { name: 'f2', src: hkoUrl(OTHER, 'notiz') },
        ]));
        const f = ['f0', 'f1', 'f2'].map((n) => host.frameLocator(`iframe[name="${n}"]`));
        await f[0].locator('#auth-dialog').waitFor();
        await login(f[0], me.username);
        for (const x of f) await textEditor(x).waitFor();
        await typeText(host, f[0], 'Dana erste Fassung');
        await saved(f[0]);
        await typeText(host, f[2], 'Notiz von Dana');
        await saved(f[2]);
        const notizBefore = await answerDoc(me.uid, 'notiz', OTHER);
        assert.equal(notizBefore.unitId, OTHER);

        const gate = await holdAnswerRead(c, 'f1');
        await host.reload();
        await shows(frameOf(host, 'f0'), 'Dana erste Fassung');
        await until('f1 holds its old snapshot', () => gate.held() > 0);
        await typeText(host, f[0], ' und weiter');
        await saved(f[0]);
        const typed = await answerDoc(me.uid, 'entscheid');
        assert.equal(typed.value.text, 'Dana erste Fassung und weiter');
        gate.release();
        await shows(frameOf(host, 'f1'), 'Dana erste Fassung');   // the old state, shown, not written
        await sleep(3000);
        await gate.done();
        const after = await answerDoc(me.uid, 'entscheid');
        assert.equal(after.value.text, 'Dana erste Fassung und weiter');
        assert.equal(after.updatedAt.toMillis(), typed.updatedAt.toMillis(), 'the late frame did not write');
        assert.ok([null, ''].includes(await f[1].locator('#save-status').getAttribute('data-state')), 'the late frame shows no save');
        const notizAfter = await answerDoc(me.uid, 'notiz', OTHER);
        assert.equal(notizAfter.updatedAt.toMillis(), notizBefore.updatedAt.toMillis(), 'a sibling that only loaded did not write');
        await c.close();
    });

    await step('(e) variants: 3J sees raster-4j as hint without a document, 4J sees raster-3j so; text saves with the own variant', async () => {
        for (const [username, uid, own, other, classId] of [['test.3jb', 'hko-seed-3j-b', '3J', '4J', 'test-3j-a'], ['test.4j', 'hko-seed-4j', '4J', '3J', 'test-4j-a']]) {
            const c = await newContext(browser);
            const host = await c.newPage();
            await host.goto(hostWith(`e-${own}`, [
                { name: 'own', src: hkoUrl(UNIT, `raster-${own.toLowerCase()}`) },
                { name: 'other', src: hkoUrl(UNIT, `raster-${other.toLowerCase()}`) },
                { name: 'text', src: hkoUrl(UNIT, 'entscheid') },
            ]));
            const [fo, fx, ft] = ['own', 'other', 'text'].map((n) => host.frameLocator(`iframe[name="${n}"]`));
            await fo.locator('#auth-dialog').waitFor();
            await login(fo, username);
            for (const x of [fo, fx, ft]) await ready(x);
            assert.equal(await fo.locator('#hko-hinweis').count(), 0, `${own}: own raster without hint`);
            assert.equal(await fo.locator('#content-renderer').getAttribute('data-modus'), 'bearbeiten');
            assert.equal(await fx.locator('#content-renderer').getAttribute('data-modus'), 'lesen');
            assert.equal(await fx.locator('#hko-hinweis').getAttribute('data-reason'), 'block-variante');
            assert.equal(await fx.locator('#hko-hinweis').innerText(), `Dieser Auftrag gilt für die ${other[0]}-jährige Lehre.`);
            await typeText(host, ft, `Text der Variante ${own}`);
            await saved(ft);
            const d = await answerDoc(uid, 'entscheid');
            assert.equal(d.variante, own);
            assert.equal(d.classId, classId);
            assert.equal(await answerDoc(uid, `raster-${other.toLowerCase()}`), null);
            await c.close();
        }
    });

    await step('(f) class not recorded / inactive / 2J: hint, input locked, no document; two classes of different variants: the first counts', async () => {
        const cases = [
            ['test.unbekannt', 'hko-seed-unbekannt', 'klasse-fehlt', /noch nicht erfasst/],
            ['test.inaktiv', 'hko-seed-inaktiv', 'klasse-inaktiv', /nicht freigeschaltet/],
            ['test.2j', 'hko-seed-2j', 'einheit-variante', /^Diese Einheit ist für Ihre Lehre nicht vorgesehen\.$/],
        ];
        for (const [username, uid, reason, text] of cases) {
            const c = await newContext(browser);
            const p = await c.newPage();
            await p.goto(hkoUrl(UNIT, 'entscheid'));
            await login(p, username);
            await ready(p);
            assert.equal(await p.locator('#content-renderer').getAttribute('data-modus'), 'lesen', username);
            assert.equal(await p.locator('#hko-hinweis').getAttribute('data-reason'), reason);
            assert.match(await p.locator('#hko-hinweis').innerText(), text);
            assert.equal(await p.locator('.hko-text .ql-container.ql-disabled').count(), 1, 'editor locked');
            await textEditor(p).click({ force: true });
            await p.keyboard.type('darf nicht ankommen');
            await sleep(2600);
            assert.equal(await answerDoc(uid, 'entscheid'), null);
            assert.equal(await p.locator('#save-status').getAttribute('data-state'), null, 'no save status at all');
            await c.close();
        }

        const c = await newContext(browser);
        const p = await c.newPage();
        const warned = warnings.length;
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, 'test.zwei');
        await textEditor(p).waitFor();
        assert.equal(await p.locator('#hko-hinweis').count(), 0);
        await typeText(p, p, 'Zwei Klassen, die erste gilt.');
        await saved(p);
        const d = await answerDoc('hko-seed-zwei', 'entscheid');
        assert.equal(d.variante, '3J');
        assert.equal(d.classId, 'test-3j-a');
        assert.ok(warnings.slice(warned).some((w) => /verschiedenen Varianten/.test(w)), 'console warning about two variants');
        await c.close();
    });

    await step('(i) logout writes the waiting debounce first; on a mixed page the lms_box frame asks while HKO text is unsaved', async () => {
        const me = await person('hko-e2e-i', 'hko.ines', 'Test Ines');
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, me.username);
        await textEditor(p).waitFor();
        await typeText(p, p, 'Ines tippt und meldet sich sofort ab');
        await p.locator('#auth-logout').click();   // inside the 2 s debounce
        await p.locator('#auth-dialog').waitFor();
        assert.equal(await p.locator('#logout-confirm').count(), 0, 'nothing to ask: the flush worked');
        assert.equal((await answerDoc(me.uid, 'entscheid'))?.value?.text, 'Ines tippt und meldet sich sofort ab');
        assert.deepEqual(await cacheRows(p), []);
        await c.close();

        // mixed host page: one lms_box iframe, one HKO iframe. Under the one HKO ruleset of this
        // emulator the lms_box frame cannot load its assignment; sign-in and logout still work.
        const me2 = await person('hko-e2e-i2', 'hko.ivan', 'Test Ivan');
        const c2 = await newContext(browser);
        const host = await c2.newPage();
        await host.goto(hostWith('i', [
            { name: 'box', src: boxUrl('0.1 Testauftrag', 'A. Teil') },
            { name: 'hko', src: hkoUrl(UNIT, 'entscheid') },
        ]));
        const [fb, fh] = ['box', 'hko'].map((n) => host.frameLocator(`iframe[name="${n}"]`));
        await fh.locator('#auth-dialog').waitFor();
        await login(fh, me2.username);
        await textEditor(fh).waitFor();
        await fb.locator('#auth-logout').waitFor();
        await typeText(host, fh, 'Ivan gespeichert');
        await saved(fh);
        const open = await blockWrites(c2);
        await typeText(host, fh, ' und ungespeichert');
        await fb.locator('#auth-logout').click();
        await fb.locator('#logout-confirm').waitFor({ timeout: 12000 });
        await fb.locator('#logout-confirm-stay').click();
        await fb.locator('#logout-confirm').waitFor({ state: 'detached' });
        await state(fh, 'error');
        assert.equal(await fh.locator('#auth-dialog').count(), 0, 'still signed in');
        assert.equal((await answerDoc(me2.uid, 'entscheid')).value.text, 'Ivan gespeichert');
        // writes work again: the next logout flushes the HKO frame and asks nothing
        await open();
        await fb.locator('#auth-logout').click();
        for (const x of [fb, fh]) await x.locator('#auth-dialog').waitFor();
        assert.equal((await answerDoc(me2.uid, 'entscheid')).value.text, 'Ivan gespeichert und ungespeichert');
        await c2.close();
    });

    await step('(j) a second person in the same browser sees nothing of the first (cache emptied, no marker left)', async () => {
        const a = await person('hko-e2e-ja', 'hko.jan', 'Test Jan');
        const b = await person('hko-e2e-jb', 'hko.jil', 'Test Jil');
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, a.username);
        await textEditor(p).waitFor();
        const open = await blockWrites(c);
        await typeText(p, p, 'Jans geheimer Entwurf');
        await state(p, 'error');
        assert.equal((await markersIn(p)).length, 1, 'precondition: an unsynced marker of Jan');
        // Jan's session ends WITHOUT the logout button; his marker is still in the shared cache.
        await clearStore(p, 'firebaseLocalStorageDb', 'firebaseLocalStorage');
        await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('firebase:')).forEach((k) => localStorage.removeItem(k)));
        await open();
        await p.goto('about:blank');
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await p.locator('#auth-dialog').waitFor();
        await login(p, b.username);
        await textEditor(p).waitFor();
        await sleep(2600);
        assert.equal((await textEditor(p).innerText()).trim(), '');
        assert.doesNotMatch(await p.locator('body').innerText(), /Jans geheimer|Test Jan/);
        assert.deepEqual(await markersIn(p), []);
        assert.equal(await answerDoc(b.uid, 'entscheid'), null, 'Jil wrote nothing, and nothing of Jan under her name');
        assert.equal(await answerDoc(a.uid, 'entscheid'), null);
        await c.close();
    });

    await step('(k) paste hints in Quill: typing and a blocked paste report nothing; inserted text creates one hko/pasteEvents document', async () => {
        const me = await person('hko-e2e-k', 'hko.kim', 'Test Kim');
        const LONG = 'Dieser Absatz kommt aus der Zwischenablage und ist deutlich laenger als vierzig Zeichen.';
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, me.username);
        await textEditor(p).waitFor();
        await textEditor(p).click();
        await p.keyboard.type('Ich schreibe selbst, Buchstabe fuer Buchstabe, ganz ruhig.', { delay: 70 });
        await textEditor(p).evaluate((el, text) => {
            const data = new DataTransfer();
            data.setData('text/plain', text);
            el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, LONG);
        await p.locator('.hko-feld-meldung').first().waitFor();
        await saved(p);
        await sleep(2000);
        assert.deepEqual(await pasteOf(me.uid), []);
        assert.doesNotMatch(await textEditor(p).innerText(), /Zwischenablage/);

        await p.keyboard.press('Control+End');
        await textEditor(p).evaluate((el, text) => document.execCommand('insertText', false, text), ' ' + LONG);
        await until('bulk event', async () => (await pasteOf(me.uid)).length === 1);
        await p.getByText('Ihre Lehrperson sieht diesen Hinweis').first().waitFor();
        const [ev] = await pasteOf(me.uid);
        assert.deepEqual(Object.keys(ev).sort(), PASTE_KEYS);
        assert.equal(ev.kind, 'bulk');
        assert.equal(ev.feld, 'text');
        assert.equal(ev.unitId, UNIT);
        assert.equal(ev.blockId, 'entscheid');
        assert.equal(ev.excerpt, ' ' + LONG);
        assert.equal(ev.chars, LONG.length + 1);
        await c.close();
    });

    await step('(l2) unknown unit and unknown block: German text, no input', async () => {
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl('gibt-es-nicht', 'entscheid'));
        await login(p, 'test.3j');
        await p.locator('#hko-hinweis[data-reason="einheit-fehlt"]').waitFor();
        assert.match(await p.locator('#hko-hinweis').innerText(), /«gibt-es-nicht» gibt es nicht/);
        await p.goto(hkoUrl(UNIT, 'kein-block'));
        await p.locator('#hko-hinweis[data-reason="block-fehlt"]').waitFor();
        assert.equal(await p.locator('.ql-editor').count(), 0);
        await c.close();
    });

    const ATTACK = '<img src=x onerror="window.__pwned=1"> Ich waehle A & B.';
    const LONG = 'Dieser Absatz kommt aus der Zwischenablage und ist deutlich laenger als vierzig Zeichen.';
    const wertIn = (scope, block) => scope.locator(`.hko-mitnahme-quelle[data-block="${block}"] .hko-mitnahme-wert`);
    const wertState = (scope, block, leer) => scope.locator(`.hko-mitnahme-quelle[data-block="${block}"] .hko-mitnahme-wert[data-leer="${leer}"]`).waitFor();
    const answerBase = (uid) => ({ uid, classId: 'test-3j-a', unitVersion: 1, variante: '3J', status: 'entwurf', kn: false, updatedAt: Timestamp.now() });
    /** Adds an iframe to a host page that is already open. */
    const addFrame = (host, name, src) => host.evaluate(([n, s]) => {
        const i = document.createElement('iframe');
        i.name = n; i.src = s; i.width = '100%'; i.height = 460;
        document.body.appendChild(i);
    }, [name, src]);

    await step('(g) mitnahme: live from a sibling, a late iframe gets the unsaved state, other unit, escaped; another uid on the channel and a second person see nothing', async () => {
        const me = await person('hko-e2e-g', 'hko.gina', 'Test Gina');
        const other = await person('hko-e2e-g2', 'hko.gil', 'Test Gil');
        await hko.doc(`answers/${me.uid}__${OTHER}__notiz`).set({ ...answerBase(me.uid), unitId: OTHER, blockId: 'notiz', type: 'text', value: { text: 'Notiz <b>fett</b>\nzweite Zeile' } });
        await hko.doc(`answers/${me.uid}__${UNIT}__raster-quelle`).set({ ...answerBase(me.uid), unitId: UNIT, blockId: 'raster-quelle', type: 'raster', value: { zeilen: [{ c: ['a', 'b', 'c'] }], befund: 'Mein <u>Befund</u>' } });

        const c = await newContext(browser);
        const host = await c.newPage();
        await host.goto(hostWith('g', [{ name: 'f0', src: hkoUrl(UNIT, 'entscheid') }, { name: 'f1', src: hkoUrl(UNIT, 'rueckblick') }]));
        const [f0, f1] = ['f0', 'f1'].map((n) => host.frameLocator(`iframe[name="${n}"]`));
        await f0.locator('#auth-dialog').waitFor();
        await login(f0, me.username);
        await textEditor(f0).waitFor();
        await wertState(f1, 'entscheid', 'ja');
        assert.equal(await wertIn(f1, 'entscheid').innerText(), 'Noch nichts geschrieben.');
        assert.deepEqual(await f1.locator('.hko-mitnahme-label').allInnerTexts(), ['Mein Entscheid', 'Befund zur Quelle', 'Notiz aus der anderen Einheit']);
        await wertState(f1, 'raster-quelle', 'nein');
        assert.equal(await wertIn(f1, 'raster-quelle').innerText(), 'Mein <u>Befund</u>', 'feld befund only, as text');
        await wertState(f1, 'notiz', 'nein');
        assert.equal(await wertIn(f1, 'notiz').innerText(), 'Notiz <b>fett</b>\nzweite Zeile', 'other unit, line break kept');
        assert.equal(await f1.locator('.hko-mitnahme b, .hko-mitnahme u').count(), 0);
        assert.equal(await f1.locator('.ql-editor, textarea, input').count(), 0, 'mitnahme has no input');

        // live: the sibling shows the text while it is typed, before the server has it
        await typeText(host, f0, ATTACK);
        await f1.locator('.hko-mitnahme-quelle[data-block="entscheid"] .hko-mitnahme-wert[data-leer="nein"]').waitFor({ timeout: 5000 });
        await until('the whole text in f1', async () => (await wertIn(f1, 'entscheid').innerText()) === ATTACK, 5000);
        assert.equal(await f1.locator('.hko-mitnahme img').count(), 0);
        assert.equal(await frameOf(host, 'f1').evaluate(() => window.__pwned), undefined);
        await saved(f0);
        assert.deepEqual((await answerDoc(me.uid, 'entscheid')).value, { text: ATTACK });
        assert.equal(await answerDoc(me.uid, 'rueckblick'), null, 'mitnahme writes nothing');

        // late iframe while the newest text is only local (writes fail): it shows the local state
        const open = await blockWrites(c);
        await typeText(host, f0, ' Nachtrag');
        await state(f0, 'error');
        assert.equal((await answerDoc(me.uid, 'entscheid')).value.text, ATTACK);
        await addFrame(host, 'f2', hkoUrl(UNIT, 'rueckblick'));
        const f2 = host.frameLocator('iframe[name="f2"]');
        await ready(f2);
        await until('f2 shows the unsaved Nachtrag', async () => (await wertIn(f2, 'entscheid').innerText()) === `${ATTACK} Nachtrag`, 8000);
        await open();

        // the channel: a message with another uid changes nothing; the same with the own uid does
        const post = (uid, text) => frameOf(host, 'f0').evaluate(([u, t, unit]) => {
            const ch = new BroadcastChannel('hko-answers');
            ch.postMessage({ v: 1, uid: u, unitId: unit, blockId: 'entscheid', value: { text: t }, rev: 'x' });
            ch.close();
        }, [uid, text, UNIT]);
        await post(other.uid, 'Fremder Text von Gil');
        await sleep(800);
        assert.equal(await wertIn(f1, 'entscheid').innerText(), `${ATTACK} Nachtrag`, 'another uid is ignored');
        await post(me.uid, 'Kontrolle mit eigener uid');
        await until('own uid is shown', async () => (await wertIn(f1, 'entscheid').innerText()) === 'Kontrolle mit eigener uid', 5000);

        // a second person in another tab (its own top-level site, its own login) sees none of it
        const tab = await c.newPage();
        await tab.goto(hkoUrl(UNIT, 'rueckblick'));
        await tab.locator('#auth-dialog').waitFor();
        await login(tab, other.username);
        await ready(tab);
        for (const b of ['entscheid', 'raster-quelle', 'notiz']) await wertState(tab, b, 'ja');
        await typeText(host, f0, ' noch mehr');
        await sleep(1500);
        for (const b of ['entscheid', 'raster-quelle', 'notiz']) assert.equal(await wertIn(tab, b).innerText(), 'Noch nichts geschrieben.', b);
        assert.doesNotMatch(await tab.locator('body').innerText(), /Gina|Nachtrag|Befund<|fett/);
        await c.close();
    });

    await step('(h2) limits: 12 items and the full 8 x 6 raster (500 characters per cell) save; 501 characters is "zu lang" and the server keeps the last state', async () => {
        const me = await person('hko-e2e-h2', 'hko.hanna', 'Test Hanna');
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'begriffe-voll'));
        await login(p, me.username);
        await ready(p);
        const ed = p.locator('.hko-items .ql-editor');
        assert.equal(await ed.count(), 12);
        for (let i = 0; i < 12; i++) { await clickFocus(ed.nth(i)); await p.keyboard.type(`Antwort ${i + 1}`); }
        await saved(p);
        const d = await answerDoc(me.uid, 'begriffe-voll');
        assert.equal(d.type, 'items');
        assert.deepEqual(Object.keys(d.value), ['antworten']);
        assert.equal(d.value.antworten.length, 12);
        assert.equal(new Set(d.value.antworten.map((a) => a.frageId)).size, 12);
        assert.deepEqual(d.value.antworten.map((a) => a.text), Array.from({ length: 12 }, (_, i) => `Antwort ${i + 1}`));

        await p.goto(hkoUrl(UNIT, 'raster-voll'));
        await ready(p);
        const cells = p.locator('textarea.hko-raster-zelle');
        assert.equal(await cells.count(), 48);
        const z = 'z'.repeat(500);
        for (let i = 0; i < 48; i++) await cells.nth(i).fill(z);
        await p.locator('textarea.hko-raster-befund-feld').fill('y'.repeat(3000));
        await state(p, 'cloud', 30000);
        const r = await answerDoc(me.uid, 'raster-voll');
        assert.deepEqual(Object.keys(r.value).sort(), ['befund', 'zeilen']);
        assert.equal(r.value.zeilen.length, 8);
        assert.ok(r.value.zeilen.every((row) => Object.keys(row).join() === 'c' && row.c.length === 6 && row.c.every((s) => s === z)));
        assert.equal(r.value.befund.length, 3000);
        await cells.nth(0).fill('x'.repeat(501));
        await state(p, 'too_large');
        assert.match(await p.locator('#save-status').innerText(), /zu lang/);
        await sleep(500);
        assert.equal((await answerDoc(me.uid, 'raster-voll')).updatedAt.toMillis(), r.updatedAt.toMillis(), 'server unchanged');
        await c.close();
    });

    await step('(e2) variants with raster input: own raster saves with the own variant, the other raster is locked and writes nothing; an unknown class writes nothing', async () => {
        for (const [own, other, classId] of [['3j', '4j', 'test-3j-a'], ['4j', '3j', 'test-4j-a']]) {
            const me = await person(`hko-e2e-e${own}`, `hko.erik${own}`, `Test Erik ${own.toUpperCase()}`, classId);
            const c = await newContext(browser);
            const host = await c.newPage();
            await host.goto(hostWith(`e2-${own}`, [
                { name: 'own', src: hkoUrl(UNIT, `raster-${own}`) },
                { name: 'other', src: hkoUrl(UNIT, `raster-${other}`) },
            ]));
            const [fo, fx] = ['own', 'other'].map((n) => host.frameLocator(`iframe[name="${n}"]`));
            await fo.locator('#auth-dialog').waitFor();
            await login(fo, me.username);
            for (const x of [fo, fx]) await ready(x);
            assert.equal(await fo.locator('#content-renderer').getAttribute('data-modus'), 'bearbeiten');
            assert.equal(await fo.locator('textarea.hko-raster-zelle').count(), 9);
            await fo.locator('textarea.hko-raster-zelle').nth(0).fill(`Eintrag ${own}`);
            await fo.locator('textarea.hko-raster-befund-feld').fill(`Befund ${own}`);
            await saved(fo);
            const d = await answerDoc(me.uid, `raster-${own}`);
            assert.equal(d.type, 'raster');
            assert.equal(d.variante, own.toUpperCase());
            assert.equal(d.classId, classId);
            assert.equal(d.value.zeilen[0].c[0], `Eintrag ${own}`);
            assert.equal(d.value.befund, `Befund ${own}`);

            assert.equal(await fx.locator('#content-renderer').getAttribute('data-modus'), 'lesen');
            assert.equal(await fx.locator('#hko-hinweis').getAttribute('data-reason'), 'block-variante');
            assert.equal(await fx.locator('textarea:not([disabled])').count(), 0, 'other raster locked');
            await frameOf(host, 'other').evaluate(() => {
                const f = document.querySelector('textarea.hko-raster-zelle');
                f.value = 'darf nicht ankommen';
                f.dispatchEvent(new Event('input', { bubbles: true }));
            });
            await sleep(2600);
            assert.equal(await answerDoc(me.uid, `raster-${other}`), null, `raster-${other}: no document`);
            assert.equal(await fx.locator('#save-status').getAttribute('data-state'), null);
            await c.close();
        }
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'raster-3j'));
        await login(p, 'test.unbekannt');
        await ready(p);
        assert.equal(await p.locator('#content-renderer').getAttribute('data-modus'), 'lesen');
        assert.equal(await p.locator('#hko-hinweis').getAttribute('data-reason'), 'klasse-fehlt');
        assert.equal(await p.locator('textarea:not([disabled])').count(), 0);
        await sleep(2600);
        assert.equal(await answerDoc('hko-seed-unbekannt', 'raster-3j'), null);
        await c.close();
    });

    await step('(k2) paste hints in a raster cell (feld r<z>c<s>) and in an item (feld = frageId); typing reports nothing; selbst stores levels as numbers', async () => {
        const me = await person('hko-e2e-k2', 'hko.kai', 'Test Kai');
        const c = await newContext(browser);
        const p = await c.newPage();
        await p.goto(hkoUrl(UNIT, 'raster-quelle'));
        await login(p, me.username);
        await ready(p);
        await clickFocus(p.locator('textarea[data-feld="r1c1"]'));
        await p.keyboard.type('Selbst getippt in der Zelle, Buchstabe fuer Buchstabe.', { delay: 20 });
        await p.locator('textarea[data-feld="r1c1"]').evaluate((el, text) => {
            const data = new DataTransfer();
            data.setData('text/plain', text);
            el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
        }, LONG);
        await p.locator('.hko-feld-meldung').first().waitFor();
        await saved(p);
        await sleep(1500);
        assert.deepEqual(await pasteOf(me.uid), [], 'typing and a blocked paste report nothing');
        assert.equal(await p.locator('textarea[data-feld="r1c1"]').inputValue(), 'Selbst getippt in der Zelle, Buchstabe fuer Buchstabe.');

        await p.locator('textarea[data-feld="r2c0"]').focus();
        await p.evaluate((text) => document.execCommand('insertText', false, text), LONG);
        await until('raster paste event', async () => (await pasteOf(me.uid)).length === 1);
        let [ev] = await pasteOf(me.uid);
        assert.deepEqual(Object.keys(ev).sort(), PASTE_KEYS);
        assert.equal(ev.feld, 'r2c0');
        assert.equal(ev.kind, 'bulk');
        assert.equal(ev.blockId, 'raster-quelle');
        assert.equal(ev.excerpt, LONG);
        await saved(p);

        await p.goto(hkoUrl(UNIT, 'begriffe-a'));
        await ready(p);
        const ed = p.locator('.hko-items .ql-editor');
        await clickFocus(ed.nth(1));
        await p.keyboard.type('Eigene Worte', { delay: 20 });
        await sleep(300);
        await ed.nth(1).evaluate((el, text) => document.execCommand('insertText', false, text), ` ${LONG}`);
        await until('item paste event', async () => (await pasteOf(me.uid)).length === 2);
        ev = (await pasteOf(me.uid))[1];
        assert.equal(ev.feld, 'testbegriff-2');
        assert.equal(ev.blockId, 'begriffe-a');
        await saved(p);
        assert.deepEqual((await answerDoc(me.uid, 'begriffe-a')).value, { antworten: [{ frageId: 'testbegriff-2', text: `Eigene Worte ${LONG}` }] });

        await p.goto(hkoUrl(UNIT, 'selbst-entscheid'));
        await ready(p);
        await p.locator('.hko-krit[data-krit="argumentation"] label', { hasText: 'Stufe 2' }).click();
        await p.locator('.hko-krit[data-krit="position"] label', { hasText: 'Stufe 0' }).click();
        await saved(p);
        const s = await answerDoc(me.uid, 'selbst-entscheid');
        assert.deepEqual(s.value.stufen, { argumentation: 2, position: 0 });
        assert.ok(Object.values(s.value.stufen).every((n) => typeof n === 'number' && Number.isInteger(n)), 'levels are numbers');
        assert.equal(s.type, 'selbst');
        assert.equal((await pasteOf(me.uid)).length, 2, 'clicking levels reports nothing');
        await c.close();
    });

    await step('(n) print: popup with every block of the own variant in order, the name, escaped answers, unsaved local text; nothing of other people; popup blocked gives a hint, no alert', async () => {
        const me = await person('hko-e2e-n', 'hko.nora', 'Nora <i>Fiktiv</i> & Co');
        const other = await person('hko-e2e-n2', 'hko.nils', 'Test Nils');
        const base = answerBase(me.uid);
        await hko.doc(`answers/${me.uid}__${UNIT}__begriffe-a`).set({ ...base, unitId: UNIT, blockId: 'begriffe-a', type: 'items', value: { antworten: [{ frageId: 'testbegriff-1', text: '<script>window.__pwned=1</script>Antwort eins' }] } });
        await hko.doc(`answers/${me.uid}__${UNIT}__raster-3j`).set({ ...base, unitId: UNIT, blockId: 'raster-3j', type: 'raster', value: { zeilen: [{ c: ['<b>Zelle</b>', 'zwei', 'drei'] }], befund: 'Befund 3J' } });
        await hko.doc(`answers/${me.uid}__${UNIT}__raster-4j`).set({ ...base, unitId: UNIT, blockId: 'raster-4j', type: 'raster', value: { zeilen: [{ c: ['Nur fuer 4J', '', ''] }], befund: '' } });
        await hko.doc(`answers/${me.uid}__${UNIT}__selbst-entscheid`).set({ ...base, unitId: UNIT, blockId: 'selbst-entscheid', type: 'selbst', value: { stufen: { argumentation: 3 }, begruendung: 'Weil <i>so</i>', verbessere: '' } });
        await hko.doc(`answers/${other.uid}__${UNIT}__entscheid`).set({ ...answerBase(other.uid), unitId: UNIT, blockId: 'entscheid', type: 'text', value: { text: 'Fremder Text von Nils' } });

        const c = await newContext(browser);
        const host = await c.newPage();
        await host.goto(hostWith('n', [{ name: 'f0', src: hkoUrl(UNIT, 'entscheid') }]));
        const f0 = host.frameLocator('iframe[name="f0"]');
        await f0.locator('#auth-dialog').waitFor();
        await login(f0, me.username);
        await textEditor(f0).waitFor();
        await typeText(host, f0, ATTACK);
        await saved(f0);
        const open = await blockWrites(c);
        await typeText(host, f0, ' und noch ungespeichert');
        await state(f0, 'error');

        const popupP = c.waitForEvent('page');
        await f0.locator('#print-answers').click();
        const pop = await popupP;
        await pop.locator('.hko-kopf').waitFor();
        const body = await pop.locator('body').innerText();
        assert.match(body, /Testeinheit Box/);
        assert.ok(body.includes('Nora <i>Fiktiv</i> & Co'), 'name shown, as text');
        assert.ok(body.includes(`${ATTACK} und noch ungespeichert`), 'the unsaved local text is printed, as text');
        assert.ok(body.includes('<script>window.__pwned=1</script>Antwort eins'));
        assert.ok(body.includes('<b>Zelle</b>'));
        assert.ok(body.includes('Weil <i>so</i>'));
        assert.equal(await pop.locator('img, i, b, script').count(), 0, 'nothing injected');
        assert.equal(await pop.evaluate(() => window.__pwned), undefined);
        assert.doesNotMatch(body, /Nur fuer 4J|Fremder Text|Nils/);
        const ids = await pop.locator('.hko-druck-block').evaluateAll((l) => l.map((e) => e.dataset.block));
        assert.deepEqual(ids, ['begriffe-a', 'begriffe-voll', 'raster-quelle', 'raster-voll', 'raster-3j', 'entscheid', 'selbst-entscheid'], 'own variant, order of reihenfolge; no raster-4j, mitnahme, kn, placeholder');
        await pop.close();
        await open();
        await c.close();

        const c2 = await newContext(browser);
        await c2.addInitScript(() => { window.open = () => null; window.alert = () => { window.__alert = 1; }; });
        const p = await c2.newPage();
        await p.goto(hkoUrl(UNIT, 'entscheid'));
        await login(p, other.username);
        await textEditor(p).waitFor();
        await p.locator('#print-answers').click();
        await p.locator('#hko-meldung').waitFor();
        assert.match(await p.locator('#hko-meldung').innerText(), /blockiert.*Erlauben Sie/);
        assert.equal(await p.evaluate(() => window.__alert), undefined);
        await c2.close();
    });

    await step('(o) load: a host page with 10 HKO iframes shows every block in under 10 s after the login; every frame with input saves', async () => {
        const me = await person('hko-e2e-o', 'hko.olga', 'Test Olga');
        const frames = [
            ['o0', UNIT, 'begriffe-a', 'items'], ['o1', UNIT, 'begriffe-voll', 'items'], ['o2', UNIT, 'raster-quelle', 'raster'],
            ['o3', UNIT, 'raster-voll', 'raster'], ['o4', UNIT, 'raster-3j', 'raster'], ['o5', UNIT, 'entscheid', 'text'],
            ['o6', UNIT, 'selbst-entscheid', 'selbst'], ['o7', OTHER, 'notiz', 'text'], ['o8', UNIT, 'rueckblick', null], ['o9', UNIT, 'raster-4j', null],
        ];
        const c = await newContext(browser);
        const host = await c.newPage();
        await host.goto(hostWith('o', frames.map(([name, unit, block]) => ({ name, src: hkoUrl(unit, block) }))));
        const fl = Object.fromEntries(frames.map(([n]) => [n, host.frameLocator(`iframe[name="${n}"]`)]));
        await fl.o0.locator('#auth-dialog').waitFor();
        const t0 = Date.now();
        await login(fl.o0, me.username);
        await Promise.all(frames.map(([n]) => fl[n].locator('#content-renderer[data-modus]').waitFor({ timeout: 10000 })));
        const took = Date.now() - t0;
        console.log(`    10 iframes ready ${took} ms after the login click`);
        assert.ok(took < 10000, `took ${took} ms`);
        for (const [n] of frames) assert.notEqual(await fl[n].locator('#content-renderer').getAttribute('data-modus'), 'fehler', n);
        assert.equal(await fl.o9.locator('#content-renderer').getAttribute('data-modus'), 'lesen');

        for (const [n, , block, type] of frames) {
            const f = fl[n];
            if (type === 'items') { await clickFocus(f.locator('.hko-items .ql-editor').first()); await host.keyboard.type(`Last ${block}`); }
            if (type === 'raster') await f.locator('textarea.hko-raster-zelle').first().fill(`Last ${block}`);
            if (type === 'text') await typeText(host, f, `Last ${block}`);
            if (type === 'selbst') await f.locator('.hko-krit[data-krit="argumentation"] label', { hasText: 'Stufe 1' }).click();
        }
        for (const [n, , , type] of frames) if (type) await saved(fl[n]);
        for (const [, unit, block, type] of frames) {
            const d = await answerDoc(me.uid, block, unit);
            if (!type) { assert.equal(d, null, block); continue; }
            assert.equal(d?.type, type, block);
            if (type !== 'selbst') assert.match(JSON.stringify(d.value), new RegExp(`Last ${block}`), block);
        }
        await until('rueckblick shows the entscheid text', async () => (await wertIn(fl.o8, 'entscheid').innerText()) === 'Last entscheid', 5000);
        await c.close();
    });

    // ---- more steps go here ----

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

if (!failed) console.log(`\ne2e-hko-student: ${results.length} steps passed, no request left the emulators (except the two CDNs).`);
process.exit(failed ? 1 : 0);
