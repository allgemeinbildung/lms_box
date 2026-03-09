import { showPrintDialog, printFeedback } from './printer.js';
import { publishFeedback } from './api.js';

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

const getOriginalAnswerFromResult = (item, fallbackSlot) => {
    return pickFirstNonEmpty(
        item.original_answer,
        item.originalAnswer,
        item.student_answer,
        item.studentAnswer,
        item.student_response,
        item.studentResponse,
        item.answer,
        fallbackSlot?.dataset.originalAnswer
    );
};

const getSolutionFromResult = (item, fallbackSlot) => {
    return pickFirstNonEmpty(
        item.correct_solution,
        item.correctSolution,
        item.parsed_correct_solution,
        item.parsedCorrectSolution,
        item.model_solution,
        item.modelSolution,
        item.expected_answer,
        item.expectedAnswer,
        item.solution,
        fallbackSlot?.dataset.correctSolution
    );
};

const getCurrentFeedbackItem = (feedbackData) => {
    if (feedbackData.history && Array.isArray(feedbackData.history) && feedbackData.history.length > 0) {
        return feedbackData.history[feedbackData.history.length - 1];
    }
    return { results: feedbackData.results, date_str: feedbackData.date_str };
};

export const showPublishPanel = (card, feedbackData, assignmentId, isPublished = false, existingSettings = null) => {
    const studentKey = card.dataset.studentKey;
    if (!studentKey) return;
    // Always keep the latest feedbackData accessible for bulk-freigabe
    card._feedbackData = feedbackData;

    const existing = card.querySelector('.publish-panel');
    if (existing) existing.remove();

    const defaults = { kurzbericht: true, ausfuehrlich: true, punkte: true, loesung: false };
    const settings = existingSettings || defaults;
    const isReleased = { value: isPublished };

    const panel = document.createElement('div');
    panel.className = 'publish-panel';
    panel.style.cssText = 'background:#fff7ed; border:1px solid #fed7aa; border-radius:6px; padding:8px 12px; margin:4px 0 0 0; display:flex; align-items:center; gap:10px; flex-wrap:wrap; font-size:0.82em;';

    panel.innerHTML = `
        <span style="font-weight:600; color:#92400e;">Freigeben:</span>
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#555;">
            <input type="checkbox" class="release-check-kurz" ${settings.kurzbericht !== false ? 'checked' : ''}> Kurzbericht
        </label>
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#555;">
            <input type="checkbox" class="release-check-detail" ${settings.ausfuehrlich !== false ? 'checked' : ''}> Ausführlich
        </label>
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#555;">
            <input type="checkbox" class="release-check-punkte" ${settings.punkte !== false ? 'checked' : ''}> Punkte
        </label>
        <label style="display:flex; align-items:center; gap:4px; cursor:pointer; color:#555;">
            <input type="checkbox" class="release-check-loesung" ${settings.loesung ? 'checked' : ''}> Lösungsschlüssel
        </label>
        <button class="release-toggle-btn" style="padding:3px 10px; border-radius:4px; border:none; cursor:pointer; font-weight:bold; background:${isPublished ? '#dc2626' : '#16a34a'}; color:white;">
            ${isPublished ? '🔒 Zurückziehen' : '🔓 Freigeben'}
        </button>
        <span class="release-status" style="color:#666;"></span>
    `;

    const btn = panel.querySelector('.release-toggle-btn');
    const statusEl = panel.querySelector('.release-status');

    const getCurrentSettings = () => ({
        kurzbericht: panel.querySelector('.release-check-kurz').checked,
        ausfuehrlich: panel.querySelector('.release-check-detail').checked,
        punkte: panel.querySelector('.release-check-punkte').checked,
        loesung: panel.querySelector('.release-check-loesung').checked
    });

    // Auto-save settings when a checkbox changes (only if already released)
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async () => {
            if (!isReleased.value) return;
            statusEl.textContent = '⏳ Speichere...';
            const currentItem = getCurrentFeedbackItem(feedbackData);
            const result = await publishFeedback(studentKey, assignmentId, currentItem, getCurrentSettings(), true);
            statusEl.textContent = result.status === 'success' ? '✓ Gespeichert' : '❌ Fehler';
        });
    });

    btn.addEventListener('click', async () => {
        const newState = !isReleased.value;
        btn.disabled = true;
        btn.textContent = '⏳ ...';
        statusEl.textContent = '';

        const currentItem = getCurrentFeedbackItem(feedbackData);
        const result = await publishFeedback(studentKey, assignmentId, currentItem, getCurrentSettings(), newState);

        if (result.status === 'success') {
            isReleased.value = newState;
            btn.disabled = false;
            btn.style.background = newState ? '#dc2626' : '#16a34a';
            btn.textContent = newState ? '🔒 Zurückziehen' : '🔓 Freigeben';
            statusEl.textContent = newState ? '✓ Freigegeben' : '✓ Zurückgezogen';
        } else {
            btn.disabled = false;
            btn.textContent = isReleased.value ? '🔒 Zurückziehen' : '🔓 Freigeben';
            statusEl.textContent = '❌ Fehler';
        }
    });

    const header = card.querySelector('.student-header');
    if (header) header.insertAdjacentElement('afterend', panel);
};

export const distributeFeedback = (feedbackData, container) => {
    // Clean existing header
    const existingHeader = container.querySelector('.feedback-controls-header');
    if (existingHeader) existingHeader.remove();

    let currentItem = feedbackData;
    let previousItem = null;
    let versionCount = 1;

    // Check for history
    if (feedbackData.history && Array.isArray(feedbackData.history)) {
        versionCount = feedbackData.history.length;
        currentItem = feedbackData.history[versionCount - 1];
        if (versionCount >= 2) {
            previousItem = feedbackData.history[versionCount - 2];
        }
    }

    // --- Delta Logic (History comparison) ---
    const calculateStats = (results) => {
        let totalScore = 0;
        let answeredCount = 0;
        if (results && Array.isArray(results)) {
            results.forEach(r => {
                totalScore += (r.score || 0);
                if (r.score > 0) answeredCount++;
            });
        }
        return { totalScore, answeredCount };
    };

    let deltaHtml = '';
    if (previousItem) {
        const currStats = calculateStats(currentItem.results);
        const prevStats = calculateStats(previousItem.results);
        const scoreDiff = currStats.totalScore - prevStats.totalScore;
        const ansDiff = currStats.answeredCount - prevStats.answeredCount;

        let scoreClass = 'color:#666';
        let scoreSign = '';
        if (scoreDiff > 0) { scoreClass = 'color:#16a34a'; scoreSign = '▲ +'; }
        else if (scoreDiff < 0) { scoreClass = 'color:#dc2626'; scoreSign = '▼ '; }

        let ansClass = 'color:#666';
        let ansSign = '';
        if (ansDiff > 0) { ansClass = 'color:#16a34a'; ansSign = '▲ +'; }
        else if (ansDiff < 0) { ansClass = 'color:#dc2626'; ansSign = '▼ '; }

        deltaHtml = `
            <span style="font-size:0.85em; margin-left:15px; border-left:1px solid #ccc; padding-left:10px;">
                <span style="margin-right:8px; font-weight:bold; ${scoreClass}" title="Veränderung Punkte">${scoreSign}${scoreDiff} Pkt</span>
                <span style="font-weight:bold; ${ansClass}" title="Veränderung beantwortete Fragen">${ansSign}${ansDiff} Fragen</span>
            </span>
        `;
    }

    const dateStr = currentItem.date_str || "Gespeichert";
    const versionLabel = versionCount > 1 ? ` <span style="font-size:0.8em; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:10px; margin-left:5px;">v${versionCount}</span>` : "";

    // Create Header
    const controlsHeader = document.createElement('div');
    controlsHeader.className = 'feedback-controls-header';
    controlsHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; padding:10px; border-radius:6px; margin-bottom:15px; border:1px solid #bae6fd;";

    controlsHeader.innerHTML = `
        <div style="font-size:0.9em; color:#0369a1; display:flex; align-items:center;">
            <strong>⚡ Status:</strong> 
            <span style="color:#555; margin-left:5px;">${dateStr}</span>
            ${versionLabel}
            ${deltaHtml}
        </div>
        <button class="print-single-btn" style="border:none; background:none; cursor:pointer; font-size:1.2em;" title="Feedback drucken">🖨️</button>
    `;

    // Print Single Feedback Handler
    controlsHeader.querySelector('.print-single-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        const card = container.closest('.student-card');
        const sName = card ? card.dataset.studentName : "Student";
        // Assuming element exists in DOM
        const cls = document.getElementById('class-select') ? document.getElementById('class-select').value : 'Class';
        const assId = document.getElementById('assignment-select') ? document.getElementById('assignment-select').value : 'Aufgabe';
        const slotsByQid = new Map(Array.from(container.querySelectorAll('.inline-feedback')).map(slot => [slot.dataset.qid, slot]));

        const printPayload = {
            student_name: sName,
            date_str: currentItem.date_str,
            results: (currentItem.results || []).map(item => {
                const slot = slotsByQid.get(item.question_id);
                return {
                    ...item,
                    question_text: pickFirstNonEmpty(item.question_text, slot?.dataset.qtext),
                    original_answer: getOriginalAnswerFromResult(item, slot),
                    correct_solution: getSolutionFromResult(item, slot)
                };
            })
        };
        showPrintDialog((mode, includePoints) => { printFeedback(cls, sName, assId, printPayload, mode, includePoints); });
    });

    container.prepend(controlsHeader);

    // Clear slots first
    container.querySelectorAll('.inline-feedback').forEach(el => {
        el.innerHTML = '';
        el.style.display = 'none';
    });

    // Fill slots
    if (currentItem.results) {
        currentItem.results.forEach(item => {
            const targetSlot = container.querySelector(`.inline-feedback[data-qid="${item.question_id}"]`);
            if (targetSlot) {
                let color = '#ef4444';
                if (item.score === 2) color = '#f59e0b';
                if (item.score === 3) color = '#22c55e';

                targetSlot.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                        <span style="background:${color}; color:white; padding:1px 6px; border-radius:4px; font-size:0.8em; font-weight:bold;" title="Korrektheit (0-3)">
                            Punkte: ${item.score}
                        </span>
                        <span style="color:#334155; font-weight:600; font-size:0.95em;">${item.concise_feedback}</span>
                    </div>
                    <div style="font-size:0.9em; color:#555; background:white; padding:8px; border-left:3px solid #e2e8f0; margin-top:5px;">${item.detailed_feedback}</div>
                `;

                targetSlot.dataset.score = item.score;
                targetSlot.dataset.concise = item.concise_feedback;
                targetSlot.dataset.detailed = item.detailed_feedback;
                const questionText = pickFirstNonEmpty(item.question_text, targetSlot.dataset.qtext);
                const originalAnswer = getOriginalAnswerFromResult(item, targetSlot);
                const correctSolution = getSolutionFromResult(item, targetSlot);

                targetSlot.dataset.qtext = questionText;
                targetSlot.dataset.originalAnswer = originalAnswer;
                targetSlot.dataset.correctSolution = correctSolution;
                targetSlot.style.display = 'block';
            }
        });
    }
};
