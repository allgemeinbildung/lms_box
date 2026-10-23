//
//  js/sso.js — sign in with the session the student already has at the Lernportal.
//
//  Contract: backend/CONTRACT.md, «Single sign-on». A browser keeps a Firebase session per
//  origin (and per host page, for an iframe), so the Lernportal's login is not visible
//  here. This module opens a small window on the Lernportal's own origin; that window
//  checks the login there (asks for it if there is none), gets a custom token from the
//  function `boxSsoToken`, hands it back with postMessage and closes itself.
//
import { signInWithPortalToken } from './api.js';

const PORTAL_ORIGIN = 'https://bbw.aburossi.ch';
const PORTAL_PATH = '/lmsbox-sso';
const LOCAL = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;

/**
 * The Lernportal's origin. A page that itself runs on localhost may name a local stand-in
 * with `?portal=http://127.0.0.1:<port>` (tests); on the real host the parameter is ignored.
 */
function portalOrigin() {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
        const p = new URLSearchParams(window.location.search).get('portal');
        if (p && LOCAL.test(p)) return p;
    }
    return PORTAL_ORIGIN;
}

function randomState() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

let running = null;

/**
 * Opens the Lernportal window and signs in with what it returns. Must be called from a
 * click (browsers block a window that is not opened by one). Resolves, never rejects:
 *   { ok: true }                              signed in; the auth state changes
 *   { ok: false, reason: 'blocked' }          the browser did not open the window
 *   { ok: false, reason: 'closed' }           closed without an answer
 *   { ok: false, reason: 'forbidden' | 'unavailable' | 'token' | … }
 */
export function startPortalLogin() {
    if (running) {
        try { running.popup.focus(); } catch { /* window gone */ }
        return running.promise;
    }
    const origin = portalOrigin();
    const state = randomState();
    const url = `${origin}${PORTAL_PATH}?origin=${encodeURIComponent(window.location.origin)}&state=${state}`;
    let popup = null;
    try { popup = window.open(url, 'lmsbox-sso', 'popup=yes,width=480,height=680'); } catch { /* blocked */ }
    if (!popup) return Promise.resolve({ ok: false, reason: 'blocked' });

    const promise = new Promise((resolve) => {
        let handling = false;
        const finish = (result) => {
            window.removeEventListener('message', onMessage);
            clearInterval(timer);
            running = null;
            resolve(result);
        };
        // Only the window we opened, only from the Lernportal's origin, only with our state.
        const onMessage = async (event) => {
            if (event.origin !== origin || event.source !== popup) return;
            const d = event.data;
            if (!d || typeof d !== 'object' || d.type !== 'lmsbox-sso' || d.state !== state) return;
            if (handling) return;
            handling = true;
            if (typeof d.token === 'string' && d.token) {
                try {
                    await signInWithPortalToken(d.token);
                    finish({ ok: true });
                } catch (e) {
                    console.error('SSO sign-in:', e);
                    finish({ ok: false, reason: 'token' });
                }
            } else {
                finish({ ok: false, reason: typeof d.error === 'string' ? d.error : 'failed' });
            }
        };
        window.addEventListener('message', onMessage);
        // The window closes itself right after it answers; give a late message the benefit.
        const timer = setInterval(() => { if (popup.closed && !handling) setTimeout(() => { if (!handling) finish({ ok: false, reason: 'closed' }); }, 600); }, 500);
    });
    running = { popup, promise };
    return promise;
}

const MESSAGES = {
    blocked: 'Der Browser hat das Fenster blockiert. Erlaube Pop-ups für diese Seite oder melde dich mit Passwort an.',
    forbidden: 'Mit diesem Konto geht das nicht. Melde dich im Lernportal mit deinem Lernenden-Konto an.',
    unavailable: 'Die Anmeldung über das Lernportal ist gerade nicht verfügbar. Melde dich mit Passwort an.',
    token: 'Die Anmeldung über das Lernportal hat nicht geklappt. Melde dich mit Passwort an.',
    failed: 'Die Anmeldung über das Lernportal hat nicht geklappt. Melde dich mit Passwort an.',
};

/** German text for a failed result; '' when nothing needs saying (the student closed the window). */
export function portalLoginMessage(result) {
    if (!result || result.ok || result.reason === 'closed') return '';
    return MESSAGES[result.reason] || MESSAGES.failed;
}
