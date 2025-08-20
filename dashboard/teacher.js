//
// ────────────────────────────────────────────────────────────────
//   :::::: F I L E :   d a s h b o a r d / t e a c h e r . j s ::::::
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
            // ✅ UPDATED: Call new rendering functions
            renderClassFilter(Object.keys(data));
            renderSubmissionsList(data);
        } catch (error) {
            submissionListContainer.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

    /**
     * ✅ NEW: Renders the class filter dropdown.
     * @param {string[]} classes - An array of class names.
     */
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
     * ✅ UPDATED: Renders submissions grouped by class.
     * @param {object} submissionMap - The nested object from the backend.
     */
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

    const fetchAndRenderSubmission = async (path) => {
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = '<p>Lade Inhalt...</p>';
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

        } catch (error) {
            viewerContent.innerHTML = `<p style="color: red;">Fehler beim Laden der Abgabe: ${error.message}</p>`;
        }
    };

    // --- Event Delegation for Clicks ---
    submissionListContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('submission-file')) {
            const currentActive = submissionListContainer.querySelector('.active');
            if (currentActive) currentActive.classList.remove('active');
            e.target.classList.add('active');
            const path = e.target.dataset.path;
            fetchAndRenderSubmission(path);
        }
        // ✅ NEW: Toggle student list visibility
        if(e.target.classList.contains('class-name')) {
            const studentGroups = e.target.parentElement.querySelectorAll('.student-group');
            studentGroups.forEach(group => {
                group.style.display = group.style.display === 'none' ? 'block' : 'none';
            });
        }
    });

    checkAuth();
});