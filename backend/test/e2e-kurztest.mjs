// Browser test of the self-test bridge (kurztest.html) against the EMULATORS.
// Run: npm run test:e2e:kurztest
//   (= emulators:exec --only auth,firestore; this file seeds, serves app/ itself and drives the installed Chrome)
//
// A host page on http://localhost:<port> plays lehrmittel.aburossi.ch (publish.js); the bridge
// comes from http://127.0.0.1:<port>, another origin, as in production. A second server on
// another port plays a foreign website. Fictional people only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:kurztest`);
        process.exit(1);
    }
}

await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
for (const d of (await box.collection('quizProgress').get()).docs) await d.ref.delete();

const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed
const enc = encodeURIComponent;
const UNIT = 'ABUlehrmittel/1 Lernen/1.1 Lernen lernen + üben';
const A1 = '0.1 Testauftrag Müller';
const A1_SUB = 'A. Grundsätze der Übung';

// ---- static server for app/ plus the test pages ---------------------------------------------

const APP = normalize(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const pages = {};
const handler = async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pages[path]) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' });
        res.end(pages[path]());
        return;
    }
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !/^\/(index\.html|kurztest\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/.test(path)) {
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
servers.push(await listen('127.0.0.1', 0));
const FOREIGN_PORT = servers.at(-1).address().port;

const HOST_ORIGIN = `http://localhost:${PORT}`;
const BRIDGE_ORIGIN = `http://127.0.0.1:${PORT}`;
const bridgeUrl = (parent) => `${BRIDGE_ORIGIN}/kurztest.html?parent=${enc(parent)}`;

// Plays publish.js: the same checks (origin AND source), answers to the bridge origin only.
// Collects what the bridge says in window.__msgs.
pages['/__host.html'] = () => `<!doctype html><html lang="de"><meta charset="utf-8"><title>Host (wie Publish)</title><body>
<h1>Einheit</h1>
${'' /* an assignment of the LMS Box on the same page, to show the shared login */}
<iframe name="task" src="${BRIDGE_ORIGIN}/index.html?assignmentId=${enc(A1)}&subId=${enc(A1_SUB)}" width="100%" height="420"></iframe>
<iframe name="bridge" id="bridge" src="${bridgeUrl(HOST_ORIGIN)}" width="100%" height="40" style="border:0"></iframe>
<iframe name="sib" src="${HOST_ORIGIN}/__sibling.html" width="10" height="10"></iframe>
<script>
  window.__msgs = [];
  const bridge = document.getElementById('bridge');
  window.__send = (m) => bridge.contentWindow.postMessage(m, ${JSON.stringify(BRIDGE_ORIGIN)});
  window.addEventListener('message', (e) => {
    if (e.origin !== ${JSON.stringify(BRIDGE_ORIGIN)} || e.source !== bridge.contentWindow) return;
    if (!e.data || typeof e.data.type !== 'string' || !e.data.type.startsWith('kurztest-')) return;
    window.__msgs.push(e.data);
    if (e.data.type === 'kurztest-ready') window.__send({ type: 'kurztest-load', unit: ${JSON.stringify(UNIT)} });
  });
</script></body></html>`;

// Same origin as the host page, but not the bridge's parent: its messages must be ignored.
pages['/__sibling.html'] = () => `<!doctype html><meta charset="utf-8"><script>
  window.__try = () => {
    const b = parent.frames['bridge'];
    b.postMessage({ type: 'kurztest-load', unit: 'Geschwister' }, '*');
    b.postMessage({ type: 'kurztest-save', unit: 'Geschwister', record: { last: { known: 1, total: 1, date: '2026-10-16T10:00:00.000Z' }, hard: [] } }, '*');
    b.postMessage({ type: 'kurztest-save', unit: ${JSON.stringify(UNIT)}, record: { last: { known: 0, total: 9, date: '2099-01-01T00:00:00.000Z' }, hard: ['Geschwister'] } }, '*');
  };
</script>`;

// A foreign website: embeds the bridge claiming the real host as parent, and once with itself.
pages['/__foreign.html'] = () => `<!doctype html><meta charset="utf-8"><body>
<iframe id="claim" src="${bridgeUrl(HOST_ORIGIN)}"></iframe>
<iframe id="evil" src="${bridgeUrl('https://evil.example')}"></iframe>
<script>
  window.__got = [];
  window.addEventListener('message', (e) => { if (e.data && String(e.data.type).startsWith('kurztest-')) window.__got.push(e.data); });
  window.__try = () => {
    for (const id of ['claim', 'evil']) {
      const w = document.getElementById(id).contentWindow;
      w.postMessage({ type: 'kurztest-load', unit: ${JSON.stringify(UNIT)} }, '*');
      w.postMessage({ type: 'kurztest-save', unit: ${JSON.stringify(UNIT)}, record: { last: { known: 0, total: 9, date: '2099-01-01T00:00:00.000Z' }, hard: ['Fremd'] } }, '*');
    }
  };
</script></body>`;

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
const msgs = (page) => page.evaluate(() => window.__msgs);
/** Waits for the next bridge message of `type` after the first `after` messages; returns it. */
async function next(page, type, after = 0) {
    const handle = await page.waitForFunction(([t, n]) => window.__msgs.slice(n).find((m) => m.type === t),
        [type, after], { timeout: 20000, polling: 100 });
    return handle.jsonValue();
}
const quizDoc = async (uid, unit = UNIT) => (await box.doc(`quizProgress/${uid}__${enc(unit)}`).get());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

// Playwright switches third-party storage partitioning off; a real browser has it on, and the
// shared login of the iframes on one host site depends on it. As in e2e-student.mjs.
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

// ---- the run -----------------------------------------------------------------------------

const RECORD = { last: { known: 5, total: 7, date: '2026-10-16T14:03:21.512Z' }, hard: ['Duales System', 'üK'] };
let failed = false;
const browser = await launchChrome();
try {
    const ctx = await newContext(browser);
    const page = await ctx.newPage();
    const bridge = page.frameLocator('#bridge');

    await step('(a) guest: ready, then state without record; the line offers a login', async () => {
        await page.goto(`${HOST_ORIGIN}/__host.html`);
        const ready = await next(page, 'kurztest-ready');
        assert.deepEqual(ready, { type: 'kurztest-ready', signedIn: false, acct: null });
        const state = await next(page, 'kurztest-state');
        assert.deepEqual(state, { type: 'kurztest-state', signedIn: false, acct: null, unit: UNIT, record: null });
        await bridge.locator('#kurztest-line[data-state="guest"] a', { hasText: 'Anmelden' }).waitFor();
    });

    await step('(b) guest: a save is refused by the bridge, nothing is written', async () => {
        const n = (await msgs(page)).length;
        await page.evaluate(([u, r]) => window.__send({ type: 'kurztest-save', unit: u, record: r }), [UNIT, RECORD]);
        const saved = await next(page, 'kurztest-saved', n);
        assert.deepEqual(saved, { type: 'kurztest-saved', unit: UNIT, ok: false, code: 'signed-out' });
        assert.equal((await quizDoc('seed-anna')).exists, false);
    });

    await step('(c) login in the assignment iframe: the bridge follows without reload, acct is not the uid', async () => {
        const n = (await msgs(page)).length;
        const task = page.frameLocator('iframe[name="task"]');
        await task.locator('#guest-login').click();
        await login(task, 'anna.beispiel');
        const state = await next(page, 'kurztest-state', n);
        assert.equal(state.signedIn, true);
        assert.match(state.acct, /^[0-9a-f]{12}$/);
        assert.ok(!JSON.stringify(state).includes('seed-anna'), 'the uid left the bridge');
        assert.equal(state.record, null);
        await bridge.locator('#kurztest-line[data-state="on"]', { hasText: 'anna.beispiel' }).waitFor();
    });

    await step('(d) save: one document per student and unit, no name, server time', async () => {
        const n = (await msgs(page)).length;
        await page.evaluate(([u, r]) => window.__send({ type: 'kurztest-save', unit: u, record: r }), [UNIT, RECORD]);
        assert.deepEqual(await next(page, 'kurztest-saved', n), { type: 'kurztest-saved', unit: UNIT, ok: true });
        const snap = await quizDoc('seed-anna');
        assert.ok(snap.exists);
        const { updatedAt, ...rest } = snap.data();
        assert.deepEqual(rest, { uid: 'seed-anna', unit: UNIT, ...RECORD });
        assert.ok(updatedAt.toMillis() > Date.now() - 60000);
    });

    await step('(e) a malformed record is refused by the bridge with a code', async () => {
        const n = (await msgs(page)).length;
        await page.evaluate((u) => window.__send({ type: 'kurztest-save', unit: u, record: { last: { known: 9, total: 7, date: 'gestern' }, hard: [] } }), UNIT);
        assert.deepEqual(await next(page, 'kurztest-saved', n), { type: 'kurztest-saved', unit: UNIT, ok: false, code: 'invalid' });
    });

    await step('(f) reload: the saved record comes back', async () => {
        await page.reload();
        const state = await next(page, 'kurztest-state');
        assert.equal(state.signedIn, true);
        assert.deepEqual(state.record, RECORD);
    });

    await step('(g) a sibling frame of the same origin is not the parent: ignored', async () => {
        const n = (await msgs(page)).length;
        await page.frame({ name: 'sib' }).evaluate(() => window.__try());
        await sleep(1500);
        assert.deepEqual((await msgs(page)).slice(n), []);
        assert.equal((await quizDoc('seed-anna', 'Geschwister')).exists, false);
        assert.deepEqual((await quizDoc('seed-anna')).get('hard'), RECORD.hard);
    });

    await step('(h) a foreign website gets no answer and cannot write, with or without a forged ?parent=', async () => {
        const foreign = await ctx.newPage();
        await foreign.goto(`http://127.0.0.1:${FOREIGN_PORT}/__foreign.html`);
        await foreign.frameLocator('#evil').locator('#kurztest-line[data-state="off"]').waitFor();
        await sleep(1500);      // the claiming frame has decided its session by now
        await foreign.evaluate(() => window.__try());
        await sleep(1500);
        assert.deepEqual(await foreign.evaluate(() => window.__got), []);
        assert.deepEqual((await quizDoc('seed-anna')).get('hard'), RECORD.hard);
        await foreign.close();
    });

    await step('(i) logout in the bridge: state signed out', async () => {
        const n = (await msgs(page)).length;
        await bridge.locator('#kurztest-line a', { hasText: 'Abmelden' }).click();
        await page.waitForFunction((k) => window.__msgs.slice(k).some((m) => m.signedIn === false), n, { timeout: 20000, polling: 100 });
        await bridge.locator('#kurztest-line[data-state="guest"]').waitFor();
    });

    await step('(j) login in the bridge itself: the dialog opens there, then the record loads', async () => {
        const n = (await msgs(page)).length;
        await bridge.locator('#kurztest-line a', { hasText: 'Anmelden' }).click();
        await bridge.locator('#auth-dialog').waitFor();
        await login(bridge, 'anna.beispiel');
        await bridge.locator('#auth-dialog').waitFor({ state: 'detached' });
        await page.waitForFunction((k) => window.__msgs.slice(k).some((m) => m.type === 'kurztest-state' && m.signedIn && m.record), n, { timeout: 20000, polling: 100 });
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

if (!failed) console.log(`\ne2e-kurztest: ${results.length} steps passed, no request left the emulators (except the two CDNs).`);
process.exit(failed ? 1 : 0);
