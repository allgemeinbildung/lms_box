import { getAssignment, getDraft } from './api.js';
import { renderSubAssignment, syncDraftToStorage, setGuestMode } from './renderer.js';
import { printAssignmentAnswers } from './printer.js';
import { authenticate } from './auth.js';
import { fetchAndRenderStudentFeedback } from './studentFeedback.js';
import { initFormativ } from './formativ.js';
import * as storage from './storage.js';
import { initEmbedHeight } from './embedHeight.js';
import { initProgress } from './progress.js';

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

    // Resolves for a signed-in student, or at once as a guest (not signed in: answers stay
    // in this browser, no feedback). For accounts that cannot work here auth.js shows a message.
    const { uid, student, guest } = await authenticate();
    initProgress(uid);
    if (guest) {
        storage.useDatabase(storage.GUEST_DB_NAME);   // before any other storage call
        setGuestMode();
    } else {
        await storage.set('studentInfo', { name: student.name });   // local only, for the print view
    }

    let assignmentData = null;
    document.getElementById('print-answers').addEventListener('click', async () => {
        // The print view reads every sub-assignment from the cache. The other iframes may
        // have saved since this page loaded, so fetch their server state again first.
        if (assignmentData && !guest) {
            try { await syncDraftToStorage(assignmentId, await getDraft(assignmentId), assignmentData); } catch { /* offline: print what the cache holds */ }
        }
        printAssignmentAnswers(assignmentId);
    });

    try {
        assignmentData = await getAssignment(assignmentId);
        const draftData = guest ? null : await getDraft(assignmentId);

        document.getElementById('main-title').textContent = assignmentData.assignmentTitle;

        // Sync ALL of the student's answers of this assignment into local storage
        // before rendering: the print view shows every sub-assignment. Sub-assignments
        // with unsynced local text are left as they are (see renderer.js).
        if (!guest) await syncDraftToStorage(assignmentId, draftData, assignmentData);

        const subAssignmentData = assignmentData.subAssignments?.[subId];
        if (!subAssignmentData) throw new Error(`Teilaufgabe "${subId}" nicht gefunden.`);

        await renderSubAssignment(assignmentData, assignmentId, subId, draftData);
        if (!guest) {
            fetchAndRenderStudentFeedback(assignmentId, subId);
            initFormativ(assignmentData, assignmentId, subId);
        }

    } catch (error) {
        console.error('Fehler beim Laden der Aufgabe:', error);
        document.getElementById('main-title').textContent = 'Fehler';
        const p = document.createElement('p');
        p.textContent = error.message;   // carries text from the URL: never as HTML
        document.getElementById('content-renderer').replaceChildren(p);
    }
});
