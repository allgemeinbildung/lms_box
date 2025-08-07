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
 * ✅ UPDATED: Gathers student info (Klasse, Name, and Token).
 * @returns {object|null} An object with {klasse, name, token} or null if aborted.
 */
async function getStudentInfo() {
    let storedInfo = localStorage.getItem(STUDENT_INFO_KEY);
    if (storedInfo) {
        try {
            // Ensure token is also stored, otherwise reprompt
            const info = JSON.parse(storedInfo);
            if(info.token) return info;
        } catch (e) {
            console.error("Could not parse student info, prompting again.", e);
        }
    }

    const klasse = prompt('Bitte gib deine Klasse ein (z.B. "8A"):', '');
    if (!klasse) return null;

    const name = prompt('Bitte gib deinen Namen ein:', '');
    if (!name) return null;

    const token = prompt('Bitte gib deinen persönlichen Abgabe-Token ein:', '');
    if (!token) return null;

    const studentInfo = { 
        klasse: klasse.trim(), 
        name: name.trim(), 
        token: token.trim() 
    };
    localStorage.setItem(STUDENT_INFO_KEY, JSON.stringify(studentInfo));
    return studentInfo;
}

async function gatherAllDataForSubmission(studentInfo) {
    // ... (This function remains the same as your last version)
    if (!studentInfo) return null;
    const allDataPayload = {};
    const answerRegex = new RegExp(`^${ANSWER_PREFIX}(.+)_sub_(.+)$`);
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const match = key.match(answerRegex);
        if (match) {
            const [, assignmentId, subId] = match;
            if (!allDataPayload[assignmentId]) allDataPayload[assignmentId] = {};
            allDataPayload[assignmentId][subId] = {
                answer: localStorage.getItem(key) || '',
                title: localStorage.getItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || '',
                type: localStorage.getItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`) || '',
                questions: JSON.parse(localStorage.getItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`) || '[]')
            };
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
 * ✅ UPDATED: The confirmation dialog now shows all three pieces of info.
 */
function showConfirmationDialog(studentInfo) {
    return new Promise((resolve) => {
        const existingDialog = document.getElementById('confirm-dialog');
        if (existingDialog) existingDialog.remove();

        const dialog = document.createElement('div');
        dialog.id = 'confirm-dialog';
        dialog.style.cssText = `...`; // Using placeholder for brevity, style is same as before
        dialog.style.cssText = `position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0,0,0,0.6); display: flex; justify-content: center; align-items: center; z-index: 2000;`;

        dialog.innerHTML = `
            <div style="background: white; padding: 2em; border-radius: 8px; text-align: center; max-width: 400px;">
                <p>Du bist dabei, ein Backup deiner Aufträge zu senden mit den folgenden Daten:</p>
                <div style="margin: 1em 0; padding: 0.5em; background: #f0f0f0; border-radius: 4px; text-align: left; padding-left: 1em;">
                    <strong>Klasse:</strong> ${studentInfo.klasse}<br>
                    <strong>Name:</strong> ${studentInfo.name}<br>
                    <strong>Token:</strong> ${studentInfo.token.substring(0,2)}...
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
            localStorage.removeItem(STUDENT_INFO_KEY);
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
    if (!studentInfo) {
        alert("Aktion abgebrochen.");
        return;
    }
    
    const isConfirmed = await showConfirmationDialog(studentInfo);
    if (!isConfirmed) {
        return;
    }
    
    const submissionData = await gatherAllDataForSubmission(studentInfo);
    if (!submissionData) return;

    const submitButton = document.getElementById('submit-all');
    submitButton.textContent = 'Wird übermittelt...';
    submitButton.disabled = true;

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            // ✅ UPDATED: The body of the request now includes the submissionToken
            body: JSON.stringify({
                action: 'submit',
                identifier: submissionData.identifier,
                payload: submissionData.payload,
                submissionToken: studentInfo.token
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