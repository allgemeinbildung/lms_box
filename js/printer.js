import { getAssignment, getFormativStatus } from './api.js';
import * as storage from './storage.js';

const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';

/**
 * Gathers all data for printing from IndexedDB and the server.
 * @param {string} assignmentId The ID of the assignment to gather data for.
 * @returns {Promise<object>} An object containing the assignment title, student identifier, and all sub-assignments.
 */
async function gatherAssignmentData(assignmentId) {
    const studentInfo = await storage.get('studentInfo');
    const studentIdentifier = studentInfo ? studentInfo.name : 'Unbekannter Schüler';
    let mainTitle = `Aufgabe: ${assignmentId}`;
    let serverSubAssignments = {};

    // 1. Primary Source: Fetch full assignment data from the server
    try {
        const data = await getAssignment(assignmentId);

        if (data.assignmentTitle) mainTitle = data.assignmentTitle;
        if (data.subAssignments && typeof data.subAssignments === 'object') {
            serverSubAssignments = data.subAssignments;
        }
    } catch (e) {
        console.warn(`Could not fetch full assignment data from server for printing. Falling back to local data only. Reason: ${e.message}`);
    }

    // 2. Secondary Source: A thorough scan of IndexedDB for all relevant data
    const localSubAssignments = {};
    const allStoredData = await storage.getAll();
    const dataMap = new Map(allStoredData.map(item => [item.key, item.value]));
    
    for (const [key, value] of dataMap.entries()) {
        if (key.startsWith(TITLE_PREFIX)) {
            const keyContent = key.substring(TITLE_PREFIX.length);
            const expectedStart = `${assignmentId}_sub_`;
            if (keyContent.startsWith(expectedStart)) {
                const subId = keyContent.substring(expectedStart.length);

                if (!localSubAssignments[subId]) {
                    const questionsStr = dataMap.get(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`);
                    const questions = questionsStr ? JSON.parse(questionsStr) : [];
                    const answers = [];

                    questions.forEach(q => {
                        const answerKey = `${ANSWER_PREFIX}${assignmentId}_sub_${subId}_q_${q.id}`;
                        const answer = dataMap.get(answerKey) || '';
                        answers.push({ questionId: q.id, answer });
                    });

                    localSubAssignments[subId] = {
                        title: value || subId,
                        questions: questions,
                        answers: answers
                    };
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
            title: serverData.title || localData.title || subId,
            questions: (serverData.questions && serverData.questions.length > 0) 
                       ? serverData.questions 
                       : (localData.questions || []),
            answers: localData.answers || []
        };
    }
    
    if (masterSubIdList.size === 0) {
        finalSubAssignments['info'] = {
            title: 'Keine Aufgaben gefunden',
            questions: [{text: 'Es konnten weder vom Server noch aus dem lokalen Speicher Aufgabeninformationen geladen werden. Stellen Sie sicher, dass Sie mindestens eine Aufgabe auf der Seite geöffnet haben.'}],
            answers: []
        };
    }

    return { studentIdentifier, assignmentTitle: mainTitle, subAssignments: finalSubAssignments };
}

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const FORMATIV_STATUS = { erfuellt: '✓ erfüllt', teilweise: '◐ teilweise', fehlt: '✗ fehlt', nicht_beurteilbar: '– nicht beurteilbar' };

/** The formativ feedback of one question as print HTML (all text escaped). */
function formativPrintHTML(slot) {
    if (!slot || slot.state !== 'done' || !slot.result) return '';
    const when = slot.at ? new Date(slot.at).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    const items = (slot.result.kriterien || []).map((k) =>
        `<li><strong>${escapeHtml(FORMATIV_STATUS[k.status] || k.status)}</strong> ${escapeHtml(k.hinweis || '')}${k.beleg ? `<br><em>«${escapeHtml(k.beleg)}»</em>` : ''}</li>`).join('');
    return `<div class="formativ-box"><h4>Rückmeldung (formativ${when ? ', ' + when : ''}):</h4><ul>${items}</ul></div>`;
}

function convertMarkdownToHTML(text) {
    if (!text) return text;
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em>$1</em>');
    return text;
}

/**
 * Generates HTML that displays each question followed by its answer.
 * @param {object} data - The prepared data for printing.
 * @returns {string} The complete HTML for the print window.
 */
function generatePrintHTML(data) {
    let bodyContent = `<h1>${convertMarkdownToHTML(data.assignmentTitle)}</h1><p><strong>Schüler/in:</strong> ${data.studentIdentifier}</p><hr>`;
    const sortedSubIds = Object.keys(data.subAssignments).sort();

    for (const subId of sortedSubIds) {
        const subData = data.subAssignments[subId];
        bodyContent += `<div class="sub-assignment"><h2>${convertMarkdownToHTML(subData.title)}</h2>`;
        
        if (subData.questions && subData.questions.length > 0) {
            const answerMap = new Map(subData.answers.map(a => [a.questionId, a.answer]));

            subData.questions.forEach((q, index) => {
                bodyContent += `<div class="question-answer-pair">`;
                bodyContent += `<h3>Frage ${index + 1}:</h3>`;
                bodyContent += `<p class="question-text">${convertMarkdownToHTML(q.text)}</p>`;
                
                const answer = answerMap.get(q.id) || '';
                const isAnswerEmpty = !answer || answer.trim() === '' || answer.trim() === '<p><br></p>';

                bodyContent += `<h4>Antwort:</h4>`;
                if (isAnswerEmpty) {
                    bodyContent += `<div class="answer-box empty-answer-box"></div>`;
                } else {
                    bodyContent += `<div class="answer-box">${answer}</div>`;
                }
                bodyContent += formativPrintHTML(data.formativ?.[`${subId}::${q.id}`]);
                bodyContent += `</div>`;
            });
        }
        
        bodyContent += `</div>`;
    }

    const css = `
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 2em; }
        h1, h2, h3, h4 { color: #333; }
        h1 { font-size: 2em; border-bottom: 2px solid #ccc; padding-bottom: 0.5em; }
        h2 { font-size: 1.5em; background-color: #f0f0f0; padding: 0.5em; margin-top: 2em; border-left: 5px solid #007bff; }
        h3 { font-size: 1.2em; margin-bottom: 0.5em; margin-top: 1.5em; }
        h4 { font-size: 1em; margin-bottom: 0.3em; color: #555; }
        .sub-assignment { page-break-inside: avoid; margin-bottom: 2em; }
        .question-answer-pair { margin-bottom: 1.5em; padding-left: 1em; border-left: 3px solid #e9ecef; }
        .question-text { font-style: italic; color: #495057; }
        .answer-box { 
            padding: 10px; border: 1px solid #ddd; border-radius: 4px; 
            margin-top: 0; background-color: #f9f9f9; 
        }
        .answer-box p { margin-top: 0; }
        .empty-answer-box {
            position: relative; min-height: 9em; background-color: #ffffff;
        }
        .empty-answer-box::before {
            content: '✏'; position: absolute; top: 8px; left: 10px;
            color: #aaa; font-size: 0.9em; font-style: italic;
        }
        hr { border: 0; border-top: 1px solid #ccc; }
        .formativ-box { margin-top: 0.6em; padding: 6px 10px; border-left: 3px solid #0d6efd; background: #f5f8ff; }
        .formativ-box h4 { margin: 0 0 0.3em; }
        .formativ-box ul { margin: 0; padding-left: 1.2em; }
        .formativ-box li { margin-bottom: 0.3em; }
        @media print { 
            h2 { background-color: #f0f0f0 !important; -webkit-print-color-adjust: exact; } 
        }
    `;

    return `<!DOCTYPE html><html lang="de"><head><meta charset="UTF-8"><title>Druckansicht: ${data.assignmentTitle}</title><style>${css}</style></head><body>${bodyContent}</body></html>`;
}

export async function printAssignmentAnswers(assignmentId, studentKey = null, mode = 'live') {
    const data = await gatherAssignmentData(assignmentId);
    if (!data) return;
    // formativ feedback received so far; printing works without it.
    data.formativ = {};
    if (studentKey) {
        try { data.formativ = (await getFormativStatus(studentKey, assignmentId, mode)).slots || {}; } catch { /* print without */ }
    }

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