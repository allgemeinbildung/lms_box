//
// ─────────────────────────────────────────────────────────────────
//   :::::: F I L E :   j s / s u b m i s s i o n . j s ::::::
// ─────────────────────────────────────────────────────────────────
//  Handles the FINAL submission of all student work to the server.
//
import { SCRIPT_URL } from './config.js';
import * as storage from './storage.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';

/**
 * Gathers all answers and assignment structures from IndexedDB to build a complete payload.
 * This function is exported so it can be used by other modules (e.g., renderer.js for drafts).
 * @returns {Promise<object|null>} The complete data payload for submission or null if no data is found.
 */
export async function gatherAllDataForSubmission() {
    const allDataPayload = {};
    const answerRegex = new RegExp(`^${ANSWER_PREFIX}(.+)_sub_(.+)_q_(.+)$`);

    const allStoredData = await storage.getAll();
    const dataMap = new Map(allStoredData.map(item => [item.key, item.value]));

    for (const [key, value] of dataMap.entries()) {
        const match = key.match(answerRegex);
        if (match) {
            const [, assignmentId, subId, questionId] = match;
            
            if (!allDataPayload[assignmentId]) {
                allDataPayload[assignmentId] = {};
            }
            
            if (!allDataPayload[assignmentId][subId]) {
                const title = dataMap.get(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || subId;
                const type = dataMap.get(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`) || 'quill';
                const questionsStr = dataMap.get(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`);
                const questions = questionsStr ? JSON.parse(questionsStr) : [];

                allDataPayload[assignmentId][subId] = {
                    title,
                    type,
                    questions,
                    answers: []
                };
            }
            
            allDataPayload[assignmentId][subId].answers.push({
                questionId: questionId,
                answer: value || ''
            });
        }
    }

    if (Object.keys(allDataPayload).length === 0) {
        alert("Keine gespeicherten Antworten zum Senden gefunden.");
        return null;
    }

    return {
        assignments: allDataPayload,
        createdAt: new Date().toISOString()
    };
}

/**
 * Creates and shows a custom confirmation dialog.
 * @param {object} studentInfo - The student's {klasse, name} from the auth step.
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
                <p>Du bist dabei, deine Arbeit final abzugeben. Dies kann nicht rückgängig gemacht werden.</p>
                <div style="margin: 1em 0; padding: 0.5em; background: #f0f0f0; border-radius: 4px;">
                    <strong>Klasse:</strong> ${studentInfo.klasse}<br>
                    <strong>Name:</strong> ${studentInfo.name}
                </div>
                <p>Bist du sicher?</p>
                <button id="confirm-send" style="padding: 10px 20px; background-color: #007bff; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">Final abgeben</button>
                <button id="confirm-cancel" style="padding: 10px 20px; background-color: #6c757d; color: white; border: none; border-radius: 5px; cursor: pointer; margin: 5px;">Abbrechen</button>
            </div>
        `;
        document.body.appendChild(dialog);

        document.getElementById('confirm-send').onclick = () => {
            dialog.remove();
            resolve(true);
        };
        document.getElementById('confirm-cancel').onclick = () => {
            dialog.remove();
            resolve(false);
        };
    });
}

/**
 * Main function to handle the final submission of all assignments.
 * @param {string} studentKey - The authenticated student's key.
 * @param {object} studentInfo - The student's info object { klasse, name, ... }.
 * @param {string} mode - The current mode ('test' or 'live').
 */
export async function submitAllAssignments(studentKey, studentInfo, mode) {
    if (!studentKey || !studentInfo) {
        alert("Fehler: Nicht authentifiziert. Bitte die Seite neu laden.");
        return;
    }
    
    const payload = await gatherAllDataForSubmission();
    if (!payload) return;

    const isConfirmed = await showConfirmationDialog(studentInfo);
    if (!isConfirmed) {
        return;
    }
    
    if (!SCRIPT_URL || SCRIPT_URL.includes('YOUR_CLOUD_FUNCTION_TRIGGER_URL')) {
        alert('Konfigurationsfehler: Die Abgabe-URL ist nicht in js/config.js festgelegt.');
        return;
    }

    const submitButton = document.getElementById('submit-all');
    submitButton.textContent = 'Wird übermittelt...';
    submitButton.disabled = true;

    try {
        // The 'identifier' for the old submission system is now the student's name and class,
        // which is more appropriate for the teacher dashboard's folder structure.
        const legacyIdentifier = `${studentInfo.klasse}_${studentInfo.name}`;

        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                action: 'submit',
                identifier: legacyIdentifier, // Use legacy identifier for folder name
                payload: payload,
                mode: mode // Pass mode for consistency, though 'submit' may not use it
            })
        });
        const result = await response.json();

        if (response.ok && result.status === 'success') {
            alert('Daten wurden erfolgreich und final übermittelt.');
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