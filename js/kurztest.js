//
//  js/kurztest.js — bridge for the self-test («Kurztest») on lehrmittel.aburossi.ch.
//  Contract: backend/CONTRACT.md, «Self-test bridge» and `quizProgress`.
//
//  publish.js embeds kurztest.html?parent=<its origin> below the self-test of a unit. This
//  page reuses the LMS Box login (all iframes of one host site share it), shows one line,
//  and reads or writes the student's own `quizProgress` document when asked by postMessage.
//
//  Both directions are checked: a message counts only if it comes from window.parent AND
//  from the allowed origin named in ?parent=; answers go to that origin only, never "*".
//  Without these checks any website could embed this page and read or overwrite the
//  progress of a signed-in student.
//
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { onAuthChange } from './api.js';
import { showLoginDialog, closeLoginDialog, logout } from './auth.js';
import { initEmbedHeight } from './embedHeight.js';

const ALLOWED_PARENTS = ['https://lehrmittel.aburossi.ch'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const SCHOOL = /@lernende\.bbw\.ch$/i;

// Limits as in the rules (firestore.lmsbox.rules, quizOk). Checked here as well, so that a
// refused record gives a message instead of a silent "permission denied".
const MAX_UNIT = 300;
const MAX_TOTAL = 50;
const MAX_HARD = 20;
const MAX_LABEL = 120;
const ISO = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$/;

const line = document.getElementById('kurztest-line');

/** The parent origin from ?parent=, or null when it is not on the list. */
function allowedParent() {
    if (window.parent === window) return null;
    const origin = new URLSearchParams(window.location.search).get('parent');
    if (!origin) return null;
    if (ALLOWED_PARENTS.includes(origin)) return origin;
    // Tests: a local host page, only while this bridge itself runs locally (on the emulators).
    if (LOCAL_HOST.test(window.location.hostname) && LOCAL_ORIGIN.test(origin)) return origin;
    return null;
}

const PARENT = allowedParent();

let user = null;            // { uid, email } | null
let acct = null;            // first 12 hex of SHA-256(uid) for a school account, else null; the uid never leaves this page
let decided = false;        // the stored session is known
let unit = null;            // the unit the page asked for
let lastError = null;

const canSave = () => !!user && SCHOOL.test(user.email || '');

function send(message) {
    window.parent.postMessage(message, PARENT);
}

async function accountTag(uid) {
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(uid)));
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 12);
}

const docId = (u) => `${user.uid}__${encodeURIComponent(u)}`;

function validUnit(u) {
    return typeof u === 'string' && u.length > 0 && u.length <= MAX_UNIT;
}

/** The record in the shape the rules accept, or null. */
function cleanRecord(r) {
    if (!r || typeof r !== 'object' || !r.last || typeof r.last !== 'object') return null;
    const { known, total, date } = r.last;
    if (!Number.isInteger(total) || total < 1 || total > MAX_TOTAL) return null;
    if (!Number.isInteger(known) || known < 0 || known > total) return null;
    if (typeof date !== 'string' || date.length > 40 || !ISO.test(date)) return null;
    if (!Array.isArray(r.hard) || r.hard.length > Math.min(MAX_HARD, total)) return null;
    if (!r.hard.every((h) => typeof h === 'string' && h.length <= MAX_LABEL)) return null;
    return { last: { known, total, date }, hard: [...r.hard] };
}

// ---- the line -----------------------------------------------------------------------

function link(text, onClick) {
    const a = document.createElement('a');
    a.href = '#';
    a.textContent = text;
    a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return a;
}

function render() {
    line.replaceChildren();
    line.dataset.state = !PARENT ? 'off' : !decided ? 'wait' : lastError ? 'error' : canSave() ? 'on' : user ? 'other' : 'guest';
    if (!PARENT) {
        line.textContent = 'Diese Seite gehört zum Kurztest auf lehrmittel.aburossi.ch.';
        return;
    }
    if (!decided) return;
    if (!user) {
        line.append('Dein Fortschritt bleibt nur in diesem Browser. ',
            link('Anmelden', () => showLoginDialog({ closable: true })), ', dann ist er auf jedem Gerät da.');
        return;
    }
    const who = (user.email || '').replace(SCHOOL, '');
    if (!canSave()) {
        line.append(`Mit diesem Konto (${user.email || 'unbekannt'}) wird der Kurztest nicht gesichert. `,
            link('Abmelden', logout));
        return;
    }
    if (lastError) {
        line.append('Nicht gesichert – dein Ergebnis ist nur in diesem Browser. ', link('Abmelden', logout));
        return;
    }
    line.append(`Fortschritt gesichert für ${who} · `, link('Abmelden', logout));
}

// ---- requests from the page --------------------------------------------------------------

async function load(u) {
    let record = null;
    if (canSave()) {
        try {
            const snap = await getDoc(doc(db, 'quizProgress', docId(u)));
            if (snap.exists()) record = cleanRecord(snap.data());
        } catch (error) {
            console.error('quizProgress lesen:', error);
        }
    }
    if (u !== unit) return;     // the page asked for another unit in the meantime
    send({ type: 'kurztest-state', signedIn: canSave(), acct, unit: u, record });
}

async function save(u, raw) {
    const record = cleanRecord(raw);
    if (!canSave()) return send({ type: 'kurztest-saved', unit: u, ok: false, code: 'signed-out' });
    if (!record) return send({ type: 'kurztest-saved', unit: u, ok: false, code: 'invalid' });
    try {
        await setDoc(doc(db, 'quizProgress', docId(u)), {
            uid: user.uid, unit: u, last: record.last, hard: record.hard, updatedAt: serverTimestamp(),
        });
        lastError = null;
        send({ type: 'kurztest-saved', unit: u, ok: true });
    } catch (error) {
        console.error('quizProgress speichern:', error);
        lastError = error?.code || 'error';
        send({ type: 'kurztest-saved', unit: u, ok: false, code: lastError });
    }
    render();
}

function onMessage(event) {
    if (event.source !== window.parent || event.origin !== PARENT) return;
    const data = event.data;
    if (!data || typeof data !== 'object' || !validUnit(data.unit)) return;
    if (data.type === 'kurztest-load') {
        unit = data.unit;
        if (decided) load(unit);    // otherwise answered once the session is known
    } else if (data.type === 'kurztest-save' && data.unit === unit && decided) {
        save(data.unit, data.record);
    }
}

// ---- start --------------------------------------------------------------------------------

initEmbedHeight();
render();
if (PARENT) {
    window.addEventListener('message', onMessage);
    onAuthChange(async (u) => {
        closeLoginDialog();     // also when a sibling iframe did the login
        user = u;
        acct = u && SCHOOL.test(u.email || '') ? await accountTag(u.uid) : null;
        if (user !== u) return;     // changed again while hashing
        decided = true;
        lastError = null;
        render();
        if (unit) load(unit);
        else send({ type: 'kurztest-ready', signedIn: canSave(), acct });
    });
}
