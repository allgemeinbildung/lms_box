import { SCRIPT_URL } from './config.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';

async function gatherAllDataForSubmission() {
    let identifier = localStorage.getItem('studentIdentifier');
    if (!identifier) {
        identifier = prompt('Bitte gib deinen Namen oder eine eindeutige Kennung für die Abgabe ein:', '');
        if (!identifier) {
            alert('Aktion abgebrochen. Eine Kennung ist erforderlich.');
            return null;
        }
        localStorage.setItem('studentIdentifier', identifier);
    }

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

    // This is the object that will be sent to the Cloud Function
    return {
        identifier,
        payload: {
            assignments: allDataPayload,
            createdAt: new Date().toISOString()
        }
    };
}

export async function submitAllAssignments() {
    const submissionData = await gatherAllDataForSubmission();
    if (!submissionData) return;

    if (!SCRIPT_URL || SCRIPT_URL.includes('YOUR_CLOUD_FUNCTION_TRIGGER_URL')) {
        alert('Konfigurationsfehler: Die Abgabe-URL ist nicht in js/config.js festgelegt.');
        return;
    }

    if (!confirm("Du bist dabei, ein Backup ALLER gespeicherten Aufträge zu senden. Fortfahren?")) {
        alert("Aktion abgebrochen.");
        return;
    }

    const submitButton = document.getElementById('submit-all');
    submitButton.textContent = 'Wird übermittelt...';
    submitButton.disabled = true;

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            // ✅ FIXED: Added Content-Type header
            headers: {
                'Content-Type': 'application/json',
            },
            // ✅ FIXED: Sending data in the format the Cloud Function expects
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
