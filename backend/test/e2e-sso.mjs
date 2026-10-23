// Browser test of the single sign-on from the Lernportal (CONTRACT.md, «Single sign-on»)
// against the EMULATORS: student page -> popup on the (stand-in) portal origin -> callable
// boxSsoToken -> postMessage -> signInWithCustomToken -> a draft is written under the rules.
// Run: npm run test:e2e:sso   (= emulators:exec --only auth,firestore,functions)
//
// The portal page is a stand-in served here on a second origin (the real one is
// CoSch-sandbox/apps/lms-firebase/src/pages/lmsbox-sso.astro and cannot run in the emulators);
// it speaks the same protocol. Needs internet for the Firebase SDK and Quill CDNs only.
// Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { firebaseConfig } from '../../js/config.js';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:sso`);
        process.exit(1);
    }
}

await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed
const enc = encodeURIComponent;
const A1 = '0.1 Testauftrag Müller';
const A1_SUB = 'A. Grundsätze der Übung';
const draftId = (uid, a, s) => `${uid}__${enc(a)}__${enc(s)}`;
for (const d of (await box.collection('drafts').get()).docs) await d.ref.delete();

// ---- the stand-in portal page ----------------------------------------------------------------

const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';
const portalPage = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Portal (Stand-in)</title><body>
<p id="sso-wait">Prüfe …</p>
<form id="sso-form" hidden><input id="sso-user"><input id="sso-pass" type="password"><button id="sso-submit">Anmelden</button></form>
<p id="sso-done" hidden>Angemeldet.</p><p id="sso-problem-text" hidden></p>
<script type="module">
import { initializeApp } from '${SDK}/firebase-app.js';
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword } from '${SDK}/firebase-auth.js';
import { getFunctions, connectFunctionsEmulator, httpsCallable } from '${SDK}/firebase-functions.js';
const app = initializeApp(${JSON.stringify(firebaseConfig)});
const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9190', { disableWarnings: true });
const functions = getFunctions(app, 'europe-west6'); connectFunctionsEmulator(functions, '127.0.0.1', 5101);
const $ = (id) => document.getElementById(id);
const show = (id) => { for (const s of ['sso-wait', 'sso-form', 'sso-done', 'sso-problem-text']) $(s).hidden = s !== id; };
const params = new URLSearchParams(location.search);
const target = params.get('origin'), state = params.get('state');
const answer = (p) => window.opener.postMessage({ type: 'lmsbox-sso', state, ...p }, target);
let started = false;
onAuthStateChanged(auth, async (user) => {
    if (!user) { if (!started) show('sso-form'); return; }
    if (started) return; started = true; show('sso-wait');
    try {
        const { data } = await httpsCallable(functions, 'boxSsoToken')({});
        answer({ token: data.token }); show('sso-done'); setTimeout(() => window.close(), 300);
    } catch (e) {
        answer({ error: e.code === 'functions/permission-denied' ? 'forbidden' : 'unavailable' });
        $('sso-problem-text').textContent = e.code; show('sso-problem-text');
    }
});
$('sso-form').addEventListener('submit', (e) => { e.preventDefault(); signInWithEmailAndPassword(auth, $('sso-user').value + '@lernende.bbw.ch', $('sso-pass').value); });
window.__ready = true;
</script></body></html>`;

// ---- servers: app/ (the student page) and the stand-in portal, on two ports ----------------------

const APP = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
let hostPage = '';
const appHandler = async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/__host.html') { res.writeHead(200, { 'Content-Type': MIME['.html'] }); res.end(hostPage); return; }
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !/^\/(index\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
};
const portalHandler = (req, res) => {
    if (new URL(req.url, 'http://x').pathname !== '/lmsbox-sso') { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
    res.end(portalPage);
};
const listen = (handler) => new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve(s));
});
const appServer = await listen(appHandler);
const portalServer = await listen(portalHandler);
const PORT = appServer.address().port;
const PORTAL = `http://127.0.0.1:${portalServer.address().port}`;
const pageUrl = `http://127.0.0.1:${PORT}/index.html?assignmentId=${enc(A1)}&subId=${enc(A1_SUB)}&portal=${enc(PORTAL)}`;
hostPage = `<!doctype html><html lang="de"><meta charset="utf-8"><title>Host</title><body>
<iframe name="f0" src="${pageUrl}" width="100%" height="520"></iframe></body></html>`;

// ---- helpers (same shape as e2e-student.mjs) ------------------------------------------------------

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
async function until(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const value = await fn();
        if (value) return value;
        if (Date.now() > end) throw new Error(`Timeout: ${what}`);
        await new Promise((r) => setTimeout(r, 150));
    }
}
const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}
const editor = (scope) => scope.locator('.ql-editor').first();
const draft = async (uid) => (await box.doc(`drafts/${draftId(uid, A1, A1_SUB)}`).get()).data() ?? null;

// Chrome with third-party storage partitioning ON, as a real browser has it (see e2e-student.mjs).
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

// ---- the run ---------------------------------------------------------------------------------------

const TEXT = 'Annas Antwort nach dem Einmal-Login 4711';
let failed = false;
const browser = await launchChrome();
try {
    const ctx = await newContext(browser);

    await step('first time: the window asks for the login, then closes; the iframe is signed in as the same account', async () => {
        const host = await ctx.newPage();
        await host.goto(`http://localhost:${PORT}/__host.html`);
        const f = host.frameLocator('iframe[name="f0"]');
        await f.locator('#guest-sso').waitFor();

        const popupPromise = ctx.waitForEvent('page');
        await f.locator('#guest-sso').click();
        const popup = await popupPromise;
        await popup.waitForFunction(() => window.__ready === true);

        // A message from anybody else (not the window we opened, wrong state) is ignored.
        await host.evaluate(() => document.querySelector('iframe').contentWindow.postMessage({ type: 'lmsbox-sso', state: 'x', token: 'y' }, '*'));
        await popup.locator('#sso-form').waitFor({ state: 'visible' });
        assert.equal(await f.locator('#auth-user').count(), 0, 'a forged message must not sign anybody in');

        await popup.locator('#sso-user').fill('anna.beispiel');
        await popup.locator('#sso-pass').fill(PASSWORD);
        const closed = popup.waitForEvent('close');
        await popup.locator('#sso-submit').click();
        await closed;

        await f.locator('#auth-user').waitFor();
        assert.match(await f.locator('#auth-user').innerText(), /Anna Beispiel/);
    });

    await step('a draft written in the single-sign-on session passes the rules and is stored under the roster uid', async () => {
        const host = ctx.pages().find((p) => p.url().includes('__host.html'));
        const f = host.frameLocator('iframe[name="f0"]');
        await editor(f).click();
        await host.keyboard.type(TEXT);
        await f.locator('#save-status[data-state="cloud"]').waitFor();
        const d = await until('draft', () => draft('seed-anna'));
        assert.match(d.answers[0].answer, /Einmal-Login/);
        assert.equal(d.uid, 'seed-anna');
    });

    await step('the account has its address on the client (kurztest and mindmap look at it)', async () => {
        const host = ctx.pages().find((p) => p.url().includes('__host.html'));
        const frame = host.frames().find((fr) => fr.url().startsWith(`http://127.0.0.1:${PORT}/index.html`));
        const stored = await frame.evaluate(() => new Promise((resolve, reject) => {
            const open = indexedDB.open('firebaseLocalStorageDb');
            open.onerror = () => reject(open.error);
            open.onsuccess = () => {
                const all = open.result.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
                all.onsuccess = () => resolve(all.result.map((r) => r.value).find((v) => v?.uid));
                all.onerror = () => reject(all.error);
            };
        }));
        assert.equal(stored.email, 'anna.beispiel@lernende.bbw.ch');
    });

    await step('second time: the portal already knows the student; the window closes by itself, no password', async () => {
        const host = ctx.pages().find((p) => p.url().includes('__host.html'));
        const f = host.frameLocator('iframe[name="f0"]');
        await f.locator('#auth-logout').click();
        await f.locator('#guest-sso').waitFor();

        const popupPromise = ctx.waitForEvent('page');
        await f.locator('#guest-sso').click();
        const popup = await popupPromise;
        await popup.waitForEvent('close');           // never showed the form: it was signed in already
        await f.locator('#auth-user').waitFor();
        assert.match(await f.locator('#auth-user').innerText(), /Anna Beispiel/);
    });

    await step('a teacher account is turned away: the page stays a guest, the dialog says so', async () => {
        const c2 = await newContext(browser);
        const page = await c2.newPage();
        await page.goto(pageUrl);
        await page.locator('#guest-sso').waitFor();
        const popupPromise = c2.waitForEvent('page');
        await page.locator('#guest-sso').click();
        const popup = await popupPromise;
        await popup.waitForFunction(() => window.__ready === true);
        await popup.locator('#sso-form').waitFor({ state: 'visible' });
        await popup.locator('#sso-user').fill('tina.test');       // on no roster: no student
        await popup.locator('#sso-pass').fill(PASSWORD);
        await popup.locator('#sso-submit').click();
        await popup.locator('#sso-problem-text').waitFor({ state: 'visible' });
        await page.locator('#auth-dialog').waitFor();
        assert.match(await page.locator('#auth-status').innerText(), /Lernenden-Konto/);
        assert.equal(await page.locator('#auth-user').count(), 0);
        await c2.close();
    });

    await step('a blocked window is explained, the password form stays available', async () => {
        const c3 = await newContext(browser);
        const page = await c3.newPage();
        await page.addInitScript(() => { window.open = () => null; });
        await page.goto(pageUrl);
        await page.locator('#guest-sso').click();
        await page.locator('#auth-dialog').waitFor();
        assert.match(await page.locator('#auth-status').innerText(), /blockiert/);
        await page.locator('#auth-username').waitFor();
        await c3.close();
    });

    assert.deepEqual(blocked, [], 'the pages requested hosts other than the emulators and the CDNs');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    appServer.close();
    portalServer.close();
}

if (!failed) console.log(`\ne2e-sso: ${results.length} steps passed.`);
process.exit(failed ? 1 : 0);
