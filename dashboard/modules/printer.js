import { parseSimpleMarkdown } from './utils.js';

export const showPrintDialog = (onConfirm) => {
    const dialogOverlay = document.createElement('div');
    dialogOverlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999;";

    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = "background:white; padding:25px; border-radius:8px; width:350px; text-align:center; box-shadow:0 4px 15px rgba(0,0,0,0.2); font-family: sans-serif;";
    dialogBox.innerHTML = `
        <h3 style="margin-top:0; color:#333;">Druckoptionen</h3>
        <p style="color:#666; margin-bottom:20px;">Welchen Detaillierungsgrad möchtest du drucken?</p>
        
        <div style="margin-bottom:20px; text-align:left; padding-left:20px;">
             <label style="display:flex; align-items:center; cursor:pointer;">
                <input type="checkbox" id="print-points-check" checked style="width:18px; height:18px; margin-right:10px;">
                <span style="font-size:1em; color:#333;">Punkte anzeigen</span>
            </label>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
            <button id="print-full" style="padding:12px; border:1px solid #007bff; background:#e9f3ff; color:#0056b3; border-radius:4px; cursor:pointer; font-weight:bold;">📄 Ausführlicher Bericht (Beides)</button>
            <button id="print-concise" style="padding:12px; border:1px solid #ccc; background:#fff; color:#333; border-radius:4px; cursor:pointer;">✂️ Kurzbericht (Nur 'Was fehlt')</button>
        </div>
        <button id="print-cancel" style="margin-top:20px; border:none; background:transparent; color:#888; cursor:pointer; text-decoration:underline;">Abbrechen</button>
    `;

    dialogOverlay.appendChild(dialogBox);
    document.body.appendChild(dialogOverlay);

    const close = () => dialogOverlay.remove();
    const getPointsOption = () => dialogBox.querySelector('#print-points-check').checked;

    dialogBox.querySelector('#print-full').addEventListener('click', () => {
        const includePoints = getPointsOption();
        close();
        onConfirm('full', includePoints);
    });
    dialogBox.querySelector('#print-concise').addEventListener('click', () => {
        const includePoints = getPointsOption();
        close();
        onConfirm('concise', includePoints);
    });
    dialogBox.querySelector('#print-cancel').addEventListener('click', close);
    dialogOverlay.addEventListener('click', (e) => { if (e.target === dialogOverlay) close(); });
};

export const generatePrintHTML = (feedbackList, assignmentName, mode, includePoints) => {
    let bodyContent = '';
    const date = new Date().toLocaleDateString('de-DE');

    feedbackList.forEach(fb => {
        bodyContent += `
        <div class="page">
            <div class="header">
                <h2>Feedback: ${assignmentName}</h2>
                <p><strong>Schüler:in:</strong> ${fb.student_name} | <strong>Erstellt am:</strong> ${date}</p>
            </div>
            <hr>
            <div class="feedback-list">`;

        let lastSection = "";

        fb.results.forEach(item => {
            let currentSection = "";
            if (item.question_id) {
                const parts = item.question_id.split('_');
                if (parts.length > 0) currentSection = parts[0];
            }

            if (currentSection && currentSection !== lastSection) {
                bodyContent += `<h3 class="section-header">${currentSection}</h3>`;
                lastSection = currentSection;
            }

            let colorClass = 'score-low';
            if (item.score === 2) colorClass = 'score-mid';
            if (item.score === 3) colorClass = 'score-high';

            const formattedQuestion = parseSimpleMarkdown(item.question_text);

            let scoreBadge = '';
            if (includePoints) {
                scoreBadge = `<span class="badge ${colorClass}">Punkte: ${item.score}</span>`;
            }

            bodyContent += `
                <div class="item">
                    <div class="question">${formattedQuestion}</div>
                    <div class="concise">${scoreBadge} ${item.concise_feedback}</div>`;

            if (mode === 'full') {
                bodyContent += `<div class="detailed">${item.detailed_feedback}</div>`;
            }

            bodyContent += `</div>`;
        });

        bodyContent += `</div></div>`;
    });

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Feedback Drucken</title>
        <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; line-height: 1.5; }
            .page { page-break-after: always; padding: 40px; max-width: 800px; margin: 0 auto; }
            .header { margin-bottom: 20px; }
            .header h2 { margin-bottom: 5px; color: #0056b3; }
            
            .section-header { 
                margin-top: 30px; 
                margin-bottom: 15px; 
                padding-bottom: 5px; 
                border-bottom: 2px solid #0056b3; 
                color: #0056b3; 
                font-size: 1.2em; 
            }

            .item { margin-bottom: 25px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
            .question { margin-bottom: 8px; color: #222; font-size: 1.05em; }
            .concise { margin-bottom: 8px; font-weight: 600; color: #444; }
            .detailed { font-size: 0.95em; color: #555; background: #f8f9fa; padding: 12px; border-left: 4px solid #ced4da; border-radius: 4px; margin-top: 8px; }
            .badge { color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.85em; margin-right: 8px; vertical-align: middle; }
            .score-low { background-color: #ef4444; }
            .score-mid { background-color: #f59e0b; }
            .score-high { background-color: #22c55e; }
            
            b, strong { font-weight: 700; color: #000; }
            
            @media print { body { -webkit-print-color-adjust: exact; } }
        </style>
    </head>
    <body>${bodyContent}</body>
    </html>`;
};

export const printFeedback = (studentName, assignmentName, feedbackData, mode, includePoints) => {
    const printWindow = window.open('', '_blank');
    const html = generatePrintHTML([feedbackData], assignmentName, mode, includePoints);
    printWindow.document.write(html);
    printWindow.document.close();
};

export const setupPrintAll = (btn, getFeedbackDataCallback) => {
    btn.addEventListener('click', () => {
        const { feedbackList, assignmentName } = getFeedbackDataCallback();

        if (!feedbackList || feedbackList.length === 0) {
            alert("Es wurden keine Feedbacks gefunden. Bitte erst Feedbacks generieren.");
            return;
        }

        showPrintDialog((mode, includePoints) => {
            const printWindow = window.open('', '_blank');
            const html = generatePrintHTML(feedbackList, assignmentName, mode, includePoints);
            printWindow.document.write(html);
            printWindow.document.close();
        });
    });
};
