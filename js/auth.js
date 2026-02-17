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
            <div style="background: white; padding: 2.5em; border-radius: 12px; text-align: left; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); line-height: 1.5;">
                <h3 style="margin-top: 0; text-align: center; color: #333;">Anmeldung</h3>
                <p style="margin-bottom: 1.5em; text-align: center; color: #555;">Bitte gib deinen persönlichen Schülerschlüssel ein, um auf deine Arbeit zuzugreifen.</p>
                
                <div style="background: #f8f9fa; border-left: 4px solid #007bff; padding: 1em; margin-bottom: 1.5em; font-size: 0.9em;">
                    <p style="margin: 0; font-weight: bold;">So setzt sich dein Code zusammen:</p>
                    <p style="margin: 5px 0 0 0; font-family: monospace; background: #eee; padding: 5px; border-radius: 3px;">[Klasse]-[Vorname]-[Nachname]-[Matrikelnummer]</p>
                    <p style="margin: 10px 0 0 0; color: #666;">
                        Beispiel: <code style="color: #d63384;">pk21a-hans-muster-123456</code><br>
                        <em>Die Matrikelnummer findest du auf deinem Studentenausweis oder bei OLAT im Profil (Institutionsnummer).</em>
                    </p>
                </div>

                <input type="text" id="student-key-input" placeholder="Dein Schlüssel..." style="width: 100%; padding: 12px; margin-bottom: 1em; border: 2px solid #ddd; border-radius: 6px; box-sizing: border-box; font-family: monospace;">
                <button id="login-key-btn" style="width: 100%; padding: 12px; background-color: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1.1em; transition: background 0.2s;">Anmelden</button>
                <p id="auth-status" style="color: #d9534f; min-height: 1.2em; margin-top: 1em; text-align: center; font-size: 0.9em;"></p>
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