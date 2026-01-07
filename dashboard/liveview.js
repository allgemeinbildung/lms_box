//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :  d a s h b o a r d / l i v e v i e w . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { state, setDraftsMap } from './modules/state.js';
import { listDrafts, fetchDraftContent } from './modules/api.js';
import { initAuth } from './modules/auth.js';
import { renderLiveGrid } from './modules/renderer.js';
import { setupAnalysisExport, setupRawDownload } from './modules/exporter.js';
import { setupBulkAssessment } from './modules/assessment.js';
import { setupPrintAll } from './modules/printer.js';

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
    const bulkAssessBtn = document.getElementById('bulk-assess-btn');
    const bulkProgressOverlay = document.getElementById('bulk-progress-overlay');
    const bulkProgressBar = document.getElementById('bulk-progress-bar');
    const bulkProgressText = document.getElementById('bulk-progress-text');
    const cancelBulkBtn = document.getElementById('cancel-bulk-btn');

    // Export Button
    const exportBtn = document.getElementById('export-analysis-btn');

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
            const data = await listDrafts();
            if (data.status === 'error') throw new Error(data.message);

            const map = {};
            for (const className in data) {
                const normalizedClass = className.toUpperCase();
                if (!map[normalizedClass]) map[normalizedClass] = {};
                Object.assign(map[normalizedClass], data[className]);
            }
            setDraftsMap(map);
            populateClassSelect();
        } catch (error) {
            console.error(error);
            if (error.message && error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth(); // Re-trigger auth
            } else {
                alert("Fehler beim Laden der Liste: " + (error.message || error));
            }
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
    };

    // --- Auth Chain ---
    // We get a "checkAuth" function back, but we pass "onSuccess"
    const checkAuth = initAuth(initDataLoad);

    // --- Scan Assignments Logic ---
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
        if (downloadBtn) downloadBtn.disabled = !selectedClass;
        if (exportBtn) exportBtn.disabled = !selectedClass;

        assignmentSelect.innerHTML = '<option value="">Lade Aufgaben...</option>';
        assignmentSelect.disabled = true;
        contentRenderer.innerHTML = '<div id="placeholder-msg">Bitte wählen Sie eine Aufgabe aus.</div>';

        if (!selectedClass) return;

        const students = state.draftsMap[selectedClass];
        const studentNames = Object.keys(students);

        if (studentNames.length === 0) {
            assignmentSelect.innerHTML = '<option value="">Keine Schüler gefunden</option>';
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

        assignmentSelect.innerHTML = '<option value="">-- Aufgabe wählen --</option>';
        if (foundAssignments.size === 0) {
            assignmentSelect.innerHTML += '<option value="" disabled>Keine Aufgaben gefunden.</option>';
        } else {
            Array.from(foundAssignments).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })).forEach(assId => {
                const opt = document.createElement('option');
                opt.value = assId;
                opt.textContent = assId;
                assignmentSelect.appendChild(opt);
            });
            assignmentSelect.disabled = false;
        }
        updateTitle();
    });

    // --- Render Trigger ---
    const runRender = async () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;
        if (cls && assId) {
            await renderLiveGrid(cls, assId, contentRenderer, {
                printAllBtn,
                exportBtn,
                bulkAssessBtn
            });
            updateTitle();
        }
    };

    assignmentSelect.addEventListener('change', () => {
        runRender();
        updateTitle();
    });
    refreshBtn.addEventListener('click', () => classSelect.value && assignmentSelect.value ? runRender() : initDataLoad());

    // --- Feature Setups ---

    // Bulk
    setupBulkAssessment({
        selectAllBtn, bulkAssessBtn, cancelBulkBtn, bulkProgressOverlay,
        bulkProgressBar, bulkProgressText, classSelect, assignmentSelect
    });

    // Export/Download
    if (exportBtn) setupAnalysisExport(exportBtn, () => ({ cls: classSelect.value, assId: assignmentSelect.value }));
    if (downloadBtn) setupRawDownload(downloadBtn, () => ({ cls: classSelect.value, assId: assignmentSelect.value }));

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
                        detailed_feedback: slot.dataset.detailed
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