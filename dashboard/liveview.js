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
    const subSelect = document.getElementById('sub-select');
    const refreshBtn = document.getElementById('refresh-btn');
    const contentRenderer = document.getElementById('live-content-renderer');

    // State
    let draftsMap = {}; // Struktur: { "KLASSE": { "SCHÜLER": { name: "...", path: "..." } } }
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
            // Wir holen die LISTE der Entwürfe (genau wie im Teacher Dashboard)
            const response = await fetch(SCRIPT_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'listDrafts', teacherKey: currentTeacherKey })
            });
            const data = await response.json();
            
            if (data.status === 'error') throw new Error(data.message);
            
            // Normalisiere Daten (Groß/Kleinschreibung bei Klassen)
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
        
        // Aktuelle Auswahl merken
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

    // Wenn Klasse gewählt wird, müssen wir eigentlich wissen, welche Aufgaben existieren.
    // Da `listDrafts` nur Dateinamen/Pfade liefert, aber nicht den INHALT (und damit die Assignment IDs),
    // müssen wir hier einen Trick anwenden oder Annahmen treffen.
    // BESSERE LÖSUNG: Wir laden EIN Draft eines Schülers dieser Klasse, um die Assignment-Struktur zu lesen,
    // oder wir hardcoden die IDs, wenn sie bekannt sind.
    // HIER: Wir scannen die Dateinamen (oft "assignmentId.json") oder wir laden den ersten verfügbaren Schüler,
    // um die Struktur zu parsen.
    
    // --- UPDATE: Bessere Erkennung von Aufgaben ---
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
        assignmentSelect.innerHTML = '<option value="">Lade Aufgaben...</option>';
        assignmentSelect.disabled = true;
        subSelect.innerHTML = '<option value="">-</option>';
        subSelect.disabled = true;
        contentRenderer.innerHTML = '';

        if (!selectedClass) return;

        const students = draftsMap[selectedClass];
        const studentNames = Object.keys(students);
        
        if (studentNames.length === 0) {
            assignmentSelect.innerHTML = '<option value="">Keine Schüler gefunden</option>';
            return;
        }

        // TRICK: Wir scannen nun die ersten 3 aktiven Schüler (statt nur einen),
        // um eine vollständigere Liste der Aufgaben zu bekommen.
        const studentsToScan = studentNames.slice(0, 3); 
        const foundAssignments = new Set(); // Set verhindert Doppelte
        
        // Parallel die ersten paar Schüler laden, um Struktur zu finden
        const scanPromises = studentsToScan.map(async (name) => {
            const files = students[name];
            if (!Array.isArray(files) || files.length === 0) return;
            
            // Wir schauen in die neueste Datei
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

        // Dropdown befüllen
        assignmentSelect.innerHTML = '<option value="">-- Aufgabe wählen --</option>';
        if (foundAssignments.size === 0) {
            assignmentSelect.innerHTML += '<option value="" disabled>Keine Aufgaben in den gescannten Entwürfen gefunden.</option>';
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

    subSelect.addEventListener('change', () => {
        renderLiveGrid();
    });

    refreshBtn.addEventListener('click', () => {
        // Wenn bereits alles ausgewählt ist, refreshe nur den Grid-Inhalt
        if (classSelect.value && assignmentSelect.value && subSelect.value) {
            renderLiveGrid();
        } else {
            initDataLoad(); // Full reload
        }
    });

    const renderLiveGrid = async () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;
        const subId = subSelect.value;

        if (!cls || !assId || !subId) return;

        contentRenderer.innerHTML = '<p>Lade Antworten aller Schüler/innen...</p>';
        
        const students = draftsMap[cls];
        const studentNames = Object.keys(students).sort();

        // Container für das Grid
        const grid = document.createElement('div');
        grid.id = 'live-grid';

        // Lade alle parallel
        const promises = studentNames.map(async (name) => {
            const files = students[name];
            // Nimm die neueste Datei (Draft)
            if (!files || files.length === 0) return null;
            
            // Sortiere falls nötig, meistens ist Index 0 aber okay oder wir nehmen das, was da ist.
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

            const header = document.createElement('div');
            header.className = 'student-name-header';
            header.innerHTML = `<span>${res.name}</span>`;
            
            let contentHtml = '<p style="color:#ccc; font-style:italic;">Keine Daten für diese Aufgabe.</p>';

            if (res.data && res.data.assignments && res.data.assignments[assId] && res.data.assignments[assId][subId]) {
                const subData = res.data.assignments[assId][subId];
                const lastUpdate = res.data.createdAt ? new Date(res.data.createdAt).toLocaleTimeString() : '';
                header.innerHTML += `<span class="last-update">🕒 ${lastUpdate}</span>`;

                if (subData.answers && subData.answers.length > 0) {
                    contentHtml = '';
                    // Zeige alle Antworten für diese Sub-Aufgabe untereinander
                    subData.answers.forEach(a => {
                        contentHtml += `<div class="ql-editor" style="background:#f9f9f9; border:1px solid #eee; margin-top:5px; padding:10px; max-height:200px; overflow-y:auto;">${a.answer || '...'}</div>`;
                    });
                } else {
                    contentHtml = '<p style="color:orange;">Aufgabe begonnen, aber leer.</p>';
                }
            } else if (res.error) {
                contentHtml = '<p style="color:red;">Fehler beim Laden.</p>';
            }

            card.appendChild(header);
            card.innerHTML += contentHtml;
            grid.appendChild(card);
        });

        contentRenderer.innerHTML = '';
        contentRenderer.appendChild(grid);
    };

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