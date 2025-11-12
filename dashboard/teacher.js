//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :   d a s h b o a r d / t e a c h e r . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    const submissionListContainer = document.getElementById('submission-list');
    const classFilterContainer = document.getElementById('class-filter-container');
    const viewerContent = document.getElementById('viewer-content');
    const viewerPlaceholder = document.getElementById('viewer-placeholder');
    const downloadBtn = document.getElementById('download-btn');
    const downloadBtnText = document.getElementById('download-btn-text');
    const downloadStatus = document.getElementById('download-status');

    let fullSubmissionData = {};

    // --- Authentication (No changes needed) ---
    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            loginOverlay.classList.remove('visible');
            // ✅ UPDATED: Call the new function to fetch drafts
            fetchDraftsList(key);
        } else {
            loginOverlay.classList.add('visible');
        }
    };

    const attemptLogin = () => {
        const key = keyInput.value.trim();
        if (!key) {
            loginStatus.textContent = 'Bitte einen Schlüssel eingeben.';
            return;
        }
        sessionStorage.setItem('teacherKey', key);
        loginStatus.textContent = '';
        checkAuth();
    };

    loginBtn.addEventListener('click', attemptLogin);
    keyInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') attemptLogin();
    });

    // --- Data Fetching and Rendering ---

    /**
     * ✅ UPDATED: Fetches the list of all available student drafts from the backend.
     * @param {string} teacherKey - The authentication key for the teacher.
     */
    const fetchDraftsList = async (teacherKey) => {
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                // ✅ UPDATED: The action now requests 'listDrafts'
                body: JSON.stringify({ action: 'listDrafts', teacherKey })
            });
            const data = await response.json();
            if (data.status === 'error') throw new Error(data.message);
            
            // The normalization logic for class names remains useful
            const rawDraftMap = data;
            const normalizedDraftMap = {};

            for (const className in rawDraftMap) {
                const normalizedClassName = className.toUpperCase();
                if (!normalizedDraftMap[normalizedClassName]) {
                    normalizedDraftMap[normalizedClassName] = {};
                }
                Object.assign(normalizedDraftMap[normalizedClassName], rawDraftMap[className]);
            }
            
            fullSubmissionData = normalizedDraftMap;
            renderClassFilter(Object.keys(normalizedDraftMap));
            renderSubmissionsList(normalizedDraftMap);

        } catch (error) {
            submissionListContainer.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

    // No changes needed in renderClassFilter
    const renderClassFilter = (classes) => {
        if (classes.length === 0) {
            classFilterContainer.innerHTML = '';
            return;
        }
        let options = '<option value="all">Alle Klassen anzeigen</option>';
        classes.sort().forEach(klasse => {
            options += `<option value="${klasse}">${klasse}</option>`;
        });
        classFilterContainer.innerHTML = `<select id="class-filter">${options}</select>`;

        document.getElementById('class-filter').addEventListener('change', (e) => {
            const selectedClass = e.target.value;
            const allClassGroups = document.querySelectorAll('.class-group');
            allClassGroups.forEach(group => {
                if (selectedClass === 'all' || group.dataset.className === selectedClass) {
                    group.style.display = 'block';
                } else {
                    group.style.display = 'none';
                }
            });
        });
    };
    
    /**
     * ✅ UPDATED: Renders the list of students and a single link to their latest draft.
     * @param {object} submissionMap - The map of classes, students, and their draft info.
     */
    const renderSubmissionsList = (submissionMap) => {
        if (Object.keys(submissionMap).length === 0) {
            submissionListContainer.innerHTML = '<p>Noch keine Entwürfe vorhanden.</p>';
            return;
        }
        let html = '';
        const sortedClasses = Object.keys(submissionMap).sort();

        for (const klasse of sortedClasses) {
            html += `<div class="class-group" data-class-name="${klasse}">
                         <div class="class-name">${klasse}</div>`;
            const students = submissionMap[klasse];
            const sortedStudents = Object.keys(students).sort();

            for (const studentName of sortedStudents) {
                const draftInfo = students[studentName]; // This is now an object, not an array
                html += `<div class="student-group">
                             <div class="student-name">${studentName}</div>`;
                // ✅ UPDATED: Display a single link for the latest draft
                html += `<a class="submission-file" data-path="${draftInfo.path}">Latest Draft</a>`;
                html += `</div>`;
            }
            html += `</div>`;
        }
        submissionListContainer.innerHTML = html;
    };

    /**
     * ✅ UPDATED: Fetches the content of a single student draft.
     * @param {string} path - The path to the draft file in the bucket.
     */
    const fetchDraftContent = async (path) => {
        try {
            const teacherKey = sessionStorage.getItem('teacherKey');
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                // ✅ UPDATED: Action is 'getDraft', parameter is 'draftPath'
                body: JSON.stringify({ action: 'getDraft', teacherKey, draftPath: path })
            });
            const data = await response.json();
            if (data.status === 'error') throw new Error(data.message);
            return data;
        } catch (error) {
            console.error(`Fehler beim Laden des Entwurfs [${path}]:`, error);
            return null;
        }
    };

    /**
     * ✅ UPDATED: Fetches and renders the content of a selected draft.
     * @param {string} path - The path to the draft file.
     */
    const fetchAndRenderDraft = async (path) => {
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = '<p>Lade Inhalt...</p>';
        
        // ✅ UPDATED: Call the new function to get draft content
        const data = await fetchDraftContent(path);
        
        if (!data) {
             viewerContent.innerHTML = `<p style="color: red;">Fehler beim Laden des Entwurfs.</p>`;
             return;
        }

        // The rendering logic itself was already compatible with the new data structure.
        let contentHtml = `<h1>Entwurf vom ${new Date(data.createdAt).toLocaleString('de-CH')}</h1>`;
        for (const assignmentId in data.assignments) {
            for (const subId in data.assignments[assignmentId]) {
                const subData = data.assignments[assignmentId][subId];
                contentHtml += `<div class="assignment-block">
                                    <h2>${subData.title}</h2>`;

                if (subData.answers && Array.isArray(subData.answers)) {
                    const answerMap = new Map(subData.answers.map(a => [a.questionId, a.answer]));
                    
                    subData.questions.forEach((question, index) => {
                        const answer = answerMap.get(question.id) || '<p><i>Keine Antwort abgegeben.</i></p>';
                        contentHtml += `
                            <div style="margin-top: 1.5em;">
                                <p style="font-weight: bold; margin-bottom: 0.5em;">Frage ${index + 1}: ${question.text}</p>
                                <div class="answer-box"><div class="ql-snow"><div class="ql-editor">${answer}</div></div></div>
                            </div>
                        `;
                    });
                }
                contentHtml += `</div>`;
            }
        }
        viewerContent.innerHTML = contentHtml;
    };
    
    /**
     * ✅ UPDATED: Handles downloading all drafts for selected classes.
     */
    const downloadSubmissions = async () => {
        if (!window.showDirectoryPicker) {
            alert("Dein Browser unterstützt diese Funktion nicht. Bitte nutze einen aktuellen Browser wie Chrome oder Edge.");
            return;
        }

        const selectedClass = document.getElementById('class-filter')?.value || 'all';
        const classesToDownload = selectedClass === 'all' 
            ? Object.keys(fullSubmissionData)
            : [selectedClass];

        if (classesToDownload.length === 0) {
            alert("Keine Klassen zum Herunterladen gefunden.");
            return;
        }
        
        let dirHandle;
        try {
            dirHandle = await window.showDirectoryPicker();
        } catch(err) {
            console.log("Auswahl des Verzeichnisses abgebrochen.");
            return;
        }

        downloadBtn.disabled = true;
        downloadBtnText.textContent = "Lade herunter...";

        // ✅ UPDATED: Build a flat list of drafts to download
        let draftsToDownload = [];
        for (const className of classesToDownload) {
            for (const studentName in fullSubmissionData[className]) {
                const draftInfo = fullSubmissionData[className][studentName];
                draftsToDownload.push({ className, studentName, draftInfo });
            }
        }

        let processedCount = 0;
        for (const item of draftsToDownload) {
            processedCount++;
            downloadStatus.textContent = `(${processedCount}/${draftsToDownload.length})`;

            const classHandle = await dirHandle.getDirectoryHandle(item.className, { create: true });
            const studentHandle = await classHandle.getDirectoryHandle(item.studentName, { create: true });
            
            // ✅ UPDATED: Use a consistent filename for the draft
            const fileName = `draft.json`;
            
            // ✅ UPDATED: Fetch draft content using the new function
            const draftContent = await fetchDraftContent(item.draftInfo.path);
            if (draftContent) {
                // The logic to avoid re-downloading identical files is kept
                try {
                     const fileHandle = await studentHandle.getFileHandle(fileName, { create: false });
                     const existingFile = await fileHandle.getFile();
                     const existingText = await existingFile.text();
                     if (existingText === JSON.stringify(draftContent, null, 2)) {
                         console.log(`Datei ${fileName} ist aktuell. Überspringe.`);
                         continue;
                     }
                } catch (e) {
                    // File does not exist, which is fine. We'll create it.
                }
                
                const writable = await (await studentHandle.getFileHandle(fileName, { create: true })).createWritable();
                await writable.write(JSON.stringify(draftContent, null, 2));
                await writable.close();
            }
        }
        
        downloadBtnText.textContent = "Abgaben herunterladen";
        downloadStatus.textContent = `(Fertig!)`;
        downloadBtn.disabled = false;
        setTimeout(() => { downloadStatus.textContent = ''; }, 4000);
    };

    downloadBtn.addEventListener('click', downloadSubmissions);

    // --- Event Delegation for Clicks ---
    submissionListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('submission-file')) {
            const currentActive = submissionListContainer.querySelector('.active');
            if (currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');
            const path = e.target.dataset.path;
            // ✅ UPDATED: Call the new render function
            fetchAndRenderDraft(path);
        }
        if(e.target.classList.contains('class-name')) {
            const studentGroups = e.target.parentElement.querySelectorAll('.student-group');
            studentGroups.forEach(group => {
                group.style.display = group.style.display === 'none' ? 'block' : 'none';
            });
        }
    });

    checkAuth();
});