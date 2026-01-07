import { showPrintDialog, printFeedback } from './printer.js';

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

        const printPayload = {
            student_name: sName,
            date_str: currentItem.date_str,
            results: currentItem.results
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
                targetSlot.dataset.qtext = item.question_text;
                targetSlot.style.display = 'block';
            }
        });
    }
};
