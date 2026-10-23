// Browser test of the HP planner (plan·S|M|L, weiterentwicklung-paket/tools/planer_hp.py) against the EMULATORS:
// the real upload file from content-hp/ goes into lmsbox, a fictional student writes the three planner fields of
// path M, asks for feedback on each, and the request that reaches the (fake) formativ model is checked.
// Run: node scripts/emu.mjs emulators:exec --project interactive-media-2a1fc --only auth,firestore,functions "node test/e2e-planer.mjs"
//   optional: PLANER_FILE=<content-hp json> (default: HP 5.1.1 Recht oder nur Regel), PLANER_PFAD=S|M|L (default M)
//
// Nothing real is called: the callable talks to functions/test/fake-model.js (FORMATIV_URL in functions/.env.local).
// Needs internet only for the CDNs the page loads (gstatic Firebase SDK, Quill). Fictional people and texts only.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { publicCopy } from '../scripts/public-assignment.mjs';

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/;
for (const name of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST', 'FIREBASE_EMULATOR_HUB']) {
    if (!LOCAL.test(process.env[name] || '')) { console.error(`Refusing to run: ${name} is not a local emulator.`); process.exit(1); }
}
const running = await (await fetch(`http://${process.env.FIREBASE_EMULATOR_HUB}/emulators`)).json();
if (!running.functions || !running.auth || !running.firestore) { console.error('auth, firestore and functions emulators must run.'); process.exit(1); }

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = normalize(join(HERE, '..', '..'));
const FILE = process.env.PLANER_FILE
    || join(APP, '..', 'weiterentwicklung-paket', 'content-hp', 'HP 5.1.1 Recht oder nur Regel.json');
const PFAD = process.env.PLANER_PFAD || 'M';

await import('../scripts/seed-emulator.mjs');
const box = getFirestore(getApps()[0], 'lmsbox');
const PASSWORD = process.env.SEED_PASSWORD || 'lmsbox-test-1234';
const enc = encodeURIComponent;

const content = JSON.parse(readFileSync(FILE, 'utf8'));
const A = content.assignmentTitle;
const SUB = `plan·${PFAD}`;
const ASSIGNMENT = { ...content, assignmentId: A };
const sub = ASSIGNMENT.subAssignments[SUB];
assert.ok(sub, `${SUB} fehlt in ${FILE}`);
await box.doc(`assignments/${enc(A)}`).set(ASSIGNMENT);
await box.doc(`publicAssignments/${enc(A)}`).set(publicCopy(ASSIGNMENT));
for (const c of ['drafts', 'formativUsage']) for (const d of (await box.collection(c).get()).docs) await d.ref.delete();

const pub = (await box.doc(`publicAssignments/${enc(A)}`).get()).data();
assert.ok(!JSON.stringify(pub).includes('rubrik'), 'the public copy carries no rubric');
assert.ok(!JSON.stringify(pub).includes('Musterlösungen der Lehrperson'), 'the public copy carries no context');

const envLocal = readFileSync(join(HERE, '..', 'functions', '.env.local'), 'utf8');
const modelUrl = new URL(/^FORMATIV_URL=(.+)$/m.exec(envLocal)[1].trim());
const { startFakeModel } = createRequire(import.meta.url)('../functions/test/fake-model.js');
const model = await startFakeModel({ port: Number(modelUrl.port) });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const SERVED = /^\/(index\.html|js\/[\w.-]+\.js|css\/[\w.-]+\.css)$/;
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const file = normalize(join(APP, path));
    if (!file.startsWith(APP + sep) || !SERVED.test(path)) { res.writeHead(404); res.end(); return; }
    try { res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': 'no-store' }); res.end(await readFile(file)); }
    catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const URL_ = `http://127.0.0.1:${server.address().port}/index.html?assignmentId=${enc(A)}&subId=${enc(SUB)}`;

const ALLOWED = new Set(['127.0.0.1', 'localhost', '[::1]', 'www.gstatic.com', 'cdn.quilljs.com']);
const blocked = [], log = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
let ok = false;
try {
    const ctx = await browser.newContext();
    ctx.setDefaultTimeout(20000);
    await ctx.route('**/*', (route) => {
        const u = new URL(route.request().url());
        if (!/^https?:$/.test(u.protocol) || ALLOWED.has(u.hostname)) return route.continue();
        blocked.push(route.request().url()); return route.abort();
    });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => log.push(`pageerror: ${e.message}`));
    await page.goto(URL_);
    await page.locator('#guest-login').click();
    await page.locator('#auth-username').fill('anna.beispiel');
    await page.locator('#auth-password').fill(PASSWORD);
    await page.locator('#auth-login-btn').click();
    await page.locator('#auth-user').waitFor();
    await page.locator('.ql-editor').first().waitFor();

    const n = await page.locator('.ql-editor').count();
    assert.equal(n, 3, 'three planner fields');
    const pageText = await page.locator('body').innerText();
    for (const q of sub.questions) assert.ok(pageText.includes(q.text.replace(/\*\*/g, '').slice(0, 40)), `field text shown: ${q.id}`);
    try { await page.locator('.formativ-button').nth(2).waitFor({ timeout: 15000 }); }
    catch {
        const st = await page.evaluate(async (a) => {
            const api = await import('/js/api.js');
            try { return { ok: await api.getFormativStatus(a) }; } catch (e) { return { code: e.code, msg: String(e.message) }; }
        }, A);
        console.log('  boxFormativStatus:', JSON.stringify(st));
    }
    assert.equal(await page.locator('.formativ-button').count(), 3, 'feedback button under every field');

    const TEXTE = [
        'Mein Board ist für die Klasse und meinen Kollegen, der behauptet, ab achtzehn sei alles anders. Danach sollen alle wissen, was sich wirklich ändert. Heute plane ich die Karten, gebaut wird im Unterricht.',
        'Erstens ist jeder Mensch rechtsfähig, egal wie alt (S. 25). Zweitens braucht es für die Handlungsfähigkeit Volljährigkeit und Urteilsfähigkeit (S. 25). Drittens wird ein Antragsdelikt nur auf Antrag verfolgt (S. 102).',
        'Ob ich mit siebzehn für den Betrieb unterschreiben darf, sagt das Lehrmittel nicht; es sagt nur, dass juristische Personen durch Organe handeln. Meine Frage an die Lehrperson: Gilt die Unterschrift dann für den Betrieb?',
    ];
    for (let i = 0; i < 3; i++) {
        await page.locator('.ql-editor').nth(i).click();
        await page.keyboard.type(TEXTE[i]);
    }
    await page.waitForTimeout(2500);   // autosave
    for (let i = 0; i < 3; i++) {
        await page.locator('.formativ-button').nth(i).click();
        await page.locator('.formativ-panel').nth(i).waitFor();
    }
    const panels = await page.locator('.formativ-panel').allInnerTexts();
    assert.equal(model.calls.length, 3, 'one model request per field');
    const erwartet = [['adressat', 'machbarkeit'], ['wissensbezug', 'belege'], ['mehrdeutigkeit', 'offene_frage']];
    model.calls.forEach((c, i) => {
        const b = c.body;
        assert.deepEqual(b.rubrik.map((k) => k.id), erwartet[i], `rubric of field ${i + 1}`);
        assert.equal(b.rubrik_version, 'hp-plan-v1');
        assert.ok(b.kontext && b.kontext.includes('Situation') && b.kontext.length <= 8000, 'context from the planner, not a model answer');
        assert.ok(b.mehrdeutig, 'ambiguity of the situation goes along');
        assert.doesNotMatch(JSON.stringify(b), /Anna|seed-anna|\bTestA\b/, 'no name, uid or class');
        assert.ok(panels[i].includes(sub.questions[i].formativ.rubrik[0].label), `panel ${i + 1} shows the rubric labels`);
    });
    console.log(`  ${SUB}: 3 Felder, 3 Rückmeldungen; Rubriken ${erwartet.map((e) => e.join('+')).join(' · ')}`);
    console.log(`  Kontext an formativ: ${model.calls.map((c) => c.body.kontext.length).join(' / ')} Zeichen; Panel 2: ${panels[1].replace(/\s+/g, ' ').slice(0, 140)}`);
    assert.deepEqual(blocked, [], 'no outside request');
    assert.deepEqual(log, [], 'no page error');
    ok = true;
} finally {
    await browser.close();
    server.close();
    await model.close?.();
    if (blocked.length) console.log('blocked:', blocked);
    if (log.length) console.log(log.join('\n'));
}
console.log(ok ? `e2e-planer: ok (${A}, ${SUB})` : 'e2e-planer: FEHLER');
process.exit(ok ? 0 : 1);
