import { SCRIPT_URL } from './config.js';
import * as storage from './storage.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';
const SOLUTION_KEYS_STORE = 'modular-assignment-keys-store';

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
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
 * @param {'saving' | 'local' | 'cloud' | 'error'} status - The current status.
 */
function updateSaveStatus(status) {
    const statusEl = document.getElementById('save-status');
    if (!statusEl) return;

    switch (status) {
        case 'saving':
            statusEl.textContent = 'Speichere...';
            statusEl.style.color = '#6c757d';
            break;
        case 'local':
            statusEl.textContent = 'Lokal gespeichert.';
            statusEl.style.color = '#6c757d';
            break;
        case 'cloud':
            statusEl.textContent = 'In der Cloud gespeichert.';
            statusEl.style.color = '#28a745';
            break;
        case 'error':
            statusEl.textContent = 'Fehler beim Speichern in der Cloud. Offline gesichert.';
            statusEl.style.color = '#dc3545';
            break;
    }
}

/**
 * Gathers all answers for a specific assignment from IndexedDB and saves a draft to the server.
 * This function is debounced to prevent excessive server calls.
 */
const gatherAndSaveDraft = debounce(async (studentKey, assignmentId, mode) => {
    updateSaveStatus('saving');
    
    const allStoredData = await storage.getAll();
    const dataMap = new Map(allStoredData.map(item => [item.key, item.value]));
    const answerRegex = new RegExp(`^${ANSWER_PREFIX}${assignmentId}_sub_(.+)_q_(.+)$`);
    
    const allDataPayload = {};
    allDataPayload[assignmentId] = {};

    for (const [key, value] of dataMap.entries()) {
        const match = key.match(answerRegex);
        if (match) {
            const [, subId, questionId] = match;
            
            if (!allDataPayload[assignmentId][subId]) {
                const title = dataMap.get(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || subId;
                const type = dataMap.get(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`) || 'quill';
                const questionsStr = dataMap.get(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`);
                const questions = questionsStr ? JSON.parse(questionsStr) : [];

                allDataPayload[assignmentId][subId] = { title, type, questions, answers: [] };
            }
            
            allDataPayload[assignmentId][subId].answers.push({
                questionId: questionId,
                answer: value || ''
            });
        }
    }

    const submissionPayload = {
        assignments: allDataPayload,
        createdAt: new Date().toISOString()
    };

    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'saveDraft',
                studentKey: studentKey,
                assignmentId: assignmentId,
                payload: submissionPayload,
                mode: mode
            })
        });
        if (!response.ok) throw new Error('Server response was not OK');
        const result = await response.json();
        if (result.status !== 'success') throw new Error(result.message);
        
        updateSaveStatus('cloud');
    } catch (error) {
        console.error("Failed to save draft to server:", error);
        updateSaveStatus('error');
    }
}, 2000); // Debounce for 2 seconds

/**
 * Renders Quill editors for each question, handling data loading and saving.
 * @param {object} data - The specific sub-assignment data.
 * @param {string} assignmentId - The ID of the parent assignment.
 * @param {string} subId - The ID of the sub-assignment.
 * @param {string} studentKey - The authenticated student's key.
 * @param {string} mode - The current mode ('test' or 'live').
 * @param {object} draftData - The pre-fetched draft data from the server.
 * @param {object} assignmentData - The full assignment data for accessing top-level properties like solution_keys.
 */
function renderQuill(data, assignmentId, subId, studentKey, mode, draftData, assignmentData) {
    const contentRenderer = document.getElementById('content-renderer');
    const solutionSection = document.getElementById('solution-section');
    const solutionUnlockContainer = document.getElementById('solution-unlock-container');
    const solutionDisplayContainer = document.getElementById('solution-display-container');

    data.questions.forEach((question, index) => {
        const questionBlock = document.createElement('div');
        questionBlock.className = 'question-block';
        questionBlock.style.marginBottom = '2.5em';

        const questionText = document.createElement('p');
        questionText.innerHTML = `<strong>${index + 1}.</strong> ${parseMarkdown(question.text)}`;
        questionText.style.fontSize = '1.1em';
        questionBlock.appendChild(questionText);

        const sanitizedQuestionId = String(question.id).replace(/[^a-zA-Z0-9-_]/g, '-');
        const editorDiv = document.createElement('div');
        const editorId = `quill-editor-${sanitizedQuestionId}`;
        editorDiv.id = editorId;
        questionBlock.appendChild(editorDiv);
        contentRenderer.appendChild(questionBlock);

        const quill = new Quill(`#${editorId}`, { theme: 'snow' });
        const storageKey = `${ANSWER_PREFIX}${assignmentId}_sub_${subId}_q_${question.id}`;

        // --- NEW DATA LOADING LOGIC ---
        // 1. Prioritize loading from the draft data fetched from the server.
        const serverAnswer = draftData?.assignments?.[assignmentId]?.[subId]?.answers?.find(a => a.questionId === question.id)?.answer;
        
        if (serverAnswer) {
            quill.root.innerHTML = serverAnswer;
            // Also update local storage to be in sync
            storage.set(storageKey, serverAnswer);
        } else {
            // 2. Fallback to local IndexedDB storage (for offline changes).
            storage.get(storageKey).then(savedAnswer => {
                if (savedAnswer) {
                    quill.root.innerHTML = savedAnswer;
                }
            });
        }

        quill.root.addEventListener('paste', (e) => {
            e.preventDefault();
            showTemporaryMessage('Einfügen ist deaktiviert, um die Kreativität und das kritische Denken zu fördern.', quill.root);
        });

        // --- NEW AUTO-SAVE LOGIC ---
        quill.on('text-change', async () => {
            const htmlContent = quill.root.innerHTML;
            
            // Step 1: Save locally immediately for responsiveness and offline safety.
            if (htmlContent && htmlContent !== '<p><br></p>') {
                await storage.set(storageKey, htmlContent);
            } else {
                await storage.remove(storageKey);
            }
            updateSaveStatus('local');

            // Step 2: Trigger the debounced function to save the entire draft to the server.
            gatherAndSaveDraft(studentKey, assignmentId, mode);
        });
    });

    // --- Solution Unlock Logic ---
    if (data.solution && Array.isArray(data.solution.solutions) && data.solution.solutions.length > 0) {
        solutionSection.style.display = 'block';
        
        const unlockedSolutions = JSON.parse(sessionStorage.getItem(SOLUTION_KEYS_STORE) || '{}');
        if (unlockedSolutions[assignmentId]) {
            solutionUnlockContainer.style.display = 'none';
            
            // ✅ FIX START: Look up question text using questionId from the solution object.
            const questionMap = new Map(data.questions.map(q => [q.id, q.text]));
            let solutionHtml = '<h3>Musterlösung</h3>';
            data.solution.solutions.forEach(sol => {
                const questionText = questionMap.get(sol.questionId) || 'Frage nicht gefunden';
                solutionHtml += `<div class="solution-item" style="margin-top: 1em;"><strong>Frage: ${parseMarkdown(questionText)}</strong><div class="answer-box" style="padding: 1em; border: 1px solid #e0e0e0; border-radius: 4px; background-color: #fdfdfd; margin-top: 0.5em;">${sol.answer}</div></div>`;
            });
            // ✅ FIX END
            
            solutionDisplayContainer.innerHTML = solutionHtml;
            solutionDisplayContainer.style.display = 'block';
        } else {
            solutionUnlockContainer.innerHTML = `
                <p>Um die Musterlösung anzuzeigen, gib bitte den Freischalt-Code ein:</p>
                <input type="text" id="solution-key-input" placeholder="Freischalt-Code" style="margin-right: 10px;">
                <button id="unlock-solution-btn">Freischalten</button>
                <p id="unlock-status" style="color: red; margin-top: 5px;"></p>
            `;

            const unlockBtn = document.getElementById('unlock-solution-btn');
            const keyInput = document.getElementById('solution-key-input');
            const unlockStatus = document.getElementById('unlock-status');

            const unlockAction = () => {
                const enteredKey = keyInput.value.trim();
                if (assignmentData.solution_keys && assignmentData.solution_keys.includes(enteredKey)) {
                    unlockStatus.textContent = '';
                    solutionUnlockContainer.style.display = 'none';

                    // ✅ FIX START: Same fix as above for when the solution is first unlocked.
                    const questionMap = new Map(data.questions.map(q => [q.id, q.text]));
                    let solutionHtml = '<h3>Musterlösung</h3>';
                    data.solution.solutions.forEach(sol => {
                        const questionText = questionMap.get(sol.questionId) || 'Frage nicht gefunden';
                        solutionHtml += `<div class="solution-item" style="margin-top: 1em;"><strong>Frage: ${parseMarkdown(questionText)}</strong><div class="answer-box" style="padding: 1em; border: 1px solid #e0e0e0; border-radius: 4px; background-color: #fdfdfd; margin-top: 0.5em;">${sol.answer}</div></div>`;
                    });
                    // ✅ FIX END

                    solutionDisplayContainer.innerHTML = solutionHtml;
                    solutionDisplayContainer.style.display = 'block';

                    const unlocked = JSON.parse(sessionStorage.getItem(SOLUTION_KEYS_STORE) || '{}');
                    unlocked[assignmentId] = true;
                    sessionStorage.setItem(SOLUTION_KEYS_STORE, JSON.stringify(unlocked));
                } else {
                    unlockStatus.textContent = 'Falscher Code. Bitte versuche es erneut.';
                    keyInput.value = '';
                }
            };

            unlockBtn.addEventListener('click', unlockAction);
            keyInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') unlockAction();
            });
        }
    }
}

/**
 * Main rendering router. It now accepts auth data and pre-fetched drafts.
 * @param {object} assignmentData - The full data object for the entire assignment.
 * @param {string} assignmentId - The ID of the assignment.
 * @param {string} subId - The ID of the specific sub-assignment to render.
 * @param {string} studentKey - The authenticated student's key.
 * @param {string} mode - The current mode ('test' or 'live').
 * @param {object} draftData - The pre-fetched draft data from the server.
 */
export async function renderSubAssignment(assignmentData, assignmentId, subId, studentKey, mode, draftData) {
    const subAssignmentData = assignmentData.subAssignments[subId];

    document.getElementById('sub-title').textContent = subId;
    document.getElementById('content-renderer').innerHTML = '';

    // Save metadata to IndexedDB for other modules (like the printer)
    await storage.set(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subAssignmentData.questions));
    await storage.set(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subId);
    await storage.set(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.type);

    if (subAssignmentData.type === 'quill') {
        renderQuill(subAssignmentData, assignmentId, subId, studentKey, mode, draftData, assignmentData);
    } else {
        document.getElementById('content-renderer').innerHTML = `<p>Unbekannter Aufgabentyp: ${subAssignmentData.type}</p>`;
    }
}
