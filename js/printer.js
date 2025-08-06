import { SCRIPT_URL } from './config.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';

/**
 * Gathers all data for a given assignmentId for printing.
 * It first attempts to fetch the complete assignment structure from the server.
 * It then scans localStorage for any saved answers and metadata (like questions and titles)
 * for all sub-assignments that have been loaded.
 * Finally, it merges these two data sources to create a comprehensive object for printing.
 * @param {string} assignmentId The ID of the assignment to gather data for.
 * @returns {Promise<object>} An object containing the assignment title, student identifier, and all sub-assignments.
 */
async function gatherAssignmentData(assignmentId) {
    const studentIdentifier = localStorage.getItem('studentIdentifier') || 'Unbekannter Schüler';
    let mainTitle = `Aufgabe: ${assignmentId}`;
    let serverSubAssignments = {};

    // 1. Primary Source: Fetch full assignment data from the server
    try {
        const response = await fetch(`${SCRIPT_URL}?assignmentId=${assignmentId}`);
        if (!response.ok) throw new Error(`Server responded with status ${response.status}`);
        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);

        if (data.assignmentTitle) mainTitle = data.assignmentTitle;
        if (data.subAssignments && typeof data.subAssignments === 'object') {
            serverSubAssignments = data.subAssignments;
        }
    } catch (e) {
        console.warn(`Could not fetch full assignment data from server for printing. Falling back to localStorage data only. Reason: ${e.message}`);
    }

    // 2. Secondary Source: A thorough scan of localStorage for all relevant data
    const localSubAssignments = {};
    const prefixes = {
        answer: ANSWER_PREFIX,
        questions: QUESTIONS_PREFIX,
        title: TITLE_PREFIX
    };

    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        let keyType = null;
        let keyContent = '';

        // Determine the type of data based on its localStorage key prefix
        for (const [name, prefix] of Object.entries(prefixes)) {
            if (key.startsWith(prefix)) {
                keyType = name;
                keyContent = key.substring(prefix.length);
                break;
            }
        }

        if (keyType) {
            // Check if the key belongs to the currently requested assignmentId
            const expectedStart = `${assignmentId}_sub_`;
            if (keyContent.startsWith(expectedStart)) {
                const subId = keyContent.substring(expectedStart.length);

                // Initialize a container for this sub-assignment if it's the first time we see it
                if (!localSubAssignments[subId]) {
                    localSubAssignments[subId] = {
                        answer: '',
                        title: subId, // Default title
                        questions: []
                    };
                }

                // Populate the container with the data from localStorage
                const value = localStorage.getItem(key);
                switch (keyType) {
                    case 'answer':
                        localSubAssignments[subId].answer = value || '';
                        break;
                    case 'title':
                        localSubAssignments[subId].title = value || subId;
                        break;
                    case 'questions':
                        try {
                            localSubAssignments[subId].questions = JSON.parse(value || '[]');
                        } catch (err) {
                            console.error(`Could not parse questions for ${subId}:`, err);
                        }
                        break;
                }
            }
        }
    }

    // 3. Merge server data and local data into a final, definitive list
    const finalSubAssignments = {};
    const masterSubIdList = new Set([
        ...Object.keys(serverSubAssignments),
        ...Object.keys(localSubAssignments)
    ]);

    for (const subId of masterSubIdList) {
        const serverData = serverSubAssignments[subId] || {};
        const localData = localSubAssignments[subId] || {};

        finalSubAssignments[subId] = {
            // User's answer is always from local storage.
            answer: localData.answer || '',
            // Prefer the official server title, fall back to local, then to the subId itself.
            title: serverData.title || localData.title || subId,
            // Prefer official server questions, fall back to what was saved locally.
            questions: (serverData.questions && serverData.questions.length > 0) 
                       ? serverData.questions 
                       : (localData.questions || []),
        };
    }
    
    // Handle the edge case where no assignment data could be found at all.
    if (masterSubIdList.size === 0) {
        finalSubAssignments['info'] = {
            answer: '',
            title: 'Keine Aufgaben gefunden',
            questions: [{text: 'Es konnten weder vom Server noch aus dem lokalen Speicher Aufgabeninformationen geladen werden. Stellen Sie sicher, dass Sie mindestens eine Aufgabe auf der Seite geöffnet haben.'}]
        };
    }

    return { studentIdentifier, assignmentTitle: mainTitle, subAssignments: finalSubAssignments };
}

function convertMarkdownToHTML(text) {
    if (!text) return text;
    
    // Convert **bold** to <strong>bold</strong>
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    
    // Convert *italic* to <em>italic</em> (but avoid converting already processed bold)
    text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    
    return text;
}

function generatePrintHTML(data) {
    let bodyContent = `<h1>${convertMarkdownToHTML(data.assignmentTitle)}</h1><p><strong>Schüler/in:</strong> ${data.studentIdentifier}</p><hr>`;
    const sortedSubIds = Object.keys(data.subAssignments).sort();

    for (const subId of sortedSubIds) {
        const subData = data.subAssignments[subId];
        bodyContent += `<div class="sub-assignment"><h2>${convertMarkdownToHTML(subData.title)}</h2>`;
        
        if (subData.questions && subData.questions.length > 0) {
            const questionsHTML = subData.questions.map(q => `<li>${convertMarkdownToHTML(q.text)}</li>`).join('');
            bodyContent += `<h3>Fragen:</h3><ol>${questionsHTML}</ol>`;
        }
        
        bodyContent += `<h3>Antwort:</h3>`;

        // Check if the answer from Quill is empty. An empty editor often contains '<p><br></p>'.
        const isAnswerEmpty = !subData.answer || subData.answer.trim() === '' || subData.answer.trim() === '<p><br></p>';

        if (isAnswerEmpty) {
            // If no answer is provided, render the empty box for handwriting.
            bodyContent += `<div class="answer-box empty-answer-box"></div>`;
        } else {
            // If an answer exists, display it.
            bodyContent += `<div class="answer-box">${subData.answer}</div>`;
        }
        
        bodyContent += `</div>`;
    }

    const css = `
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 2em; }
        h1, h2, h3 { color: #333; }
        h1 { font-size: 2em; border-bottom: 2px solid #ccc; padding-bottom: 0.5em; }
        h2 { font-size: 1.5em; background-color: #f0f0f0; padding: 0.5em; margin-top: 2em; border-left: 5px solid #007bff; }
        h3 { font-size: 1.1em; margin-bottom: 0.5em; margin-top: 1.5em; }
        .sub-assignment { page-break-inside: avoid; margin-bottom: 2em; }
        .answer-box { 
            padding: 10px; 
            border: 1px solid #ddd; 
            border-radius: 4px; 
            margin-top: 0;
            background-color: #f9f9f9; 
        }
        .answer-box p { margin-top: 0; }
        
        /* Styles for the empty box for handwriting */
        .empty-answer-box {
            position: relative;
            min-height: 9em; /* Approx. 6 lines height (6 * 1.5em line-height) */
            background-color: #ffffff;
        }
        .empty-answer-box::before {
            content: '✏';
            position: absolute;
            top: 8px;
            left: 10px;
            color: #aaa;
            font-size: 0.9em;
            font-style: italic;
        }

        ol { padding-left: 20px; }
        hr { border: 0; border-top: 1px solid #ccc; }
        @media print { 
            h2 { background-color: #f0f0f0 !important; -webkit-print-color-adjust: exact; } 
        }
    `;

    return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Druckansicht: ${data.assignmentTitle}</title><style>${css}</style></head><body>${bodyContent}</body></html>`;
}

export async function printAssignmentAnswers(assignmentId) {
    const data = await gatherAssignmentData(assignmentId);
    if (!data) return;

    const htmlContent = generatePrintHTML(data);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert("Popup-Fenster wurde blockiert. Bitte erlaube Popups für diese Seite.");
        return;
    }

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    setTimeout(() => {
        printWindow.focus();
        printWindow.print();
    }, 500);
}