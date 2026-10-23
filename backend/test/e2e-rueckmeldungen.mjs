// Browser test of «Meine Rückmeldungen» (CONTRACT.md, «Formative feedback: attempts, trail,
// overview»): two feedbacks per question, the trail, the overview page in the side panel of
// publish.js, «Zur Frage», the live update and the counts in the Lernansicht bar.
// Run: npm run test:e2e:rueckmeldungen
//   (= emulators:exec --only auth,firestore,functions; this file seeds, serves app/ as
//      /lms_box/ on 127.0.0.1 and a stand-in Publish page with the real vault/publish.js on
//      localhost — another origin, like lehrmittel.aburossi.ch — and drives the installed Chrome)
//
// The formativ model is a local fake on FORMATIV_URL (functions/.env.local): criterion k2 is
// always met, k1 only when the answer contains «VERBESSERT». Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { publicCopy } from '../scripts/public-assignment.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:rueckmeldungen`);
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
const VAULT = normalize(join(APP, '..', 'vault'));

await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';
const enc = encodeURIComponent;

// ---- fixtures ----------------------------------------------------------------------------

const A = '0.4 E2E Rückmeldungen';
const SUB_A = 'A. Erster Teil';
const SUB_B = 'B. Zweiter Teil';
const SUB_C = 'C. Ohne Rückmeldung';
const RUBRIK = { rubrik_version: 'e2e-1', rubrik: [
    { id: 'k1', label: 'Begründung', erwartung: 'Eine Begründung.' },
    { id: 'k2', label: 'Beispiel', erwartung: 'Ein Beispiel.' },
] };
const ASSIGNMENT = {
    assignmentId: A,
    assignmentTitle: 'Rückmeldungen (E2E)',
    subAssignments: {
        [SUB_A]: { type: 'quill', questions: [{ id: 'q1', text: 'Warum fahren Sie **Velo**? Nennen Sie ein Beispiel.', formativ: RUBRIK }] },
        [SUB_B]: { type: 'quill', questions: [
            { id: 'q1', text: 'Was spricht für den Zug? Nennen Sie ein Beispiel.', formativ: RUBRIK },
            { id: 'q2', text: 'Was spricht dagegen?' },
        ] },
        [SUB_C]: { type: 'quill', questions: [{ id: 'q1', text: 'Notizen ohne Rückmeldung.' }] },
    },
};
await box.doc(`assignments/${enc(A)}`).set(ASSIGNMENT);
await box.doc(`publicAssignments/${enc(A)}`).set(publicCopy(ASSIGNMENT));
for (const c of ['drafts', 'formativUsage']) for (const d of (await box.collection(c).get()).docs) await d.ref.delete();

// ---- fake formativ model -------------------------------------------------------------------

const HINT_K1 = 'E2E-Hinweis zur Begründung 5151';
const envLocal = readFileSync(join(HERE, '..', 'functions', '.env.local'), 'utf8');
const modelUrl = new URL(/^FORMATIV_URL=(.+)$/m.exec(envLocal)[1].trim());
assert.ok(['127.0.0.1', 'localhost'].includes(modelUrl.hostname), 'functions/.env.local must point FORMATIV_URL at this machine');
const modelCalls = [];
const model = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    modelCalls.push(body);
    const better = /VERBESSERT/.test(body.antwort || '');
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
        zustand: 'vollstaendig',
        kriterien: [
            { id: 'k1', label: 'Begründung', status: better ? 'erfuellt' : 'teilweise', hinweis: better ? 'Gut begründet.' : HINT_K1, beleg: null, grund: null },
            { id: 'k2', label: 'Beispiel', status: 'erfuellt', hinweis: 'Beispiel passt.', beleg: null, grund: null },
        ],
        meta: { request_id: `e2e-${modelCalls.length}`, prompt_version: 'e2e-v1' },
    }));
});
await new Promise((resolve, reject) => { model.once('error', reject); model.listen(Number(modelUrl.port), '127.0.0.1', resolve); });

// ---- servers: app/ as /lms_box/ on 127.0.0.1, the stand-in Publish page on localhost ---------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/lms_box\/(index\.html|rueckmeldungen\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/;
const appServer = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path.replace(/^\/lms_box\//, '')));
    if (!SERVED.test(path) || !file.startsWith(APP + sep)) { res.writeHead(404); res.end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
const LMS = `http://127.0.0.1:${appServer.address().port}`;

const frame = (sub) => `<iframe src="${LMS}/lms_box/index.html?assignmentId=${enc(A)}&subId=${enc(sub)}" width="100%" height="520" frameborder="0"></iframe>`;
const callout = (inner) => `<div class="el-div"><div class="callout" data-callout="question"><div class="callout-title"><div class="callout-title-inner">Auftrag</div></div><div class="callout-content">${inner}</div></div></div>`;
const PAGE_PATH = '/Test/E2E Rueckmeldungen';
const HOST_HTML = `<!doctype html><meta charset="utf-8"><title>Publish-Ersatz</title>
<body style="font-family:sans-serif;max-width:860px;margin:20px auto;padding:0 16px">
<div class="markdown-preview-view"><div class="markdown-preview-sizer">
<div class="el-h1"><h1>E2E Rückmeldungen</h1></div>
<div class="el-p"><p>Lernziele: fiktiv.</p></div>
<div class="el-h3"><h3>1. Velo</h3></div>
<div class="el-p"><p>Worum es geht: Velo.</p></div>
${callout(frame(SUB_A))}
<div class="el-h3"><h3>2. Zug</h3></div>
<div class="el-p"><p>Worum es geht: Zug.</p></div>
${callout(frame(SUB_B))}
<div class="el-h3"><h3>3. Notizen</h3></div>
${callout(frame(SUB_C))}
</div></div><script src="/publish.js"></script></body>`;
const publishJs = (await readFile(join(VAULT, 'publish.js'), 'utf8')).replaceAll('"https://allgemeinbildung.github.io"', JSON.stringify(LMS));
const hostServer = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (path === '/publish.js') { res.writeHead(200, { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-store' }); res.end(publishJs); return; }
    if (path.replaceAll('+', ' ') === PAGE_PATH) { res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-store' }); res.end(HOST_HTML); return; }
    res.writeHead(404); res.end();
});
await new Promise((resolve) => hostServer.listen(0, 'localhost', resolve));
const HOST_URL = `http://localhost:${hostServer.address().port}${PAGE_PATH.replaceAll(' ', '+')}`;

// ---- helpers ---------------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const blocked = [];
const browserLog = [];

async function newContext(browser, label) {
    const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
    context.setDefaultTimeout(25000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!/^https?:$/.test(url.protocol) || ALLOWED_HOSTS.has(url.hostname)) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    // Every message the host page receives, as JSON: proves that no feedback text reaches it.
    await context.addInitScript(() => {
        if (location.hostname !== 'localhost') return;
        window.__hostMessages = [];
        window.addEventListener('message', (e) => { try { window.__hostMessages.push(JSON.stringify(e.data)); } catch { /* not JSON */ } });
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`${label} pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`${label} console: ${m.text()}`); });
    });
    return context;
}

const lmsFrame = (page, sub) => page.frameLocator(`iframe[src*="${enc(sub).replace(/'/g, '%27')}"]`);
const overview = (page) => page.frameLocator('.lm-rm-panel iframe');
const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}
async function typeInto(f, text) {
    await f.locator('.ql-editor').first().click();
    await f.locator('.ql-editor').first().press('Control+End');
    await f.locator('.ql-editor').first().pressSequentially(text);
}

const ANSWER_1 = 'Ich fahre Velo, weil es schnell ist und ich dabei draussen bin. Ein Beispiel ist der Weg zur Schule am Morgen.';
const ANSWER_2 = ' VERBESSERT: Ausserdem spare ich Geld, weil kein Billett nötig ist.';
const ANSWER_B = 'Der Zug ist bequem, weil ich lesen kann. Ein Beispiel ist die Fahrt nach Zürich, auf der ich meine Aufgaben mache.';

// ---- the run ---------------------------------------------------------------------------------

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const ctx = await newContext(browser, 'anna');
    const page = await ctx.newPage();

    await step('(a) host page: Lernansicht in steps, the button «Rückmeldungen», only the first box loaded', async () => {
        await page.goto(HOST_URL);
        await page.locator('.lm-lv-bar').waitFor();
        await page.locator('.lm-rm-toggle').waitFor();
        assert.equal(await page.locator('.lm-rm-toggle').innerText(), '💬 Rückmeldungen');
        // «Einstieg»: no box loaded yet, the button is there all the same
        await page.waitForFunction(() => /Einstieg/.test(document.querySelector('.lm-lv-bar')?.innerText || ''));
        assert.equal(await page.locator('iframe[src*="lms_box"]').count(), 0);
        await page.locator('.lm-lv-bar button[aria-label="Weiter"]').click();
        await page.waitForFunction(() => /1 \/ 3/.test(document.querySelector('.lm-lv-bar')?.innerText || ''));
        assert.equal(await page.locator(`iframe[data-lv-src*="${enc(SUB_B)}"]`).count(), 1, 'box B waits until its step is opened');
    });

    const fa = lmsFrame(page, SUB_A);
    await step('(b) sign in inside the box, first feedback: one met, one partly; «Zweite Rückmeldung» offered', async () => {
        await fa.locator('#guest-login').click();
        await fa.locator('#auth-username').fill('anna.beispiel');
        await fa.locator('#auth-password').fill(PASSWORD);
        await fa.locator('#auth-login-btn').click();
        await fa.locator('#auth-user').waitFor();
        await fa.locator('.formativ-button').waitFor();
        assert.equal(await fa.locator('.formativ-button').innerText(), 'Rückmeldung holen (1 von 2)');
        await typeInto(fa, ANSWER_1);
        await fa.locator('.formativ-button').click();
        await fa.locator('.formativ-panel', { hasText: HINT_K1 }).waitFor();
        assert.equal(await fa.locator('.formativ-button').innerText(), 'Zweite Rückmeldung holen (2 von 2)');
        assert.equal(await fa.locator('.formativ-panel .formativ-mark-direkt').count(), 1);
        assert.equal(await fa.locator('.formativ-panel .formativ-mark-offen').count(), 1);
        assert.equal(modelCalls.length, 1);
        assert.ok(!JSON.stringify(modelCalls[0]).includes('Anna') && !JSON.stringify(modelCalls[0]).includes('seed-anna'));
        // the Lernansicht bar shows the counts of this step
        await page.waitForFunction(() => document.querySelector('.lm-lv-fb')?.innerText.includes('○'));
        assert.equal((await page.locator('.lm-lv-fb').innerText()).replace(/\s+/g, ' '), '● 1 ○ 1');
    });

    await step('(c) revised text, second feedback: the change per criterion, the first folded, trail «verbessert»', async () => {
        await typeInto(fa, ANSWER_2);
        await fa.locator('.formativ-button').click();
        await fa.locator('.formativ-panel .formativ-change').waitFor();
        assert.equal(await fa.locator('.formativ-button').innerText(), 'Beide Rückmeldungen erhalten');
        assert.equal(await fa.locator('.formativ-button').isDisabled(), true);
        assert.match(await fa.locator('.formativ-panel .formativ-change').innerText(), /◐ teilweise\s*→\s*✓ erfüllt/);
        assert.match(await fa.locator('.formativ-panel details.formativ-earlier summary').innerText(), /^1\. Rückmeldung/);
        assert.equal(await fa.locator('.formativ-panel .formativ-head .formativ-mark-verbessert').count(), 1);
        assert.equal(modelCalls.length, 2);
        await page.waitForFunction(() => document.querySelector('.lm-lv-fb')?.innerText.includes('●↑'));
        assert.equal((await page.locator('.lm-lv-fb').innerText()).replace(/\s+/g, ' '), '● 1 ●↑ 1');
    });

    await step('(d) overview: every box of the page in page order, also the one not loaded; no box without formativ', async () => {
        await page.locator('.lm-rm-toggle').click();
        const ov = overview(page);
        await ov.locator('.rm-summary').waitFor();
        const text = (await ov.locator('#rm').innerText()).replace(/\s+/g, ' ');
        assert.match(text, /1 direkt erfüllt/);
        assert.match(text, /1 verbessert/);
        assert.match(text, /1 Frage noch ohne Rückmeldung/);
        assert.doesNotMatch(text, /\d+ (Punkte|von \d+ Punkten)/, 'no score anywhere');
        assert.deepEqual(await ov.locator('.rm-section > h3').allInnerTexts(), ['1. Velo', '2. Zug']);
        assert.equal(await ov.locator('.rm-q').count(), 2, 'only the questions with formativ');
        assert.match(await ov.locator('.rm-q').first().innerText(), /Warum fahren Sie Velo\?/);
        assert.doesNotMatch(await ov.locator('.rm-q').first().innerText(), /\*\*/, 'markdown stripped');
        assert.match(await ov.locator('.rm-q').first().locator('.formativ-head').innerText(), /^2\. Rückmeldung/);
        assert.equal(await ov.locator('.rm-q').first().locator('details.formativ-earlier').count(), 1);
        assert.match(await ov.locator('.rm-q').nth(1).innerText(), /Noch keine Rückmeldung/);
        // RM_SCREENSHOTS=<folder>: pictures of the box and the overview, for a look by eye
        if (process.env.RM_SCREENSHOTS) {
            await page.screenshot({ path: join(process.env.RM_SCREENSHOTS, 'uebersicht.png') });
            await page.keyboard.press('Escape');
            await page.locator(`iframe[src*="${enc(SUB_A)}"]`).screenshot({ path: join(process.env.RM_SCREENSHOTS, 'box.png') });
            await page.locator('.lm-lv-bar').screenshot({ path: join(process.env.RM_SCREENSHOTS, 'leiste.png') });
            await page.locator('.lm-rm-toggle').click();
            await ov.locator('.rm-summary').waitFor();
        }
    });

    await step('(e) «Zur Frage» opens step 2, loads box B and scrolls to it', async () => {
        await overview(page).locator('.rm-q').nth(1).locator('.rm-goto').click();
        await page.waitForFunction(() => document.querySelector('.lm-rm-panel')?.hidden === true);
        await page.waitForFunction(() => /2 \/ 3/.test(document.querySelector('.lm-lv-bar')?.innerText || ''));
        await page.locator(`iframe[src*="${enc(SUB_B)}"]`).waitFor();
    });

    await step('(f) feedback in box B: the open overview updates by itself (BroadcastChannel)', async () => {
        const fb = lmsFrame(page, SUB_B);
        await fb.locator('.formativ-button').waitFor();
        await typeInto(fb, ANSWER_B);
        await fb.locator('.formativ-button').click();
        await fb.locator('.formativ-panel', { hasText: HINT_K1 }).waitFor();
        await page.locator('.lm-rm-toggle').click();
        const ov = overview(page);
        await ov.locator('.rm-q').nth(1).locator('.formativ-panel').waitFor();
        const text = (await ov.locator('.rm-summary').innerText()).replace(/\s+/g, ' ');
        assert.match(text, /2 direkt erfüllt/);
        assert.doesNotMatch(text, /ohne Rückmeldung/);
        await page.keyboard.press('Escape');
    });

    await step('(g) the host page got ids and numbers only, never a feedback text', async () => {
        const msgs = await page.evaluate(() => window.__hostMessages);
        assert.ok(msgs.some((m) => m.includes('"lmsbox-progress"') && m.includes('"formativ"')), 'progress messages carry the counts');
        assert.ok(msgs.some((m) => m.includes('"lmsbox-rm-goto"')));
        for (const m of msgs) assert.ok(!m.includes(HINT_K1) && !m.includes('Gut begründet') && !m.includes('VERBESSERT'), m.slice(0, 200));
        assert.ok(!(await page.locator('body').innerText()).includes(HINT_K1));
    });

    await step('(h) a guest sees the sign-in line in the overview, not an error', async () => {
        const guest = await newContext(browser, 'guest');
        const gp = await guest.newPage();
        await gp.goto(HOST_URL);
        await gp.locator('.lm-rm-toggle').click();
        await overview(gp).locator('.rm-state', { hasText: 'Melde dich an' }).waitFor();
        await guest.close();
    });

    assert.deepEqual(blocked, [], 'a page requested a host other than the emulators, the fakes and the two CDNs');
    const errors = browserLog.filter((l) => !/favicon|Failed to load resource: the server responded with a status of 404/.test(l));
    assert.deepEqual(errors, [], 'no page errors');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    appServer.close();
    hostServer.close();
    model.close();
}

if (!failed) console.log(`\ne2e-rueckmeldungen: ${results.length} steps passed.`);
process.exit(failed ? 1 : 0);
