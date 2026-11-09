// Browser test of the mindmap print view (dashboard/mindmaps.html, CONTRACT.md «Mindmap print view»),
// against the EMULATORS. Run: npm run test:e2e:mindmaps
//
// Fictional people and texts only. The skeletons of allgemeinbildung.github.io/mindmap are served
// by this test (route), so nothing outside the emulators and the gstatic SDK is called.
// Optional: SHOT_DIR=<folder outside the repo> also writes a screenshot and the PDF there.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:mindmaps`);
        process.exit(1);
    }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));
const SHOT_DIR = process.env.SHOT_DIR ? resolve(process.env.SHOT_DIR) : null;
if (SHOT_DIR && (SHOT_DIR + sep).startsWith(APP + sep)) {
    console.error('Refusing: SHOT_DIR must be outside the repository.');
    process.exit(1);
}

await import('../scripts/seed-emulator.mjs');       // teacher seed-teacher, students seed-anna/ben/cleo
const adminApp = getApps()[0];
const box = getFirestore(adminApp, 'lmsbox');
const roster = getFirestore(adminApp);
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';
const enc = encodeURIComponent;

// ---- fixtures ---------------------------------------------------------------------------------

const CLASS = 'TestM';
const U81 = 'ABUlehrmittel/08 Konsum und Wirtschaft/8.1 Kaufvertragsarten Teil 2';
const U82 = 'ABUlehrmittel/08 Konsum und Wirtschaft/8.2 Schulden und Betreibung';
const R81 = 'Kaufvertragsarten Teil 2';
const R82 = 'Schulden und Betreibung';
const SKELETONS = {
    // 8.1 under `_1` (first choice), with a sub-level that must be cut away
    '8.1 Kaufvertragsarten Teil 2_1': { root: { text: R81, children: [
        { text: 'Leasing', children: [{ text: 'Lehrer-Unterpunkt, wird abgeschnitten' }] },
        { text: 'Miet-Kauf-Vertrag' }, { text: 'Kauf mit Konsumkreditvertrag' }, { text: 'Kauf mit Kleindarlehen' },
    ] } },
    // 8.2 only under the bare note name (third choice)
    '8.2 Schulden und Betreibung': { root: { text: R82, children: [
        { text: 'Schulden' }, { text: 'Betreibung' }, { text: 'Budget' }, { text: 'Hilfe' }, { text: 'Konkurs' },
    ] } },
};
const xss = (tag) => `window.__xss='${tag}'`;
const EVIL = `<img src="http://xss.invalid/n.png" onerror="${xss('node')}">`;
const MERMAID = 'Ende"] --> x((Klick)) %%{init}%%';
const EVIL_NAME = `Mira <b onmouseover="${xss('name')}">Muster</b>`;

const people = [
    { uid: 'e2e-mm-mira', name: EVIL_NAME, username: 'mira.muster' },
    { uid: 'e2e-mm-noah', name: 'Noah Neu', username: 'noah.neu' },
    { uid: 'e2e-mm-olga', name: 'Olga Ohne', username: 'olga.ohne' },
    { uid: 'e2e-mm-paul', name: 'Paul Leer', username: 'paul.leer' },
    { uid: 'e2e-mm-quinn', name: 'Quinn Quer', username: 'quinn.quer' },
];
const OTHER = { uid: 'e2e-mm-xaver', name: 'Xaver Anderklasse', username: 'xaver.ander' };

const maps = {
    'e2e-mm-mira': { [U81]: { v: 1, add: [
        { at: [R81, 'Leasing'], nodes: [{ t: 'Monatliche Rate 7101', c: [{ t: 'Restwert am Ende 7102', c: [] }] }, { t: EVIL, c: [] }] },
        { at: [R81, 'Kauf mit Kleindarlehen'], nodes: [{ t: MERMAID, c: [] }] },
        { at: [R81, 'Gibt es nicht mehr'], nodes: [{ t: 'Verirrter Ast 7103', c: [] }] },
    ] } },
    'e2e-mm-noah': {
        [U81]: { v: 1, add: [
            { at: [R81, 'Leasing'], nodes: [
                { t: 'Gegenstand gehört der Leasingfirma', c: [{ t: 'ich bin nur Nutzer', c: [] }] },
                { t: 'monatliche Leasingrate', c: [{ t: 'Vollkasko meist Pflicht', c: [] }, { t: 'Restwert am Ende', c: [] }] },
                { t: 'vorzeitige Kündigung: teuer (Nachzahlung)', c: [] },
            ] },
            { at: [R81, 'Miet-Kauf-Vertrag'], nodes: [
                { t: 'zuerst mieten, später kaufen', c: [] },
                { t: 'Mietzins wird beim Kauf angerechnet', c: [] },
                { t: 'Noahs Punkt 7201', c: [] },
            ] },
            { at: [R81, 'Kauf mit Konsumkreditvertrag'], nodes: [
                { t: 'Konsumkreditgesetz (KKG)', c: [{ t: 'schriftlicher Vertrag', c: [] }, { t: '14 Tage Widerruf', c: [] }, { t: 'Kreditfähigkeitsprüfung', c: [] }] },
                { t: 'Zins höchstens 10 % (Stand prüfen)', c: [] },
            ] },
            { at: [R81, 'Kauf mit Kleindarlehen'], nodes: [
                { t: 'Bargeld von der Bank, frei verwendbar', c: [] },
                { t: 'Gefahr: Schuldenfalle', c: [{ t: 'Budget zuerst machen', c: [] }] },
            ] },
            { at: [R81], nodes: [{ t: 'Mein Fazit: lieber sparen und bar kaufen', c: [] }] },
        ] },
        // Long: does not fit one page, fits two.
        [U82]: { v: 1, add: ['Schulden', 'Betreibung', 'Budget', 'Hilfe', 'Konkurs'].map((b, k) => ({
            at: [R82, b],
            nodes: Array.from({ length: 24 }, (_, i) => ({ t: `${b} ${k}.${i} – ${'ein langer Gedanke mit vielen Wörtern '.repeat(3).slice(0, 95)}`, c: [] })),
        })) },
    },
    'e2e-mm-paul': { [U81]: { v: 1, add: [] } },
    'e2e-mm-quinn': { [U81]: 'kein JSON {' },
};

for (const p of [...people, OTHER]) {
    await roster.doc(`students/${p.uid}`).set({
        name: p.name, username: p.username, bbwEmail: `${p.username}@lernende.bbw.ch`,
        classId: p === OTHER ? 'TestX' : CLASS, classIds: [p === OTHER ? 'TestX' : CLASS], mustSetPassword: false, active: true,
    });
}
for (const d of (await box.collection('mindmapDrafts').get()).docs) await d.ref.delete();
const at = Timestamp.fromDate(new Date('2026-10-29T16:45:00Z'));
const put = (uid, mapId, nodes, docUnit = mapId) => box.doc(`mindmapDrafts/${uid}__${enc(docUnit)}`)
    .set({ uid, mapId, nodes: typeof nodes === 'string' ? nodes : JSON.stringify(nodes), updatedAt: at });
for (const [uid, byUnit] of Object.entries(maps)) for (const [u, n] of Object.entries(byUnit)) await put(uid, u, n);
await put(OTHER.uid, U81, { v: 1, add: [{ at: [R81, 'Leasing'], nodes: [{ t: 'Fremde Klasse 9901', c: [] }] }] });
// Quinn: a document under the 8.2 id that claims to be 8.1 counts as missing.
await put('e2e-mm-quinn', U81, { v: 1, add: [{ at: [R81], nodes: [{ t: 'Falsch abgelegt 9902' }] }] }, U82);

// ---- static server for app/ ------------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/(js\/[\w.-]+\.js|dashboard\/(liveview\.html|liveview\.js|mindmaps\.html|mindmaps\.js|teacher\.css|modules\/[\w.-]+\.js))$/;
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !SERVED.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(await readFile(file));
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((r, j) => { server.once('error', j); server.listen(0, '127.0.0.1', r); });
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const ALLOWED = new Set(['127.0.0.1', 'localhost', 'www.gstatic.com', 'cdn.quilljs.com']);   // Quill CSS: Live View
const blocked = [];
const skeletonRequests = [];
const browserLog = [];

async function newContext(browser) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    context.setDefaultTimeout(20000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === 'allgemeinbildung.github.io' && url.pathname.startsWith('/mindmap/maps/')) {
            const name = decodeURIComponent(url.pathname.slice('/mindmap/maps/'.length)).replace(/\.json$/, '');
            skeletonRequests.push(name);
            const body = SKELETONS[name];
            return body
                ? route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) })
                : route.fulfill({ status: 404, headers: { 'Access-Control-Allow-Origin': '*' }, body: 'not found' });
        }
        if (!/^https?:$/.test(url.protocol) || ALLOWED.has(url.hostname)) return route.continue();
        blocked.push(url.href);
        return route.abort();
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`console: ${m.text()}`); });
    });
    return context;
}
async function login(page, username) {
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('#login-btn').click();
}

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let mp;
try {
    const ctx = await newContext(browser);
    const lv = await ctx.newPage();

    await step('(a) a student account is refused on the print view', async () => {
        const sp = await ctx.newPage();
        await sp.goto(`${ORIGIN}/dashboard/mindmaps.html`);
        await login(sp, 'anna.beispiel');
        await sp.locator('#login-status', { hasText: 'kein Lehrpersonen-Konto' }).waitFor();
        assert.equal(await sp.locator('.sheet').count(), 0);
        await sp.close();
    });

    await step('(b) Live View: the button opens the print view with the selected class', async () => {
        await lv.goto(`${ORIGIN}/dashboard/liveview.html`);
        await login(lv, 'tina.test');
        await lv.locator('#class-select:not([disabled])').waitFor();
        await lv.locator('#class-select').selectOption(CLASS);
        const [popup] = await Promise.all([ctx.waitForEvent('page'), lv.locator('#mindmap-print-btn').click()]);
        mp = popup;
        await mp.waitForLoadState();
        assert.match(mp.url(), /\/dashboard\/mindmaps\.html\?klasse=TestM$/);
        await mp.locator('#mm-class:not([disabled])').waitFor();
        assert.equal(await mp.locator('#mm-class').inputValue(), CLASS, 'class taken over, login shared (no second login)');
        assert.equal(await mp.locator('#login-overlay.visible').count(), 0);
    });

    await step('(c) choose 8.1 and 8.2, load: one sheet per learner and unit, long map on two pages', async () => {
        assert.equal(await mp.locator('#mm-load').isDisabled(), true, 'no unit chosen yet');
        await mp.locator('#mm-units label', { hasText: '8.1 Kaufvertragsarten' }).locator('input').check();
        await mp.locator('#mm-units label', { hasText: '8.2 Schulden' }).locator('input').check();
        assert.deepEqual(await mp.locator('#mm-chosen .chip').allTextContents(), ['8.1 Kaufvertragsarten Teil 2×', '8.2 Schulden und Betreibung×']);
        await mp.locator('#mm-load').click();
        await mp.locator('#mm-print:not([disabled])').waitFor();

        const heads = await mp.locator('.sheet:not(.sheet-list) .sheet-head').evaluateAll((hs) => hs.map((h) => [
            h.querySelector('.who').textContent, h.querySelector('.klasse').textContent, h.querySelector('.unit').textContent,
            h.querySelector('.meta').textContent,
        ]));
        assert.deepEqual(heads.map((h) => [h[0], h[2], h[3].replace(/Stand .*/, 'Stand')]), [
            [EVIL_NAME, '8.1 Kaufvertragsarten Teil 2', 'Stand'],
            ['Noah Neu', '8.1 Kaufvertragsarten Teil 2', 'Stand'],
            ['Noah Neu', '8.2 Schulden und Betreibung', 'Seite 1/2 · Stand'],
            ['Noah Neu', '8.2 Schulden und Betreibung', 'Seite 2/2 · Stand'],
        ], 'sorted by learner, chapters in order; Paul (empty) and Quinn (garbage, wrong id) get no sheet');
        assert.ok(heads.every((h) => h[1] === CLASS), 'class on every sheet');
        assert.match(heads[0][3], /Stand 29\.10\.2026/);

        const body = await mp.locator('#mm-sheets').innerText();
        assert.doesNotMatch(body, /Fremde Klasse 9901|Xaver/, 'nobody from another class');
        assert.doesNotMatch(body, /Falsch abgelegt 9902/, 'a document under the wrong id is not shown');
        assert.doesNotMatch(body, /Lehrer-Unterpunkt/, 'skeleton cut to root and main branches');
        assert.match(body, /Verirrter Ast 7103/, 'a branch whose teacher node is gone hangs under the root');
        assert.match(body, /Restwert am Ende 7102/);

        assert.ok(skeletonRequests.includes('8.1 Kaufvertragsarten Teil 2_1'));
        assert.ok(!skeletonRequests.includes('8.1 Kaufvertragsarten Teil 2_1_1'), 'stops at the first skeleton that exists');
        assert.deepEqual(skeletonRequests.filter((n) => n.startsWith('8.2')),
            ['8.2 Schulden und Betreibung_1', '8.2 Schulden und Betreibung_1_1', '8.2 Schulden und Betreibung']);
    });

    await step('(d) the list page: without a map, without own branches', async () => {
        const list = mp.locator('.sheet-list');
        const text = await list.innerText();
        assert.match(text, /TestM · 8\.1 Kaufvertragsarten Teil 2 \/ 8\.2 Schulden und Betreibung/);
        const block = (h) => list.locator(`h3:has-text("${h}") + ul li`).allTextContents();
        assert.deepEqual(await block('Ohne Mindmap'), [
            `${EVIL_NAME} – 8.2 Schulden und Betreibung`,
            'Olga Ohne – 8.1 Kaufvertragsarten Teil 2', 'Olga Ohne – 8.2 Schulden und Betreibung',
            'Paul Leer – 8.2 Schulden und Betreibung',
            'Quinn Quer – 8.2 Schulden und Betreibung',
        ]);
        assert.deepEqual(await block('Mindmap ohne eigene Äste'), [
            'Paul Leer – 8.1 Kaufvertragsarten Teil 2', 'Quinn Quer – 8.1 Kaufvertragsarten Teil 2',
        ]);
        assert.match(await mp.locator('#mm-status').innerText(), /2 von 5 Lernenden mit Mindmap · 4 Seite\(n\)/);
        assert.deepEqual(await mp.locator('#mm-warnings li').allTextContents(), ['Mehr als 2 A4-Seiten: Noah Neu: 3 Seiten']);
    });

    await step('(e) every text stays text: names, nodes, Mermaid syntax', async () => {
        assert.equal(await mp.evaluate(() => window.__xss), undefined);
        assert.equal(await mp.locator('.sheet img, .sheet b, .sheet script').count(), 0, 'no element made from data');
        const txt = await mp.locator('.sheet .txt').allTextContents();
        assert.ok(txt.includes(EVIL), 'the hostile node is shown literally');
        assert.ok(txt.includes(MERMAID), 'Mermaid syntax is shown literally');
        await mp.locator('.sheet .who').first().hover();
        assert.equal(await mp.evaluate(() => window.__xss), undefined);
    });

    await step('(f) each map fits its sheet; printed, every sheet is one A4 landscape page', async () => {
        const fits = await mp.locator('.sheet:not(.sheet-list)').evaluateAll((ss) => ss.map((s) => {
            const m = s.querySelector('.map');
            return { overflow: s.classList.contains('overflow'), fits: m.scrollHeight <= m.clientHeight + 1, pt: s.dataset.pt };
        }));
        assert.ok(fits.every((f) => !f.overflow && f.fits), JSON.stringify(fits));
        assert.equal(fits[0].pt, '12', 'a small map keeps the large type');
        assert.equal(fits[2].pt, fits[3].pt, 'both pages of a split map have the same type size');
        await mp.emulateMedia({ media: 'print' });
        assert.equal(await mp.locator('#mm-controls').isVisible(), false, 'controls are not printed');
        const pdf = await mp.pdf({ preferCSSPageSize: true, printBackground: true });
        const pages = (pdf.toString('latin1').match(/\/Type\s*\/Page(?!s)/g) || []).length;
        assert.equal(pages, 5, '4 map sheets + 1 list page');
        await mp.emulateMedia({ media: 'screen' });
        if (SHOT_DIR) {
            await writeFile(join(SHOT_DIR, 'mindmaps-druck-fiktiv.pdf'), pdf);
            await mp.setViewportSize({ width: 1180, height: 1250 });
            await mp.screenshot({ path: join(SHOT_DIR, 'mindmaps-druck-fiktiv.png'), fullPage: false });
            await mp.locator('.sheet').nth(1).screenshot({ path: join(SHOT_DIR, 'mindmaps-druck-fiktiv-blatt.png') });
        }
    });

    assert.deepEqual(blocked, [], 'a page requested a host other than the emulators, the skeleton route and gstatic');
    assert.deepEqual(browserLog.filter((l) => !/400 \(Bad Request\)|auth\/|Failed to load resource.*404/.test(l)), [], 'no page errors');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log:\n  ${browserLog.slice(-15).join('\n  ')}`);
    if (mp && !mp.isClosed()) {     // what the fitting did, for whoever reads a failure
        console.error(await mp.locator('.sheet').evaluateAll((ss) => ss.map((x) => {
            const m = x.querySelector('.map'); const g = x.querySelector('.branches');
            return [x.className, x.dataset.pt, m && `map ${m.scrollHeight}/${m.clientHeight}`, g && `cols ${g.scrollWidth}/${g.clientWidth}`].join(' ');
        }).join('\n')).catch((err) => err.message));
    }
} finally {
    await browser.close();
    server.close();
}
if (!failed) console.log(`\ne2e-mindmaps: ${results.length} steps passed.`);
process.exit(failed ? 1 : 0);
