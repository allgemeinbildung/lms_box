import { getAssignment, getDraft } from './api.js';
import { renderSubAssignment, syncDraftToStorage } from './renderer.js';
import { printAssignmentAnswers } from './printer.js';
import { authenticate } from './auth.js';
import { fetchAndRenderStudentFeedback } from './studentFeedback.js';
import { initFormativ } from './formativ.js';
import * as storage from './storage.js';
import { initEmbedHeight } from './embedHeight.js';

document.addEventListener('DOMContentLoaded', async () => {
    initEmbedHeight();
    // Old embeds may still carry `&mode=test`; the parameter is ignored.
    const urlParams = new URLSearchParams(window.location.search);
    const assignmentId = urlParams.get('assignmentId');
    const subId = urlParams.get('subId');

    if (!assignmentId || !subId) {
        document.getElementById('main-title').textContent = 'Fehler';
        document.getElementById('content-renderer').innerHTML = '<p>Keine `assignmentId` oder `subId` in der URL gefunden.</p>';
        return;
    }

    // Resolves only for a signed-in student; until then auth.js shows the login
    // dialog or a message.
    const { student } = await authenticate();
    await storage.set('studentInfo', { name: student.name });   // local only, for the print view

    let assignmentData = null;
    document.getElementById('print-answers').addEventListener('click', async () => {
        // The print view reads every sub-assignment from the cache. The other iframes may
        // have saved since this page loaded, so fetch their server state again first.
        if (assignmentData) {
            try { await syncDraftToStorage(assignmentId, await getDraft(assignmentId), assignmentData); } catch { /* offline: print what the cache holds */ }
        }
        printAssignmentAnswers(assignmentId);
    });

    try {
        assignmentData = await getAssignment(assignmentId);
        const draftData = await getDraft(assignmentId);

        document.getElementById('main-title').textContent = assignmentData.assignmentTitle;

        // Sync ALL of the student's answers of this assignment into local storage
        // before rendering: the print view shows every sub-assignment. Sub-assignments
        // with unsynced local text are left as they are (see renderer.js).
        await syncDraftToStorage(assignmentId, draftData, assignmentData);

        const subAssignmentData = assignmentData.subAssignments?.[subId];
        if (!subAssignmentData) throw new Error(`Teilaufgabe "${subId}" nicht gefunden.`);

        await renderSubAssignment(assignmentData, assignmentId, subId, draftData);
        fetchAndRenderStudentFeedback(assignmentId, subId);
        initFormativ(assignmentData, assignmentId, subId);

    } catch (error) {
        console.error('Fehler beim Laden der Aufgabe:', error);
        document.getElementById('main-title').textContent = 'Fehler';
        const p = document.createElement('p');
        p.textContent = error.message;   // carries text from the URL: never as HTML
        document.getElementById('content-renderer').replaceChildren(p);
    }
});
