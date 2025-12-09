//
// ────────────────────────────────────────────────────────────────
//  :::::: F I L E :  d a s h b o a r d / l i v e v i e w . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    
    // --- DOM Elements ---
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    
    const classSelect = document.getElementById('class-select');
    const assignmentSelect = document.getElementById('assignment-select');
    const refreshBtn = document.getElementById('refresh-btn');
    const downloadBtn = document.getElementById('download-btn'); // Neuer Button
    const contentRenderer = document.getElementById('live-content-renderer');

    // State
    let draftsMap = {}; 
    let currentTeacherKey = '';

    // --- 1. Authentication ---
    const checkAuth = () => {
        const key = sessionStorage.getItem('teacherKey');
        if (key) {
            currentTeacherKey = key;
            loginOverlay.classList.remove('visible');
            initDataLoad(); 
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
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

    // --- 2. Data Loading & Initialization ---

    const initDataLoad = async () => {
        refreshBtn.textContent = 'Lade Liste...';
        refreshBtn.disabled = true;
        
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listDrafts', teacherKey: currentTeacherKey })
            });
            const data = await response.json();
            
            if (data.status === 'error') throw new Error(data.message);
            
            draftsMap = {};
            for (const className in data) {
                const normalizedClass = className.toUpperCase();
                if (!draftsMap[normalizedClass]) draftsMap[normalizedClass] = {};
                Object.assign(draftsMap[normalizedClass], data[className]);
            }

            populateClassSelect();

        } catch (error) {
            console.error(error);
            if (error.message.includes('Invalid teacher key')) {
                sessionStorage.removeItem('teacherKey');
                checkAuth();
            } else {
                alert("Fehler beim Laden der Liste: " + error.message);
            }
        } finally {
            refreshBtn.textContent = '🔄 Aktualisieren';
            refreshBtn.disabled = false;
        }
    };

    // --- 3. UI Logic: Populate Dropdowns ---

    const populateClassSelect = () => {
        const classes = Object.keys(draftsMap).sort();
        const currentVal = classSelect.value;
        
        classSelect.innerHTML = '<option value="">-- Klasse wählen --</option>';
        classes.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c;
            opt.textContent = c;
            classSelect.appendChild(opt);
        });
        classSelect.disabled = false;

        if (classes.includes(currentVal)) {
            classSelect.value = currentVal;
        }

        // --- FIX: Button Status sofort aktualisieren ---
        // Wenn eine Klasse ausgewählt ist (oder wiederhergestellt wurde), Button aktivieren
        downloadBtn.disabled = !classSelect.value;
    };

    // --- Helper für Markdown ---
    const parseSimpleMarkdown = (text) => {
        if (!text) return '';
        return text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>');
    };

    // --- Aufgaben erkennen (Scan Logik) ---
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
        
        // Button Status beim Wechseln aktualisieren
        downloadBtn.disabled = !selectedClass;

        assignmentSelect.innerHTML = '<option value="">Lade Aufgaben...</option>';
        assignmentSelect.disabled = true;
        contentRenderer.innerHTML = '<div id="placeholder-msg">Bitte wählen Sie eine Aufgabe aus.</div>';

        if (!selectedClass) return;

        const students = draftsMap[selectedClass];
        const studentNames = Object.keys(students);
        
        if (studentNames.length === 0) {
            assignmentSelect.innerHTML = '<option value="">Keine Schüler gefunden</option>';
            return;
        }

        const studentsToScan = studentNames.slice(0, 5); 
        const foundAssignments = new Set();
        
        const scanPromises = studentsToScan.map(async (name) => {
            const files = students[name];
            if (!Array.isArray(files) || files.length === 0) return;
            try {
                const draftContent = await fetchDraftContent(files[0].path);
                if (draftContent && draftContent.assignments) {
                    Object.keys(draftContent.assignments).forEach(id => foundAssignments.add(id));
                }
            } catch (e) {
                console.warn(`Konnte Struktur von ${name} nicht lesen.`);
            }
        });

        await Promise.all(scanPromises);

        assignmentSelect.innerHTML = '<option value="">-- Aufgabe wählen --</option>';
        if (foundAssignments.size === 0) {
             assignmentSelect.innerHTML += '<option value="" disabled>Keine Aufgaben gefunden.</option>';
        } else {
            Array.from(foundAssignments).sort().forEach(assId => {
                const opt = document.createElement('option');
                opt.value = assId;
                opt.textContent = assId;
                assignmentSelect.appendChild(opt);
            });
            assignmentSelect.disabled = false;
        }
    });

    // --- 4. Render Grid ---

    assignmentSelect.addEventListener('change', () => {
        renderLiveGrid();
    });

    refreshBtn.addEventListener('click', () => {
        if (classSelect.value && assignmentSelect.value) {
            renderLiveGrid();
        } else {
            initDataLoad();
        }
    });

    const renderLiveGrid = async () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;

        if (!cls || !assId) return;

        contentRenderer.innerHTML = '<p style="text-align:center; margin-top:2em;">Lade Daten aller Schüler/innen...</p>';
        
        const students = draftsMap[cls];
        const studentNames = Object.keys(students).sort();

        const grid = document.createElement('div');
        grid.id = 'live-grid';

        const promises = studentNames.map(async (name) => {
            const files = students[name];
            if (!files || files.length === 0) return null;
            
            const sortedFiles = [...files].sort((a, b) => b.name.localeCompare(a.name));
            const filePath = sortedFiles[0].path; 

            try {
                const data = await fetchDraftContent(filePath);
                return { name, data };
            } catch (e) {
                return { name, error: true };
            }
        });

        const results = await Promise.all(promises);

        results.forEach(res => {
            if (!res) return;

            const card = document.createElement('div');
            card.className = 'student-card';

            // 1. Assignment Data suchen (inkl. Fuzzy Search)
            let assignmentData = null;
            if (res.data && res.data.assignments) {
                if (res.data.assignments[assId]) {
                    assignmentData = res.data.assignments[assId];
                } else {
                    const foundKey = Object.keys(res.data.assignments).find(k => {
                        return decodeURIComponent(k).trim() === decodeURIComponent(assId).trim();
                    });
                    if (foundKey) assignmentData = res.data.assignments[foundKey];
                }
            }

            // 2. Statistiken
            let totalQuestions = 0;
            let answeredQuestions = 0;
            let totalWords = 0;
            
            if (assignmentData) {
                const subIds = Object.keys(assignmentData);
                subIds.forEach(subId => {
                    const subTask = assignmentData[subId];
                    if (subTask.questions) totalQuestions += subTask.questions.length;
                    
                    if (subTask.answers && subTask.answers.length > 0) {
                        subTask.answers.forEach(a => {
                            if (a.answer && a.answer.trim() !== '' && a.answer !== '<p><br></p>') {
                                answeredQuestions++;
                                const textOnly = a.answer.replace(/<[^>]*>/g, ' ').trim();
                                const words = textOnly.split(/\s+/).filter(w => w.length > 0);
                                totalWords += words.length;
                            }
                        });
                    }
                });
            }
            
            const progressPercent = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
            const progressColor = progressPercent >= 80 ? '#28a745' : progressPercent >= 50 ? '#ffc107' : '#dc3545';

            let lastUpdateStr = '-';
            let isRecent = false;
            if (res.data && res.data.createdAt) {
                const date = new Date(res.data.createdAt);
                lastUpdateStr = date.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});
                if (new Date() - date < 300000) isRecent = true;
            }

            // 3. Header
            const header = document.createElement('div');
            header.className = 'student-header';
            header.innerHTML = `
                <div class="header-left">
                    <span class="toggle-icon">▶</span>
                    <span class="student-name">${res.name}</span>
                </div>
                <div class="student-stats">
                    <span class="progress-badge" style="background-color: ${progressColor};" title="Fortschritt">
                        ${answeredQuestions}/${totalQuestions} ✓
                    </span>
                    <span class="word-count-badge" title="Wörter">
                        ${totalWords} 📝
                    </span>
                    <span class="last-update-badge ${isRecent ? 'recent' : ''}" title="Letztes Speichern">
                        🕒 ${lastUpdateStr}
                    </span>
                </div>
            `;
            
            header.addEventListener('click', () => {
                card.classList.toggle('open');
            });

            card.appendChild(header);
            
            // 4. Content (Fragen oben, Antworten unten)
            const cardContent = document.createElement('div');
            cardContent.className = 'student-card-content';

            if (assignmentData) {
                const subIds = Object.keys(assignmentData).sort();

                if (subIds.length === 0) {
                    cardContent.innerHTML = '<p style="color:orange; font-style:italic;">Keine Teilaufgaben gefunden.</p>';
                } else {
                    subIds.forEach(subId => {
                        const subTask = assignmentData[subId];
                        const displayTitle = subTask.title || subId;
                        
                        const subBlock = document.createElement('div');
                        subBlock.className = 'sub-assignment-block';
                        subBlock.innerHTML = `<div class="sub-title">${displayTitle}</div>`;

                        if (subTask.questions && subTask.questions.length > 0) {
                            const answerMap = new Map((subTask.answers || []).map(a => [a.questionId, a.answer]));

                            subTask.questions.forEach((q, idx) => {
                                const questionText = parseSimpleMarkdown(q.text);
                                const answer = answerMap.get(q.id);
                                const hasAnswer = answer && answer.trim() !== '' && answer !== '<p><br></p>';

                                subBlock.innerHTML += `<div class="question-text">${idx + 1}. ${questionText}</div>`;

                                if (hasAnswer) {
                                    subBlock.innerHTML += `<div class="read-only-answer ql-editor">${answer}</div>`;
                                } else {
                                    subBlock.innerHTML += `<div class="empty-answer-placeholder">(Keine Antwort)</div>`;
                                }
                            });
                        } else {
                            // Fallback
                            if (subTask.answers && subTask.answers.length > 0) {
                                subTask.answers.forEach(a => {
                                    subBlock.innerHTML += `<div class="read-only-answer ql-editor">${a.answer}</div>`;
                                });
                            } else {
                                subBlock.innerHTML += '<p style="font-size:0.8em; color:#aaa;">Leer.</p>';
                            }
                        }

                        cardContent.appendChild(subBlock);
                    });
                }
            } else if (res.error) {
                cardContent.innerHTML = '<p style="color:red;">Ladefehler.</p>';
            } else {
                cardContent.innerHTML = '<p style="color:#ccc; font-style:italic;">Noch nicht begonnen.</p>';
            }

            card.appendChild(cardContent);
            grid.appendChild(card);
        });

        contentRenderer.innerHTML = '';
        contentRenderer.appendChild(grid);
    };

    // --- 5. Download Funktion (Ganze Klasse) ---
    downloadBtn.addEventListener('click', async () => {
        const cls = classSelect.value;
        if (!cls) {
            alert("Bitte wähle zuerst eine Klasse aus.");
            return;
        }

        if (!window.showDirectoryPicker) {
            alert("Dein Browser unterstützt das Speichern von Ordnern nicht. Bitte nutze Chrome, Edge oder Opera.");
            return;
        }

        const students = draftsMap[cls];
        const studentNames = Object.keys(students);

        if (studentNames.length === 0) {
            alert("Keine Schüler in dieser Klasse gefunden.");
            return;
        }

        try {
            const dirHandle = await window.showDirectoryPicker();
            
            const originalText = downloadBtn.textContent;
            downloadBtn.disabled = true;
            downloadBtn.textContent = "Starte...";

            const classHandle = await dirHandle.getDirectoryHandle(cls, { create: true });

            let count = 0;
            const total = studentNames.length;

            for (const name of studentNames) {
                count++;
                downloadBtn.textContent = `Lade ${count}/${total}...`;

                const files = students[name];
                if (!files || files.length === 0) continue;

                const sortedFiles = [...files].sort((a, b) => b.name.localeCompare(a.name));
                const latestFile = sortedFiles[0];

                try {
                    const data = await fetchDraftContent(latestFile.path);
                    if (data) {
                        const studentHandle = await classHandle.getDirectoryHandle(name, { create: true });
                        const fileName = `${latestFile.name}.json`;
                        const fileHandle = await studentHandle.getFileHandle(fileName, { create: true });
                        const writable = await fileHandle.createWritable();
                        await writable.write(JSON.stringify(data, null, 2));
                        await writable.close();
                    }
                } catch (err) {
                    console.error(`Fehler bei Schüler ${name}:`, err);
                }
            }

            downloadBtn.textContent = "Fertig! ✅";
            setTimeout(() => {
                downloadBtn.textContent = originalText;
                downloadBtn.disabled = false;
            }, 3000);

        } catch (err) {
            console.error("Download abgebrochen:", err);
            downloadBtn.textContent = "Download";
            downloadBtn.disabled = false;
        }
    });

    // --- Helper: Fetch Single Draft ---
    const fetchDraftContent = async (path) => {
        try {
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'getDraft', teacherKey: currentTeacherKey, draftPath: path })
            });
            const data = await response.json();
            if (data.status === 'error') throw new Error(data.message);
            return data;
        } catch (error) {
            console.error(`Fehler bei ${path}:`, error);
            return null;
        }
    };

    // Start
    checkAuth();
});