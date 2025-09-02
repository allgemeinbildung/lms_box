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
    const downloadBtn = document.getElementById('download-btn'); // ✅ NEU
    const downloadBtnText = document.getElementById('download-btn-text'); // ✅ NEU
    const downloadStatus = document.getElementById('download-status'); // ✅ NEU

    let fullSubmissionData = {}; // Store the complete submission map

    // --- Authentication ---
    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            loginOverlay.classList.remove('visible');
            fetchSubmissionsList(key);
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
    const fetchSubmissionsList = async (teacherKey) => {
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listSubmissions', teacherKey })
            });
            const data = await response.json();
            if (data.status === 'error') throw new Error(data.message);
            
            const rawSubmissionMap = data;
            const normalizedSubmissionMap = {};

            for (const className in rawSubmissionMap) {
                const normalizedClassName = className.toUpperCase();
                if (!normalizedSubmissionMap[normalizedClassName]) {
                    normalizedSubmissionMap[normalizedClassName] = {};
                }
                Object.assign(normalizedSubmissionMap[normalizedClassName], rawSubmissionMap[className]);
            }
            
            fullSubmissionData = normalizedSubmissionMap; // ✅ NEU: Globale Daten speichern
            renderClassFilter(Object.keys(normalizedSubmissionMap));
            renderSubmissionsList(normalizedSubmissionMap);

        } catch (error) {
            submissionListContainer.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

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
    
    const renderSubmissionsList = (submissionMap) => {
        if (Object.keys(submissionMap).length === 0) {
            submissionListContainer.innerHTML = '<p>Noch keine Abgaben vorhanden.</p>';
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
                html += `<div class="student-group">
                             <div class="student-name">${studentName}</div>`;
                students[studentName].forEach(file => {
                    html += `<a class="submission-file" data-path="${file.path}">${file.name}</a>`;
                });
                html += `</div>`;
            }
            html += `</div>`;
        }
        submissionListContainer.innerHTML = html;
    };

    const fetchSubmissionContent = async (path) => {
        try {
            const teacherKey = sessionStorage.getItem('teacherKey');
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getSubmission', teacherKey, submissionPath: path })
            });
            const data = await response.json();
            if (data.status === 'error') throw new Error(data.message);
            return data;
        } catch (error) {
            console.error(`Fehler beim Laden der Abgabe [${path}]:`, error);
            return null; // Return null on error
        }
    };

    const fetchAndRenderSubmission = async (path) => {
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = '<p>Lade Inhalt...</p>';
        
        const data = await fetchSubmissionContent(path);
        
        if (!data) {
             viewerContent.innerHTML = `<p style="color: red;">Fehler beim Laden der Abgabe.</p>`;
             return;
        }

        let contentHtml = `<h1>Abgabe vom ${new Date(data.createdAt).toLocaleString('de-CH')}</h1>`;
        for (const assignmentId in data.assignments) {
            for (const subId in data.assignments[assignmentId]) {
                const subData = data.assignments[assignmentId][subId];
                contentHtml += `<div class="assignment-block">
                                    <h2>${subData.title}</h2>
                                    <div class="answer-box"><div class="ql-snow"><div class="ql-editor">${subData.answer}</div></div></div>
                                </div>`;
            }
        }
        viewerContent.innerHTML = contentHtml;
    };
    
    // --- ✅ NEU: Download & Sync Logic ---
    const downloadSubmissions = async () => {
        if (!window.showDirectoryPicker) {
            alert("Dein Browser unterstützt diese Funktion nicht. Bitte nutze einen aktuellen Browser wie Chrome oder Edge.");
            return;
        }

        // 1. Get selected classes
        const selectedClass = document.getElementById('class-filter').value;
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

        let filesToDownload = [];
        for (const className of classesToDownload) {
            for (const studentName in fullSubmissionData[className]) {
                fullSubmissionData[className][studentName].forEach(file => {
                    filesToDownload.push({ className, studentName, file });
                });
            }
        }

        let processedCount = 0;
        for (const item of filesToDownload) {
            processedCount++;
            downloadStatus.textContent = `(${processedCount}/${filesToDownload.length})`;

            const classHandle = await dirHandle.getDirectoryHandle(item.className, { create: true });
            const studentHandle = await classHandle.getDirectoryHandle(item.studentName, { create: true });
            
            const fileName = `${item.file.name}.json`;
            
            const submissionContent = await fetchSubmissionContent(item.file.path);
            if (submissionContent) {
                try {
                     const fileHandle = await studentHandle.getFileHandle(fileName, { create: false });
                     // Sync-Check: Wenn die Datei existiert, vergleichen wir den Inhalt.
                     const existingFile = await fileHandle.getFile();
                     const existingText = await existingFile.text();
                     if (existingText === JSON.stringify(submissionContent, null, 2)) {
                         console.log(`Datei ${fileName} ist aktuell. Überspringe.`);
                         continue; // Skip to next file
                     }
                } catch (e) {
                    // File does not exist, which is fine. We'll create it.
                }
                
                // Write or overwrite the file
                const writable = await (await studentHandle.getFileHandle(fileName, { create: true })).createWritable();
                await writable.write(JSON.stringify(submissionContent, null, 2));
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
            fetchAndRenderSubmission(path);
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