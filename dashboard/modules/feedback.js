import { showPrintDialog, printFeedback } from './printer.js';
import { publishFeedback, updateFeedback } from './api.js';

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

/**
 * Returns a copy of the feedback item with results filtered to exclude those with empty student answers.
 * This is used to ensure students don't see feedbacks like "Keine Antwort" for questions they skipped.
 */
export const getFilteredFeedbackData = (item, card) => {
    if (!item || !item.results || !Array.isArray(item.results)) return item;

    // Find all feedback slots to get the original student answers (as fallback)
    const slotsByQid = new Map(
        Array.from(card.querySelectorAll('.inline-feedback')).map(slot => [slot.dataset.qid, slot])
    );

    const filteredResults = item.results.filter(res => {
        const slot = slotsByQid.get(res.question_id);
        const studentAnswer = getOriginalAnswerFromResult(res, slot);
        return studentAnswer && studentAnswer.trim() !== '' && studentAnswer !== '<p><br></p>';
    });

    return {
        ...item,
        results: filteredResults
    };
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

export const showPublishPanel = (card, feedbackData, assignmentId, isPublished = false, existingSettings = null, versionIndex = null) => {
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

    const getVersionToPublish = () => {
        if (versionIndex !== null && feedbackData.history && feedbackData.history[versionIndex]) {
            return feedbackData.history[versionIndex];
        }
        return getCurrentFeedbackItem(feedbackData);
    };

    // Auto-save settings when a checkbox changes (only if already released)
    panel.querySelectorAll('input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', async () => {
            if (!isReleased.value) return;
            statusEl.textContent = '⏳ Speichere...';
            const item = getVersionToPublish();
            // Filter out empty answers before publishing to student
            const filteredItem = getFilteredFeedbackData(item, card);
            const result = await publishFeedback(studentKey, assignmentId, filteredItem, getCurrentSettings(), true);
            statusEl.textContent = result.status === 'success' ? '✓ Gespeichert' : '❌ Fehler';
        });
    });

    btn.addEventListener('click', async () => {
        const newState = !isReleased.value;
        btn.disabled = true;
        btn.textContent = '⏳ ...';
        statusEl.textContent = '';

        const item = getVersionToPublish();
        // Filter out empty answers before publishing to student
        const filteredItem = getFilteredFeedbackData(item, card);
        const result = await publishFeedback(studentKey, assignmentId, filteredItem, getCurrentSettings(), newState);

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

export const distributeFeedback = (feedbackData, container, versionIndex = null) => {
    // Clean existing header
    const existingHeader = container.querySelector('.feedback-controls-header');
    if (existingHeader) existingHeader.remove();

    let currentItem = feedbackData;
    let previousItem = null;
    let versionCount = 1;

    // Check for history
    const historyFlags = feedbackData.history && Array.isArray(feedbackData.history);
    if (historyFlags) {
        versionCount = feedbackData.history.length;
        // If versionIndex is specified, use it (0-indexed)
        const activeIdx = (versionIndex !== null && versionIndex >= 0 && versionIndex < versionCount) 
            ? versionIndex 
            : (versionCount - 1);
        
        currentItem = feedbackData.history[activeIdx];
        if (activeIdx > 0) {
            previousItem = feedbackData.history[activeIdx - 1];
        }
    }

    // --- Version Selector UI ---
    let versionSelectorHtml = '';
    if (historyFlags && versionCount > 1) {
        const activeIdx = (versionIndex !== null) ? versionIndex : (versionCount - 1);
        versionSelectorHtml = `
            <div class="version-selector" style="display:flex; gap:4px; margin-left:10px; align-items:center;">
                ${feedbackData.history.map((_h, i) => {
                    const isActive = i === activeIdx;
                    return `<span class="v-tag" data-idx="${i}" style="cursor:pointer; font-size:0.75em; padding:2px 6px; border-radius:10px; font-weight:bold; transition:all 0.2s; 
                        ${isActive ? 'background:#0369a1; color:white; scale:1.1;' : 'background:#e0f2fe; color:#0369a1; opacity:0.7;'}">v${i + 1}</span>`;
                }).join('')}
            </div>
        `;
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
    const versionLabel = (versionCount > 1 && !historyFlags) ? ` <span style="font-size:0.8em; background:#e0f2fe; color:#0369a1; padding:2px 6px; border-radius:10px; margin-left:5px;">v${versionCount}</span>` : "";

    // Create Header
    const controlsHeader = document.createElement('div');
    controlsHeader.className = 'feedback-controls-header';
    controlsHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; padding:10px; border-radius:6px; margin-bottom:15px; border:1px solid #bae6fd;";

    controlsHeader.innerHTML = `
        <div style="font-size:0.9em; color:#0369a1; display:flex; align-items:center;">
            <strong>⚡ Status:</strong> 
            <span style="color:#555; margin-left:5px; margin-right:5px;">${dateStr}</span>
            ${versionLabel}
            ${versionSelectorHtml}
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

    // Version Selection Handler
    controlsHeader.querySelectorAll('.v-tag').forEach(tag => {
        tag.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = parseInt(tag.dataset.idx);
            distributeFeedback(feedbackData, container, idx);
            // Also notify the card about the "visible" version so Freigeben works correctly
            const card = container.closest('.student-card');
            if (card) {
                // We update the publish panel too
                const studentKey = card.dataset.studentKey;
                const assId = document.getElementById('assignment-select')?.value;
                if (studentKey && assId) {
                    import('./api.js').then(({ getPublishedFeedbackStatus }) => {
                        getPublishedFeedbackStatus(studentKey, assId).then(status => {
                            showPublishPanel(card, feedbackData, assId, status.released || false, status.releaseSettings || null, idx);
                        });
                    });
                }
            }
        });
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
                const questionText = pickFirstNonEmpty(item.question_text, targetSlot.dataset.qtext);
                const originalAnswer = getOriginalAnswerFromResult(item, targetSlot);
                const correctSolution = getSolutionFromResult(item, targetSlot);

                targetSlot.dataset.score = item.score;
                targetSlot.dataset.concise = item.concise_feedback;
                targetSlot.dataset.detailed = item.detailed_feedback;
                targetSlot.dataset.qtext = questionText;
                targetSlot.dataset.originalAnswer = originalAnswer;
                targetSlot.dataset.correctSolution = correctSolution;
                targetSlot.style.display = 'block';

                renderFeedbackSlot(targetSlot, item, feedbackData, container);
            }
        });
    }
};

function renderFeedbackSlot(slot, item, feedbackData, container, prevSnapshot = null) {
    let color = '#ef4444';
    if (item.score === 2) color = '#f59e0b';
    if (item.score === 3) color = '#22c55e';

    const editedMark = item.manually_edited
        ? `<span style="font-size:0.7em; color:#9ca3af; margin-left:6px;" title="Manuell bearbeitet">✏️</span>`
        : '';

    const undoBtn = prevSnapshot
        ? `<button class="feedback-undo-btn" title="Rückgängig" style="background:none; border:1px solid #e5e7eb; cursor:pointer; font-size:0.75em; color:#6b7280; padding:1px 6px; border-radius:3px; line-height:1.4; white-space:nowrap;">↩️ Undo</button>`
        : '';

    slot.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
            <span style="background:${color}; color:white; padding:1px 6px; border-radius:4px; font-size:0.8em; font-weight:bold;" title="Korrektheit (0-3)">
                Punkte: ${item.score}
            </span>
            <span style="color:#334155; font-weight:600; font-size:0.95em;">${item.concise_feedback}</span>
            ${editedMark}
            ${undoBtn}
            <button class="feedback-ok-btn" title="Alles korrekt (Score 3)" style="margin-left:auto; background:none; border:1px solid #d1fae5; cursor:pointer; font-size:0.75em; color:#16a34a; padding:1px 6px; border-radius:3px; line-height:1.4; white-space:nowrap;">✔️ OK</button>
            <button class="feedback-edit-btn" title="Feedback bearbeiten" style="background:none; border:none; cursor:pointer; font-size:0.85em; color:#9ca3af; padding:1px 5px; border-radius:3px; line-height:1;">✏️</button>
        </div>
        <div style="font-size:0.9em; color:#555; background:white; padding:8px; border-left:3px solid #e2e8f0; margin-top:5px;">${item.detailed_feedback}</div>
    `;

    slot.querySelector('.feedback-edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        renderFeedbackEditMode(slot, item, feedbackData, container);
    });

    if (prevSnapshot) {
        slot.querySelector('.feedback-undo-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            const btn = slot.querySelector('.feedback-undo-btn');
            btn.disabled = true;
            btn.textContent = '⏳';

            const card = container.closest('.student-card');
            const className = document.getElementById('class-select')?.value || '';
            const assignmentId = document.getElementById('assignment-select')?.value || '';
            const studentName = card?.dataset.studentName || '';

            const result = await updateFeedback(className, assignmentId, studentName, item.question_id, prevSnapshot.score, prevSnapshot.concise_feedback, prevSnapshot.detailed_feedback);

            if (result.error) {
                btn.disabled = false;
                btn.textContent = '❌';
                return;
            }

            item.score = prevSnapshot.score;
            item.concise_feedback = prevSnapshot.concise_feedback;
            item.detailed_feedback = prevSnapshot.detailed_feedback;
            item.manually_edited = prevSnapshot.manually_edited;
            slot.dataset.score = prevSnapshot.score;
            slot.dataset.concise = prevSnapshot.concise_feedback;
            slot.dataset.detailed = prevSnapshot.detailed_feedback;

            await republishIfReleased(card, assignmentId, feedbackData);
            renderFeedbackSlot(slot, item, feedbackData, container); // no prevSnapshot = undo button gone
        });
    }

    slot.querySelector('.feedback-ok-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const btn = slot.querySelector('.feedback-ok-btn');
        btn.disabled = true;
        btn.textContent = '⏳';

        const card = container.closest('.student-card');
        const className = document.getElementById('class-select')?.value || '';
        const assignmentId = document.getElementById('assignment-select')?.value || '';
        const studentName = card?.dataset.studentName || '';

        // Snapshot before overwriting
        const prev = { score: item.score, concise_feedback: item.concise_feedback, detailed_feedback: item.detailed_feedback, manually_edited: item.manually_edited };

        const result = await updateFeedback(className, assignmentId, studentName, item.question_id, 3, '✔️ Alles korrekt.', '✔️ Alles korrekt.');

        if (result.error) {
            btn.disabled = false;
            btn.textContent = '❌';
            return;
        }

        item.score = 3;
        item.concise_feedback = '✔️ Alles korrekt.';
        item.detailed_feedback = '✔️ Alles korrekt.';
        item.manually_edited = true;
        slot.dataset.score = 3;
        slot.dataset.concise = '✔️ Alles korrekt.';
        slot.dataset.detailed = '✔️ Alles korrekt.';

        await republishIfReleased(card, assignmentId, feedbackData);
        renderFeedbackSlot(slot, item, feedbackData, container, prev);
    });
}

async function republishIfReleased(card, assignmentId, feedbackData) {
    const publishPanel = card?.querySelector('.publish-panel');
    const releaseBtn = publishPanel?.querySelector('.release-toggle-btn');
    if (releaseBtn && releaseBtn.textContent.includes('Zurückziehen')) {
        const studentKey = card.dataset.studentKey;
        const settings = {
            kurzbericht: publishPanel.querySelector('.release-check-kurz')?.checked ?? true,
            ausfuehrlich: publishPanel.querySelector('.release-check-detail')?.checked ?? true,
            punkte: publishPanel.querySelector('.release-check-punkte')?.checked ?? true,
            loesung: publishPanel.querySelector('.release-check-loesung')?.checked ?? false,
        };
        const item = getCurrentFeedbackItem(feedbackData);
        // Filter out empty answers before publishing to student
        const filteredItem = getFilteredFeedbackData(item, card);
        await publishFeedback(studentKey, assignmentId, filteredItem, settings, true);
    }
}

function renderFeedbackEditMode(slot, item, feedbackData, container) {
    const scoreOptions = [0, 1, 2, 3].map(v =>
        `<option value="${v}" ${v === item.score ? 'selected' : ''}>${v}</option>`
    ).join('');

    slot.innerHTML = `
        <div style="display:flex; flex-direction:column; gap:6px; padding:8px; background:#fffbeb; border:1px solid #fcd34d; border-radius:6px;">
            <div style="display:flex; align-items:center; gap:8px;">
                <label style="font-size:0.8em; font-weight:600; color:#92400e; white-space:nowrap;">Punkte (0–3):</label>
                <select class="edit-score" style="padding:2px 6px; border-radius:4px; border:1px solid #d1d5db; font-weight:bold;">
                    ${scoreOptions}
                </select>
            </div>
            <div style="display:flex; flex-direction:column; gap:2px;">
                <label style="font-size:0.8em; font-weight:600; color:#92400e;">Kurzbericht:</label>
                <input class="edit-concise" type="text" value="${item.concise_feedback.replace(/"/g, '&quot;')}"
                    style="padding:4px 6px; border-radius:4px; border:1px solid #d1d5db; font-size:0.9em; width:100%; box-sizing:border-box;">
            </div>
            <div style="display:flex; flex-direction:column; gap:2px;">
                <label style="font-size:0.8em; font-weight:600; color:#92400e;">Ausführlicher Bericht:</label>
                <textarea class="edit-detailed" rows="4"
                    style="padding:4px 6px; border-radius:4px; border:1px solid #d1d5db; font-size:0.9em; width:100%; box-sizing:border-box; resize:vertical;">${item.detailed_feedback}</textarea>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
                <button class="edit-save-btn" style="background:#0369a1; color:white; border:none; border-radius:4px; padding:4px 12px; cursor:pointer; font-weight:bold; font-size:0.85em;">💾 Speichern</button>
                <button class="edit-cancel-btn" style="background:#6b7280; color:white; border:none; border-radius:4px; padding:4px 12px; cursor:pointer; font-size:0.85em;">✖ Abbrechen</button>
                <span class="edit-status" style="font-size:0.8em; color:#666;"></span>
            </div>
        </div>
    `;

    slot.querySelector('.edit-cancel-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        renderFeedbackSlot(slot, item, feedbackData, container);
    });

    slot.querySelector('.edit-save-btn').addEventListener('click', async (e) => {
        e.stopPropagation();
        const statusEl = slot.querySelector('.edit-status');
        const newScore = parseInt(slot.querySelector('.edit-score').value);
        const newConcise = slot.querySelector('.edit-concise').value.trim();
        const newDetailed = slot.querySelector('.edit-detailed').value.trim();

        statusEl.textContent = '⏳ Speichere...';

        // Get context from card
        const card = container.closest('.student-card');
        const className = document.getElementById('class-select')?.value || '';
        const assignmentId = document.getElementById('assignment-select')?.value || '';
        const studentName = card?.dataset.studentName || '';

        const result = await updateFeedback(className, assignmentId, studentName, item.question_id, newScore, newConcise, newDetailed);

        if (result.error) {
            statusEl.textContent = `❌ ${result.error}`;
            return;
        }

        // Update in-memory item
        item.score = newScore;
        item.concise_feedback = newConcise;
        item.detailed_feedback = newDetailed;
        item.manually_edited = true;

        // Update dataset
        slot.dataset.score = newScore;
        slot.dataset.concise = newConcise;
        slot.dataset.detailed = newDetailed;

        await republishIfReleased(card, assignmentId, feedbackData);
        renderFeedbackSlot(slot, item, feedbackData, container);
    });
}
