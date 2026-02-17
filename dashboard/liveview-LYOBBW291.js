//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :   d a s h b o a r d / l i v e v i e w . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. Authentication (Copied from teacher.js) ---
    // These are the only DOM elements needed for login
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    
    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            loginOverlay.classList.remove('visible');
            // ✅ HIER ÄNDERN: Rufe die neue Funktion für diese Seite auf
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

    // --- 2. Main Application Logic (NEU) ---

    /**
     * Lädt und rendert die Live-Ansicht für eine bestimmte Aufgabe
     */
    const loadLiveAssignment = async (teacherKey) => {
        // Get elements from liveview.html
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
            // --- 3. Alle Abgaben abrufen (Multi-Schritt-Prozess) ---

            // Schritt 3a: Hole die LISTE aller Abgabedateien
            [span_0](start_span)// (Diese Logik ist von fetchSubmissionsList in teacher.js [cite: 65-71])
            const listResponse = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listSubmissions', teacherKey })
            });
            const submissionMap = await listResponse.json();
            if (submissionMap.status === 'error') throw new Error(submissionMap.message);

            // Schritt 3b: Erstelle eine flache Liste aller zu holenden Studentendateien
            const filesToFetch = [];
            for (const className in submissionMap) {
                for (const studentName in submissionMap[className]) {
                    // Finde die NEUESTE Abgabedatei für jeden Schüler
                    const latestFile = submissionMap[className][studentName]
                        .sort((a, b) => b.name.localeCompare(a.name))[0];
                    
                    if (latestFile) {
                        filesToFetch.push({ studentName, path: latestFile.path });
                    }
                }
            }

            if (filesToFetch.length === 0) {
                loadingStatus.textContent = 'Noch keine Abgaben für dieses Modul gefunden.';
                return;
            }

            // Schritt 3c: Hole den INHALT jeder einzelnen Datei
            loadingStatus.textContent = `Lade ${filesToFetch.length} Abgaben...`;
            
            const fetchPromises = filesToFetch.map(fileInfo => 
                fetchSubmissionContent(teacherKey, fileInfo.path)
                    // Hänge die Studentendaten an die Antwort an
                    .then(data => ({ ...fileInfo, submissionData: data }))
            );
            
            const allSubmissions = await Promise.all(fetchPromises);

            // --- 4. Inhalte rendern ---
            renderAllAnswers(allSubmissions, assignmentId, subId);

        } catch (error) {
            contentRenderer.innerHTML = `<p style="color: red;">Fehler beim Laden der Abgaben: ${error.message}</p>`;
            // Wichtig: Wenn der Schlüssel falsch ist, zeige das Login erneut an
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            }
        }
    };

    /**
     * Holt den Inhalt einer einzelnen Abgabe vom Backend
     * [cite_start](Basiert auf fetchSubmissionContent in teacher.js [cite: 87-91])
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
            return null; // Überspringe, wenn eine Datei fehlschlägt
        }
    };

    /**
     * Rendert alle Antworten für die spezifische Aufgabe
     */
    const renderAllAnswers = (allSubmissions, assignmentId, subId) => {
        const contentRenderer = document.getElementById('live-content-renderer');
        contentRenderer.innerHTML = ''; // Lade-Meldung löschen

        let subAssignmentTitle = '';
        let questions = [];
        const relevantAnswers = [];
        
        // Filtere alle Abgaben, um nur die relevanten Antworten zu finden
        for (const submission of allSubmissions) {
            if (!submission.submissionData || !submission.submissionData.assignments) continue;

            const assignment = submission.submissionData.assignments[assignmentId];
            if (!assignment) continue;

            const subAssignment = assignment[subId];
            if (!subAssignment) continue;
            
            // Speichere Titel und Fragenstruktur (wir brauchen sie nur einmal)
            if (!subAssignmentTitle) {
                subAssignmentTitle = subAssignment.title;
                questions = subAssignment.questions || [];
                // Seitentitel aktualisieren
                document.getElementById('main-title').textContent = assignmentId;
                document.getElementById('sub-title').textContent = subAssignmentTitle;
            }
            
            relevantAnswers.push({
                studentName: submission.studentName,
                [cite_start]answers: subAssignment.answers || [] //[span_0](end_span)
            });
        }
        
        if (questions.length === 0) {
            contentRenderer.innerHTML = "<p>Keine Fragen-Struktur für diese Aufgabe gefunden.</p>";
            return;
        }

        // Gehe durch jede FRAGE und zeige alle Schülerantworten dafür an
        let html = '';
        questions.forEach((question, index) => {
            [span_1](start_span)// Verwende 'assignment-block' Stil von teacher.css[span_1](end_span)
            html += `<div class="assignment-block">`;
            html += `<h2>Frage ${index + 1}: ${question.text}</h2>`;

            // Sortiere Schüler alphabetisch
            relevantAnswers.sort((a, b) => a.studentName.localeCompare(b.studentName));

            // Gehe nun alle Schüler durch
            relevantAnswers.forEach(student => {
                const answerMap = new Map(student.answers.map(a => [a.questionId, a.answer]));
                const answer = answerMap.get(question.id) || '<p><i>Keine Antwort abgegeben.</i></p>';

                html += `<div style="margin-top: 1.5em;">`;
                // Deine Anforderung: "Der Name des Schülers steht über der Antwort"
                html += `<p style="font-weight: bold; margin-bottom: 0.5em;">${student.studentName}</p>`;
                
                [span_2](start_span)// Verwende 'answer-box' Stile von teacher.css[span_2](end_span)
                html += `<div class="answer-box"><div class="ql-snow"><div class="ql-editor">${answer}</div></div></div>`;
                html += `</div>`;
            });

            html += `</div>`;
        });

        contentRenderer.innerHTML = html;
    };

    // --- Initialer Ladevorgang ---
    checkAuth();
});
