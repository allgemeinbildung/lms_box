import { SCRIPT_URL } from './config.js';

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
    msgBox.style.pointerEvents = 'none'; // Allow clicks to pass through

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
    const highlightColor = '#007bff'; // Color from action buttons in styles.css

    // Replace bold (**text**) with a styled <strong> tag.
    let html = text.replace(/\*\*(.*?)\*\*/g, `<strong style="color: ${highlightColor};">$1</strong>`);
    
    // Replace italic (_text_ or *text*) with a styled <em> tag.
    // This regex handles both _ and * as italic markers.
    html = html.replace(/([_*])(.*?)\1/g, `<em style="color: ${highlightColor};">$2</em>`);

    return html;
}


/**
 * Renders a Quill editor for each question, ensuring valid HTML IDs.
 * @param {object} data - The specific sub-assignment data.
 * @param {string} assignmentId - The ID of the parent assignment.
 * @param {string} subId - The ID of the sub-assignment.
 */
function renderQuill(data, assignmentId, subId) {
    const contentRenderer = document.getElementById('content-renderer');
    const solutionSection = document.getElementById('solution-section');
    const solutionUnlockContainer = document.getElementById('solution-unlock-container');
    const solutionDisplayContainer = document.getElementById('solution-display-container');

    // Loop through each question and create a dedicated block for it.
    data.questions.forEach((question, index) => {
        const questionBlock = document.createElement('div');
        questionBlock.className = 'question-block';
        questionBlock.style.marginBottom = '2.5em';

        const questionText = document.createElement('p');
        questionText.innerHTML = `<strong>${index + 1}.</strong> ${parseMarkdown(question.text)}`;
        questionText.style.fontSize = '1.1em';
        questionBlock.appendChild(questionText);

        // ✅ FIX: Sanitize the question.id to create a valid CSS selector.
        // This replaces characters like '.' with '-' for the HTML element's ID.
        const sanitizedQuestionId = String(question.id).replace(/[^a-zA-Z0-9-_]/g, '-');
        
        // Create a unique editor div for this question using the sanitized ID
        const editorDiv = document.createElement('div');
        const editorId = `quill-editor-${sanitizedQuestionId}`;
        editorDiv.id = editorId;
        questionBlock.appendChild(editorDiv);
        
        contentRenderer.appendChild(questionBlock);

        // Initialize Quill on the unique editor div
        const quill = new Quill(`#${editorId}`, { theme: 'snow' });

        // IMPORTANT: Use the ORIGINAL question.id for the storage key to maintain data integrity.
        const storageKey = `${ANSWER_PREFIX}${assignmentId}_sub_${subId}_q_${question.id}`;

        // DISABLE PASTING
        quill.root.addEventListener('paste', (e) => {
            e.preventDefault();
            showTemporaryMessage('Einfügen ist deaktiviert, um die Kreativität und das kritische Denken zu fördern.', quill.root);
        });

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
    });


    // --- Secure, Assignment-Specific Solution Unlock Logic ---
    const displaySolution = () => {
        const solutionData = data.solution;
        const solutionMap = new Map(solutionData.solutions.map(s => [s.id, s.answer]));

        let html = `<h3>Musterlösung (Seite ${solutionData.page})</h3>`;

        data.questions.forEach((question, index) => {
            const answer = solutionMap.get(question.id) || 'Für diese Frage wurde keine Lösung gefunden.';
            html += `
                <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #eee;">
                    <p style="font-weight: bold;">Frage ${index + 1}:</p>
                    <p style="font-style: italic;">${parseMarkdown(question.text)}</p>
                    <div style="padding: 10px; background-color: #e9f3ff; border-radius: 4px;">${answer}</div>
                </div>
            `;
        });
        
        solutionDisplayContainer.innerHTML = html;
        solutionDisplayContainer.style.display = 'block';
        solutionUnlockContainer.style.display = 'none';
    };

    const setupSolutionUnlockUI = () => {
        const allKeys = JSON.parse(localStorage.getItem(SOLUTION_KEYS_STORE) || '{}');
        const prefilledKey = allKeys[assignmentId] || '';

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
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        action: 'verifySolutionKey',
                        assignmentId: assignmentId,
                        key: enteredKey
                    })
                });
                const result = await response.json();

                if (result.isValid) {
                    const currentKeys = JSON.parse(localStorage.getItem(SOLUTION_KEYS_STORE) || '{}');
                    currentKeys[assignmentId] = enteredKey;
                    localStorage.setItem(SOLUTION_KEYS_STORE, JSON.stringify(currentKeys));
                    displaySolution();
                } else {
                    statusEl.textContent = 'Falscher Schlüssel. Bitte erneut versuchen.';
                    const currentKeys = JSON.parse(localStorage.getItem(SOLUTION_KEYS_STORE) || '{}');
                    if (currentKeys[assignmentId]) {
                        delete currentKeys[assignmentId];
                        localStorage.setItem(SOLUTION_KEYS_STORE, JSON.stringify(currentKeys));
                    }
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
    
    if (data.solution && Array.isArray(data.solution.solutions) && data.solution.solutions.length > 0) {
        solutionSection.style.display = 'block';
        setupSolutionUnlockUI();
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

    document.getElementById('sub-title').textContent = subId;
    document.getElementById('content-renderer').innerHTML = '';

    // Save metadata to localStorage for other modules
    localStorage.setItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`, JSON.stringify(subAssignmentData.questions));
    localStorage.setItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`, subId);
    localStorage.setItem(`${TYPE_PREFIX}${assignmentId}_sub_${subId}`, subAssignmentData.type);

    if (subAssignmentData.type === 'quill') {
        renderQuill(subAssignmentData, assignmentId, subId);
    } else {
        document.getElementById('content-renderer').innerHTML = `<p>Unbekannter Aufgabentyp: ${subAssignmentData.type}</p>`;
    }
}