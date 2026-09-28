import { getAssignment, getDraft } from './api.js';
import { renderSubAssignment, syncDraftToStorage } from './renderer.js';
import { printAssignmentAnswers } from './printer.js';
import { submitAllAssignments } from './submission.js';
import { authenticate } from './auth.js';
import { fetchAndRenderStudentFeedback } from './studentFeedback.js';
import { initFormativ } from './formativ.js';

document.addEventListener('DOMContentLoaded', async () => {
    const urlParams = new URLSearchParams(window.location.search);
    const assignmentId = urlParams.get('assignmentId');
    const subId = urlParams.get('subId'); // ✅ FIX: Corrected 'url_params' to 'urlParams'
    const mode = urlParams.get('mode') === 'test' ? 'test' : 'live';

    if (!assignmentId || !subId) {
        document.getElementById('main-title').textContent = 'Fehler';
        document.getElementById('content-renderer').innerHTML = '<p>Keine `assignmentId` oder `subId` in der URL gefunden.</p>';
        return;
    }

    const authData = await authenticate(mode);
    if (!authData) {
        document.body.innerHTML = '<h1>Anmeldung erforderlich</h1><p>Der Anmeldevorgang wurde abgebrochen. Bitte lade die Seite neu.</p>';
        return;
    }
    const { key: studentKey, studentInfo } = authData;
    console.log(`Authenticated as ${studentInfo.name} in ${mode} mode.`);

    // ✅ FIX: The line referencing 'submit-all' is correctly removed.
    document.getElementById('print-answers').addEventListener('click', () => printAssignmentAnswers(assignmentId));

    try {
        const assignmentData = await getAssignment(assignmentId);
        const draftData = await getDraft(studentKey, assignmentId, mode);

        if (assignmentData.status === 'error') throw new Error(assignmentData.message);
        document.getElementById('main-title').textContent = assignmentData.assignmentTitle;
        
        // ✅ FIX: Sync ALL answers from the cloud to local storage before rendering.
        // This prevents data loss when saving one sub-assignment from overwriting others.
        await syncDraftToStorage(assignmentId, draftData);
        
        const subAssignmentData = assignmentData.subAssignments[subId];
        if (!subAssignmentData) throw new Error(`Teilaufgabe "${subId}" nicht gefunden.`);
        
        await renderSubAssignment(assignmentData, assignmentId, subId, studentKey, mode, draftData);
        fetchAndRenderStudentFeedback(studentKey, assignmentId, subId, mode);
        initFormativ(assignmentData, assignmentId, subId, studentKey, mode);

    } catch (error) {
        console.error('Fehler beim Laden der Aufgabe:', error);
        document.getElementById('main-title').textContent = 'Fehler';
        document.getElementById('content-renderer').innerHTML = `<p>${error.message}</p>`;
    }
});