import { state } from './state.js';
import { fetchDraftContent, getMasterAssignment, getFeedback } from './api.js';
import { performAssessment, updateBulkButton } from './assessment.js';
import { distributeFeedback } from './feedback.js';
import { parseSimpleMarkdown } from './utils.js';

export const renderLiveGrid = async (cls, assId, container, ui) => {
    const { printAllBtn, exportBtn, bulkAssessBtn } = ui;

    printAllBtn.disabled = false;
    printAllBtn.style.backgroundColor = "#17a2b8";
    printAllBtn.onclick = () => window.print();

    if (exportBtn) exportBtn.disabled = false;
    bulkAssessBtn.style.display = 'none';

    container.innerHTML = '<div style="text-align:center; margin-top:2em; color:#666;"><span class="spinner"></span> Lade Master-Daten & Schüler...</div>';

    // --- 2. Fetch Master Data (Total Questions) ---
    let masterTotalQuestions = 0;
    try {
        const masterAss = await getMasterAssignment(assId);
        if (masterAss && masterAss.subAssignments) {
            Object.values(masterAss.subAssignments).forEach(subTask => {
                if (subTask.questions) masterTotalQuestions += subTask.questions.length;
            });
        }
    } catch (e) { console.log("Local server offline or master not found."); }

    const useMasterTotal = masterTotalQuestions > 0;

    // --- 3. Process Students ---
    const students = state.draftsMap[cls];
    const studentNames = Object.keys(students).sort();
    const grid = document.createElement('div');
    grid.id = 'live-grid';

    const promises = studentNames.map(async (name) => {
        const files = students[name];
        if (!files || files.length === 0) return null;

        let correctData = null;
        const sortedFiles = [...files].sort((a, b) => b.name.localeCompare(a.name));

        for (const file of sortedFiles) {
            try {
                const data = await fetchDraftContent(file.path);
                if (data && data.assignments) {
                    if (data.assignments[assId]) {
                        correctData = data;
                        break;
                    }
                    const foundKey = Object.keys(data.assignments).find(k =>
                        decodeURIComponent(k).trim() === decodeURIComponent(assId).trim()
                    );
                    if (foundKey) {
                        correctData = data;
                        break;
                    }
                }
            } catch (e) { /* continue searching */ }
        }

        return { name, data: correctData };
    });

    const results = await Promise.all(promises);

    results.forEach(res => {
        if (!res) return;

        // --- 4. Render Student Card ---
        const card = document.createElement('div');
        card.className = 'student-card';
        card.dataset.studentName = res.name;
        card.dataset.studentData = JSON.stringify(res.data);

        let assignmentData = null;
        if (res.data && res.data.assignments) {
            if (res.data.assignments[assId]) {
                assignmentData = res.data.assignments[assId];
            } else {
                const foundKey = Object.keys(res.data.assignments).find(k =>
                    decodeURIComponent(k).trim() === decodeURIComponent(assId).trim()
                );
                if (foundKey) assignmentData = res.data.assignments[foundKey];
            }
        }

        let studentTotalParams = 0;
        let answeredQuestions = 0;
        let totalWords = 0;

        if (assignmentData) {
            Object.values(assignmentData).forEach(subTask => {
                if (subTask.questions) studentTotalParams += subTask.questions.length;
                if (subTask.answers) subTask.answers.forEach(a => {
                    if (a.answer && a.answer.trim() !== '' && a.answer !== '<p><br></p>') {
                        answeredQuestions++;
                        const textOnly = a.answer.replace(/<[^>]*>/g, ' ').trim();
                        if (textOnly.length > 0) totalWords += textOnly.split(/\s+/).length;
                    }
                });
            });
        }

        const finalTotal = useMasterTotal ? masterTotalQuestions : studentTotalParams;
        const progressPercent = finalTotal > 0 ? Math.round((answeredQuestions / finalTotal) * 100) : 0;
        const progressColor = progressPercent >= 80 ? '#28a745' : progressPercent >= 50 ? '#ffc107' : '#dc3545';

        let lastUpdateStr = '-';
        if (res.data && res.data.createdAt) {
            lastUpdateStr = new Date(res.data.createdAt).toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
        }

        // Header Construction
        const header = document.createElement('div');
        header.className = 'student-header';
        header.innerHTML = `
            <div class="header-left">
                <input type="checkbox" class="student-checkbox" data-student-name="${res.name}">
                <span class="toggle-icon">▶</span>
                <span class="student-name">${res.name}</span>
            </div>
            <div class="student-stats">
                <span class="progress-badge" style="background:${progressColor}">${answeredQuestions}/${finalTotal} ✓</span>
                <span class="word-count-badge">${totalWords} 📝</span>
                <span class="last-update-badge">🕒 ${lastUpdateStr}</span>
                <button class="live-feedback-btn" style="margin-left:5px; padding:3px 8px; border-radius:4px; border:1px solid #ccc; background:#fff; cursor:pointer; font-size:0.8em; font-weight:bold; color:#555;">⚡ Feedback</button>
            </div>
        `;

        header.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.classList.contains('student-checkbox')) return;
            card.classList.toggle('open');
        });

        const cb = header.querySelector('.student-checkbox');
        cb.addEventListener('change', () => updateBulkButton(bulkAssessBtn));

        const feedbackBtn = header.querySelector('.live-feedback-btn');
        feedbackBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await performAssessment(cls, assId, res.name, res.data, feedbackBtn, card);
        });

        card.appendChild(header);

        // Render Card Body
        const cardContent = document.createElement('div');
        cardContent.className = 'student-card-content';

        if (assignmentData) {
            const subIds = Object.keys(assignmentData).sort();
            if (subIds.length === 0) cardContent.innerHTML += '<p style="color:orange;">Keine Teilaufgaben.</p>';
            subIds.forEach(subId => {
                const subTask = assignmentData[subId];
                const subBlock = document.createElement('div');
                subBlock.className = 'sub-assignment-block';
                subBlock.innerHTML = `<div class="sub-title">${subTask.title || subId}</div>`;

                const answerMap = new Map((subTask.answers || []).map(a => [a.questionId, a.answer]));

                (subTask.questions || []).forEach((q, idx) => {
                    const ans = answerMap.get(q.id);
                    const qIdString = `${subId}_${q.id}`;
                    const qaWrapper = document.createElement('div');
                    qaWrapper.style.marginBottom = "20px";

                    const qTextParsed = parseSimpleMarkdown(q.text);
                    qaWrapper.innerHTML += `<div class="question-text" style="font-weight:bold; color:#333; margin-bottom:5px;">${idx + 1}. ${qTextParsed}</div>`;

                    const feedbackSlot = document.createElement('div');
                    feedbackSlot.className = 'inline-feedback';
                    feedbackSlot.dataset.qid = qIdString;
                    feedbackSlot.style.cssText = "display:none; background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:10px; margin-bottom:10px;";
                    qaWrapper.appendChild(feedbackSlot);

                    const answerDiv = document.createElement('div');
                    if (ans) {
                        answerDiv.className = "read-only-answer ql-editor";
                        answerDiv.innerHTML = ans;
                    } else {
                        answerDiv.className = "empty-answer-placeholder";
                        answerDiv.textContent = "(Keine Antwort)";
                    }
                    qaWrapper.appendChild(answerDiv);
                    subBlock.appendChild(qaWrapper);
                });
                cardContent.appendChild(subBlock);
            });
        } else {
            cardContent.innerHTML += '<p style="color:#ccc;">Noch nicht begonnen.</p>';
        }

        card.appendChild(cardContent);
        grid.appendChild(card);

        // --- 5. AUTOMATICALLY FETCH SAVED FEEDBACK ---
        getFeedback(cls, assId, res.name).then(data => {
            if (data && data.found && data.data) {
                distributeFeedback(data.data, cardContent);
                feedbackBtn.textContent = "Gespeichert ✓";
                feedbackBtn.style.backgroundColor = "#e0f2fe";
                feedbackBtn.style.borderColor = "#bae6fd";
                feedbackBtn.style.color = "#0369a1";
            }
        });
    });

    container.innerHTML = '';
    container.appendChild(grid);
};
