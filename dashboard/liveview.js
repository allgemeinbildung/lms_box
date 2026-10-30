//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :  d a s h b o a r d / l i v e v i e w . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { state, setDraftsMap } from './modules/state.js';
import { listDrafts, fetchDraftContent, watchClass } from './modules/api.js';
import { initAuth } from './modules/auth.js';
import { renderLiveGrid } from './modules/renderer.js';
import { setupAnalysisExport, setupRawDownload } from './modules/exporter.js';
import { setupBulkAssessment } from './modules/assessment.js';
import { setupPrintAll } from './modules/printer.js';
import { setupBulkFreigabe } from './modules/bulkFreigabe.js';
import { initOverview } from './modules/overview.js';

document.addEventListener('DOMContentLoaded', () => {

    // --- DOM Elements ---
    const classSelect = document.getElementById('class-select');
    const assignmentSelect = document.getElementById('assignment-select');
    const refreshBtn = document.getElementById('refresh-btn');
    const contentRenderer = document.getElementById('live-content-renderer');

    // Header Controls
    const controlsBar = document.getElementById('controls-bar');
    const buttonGroup = controlsBar.querySelector('.button-group');

    // Bulk Controls
    const selectAllBtn = document.getElementById('select-all-btn');
    const selectUpdatedBtn = document.getElementById('select-updated-btn');
    const bulkAssessBtn = document.getElementById('bulk-assess-btn');
    const bulkProgressOverlay = document.getElementById('bulk-progress-overlay');
    const bulkProgressBar = document.getElementById('bulk-progress-bar');
    const bulkProgressText = document.getElementById('bulk-progress-text');
    const cancelBulkBtn = document.getElementById('cancel-bulk-btn');

    // Export Button
    const exportBtn = document.getElementById('export-analysis-btn');

    // Bulk Freigabe Button
    const bulkFreigabeBtn = document.getElementById('bulk-freigabe-btn');

    // Print Button Logic
    let printAllBtn = document.getElementById('print-all-btn');
    if (!printAllBtn) {
        printAllBtn = document.createElement('button');
        printAllBtn.id = 'print-all-btn';
        printAllBtn.textContent = '🖨️ Klasse Drucken';
        printAllBtn.disabled = true;
        buttonGroup.appendChild(printAllBtn);
    }

    const downloadBtn = document.getElementById('download-btn');

    // Class tiles and class matrix (modules/overview.js); the selects below stay the one source of truth.
    const overview = initOverview({ classSelect, assignmentSelect, contentRenderer, refreshBtn });
    const printTitle = document.getElementById('print-title');

    const updateTitle = () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;
        if (cls && assId) {
            const cards = document.querySelectorAll('.student-card');
            const total = cards.length;
            const done = Array.from(cards).filter(card => {
                const feedbackBtn = card.querySelector('.live-feedback-btn');
                return feedbackBtn && feedbackBtn.textContent.includes('✓');
            }).length;

            const sanitizedAss = assId.replace(/[\s\W]+/g, '_');
            document.title = `${cls}_${sanitizedAss}`;
            if (printTitle) printTitle.textContent = `${cls} - ${assId} (Abgegeben: ${done}/${total})`;
        } else {
            document.title = "Live View - Ganze Klasse";
            if (printTitle) printTitle.textContent = "Live View";
        }
    };

    // --- Data Loading ---
    const initDataLoad = async () => {
        refreshBtn.textContent = 'Lade Liste...';
        refreshBtn.disabled = true;
        try {
            // Classes and students from the roster. The class ids are used as they are:
            // the evaluator files its results by class id.
            setDraftsMap(await listDrafts());
            populateClassSelect();
        } catch (error) {
            console.error(error);
            alert("Fehler beim Laden der Liste: " + (error.message || error));
        } finally {
            refreshBtn.textContent = '🔄 Aktualisieren';
            refreshBtn.disabled = false;
        }
    };

    const populateClassSelect = () => {
        const classes = Object.keys(state.draftsMap).sort();
        const currentVal = classSelect.value;
        classSelect.innerHTML = '<option value="">-- Klasse wählen --</option>';
        classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            classSelect.appendChild(opt);
        });
        classSelect.disabled = false;
        if (classes.includes(currentVal)) classSelect.value = currentVal;

        if (exportBtn) exportBtn.disabled = !classSelect.value;
        if (downloadBtn) downloadBtn.disabled = !classSelect.value;
        overview.classesLoaded();
    };

    // --- Auth Chain ---
    // We get a "checkAuth" function back, but we pass "onSuccess"
    const checkAuth = initAuth(initDataLoad);

    // --- Live updates: drafts of the selected class (listener in api.js) ---
    const fillAssignmentSelect = (foundAssignments) => {
        const currentVal = assignmentSelect.value;
        assignmentSelect.innerHTML = '<option value="">-- Aufgabe wählen --</option>';
        if (foundAssignments.size === 0) {
            assignmentSelect.innerHTML += '<option value="" disabled>Keine Aufgaben gefunden.</option>';
            assignmentSelect.disabled = true;
            return;
        }
        Array.from(foundAssignments).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach(assId => {
            const opt = document.createElement('option');
            opt.value = assId;
            opt.textContent = assId;
            assignmentSelect.appendChild(opt);
        });
        assignmentSelect.disabled = false;
        if (foundAssignments.has(currentVal)) assignmentSelect.value = currentVal;
    };

    const assignmentsOf = (students) => {
        const found = new Set();
        Object.values(students).forEach(files => {
            if (Array.isArray(files)) files.forEach(f => {
                const potentialId = f.name.trim();
                if (potentialId) found.add(potentialId);
            });
        });
        return found;
    };

    // Full renders and card refreshes run one after the other, never interleaved.
    let renderQueue = Promise.resolve();
    const enqueueRender = (fn) => {
        renderQueue = renderQueue.then(fn).catch(e => console.error(e));
        return renderQueue;
    };

    const pendingNames = new Set();
    let liveTimer = null;
    const scheduleLiveRender = (delay = 300) => {
        clearTimeout(liveTimer);
        liveTimer = setTimeout(() => enqueueRender(async () => {
            const cls = classSelect.value;
            const assId = assignmentSelect.value;
            if (!cls || !assId || !document.getElementById('live-grid')) { pendingNames.clear(); return; }
            // A bulk assessment holds on to the cards it walks through.
            if (bulkProgressOverlay.style.display === 'flex') { scheduleLiveRender(3000); return; }
            const names = new Set(pendingNames);
            pendingNames.clear();
            if (names.size === 0) return;
            const skipped = await renderLiveGrid(cls, assId, contentRenderer, { printAllBtn, exportBtn, bulkAssessBtn }, names);
            updateTitle();
            if (skipped.length) {
                skipped.forEach(n => pendingNames.add(n));
                scheduleLiveRender(3000);
            }
        }), delay);
    };

    const onDraftsChanged = ({ students, changed }) => {
        const cls = classSelect.value;
        if (!cls) return;
        state.draftsMap[cls] = students;
        fillAssignmentSelect(assignmentsOf(students));
        overview.draftsChanged();
        const assId = assignmentSelect.value;
        if (!assId || !document.getElementById('live-grid')) return;
        const hasCard = (name) => Array.from(document.querySelectorAll('.student-card')).some(c => c.dataset.studentName === name);
        changed.forEach(c => {
            if (c.assignmentId === assId || !hasCard(c.studentName)) pendingNames.add(c.studentName);
        });
        if (pendingNames.size) scheduleLiveRender();
    };

    // --- Scan Assignments Logic ---
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
        if (downloadBtn) downloadBtn.disabled = !selectedClass;
        if (exportBtn) exportBtn.disabled = !selectedClass;

        assignmentSelect.innerHTML = '<option value="">Lade Aufgaben...</option>';
        assignmentSelect.disabled = true;
        contentRenderer.innerHTML = '<div id="placeholder-msg">Bitte wählen Sie eine Aufgabe aus.</div>';

        pendingNames.clear();
        if (!selectedClass) { watchClass(null); return; }

        // Start the live listener for this class; resolves with its current drafts.
        try {
            const current = await watchClass(selectedClass, onDraftsChanged);
            if (classSelect.value !== selectedClass) return;
            state.draftsMap[selectedClass] = current;
        } catch (error) {
            console.error(error);
            assignmentSelect.innerHTML = '<option value="">Fehler beim Laden</option>';
            return;
        }

        const students = state.draftsMap[selectedClass];
        const studentNames = Object.keys(students);

        if (studentNames.length === 0) {
            assignmentSelect.innerHTML = '<option value="">Keine Schüler gefunden</option>';
            overview.classReady();
            return;
        }

        const foundAssignments = new Set();

        // 1. Scan filenames
        Object.values(students).forEach(files => {
            if (Array.isArray(files)) {
                files.forEach(f => {
                    const potentialId = f.name.replace(/\.json$/i, '').trim();
                    if (potentialId) foundAssignments.add(potentialId);
                });
            }
        });

        // 2. Deep Scan first few
        const studentsToScan = studentNames.slice(0, 3);
        const scanPromises = studentsToScan.map(async (name) => {
            const files = students[name];
            if (!Array.isArray(files) || files.length === 0) return;
            try {
                if (foundAssignments.size < 2) {
                    const draftContent = await fetchDraftContent(files[0].path);
                    if (draftContent && draftContent.assignments) {
                        Object.keys(draftContent.assignments).forEach(id => foundAssignments.add(id));
                    }
                }
            } catch (e) { console.warn(`Scan error: ${name}`); }
        });

        await Promise.all(scanPromises);
        if (classSelect.value !== selectedClass) return;

        fillAssignmentSelect(foundAssignments);
        updateTitle();
        overview.classReady();
    });

    // --- Render Trigger ---
    const runRender = () => enqueueRender(async () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;
        if (cls && assId) {
            pendingNames.clear();
            await renderLiveGrid(cls, assId, contentRenderer, {
                printAllBtn,
                exportBtn,
                bulkAssessBtn
            });
            updateTitle();
        }
    });

    assignmentSelect.addEventListener('change', () => {
        runRender();
        updateTitle();
    });
    refreshBtn.addEventListener('click', () => classSelect.value && assignmentSelect.value ? runRender() : initDataLoad());

    // --- Feature Setups ---

    // Bulk Assessment
    setupBulkAssessment({
        selectAllBtn, selectUpdatedBtn, bulkAssessBtn, cancelBulkBtn, bulkProgressOverlay,
        bulkProgressBar, bulkProgressText, classSelect, assignmentSelect
    });

    // Export/Download
    if (exportBtn) setupAnalysisExport(exportBtn, () => ({ cls: classSelect.value, assId: assignmentSelect.value }));
    if (downloadBtn) setupRawDownload(downloadBtn, () => ({ cls: classSelect.value, assId: assignmentSelect.value }));

    // Bulk Freigabe (release all feedback at once)
    if (bulkFreigabeBtn) setupBulkFreigabe(bulkFreigabeBtn, () => assignmentSelect.value);

    // Print
    setupPrintAll(printAllBtn, () => {
        // Callback to scrape data for printing
        const cards = document.querySelectorAll('.student-card');
        const allFeedbacks = [];
        const assignmentName = assignmentSelect.value;

        cards.forEach(card => {
            const slots = card.querySelectorAll('.inline-feedback[style*="block"]');
            if (slots.length > 0) {
                const studentName = card.querySelector('.student-name').textContent;
                const items = [];

                slots.forEach(slot => {
                    items.push({
                        question_id: slot.dataset.qid,
                        question_text: slot.dataset.qtext,
                        score: parseInt(slot.dataset.score),
                        concise_feedback: slot.dataset.concise,
                        detailed_feedback: slot.dataset.detailed,
                        original_answer: slot.dataset.originalAnswer || '',
                        correct_solution: slot.dataset.correctSolution || ''
                    });
                });

                const dateHeader = card.querySelector('.feedback-controls-header span');
                const dateStr = dateHeader ? dateHeader.textContent : '';

                allFeedbacks.push({
                    student_name: studentName,
                    date_str: dateStr,
                    results: items
                });
            }
        });

        const studentList = Array.from(cards).map(card => ({
            name: card.querySelector('.student-name').textContent,
            progress: card.querySelector('.progress-badge').textContent.replace('✓', '').trim()
        }));
        return { feedbackList: allFeedbacks, className: classSelect.value, assignmentName: assignmentSelect.value, studentList };
    });

    // Initial Trigger
    checkAuth();
});
