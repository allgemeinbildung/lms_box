import { SCRIPT_URL } from './config.js';
import { renderSubAssignment } from './renderer.js';
import { printAssignmentAnswers } from './printer.js';
import { submitAllAssignments } from './submission.js';
import { authenticate } from './auth.js'; // Import the new auth module

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const assignmentId = urlParams.get('assignmentId');
    const subId = urlParams.get('subId');
    const mode = urlParams.get('mode') === 'test' ? 'test' : 'live'; // Determine mode

    if (!assignmentId || !subId) {
        document.getElementById('main-title').textContent = 'Fehler';
        document.getElementById('content-renderer').innerHTML = '<p>Keine `assignmentId` oder `subId` in der URL gefunden.</p>';
        return;
    }

    // --- NEW AUTHENTICATION FLOW ---
    const authData = await authenticate(SCRIPT_URL, mode);
    if (!authData) {
        document.body.innerHTML = '<h1>Anmeldung erforderlich</h1><p>Der Anmeldevorgang wurde abgebrochen. Bitte lade die Seite neu.</p>';
        return;
    }
    const { key: studentKey, studentInfo } = authData;
    console.log(`Authenticated as ${studentInfo.name} in ${mode} mode.`);
    // --- END OF AUTH FLOW ---

    // Attach event listeners (pass the key to submission)
    document.getElementById('submit-all').addEventListener('click', () => submitAllAssignments(studentKey, mode));
    document.getElementById('print-answers').addEventListener('click', () => printAssignmentAnswers(assignmentId));

    // Fetch assignment data and then fetch the draft
    try {
        const assignmentResponse = await fetch(`${SCRIPT_URL}?assignmentId=${assignmentId}`);
        if (!assignmentResponse.ok) throw new Error(`Network error: ${assignmentResponse.statusText}`);
        const assignmentData = await assignmentResponse.json();

        const draftResponse = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'getDraft',
                studentKey: studentKey,
                assignmentId: assignmentId,
                mode: mode
            })
        });
        if (!draftResponse.ok) throw new Error('Could not fetch draft.');
        const draftData = await draftResponse.json();

        if (assignmentData.status === 'error') throw new Error(assignmentData.message);
        document.getElementById('main-title').textContent = assignmentData.assignmentTitle;
        
        const subAssignmentData = assignmentData.subAssignments[subId];
        if (!subAssignmentData) throw new Error(`Teilaufgabe "${subId}" nicht gefunden.`);
        
        // Pass all necessary data to the renderer
        renderSubAssignment(assignmentData, assignmentId, subId, studentKey, mode, draftData);

    } catch (error) {
        console.error('Fehler beim Laden der Aufgabe:', error);
        document.getElementById('main-title').textContent = 'Fehler';
        document.getElementById('content-renderer').innerHTML = `<p>${error.message}</p>`;
    }
});