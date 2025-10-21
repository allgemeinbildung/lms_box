//
// ─────────────────────────────────────────────────────────────────
//   :::::: F I L E :   j s / s u b m i s s i o n . j s ::::::
// ─────────────────────────────────────────────────────────────────
//
import { SCRIPT_URL } from './config.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';

const STUDENT_INFO_KEY = 'studentInfo';
// ✅ NEU: Schlüssel für die Versionierung der gespeicherten Daten.
// Dies zwingt alte Benutzer, ihre Klasse einmalig neu auszuwählen.
const STUDENT_INFO_VERSION_KEY = 'studentInfoVersion';
const CURRENT_INFO_VERSION = 2; // Erhöhen Sie diese Zahl, um eine erneute Eingabe in der Zukunft zu erzwingen.


// ✅ NEU: Konfiguration für vordefinierte Klassen
// Passen Sie diese Liste an Ihre Bedürfnisse an.
const PREDEFINED_CLASSES = ['BG22a', 'BG22b', 'BG23a', 'BG23b', 'FMS22', 'FMS23'];


/**
 * ✅ AKTUALISIERT: Der Dialog kann nun vorhandene Daten (den Namen) vorausfüllen.
 * @param {object|null} existingInfo - Vorhandene Schülerinformationen zum Vorausfüllen.
 * @returns {Promise<object|null>} Ein Promise, das mit {klasse, name} aufgelöst wird oder null, wenn abgebrochen.
 */
function showStudentInfoDialog(existingInfo = null) {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('student-info-dialog');
        if (existingDialog) existingDialog.remove();

        const dialog = document.createElement('div');
        dialog.id = 'student-info-dialog';
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.6); display: flex;
            justify-content: center; align-items: center; z-index: 2000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        `;

        const classButtonsHTML = PREDEFINED_CLASSES.map(cls =>
            `<button type="button" class="class-btn" data-klasse="${cls}">${cls}</button>`
        ).join('');

        // ✅ Füllt den Namen des Schülers voraus, falls vorhanden.
        const prefilledName = existingInfo ? existingInfo.name : '';

        dialog.innerHTML = `
            <div style="background: white; padding: 2em 2.5em; border-radius: 12px; max-width: 500px; width: 90%; box-shadow: 0 5px 20px rgba(0,0,0,0.2);">
                <h3 style="margin-top: 0; font-size: 1.4em; text-align: center;">Daten für die Abgabe</h3>
                <p style="text-align: center; color: #555;">Bitte wähle deine Klasse aus und gib deinen Namen ein.</p>
                
                <div style="margin-bottom: 1.5em;">
                    <label style="display: block; font-weight: bold; margin-bottom: 0.5em;">Klasse:</label>
                    <div id="class-selection-container" style="display: flex; flex-wrap: wrap; gap: 10px;">
                        ${classButtonsHTML}
                        <button type="button" class="class-btn" data-klasse="other">Andere...</button>
                    </div>
                    <input type="text" id="custom-class-input" placeholder="Eigene Klasse eingeben..." style="display: none; width: 100%; padding: 10px; margin-top: 10px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box;">
                </div>

                <div style="margin-bottom: 2em;">
                    <label for="student-name-input" style="display: block; font-weight: bold; margin-bottom: 0.5em;">Name:</label>
                    <input type="text" id="student-name-input" placeholder="Vorname Nachname" style="width: 100%; padding: 10px; border: 1px solid #ccc; border-radius: 5px; box-sizing: border-box;" value="${prefilledName}">
                </div>
                
                <p id="info-dialog-error" style="color: #d9534f; text-align: center; min-height: 1.2em; margin-top: -1em; margin-bottom: 1em;"></p>

                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button id="info-cancel-btn" style="padding: 10px 20px; border: 1px solid #6c757d; background-color: transparent; color: #6c757d; border-radius: 5px; cursor: pointer;">Abbrechen</button>
                    <button id="info-save-btn" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer;">Speichern & Weiter</button>
                </div>
            </div>
            <style>
                .class-btn { padding: 10px 15px; border: 1px solid #ccc; background-color: #f0f0f0; color: #333; border-radius: 5px; cursor: pointer; transition: background-color 0.2s, border-color 0.2s; }
                .class-btn:hover { background-color: #e0e0e0; }
                .class-btn.active { background-color: #007bff; color: white; border-color: #007bff; font-weight: bold; }
            </style>
        `;
        document.body.appendChild(dialog);

        const customClassInput = document.getElementById('custom-class-input');
        const nameInput = document.getElementById('student-name-input');
        const errorP = document.getElementById('info-dialog-error');
        let selectedKlasse = null;

        dialog.querySelectorAll('.class-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                dialog.querySelectorAll('.class-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                selectedKlasse = btn.dataset.klasse;

                if (selectedKlasse === 'other') {
                    customClassInput.style.display = 'block';
                    customClassInput.focus();
                } else {
                    customClassInput.style.display = 'none';
                }
                errorP.textContent = '';
            });
        });

        document.getElementById('info-save-btn').onclick = () => {
            const klasse = (selectedKlasse === 'other') ? customClassInput.value.trim() : selectedKlasse;
            const name = nameInput.value.trim();

            if (!klasse) {
                errorP.textContent = 'Bitte wähle oder gib eine Klasse ein.';
                return;
            }
            if (!name) {
                errorP.textContent = 'Bitte gib deinen Namen ein.';
                return;
            }

            dialog.remove();
            resolve({ klasse, name });
        };

        document.getElementById('info-cancel-btn').onclick = () => {
            dialog.remove();
            resolve(null);
        };
    });
}


/**
 * ✅ AKTUALISIERT: Erzwingt eine Neueingabe, wenn die gespeicherten Daten veraltet sind.
 * @returns {object|null} An object with {klasse, name} or null if aborted.
 */
async function getStudentInfo() {
    let storedInfo = null;
    try {
        storedInfo = JSON.parse(localStorage.getItem(STUDENT_INFO_KEY));
    } catch (e) { /* Ignorieren, wenn die Daten ungültig sind */ }

    const infoVersion = localStorage.getItem(STUDENT_INFO_VERSION_KEY);

    // ✅ Wenn Daten vorhanden und die Version aktuell ist, direkt verwenden.
    if (storedInfo && parseInt(infoVersion) === CURRENT_INFO_VERSION) {
        return storedInfo;
    }

    // ✅ Andernfalls (neuer Benutzer oder alte Version), den Dialog anzeigen.
    // 'storedInfo' wird übergeben, um das Namensfeld vorauszufüllen.
    const studentInfo = await showStudentInfoDialog(storedInfo);
    if (!studentInfo) {
        alert('Aktion abgebrochen.');
        return null;
    }

    // ✅ Speichert die neuen Daten UND die aktuelle Versionsnummer.
    localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(studentInfo));
    localStorage.setItem(STUDENT_INFO_VERSION_KEY, CURRENT_INFO_VERSION);
    return studentInfo;
}


/**
 * Gathers all individual question answers from localStorage.
 * @param {object} studentInfo - The student's class and name.
 * @returns {object|null} The complete data payload for submission or null.
 */
async function gatherAllDataForSubmission(studentInfo) {
    if (!studentInfo) return null;

    const allDataPayload = {};
    const answerRegex = new RegExp(`^${ANSWER_PREFIX}(.+)_sub_(.+)_q_(.+)$`);

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const match = key.match(answerRegex);
        if (match) {
            const [, assignmentId, subId, questionId] = match;
            
            if (!allDataPayload[assignmentId]) {
                allDataPayload[assignmentId] = {};
            }
            
            if (!allDataPayload[assignmentId][subId]) {
                allDataPayload[assignmentId][subId] = {
                    title: localStorage.getItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || subId,
                    type: localStorage.getItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`) || 'quill',
                    questions: JSON.parse(localStorage.getItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`) || '[]'),
                    answers: []
                };
            }
            
            allDataPayload[assignmentId][subId].answers.push({
                questionId: questionId,
                answer: localStorage.getItem(key) || ''
            });
        }
    }

    if (Object.keys(allDataPayload).length === 0) {
        alert("Es wurden keine gespeicherten Daten zum Senden gefunden.");
        return null;
    }

    const identifier = `${studentInfo.klasse}_${studentInfo.name}`;

    return {
        identifier,
        payload: {
            assignments: allDataPayload,
            createdAt: new Date().toISOString()
        }
    };
}


/**
 * Creates and shows a custom confirmation dialog.
 * @param {object} studentInfo - The student's {klasse, name}.
 * @returns {Promise<boolean>} A promise that resolves to true if confirmed, false if canceled.
 */
function showConfirmationDialog(studentInfo) {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('confirm-dialog');
        if (existingDialog) existingDialog.remove();

        const dialog = document.createElement('div');
        dialog.id = 'confirm-dialog';
        dialog.style.cssText = `
            position: fixed; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0,0,0,0.6); display: flex;
            justify-content: center; align-items: center; z-index: 2000;
        `;

        dialog.innerHTML = `
            <div style="background: white; padding: 2em; border-radius: 8px; text-align: center; max-width: 400px;">
                <p>Du bist dabei, ein Backup ALLER gespeicherten Aufträge zu senden unter den folgenden Daten:</p>
                <div style="margin: 1em 0; padding: 0.5em; background: #f0f0f0; border-radius: 4px;">
                    <strong>Klasse:</strong> ${studentInfo.klasse}<br>
                    <strong>Name:</strong> ${studentInfo.name}
                </div>
                <p>Fortfahren?</p>
                <button id="confirm-send" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">Senden</button>
                <button id="confirm-edit" style="padding: 10px 20px; background-color: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">Daten ändern</button>
                <button id="confirm-cancel" style="padding: 10px 20px; background-color: #dc3545; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">Abbrechen</button>
            </div>
        `;
        document.body.appendChild(dialog);

        document.getElementById('confirm-send').onclick = () => {
            dialog.remove();
            resolve(true);
        };
        document.getElementById('confirm-edit').onclick = () => {
            // ✅ Löscht jetzt BEIDE Schlüssel, um eine saubere Neueingabe zu gewährleisten.
            localStorage.removeItem(STUDENT_INFO_KEY);
            localStorage.removeItem(STUDENT_INFO_VERSION_KEY);
            dialog.remove();
            submitAllAssignments();
            resolve(false);
        };
        document.getElementById('confirm-cancel').onclick = () => {
            dialog.remove();
            resolve(false);
        };
    });
}


export async function submitAllAssignments() {
    const studentInfo = await getStudentInfo();
    if (!studentInfo) return;
    
    const isConfirmed = await showConfirmationDialog(studentInfo);
    if (!isConfirmed) {
        return;
    }
    
    const submissionData = await gatherAllDataForSubmission(studentInfo);
    if (!submissionData) return;

    if (!SCRIPT_URL || SCRIPT_URL.includes('YOUR_CLOUD_FUNCTION_TRIGGER_URL')) {
        alert('Konfigurationsfehler: Die Abgabe-URL ist nicht in js/config.js festgelegt.');
        return;
    }

    const submitButton = document.getElementById('submit-all');
    submitButton.textContent = 'Wird übermittelt...';
    submitButton.disabled = true;

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'submit',
                identifier: submissionData.identifier,
                payload: submissionData.payload
            })
        });
        const result = await response.json();

        if (response.ok && result.status === 'success') {
            alert('Daten wurden erfolgreich übermittelt.');
        } else {
            throw new Error(result.message || 'Ein unbekannter Server-Fehler ist aufgetreten.');
        }
    } catch (error) {
        console.error('Submission failed:', error);
        alert(`Fehler beim Senden der Daten.\n\nFehler: ${error.message}`);
    } finally {
        submitButton.textContent = 'Alle Aufträge abgeben';
        submitButton.disabled = false;
    }
}
