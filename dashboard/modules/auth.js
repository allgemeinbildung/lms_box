import { setTeacherKey } from './state.js';

export const initAuth = (onLoginSuccess) => {
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');

    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            setTeacherKey(key);
            loginOverlay.classList.remove('visible');
            onLoginSuccess();
        } else {
            loginOverlay.classList.add('visible');
        }
    };

    const attemptLogin = () => {
        const key = keyInput.value.trim();
        if (!key) {
            loginStatus.textContent = 'Bitte einen Schlüssel eingeben.';
            return;
        }
        sessionStorage.setItem('teacherKey', key);
        loginStatus.textContent = '';
        checkAuth();
    };

    loginBtn.addEventListener('click', attemptLogin);
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

    // Expose checkAuth in case we need to re-check (e.g. after logout/error)
    return checkAuth;
};
