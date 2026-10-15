import { attachFormativToCard } from './formativ.js';
import { attachPasteToCard } from './pasteHints.js';
import { state } from './state.js';
import { fetchDraftContent, getMasterAssignment, getFeedback, getPublishedFeedbackStatus } from './api.js';
import { performAssessment, updateBulkButton } from './assessment.js';
import { distributeFeedback, showPublishPanel } from './feedback.js';
import { parseSimpleMarkdown, detectUpdatedAnswers } from './utils.js';
import { sanitizeAnswerFragment } from './sanitize.js';

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

const normalizePart = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
        return decodeURIComponent(raw).trim().toLowerCase();
    } catch {
        return raw.toLowerCase();
    }
};

const makeSolutionKey = (subId, questionId) => `${normalizePart(subId)}::${normalizePart(questionId)}`;

const findParsedSolution = (question, subTask) => {
    const fromQuestion = pickFirstNonEmpty(
        question?.parsed_solution,
        question?.parsedSolution,
        question?.correct_solution,
        question?.correctSolution,
        question?.model_solution,
        question?.modelSolution,
        question?.expected_answer,
        question?.expectedAnswer,
        question?.solution,
        question?.answer
    );
    if (fromQuestion) return fromQuestion;

    const solutionList = subTask?.solution?.solutions;
    if (!Array.isArray(solutionList)) return '';

    const entry = solutionList.find(sol =>
        String(sol?.id || '') === String(question?.id || '') ||
        String(sol?.questionId || '') === String(question?.id || '')
    );
    if (!entry) return '';

    return pickFirstNonEmpty(
        entry.parsed_solution,
        entry.parsedSolution,
        entry.correct_solution,
        entry.correctSolution,
        entry.model_solution,
        entry.modelSolution,
        entry.expected_answer,
        entry.expectedAnswer,
        entry.solution,
        entry.answer
    );
};

// Master data of the last full render, reused when single cards are refreshed.
let masterMemo = { assId: null, total: 0, solutions: new Map() };

/**
 * Renders the grid of one class and assignment.
 * `only` (a Set of student names) refreshes just those cards inside the existing grid —
 * used for live updates of drafts. Open/closed state and the checkbox are kept. A card
 * that is being edited or assessed is left alone; its name is returned so the caller can
 * try again later. Returns the list of such skipped names (empty after a full render).
 */
export const renderLiveGrid = async (cls, assId, container, ui, only = null) => {
    const { printAllBtn, exportBtn, bulkAssessBtn } = ui;
    const liveGrid = only ? container.querySelector('#live-grid') : null;
    const partial = Boolean(liveGrid) && masterMemo.assId === assId;
    const skipped = [];

    printAllBtn.disabled = false;
    printAllBtn.style.backgroundColor = "#17a2b8";
    printAllBtn.onclick = () => window.print();

    if (exportBtn) exportBtn.disabled = false;
    if (!partial) {
        bulkAssessBtn.style.display = 'none';
        container.innerHTML = '<div style="text-align:center; margin-top:2em; color:#666;"><span class="spinner"></span> Lade Master-Daten & Sch\u00fcler...</div>';
    }

    // --- 2. Fetch Master Data (Total Questions) ---
    let masterTotalQuestions = 0;
    const masterSolutionMap = new Map();
    if (partial) {
        masterTotalQuestions = masterMemo.total;
        masterMemo.solutions.forEach((value, key) => masterSolutionMap.set(key, value));
    } else try {
        const masterAss = await getMasterAssignment(assId);
        if (masterAss && masterAss.subAssignments) {
            Object.entries(masterAss.subAssignments).forEach(([subTitle, subTask]) => {
                if (subTask.questions) masterTotalQuestions += subTask.questions.length;

                const solvedById = new Map();
                const solutionEntries = Array.isArray(subTask?.solution?.solutions) ? subTask.solution.solutions : [];
                solutionEntries.forEach(sol => {
                    const solutionQuestionId = pickFirstNonEmpty(sol?.id, sol?.questionId);
                    if (!solutionQuestionId) return;
                    solvedById.set(
                        makeSolutionKey(subTitle, solutionQuestionId),
                        pickFirstNonEmpty(
                            sol?.parsed_solution,
                            sol?.parsedSolution,
                            sol?.correct_solution,
                            sol?.correctSolution,
                            sol?.model_solution,
                            sol?.modelSolution,
                            sol?.expected_answer,
                            sol?.expectedAnswer,
                            sol?.solution,
                            sol?.answer
                        )
                    );
                });

                (subTask.questions || []).forEach(question => {
                    const key = makeSolutionKey(subTitle, question?.id);
                    const parsedSolution = pickFirstNonEmpty(
                        solvedById.get(key),
                        question?.parsed_solution,
                        question?.parsedSolution,
                        question?.correct_solution,
                        question?.correctSolution,
                        question?.model_solution,
                        question?.modelSolution,
                        question?.expected_answer,
                        question?.expectedAnswer,
                        question?.solution,
                        question?.answer
                    );
                    if (parsedSolution) masterSolutionMap.set(key, parsedSolution);
                });
            });
        }
    } catch (e) { console.log("Local server offline or master not found."); }
    masterMemo = { assId, total: masterTotalQuestions, solutions: masterSolutionMap };

    const useMasterTotal = masterTotalQuestions > 0;

    // --- 3. Process Students ---
    const students = state.draftsMap[cls];
    const existingCards = new Map(partial
        ? Array.from(liveGrid.querySelectorAll('.student-card')).map(c => [c.dataset.studentName, c])
        : []);
    const isBusy = (card) => Boolean(card) && (
        card.querySelector('.edit-save-btn') || card.querySelector('.live-feedback-btn')?.disabled);
    const studentNames = Object.keys(students).sort().filter(name => {
        if (!partial) return true;
        if (!only.has(name)) return false;
        if (isBusy(existingCards.get(name))) { skipped.push(name); return false; }
        return true;
    });
    const grid = partial ? liveGrid : document.createElement('div');
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

        const studentKey = files[0]?.path?.split('/')[1] || '';
        return { name, data: correctData, studentKey };
    });

    const results = await Promise.all(promises);

    results.forEach(res => {
        if (!res) return;

        // --- 4. Render Student Card ---
        const card = document.createElement('div');
        card.className = 'student-card';
        card.dataset.studentName = res.name;
        card._studentData = res.data;
        card.dataset.studentData = JSON.stringify(res.data);
        const studentKey = res.studentKey || '';
        card.dataset.studentKey = studentKey;

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
        card.dataset.progressDone = String(answeredQuestions);
        card.dataset.progressTotal = String(finalTotal);
        card.dataset.progressPercent = String(progressPercent);

        let lastUpdateStr = '-';
        if (res.data && res.data.createdAt) {
            lastUpdateStr = new Date(res.data.createdAt).toLocaleString('de-DE', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
            });
        }

        // Header Construction
        const header = document.createElement('div');
        header.className = 'student-header';
        // Only numbers and fixed colours go into this template. The name (roster) is set as text below.
        header.innerHTML = `
            <div class="header-left">
                <input type="checkbox" class="student-checkbox">
                <span class="toggle-icon">▶</span>
                <span class="student-name"></span>
            </div>
            <div class="student-stats">
                <span class="progress-badge" style="background:${progressColor}">${answeredQuestions}/${finalTotal} ✓</span>
                <span class="progress-export-wrap" title="Fortschritt">
                    <span class="progress-export-bar">
                        <span class="progress-export-fill" style="width:${progressPercent}%; background:${progressColor};"></span>
                    </span>
                    <span class="progress-export-label">${progressPercent}%</span>
                </span>
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
        cb.dataset.studentName = res.name;
        header.querySelector('.student-name').textContent = res.name;
        cb.addEventListener('change', () => updateBulkButton(bulkAssessBtn));

        const feedbackBtn = header.querySelector('.live-feedback-btn');
        const runAssessment = async () => {
            const changedIds = (card._hasUpdatedAnswers && card._changedQuestionIds)
                ? card._changedQuestionIds
                : null;
            await performAssessment(cls, assId, res.name, res.data, feedbackBtn, card, changedIds);
        };
        card._runAssessment = runAssessment;
        feedbackBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await runAssessment();
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
                const subTitle = document.createElement('div');
                subTitle.className = 'sub-title';
                subTitle.textContent = subTask.title || subId;   // from the draft: text, never markup
                subBlock.appendChild(subTitle);

                const answerMap = new Map((subTask.answers || []).map(a => [a.questionId, a.answer]));

                (subTask.questions || []).forEach((q, idx) => {
                    const ans = answerMap.get(q.id);
                    const qIdString = `${subId}_${q.id}`;
                    const parsedSolution = pickFirstNonEmpty(
                        masterSolutionMap.get(makeSolutionKey(subId, q.id)),
                        findParsedSolution(q, subTask)
                    );
                    const qaWrapper = document.createElement('div');
                    qaWrapper.className = 'qa-wrapper';
                    qaWrapper.style.marginBottom = "20px";

                    // q.text comes from the draft: parseSimpleMarkdown escapes it and adds <b>/<i> only.
                    const questionDiv = document.createElement('div');
                    questionDiv.className = 'question-text';
                    questionDiv.style.cssText = 'font-weight:bold; color:#333; margin-bottom:5px;';
                    questionDiv.innerHTML = `${idx + 1}. ${parseSimpleMarkdown(typeof q.text === 'string' ? q.text : '')}`;
                    qaWrapper.appendChild(questionDiv);

                    const feedbackSlot = document.createElement('div');
                    feedbackSlot.className = 'inline-feedback';
                    feedbackSlot.dataset.qid = qIdString;
                    feedbackSlot.dataset.qtext = q.text || '';
                    feedbackSlot.dataset.originalAnswer = ans || '';
                    feedbackSlot.dataset.correctSolution = parsedSolution || '';
                    feedbackSlot.style.cssText = "display:none; background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:10px; margin-bottom:10px;";
                    qaWrapper.appendChild(feedbackSlot);

                    const answerDiv = document.createElement('div');
                    if (ans) {
                        answerDiv.className = "read-only-answer ql-editor";
                        // The answer is HTML the student controls: allow-list sanitiser, never innerHTML.
                        answerDiv.replaceChildren(sanitizeAnswerFragment(ans));
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
        const previous = existingCards.get(res.name);
        if (previous && previous.parentNode === grid) {
            if (previous.classList.contains('open')) card.classList.add('open');
            cb.checked = Boolean(previous.querySelector('.student-checkbox')?.checked);
            previous.replaceWith(card);
        } else {
            grid.appendChild(card);
        }

        // formativ feedback the student received (teacher view)
        attachFormativToCard(card, studentKey, assId);
        // text inserted instead of typed (pasteEvents)
        attachPasteToCard(card, studentKey, assId);

        // --- 5. AUTOMATICALLY FETCH SAVED FEEDBACK ---
        getFeedback(cls, assId, res.name).then(data => {
            if (data && data.found && data.data) {
                distributeFeedback(data.data, cardContent);
                card._feedbackData = data.data; // stored for bulk-freigabe
                feedbackBtn.textContent = "Gespeichert \u2713";
                feedbackBtn.style.backgroundColor = "#e0f2fe";
                feedbackBtn.style.borderColor = "#bae6fd";
                feedbackBtn.style.color = "#0369a1";

                // --- DETECT UPDATED ANSWERS ---
                if (assignmentData) {
                    const { hasChanges, changedQuestionIds } = detectUpdatedAnswers(assignmentData, data.data);
                    card._hasUpdatedAnswers = hasChanges;
                    card._changedQuestionIds = changedQuestionIds;

                    if (hasChanges) {
                        const statsDiv = card.querySelector('.student-stats');
                        const badge = document.createElement('span');
                        badge.className = 'updated-badge';
                        badge.textContent = `${changedQuestionIds.size} neu`;
                        badge.title = `${changedQuestionIds.size} Antwort(en) seit letztem Feedback geändert`;
                        statsDiv.insertBefore(badge, feedbackBtn);

                        changedQuestionIds.forEach(qid => {
                            const slot = cardContent.querySelector(`.inline-feedback[data-qid="${CSS.escape(qid)}"]`);
                            if (slot) slot.closest('.qa-wrapper')?.classList.add('question-updated');
                        });
                    }
                }

                if (studentKey) {
                    getPublishedFeedbackStatus(studentKey, assId).then(status => {
                        showPublishPanel(card, data.data, assId, status.released || false, status.releaseSettings || null);
                    });
                }
            }
        });
    });

    // Print-only ranking: most completed tasks first.
    const cardsForPrintOrder = Array.from(grid.querySelectorAll('.student-card'));
    cardsForPrintOrder.sort((a, b) => {
        const doneA = parseInt(a.dataset.progressDone || '0', 10);
        const doneB = parseInt(b.dataset.progressDone || '0', 10);
        if (doneB !== doneA) return doneB - doneA;

        const pctA = parseInt(a.dataset.progressPercent || '0', 10);
        const pctB = parseInt(b.dataset.progressPercent || '0', 10);
        if (pctB !== pctA) return pctB - pctA;

        return (a.dataset.studentName || '').localeCompare(b.dataset.studentName || '', 'de', { sensitivity: 'base' });
    });
    cardsForPrintOrder.forEach((card, index) => {
        card.style.setProperty('--print-order', String(index));
    });

    if (!partial) {
        container.innerHTML = '';
        container.appendChild(grid);
    }
    return skipped;
};

