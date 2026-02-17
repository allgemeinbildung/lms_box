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
            justify-content: center; align-items: flex-start; z-index: 3000; font-family: sans-serif;
            overflow-y: auto; padding: 20px; box-sizing: border-box;
        `;

        dialog.innerHTML = `
            <div style="background: white; padding: 1.5em; border-radius: 12px; text-align: left; width: 100%; max-width: 450px; box-shadow: 0 10px 25px rgba(0,0,0,0.2); line-height: 1.4; margin: auto;">
                <h3 style="margin-top: 0; text-align: center; color: #333; font-size: 1.2em;">Anmeldung</h3>
                <p style="margin-bottom: 1em; text-align: center; color: #555; font-size: 0.95em;">Bitte gib deinen Schülerschlüssel ein.</p>
                
                <div style="background: #f8f9fa; border-left: 4px solid #007bff; padding: 0.8em; margin-bottom: 1em; font-size: 0.85em;">
                    <p style="margin: 0; font-weight: bold;">Code-Zusammensetzung:</p>
                    <p style="margin: 4px 0 0 0; font-family: monospace; background: #eee; padding: 4px; border-radius: 3px; word-break: break-all;">[Klasse]-[Vorname]-[Nachname]-[Nummer]</p>
                    <p style="margin: 8px 0 0 0; color: #666; line-height: 1.4;">
                        Beispiel: <code style="color: #d63384;">pk21a-hans-muster-123456</code><br>
                        <span style="display: block; margin-top: 5px;">
                            <em>Die Nummer findest du:</em><br>
                            • Auf dem <strong>Studentenausweis</strong> unter dem Barcode.<br>
                            • Bei <strong>OLAT</strong> im Profil unter "Institutionsnummer (Matrikelnummer)".
                        </span>
                    </p>
                </div>

                <input type="text" id="student-key-input" placeholder="Dein Schlüssel..." style="width: 100%; padding: 10px; margin-bottom: 0.8em; border: 2px solid #ddd; border-radius: 6px; box-sizing: border-box; font-family: monospace; font-size: 1em;">
                <button id="login-key-btn" style="width: 100%; padding: 10px; background-color: #007bff; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 1em; transition: background 0.2s;">Anmelden</button>
                <p id="auth-status" style="color: #d9534f; min-height: 1.2em; margin-top: 0.8em; text-align: center; font-size: 0.85em;"></p>
            </div>
        `;
        document.body.appendChild(dialog);

        const keyInput = document.getElementById('student-key-input');
        const loginBtn = document.getElementById('login-key-btn');
        const statusEl = document.getElementById('auth-status');

        const attemptLogin = () => {
            const key = keyInput.value.trim().toLowerCase();
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