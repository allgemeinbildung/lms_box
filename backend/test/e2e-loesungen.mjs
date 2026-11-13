// Browser test of the released model solutions (CONTRACT.md, «Released solutions»).
// Run: npm run test:e2e:loesungen
//   (= emulators:exec --only auth,firestore,functions; seeds, serves app/ on 127.0.0.1 and
//      drives the installed Chrome). Fictional people and texts only.
//
// Checks: right class after the release time sees «Musterlösung» under the questions that have
// one; before the release time, another class, a guest and an assignment without a release
// see nothing; the public copy carries no solution.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { publicCopy } from '../scripts/public-assignment.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:loesungen`);
        process.exit(1);
    }
}
const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));
const SHOTS = process.env.E2E_SHOTS ? normalize(process.env.E2E_SHOTS) : null;

await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';
const enc = encodeURIComponent;

const SUB = 'A. Verschuldung';
const mk = (id, freigabe) => ({
    assignmentId: id,
    assignmentTitle: id,
    ...(freigabe ? { loesungFreigabe: freigabe } : {}),
    subAssignments: {
        [SUB]: {
            type: 'quill',
            questions: [
                { id: 'q1', text: 'Nennen Sie *zwei Ursachen* für Verschuldung.', loesung: 'Zu viel ausgeben.\nKeine Übersicht über das Budget.' },
                { id: 'q2', text: 'Frage ohne Musterlösung.' },
            ],
        },
    },
});
const FREI = '0.5 Frei';          // TestA, time in the past
const SPAETER = '0.5 Spaeter';    // TestA, time in the future
const OHNE = '0.5 Ohne';          // no release at all
const defs = {
    [FREI]: mk(FREI, [{ klassen: ['TESTA'], ab: '2026-01-01T00:00:00+01:00' }]),
    [SPAETER]: mk(SPAETER, [{ klassen: ['testa'], ab: '2099-01-01T00:00:00+01:00' }]),
    [OHNE]: mk(OHNE, null),
};
for (const d of Object.values(defs)) {
    await box.doc(`assignments/${enc(d.assignmentId)}`).set(d);
    await box.doc(`publicAssignments/${enc(d.assignmentId)}`).set(publicCopy(d));
}
{
    const pub = JSON.stringify((await box.doc(`publicAssignments/${enc(FREI)}`).get()).data());
    assert.ok(!/Zu viel ausgeben|loesung|Freigabe/i.test(pub), 'public copy carries no solution');
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/lms_box\/(index\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/;
const appServer = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path.replace(/^\/lms_box\//, '')));
    if (!SERVED.test(path) || !file.startsWith(APP + sep)) { res.writeHead(404); res.end(); return; }
    try {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => appServer.listen(0, '127.0.0.1', resolve));
const LMS = `http://127.0.0.1:${appServer.address().port}`;
const url = (id) => `${LMS}/lms_box/index.html?assignmentId=${enc(id)}&subId=${enc(SUB)}`;

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const browserLog = [];
async function newPage(browser, label) {
    const context = await browser.newContext({ viewport: { width: 760, height: 900 } });
    context.setDefaultTimeout(60000);
    await context.route('**/*', (route) => {
        const u = new URL(route.request().url());
        return (!/^https?:$/.test(u.protocol) || ALLOWED_HOSTS.has(u.hostname)) ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (e) => browserLog.push(`${label} pageerror: ${e.message}`));
    return page;
}
async function login(page, username) {
    await page.locator('#guest-login').click();
    await page.locator('#auth-username').fill(username);
    await page.locator('#auth-password').fill(PASSWORD);
    await page.locator('#auth-login-btn').click();
    await page.locator('#auth-user').waitFor();
}
/** The page draws the solution after the editors; the callable may start cold (emulator): wait for it, then count. */
async function loesungen(page, erwartet) {
    await page.locator('.question-block').first().waitFor();
    if (erwartet) await page.locator('details.musterloesung').first().waitFor({ timeout: 30000 }).catch(() => {});
    else await page.waitForTimeout(6000);
    return page.locator('details.musterloesung').count();
}

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const step = async (name, fn) => {
    try { await fn(); } finally { for (const c of browser.contexts()) await c.close(); }   // one page at a time: the machine runs out of resources otherwise
    console.log(`ok  ${name}`);
};
try {
    await step('(a) Anna (TestA), after the release: «Musterlösung» under q1 only, text intact', async () => {
        const p = await newPage(browser, 'anna');
        await p.goto(url(FREI));
        await login(p, 'anna.beispiel');
        assert.equal(await loesungen(p, true), 1);
        const d = p.locator('details.musterloesung');
        assert.equal(await d.locator('summary').innerText(), 'Musterlösung');
        await d.locator('summary').click();
        assert.match(await d.innerText(), /Zu viel ausgeben\.\s+Keine Übersicht über das Budget\./);
        assert.equal(await p.locator('.question-block').nth(1).locator('details.musterloesung').count(), 0, 'q2 has none');
        if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await p.screenshot({ path: join(SHOTS, 'loesung-frei.png'), fullPage: true }); }
    });
    await step('(b) Cleo (TestB), same assignment: nothing', async () => {
        const p = await newPage(browser, 'cleo');
        await p.goto(url(FREI));
        await login(p, 'cleo.probe');
        assert.equal(await loesungen(p, false), 0);
    });
    await step('(c) Anna, release time in the future: nothing', async () => {
        const p = await newPage(browser, 'anna2');
        await p.goto(url(SPAETER));
        await login(p, 'anna.beispiel');
        assert.equal(await loesungen(p, false), 0);
        if (SHOTS) await p.screenshot({ path: join(SHOTS, 'loesung-vor-17.png'), fullPage: true });
    });
    await step('(d) Anna, assignment without a release: nothing', async () => {
        const p = await newPage(browser, 'anna3');
        await p.goto(url(OHNE));
        await login(p, 'anna.beispiel');
        assert.equal(await loesungen(p, false), 0);
    });
    await step('(e) guest (not signed in), released assignment: nothing, no call to the function', async () => {
        const p = await newPage(browser, 'gast');
        const calls = [];
        p.on('request', (r) => { if (/boxLoesungen/.test(r.url())) calls.push(r.url()); });
        await p.goto(url(FREI));
        assert.equal(await loesungen(p, false), 0);
        assert.equal(calls.length, 0);
    });
    assert.deepEqual(browserLog, [], `browser errors: ${browserLog.join(' | ')}`);
    console.log('\nall ok');
} catch (e) {
    failed = true;
    console.error('FAILED:', e);
} finally {
    await browser.close();
    appServer.close();
}
process.exit(failed ? 1 : 0);
