export const fetchAndRenderStudentFeedback = async (scriptUrl, studentKey, assignmentId, subId, mode) => {
    try {
        const response = await fetch(scriptUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getFeedback', studentKey, assignmentId, mode })
        });
        const data = await response.json();
        if (!data.found || !data.data) return;

        const results = (data.data.results || []).filter(r =>
            r.question_id && r.question_id.startsWith(`${subId}_`)
        );
        if (results.length === 0) return;

        const settings = data.data.releaseSettings || { kurzbericht: true, ausfuehrlich: true, punkte: true };
        const sanitizedSubId = String(subId).replace(/[^a-zA-Z0-9-_]/g, '-');

        results.forEach(item => {
            const questionId = item.question_id.substring(subId.length + 1);
            const sanitizedQuestionId = String(questionId).replace(/[^a-zA-Z0-9-_]/g, '-');
            const editorDiv = document.getElementById(`quill-editor-${sanitizedSubId}-${sanitizedQuestionId}`);
            if (!editorDiv) return;

            const questionBlock = editorDiv.closest('.question-block');
            if (!questionBlock) return;

            const block = document.createElement('div');
            block.style.cssText = 'margin-top: 8px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 6px; padding: 8px 12px;';

            const row = document.createElement('div');
            row.style.cssText = 'display: flex; align-items: center; gap: 8px; flex-wrap: wrap;';

            if (settings.punkte !== false && item.score !== undefined) {
                let color = '#ef4444';
                if (item.score === 2) color = '#f59e0b';
                if (item.score === 3) color = '#22c55e';
                const badge = document.createElement('span');
                badge.style.cssText = `background:${color}; color:white; padding:2px 8px; border-radius:4px; font-size:0.8em; font-weight:bold; white-space:nowrap;`;
                badge.textContent = `${item.score} Punkte`;
                row.appendChild(badge);
            }

            if (settings.kurzbericht !== false && item.concise_feedback) {
                const concise = document.createElement('span');
                concise.style.cssText = 'font-size: 0.9em; font-weight: 600; color: #334155;';
                concise.textContent = item.concise_feedback;
                row.appendChild(concise);
            }

            if (row.hasChildNodes()) block.appendChild(row);

            if (settings.ausfuehrlich !== false && item.detailed_feedback) {
                const detail = document.createElement('div');
                detail.style.cssText = 'font-size: 0.85em; color: #555; background: white; padding: 6px 8px; border-left: 3px solid #bae6fd; margin-top: 6px; border-radius: 0 4px 4px 0;';
                detail.textContent = item.detailed_feedback;
                block.appendChild(detail);
            }

            questionBlock.appendChild(block);
        });
    } catch (e) {
        // Silent fail — student view unchanged if feedback unavailable
    }
};
