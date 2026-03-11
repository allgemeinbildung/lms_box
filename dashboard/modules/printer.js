import { parseSimpleMarkdown } from './utils.js';

const pickFirstNonEmpty = (...values) => {
    for (const value of values) {
        if (value === undefined || value === null) continue;
        if (typeof value === 'object') continue;
        const str = String(value).trim();
        if (str && str !== 'undefined' && str !== 'null') {
            return str;
        }
    }
    return '';
};

const looksLikeHtml = (text) => /<\/?[a-z][\s\S]*>/i.test(text);

const formatReportContent = (value) => {
    const normalized = pickFirstNonEmpty(value);
    if (!normalized) return '';
    return looksLikeHtml(normalized) ? normalized : parseSimpleMarkdown(normalized);
};

const getOriginalAnswer = (item) => pickFirstNonEmpty(
    item.original_answer,
    item.originalAnswer,
    item.student_answer,
    item.studentAnswer,
    item.student_response,
    item.studentResponse,
    item.answer
);

const getCorrectSolution = (item) => pickFirstNonEmpty(
    item.correct_solution,
    item.correctSolution,
    item.parsed_correct_solution,
    item.parsedCorrectSolution,
    item.model_solution,
    item.modelSolution,
    item.expected_answer,
    item.expectedAnswer,
    item.solution
);

const parseProgressStats = (progressValue) => {
    const raw = String(progressValue || '');
    const match = raw.match(/(\d+)\s*\/\s*(\d+)/);
    if (!match) return { done: 0, total: 0, percent: 0 };

    const done = parseInt(match[1], 10) || 0;
    const total = parseInt(match[2], 10) || 0;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    return { done, total, percent };
};

export const showPrintDialog = (onConfirm) => {
    const dialogOverlay = document.createElement('div');
    dialogOverlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999;";

    const dialogBox = document.createElement('div');
    dialogBox.style.cssText = "background:white; padding:25px; border-radius:8px; width:430px; text-align:center; box-shadow:0 4px 15px rgba(0,0,0,0.2); font-family: sans-serif;";
    dialogBox.innerHTML = `
        <h3 style="margin-top:0; color:#333;">Druckoptionen</h3>
        <p style="color:#666; margin-bottom:20px;">Welchen Detaillierungsgrad m&ouml;chtest du drucken?</p>

        <div style="margin-bottom:20px; text-align:left; padding-left:20px;">
             <label style="display:flex; align-items:center; cursor:pointer;">
                <input type="checkbox" id="print-points-check" checked style="width:18px; height:18px; margin-right:10px;">
                <span style="font-size:1em; color:#333;">Punkte anzeigen</span>
            </label>
        </div>

        <div style="display:flex; flex-direction:column; gap:10px;">
            <button id="print-list" style="padding:12px; border:1px solid #28a745; background:#eafff0; color:#1a7a2e; border-radius:4px; cursor:pointer; font-weight:bold;">Nur Namensliste (Name + Stand)</button>
            <button id="print-full" style="padding:12px; border:1px solid #007bff; background:#e9f3ff; color:#0056b3; border-radius:4px; cursor:pointer; font-weight:bold;">Ausf&uuml;hrlicher Bericht (Beides)</button>
            <button id="print-full-context" style="padding:12px; border:1px solid #0056b3; background:#dbeafe; color:#003f8a; border-radius:4px; cursor:pointer; font-weight:bold;">Ausf&uuml;hrlich + Originalantwort + Musterl&ouml;sung</button>
            <button id="print-concise" style="padding:12px; border:1px solid #ccc; background:#fff; color:#333; border-radius:4px; cursor:pointer;">Kurzbericht (Nur 'Was fehlt')</button>
        </div>
        <button id="print-cancel" style="margin-top:20px; border:none; background:transparent; color:#888; cursor:pointer; text-decoration:underline;">Abbrechen</button>
    `;

    dialogOverlay.appendChild(dialogBox);
    document.body.appendChild(dialogOverlay);

    const close = () => dialogOverlay.remove();
    const getPointsOption = () => dialogBox.querySelector('#print-points-check').checked;

    dialogBox.querySelector('#print-list').addEventListener('click', () => {
        close();
        onConfirm('list', false);
    });
    dialogBox.querySelector('#print-full').addEventListener('click', () => {
        const includePoints = getPointsOption();
        close();
        onConfirm('full', includePoints);
    });
    dialogBox.querySelector('#print-full-context').addEventListener('click', () => {
        const includePoints = getPointsOption();
        close();
        onConfirm('full_with_context', includePoints);
    });
    dialogBox.querySelector('#print-concise').addEventListener('click', () => {
        const includePoints = getPointsOption();
        close();
        onConfirm('concise', includePoints);
    });
    dialogBox.querySelector('#print-cancel').addEventListener('click', close);
    dialogOverlay.addEventListener('click', (e) => { if (e.target === dialogOverlay) close(); });
};

export const generatePrintHTML = (feedbackList, className, assignmentName, mode, includePoints, studentList = []) => {
    let bodyContent = '';
    const date = new Date().toLocaleDateString('de-DE');
    const isListMode = mode === 'list';
    const showDetailed = (mode === 'full' || mode === 'full_with_context') && !isListMode;
    const showContext = mode === 'full_with_context' && !isListMode;

    const safeAssignmentName = assignmentName || 'Aufgabe';
    const sanitizedAssignment = safeAssignmentName.replace(/[\s\W]+/g, '_');
    const pageTitle = isListMode ? `Liste_${className}_${sanitizedAssignment}` : `${className}_${sanitizedAssignment}`;

    let studentListHtml = '';
    if (studentList.length > 0) {
        const withFeedback = new Set(feedbackList.map(f => f.student_name));
        const rankedStudents = [...studentList]
            .map(student => {
                const stats = parseProgressStats(student.progress);
                return { ...student, ...stats };
            })
            .sort((a, b) => {
                if (b.done !== a.done) return b.done - a.done;
                if (b.percent !== a.percent) return b.percent - a.percent;
                return a.name.localeCompare(b.name, 'de', { sensitivity: 'base' });
            });

        studentListHtml = `
        <div style="margin-top:40px; text-align:left; max-width:${isListMode ? '500px' : '600px'}; margin-left:auto; margin-right:auto;">
            <h3 style="border-bottom:1px solid #eee; padding-bottom:10px;">Lernende</h3>
            <div class="overview-list">
                ${rankedStudents.map(s => {
            const hasDone = withFeedback.has(s.name);
            const barColor = s.percent >= 80 ? '#22c55e' : s.percent >= 50 ? '#f59e0b' : '#ef4444';

            if (isListMode) {
                return `
                        <div class="overview-row list-only" style="justify-content: space-between; border: none; border-bottom: 1px solid #f0f0f0; border-radius: 0; padding: 6px 0;">
                            <span class="overview-name" style="font-size: 1.1em; color: #333;">${s.name}</span>
                            <span class="overview-score" style="font-size: 1.1em; font-weight: bold; color: #000;">${s.done}/${s.total} ${hasDone ? '✓' : ''}</span>
                        </div>`;
            }

            return `
                    <div class="overview-row ${hasDone ? 'is-done' : 'is-pending'}">
                        <div class="overview-left">
                            <span class="overview-status">${hasDone ? 'OK' : 'X'}</span>
                            <span class="overview-name">${s.name}</span>
                            <span class="overview-score">(${s.done}/${s.total})</span>
                        </div>
                        <div class="overview-right">
                            <span class="overview-bar">
                                <span class="overview-fill" style="width:${s.percent}%; background:${barColor};"></span>
                            </span>
                            <span class="overview-percent">${s.percent}%</span>
                        </div>
                    </div>`;
        }).join('')}
            </div>
        </div>`;
    }

    const doneCount = feedbackList.length;
    const totalCount = studentList.length || feedbackList.length;

    bodyContent += `
    <div class="page no-print-break" style="text-align:center; padding-top:${isListMode ? '20px' : '60px'};">
        <h1 style="font-size:${isListMode ? '2em' : '3em'}; color:#0056b3; margin-bottom:10px;">${className}</h1>
        <h2 style="font-size:${isListMode ? '1.2em' : '1.8em'}; color:#333;">${safeAssignmentName}</h2>
        <div style="margin: ${isListMode ? '15px' : '30px'} 0; font-size: ${isListMode ? '1.1em' : '1.5em'}; font-weight: bold; color: #0056b3;">
            <span style="background: #e0f2fe; padding: ${isListMode ? '5px 15px' : '10px 20px'}; border-radius: 50px;">
                Abgeschlossen: ${doneCount} / ${totalCount}
            </span>
        </div>
        <p style="color:#666; font-size:${isListMode ? '0.9em' : '1.1em'};">${date}</p>
        ${studentListHtml}
    </div>`;

    if (!isListMode) {
        feedbackList.forEach(fb => {
            bodyContent += `
        <div class="page">
            <div class="header">
                <h2>Feedback: ${safeAssignmentName}</h2>
                <p><strong>Sch&uuml;ler:in:</strong> ${fb.student_name} | <strong>Erstellt am:</strong> ${date}</p>
            </div>
            <hr>
            <div class="feedback-list">`;

            let lastSection = "";

            (fb.results || []).forEach(item => {
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

                const formattedQuestion = parseSimpleMarkdown(item.question_text || '');
                let scoreBadge = '';
                if (includePoints) {
                    scoreBadge = `<span class="badge ${colorClass}">Punkte: ${item.score}</span>`;
                }

                bodyContent += `
                <div class="item">
                    <div class="question">${formattedQuestion}</div>
                    <div class="concise">${scoreBadge} ${item.concise_feedback || ''}</div>`;

                if (showDetailed) {
                    bodyContent += `<div class="detailed">${item.detailed_feedback || ''}</div>`;
                }

                if (showContext) {
                    const originalAnswer = formatReportContent(getOriginalAnswer(item));
                    const correctSolution = formatReportContent(getCorrectSolution(item));

                    bodyContent += `
                    <div class="context-box">
                        <div class="context-title">Originalantwort Sch&uuml;ler:in</div>
                        <div class="context-body ${originalAnswer ? '' : 'context-empty'}">${originalAnswer || 'Keine Antwort vorhanden.'}</div>
                    </div>
                    <div class="context-box">
                        <div class="context-title">Musterl&ouml;sung (geparst)</div>
                        <div class="context-body ${correctSolution ? '' : 'context-empty'}">${correctSolution || 'Keine Musterl&ouml;sung gefunden.'}</div>
                    </div>`;
                }

                bodyContent += `</div>`;
            });

            bodyContent += `</div></div>`;
        });
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <title>${pageTitle}</title>
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
            .context-box { margin-top: 10px; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden; }
            .context-title { font-size: 0.85em; font-weight: 700; letter-spacing: 0.02em; color: #334155; background: #f8fafc; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; text-transform: uppercase; }
            .context-body { font-size: 0.95em; color: #1f2937; background: white; padding: 10px; }
            .context-body p { margin-top: 0; }
            .context-empty { color: #6b7280; font-style: italic; }
            .overview-list { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
            .overview-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; border: 1px solid #e5e7eb; border-radius: 8px; padding: 8px 10px; }
            .overview-left { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
            .overview-status { font-size: 0.75em; font-weight: 700; width: 20px; text-align: center; color: #64748b; }
            .overview-name { font-weight: 600; color: #111827; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 360px; }
            .overview-score { font-weight: 700; color: #374151; opacity: 0.9; }
            .overview-right { display: inline-flex; align-items: center; gap: 8px; flex-shrink: 0; }
            .overview-bar { width: 150px; height: 10px; border-radius: 999px; border: 1px solid #9ca3af; background: #f3f4f6; overflow: hidden; }
            .overview-fill { display: block; height: 100%; }
            .overview-percent { min-width: 34px; text-align: right; font-size: 0.8em; font-weight: 700; color: #111827; }
            .overview-row.is-pending .overview-name,
            .overview-row.is-pending .overview-score { color: #9ca3af; }
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

export const printFeedback = (className, studentName, assignmentName, feedbackData, mode, includePoints) => {
    const printWindow = window.open('', '_blank');
    const html = generatePrintHTML([feedbackData], className, assignmentName, mode, includePoints, [{ name: studentName, progress: '-' }]);
    printWindow.document.write(html);
    printWindow.document.close();
};

export const setupPrintAll = (btn, getFeedbackDataCallback) => {
    btn.addEventListener('click', () => {
        const { feedbackList, className, assignmentName, studentList } = getFeedbackDataCallback();

        if (!feedbackList || feedbackList.length === 0) {
            alert("Es wurden keine Feedbacks gefunden. Bitte erst Feedbacks generieren.");
            return;
        }

        showPrintDialog((mode, includePoints) => {
            const printWindow = window.open('', '_blank');
            const html = generatePrintHTML(feedbackList, className, assignmentName, mode, includePoints, studentList);
            printWindow.document.write(html);
            printWindow.document.close();
        });
    });
};
