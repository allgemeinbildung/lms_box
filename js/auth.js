const STUDENT_KEY_STORAGE = 'student-auth-key';

function showLoginDialog() {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('auth-dialog');
        if (existingDialog) existingDialog.remove();

        const dialog = document.createElement('div');
        dialog.id = 'auth-dialog';
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.7); display: flex;
            justify-content: center; align-items: center; z-index: 3000; font-family: sans-serif;
        `;

        dialog.innerHTML = `
            <div style="background: white; padding: 2em; border-radius: 8px; text-align: center; max-width: 400px;">
                <h3 style="margin-top: 0;">Anmeldung</h3>
                <p>Bitte gib deinen persönlichen Schülerschlüssel ein, um auf deine Arbeit zuzugreifen.</p>
                <input type="text" id="student-key-input" placeholder="Dein Schlüssel..." style="width: 90%; padding: 10px; margin: 1em 0; border: 1px solid #ccc; border-radius: 4px;">
                <button id="login-key-btn" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Anmelden</button>
                <p id="auth-status" style="color: #d9534f; min-height: 1.2em; margin-top: 1em;"></p>
            </div>
        `;
        document.body.appendChild(dialog);

        const keyInput = document.getElementById('student-key-input');
        const loginBtn = document.getElementById('login-key-btn');
        const statusEl = document.getElementById('auth-status');

        const attemptLogin = () => {
            const key = keyInput.value.trim();
            if (!key) {
                statusEl.textContent = 'Bitte gib einen Schlüssel ein.';
                return;
            }
            dialog.remove();
            resolve(key);
        };

        loginBtn.addEventListener('click', attemptLogin);
        keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });
    });
}

export async function authenticate(SCRIPT_URL, mode) {
    let key = localStorage.getItem(STUDENT_KEY_STORAGE);

    if (!key) {
        key = await showLoginDialog();
        if (!key) return null; // User cancelled
    }

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'authenticateStudent',
                studentKey: key,
                mode: mode // Pass the mode to the backend
            })
        });
        const result = await response.json();

        if (result.status === 'success') {
            localStorage.setItem(STUDENT_KEY_STORAGE, key);
            return { key, studentInfo: result.studentInfo };
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        localStorage.removeItem(STUDENT_KEY_STORAGE);
        alert(`Anmeldung fehlgeschlagen: ${error.message}\nBitte versuche es erneut.`);
        return await authenticate(SCRIPT_URL, mode); // Retry on failure
    }
}