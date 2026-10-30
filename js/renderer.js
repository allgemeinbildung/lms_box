//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :   j s / r e n d e r e r . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { saveDraft, reportPaste } from './api.js';
import { guardEditor } from './pasteGuard.js';
import * as storage from './storage.js';
import { watchProgress } from './progress.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';
/**
 * `unsynced_<assignmentId>_sub_<subId>` in IndexedDB: this sub-assignment holds text the
 * server does not have yet. Value `{ rev, state, answers }` - the complete answers of the
 * sub-assignment as the editors held them, so it can be restored from this one row alone.
 * Written with every keystroke, removed when exactly that revision reached the server.
 * It survives a reload; js/auth.js looks for it before a logout.
 */
export const UNSYNCED_PREFIX = 'unsynced_';
const unsyncedKey = (assignmentId, subId) => `${UNSYNCED_PREFIX}${assignmentId}_sub_${subId}`;
const answerKey = (assignmentId, subId, questionId) => `${ANSWER_PREFIX}${assignmentId}_sub_${subId}_q_${questionId}`;
const isEmptyHtml = (html) => !html || html === '<p><br></p>';

/** Debounce whose pending call can be run at once (`flush`), e.g. before logout. */
function debounce(func, wait) {
    let timeout = null;
    let pendingArgs = null;
    const debounced = function (...args) {
        clearTimeout(timeout);
        pendingArgs = args;
        timeout = setTimeout(() => debounced.flush(), wait);
    };
    debounced.flush = () => {
        clearTimeout(timeout);
        timeout = null;
        if (!pendingArgs) return undefined;
        const args = pendingArgs;
        pendingArgs = null;
        return func(...args);
    };
    return debounced;
}

/**
 * Creates and shows a temporary message over the editor.
 * @param {string} message The message to display.
 * @param {HTMLElement} editorElement The Quill editor element to position the message over.
 */
function showTemporaryMessage(message, editorElement) {
    const msgBox = document.createElement('div');
    msgBox.textContent = message;
    msgBox.style.position = 'absolute';
    msgBox.style.top = '40%';
    msgBox.style.left = '50%';
    msgBox.style.transform = 'translate(-50%, -50%)';
    msgBox.style.backgroundColor = 'rgba(40, 40, 40, 0.85)';
    msgBox.style.color = 'white';
    msgBox.style.padding = '15px 25px';
    msgBox.style.borderRadius = '8px';
    msgBox.style.zIndex = '100';
    msgBox.style.textAlign = 'center';
    msgBox.style.pointerEvents = 'none';

    const editorContainer = editorElement.parentNode;
    if (editorContainer.style.position === '') {
        editorContainer.style.position = 'relative';
    }
    editorContainer.appendChild(msgBox);

    setTimeout(() => {
        msgBox.remove();
    }, 3000);
}

/**
 * Parses simple Markdown (bold, italic) into HTML with specific styling.
 * @param {string} text The text to parse.
 * @returns {string} The HTML string.
 */
function parseMarkdown(text) {
    if (!text) return '';
    const highlightColor = '#007bff';
    let html = text.replace(/\*\*(.*?)\*\*/g, `<strong style="color: ${highlightColor};">$1</strong>`);
    html = html.replace(/([_*])(.*?)\1/g, `<em style="color: ${highlightColor};">$2</em>`);
    return html;
}

/**
 * Updates the UI element that shows the current save status.
 * @param {'saving' | 'local' | 'cloud' | 'error' | 'too_large' | 'browser'} status - The current status.
 */
let shownStatus = null;
function updateSaveStatus(status) {
    shownStatus = status;
    const statusEl = document.getElementById('save-status');
    if (!statusEl) return;
    statusEl.dataset.state = status;

    switch (status) {
        case 'saving':
            statusEl.textContent = 'Speichere...';
            statusEl.style.color = 'var(--c-muted, #6c757d)';
            break;
        case 'local':
            statusEl.textContent = 'Lokal gespeichert.';
            statusEl.style.color = 'var(--c-muted, #6c757d)';
            break;
        case 'cloud':
            statusEl.textContent = 'In der Cloud gespeichert.';
            statusEl.style.color = 'var(--c-ok, #28a745)';
            break;
        case 'error':
            statusEl.textContent = 'Fehler beim Speichern in der Cloud. Nur auf diesem Gerät gesichert.';
            statusEl.style.color = 'var(--c-err, #dc3545)';
            break;
        case 'browser':
            statusEl.textContent = 'Nur in diesem Browser gespeichert.';
            statusEl.style.color = 'var(--c-muted, #6c757d)';
            break;
        case 'too_large':
            statusEl.textContent = 'Nicht gespeichert: Deine Antwort ist zu lang. Bitte kürze sie.';
            statusEl.style.color = 'var(--c-err, #dc3545)';
            break;
    }
}

// ---- saving: this page, its own editors, its own sub-assignment --------------------------
//
// IndexedDB is shared by every iframe of the host page, so it is never the source of a
// save: what goes to the server is read from THIS page's editors. IndexedDB only keeps
// (a) the unsynced marker, to survive a reload, and (b) a copy of all answers for the
// print view.

/**
 * The sub-assignment this page shows. `rev` names the latest change that is not on the
 * server yet (null: everything shown is saved).
 * @type {{assignmentId: string, subId: string, title: string, type: string, questions: Array,
 *         editors: Array<{questionId: string, quill: object}>, rev: string|null}|null}
 */
let page = null;
/** Not signed in: answers stay in this browser (storage.GUEST_DB_NAME), nothing goes to the server. */
let guest = false;
export function setGuestMode() { guest = true; }
/** false | 'suspended' (a logout is being prepared) | 'committed' (the cache is being emptied). */
let closed = false;
let localWrites = Promise.resolve();   // keystroke writes to IndexedDB, in order
let saveQueue = Promise.resolve();     // server writes, one after the other

function collectAnswers() {
    const answers = [];
    for (const { questionId, quill } of page.editors) {
        const html = quill.root.innerHTML;
        if (!isEmptyHtml(html)) answers.push({ questionId, answer: html });
    }
    return answers;
}

/** A change by the student: marker and print copy in one transaction, then the debounced save. */
function recordEdit() {
    const p = page;
    const rev = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const answers = collectAnswers();
    if (guest) {
        // The answer rows are the guest's only copy: no marker, no server.
        localWrites = localWrites.then(() => storage.atomic(async (tx) => {
            for (const { questionId } of p.editors) {
                const mine = answers.find((a) => a.questionId === questionId);
                if (mine) await tx.set(answerKey(p.assignmentId, p.subId, questionId), mine.answer);
                else await tx.remove(answerKey(p.assignmentId, p.subId, questionId));
            }
        })).then(
            () => updateSaveStatus('browser'),
            (error) => { console.error('Failed to save locally:', error); updateSaveStatus('error'); },
        );
        return;
    }
    p.rev = rev;
    updateSaveStatus('saving');
    localWrites = localWrites.then(() => storage.atomic(async (tx) => {
        await tx.set(unsyncedKey(p.assignmentId, p.subId), { rev, state: 'local', answers });
        for (const { questionId } of p.editors) {
            const mine = answers.find((a) => a.questionId === questionId);
            if (mine) await tx.set(answerKey(p.assignmentId, p.subId, questionId), mine.answer);
            else await tx.remove(answerKey(p.assignmentId, p.subId, questionId));
        }
    })).then(
        () => { if (p.rev === rev) updateSaveStatus('local'); },
        (error) => console.error('Failed to save locally:', error),
    );
    gatherAndSaveDraft();
}

/**
 * Writes what the editors hold now to the server. Never throws: the outcome is the
 * status line and the marker ("cloud" only if nothing was typed since; a failure is
 * written into the marker so that it is still shown after a reload).
 */
async function saveNow() {
    const p = page;
    if (!p || p.rev === null || closed === 'committed') return;
    await localWrites;
    const rev = p.rev;
    if (rev === null) return;
    const answers = collectAnswers();
    // A failed save stays "failed" on screen until a save has succeeded.
    if (shownStatus !== 'error' && shownStatus !== 'too_large') updateSaveStatus('saving');

    let failure = null;
    try {
        await saveDraft(p.assignmentId, p.subId, { title: p.title, type: p.type, questions: p.questions, answers });
    } catch (error) {
        console.error("Failed to save draft to server:", error);
        failure = error.code === 'too_large' ? 'too_large' : 'error';
    }

    if (closed !== 'committed') {
        const key = unsyncedKey(p.assignmentId, p.subId);
        try {
            await storage.atomic(async (tx) => {
                const marker = await tx.get(key);
                if (marker && marker.rev !== rev) return;   // a newer change is waiting for its own save
                if (failure) await tx.set(key, { rev, state: failure, answers });
                else if (marker) await tx.remove(key);
            });
        } catch (error) {
            console.error('Failed to update the unsynced marker:', error);
        }
    }
    if (p.rev !== rev) return;   // typed on meanwhile: the text shown is not saved yet
    if (failure) {
        updateSaveStatus(failure);
    } else {
        p.rev = null;
        updateSaveStatus('cloud');
    }
}

function enqueueSave() {
    saveQueue = saveQueue.then(saveNow).catch((error) => console.error('Save failed unexpectedly:', error));
    return saveQueue;
}

/** Debounced to prevent excessive server calls. */
const gatherAndSaveDraft = debounce(enqueueSave, 2000); // Debounce for 2 seconds

/**
 * Saves now whatever is not on the server yet - a save still waiting for its debounce
 * as well as one that failed earlier. Resolves when no save is running any more; it
 * does not throw, ask `hasUnsavedEdits()` for the outcome. Used before logout.
 */
export function flushPendingSave() {
    const ran = gatherAndSaveDraft.flush();
    if (ran === undefined && page && page.rev !== null) enqueueSave();
    return saveQueue;
}

/** True while this page shows text that did not reach the server. */
export function hasUnsavedEdits() {
    return !!page && page.rev !== null;
}

/** True if any sub-assignment in this browser's cache - of any iframe - is marked unsynced. */
export async function hasUnsyncedWork() {
    if (hasUnsavedEdits()) return true;
    const rows = await storage.getAll();
    return rows.some((row) => String(row.key).startsWith(UNSYNCED_PREFIX));
}

/** A logout is being prepared: no more typing until it is cancelled. Saving still works. */
export function suspendSaving() {
    if (closed) return;
    closed = 'suspended';
    for (const { quill } of page?.editors || []) quill.disable();
}

/** The logout was cancelled: typing again, and one more try for what is still unsaved. */
export function resumeSaving() {
    if (closed !== 'suspended') return;
    closed = false;
    for (const { quill } of page?.editors || []) quill.enable();
    if (hasUnsavedEdits()) enqueueSave();
}

/** The logout happens: from now on this page neither saves nor touches the cache. */
export function closeSaving() {
    closed = 'committed';
    for (const { quill } of page?.editors || []) quill.disable();
}

/**
 * Renders Quill editors for each question, handling data loading and saving.
 * @param {object} data - The specific sub-assignment data.
 * @param {string} assignmentId - The ID of the parent assignment.
 * @param {string} subId - The ID of the sub-assignment.
 * @param {Array<{questionId: string, answer: string}>} initialAnswers - What the editors show at first:
 *        the unsynced local answers if there are any, otherwise the server's.
 * @param {object} assignmentData - The full assignment data.
 */
function renderQuill(data, assignmentId, subId, initialAnswers, assignmentData) {
    const contentRenderer = document.getElementById('content-renderer');

    data.questions.forEach((question, index) => {
        const questionBlock = document.createElement('div');
        questionBlock.className = 'question-block';

        const questionText = document.createElement('p');
        questionText.innerHTML = `<strong>${index + 1}.</strong> ${parseMarkdown(question.text)}`;
        questionBlock.appendChild(questionText);

        const sanitizedQuestionId = String(question.id).replace(/[^a-zA-Z0-9-_]/g, '-');
        const sanitizedSubId = String(subId).replace(/[^a-zA-Z0-9-_]/g, '-');
        const editorDiv = document.createElement('div');
        // ✅ FIX: Use subId in ID to avoid collisions when multiple assignments are embedded
        const editorId = `quill-editor-${sanitizedSubId}-${sanitizedQuestionId}`;
        editorDiv.id = editorId;
        questionBlock.appendChild(editorDiv);
        contentRenderer.appendChild(questionBlock);

        const quill = new Quill(editorDiv, {
            theme: 'snow',
            placeholder: 'Deine Antwort...',
            modules: {
                toolbar: false,
                // No keyboard trap (WCAG 2.1.2, K5 / B19): Tab and Shift+Tab leave the editor
                // like in any form field - the browser moves the focus, no tab character.
                // Esc takes the focus out of the editor.
                keyboard: {
                    bindings: {
                        tab: { key: 9, handler: () => true },
                        'remove tab': { key: 9, shiftKey: true, handler: () => true },
                        'leave editor': { key: 27, handler: function () { this.quill.blur(); return false; } }
                    }
                }
            },
            formats: []
        });
        // Guard flag: setting innerHTML via DOM triggers Quill's MutationObserver with
        // source='user', which would fire a save on every page load.
        // We block saves until initialization is complete.
        let isInitializing = true;

        // No fallback to the cache here: without an unsynced marker the server is the
        // truth, and "no answer on the server" means an empty editor.
        const initial = initialAnswers.find((a) => String(a.questionId) === String(question.id))?.answer;
        if (!isEmptyHtml(initial)) {
            quill.root.innerHTML = initial;
            quill.update('silent');   // take the change in now, as "not typed by the student"
        }
        setTimeout(() => { isInitializing = false; }, 0);
        page.editors.push({ questionId: question.id, quill });

        guardEditor(quill, {
            isActive: () => !isInitializing && closed !== 'committed',
            report: (event) => (guest ? Promise.resolve() : reportPaste(assignmentId, subId, question.id, event)),
            showMessage: (message) => showTemporaryMessage(message, quill.root),
        });

        quill.on('text-change', (delta, oldDelta, source) => {
            // Block saves during initialization: setting innerHTML triggers Quill's
            // MutationObserver with source='user', which must not cause a cloud save.
            if (isInitializing || source !== 'user' || closed === 'committed') return;
            recordEdit();
        });
    });

    watchProgress(assignmentId, subId, page.editors);
}

/**
 * Brings the local IndexedDB copy of ALL sub-assignments of this assignment in line with
 * the server. The page saves only its own sub-assignment, but the print view needs them all.
 * A sub-assignment with an unsynced marker - this page's or a sibling iframe's - is left
 * alone: its local text is newer than what the server has. For every other one the server
 * is the truth, and an answer the server does not have is removed from the cache.
 * @param {string} assignmentId - The ID of the assignment.
 * @param {object} draftData - The pre-fetched draft data from the server.
 * @param {object} assignmentData - The full assignment (for the list of sub-assignments and questions).
 */
export async function syncDraftToStorage(assignmentId, draftData, assignmentData) {
    const serverSubs = draftData?.assignments?.[assignmentId] || {};
    const contentSubs = assignmentData?.subAssignments || {};
    const subIds = new Set([...Object.keys(contentSubs), ...Object.keys(serverSubs)]);

    for (const subId of subIds) {
        const subData = serverSubs[subId] || {};
        const answers = new Map((Array.isArray(subData.answers) ? subData.answers : []).map((a) => [String(a.questionId), a.answer]));
        const questions = contentSubs[subId]?.questions || subData.questions || [];
        const questionIds = new Set([...questions.map((q) => String(q.id)), ...answers.keys()]);

        // Check and write in one transaction: a sibling's keystroke lands before or after, never in between.
        await storage.atomic(async (tx) => {
            if (await tx.get(unsyncedKey(assignmentId, subId))) return;
            for (const questionId of questionIds) {
                const answer = answers.get(questionId);
                if (!isEmptyHtml(answer)) await tx.set(answerKey(assignmentId, subId, questionId), answer);
                else await tx.remove(answerKey(assignmentId, subId, questionId));
            }
        });

        // Sync metadata (needed for printer and offline support)
        if (subData.questions) {
            await storage.set(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subData.questions));
        }
        if (subData.title) {
            await storage.set(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subData.title);
        }
        if (subData.type) {
            await storage.set(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subData.type);
        }
    }
}

/**
 * Main rendering router. It accepts the pre-fetched drafts.
 * @param {object} assignmentData - The full data object for the entire assignment.
 * @param {string} assignmentId - The ID of the assignment.
 * @param {string} subId - The ID of the specific sub-assignment to render.
 * @param {object} draftData - The pre-fetched draft data from the server.
 */
export async function renderSubAssignment(assignmentData, assignmentId, subId, draftData) {
    const subAssignmentData = assignmentData.subAssignments[subId];

    // `titel` is an optional display title. The key (subId) must stay unchanged:
    // saved drafts and the Obsidian embeds refer to it, typos included.
    document.getElementById('sub-title').textContent = subAssignmentData.titel || subId;
    document.getElementById('content-renderer').innerHTML = '';

    // Save metadata to IndexedDB for other modules (like the printer)
    await storage.set(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subAssignmentData.questions));
    await storage.set(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subId);
    await storage.set(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.type);

    // Text of this sub-assignment that never reached the server (failed save, or a reload
    // inside the debounce) wins over the server copy, is shown, and is saved again.
    let unsynced = null;
    try {
        unsynced = await storage.get(unsyncedKey(assignmentId, subId));
    } catch (error) {
        console.error('Failed to read the unsynced marker:', error);
    }
    if (!unsynced || !Array.isArray(unsynced.answers) || !unsynced.rev) unsynced = null;
    let serverAnswers = draftData?.assignments?.[assignmentId]?.[subId]?.answers || [];
    if (guest) {
        // A guest has no server copy: what this browser holds is the truth.
        unsynced = null;
        serverAnswers = [];
        for (const q of subAssignmentData.questions || []) {
            let answer = null;
            try { answer = await storage.get(answerKey(assignmentId, subId, q.id)); } catch (error) { console.error('Failed to read a local answer:', error); }
            if (!isEmptyHtml(answer)) serverAnswers.push({ questionId: String(q.id), answer });
        }
    }

    if (subAssignmentData.type === 'quill') {
        page = {
            assignmentId, subId,
            title: subId,
            type: subAssignmentData.type,
            questions: subAssignmentData.questions,
            editors: [],
            rev: unsynced ? unsynced.rev : null,
        };
        renderQuill(subAssignmentData, assignmentId, subId, unsynced ? unsynced.answers : serverAnswers, assignmentData);
        if (guest && serverAnswers.length) updateSaveStatus('browser');
        if (unsynced) {
            updateSaveStatus(['error', 'too_large'].includes(unsynced.state) ? unsynced.state : 'local');
            enqueueSave();
        }
    } else {
        document.getElementById('content-renderer').innerHTML = `<p>Unbekannter Aufgabentyp: ${subAssignmentData.type}</p>`;
    }
}
