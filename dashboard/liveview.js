// Import the backend URL
import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Authentication (Copied from teacher.js) ---
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    
    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            loginOverlay.classList.remove('visible');
            // If authenticated, start loading the assignment
            loadLiveAssignment(key); 
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

    // --- 2. Main Application Logic ---
    const loadLiveAssignment = async (teacherKey) => {
        const contentRenderer = document.getElementById('live-content-renderer');
        const loadingStatus = document.getElementById('loading-status');

        // Get assignmentId and subId from the URL
        const urlParams = new URLSearchParams(window.location.search);
        const assignmentId = urlParams.get('assignmentId');
        const subId = urlParams.get('subId');

        if (!assignmentId || !subId) {
            contentRenderer.innerHTML = '<p style="color: red;">Fehler: `assignmentId` oder `subId` in der URL nicht gefunden.</p>';
            return;
        }

        try {
            // --- 3. Fetch All Submissions (Multi-step process) ---

            // Step 3a: Get the list of all submission files
            [span_0](start_span)// (This logic is from fetchSubmissionsList in teacher.js[span_0](end_span))
            const listResponse = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listSubmissions', teacherKey })
            });
            const submissionMap = await listResponse.json();
            if (submissionMap.status === 'error') throw new Error(submissionMap.message);

            // Step 3b: Create a flat list of all student files to fetch
            const filesToFetch = [];
            for (const className in submissionMap) {
                for (const studentName in submissionMap[className]) {
                    // Find the latest submission file for each student
                    const latestFile = submissionMap[className][studentName].sort((a, b) => b.name.localeCompare(a.name))[0];
                    if (latestFile) {
                        filesToFetch.push({ studentName, path: latestFile.path });
                    }
                }
            }

            if (filesToFetch.length === 0) {
                loadingStatus.textContent = 'Noch keine Abgaben für dieses Modul gefunden.';
                return;
            }

            // Step 3c: Fetch the *content* of every single file in parallel
            loadingStatus.textContent = `Lade ${filesToFetch.length} Abgaben...`;
            
            const fetchPromises = filesToFetch.map(fileInfo => 
                fetchSubmissionContent(teacherKey, fileInfo.path)
                    .then(data => ({ ...fileInfo, submissionData: data }))
            );
            
            const allSubmissions = await Promise.all(fetchPromises);

            // --- 4. Render the Content ---
            renderAllAnswers(allSubmissions, assignmentId, subId);

        } catch (error) {
            contentRenderer.innerHTML = `<p style="color: red;">Fehler beim Laden der Abgaben: ${error.message}</p>`;
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

    /**
     * Fetches a single submission's content
     * [span_1](start_span)(Based on fetchSubmissionContent in teacher.js [cite: 87-91])
     */
    const fetchSubmissionContent = async (teacherKey, path) => {
        try {
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
            console.error(`Fehler beim Laden von ${path}:`, error);
            return null; // Continue even if one file fails
        }
    };

    /**
     * Renders all answers for the specific assignment
     */
    const renderAllAnswers = (allSubmissions, assignmentId, subId) => {
        const contentRenderer = document.getElementById('live-content-renderer');
        contentRenderer.innerHTML = ''; // Clear loading message

        let subAssignmentTitle = '';
        let questions = [];

        // Filter submissions to get only the relevant ones
        const relevantAnswers = [];
        
        for (const submission of allSubmissions) {
            if (!submission.submissionData || !submission.submissionData.assignments) continue;

            const assignment = submission.submissionData.assignments[assignmentId];
            if (!assignment) continue;

            const subAssignment = assignment[subId];
            if (!subAssignment) continue;
            
            // Save title and questions from the first student we find
            if (!subAssignmentTitle) {
                subAssignmentTitle = subAssignment.title;
                questions = subAssignment.questions || [];
                // Update page titles
                document.getElementById('main-title').textContent = submission.submissionData.assignments[assignmentId]?.title || assignmentId;
                document.getElementById('sub-title').textContent = subAssignmentTitle;
            }
            
            relevantAnswers.push({
                studentName: submission.studentName,
                [cite_start]answers: subAssignment.answers || [] // New structure[span_1](end_span)
            });
        }
        
        if (questions.length === 0) {
            contentRenderer.innerHTML = "<p>Keine Fragen-Struktur für diese Aufgabe gefunden.</p>";
            return;
        }

        // Loop through each QUESTION and display all student answers for it
        let html = '';
        questions.forEach((question, index) => {
            [span_2](start_span)// Use 'assignment-block' style from teacher.css[span_2](end_span)
            html += `<div class="assignment-block">`;
            html += `<h2>Frage ${index + 1}: ${question.text}</h2>`;

            // Now loop through all students
            relevantAnswers.forEach(student => {
                const answerMap = new Map(student.answers.map(a => [a.questionId, a.answer]));
                const answer = answerMap.get(question.id) || '<p><i>Keine Antwort abgegeben.</i></p>';

                html += `<div style="margin-top: 1.5em;">`;
                // This is the requirement: "The name of the student is set above the answer"
                html += `<p style="font-weight: bold; margin-bottom: 0.5em;">${student.studentName}</p>`;
                
                [span_3](start_span)[span_4](start_span)// Use 'answer-box' styles from teacher.css[span_3](end_span)[span_4](end_span)
                html += `<div class="answer-box"><div class="ql-snow"><div class="ql-editor">${answer}</div></div></div>`;
                html += `</div>`;
            });

            html += `</div>`;
        });

        contentRenderer.innerHTML = html;
    };

    // --- Initial Load ---
    checkAuth();
});
