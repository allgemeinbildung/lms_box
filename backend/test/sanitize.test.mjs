// Unit test of dashboard/modules/sanitize.js. The module needs a DOM (it parses HTML into an
// inert <template>), so the cases run in the installed Chrome, not in Node.
//
//   node test/sanitize.test.mjs        (from backend/; no emulators, no network: the two
//                                       requests of the page are answered from this file)
//
// e2e-dashboard.mjs runs the same cases as one of its steps (`sanitizerCases`).
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const X = (tag) => `window.__xss='${tag}'`;

// [name, input, expected output of sanitizeAnswerHtml]
const EXACT = [
    ['paragraph, bold, italic, underline, strike', '<p>Hallo <strong>fett</strong> <em>kursiv</em> <u>u</u> <s>s</s> <b>b</b> <i>i</i></p>', null],
    ['empty Quill paragraph', '<p><br></p>', null],
    ['lists with Quill indent', '<ol><li>eins</li><li class="ql-indent-1">zwei</li></ol><ul><li>punkt</li></ul>', null],
    ['headings, quote, code, sub, sup', '<h2>Titel</h2><blockquote>Zitat</blockquote><pre class="ql-syntax">x = 1</pre><p>H<sub>2</sub>O m<sup>2</sup> <code>c</code></p>', null],
    ['only Quill classes survive', '<p class="ql-align-center visible ql-editor student-card">x</p>', '<p class="ql-align-center">x</p>'],
    ['span keeps its text, loses style and id', '<p><span style="color:red" id="login-overlay" class="ql-size-large">gross</span></p>', '<p><span class="ql-size-large">gross</span></p>'],
    ['img with onerror', `<p>a</p><img src="x" onerror="${X('img')}">`, '<p>a</p>'],
    ['svg with onload', `<svg onload="${X('svg')}"><circle r="1"></circle><script>${X('svgscript')}</script></svg><p>a</p>`, '<p>a</p>'],
    ['javascript: link is unwrapped', `<a href="javascript:${X('href')}">klick</a>`, 'klick'],
    ['obfuscated javascript: link', `<a href=" Java&#9;Script:${X('href2')}">klick</a>`, 'klick'],
    ['data: link', `<a href="data:text/html,<script>${X('data')}</script>">klick</a>`, 'klick'],
    ['relative link', '<a href="/dashboard/liveview.html">klick</a>', 'klick'],
    ['http link keeps href only', `<a href=" https://example.org/a?b=1&c=2 " onclick="${X('aclick')}" style="x:y" target="_top" name="n">ok</a>`,
        '<a href="https://example.org/a?b=1&amp;c=2" rel="noopener noreferrer" target="_blank">ok</a>'],
    ['mailto link', '<a href="mailto:tina.test@example.org">Mail</a>', '<a href="mailto:tina.test@example.org" rel="noopener noreferrer" target="_blank">Mail</a>'],
    ['event handlers, style, id, data-* on an allowed tag',
        `<p onclick="${X('click')}" ONMOUSEOVER="${X('over')}" onfocus="${X('focus')}" tabindex="0" style="background:url(javascript:${X('css')})" id="x" data-student-name="y" contenteditable>t</p>`, '<p>t</p>'],
    ['style element and style attribute', '<style>*{display:none}</style><p style="position:fixed;inset:0">s</p>', '<p>s</p>'],
    ['script element', `<script>${X('script')}</script>ok<script src="http://xss.invalid/s.js"></script>`, 'ok'],
    ['iframe, object, embed', `<iframe srcdoc="<script>parent.__xss='iframe'</script>"></iframe><object data="http://xss.invalid/o"></object><embed src="http://xss.invalid/e">z`, 'z'],
    ['math', `<math><mtext><img src="x" onerror="${X('math')}"></mtext><mi xlink:href="javascript:1">m</mi></math>z`, 'z'],
    ['form with clobbering names', `<form action="javascript:${X('form')}" id="f"><input name="childNodes"><input name="nodeType"><input name="localName"><button formaction="javascript:${X('fa')}">b</button></form>z`, 'z'],
    ['clobbering names outside a form', '<img name="body"><img name="head"><img name="documentElement"><p>bleibt</p>', '<p>bleibt</p>'],
    ['media, input, link, meta, base', `<video src="x" onerror="${X('video')}"></video><audio src="x"></audio><input autofocus onfocus="${X('input')}"><link rel="stylesheet" href="http://xss.invalid/c.css"><meta http-equiv="refresh" content="0;url=http://xss.invalid/"><base href="http://xss.invalid/">z`, 'z'],
    ['details with ontoggle', `<details open ontoggle="${X('toggle')}"><summary>s</summary>t</details>z`, 'z'],
    ['template', `<template><img src="x" onerror="${X('template')}"></template>z`, 'z'],
    ['wrappers are unwrapped', '<div><p>in div</p></div><table><tbody><tr><td>zelle</td></tr></tbody></table><font color="red">rot</font>', '<p>in div</p>zellerot'],
    ['comment', `a<!-- <img src=x onerror=${X('comment')}> -->b`, 'ab'],
    ['text is escaped again', '1 &lt; 2 &amp; "x" &lt;img src=x onerror=1&gt;', '1 &lt; 2 &amp; "x" &lt;img src=x onerror=1&gt;'],
    ['noscript mXSS', `<noscript><p title="</noscript><img src=x onerror=${X('noscript')}>">`, ''],
    ['null', null, ''],
    ['undefined', undefined, ''],
    ['number', 42, '42'],
];

// Known mutation-XSS shapes and broken markup: no exact expectation, only the invariants below.
const INVARIANT_ONLY = [
    `<math><mtext><table><mglyph><style><!--</style><img title="--&gt;&lt;img src=1 onerror=${X('mxss1')}&gt;">`,
    `<svg><style><img src=x onerror=${X('mxss2')}></style></svg>`,
    `<form><math><mtext></form><form><mglyph><style></math><img src onerror=${X('mxss3')}>`,
    `<p><a href="https://example.org/"><a href="javascript:${X('nested')}">x</a></a>`,
    `<b><p></b><i onclick="${X('adoption')}">y</p></i>`,
    `<xmp><img src=x onerror=${X('xmp')}></xmp><plaintext><img src=x onerror=${X('plain')}>`,
    `<textarea><img src=x onerror=${X('ta')}></textarea><title><img src=x onerror=${X('title')}></title>`,
    `<a href="https://example.org/" href="javascript:${X('dup')}">dup</a><a href="vbscript:${X('vb')}">v</a>`,
    `<p class="ql-indent-1&quot; onclick=&quot;${X('classbreak')}">k</p>`,
    `${'<b>'.repeat(400)}tief${'</b>'.repeat(400)}`,
    `${'<div>'.repeat(300)}<img src=x onerror=${X('deep')}>tiefer${'</div>'.repeat(300)}`,
];

/**
 * Runs the cases in `page`. `origin` must serve dashboard/modules/sanitize.js under
 * /dashboard/modules/sanitize.js. Returns the number of inputs checked.
 */
export async function sanitizerCases(page, origin) {
    const blank = `${origin}/__sanitize_test__.html`;
    await page.route(blank, (route) => route.fulfill({ contentType: 'text/html', body: '<!DOCTYPE html><title>sanitize</title><body></body>' }));
    await page.goto(blank);

    const inputs = [...EXACT.map((c) => c[1]), ...INVARIANT_ONLY];
    const got = await page.evaluate(async ([moduleUrl, list]) => {
        const s = await import(moduleUrl);
        const ALLOWED = ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup', 'ol', 'ul', 'li',
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'span', 'a'];
        const violations = (root) => {
            const bad = [];
            for (const el of root.querySelectorAll('*')) {
                if (!ALLOWED.includes(el.localName) || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') bad.push(`<${el.localName}>`);
                for (const a of el.attributes) {
                    const ok = a.name === 'class' ? /^(ql-[a-z0-9-]+)( ql-[a-z0-9-]+)*$/.test(a.value)
                        : el.localName === 'a' && a.name === 'href' ? /^(https?:\/\/|mailto:|tel:)/i.test(a.value)
                        : el.localName === 'a' && a.name === 'rel' ? a.value === 'noopener noreferrer'
                        : el.localName === 'a' && a.name === 'target' ? a.value === '_blank'
                        : false;
                    if (!ok) bad.push(`<${el.localName} ${a.name}="${a.value}">`);
                }
            }
            return bad;
        };

        // Control: the same page does run a handler when markup is inserted unsanitised.
        const control = document.createElement('div');
        document.body.appendChild(control);
        control.innerHTML = '<img src="data:image/png;base64,AA==" onerror="window.__control=1">';
        await new Promise((r) => setTimeout(r, 300));
        control.remove();

        const out = [];
        for (const input of list) {
            const html = s.sanitizeAnswerHtml(input);
            // 1. the fragment, attached to the live document (this is how the dashboard shows an answer)
            const live = document.createElement('div');
            document.body.appendChild(live);
            live.replaceChildren(s.sanitizeAnswerFragment(input));
            live.querySelectorAll('*').forEach((el) => {
                el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
                // a kept link is a real http(s)/mailto link: clicking it would only open that address
                if (el.localName !== 'a' && !el.closest('a')) el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            // 2. the string, re-parsed by innerHTML in the live document (this is how the print window gets it)
            const reparsed = document.createElement('div');
            document.body.appendChild(reparsed);
            reparsed.innerHTML = html;
            out.push({
                html,
                fragmentHtml: live.innerHTML,
                again: s.sanitizeAnswerHtml(html),
                text: live.textContent,
                bad: [...violations(live), ...violations(reparsed)],
            });
        }
        await new Promise((r) => setTimeout(r, 500));   // time for anything that would load or fire
        return {
            out,
            xss: window.__xss ?? null,
            control: window.__control ?? null,
            escape: s.escapeHtml(`<img src=x onerror="a('b')"> & \`c\``),
            escapeEmpty: [s.escapeHtml(null), s.escapeHtml(undefined), s.escapeHtml(0)],
            attribute: (() => { const d = document.createElement('div'); d.innerHTML = `<input value="${s.escapeHtml('"><img src=x onerror=window.__xss=1>')}" title='${s.escapeHtml("'><img src=x onerror=window.__xss=2>")}'>`; return [d.childElementCount, d.firstChild.value, d.firstChild.title]; })(),
            markdown: s.safeMarkdown('**fett** und *kursiv* <img src=x onerror=window.__xss=3> **<b onclick=x>**'),
        };
    }, [`${origin}/dashboard/modules/sanitize.js`, inputs]);

    assert.equal(got.control, 1, 'control: an unsanitised onerror handler does run in this page (the test can see an execution)');
    assert.equal(got.xss, null, `a payload was executed: ${got.xss}`);

    EXACT.forEach(([name, input, expected], i) => {
        assert.equal(got.out[i].html, expected === null ? input : expected, `sanitizeAnswerHtml: ${name}`);
    });
    inputs.forEach((input, i) => {
        const r = got.out[i];
        const label = String(input).slice(0, 60);
        assert.deepEqual(r.bad, [], `forbidden element or attribute after sanitising: ${label}`);
        assert.equal(r.fragmentHtml, r.html, `fragment and string agree: ${label}`);
        assert.equal(r.again, r.html, `sanitising twice changes nothing: ${label}`);
    });
    const deep = got.out[EXACT.length + INVARIANT_ONLY.length - 2];
    assert.equal(deep.text, 'tief', 'deep nesting keeps the text');
    assert.equal(got.out.at(-1).text, 'tiefer');

    assert.equal(got.escape, '&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt; &amp; &#96;c&#96;');
    assert.deepEqual(got.escapeEmpty, ['', '', '0']);
    assert.deepEqual(got.attribute, [1, '"><img src=x onerror=window.__xss=1>', "'><img src=x onerror=window.__xss=2>"], 'escapeHtml holds inside quoted attributes');
    assert.equal(got.markdown, '<b>fett</b> und <i>kursiv</i> &lt;img src=x onerror=window.__xss=3&gt; <b>&lt;b onclick=x&gt;</b>');

    await page.unroute(blank);
    return inputs.length;
}

// ---- stand-alone run -----------------------------------------------------------------------

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
    const { chromium } = await import('playwright-core');
    const MODULE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'dashboard', 'modules', 'sanitize.js');
    const ORIGIN = 'http://sanitize.test';
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    let failed = false;
    try {
        const context = await browser.newContext();
        const outside = [];
        await context.route('**/*', async (route) => {
            const url = route.request().url();
            if (url === `${ORIGIN}/dashboard/modules/sanitize.js`) {
                return route.fulfill({ contentType: 'text/javascript; charset=utf-8', body: await readFile(MODULE, 'utf8') });
            }
            if (/^https?:/.test(url)) { outside.push(url); return route.abort(); }
            return route.continue();
        });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        const n = await sanitizerCases(page, ORIGIN);
        assert.deepEqual(errors, [], 'no script error in the page');
        assert.deepEqual(outside, [], 'nothing was requested from the network');
        console.log(`sanitize: ${n} inputs passed (exact output, allow-list invariant, idempotence, nothing executed, nothing fetched).`);
    } catch (e) {
        failed = true;
        console.error(`FAILED: ${e.stack || e}`);
    } finally {
        await browser.close();
    }
    process.exit(failed ? 1 : 0);
}
