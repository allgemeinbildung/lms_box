import { SCRIPT_URL } from './config.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';
const TYPE_PREFIX = 'type_';
const SOLUTION_KEY_STORAGE = 'modular-assignment-solution-key';

function debounce(func, wait) {
    let timeout;
    return function(...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/**
 * Renders the Quill editor and the solution-unlocking interface.
 * @param {object} data - The specific sub-assignment data.
 * @param {string} assignmentId - The ID of the parent assignment.
 * @param {string} subId - The ID of the sub-assignment.
 * @param {string[]} [solutionKeys=[]] - The array of valid keys from the parent assignment.
 */
function renderQuill(data, assignmentId, subId, solutionKeys = []) {
    const contentRenderer = document.getElementById('content-renderer');
    const solutionUnlockContainer = document.getElementById('solution-unlock-container');
    const solutionDisplayContainer = document.getElementById('solution-display-container');
    const storageKey = `${ANSWER_PREFIX}${assignmentId}_sub_${subId}`;

    // Render the list of questions
    const questionsList = document.createElement('ol');
    data.questions.forEach(q => {
        const listItem = document.createElement('li');
        listItem.innerHTML = q.text;
        questionsList.appendChild(listItem);
    });
    contentRenderer.appendChild(questionsList);

    // Initialize Quill editor
    const editorDiv = document.createElement('div');
    editorDiv.id = 'quill-editor';
    contentRenderer.appendChild(editorDiv);
    const quill = new Quill('#quill-editor', { theme: 'snow' });

    // Load saved answer from localStorage
    quill.root.innerHTML = localStorage.getItem(storageKey) || '';

    // Save content to localStorage on change
    quill.on('text-change', debounce(() => {
        const htmlContent = quill.root.innerHTML;
        if (htmlContent && htmlContent !== '<p><br></p>') {
            localStorage.setItem(storageKey, htmlContent);
        } else {
            localStorage.removeItem(storageKey);
        }
    }, 500));

    // --- Secure, Assignment-Specific Solution Unlock Logic ---
    const displaySolution = (solutionHTML) => {
        solutionDisplayContainer.innerHTML = `<h3>Musterlösung</h3>${solutionHTML}`;
        solutionDisplayContainer.style.display = 'block';
        solutionUnlockContainer.style.display = 'none';
    };

    const setupSolutionUnlockUI = (solutionContent) => {
        const savedKeyData = JSON.parse(localStorage.getItem(SOLUTION_KEY_STORAGE) || '{}');
        const prefilledKey = savedKeyData.assignmentId === assignmentId ? savedKeyData.key : '';

        solutionUnlockContainer.innerHTML = `
            <input type="text" id="solution-key-input" placeholder="Lösungsschlüssel eingeben..." value="${prefilledKey}" style="margin-right: 10px; padding: 8px; border: 1px solid #ccc; border-radius: 4px;">
            <button id="solution-unlock-btn">Lösung anzeigen</button>
            <p id="solution-status" style="color: #721c24; margin-top: 5px;"></p>
        `;

        const unlockBtn = document.getElementById('solution-unlock-btn');
        const keyInput = document.getElementById('solution-key-input');
        const statusEl = document.getElementById('solution-status');

        const verifyKey = async () => {
            const enteredKey = keyInput.value.trim();
            if (!enteredKey) return;

            statusEl.textContent = 'Prüfe Schlüssel...';
            unlockBtn.disabled = true;

            try {
                const response = await fetch(SCRIPT_URL, {
                    method: 'POST',
                    mode: 'cors',
                    body: JSON.stringify({
                        action: 'verifySolutionKey',
                        assignmentId: assignmentId,
                        key: enteredKey
                    })
                });
                const result = await response.json();

                if (result.isValid) {
                    localStorage.setItem(SOLUTION_KEY_STORAGE, JSON.stringify({ assignmentId, key: enteredKey }));
                    displaySolution(solutionContent);
                } else {
                    statusEl.textContent = 'Falscher Schlüssel. Bitte erneut versuchen.';
                    if (prefilledKey) localStorage.removeItem(SOLUTION_KEY_STORAGE);
                }
            } catch (error) {
                statusEl.textContent = 'Fehler bei der Überprüfung des Schlüssels.';
            } finally {
                unlockBtn.disabled = false;
            }
        };

        unlockBtn.addEventListener('click', verifyKey);
        keyInput.addEventListener('keydown', (e) => {
            statusEl.textContent = '';
            if (e.key === 'Enter') verifyKey();
        });

        if (prefilledKey) {
            verifyKey();
        }
    };

    // CORRECTED: Check the passed-in solutionKeys array and the sub-assignment's solution object
    if (solutionKeys && solutionKeys.length > 0 && data.solution && data.solution.content) {
        setupSolutionUnlockUI(data.solution.content);
    }
}

/**
 * Main rendering router. It now accepts the entire assignment data object.
 * @param {object} assignmentData - The full data object for the entire assignment.
 * @param {string} assignmentId - The ID of the assignment.
 * @param {string} subId - The ID of the specific sub-assignment to render.
 */
export function renderSubAssignment(assignmentData, assignmentId, subId) {
    const subAssignmentData = assignmentData.subAssignments[subId];
    const solutionKeys = assignmentData.solution_keys; // Extract keys from the top level

    document.getElementById('sub-title').textContent = subAssignmentData.title;
    document.getElementById('instructions').innerHTML = subAssignmentData.instructions;
    document.getElementById('content-renderer').innerHTML = '';

    // Save metadata to localStorage for other modules
    localStorage.setItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subAssignmentData.questions));
    localStorage.setItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.title);
    localStorage.setItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.type);

    if (subAssignmentData.type === 'quill') {
        // Pass the extracted keys down to the rendering function
        renderQuill(subAssignmentData, assignmentId, subId, solutionKeys);
    } else {
        document.getElementById('content-renderer').innerHTML = `<p>Unbekannter Aufgabentyp: ${subAssignmentData.type}</p>`;
    }
}
