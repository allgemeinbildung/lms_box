import { assessStudent } from './api.js';
import { distributeFeedback } from './feedback.js';

let stopBulkFlag = false;

export const performAssessment = async (className, assignmentId, studentName, studentData, feedbackBtn, card) => {
    feedbackBtn.disabled = true;
    feedbackBtn.textContent = "Analysiere...";
    feedbackBtn.style.backgroundColor = "#fff3cd";

    try {
        const result = await assessStudent(className, assignmentId, studentName, studentData);
        if (result.error) throw new Error(result.error);

        const contentArea = card.querySelector('.student-card-content');
        distributeFeedback(result, contentArea);

        if (!card.classList.contains('open')) card.classList.add('open');
        feedbackBtn.textContent = "Fertig ✓";
        feedbackBtn.style.backgroundColor = "#dcfce7";

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
    const { selectAllBtn, bulkAssessBtn, cancelBulkBtn, bulkProgressOverlay, bulkProgressBar, bulkProgressText, classSelect, assignmentSelect } = ui;

    selectAllBtn.addEventListener('click', () => {
        const checkboxes = document.querySelectorAll('.student-checkbox');
        const allChecked = Array.from(checkboxes).every(cb => cb.checked);
        checkboxes.forEach(cb => cb.checked = !allChecked);
        updateBulkButton(bulkAssessBtn);
    });

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
            const feedbackBtn = card.querySelector('.live-feedback-btn');

            const studentData = JSON.parse(card.dataset.studentData || "{}");
            const cls = classSelect.value;
            const assId = assignmentSelect.value;

            if (studentData && cls && assId) {
                card.scrollIntoView({ behavior: 'smooth', block: 'center' });
                await performAssessment(cls, assId, studentName, studentData, feedbackBtn, card);
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
