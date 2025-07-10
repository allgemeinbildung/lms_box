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

    return {
        identifier,
        payload: allDataPayload,
        createdAt: new Date().toISOString()
    };
}

export async function submitAllAssignments() {
    const finalObject = await gatherAllDataForSubmission();
    if (!finalObject) return;

    if (!SCRIPT_URL || SCRIPT_URL.includes('YOUR_DEPLOYED_GOOGLE_APPS_SCRIPT_URL')) {
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
            body: JSON.stringify(finalObject)
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
