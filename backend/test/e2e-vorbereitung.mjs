// Browser test of the preparation page (vorbereitung.html) against the EMULATORS.
// Run: npm run test:e2e:vorbereitung
//   (= emulators:exec --only auth,firestore; this file seeds fictional accounts, fills teacherMaterials
//      with scripts/upload-teacher-materials.mjs --emulator, serves app/ itself and drives the installed Chrome)
//
// Checks (CONTRACT.md, «Teacher materials»): a guest and a student see only the hint and make NO request
// for teacherMaterials (network recorded); a teacher sees the unit list, plan, links, handout (window.print
// intercepted) and vollfassung; too few lessons gives the honest hint. Nothing leaves the emulators except
// the Firebase SDK from gstatic.
// Optional: VB_SCREENS=<dir> writes screenshots (teacher form+plan, handout print view, guest).
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
    if (!LOCAL.test(process.env[name] || '')) {
        console.error(`Refusing to run: ${name} does not point at a local emulator. Run through: npm run test:e2e:vorbereitung`);
        process.exit(1);
    }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = resolve(HERE, '..');
const APP = normalize(join(HERE, '..', '..'));
const PAKET = resolve(APP, '..', 'weiterentwicklung-paket');
const DATA = join(PAKET, 'varianten', 'E-B', 'obsidian');
const PROJECT = 'interactive-media-2a1fc';   // what the page uses (js/config.js)
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';   // emulator only, same default as the seed
const SCREENS = process.env.VB_SCREENS ? resolve(process.env.VB_SCREENS) : null;

// ---- seed + upload -------------------------------------------------------------------------
await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
for (const d of (await box.collection('teacherMaterials').get()).docs) await d.ref.delete();
{
    const r = spawnSync(process.execPath, [join(BACKEND, 'scripts', 'upload-teacher-materials.mjs'), '--emulator'],
        { cwd: BACKEND, encoding: 'utf8', timeout: 120000, env: { ...process.env, GCLOUD_PROJECT: PROJECT } });
    if (r.status !== 0) { console.error(r.stdout + r.stderr); process.exit(1); }
}
// A hostile unit: every string would run or load something if it reached the DOM as HTML.
const XSS = (t) => `<img src="http://xss.invalid/${t}.png" onerror="window.__xss='${t}'">`;
await box.doc('teacherMaterials/EB-9.9.9').set({
    einheitId: 'EB-9.9.9', assignmentId: `LM 9.9.9 Böse ${XSS('aid')}`, generiertAm: '2026-10-25',
    lehrpersonKarten: { zeitmodell: `Zeit ${XSS('zeit')}`, start_im_unterricht: [{ min: 2, schritt: `Start ${XSS('start')}` }],
        karten: {}, jigsaw_plan_b: { wann: `Wann ${XSS('wann')}`, ablauf: [], gruppen: { S: XSS('gruppe') } } },
    hpTeacher: { situation: { lebensbezug: '9.9' }, heft: { bausteine: {} },
        karten: { S: { titel: XSS('titel'), zeit_unterricht: XSS('zu'), ablauf: [{ min: 5, schritt: `Lektion 1: ${XSS('ablauf')}` }] } },
        wege: { formel: XSS('formel'), anzeige_lehrperson: { S: `Schmal ${XSS('name')}`, M: 'Mittel', L: 'Breit' },
            zeit_spanne_min: { S: [10, 20], M: [20, 30], L: [30, 40] }, zeit_hinweis: XSS('hinweis') } },
    vollfassung: [{ id: 'x.y', webcode: XSS('wc'), titel: `Titel ${XSS('vt')}`, text: `**fett** ${XSS('text')}\n\n<script>window.__xss='script'</script>` }],
});

const UNITS = ['5.1.1', '5.1.2', '5.2.1', '5.2.2', '5.3.1', '5.3.2', '5.3.3', '5.4.1', '5.4.2'];
const readJson = (k, f) => JSON.parse(readFileSync(join(DATA, k, f), 'utf8'));
const kurz = JSON.parse(readFileSync(join(PAKET, 'kurzlinks', 'kurzlinks.json'), 'utf8'));
const stored = async (k) => (await box.doc(`teacherMaterials/${encodeURIComponent(`EB-${k}`)}`).get()).data();
const PF = ['S', 'M', 'L'];

// ---- static server --------------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !/^\/(vorbereitung\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/.test(path)) { res.writeHead(404); res.end(); return; }
    try {
        const body = await readFile(file);
        res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' });
        res.end(body);
    } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_PAGE = `http://127.0.0.1:${server.address().port}/vorbereitung.html`;

// ---- helpers ---------------------------------------------------------------------------------
const ALLOWED_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com']);
const blocked = [];
const browserLog = [];
/** Every request that names teacherMaterials (document path in the URL or a runQuery body), with its status. */
const tmRequests = [];
async function newContext(browser, label, opts = {}) {
    const context = await browser.newContext(opts);
    context.setDefaultTimeout(20000);
    await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (!/^https?:$/.test(url.protocol) || ALLOWED_HOSTS.has(url.host.replace(/:\d+$/, ''))) return route.continue();
        blocked.push(route.request().url());
        return route.abort();
    });
    context.on('request', (rq) => {
        const body = rq.postData() || '';
        if (rq.url().includes('teacherMaterials') || body.includes('teacherMaterials')) {
            const entry = { label, url: rq.url(), status: null };
            tmRequests.push(entry);
            rq.response().then((r) => { entry.status = r ? r.status() : 'failed'; }).catch(() => { entry.status = 'failed'; });
        }
    });
    context.on('page', (page) => {
        page.on('pageerror', (e) => browserLog.push(`${label} pageerror: ${e.message}`));
        page.on('console', (m) => { if (m.type() === 'error') browserLog.push(`${label} console: ${m.text()}`); });
    });
    return context;
}
async function login(page, username) {
    await page.locator('#vb-username').fill(username);
    await page.locator('#vb-password').fill(PASSWORD);
    await page.locator('#vb-login-btn').click();
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const text = (page, sel) => page.locator(sel).innerText();
const results = [];
async function step(name, fn) {
    const t = Date.now();
    await fn();
    results.push(name);
    console.log(`ok  ${name}  (${Date.now() - t} ms)`);
}
async function choose(page, { unit, klasse = '4J', lektionen, variante }) {
    if (unit) await page.locator('#vb-einheit').selectOption(`EB-${unit}`);
    await page.locator(`input[name="vb-klasse"][value="${klasse}"]`).check();
    if (lektionen != null) await page.locator('#vb-lektionen').fill(String(lektionen));
    if (variante) await page.locator('#vb-variante').selectOption(variante);
}
const shot = async (page, file, opts = {}) => { if (SCREENS) await page.screenshot({ path: join(SCREENS, file), fullPage: true, ...opts }); };
if (SCREENS) mkdirSync(SCREENS, { recursive: true });

// A unit and a lesson count where the widest variant does not fit but a narrower one does (from the data,
// so a re-render of the spans does not break the test).
function findeVorschlagsfall() {
    for (const k of UNITS) {
        const w = readJson(k, 'hpTeacher.json').wege;
        for (let n = 1; n <= 10; n++) {
            const min = n * 45;
            if (w.zeit_spanne_min.L[1] <= min) continue;
            const p = ['M', 'S'].find((x) => w.zeit_spanne_min[x][1] <= min);
            if (p) return { k, n, p, name: w.anzeige_lehrperson[p] };
        }
    }
    return null;
}

// ---- the run -----------------------------------------------------------------------------------
let failed = false;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    await step('(a) guest: only the hint and a login form, no request for teacherMaterials', async () => {
        const ctx = await newContext(browser, 'guest');
        const page = await ctx.newPage();
        await page.goto(URL_PAGE);
        await page.locator('#vb-gate:not([hidden])').waitFor();
        assert.match(await text(page, '#vb-gate'), /Nur mit Lehrpersonen-Konto/);
        assert.equal(await text(page, '#vb-gate-konto'), 'Ein Konto mit Lehrpersonen-Rolle: bei der Autorin / beim Autor anfragen.');
        assert.ok(await page.locator('#vb-gate-konto').isVisible(), 'Konto-Hinweis sichtbar');
        assert.ok(await page.locator('#vb-login').isVisible(), 'login form');
        assert.ok(await page.locator('#vb-app').isHidden(), 'app hidden');
        await sleep(1500);
        await shot(page, 'vorbereitung-gast.png');
        await ctx.close();
        assert.deepEqual(tmRequests.filter((r) => r.label === 'guest'), []);
    });

    await step('(b) student signed in: hint «keine Lehrpersonen-Rolle», no request for teacherMaterials', async () => {
        const ctx = await newContext(browser, 'student');
        const page = await ctx.newPage();
        await page.goto(URL_PAGE);
        await page.locator('#vb-gate:not([hidden])').waitFor();
        await login(page, 'anna.beispiel');
        await page.locator('#vb-gate-who:not([hidden])').waitFor();
        assert.match(await text(page, '#vb-gate-who'), /keine Lehrpersonen-Rolle/);
        assert.match(await text(page, '#vb-gate'), /Nur mit Lehrpersonen-Konto/);
        assert.ok(await page.locator('#vb-gate-konto').isVisible(), 'Konto-Hinweis sichtbar (Konto ohne Rolle)');
        assert.ok(await page.locator('#vb-app').isHidden(), 'app hidden');
        await sleep(1500);
        await ctx.close();
        assert.deepEqual(tmRequests.filter((r) => r.label === 'student'), []);
    });

    const ctx = await newContext(browser, 'teacher', { permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();

    await step('(c) teacher: the unit list (9 units + 1 test unit) after a successful read', async () => {
        await page.goto(URL_PAGE);
        await page.locator('#vb-gate:not([hidden])').waitFor();
        await login(page, 'tina.test@lernende.bbw.ch');
        await page.locator('#vb-app:not([hidden])').waitFor();
        await page.waitForFunction(() => document.querySelectorAll('#vb-einheit option').length >= 10);
        assert.equal(await page.locator('#vb-einheit option').count(), 10);
        for (const k of UNITS) assert.equal(await page.locator(`#vb-einheit option[value="EB-${k}"]`).count(), 1, k);
        await sleep(300);
        const mine = tmRequests.filter((r) => r.label === 'teacher');
        assert.ok(mine.length >= 1 && mine.every((r) => r.status === 200), JSON.stringify(mine));
    });

    await step('(d) plan: names and spans from hpTeacher.wege, start steps, card steps', async () => {
        const k = '5.1.1';
        const t = readJson(k, 'hpTeacher.json'), kt = readJson(k, 'lehrperson-karten.json');
        const w = t.wege;
        await choose(page, { unit: k, klasse: '4J', lektionen: 4, variante: 'S' });
        await page.locator('#vb-datum').fill('2026-11-02');
        const plan = await text(page, '#vb-plan');
        for (const p of PF) {
            assert.ok(plan.includes(w.anzeige_lehrperson[p]), `name ${p}`);
            assert.ok(plan.includes(`ca. ${w.zeit_spanne_min[p][0]}–${w.zeit_spanne_min[p][1]} min`), `span ${p}`);
        }
        assert.ok(plan.includes(w.zeit_hinweis), 'Schätzung');
        assert.match(plan, /Montag, 2\. November 2026/);
        assert.match(plan, /Klasse 4J/);
        assert.ok(!/\{heft:/.test(plan), 'no raw placeholder');
        assert.ok(!/\bnull\b|\bundefined\b/.test(plan), 'no null/undefined in the plan');
        const fit = await page.locator('#vb-plan .vb-fit').getAttribute('data-fit');
        assert.equal(fit, w.zeit_spanne_min.S[1] <= 180 ? 'passt' : 'keine');   // S has no narrower variant
        // start list + card S
        const lists = page.locator('#vb-plan ol.vb-ablauf');
        assert.equal(await lists.nth(0).locator('li').count(), kt.start_im_unterricht.length, 'start steps');
        assert.equal(await lists.nth(1).locator('li').count(), t.karten.S.ablauf.length, 'card steps');
        assert.match(await lists.nth(1).locator('li').first().innerText(), /L1 · Min\. 0–\d+/);
        // 3J: page numbers note
        await choose(page, { klasse: '3J' });
        assert.match(await text(page, '#vb-plan'), /Klasse 3J/);
        assert.match(await text(page, '#vb-plan'), /Heft 3J/);
        await choose(page, { klasse: '4J' });
        await shot(page, 'vorbereitung-lehrperson-plan.png');
    });

    await step('(e) links: preselection as in the renderer, short link from kurzlinks.json, copy', async () => {
        const k = '5.1.1';
        const ziel = kurz.codes.find((c) => c.art === 'einheit' && c.id === k);
        assert.equal(await page.locator('#vb-link-vorwahl').inputValue(), `${ziel.ziel}#hp=S`);
        assert.equal(await page.locator('#vb-link-kurz').inputValue(), `${kurz.kurz_host}/${ziel.code}`);
        assert.match(await text(page, '#vb-links'), /setzt keine Vorwahl/);
        await page.locator('#vb-links button', { hasText: 'Kopieren' }).first().click();
        await page.locator('#vb-links .vb-copied', { hasText: 'Kopiert' }).waitFor();
        assert.equal(await page.evaluate(() => navigator.clipboard.readText()), `${ziel.ziel}#hp=S`);
        await choose(page, { variante: 'frei' });
        assert.equal(await page.locator('#vb-link-vorwahl').inputValue(), `${ziel.ziel}#hp=frei`);
        assert.equal(await page.locator('#vb-link-frei').count(), 0, 'no second «frei» link when frei is chosen');
        // Wahl-Buttons (26.10.2026): two of three, «#hp=S,M»; with any preselection a separate «frei» link
        const t = readJson(k, 'hpTeacher.json');
        for (const [v, a, b] of [['S,M', 'S', 'M'], ['M,L', 'M', 'L'], ['S,L', 'S', 'L']]) {
            await choose(page, { variante: v });
            assert.equal(await page.locator('#vb-link-vorwahl').inputValue(), `${ziel.ziel}#hp=${v}`, v);
            assert.equal(await page.locator('#vb-link-frei').inputValue(), `${ziel.ziel}#hp=frei`, v);
            const l = await text(page, '#vb-links');
            assert.ok(l.includes(`Wahl zwischen ${t.wege.anzeige_lehrperson[a]} und ${t.wege.anzeige_lehrperson[b]}`), v);
            assert.match(l, /wählen zwischen ihnen/);
            assert.match(await text(page, '#vb-plan'), /Wahl zwischen/);
        }
        await choose(page, { variante: 'S,M' });
        await shot(page, 'vorbereitung-lehrperson-zwei-von-drei.png');
        // every unit: base address equals the target of its short link
        for (const u of UNITS) {
            await choose(page, { unit: u, variante: 'M' });
            const z = kurz.codes.find((c) => c.art === 'einheit' && c.id === u);
            assert.equal(await page.locator('#vb-link-vorwahl').inputValue(), `${z.ziel}#hp=M`, u);
            assert.equal(await page.locator('#vb-link-kurz').inputValue(), `${kurz.kurz_host}/${z.code}`, u);
        }
    });

    await step('(f) handout: start rules, Jigsaw plan B, print button calls window.print', async () => {
        const k = '5.1.1';
        const t = readJson(k, 'hpTeacher.json');
        await choose(page, { unit: k, lektionen: 4, variante: 'M' });
        const ho = await text(page, '#vb-handout');
        assert.match(ho, /Regeln für den Start/);
        assert.match(ho, /Jigsaw-Plan B/);
        assert.match(ho, /Wenn eine Gruppe fehlt/);
        assert.ok(ho.includes(t.wege.anzeige_lehrperson.M), 'variant name in handout');
        assert.equal(await page.locator('#vb-handout ol.vb-ablauf').count(), 3, 'card, start, jigsaw lists');
        await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed += 1; }; });
        await page.locator('#vb-print').click();
        assert.equal(await page.evaluate(() => window.__printed), 1);
        assert.ok(await page.evaluate(() => document.body.classList.contains('vb-druck')));
        await page.emulateMedia({ media: 'print' });
        assert.ok(await page.locator('#vb-plan').isHidden(), 'print: plan hidden');
        assert.ok(await page.locator('#vb-handout').isVisible(), 'print: handout visible');
        await shot(page, 'vorbereitung-handout-druck.png');
        await page.emulateMedia({ media: 'screen' });
    });

    await step('(g) vollfassung: one closed entry per building block, text on opening', async () => {
        for (const k of ['5.1.1', '5.3.3', '5.4.1']) {
            const doc = await stored(k);
            await choose(page, { unit: k });
            const items = page.locator('#vb-voll details.vb-baustein');
            assert.equal(await items.count(), doc.vollfassung.length, k);
            assert.ok(doc.vollfassung.length > 0);
            for (let i = 0; i < doc.vollfassung.length; i++) assert.equal(await items.nth(i).getAttribute('data-id'), doc.vollfassung[i].id);
            assert.equal(await items.first().getAttribute('open'), null, 'closed');
            await items.first().locator('summary').click();
            const first = doc.vollfassung[0].text.split(/\n{2,}/)[0].replace(/\*\*/g, '').slice(0, 60);
            assert.ok((await items.first().locator('.vb-text').innerText()).includes(first), `${k}: text`);
        }
    });

    await step('(h) too few lessons: honest hint and the next narrower variant that fits', async () => {
        const f = findeVorschlagsfall();
        assert.ok(f, 'the data has a unit where only a narrower variant fits');
        await choose(page, { unit: f.k, lektionen: f.n, variante: 'L' });
        const box = page.locator('#vb-plan .vb-fit');
        assert.equal(await box.getAttribute('data-fit'), 'vorschlag');
        assert.match(await box.innerText(), /Passt nicht sicher/);
        assert.equal(await box.locator('[data-vorschlag]').getAttribute('data-vorschlag'), f.p);
        assert.ok((await box.innerText()).includes(f.name));
        await box.locator('button').click();
        assert.equal(await page.locator('#vb-variante').inputValue(), f.p);
        assert.equal(await page.locator('#vb-plan .vb-fit').getAttribute('data-fit'), 'passt');
        // one lesson: nothing fits, nothing invented
        await choose(page, { lektionen: 1, variante: 'S' });
        assert.equal(await page.locator('#vb-plan .vb-fit').getAttribute('data-fit'), 'keine');
        assert.match(await text(page, '#vb-plan .vb-fit'), /Keine schmalere Variante passt in 45 min/);
        await choose(page, { lektionen: 1, variante: 'frei' });
        assert.equal(await page.locator('#vb-plan .vb-fit').getAttribute('data-fit'), 'keine');
    });

    await step('(i) hostile data stays text: nothing runs, nothing is loaded', async () => {
        await choose(page, { unit: '9.9.9', lektionen: 1, variante: 'S' });
        await page.locator('#vb-voll details summary').first().click();
        await sleep(500);
        assert.equal(await page.evaluate(() => window.__xss), undefined);
        assert.equal(await page.locator('main img, main script').count(), 0);
        assert.match(await text(page, '#vb-voll'), /<img src=/);
        assert.equal(await page.locator('#vb-voll strong', { hasText: 'fett' }).count(), 1);
        assert.ok(!blocked.some((u) => u.includes('xss.invalid')), 'no xss host requested');
    });

    await ctx.close();
    assert.deepEqual(blocked, [], 'the page requested hosts other than the emulators and gstatic');
    assert.deepEqual(tmRequests.filter((r) => r.label !== 'teacher'), [], 'only the teacher read teacherMaterials');
} catch (e) {
    failed = true;
    console.error(`\nFAILED after ${results.length} step(s): ${e.stack || e}`);
    if (blocked.length) console.error(`blocked requests:\n  ${blocked.join('\n  ')}`);
    if (browserLog.length) console.error(`browser log (last 15):\n  ${browserLog.slice(-15).join('\n  ')}`);
} finally {
    await browser.close();
    server.close();
}

if (!failed) console.log(`\ne2e-vorbereitung: ${results.length} steps passed; guest and student made no request for teacherMaterials.`);
process.exit(failed ? 1 : 0);
