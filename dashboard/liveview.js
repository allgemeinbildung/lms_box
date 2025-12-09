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
    };

    // --- Aufgaben erkennen (Scan Logik) ---
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
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

        // Scan der ersten 5 Schüler
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

    // --- 4. Render Grid (Das Herzstück) ---

    // Wenn Aufgabe gewählt wird -> direkt rendern
    assignmentSelect.addEventListener('change', () => {
        renderLiveGrid();
    });

    // Refresh Button -> Reload
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

        // Container für das Grid
        const grid = document.createElement('div');
        grid.id = 'live-grid';

        // Daten parallel laden
        const promises = studentNames.map(async (name) => {
            const files = students[name];
            if (!files || files.length === 0) return null;
            // Neueste Datei
            const filePath = files[0].path; 

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

            // --- Header & Timestamp ---
            let lastUpdateStr = '-';
            let isRecent = false;
            if (res.data && res.data.createdAt) {
                const date = new Date(res.data.createdAt);
                lastUpdateStr = date.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});
                // Prüfen ob vor weniger als 5 Minuten (300000ms) geupdated wurde
                if (new Date() - date < 300000) isRecent = true;
            }

            const header = document.createElement('div');
            header.className = 'student-header';
            header.innerHTML = `
                <span class="student-name">${res.name}</span>
                <span class="last-update-badge ${isRecent ? 'recent' : ''}" title="Zuletzt gespeichert">
                    🕒 ${lastUpdateStr}
                </span>
            `;
            card.appendChild(header);
            
            const cardContent = document.createElement('div');
            cardContent.className = 'student-card-content';

            if (res.data && res.data.assignments && res.data.assignments[assId]) {
                const assignmentData = res.data.assignments[assId];
                // Hole alle Sub-IDs (Unteraufgaben) und sortiere sie
                const subIds = Object.keys(assignmentData).sort();

                if (subIds.length === 0) {
                    cardContent.innerHTML = '<p style="color:orange; font-style:italic;">Keine Teilaufgaben gefunden.</p>';
                } else {
                    // Loop durch alle Teilaufgaben
                    subIds.forEach(subId => {
                        const subTask = assignmentData[subId];
                        
                        const subBlock = document.createElement('div');
                        subBlock.className = 'sub-assignment-block';
                        
                        // Titel der Teilaufgabe (z.B. "01 Einleitung")
                        const displayTitle = subTask.title || subId;
                        subBlock.innerHTML = `<div class="sub-title">${displayTitle}</div>`;

                        // Antworten rendern
                        if (subTask.answers && subTask.answers.length > 0) {
                            subTask.answers.forEach(a => {
                                // Wir zeigen nur die Antwort. Die Frage wegzulassen spart Platz, 
                                // da der Kontext meist klar ist.
                                subBlock.innerHTML += `
                                    <div class="read-only-answer ql-editor">
                                        ${a.answer || '<span style="color:#ccc;">(Leer)</span>'}
                                    </div>
                                    <div style="margin-bottom: 5px;"></div>
                                `;
                            });
                        } else {
                            subBlock.innerHTML += '<p style="font-size:0.8em; color:#aaa;">Noch keine Antworten.</p>';
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

    // --- Helper ---
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

    checkAuth();
});