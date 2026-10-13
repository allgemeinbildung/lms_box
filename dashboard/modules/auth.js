//
//  dashboard/modules/auth.js — login overlay of the Live View.
//
//  Firebase account (username or e-mail + password). Access only when the ID token
//  carries the claim role == "teacher"; any other account is told so and signed out.
//
import { signIn, signOut, onTeacherAuth } from './api.js';

const LOGIN_ERRORS = {
    'auth/invalid-credential': 'Benutzername oder Passwort ist falsch.',
    'auth/wrong-password': 'Benutzername oder Passwort ist falsch.',
    'auth/user-not-found': 'Benutzername oder Passwort ist falsch.',
    'auth/invalid-email': 'Benutzername oder Passwort ist falsch.',
    'auth/user-disabled': 'Dieses Konto ist gesperrt.',
    'auth/too-many-requests': 'Zu viele Versuche. Bitte warten Sie einen Moment und versuchen Sie es erneut.',
    'auth/network-request-failed': 'Keine Verbindung. Bitte prüfen Sie Ihr Internet und versuchen Sie es erneut.',
};
const NOT_A_TEACHER = 'Kein Zugang: Dieses Konto ist kein Lehrpersonen-Konto. Sie wurden wieder abgemeldet.';

export const initAuth = (onLoginSuccess) => {
    const loginOverlay = document.getElementById('login-overlay');
    const userInput = document.getElementById('login-username');
    const passInput = document.getElementById('login-password');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    const logoutBtn = document.getElementById('logout-btn');

    let entered = false;    // the dashboard was opened for a teacher in this page load
    let started = false;

    const setBusy = (busy) => {
        loginBtn.disabled = busy;
        loginBtn.textContent = busy ? 'Anmelden …' : 'Anmelden';
    };

    const attemptLogin = async () => {
        const username = userInput.value.trim();
        const password = passInput.value;
        if (!username || !password) {
            loginStatus.textContent = 'Bitte Benutzername und Passwort eingeben.';
            return;
        }
        loginStatus.textContent = '';
        setBusy(true);
        try {
            await signIn(username, password);
            // Success: the auth state changes; the listener below decides about access.
        } catch (error) {
            loginStatus.textContent = LOGIN_ERRORS[error.code] || 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es erneut.';
            setBusy(false);
            passInput.select();
        }
    };

    loginBtn.addEventListener('click', attemptLogin);
    for (const input of [userInput, passInput]) {
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
    }
    if (logoutBtn) logoutBtn.addEventListener('click', () => signOut());

    // Starts listening to the session. Kept as a function because liveview.js calls it
    // once everything else on the page is set up.
    const checkAuth = () => {
        if (started) return;
        started = true;
        onTeacherAuth(async ({ signedIn, isTeacher }) => {
            if (signedIn && isTeacher) {
                if (entered) return;
                entered = true;
                passInput.value = '';
                loginStatus.textContent = '';
                setBusy(false);
                loginOverlay.classList.remove('visible');
                onLoginSuccess();
                return;
            }
            // Logout or another account after the dashboard was open: start clean.
            if (entered) { window.location.reload(); return; }
            if (signedIn) {
                loginStatus.textContent = NOT_A_TEACHER;   // stays visible after the sign-out below
                passInput.value = '';
                await signOut();
                return;
            }
            setBusy(false);
            loginOverlay.classList.add('visible');
        });
    };

    return checkAuth;
};
