import { assessStudent } from './api.js';
import { distributeFeedback, showPublishPanel } from './feedback.js';

let stopBulkFlag = false;

/**
 * Filters studentData to only include questions that changed since last feedback.
 * Returns a deep clone of studentData where only changed sub-assignments/questions remain.
 */
export const filterStudentDataToChanges = (studentData, assId, changedQuestionIds) => {
    if (!studentData || !changedQuestionIds || changedQuestionIds.size === 0) return studentData;

    const filtered = JSON.parse(JSON.stringify(studentData));
    const assignments = filtered.assignments;
    if (!assignments) return filtered;

    let assKey = assId;
    if (!assignments[assId]) {
        assKey = Object.keys(assignments).find(k =>
            decodeURIComponent(k).trim() === decodeURIComponent(assId).trim()
        );
    }
    if (!assKey || !assignments[assKey]) return filtered;

    const assignmentData = assignments[assKey];
    Object.keys(assignmentData).forEach(subId => {
        const subTask = assignmentData[subId];
        if (subTask.answers) {
            subTask.answers = subTask.answers.filter(a =>
                changedQuestionIds.has(`${subId}_${a.questionId}`)
            );
        }
        if (subTask.questions) {
            const remainingIds = new Set((subTask.answers || []).map(a => a.questionId));
            subTask.questions = subTask.questions.filter(q => remainingIds.has(q.id));
        }
        if ((!subTask.answers || subTask.answers.length === 0) &&
            (!subTask.questions || subTask.questions.length === 0)) {
            delete assignmentData[subId];
        }
    });

    return filtered;
};

const clearUpdateIndicators = (card) => {
    card._hasUpdatedAnswers = false;
    card._changedQuestionIds = null;
    const badge = card.querySelector('.updated-badge');
    if (badge) badge.remove();
    card.querySelectorAll('.question-updated').forEach(el => el.classList.remove('question-updated'));
};

export const performAssessment = async (className, assignmentId, studentName, studentData, feedbackBtn, card, changedQuestionIds = null) => {
    feedbackBtn.disabled = true;
    feedbackBtn.textContent = "Analysiere...";
    feedbackBtn.style.backgroundColor = "#fff3cd";

    const dataToSend = (changedQuestionIds && changedQuestionIds.size > 0)
        ? filterStudentDataToChanges(studentData, assignmentId, changedQuestionIds)
        : studentData;

    try {
        const result = await assessStudent(className, assignmentId, studentName, dataToSend);
        if (result.error) throw new Error(result.error);

        const contentArea = card.querySelector('.student-card-content');
        distributeFeedback(result, contentArea);
        showPublishPanel(card, result, assignmentId, false, null);

        if (!card.classList.contains('open')) card.classList.add('open');
        feedbackBtn.textContent = "Fertig ✓";
        feedbackBtn.style.backgroundColor = "#dcfce7";

        clearUpdateIndicators(card);

    } catch (err) {
        console.error(err);
        feedbackBtn.textContent = "Fehler ❌";
        feedbackBtn.style.backgroundColor = "#fee2e2";
    } finally {
        setTimeout(() => {
            if (feedbackBtn) {
                feedbackBtn.disabled = false;
                if (feedbackBtn.textContent.includes('Fertig') || feedbackBtn.textContent.includes('Fehler')) {
                    feedbackBtn.textContent = "⚡ Feedback";
                    feedbackBtn.style.backgroundColor = "#fff";
                }
            }
        }, 3000);
    }
};

export const updateBulkButton = (bulkAssessBtn) => {
    const checkedBoxes = document.querySelectorAll('.student-checkbox:checked');
    if (checkedBoxes.length > 0) {
        bulkAssessBtn.style.display = 'inline-block';
        bulkAssessBtn.textContent = `⚡ ${checkedBoxes.length} bewerten`;
    } else {
        bulkAssessBtn.style.display = 'none';
    }
};

export const setupBulkAssessment = (ui) => {
    const { selectAllBtn, selectUpdatedBtn, bulkAssessBtn, cancelBulkBtn, bulkProgressOverlay, bulkProgressBar, bulkProgressText, classSelect, assignmentSelect } = ui;

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.student-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        updateBulkButton(bulkAssessBtn);
    });

    if (selectUpdatedBtn) {
        selectUpdatedBtn.addEventListener('click', () => {
            const checkboxes = document.querySelectorAll('.student-checkbox');
            checkboxes.forEach(cb => cb.checked = false);
            checkboxes.forEach(cb => {
                const card = cb.closest('.student-card');
                if (card && card._hasUpdatedAnswers) cb.checked = true;
            });
            updateBulkButton(bulkAssessBtn);
        });
    }

    cancelBulkBtn.addEventListener('click', () => {
        stopBulkFlag = true;
        cancelBulkBtn.textContent = "Breche ab...";
    });

    bulkAssessBtn.addEventListener('click', async () => {
        const selectedCheckboxes = Array.from(document.querySelectorAll('.student-checkbox:checked'));
        if (selectedCheckboxes.length === 0) return;

        stopBulkFlag = false;
        bulkProgressOverlay.style.display = 'flex';
        cancelBulkBtn.textContent = "Abbrechen";

        let processed = 0;
        const total = selectedCheckboxes.length;

        for (const cb of selectedCheckboxes) {
            if (stopBulkFlag) break;

            const studentName = cb.dataset.studentName;
            const card = cb.closest('.student-card');
            if (!card) continue;
            const feedbackBtn = card.querySelector('.live-feedback-btn');

            const cls = classSelect.value;
            const assId = assignmentSelect.value;

            if (cls && assId) {
                bulkProgressText.textContent = `${processed + 1} / ${total} - ${studentName}`;
                card.scrollIntoView({ behavior: 'auto', block: 'center' });

                let studentData = card._studentData || null;
                if (!studentData && card.dataset.studentData) {
                    try { studentData = JSON.parse(card.dataset.studentData); } catch (e) { studentData = null; }
                }

                if (studentData) {
                    const changedIds = (card._hasUpdatedAnswers && card._changedQuestionIds)
                        ? card._changedQuestionIds
                        : null;
                    await performAssessment(cls, assId, studentName, studentData, feedbackBtn, card, changedIds);
                } else {
                    console.warn(`Bulk assess: no student data for ${studentName}`);
                }
            }

            processed++;
            const pct = Math.round((processed / total) * 100);
            bulkProgressBar.style.width = `${pct}%`;
            bulkProgressText.textContent = `${processed} / ${total} verarbeitet`;
        }

        bulkProgressOverlay.style.display = 'none';
        if (!stopBulkFlag) {
            document.querySelectorAll('.student-checkbox').forEach(cb => cb.checked = false);
            updateBulkButton(bulkAssessBtn);
        }
    });
};
