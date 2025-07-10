const ANSWER_PREFIX = 'modular-answer_';
const QUESTIONS_PREFIX = 'modular-questions_';
const TITLE_PREFIX = 'title_';

async function gatherAssignmentData(assignmentId) {
    const studentIdentifier = localStorage.getItem('studentIdentifier') || 'Unbekannter Schüler';
    const subAssignments = {};
    const keyRegex = new RegExp(`^${ANSWER_PREFIX}${assignmentId}_sub_(.+)$`);

    // Fetch the main assignment title from the server
    let mainTitle = `Aufgabe: ${assignmentId}`;
    try {
        const response = await fetch(`${SCRIPT_URL}?assignmentId=${assignmentId}`);
        const data = await response.json();
        if (data.assignmentTitle) mainTitle = data.assignmentTitle;
    } catch (e) {
        console.warn("Could not fetch main assignment title for printing.");
    }
    
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const match = key.match(keyRegex);
        if (match) {
            const subId = match[1];
            const answer = localStorage.getItem(key) || '';
            const title = localStorage.getItem(`${TITLE_PREFIX}${assignmentId}_sub_${subId}`) || subId;
            const questionsStr = localStorage.getItem(`${QUESTIONS_PREFIX}${assignmentId}_sub_${subId}`);
            const questions = questionsStr ? JSON.parse(questionsStr) : [];
            
            subAssignments[subId] = { answer, title, questions };
        }
    }

    if (Object.keys(subAssignments).length === 0) {
        alert("Für diese Aufgabe wurden keine gespeicherten Antworten gefunden.");
        return null;
    }

    return { studentIdentifier, assignmentTitle: mainTitle, subAssignments };
}

function generatePrintHTML(data) {
    let bodyContent = `<h1>${data.assignmentTitle}</h1><p><strong>Schüler/in:</strong> ${data.studentIdentifier}</p><hr>`;
    const sortedSubIds = Object.keys(data.subAssignments).sort();

    for (const subId of sortedSubIds) {
        const subData = data.subAssignments[subId];
        bodyContent += `<div class="sub-assignment"><h2>${subData.title}</h2>`;
        const questionsHTML = subData.questions.map(q => `<li>${q.text}</li>`).join('');
        bodyContent += `<h3>Fragen:</h3><ol>${questionsHTML}</ol>`;
        bodyContent += `<h3>Antwort:</h3><div class="answer-box">${subData.answer}</div>`;
        bodyContent += `</div>`;
    }

    const css = `
        body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.5; margin: 2em; }
        h1, h2 { color: #333; }
        h1 { font-size: 2em; border-bottom: 2px solid #ccc; padding-bottom: 0.5em; }
        h2 { font-size: 1.5em; background-color: #f0f0f0; padding: 0.5em; margin-top: 2em; border-left: 5px solid #007bff; }
        .sub-assignment { page-break-inside: avoid; margin-bottom: 2em; }
        .answer-box { padding: 10px; border: 1px solid #ddd; border-radius: 4px; margin-top: 8px; background-color: #f9f9f9; }
        ol { padding-left: 20px; }
        hr { border: 0; border-top: 1px solid #ccc; }
        @media print { h2 { background-color: #f0f0f0 !important; -webkit-print-color-adjust: exact; } }
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
