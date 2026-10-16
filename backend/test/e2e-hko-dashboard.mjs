// Browser test of the HKO teacher view (dashboard/hko.html), against the EMULATORS.
// Run (from backend/, with the port lock of the session; the ports 9190/8280 are shared with test:all):
//   node scripts/emu.mjs emulators:exec --config firebase.hko-e2e.json --project interactive-media-2a1fc --only auth,firestore \
//     "node scripts/seed-hko.mjs && node scripts/hko-upload.mjs --emulator --build test/fixtures/hko-build && node test/e2e-hko-dashboard.mjs"
//
// The seed (accounts, classes) and the fixture upload run before this file. This file writes the
// answers itself with the Admin SDK into `hko/answers` and `hko/pasteEvents` (the fields of
// Vertrag §4/§5), serves app-hko/ with a positive list of files, and drives the installed Chrome.
// Needs internet only for the Firebase SDK on gstatic; every other outside request is blocked and
// fails the run. Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { PROJECT_ID, DATABASE_ID } from '../scripts/lib/hko-target.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. See the header of this file.`);
        process.exit(1);
    }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed

const adminApp = initializeApp({ projectId: PROJECT_ID });
const hko = getFirestore(adminApp, DATABASE_ID);
const roster = getFirestore(adminApp);

const UNIT = 'lj1-test-box';
const CLASS_3J = 'test-3j-a';
const CLASS_4J = 'test-4j-a';
const CLASS_OHNE = 'e2e-hko-ohne-klasse';   // has no document in `classes`
const SEED = 'hko-seed-3j';                 // from seed-hko.mjs: "Test Lernende 3J", class test-3j-a
const SEED_NAME = 'Test Lernende 3J';
const BEA = 'e2e-hko-bea';
const MAL = 'e2e-hko-mal';
const GHOST = 'e2e-hko-ghost';              // on no class list, but the documents carry classId test-3j-a
const OHNE = 'e2e-hko-ohne-1';
const xss = (tag) => `window.__xss='${tag}'`;
const MAL_NAME = `Mallory <img src="http://xss.invalid/name.png" onerror="${xss('name')}">`;
const MAL_TEXT = `Sichtbarer Anfang 7001 <script>${xss('script')}</script><img src="http://xss.invalid/a.png" onerror="${xss('img')}"> <b>fett</b> Ende`;
const MAL_EXCERPT = `<img src="http://xss.invalid/e.png" onerror="${xss('excerpt')}">`;
const SEED_TEXT = 'Zeile eins mit "Anführung"\nZeile zwei; mit Semikolon';
const BEA_TEXT = '=SUMME(A1;A2)';
const GHOST_TEXT = 'Geisterantwort ohne Klassenliste 9999';

const answerId = (uid, blockId, unitId = UNIT) => `${uid}__${unitId}__${blockId}`;
function answer(uid, classId, blockId, type, value, extra = {}) {
    return {
        uid, classId, unitId: UNIT, blockId, unitVersion: 1, variante: extra.variante ?? '3J', type, value,
        status: 'entwurf', kn: false, updatedAt: Timestamp.now(),
    };
}
async function putAnswer(a) { await hko.doc(`answers/${answerId(a.uid, a.blockId)}`).set(a); }
async function putPaste(uid, blockId, eventId, fields) {
    await hko.doc(`pasteEvents/${uid}__${UNIT}__${blockId}__${eventId}`).set({
        uid, unitId: UNIT, blockId, feld: 'text', kind: 'paste', chars: 100, excerpt: '', at: Timestamp.now(), ...fields,
    });
}

// ---- clean up leftovers of an earlier run, then write the test data ------------------------------------

for (const c of ['answers', 'pasteEvents']) for (const d of (await hko.collection(c).get()).docs) await d.ref.delete();
for (const d of (await roster.collection('students').get()).docs) if (d.id.startsWith('e2e-hko-')) await d.ref.delete();

const person = (uid, name, classId) => roster.doc(`students/${uid}`).set({
    name, username: uid, bbwEmail: `${uid}@lernende.bbw.ch`, classId, classIds: [classId], mustSetPassword: false, active: true,
});
await person(BEA, 'Bea Beispiel', CLASS_3J);
await person(MAL, MAL_NAME, CLASS_3J);
await person(OHNE, 'Ohne Klasse', CLASS_OHNE);
// GHOST has no students/{uid} document on purpose.

await putAnswer(answer(SEED, CLASS_3J, 'begriffe-a', 'items', { antworten: [{ frageId: 'testbegriff-1', text: 'Erste Antwort' }, { frageId: 'testbegriff-3', text: 'Dritte Antwort' }] }));
await putAnswer(answer(SEED, CLASS_3J, 'entscheid', 'text', { text: SEED_TEXT }));
await putAnswer(answer(SEED, CLASS_3J, 'raster-3j', 'raster', { zeilen: [{ c: ['00:10', 'Aussage eins', '→ Angebot'] }, { c: ['00:40', '', ''] }], befund: 'Mein Befund' }));
// wrong variant in the document (the class says 3J)
await putAnswer(answer(SEED, CLASS_3J, 'selbst-entscheid', 'selbst', { stufen: { argumentation: 2, position: 3 }, begruendung: 'Weil es passt.', verbessere: 'Mehr Belege.' }, { variante: '4J' }));
// a document for a block the 3J column set does not show (admin SDK ignores the rules; the view must not show a column)
await putAnswer(answer(SEED, CLASS_3J, 'raster-4j', 'raster', { zeilen: [{ c: ['x', 'y', 'z'] }], befund: '' }));
await putAnswer(answer(BEA, CLASS_3J, 'entscheid', 'text', { text: BEA_TEXT }));
await putAnswer(answer(MAL, CLASS_3J, 'entscheid', 'text', { text: MAL_TEXT }));
await putAnswer(answer(GHOST, CLASS_3J, 'entscheid', 'text', { text: GHOST_TEXT }));
await putAnswer(answer(OHNE, CLASS_OHNE, 'entscheid', 'text', { text: 'Text der Person ohne erfasste Klasse 5005' }, { variante: '3J' }));
await putPaste(SEED, 'entscheid', 'AbCdEf1234', { feld: 'text', kind: 'paste', chars: 245, excerpt: 'Eingefügter Satz 8128' });
await putPaste(MAL, 'entscheid', 'MalMalMal1', { feld: 'text', kind: 'bulk', chars: 400, excerpt: MAL_EXCERPT });
await putPaste(GHOST, 'entscheid', 'GhostGhost', { feld: 'text', kind: 'paste', chars: 50, excerpt: 'Geister-Paste 6006' });

// ---- static server with a positive list ----------------------------------------------------------------

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/(js\/(hko\/)?[\w.-]+\.js|dashboard\/(hko\.html|teacher\.css|hko\/[\w.-]+\.(js|css)|modules\/(auth|api|firestore)\.js))$/;
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
const DASHBOARD_URL = `http://127.0.0.1:${server.address().port}/dashboard/hko.html`;

// ---- helpers ---------------------------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com']);
const blocked = [];
const browserLog = [];

async function newContext(browser, label) {
    const context = await browser.newContext({ acceptDownloads: true });
    context.setDefaultTimeout(20000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!/^https?:$/.test(url.protocol)) return route.continue();
        if (ALLOWED_HOSTS.has(url.hostname)) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`${label} pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`${label} console: ${m.text()}`); });
    });
    return context;
}
async function login(page, username) {
    await page.locator('#login-username').fill(username);
    await page.locator('#login-password').fill(PASSWORD);
    await page.locator('#login-btn').click();
}
async function choose(page, classId, unitId = UNIT) {
    await page.locator(`#class-select option[value="${classId}"]`).waitFor({ state: 'attached' });
    await page.locator('#unit-select option', { hasText: unitId }).first().waitFor({ state: 'attached' });
    await page.locator('#class-select').selectOption(classId);
    await page.locator('#unit-select').selectOption(unitId);
    await page.locator('#grid .hko-grid, #grid .hko-empty').first().waitFor();
}
const columns = (page) => page.locator('#grid thead th.hko-block-h').evaluateAll((ths) => ths.map((t) => t.dataset.blockId));
/** The class list as the view must show it: roster names of a class (seed people and the people of this test). */
async function classNames(classId) {
    const names = [];
    for (const d of (await roster.collection('students').get()).docs) {
        const x = d.data();
        const ids = Array.isArray(x.classIds) && x.classIds.length ? x.classIds : [x.classId];
        if (ids.includes(classId)) names.push(x.name);
    }
    return names;
}
const rowNames = (page) => page.locator('#grid tbody th.hko-name').evaluateAll((ths) => ths.map((t) => t.textContent));
const cell = (page, uid, blockId) => page.locator(`#grid button.hko-cell-btn[data-uid="${uid}"][data-block-id="${blockId}"]`);
const xssFlag = (page) => page.evaluate(() => window.__xss ?? null);

/** Minimal CSV reader for the file the view writes: `;`, quotes, CRLF. */
function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (quoted) {
            if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
        } else if (c === '"') quoted = true;
        else if (c === ';') { row.push(field); field = ''; }
        else if (c === '\r' && text[i + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; }
        else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
}

const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}

// ---- the run ---------------------------------------------------------------------------------------------

let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const ctx = await newContext(browser, 'teacher');
    const tp = await ctx.newPage();

    await step('(a) a learner account gets "Kein Zugang" and is signed out; the teacher gets in', async () => {
        await tp.goto(DASHBOARD_URL);
        await tp.locator('#login-overlay.visible').waitFor();
        await login(tp, 'test.3j');
        await tp.locator('#login-status:not(:empty)').waitFor();
        assert.match(await tp.locator('#login-status').innerText(), /Kein Zugang: Dieses Konto ist kein Lehrpersonen-Konto/);
        await tp.waitForFunction(async () => (await import('/js/firebase.js')).auth.currentUser === null);
        assert.equal(await tp.locator('#login-overlay.visible').count(), 1);
        assert.equal(await tp.locator('#class-select').isDisabled(), true, 'nothing was loaded for the learner');
        assert.equal(await tp.locator('#class-select option').count(), 1);

        await login(tp, 'test.lehrperson@lernende.bbw.ch');
        await tp.locator('#login-overlay').waitFor({ state: 'hidden' });
        await tp.locator(`#class-select option[value="${CLASS_3J}"]`).waitFor({ state: 'attached' });
        const labels = await tp.locator('#class-select option').evaluateAll((os) => os.map((o) => [o.value, o.textContent]));
        const label = (id) => labels.find(([v]) => v === id)?.[1];
        assert.match(label(CLASS_3J), /3J/);
        assert.doesNotMatch(label(CLASS_3J), /nicht erfasst/);
        assert.match(label(CLASS_OHNE), /nicht erfasst/, 'a class without a `classes` document is marked');
    });

    await step('(b) test-3j-a x lj1-test-box: columns by variant, no mitnahme, no kn, answers from the seed', async () => {
        await choose(tp, CLASS_3J);
        const cols = await columns(tp);
        assert.deepEqual(cols, ['begriffe-a', 'begriffe-voll', 'raster-quelle', 'raster-voll', 'raster-3j', 'entscheid', 'selbst-entscheid', 'spaeter']);
        assert.ok(!cols.includes('raster-4j'), 'the 4J block is no column for a 3J class');
        assert.ok(!cols.includes('rueckblick'), 'mitnahme is never a column');
        assert.ok(!cols.includes('kn-fall'), 'kn: true is never a column');
        const expected = await classNames(CLASS_3J);
        assert.ok(expected.includes(SEED_NAME) && expected.includes('Bea Beispiel') && expected.includes(MAL_NAME) && expected.length >= 3);
        assert.deepEqual((await rowNames(tp)).sort(), expected.sort(), 'exactly the class list, names as text');
        // the listener delivers after the grid is drawn
        await tp.waitForFunction(([uid]) => document.querySelector(`button[data-uid="${uid}"][data-block-id="begriffe-a"]`)?.innerText.includes('2/3 beantwortet'), [SEED]);
        assert.match(await cell(tp, SEED, 'begriffe-a').innerText(), /2\/3 beantwortet/);
        assert.match(await cell(tp, SEED, 'entscheid').innerText(), /8 Wörter/);
        assert.match(await cell(tp, SEED, 'raster-3j').innerText(), /4\/9 Zellen \+ Befund/);
        assert.equal((await cell(tp, SEED, 'begriffe-voll').innerText()).trim(), '–');
        assert.equal(await tp.locator('#grid').getByText('x / y / z').count(), 0);
        assert.equal(await xssFlag(tp), null);
    });

    await step('(c) a new answer of a person appears live (listener)', async () => {
        assert.equal((await cell(tp, SEED, 'begriffe-voll').innerText()).trim(), '–');
        await putAnswer(answer(SEED, CLASS_3J, 'begriffe-voll', 'items', { antworten: Array.from({ length: 5 }, (_, i) => ({ frageId: `testbegriff-${i + 1}`, text: `Live ${i + 1}` })) }));
        await tp.waitForFunction(([uid]) => document.querySelector(`button[data-uid="${uid}"][data-block-id="begriffe-voll"]`)?.innerText.includes('5/12 beantwortet'), [SEED]);
    });

    await step('(d) hostile text and hostile name show as text; no script runs; nothing is requested from outside', async () => {
        assert.equal(await tp.locator('#grid tbody th.hko-name').filter({ hasText: '<img src="http://xss.invalid/name.png"' }).count(), 1);
        await cell(tp, MAL, 'entscheid').click();
        const detail = tp.locator('#detail');
        await detail.locator('.hko-text').waitFor();
        assert.equal(await detail.locator('.hko-text').innerText(), MAL_TEXT);
        assert.match(await detail.innerText(), /<img src="http:\/\/xss\.invalid\/e\.png" onerror=/, 'the paste excerpt is text as well');
        for (const sel of ['#detail img', '#detail script', '#detail b', '#grid img', '#grid script']) assert.equal(await tp.locator(sel).count(), 0, sel);
        await tp.waitForTimeout(500);
        assert.equal(await xssFlag(tp), null);
        assert.deepEqual(blocked, []);
    });

    await step('(e) a uid outside the class list never appears, although its documents carry the classId', async () => {
        const body = await tp.locator('body').innerText();
        assert.doesNotMatch(body, /Geisterantwort/);
        assert.doesNotMatch(body, /Geister-Paste/);
        assert.equal(await tp.locator(`#grid [data-uid="${GHOST}"]`).count(), 0);
        assert.equal((await rowNames(tp)).length, (await classNames(CLASS_3J)).length);
        assert.equal(await tp.locator('#grid .hko-paste').count(), 2, 'paste symbols only for the two people on the list');
    });

    await step('(f) details by type: items, text, raster (head from spalten), selbst (names and level texts)', async () => {
        const detail = tp.locator('#detail');
        await cell(tp, SEED, 'begriffe-a').click();
        await detail.locator('h4.hko-frage').first().waitFor();
        const frageTexts = await detail.locator('h4.hko-frage').allInnerTexts();
        assert.deepEqual(frageTexts.map((t) => t.slice(0, 12)), ['Testfrage 1:', 'Testfrage 2:', 'Testfrage 3:']);
        const items = await detail.locator('.hko-text, .hko-empty').allInnerTexts();
        assert.ok(items.includes('Erste Antwort') && items.includes('Dritte Antwort'));
        assert.ok(items.includes('–'), 'the unanswered question shows a dash');

        await cell(tp, SEED, 'entscheid').click();
        await detail.locator('.hko-text').waitFor();
        assert.equal(await detail.locator('.hko-text').innerText(), SEED_TEXT, 'line breaks kept');

        await cell(tp, SEED, 'raster-3j').click();
        await detail.locator('table.hko-raster').waitFor();
        assert.deepEqual(await detail.locator('table.hko-raster thead th').allInnerTexts(), ['Stelle', 'Aussage', '→ Begriff']);
        assert.deepEqual(await detail.locator('table.hko-raster tbody tr:first-child td').allInnerTexts(), ['00:10', 'Aussage eins', '→ Angebot']);
        assert.equal(await detail.locator('table.hko-raster tbody tr').count(), 2);
        assert.match(await detail.innerText(), /Mein Befund/);

        await cell(tp, SEED, 'selbst-entscheid').click();
        await detail.locator('ul.hko-stufen').waitFor();
        const stufen = await detail.locator('ul.hko-stufen li').allInnerTexts();
        assert.deepEqual(stufen, ['Argumentation — Stufe 2: Testtext Stufe 2 Argumentation.', 'Position/Werthaltung — Stufe 3: Testtext Stufe 3 Position.']);
        assert.match(await detail.innerText(), /Weil es passt\./);
        assert.match(await detail.innerText(), /Mehr Belege\./);
    });

    await step('(g) paste hints: symbol with count in the cell, kind, characters and excerpt in the detail', async () => {
        assert.match(await cell(tp, SEED, 'entscheid').locator('.hko-paste').innerText(), /⧉ 1/);
        await cell(tp, SEED, 'entscheid').click();
        const li = tp.locator('#detail .hko-paste-list li');
        await li.first().waitFor();
        assert.equal(await li.count(), 1);
        assert.match(await li.first().innerText(), /Einfügen in text, 245 Zeichen: «Eingefügter Satz 8128»/);
        assert.equal(await cell(tp, SEED, 'begriffe-a').locator('.hko-paste').count(), 0);
    });

    await step('(h) variant in the document differs from the computed one -> marking in cell and detail', async () => {
        assert.match(await cell(tp, SEED, 'selbst-entscheid').innerText(), /Variante im Dokument: 4J/);
        assert.equal(await cell(tp, SEED, 'entscheid').locator('.hko-variante-flag').count(), 0, 'matching variant: no marking');
        await cell(tp, SEED, 'selbst-entscheid').click();
        await tp.locator('#detail .hko-warn').waitFor();
        assert.match(await tp.locator('#detail .hko-warn').innerText(), /Variante im Dokument: 4J \(berechnet aus der Klasse: 3J\)/);
    });

    await step('(i) CSV: ";", BOM, quotes at ; " and line breaks, apostrophe before "="; download intercepted', async () => {
        const [download] = await Promise.all([tp.waitForEvent('download'), tp.locator('#csv-btn').click()]);
        assert.equal(download.suggestedFilename(), `hko-${CLASS_3J}-${UNIT}.csv`);
        const bytes = await readFile(await download.path());
        assert.deepEqual([...bytes.subarray(0, 3)], [0xEF, 0xBB, 0xBF], 'UTF-8 BOM');
        const text = bytes.toString('utf8').slice(1);
        assert.ok(text.startsWith('Name;Klasse;Variante;Block;Typ;Stand;Antwort;Paste-Hinweise\r\n'));
        const rows = parseCsv(text);
        assert.equal(rows.length, 1 + (await classNames(CLASS_3J)).length * 8, 'header + people x columns');
        assert.ok(rows.every((r) => r.length === 8), 'every record has 8 fields');
        const find = (name, blockPart) => rows.find((r) => r[0] === name && r[3].endsWith(`(${blockPart})`));

        const seed = find(SEED_NAME, 'entscheid');
        assert.equal(seed[1], CLASS_3J);
        assert.equal(seed[2], '3J');
        assert.equal(seed[4], 'text');
        assert.equal(seed[6], SEED_TEXT, '" and line break and ; survive a round trip through the quoting');
        assert.match(text, /"Zeile eins mit ""Anführung""\nZeile zwei; mit Semikolon"/);
        assert.match(seed[7], /^Einfügen in text, 245 Zeichen: «Eingefügter Satz 8128»$/);

        const bea = find('Bea Beispiel', 'entscheid');
        assert.equal(bea[6], `'${BEA_TEXT}`, 'formula protection');
        assert.match(text, /"'=SUMME\(A1;A2\)"/);

        assert.equal(find(SEED_NAME, 'selbst-entscheid')[2], '3J (Dokument: 4J)');
        assert.equal(find(SEED_NAME, 'selbst-entscheid')[6], 'argumentation: 2 | position: 3 | Begründung: Weil es passt. | Verbessere: Mehr Belege.');
        assert.equal(find(SEED_NAME, 'begriffe-a')[6], 'testbegriff-1: Erste Antwort | testbegriff-3: Dritte Antwort');
        assert.equal(find(SEED_NAME, 'raster-3j')[6], 'Zeile 1: 00:10 / Aussage eins / → Angebot | Zeile 2: 00:40 /  /  | Befund: Mein Befund');
        assert.equal(find(SEED_NAME, 'spaeter')[5], '–');
        assert.equal(find(SEED_NAME, 'spaeter')[6], '');
        assert.equal(find(MAL_NAME, 'entscheid')[6], MAL_TEXT, 'hostile text is just text in the file');
        assert.doesNotMatch(text, /Geisterantwort|Geister-Paste/);
    });

    await step('(j) a class without `classes` document: "nicht erfasst", all blocks except mitnahme and kn', async () => {
        await choose(tp, CLASS_OHNE);
        assert.match(await tp.locator('#class-info').innerText(), /nicht erfasst/);
        const cols = await columns(tp);
        assert.ok(cols.includes('raster-3j') && cols.includes('raster-4j'), 'unknown variant: no filter');
        assert.ok(!cols.includes('rueckblick') && !cols.includes('kn-fall'));
        assert.deepEqual(await rowNames(tp), ['Ohne Klasse']);
        await tp.waitForFunction(([uid]) => document.querySelector(`button[data-uid="${uid}"][data-block-id="entscheid"]`)?.innerText.includes('7 Wörter'), [OHNE]);
        assert.match(await cell(tp, OHNE, 'entscheid').innerText(), /7 Wörter/);
        assert.equal(await cell(tp, OHNE, 'entscheid').locator('.hko-variante-flag').count(), 0, 'no computed variant: nothing to compare');
    });

    await step('(k) a 4J class gets the 4J column and not the 3J one; deselecting empties the grid', async () => {
        await choose(tp, CLASS_4J);
        const cols = await columns(tp);
        assert.ok(cols.includes('raster-4j') && !cols.includes('raster-3j'));
        await tp.locator('#class-select').selectOption('');
        await tp.waitForFunction(() => document.querySelector('#grid').children.length === 0);
    });

    await step('(l) after a reload the session survives; logout brings the login back', async () => {
        await tp.reload();
        await tp.locator('#login-overlay').waitFor({ state: 'hidden' });
        await tp.locator(`#class-select option[value="${CLASS_3J}"]`).waitFor({ state: 'attached' });
        await tp.locator('#logout-btn').click();
        await tp.locator('#login-overlay.visible').waitFor();
        await tp.waitForFunction(async () => (await import('/js/firebase.js')).auth.currentUser === null);
        assert.equal(await tp.locator('#grid').innerText(), '');
    });

    assert.deepEqual(blocked, [], 'a page requested a host other than the emulators and the Firebase SDK on gstatic');
    assert.equal(await xssFlag(tp), null);
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    server.close();
}

if (!failed) console.log(`\ne2e-hko-dashboard: ${results.length} steps passed. Only the emulators and the Firebase SDK on gstatic were called.`);
process.exit(failed ? 1 : 0);
