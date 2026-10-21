// Tells the host page (Obsidian Publish) how much the student has written in this
// sub-assignment: { type: 'lmsbox-progress', assignmentId, subId, lengths, acct }.
// publish.js ticks the section off from it (lernansicht). Contract: CONTRACT.md, «Progress message».
//
// Only numbers leave this page: the length of the plain text per question, never the
// text, and no name or uid (`acct` is the first 12 hex characters of SHA-256(uid), like
// the self-test bridge, so a shared computer can tell two students apart). The message
// goes to the host page's own origin only, never to "*", and only if that origin is on
// the list. Without an allowed host page (a page opened on its own, an old embed) nothing happens.

const ALLOWED_PARENTS = ['https://lehrmittel.aburossi.ch'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const MESSAGE_TYPE = 'lmsbox-progress';
const DELAY_MS = 600;

let acctPromise = Promise.resolve(null);

/** The host page's origin, or null when this page is not framed by an allowed one. */
export function parentOrigin() {
    if (window.parent === window) return null;
    const own = new URLSearchParams(window.location.search).get('parent');
    let referrer = null;
    try { referrer = document.referrer ? new URL(document.referrer).origin : null; } catch { /* no referrer */ }
    // ancestorOrigins is the reliable one (Chrome, Safari); the referrer is the fallback (Firefox).
    const candidates = [window.location.ancestorOrigins?.[0], referrer, own].filter(Boolean);
    for (const origin of candidates) {
        if (ALLOWED_PARENTS.includes(origin)) return origin;
        if (LOCAL_HOST.test(window.location.hostname) && LOCAL_ORIGIN.test(origin)) return origin;
    }
    return null;
}

async function accountTag(uid) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid)));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

/** Call once after sign-in (uid) or as a guest (null). */
export function initProgress(uid) {
    acctPromise = uid && window.crypto?.subtle ? accountTag(uid).catch(() => null) : Promise.resolve(null);
}

/**
 * Starts reporting for the editors of this page: once now (what was loaded) and after
 * every change, a little later. `editors` is the list in renderer.js.
 */
export function watchProgress(assignmentId, subId, editors) {
    const target = parentOrigin();
    if (!target) return;

    let timer = null;
    async function report() {
        timer = null;
        const lengths = editors.map(({ quill }) => quill.getText().trim().length);
        const acct = await acctPromise;
        window.parent.postMessage({ type: MESSAGE_TYPE, assignmentId, subId, lengths, acct }, target);
    }
    const schedule = () => { if (timer === null) timer = setTimeout(report, DELAY_MS); };

    for (const { quill } of editors) quill.on('text-change', schedule);
    schedule();
}
