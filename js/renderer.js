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

function renderQuill(data, assignmentId, subId) {
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
        // We only store one key at a time, but we can check if it's the one for this assignment context
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
                    // Send assignmentId along with the key for server-side lookup
                    body: JSON.stringify({
                        action: 'verifySolutionKey',
                        assignmentId: assignmentId,
                        key: enteredKey
                    })
                });
                const result = await response.json();

                if (result.isValid) {
                    // Store the key along with its assignment context
                    localStorage.setItem(SOLUTION_KEY_STORAGE, JSON.stringify({ assignmentId, key: enteredKey }));
                    displaySolution(solutionContent);
                } else {
                    statusEl.textContent = 'Falscher Schlüssel. Bitte erneut versuchen.';
                    // If the saved key is wrong for this assignment, remove it
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

        // If a key for this specific assignment is saved, try to unlock automatically
        if (prefilledKey) {
            verifyKey();
        }
    };

    // Check if the fetched assignment data contains keys and a solution
    if (data.solution_keys && data.solution_keys.length > 0 && data.solution && data.solution.content) {
        setupSolutionUnlockUI(data.solution.content);
    }
}

export function renderSubAssignment(subAssignmentData, assignmentId, subId) {
    document.getElementById('sub-title').textContent = subAssignmentData.title;
    document.getElementById('instructions').innerHTML = subAssignmentData.instructions;
    document.getElementById('content-renderer').innerHTML = '';

    // Save metadata to localStorage for other modules
    localStorage.setItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subAssignmentData.questions));
    localStorage.setItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.title);
    localStorage.setItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.type);

    if (subAssignmentData.type === 'quill') {
        renderQuill(subAssignmentData, assignmentId, subId);
    } else {
        document.getElementById('content-renderer').innerHTML = `<p>Unbekannter Aufgabentyp: ${subAssignmentData.type}</p>`;
    }
}
