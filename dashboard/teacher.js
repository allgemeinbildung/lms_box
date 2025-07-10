import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    const submissionListContainer = document.getElementById('submission-list');
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
            renderSubmissionsList(data);
        } catch (error) {
            submissionListContainer.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
            // If the key was wrong, force re-login
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

    const renderSubmissionsList = (submissionMap) => {
        if (Object.keys(submissionMap).length === 0) {
            submissionListContainer.innerHTML = '<p>Noch keine Abgaben vorhanden.</p>';
            return;
        }
        let html = '';
        for (const studentId in submissionMap) {
            html += `<div class="student-group">
                        <div class="student-name">${studentId}</div>`;
            submissionMap[studentId].forEach(file => {
                html += `<a class="submission-file" data-path="${file.path}">${file.name}</a>`;
            });
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
            // Remove active class from any previously active link
            const currentActive = submissionListContainer.querySelector('.active');
            if (currentActive) currentActive.classList.remove('active');
            // Add active class to the clicked link
            e.target.classList.add('active');
            const path = e.target.dataset.path;
            fetchAndRenderSubmission(path);
        }
    });

    // Initial check on page load
    checkAuth();
});
