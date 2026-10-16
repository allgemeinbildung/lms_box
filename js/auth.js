//
//  js/auth.js — login with the Lernportal account (username + password).
//
//  Without a session the page runs as a guest (CONTRACT.md, guest mode): the
//  assignment is shown, answers stay in this browser, and the login dialog opens
//  only when asked for.
//
//  The session lives in the browser (Firebase Auth, kept across reloads) and is
//  shared by every iframe of this page on the same host page: when one of them
//  signs in, the others are told through the auth state and close their dialog.
//
import { signIn, signOut, onAuthChange, getStudent } from './api.js';
import * as storage from './storage.js';
import { flushPendingSave, hasUnsavedEdits, hasUnsyncedWork, suspendSaving, resumeSaving, closeSaving } from './renderer.js';

// ---- further places that save (additive, backend/HKO.md "Phase P1 - Vertrag" §7) ---------
//
// renderer.js is the saver of index.html. Another page (hko.html, js/hko/save.js) registers
// its own: { flush, hasUnsaved, hasUnsynced, suspend, resume, close } - the same six things
// renderer.js offers. Every place below asks renderer.js AND the registered savers. Nothing
// registered (every lms_box page): exactly the behaviour before.
const savers = [];
export function registerSaver(s) { if (s && !savers.includes(s)) savers.push(s); }
function eachSaver(name) {
    for (const s of savers) {
        try { s[name]?.(); } catch (error) { console.error(`saver.${name}:`, error); }
    }
}
const saversUnsaved = () => savers.some((s) => { try { return !!s.hasUnsaved?.(); } catch { return false; } });
async function saversUnsynced() {
    for (const s of savers) {
        try { if (await s.hasUnsynced?.()) return true; } catch { /* unreadable: nothing to lose there */ }
    }
    return false;
}
const suspendAll = () => { suspendSaving(); eachSaver('suspend'); };
const resumeAll = () => { resumeSaving(); eachSaver('resume'); };
const closeAll = () => { closeSaving(); eachSaver('close'); };
const unsavedHere = () => hasUnsavedEdits() || saversUnsaved();

/** The first login (start password -> own password) is handled by the Lernportal, not here. */
const LOGIN_HELP_URL = 'https://allgemeinbildung.web.app/login';
const LAST_UID_KEY = 'lmsbox-last-uid';       // whose answers the IndexedDB cache holds (a uid, no name)
const OLD_KEY_STORAGE = 'student-auth-key';   // student key of the old system; removed when seen

const LOGIN_ERRORS = {
    'auth/invalid-credential': 'Benutzername oder Passwort ist falsch.',
    'auth/wrong-password': 'Benutzername oder Passwort ist falsch.',
    'auth/user-not-found': 'Benutzername oder Passwort ist falsch.',
    'auth/invalid-email': 'Benutzername oder Passwort ist falsch.',
    'auth/user-disabled': 'Dieses Konto ist gesperrt. Wende dich an deine Lehrperson.',
    'auth/too-many-requests': 'Zu viele Versuche. Warte einen Moment und versuche es dann erneut.',
    'auth/network-request-failed': 'Keine Verbindung. Prüfe dein Internet und versuche es erneut.',
};

let reloading = false;
function reload() {
    if (reloading) return;
    reloading = true;
    window.location.reload();
}

function el(tag, style, text) {
    const e = document.createElement(tag);
    if (style) e.style.cssText = style;
    if (text !== undefined) e.textContent = text;   // names and addresses are never set as HTML
    return e;
}

function helpLink(text) {
    const a = el('a', 'color: #007bff;', text);
    a.href = LOGIN_HELP_URL;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
}

// ---- login dialog -----------------------------------------------------------------

export function closeLoginDialog() {
    document.getElementById('auth-dialog')?.remove();
}

/**
 * `closable`: a guest may close the dialog and go on without an account.
 * Exported (with closeLoginDialog) for the self-test bridge, js/kurztest.js (CONTRACT.md).
 */
export function showLoginDialog({ closable = false } = {}) {
    if (document.getElementById('auth-dialog')) return;

    const dialog = document.createElement('div');
    dialog.id = 'auth-dialog';
    dialog.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background-color: rgba(0,0,0,0.7); display: flex;
        justify-content: center; align-items: flex-start; z-index: 3000; font-family: inherit;
        overflow-y: auto; padding: 10px; box-sizing: border-box;
    `;

    // Compact: the page sits in a 600px iframe on Obsidian Publish, and the dialog has to fit with room to spare.
    const inputStyle = 'width: 100%; padding: 7px 10px; margin: 2px 0 0.6em 0; border: 2px solid #ddd; border-radius: 6px; box-sizing: border-box; font-size: 1em;';
    const labelStyle = 'display: block; color: #333; font-size: 0.85em; font-weight: bold;';
    dialog.innerHTML = `
        <form id="auth-form" style="background: white; padding: 1em 1.25em; border-radius: 12px; text-align: left; width: 100%; max-width: 420px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); line-height: 1.4; margin: auto;">
            <h3 style="margin: 0; text-align: center; color: #333; font-size: 1.15em;">Anmeldung</h3>
            <p style="margin: 0.2em 0 0.8em 0; text-align: center; color: #555; font-size: 0.9em;">Mit deinem Lernportal-Konto</p>

            <label for="auth-username" style="${labelStyle}">Benutzername</label>
            <input type="text" id="auth-username" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="vorname.nachname" style="${inputStyle}">

            <label for="auth-password" style="${labelStyle}">Passwort</label>
            <input type="password" id="auth-password" autocomplete="current-password" style="${inputStyle}">

            <button type="submit" id="auth-login-btn" style="width: 100%; padding: 9px; background-color: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em; transition: background 0.2s;">Anmelden</button>
            <p id="auth-status" role="alert" style="color: #d9534f; min-height: 1.2em; margin: 0.4em 0; text-align: center; font-size: 0.85em;"></p>

            <p id="auth-links" style="margin: 0; text-align: center; font-size: 0.8em; color: #555;">
                <a id="auth-forgot" href="#" role="button" aria-controls="auth-forgot-help" aria-expanded="false" style="color: #007bff;">Passwort vergessen?</a>
                &middot; Erste Anmeldung? Passwort zuerst
                <a id="auth-first-login" href="${LOGIN_HELP_URL}" target="_blank" rel="noopener" style="color: #007bff;">im Lernportal</a> setzen.
            </p>
            <p id="auth-forgot-help" hidden style="margin: 0.6em 0 0 0; padding: 0.6em 0.8em; background: #f8f9fa; border-left: 4px solid #007bff; font-size: 0.85em; color: #333;">Melde dich bei deiner Lehrperson. Sie schickt dir einen Link, mit dem du selbst ein neues Passwort setzt, oder gibt dir ein Startpasswort.</p>
            ${closable ? '<p style="margin: 0.6em 0 0 0; text-align: center; font-size: 0.85em;"><a id="auth-close" href="#" role="button" style="color: #6c757d;">Ohne Anmeldung weiter</a></p>' : ''}
        </form>
    `;
    document.body.appendChild(dialog);

    const form = dialog.querySelector('#auth-form');
    const userInput = dialog.querySelector('#auth-username');
    const passInput = dialog.querySelector('#auth-password');
    const loginBtn = dialog.querySelector('#auth-login-btn');
    const statusEl = dialog.querySelector('#auth-status');
    const forgotLink = dialog.querySelector('#auth-forgot');
    const forgotHelp = dialog.querySelector('#auth-forgot-help');

    // No self-service reset: Firebase's reset mails do not reach @lernende.bbw.ch (tested
    // 15.10.2026). The teacher sends a reset link (Lernportal, "Reset-Link") or a start password.
    forgotLink.addEventListener('click', (e) => {
        e.preventDefault();
        forgotHelp.hidden = !forgotHelp.hidden;
        forgotLink.setAttribute('aria-expanded', String(!forgotHelp.hidden));
    });

    dialog.querySelector('#auth-close')?.addEventListener('click', (e) => {
        e.preventDefault();
        closeLoginDialog();
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = userInput.value.trim();
        const password = passInput.value;
        if (!username || !password) {
            statusEl.textContent = 'Bitte gib Benutzername und Passwort ein.';
            return;
        }
        statusEl.textContent = '';
        loginBtn.disabled = true;
        loginBtn.textContent = 'Anmelden …';
        try {
            await signIn(username, password);
            // Success: the auth state changes, authenticate() closes this dialog.
        } catch (error) {
            statusEl.textContent = LOGIN_ERRORS[error.code] || 'Anmeldung fehlgeschlagen. Bitte versuche es erneut.';
            loginBtn.disabled = false;
            loginBtn.textContent = 'Anmelden';
            passInput.select();
        }
    });
}

// ---- signed in, but no assignment to show -----------------------------------------

function logoutLink() {
    const a = el('a', 'color: #007bff; cursor: pointer;', 'Abmelden');
    a.href = '#';
    a.className = 'auth-logout';
    a.addEventListener('click', (e) => { e.preventDefault(); logout(); });
    return a;
}

/** Replaces the assignment area by a message. `build(box)` adds the content. */
function showNotice(build) {
    const actions = document.getElementById('action-container');
    if (actions) actions.style.display = 'none';
    document.getElementById('sub-title').textContent = 'Anmeldung';
    const box = el('div', 'background: #fff8e1; border-left: 4px solid #f0ad4e; padding: 0.8em 1em; border-radius: 4px; font-size: 0.95em;');
    box.id = 'auth-notice';
    build(box);
    document.getElementById('content-renderer').replaceChildren(box);
}

function showMustSetPassword(name) {
    showNotice((box) => {
        box.dataset.reason = 'must-set-password';
        box.appendChild(el('p', 'margin: 0 0 0.6em 0; font-weight: bold;', `Hallo ${name}, du musst zuerst dein eigenes Passwort setzen.`));
        const p = el('p', 'margin: 0 0 0.6em 0;', 'Du bist noch mit dem Start-Passwort angemeldet. Setze ');
        p.append(helpLink('im Lernportal'), ' dein eigenes Passwort und lade danach diese Seite neu. Erst dann kannst du den Auftrag bearbeiten.');
        box.appendChild(p);
        const again = el('a', 'color: #007bff; cursor: pointer;', 'Seite neu laden');
        again.href = '#';
        again.addEventListener('click', (e) => { e.preventDefault(); reload(); });
        const row = el('p', 'margin: 0;');
        row.append(again, ' · ', logoutLink());
        box.appendChild(row);
    });
}

function showNoStudent(email) {
    showNotice((box) => {
        box.dataset.reason = 'no-student';
        box.appendChild(el('p', 'margin: 0 0 0.6em 0; font-weight: bold;', 'Mit diesem Konto kannst du hier keine Aufträge bearbeiten.'));
        box.appendChild(el('p', 'margin: 0 0 0.6em 0;', `Du bist als ${email} angemeldet. Dieses Konto steht in keiner Klassenliste – die Aufträge sind für Lernende. Melde dich ab und mit deinem Lernenden-Konto wieder an.`));
        const row = el('p', 'margin: 0;');
        row.append(logoutLink());
        box.appendChild(row);
    });
}

function showAccountError() {
    showNotice((box) => {
        box.dataset.reason = 'account-error';
        box.appendChild(el('p', 'margin: 0 0 0.6em 0; font-weight: bold;', 'Dein Konto konnte nicht geladen werden.'));
        box.appendChild(el('p', 'margin: 0 0 0.6em 0;', 'Prüfe deine Internetverbindung und lade die Seite neu.'));
        const again = el('a', 'color: #007bff; cursor: pointer;', 'Seite neu laden');
        again.href = '#';
        again.addEventListener('click', (e) => { e.preventDefault(); reload(); });
        const row = el('p', 'margin: 0;');
        row.append(again, ' · ', logoutLink());
        box.appendChild(row);
    });
}

// ---- signed in: name and logout, small, next to the PDF button -------------------------

function showUser(name) {
    const actions = document.getElementById('action-container');
    if (!actions || document.getElementById('auth-user')) return;
    const span = el('span', 'float: right; font-size: 0.8em; color: #6c757d; line-height: 2.8;');
    span.id = 'auth-user';
    const link = logoutLink();
    link.id = 'auth-logout';
    link.style.color = '#6c757d';
    span.append(el('span', '', name), ' · ', link);
    actions.appendChild(span);
}

// ---- not signed in: a short line above the assignment ------------------------------------

function showGuest() {
    if (document.getElementById('guest-banner')) return;
    const box = el('p', 'margin: 0 0 0.6em 0; padding: 0.4em 0.7em; background: #f8f9fa; border-left: 4px solid #6c757d; border-radius: 4px; font-size: 0.85em; color: #333;');
    box.id = 'guest-banner';
    const login = el('a', 'color: #007bff; cursor: pointer; font-weight: bold;', 'Anmelden');
    login.href = '#';
    login.id = 'guest-login';
    login.addEventListener('click', (e) => { e.preventDefault(); showLoginDialog({ closable: true }); });
    box.append('Nicht angemeldet: Deine Antworten bleiben nur in diesem Browser, und es gibt keine KI-Rückmeldung. ',
        login, ' – dann ist alles auf jedem Gerät da.');
    const renderer = document.getElementById('content-renderer');
    renderer.parentNode.insertBefore(box, renderer);
}

// ---- IndexedDB cache: one browser, several people --------------------------------------

/**
 * The cache (js/storage.js) is shared by everyone who uses this browser. It is
 * emptied when a different account than last time signs in. The lock keeps the
 * iframes of one host page from clearing what a sibling has just loaded.
 */
async function prepareCache(uid) {
    const run = async () => {
        let last = null;
        try {
            localStorage.removeItem(OLD_KEY_STORAGE);
            last = localStorage.getItem(LAST_UID_KEY);
        } catch { /* storage blocked: treated as "someone else" */ }
        if (last === uid) return;
        await storage.clear();
        try { localStorage.setItem(LAST_UID_KEY, uid); } catch { /* see above */ }
    };
    if (navigator.locks?.request) await navigator.locks.request('lmsbox-cache', run);
    else await run();
}

// ---- logout: every iframe of the host page saves first ----------------------------------
//
// The iframes share one session and one cache, so a logout in one of them ends the work
// in all of them. Before that, each frame gets the chance to write what it still holds:
//
//   clicked frame                         every other frame
//   "prepare"  ───────────────────────▶   stops typing, saves, answers "done"
//   waits for the answers, then looks for unsynced markers in the cache
//   nothing unsynced, or the student says "Trotzdem abmelden":
//   "commit"   ───────────────────────▶   stops saving for good
//   empties the cache, signs out (the auth state reloads all frames)
//   the student says "Angemeldet bleiben":
//   "cancel"   ───────────────────────▶   typing again
//
// Who the other frames are is read from the Web Locks each of them holds while it lives.

const FRAME_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
const FRAME_LOCK = 'lmsbox-frame:';
const FLUSH_TIMEOUT_MS = 8000;      // a save that hangs must not keep the student from logging out
const NO_LOCKS_WAIT_MS = 1500;      // browsers without Web Locks: wait this long for answers
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('lmsbox-logout') : null;
if (navigator.locks?.request) {
    // Held until this frame goes away; never resolved on purpose.
    navigator.locks.request(FRAME_LOCK + FRAME_ID, () => new Promise(() => {})).catch(() => {});
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Saves what this frame still holds; gives up waiting after FLUSH_TIMEOUT_MS. */
const flushOwn = () => Promise.race([
    Promise.all([
        Promise.resolve().then(flushPendingSave).catch(() => {}),
        ...savers.map((s) => Promise.resolve().then(() => s.flush?.()).catch(() => {})),
    ]),
    sleep(FLUSH_TIMEOUT_MS),
]);

let ownLogout = null;      // token of the logout this frame started
let peerLogout = null;     // token of the logout another frame started
let onPeerDone = null;

if (channel) {
    channel.onmessage = async ({ data }) => {
        if (!data || typeof data !== 'object') return;
        if (data.type === 'prepare') {
            peerLogout = data.token;
            suspendAll();
            await flushOwn();
            channel.postMessage({ type: 'done', token: data.token, frame: FRAME_ID, unsynced: unsavedHere() });
        } else if (data.type === 'cancel' && data.token === peerLogout) {
            peerLogout = null;
            if (!ownLogout) resumeAll();
        } else if (data.type === 'commit') {
            closeAll();
        } else if (data.type === 'done') {
            onPeerDone?.(data);
        }
    };
    // A frame that leaves in the middle of its own logout must not leave the others blocked.
    window.addEventListener('pagehide', () => {
        if (ownLogout) channel.postMessage({ type: 'cancel', token: ownLogout });
    });
}

/** Ids of the other frames of this page that are alive now, or null when that cannot be known. */
async function otherFrames() {
    if (!navigator.locks?.query) return null;
    try {
        const { held = [] } = await navigator.locks.query();
        return held.map((l) => l.name).filter((n) => n.startsWith(FRAME_LOCK)).map((n) => n.slice(FRAME_LOCK.length)).filter((id) => id !== FRAME_ID);
    } catch { return null; }
}

/** Asks the other frames to save. Resolves true if one of them says it still holds unsaved text. */
async function prepareOtherFrames(token) {
    if (!channel) return false;
    const waitingFor = await otherFrames();
    let unsynced = false;
    const answered = new Promise((resolve) => {
        const open = new Set(waitingFor || []);
        onPeerDone = (data) => {
            if (data.token !== token) return;
            if (data.unsynced) unsynced = true;
            open.delete(data.frame);
            if (waitingFor && open.size === 0) resolve();
        };
        if (waitingFor && open.size === 0) resolve();
    });
    channel.postMessage({ type: 'prepare', token });
    await Promise.race([answered, sleep(waitingFor ? FLUSH_TIMEOUT_MS + 1000 : NO_LOCKS_WAIT_MS)]);
    onPeerDone = null;
    return unsynced;
}

/**
 * Asks before unsynced text is thrown away. An own dialog, not `confirm()`: browsers
 * block script dialogs in iframes of another site. Resolves true for "log out anyway".
 */
function confirmDiscard() {
    return new Promise((resolve) => {
        const dialog = el('div', `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.7); display: flex;
            justify-content: center; align-items: flex-start; z-index: 3000; font-family: inherit;
            overflow-y: auto; padding: 20px; box-sizing: border-box;`);
        dialog.id = 'logout-confirm';
        dialog.setAttribute('role', 'alertdialog');
        dialog.setAttribute('aria-modal', 'true');
        const box = el('div', 'background: white; padding: 1.5em; border-radius: 12px; width: 100%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); line-height: 1.4; margin: auto;');
        box.appendChild(el('h3', 'margin-top: 0; color: #333; font-size: 1.2em;', 'Noch nicht alles gespeichert'));
        box.appendChild(el('p', 'color: #333; font-size: 0.95em;', 'Ein Teil deiner Antworten ist noch nicht in der Cloud gespeichert, sondern nur auf diesem Gerät. Wenn du dich jetzt abmeldest, geht dieser Text verloren.'));
        box.appendChild(el('p', 'color: #555; font-size: 0.9em;', 'Tipp: Bleib angemeldet, prüfe deine Internetverbindung und versuche es danach noch einmal.'));
        const stay = el('button', 'width: 100%; padding: 12px; background-color: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em;', 'Angemeldet bleiben');
        stay.id = 'logout-confirm-stay';
        stay.type = 'button';
        const leave = el('button', 'width: 100%; padding: 10px; margin-top: 8px; background: white; color: #dc3545; border: 1px solid #dc3545; border-radius: 6px; cursor: pointer; font-size: 0.95em;', 'Trotzdem abmelden');
        leave.id = 'logout-confirm-leave';
        leave.type = 'button';
        const answer = (value) => { dialog.remove(); resolve(value); };
        stay.addEventListener('click', () => answer(false));
        leave.addEventListener('click', () => answer(true));
        box.append(stay, leave);
        dialog.appendChild(box);
        document.body.appendChild(dialog);
        stay.focus();
    });
}

/**
 * Ends the session in every iframe of this page and empties the local cache - after
 * every frame has tried to save, and only with the student's consent if something
 * could not be saved.
 */
export async function logout() {
    if (ownLogout) return;
    const token = FRAME_ID + ':' + Date.now();
    ownLogout = token;

    suspendAll();
    const [, peerUnsynced] = await Promise.all([flushOwn(), prepareOtherFrames(token)]);
    let unsynced = peerUnsynced || unsavedHere();
    if (!unsynced) {
        try { unsynced = await hasUnsyncedWork(); } catch { /* cache unreadable: then there is no local copy to lose */ }
    }
    if (!unsynced) unsynced = await saversUnsynced();
    if (unsynced && !(await confirmDiscard())) {
        channel?.postMessage({ type: 'cancel', token });
        ownLogout = null;
        if (!peerLogout) resumeAll();
        return;
    }

    channel?.postMessage({ type: 'commit', token });
    closeAll();
    try { await storage.clear(); } catch { /* nothing cached */ }
    try { localStorage.removeItem(LAST_UID_KEY); } catch { /* storage blocked */ }
    await signOut();
    ownLogout = null;
    reload();   // back to the login dialog (the auth state change does the same)
}

/**
 * For a page that cannot work without an account (hko.html, backend/HKO.md "Phase P1 -
 * Vertrag" §7): opens the login dialog for a guest, as before the guest mode. Additive;
 * index.html does not call it.
 */
export function requireLogin() { showLoginDialog(); }

/**
 * Resolves with `{ uid, student, guest: false }` once a student is signed in and may
 * work, or with `{ uid: null, student: null, guest: true }` when nobody is signed in.
 * For accounts that cannot work here it shows a message and does not resolve. The page
 * reloads whenever the account changes afterwards - also a guest who signs in.
 */
export function authenticate() {
    return new Promise((resolve) => {
        let decidedFor;     // uid this page was built for; undefined while the dialog is open
        let run = 0;
        onAuthChange(async (user) => {
            if (decidedFor !== undefined) {
                // Logout or another account, here or in a sibling iframe: start over.
                if (user?.uid !== decidedFor) reload();
                return;
            }
            const mine = ++run;
            if (!user) {
                decidedFor = null;
                showGuest();
                resolve({ uid: null, student: null, guest: true });
                return;
            }

            closeLoginDialog();   // also when a sibling iframe did the login
            let student = null;
            let failed = false;
            try { student = await getStudent(); } catch (e) { console.error('Roster:', e); failed = true; }
            if (mine !== run) return;
            decidedFor = user.uid;

            if (failed) { showAccountError(); return; }
            if (!student) { showNoStudent(user.email || 'unbekannt'); return; }
            const name = student.name || student.username || user.email || '';
            if (student.mustSetPassword === true) { showMustSetPassword(name); return; }

            await prepareCache(user.uid);
            showUser(name);
            resolve({ uid: user.uid, student: { ...student, name }, guest: false });
        });
    });
}
