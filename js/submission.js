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

/**
 * Gathers student info (Klasse and Name).
 * Prompts the user if the info is not already in localStorage.
 * @returns {object|null} An object with {klasse, name} or null if aborted.
 */
async function getStudentInfo() {
    let storedInfo = localStorage.getItem(STUDENT_INFO_KEY);
    if (storedInfo) {
        try {
            return JSON.parse(storedInfo);
        } catch (e) {
            console.error("Could not parse student info, prompting again.", e);
        }
    }

    const klasse = prompt('Bitte gib deine Klasse ein (z.B. "8A"):', '');
    if (!klasse) {
        alert('Aktion abgebrochen. Die Klasse ist erforderlich.');
        return null;
    }

    const name = prompt('Bitte gib deinen Namen ein:', '');
    if (!name) {
        alert('Aktion abgebrochen. Der Name ist erforderlich.');
        return null;
    }

    const studentInfo = { klasse: klasse.trim(), name: name.trim() };
    localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(studentInfo));
    return studentInfo;
}


/**
 * 🔄 UPDATED: Gathers all individual question answers from localStorage.
 * The payload for each sub-assignment will now contain an 'answers' array.
 * @param {object} studentInfo - The student's class and name.
 * @returns {object|null} The complete data payload for submission or null.
 */
async function gatherAllDataForSubmission(studentInfo) {
    if (!studentInfo) return null;

    const allDataPayload = {};
    
    // 🔄 Regex now captures assignmentId, subId, AND questionId from the key.
    const answerRegex = new RegExp(`^${ANSWER_PREFIX}(.+)_sub_(.+)_q_(.+)$`);

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const match = key.match(answerRegex);
        if (match) {
            const [, assignmentId, subId, questionId] = match;
            
            // Initialize assignment container if it's the first time we see it
            if (!allDataPayload[assignmentId]) {
                allDataPayload[assignmentId] = {};
            }
            
            // Initialize sub-assignment container
            if (!allDataPayload[assignmentId][subId]) {
                allDataPayload[assignmentId][subId] = {
                    // Get metadata for this sub-assignment
                    title: localStorage.getItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || subId,
                    type: localStorage.getItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`) || 'quill',
                    questions: JSON.parse(localStorage.getItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`) || '[]'),
                    answers: [] // ✅ NEW: Use an array for answers
                };
            }
            
            // Add the specific question's answer to the array
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
        // Remove existing dialog if any
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
            resolve(true); // Proceed with sending
        };
        document.getElementById('confirm-edit').onclick = () => {
            localStorage.removeItem(STUDENT_INFO_KEY); // Clear stored data
            dialog.remove();
            submitAllAssignments(); // Restart the process
            resolve(false); // Stop current submission
        };
        document.getElementById('confirm-cancel').onclick = () => {
            dialog.remove();
            resolve(false); // Cancel
        };
    });
}


export async function submitAllAssignments() {
    const studentInfo = await getStudentInfo();
    if (!studentInfo) return; // Aborted during info gathering
    
    const isConfirmed = await showConfirmationDialog(studentInfo);
    if (!isConfirmed) {
        alert("Aktion abgebrochen.");
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