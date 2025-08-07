//
// ────────────────────────────────────────────────────────────────
//   :::::: F I L E :   d a s h b o a r d / t e a c h e r . j s ::::::
// ────────────────────────────────────────────────────────────────
//
import { SCRIPT_URL } from '../js/config.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- Element References ---
    const loginOverlay = document.getElementById('login-overlay');
    const keyInput = document.getElementById('teacher-key-input');
    const loginBtn = document.getElementById('login-btn');
    const loginStatus = document.getElementById('login-status');
    
    const submissionListContainer = document.getElementById('submission-list-container');
    const submissionList = document.getElementById('submission-list');
    const classFilterContainer = document.getElementById('class-filter-container');
    const assignmentFilterSelect = document.getElementById('assignment-filter');
    const subAssignmentFilterSelect = document.getElementById('sub-assignment-filter');
    
    const viewerContent = document.getElementById('viewer-content');
    const viewerPlaceholder = document.getElementById('viewer-placeholder');

    // --- App State ---
    let masterFilterData = {};
    let masterSubmissionData = {};

    // --- API Helper ---
    const fetchApi = async (action, body) => {
        const teacherKey = sessionStorage.getItem('teacherKey');
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action, teacherKey, ...body })
        });
        if (!response.ok) throw new Error(`Network error: ${response.statusText}`);
        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);
        return data;
    };

    // --- Authentication ---
    const attemptLogin = async () => {
        const key = keyInput.value.trim();
        if (!key) {
            loginStatus.textContent = 'Bitte einen Schlüssel eingeben.';
            return;
        }
        loginStatus.textContent = 'Prüfe Schlüssel...';
        sessionStorage.setItem('teacherKey', key);
        await initializeDashboard();
    };
    loginBtn.addEventListener('click', attemptLogin);
    keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') attemptLogin(); });

    // --- Main Initialization ---
    const initializeDashboard = async () => {
        try {
            const [submissions, filterData] = await Promise.all([
                fetchApi('listSubmissions'),
                fetchApi('getFilterData')
            ]);
            
            masterSubmissionData = submissions;
            masterFilterData = filterData;
            
            loginOverlay.classList.remove('visible');
            loginStatus.textContent = '';
            
            populateClassFilter(Object.keys(masterSubmissionData));
            renderSubmissionsByFile(masterSubmissionData);
            setupFilterEventListeners();

        } catch (error) {
            handleError(error);
        }
    };
    
    // --- Filter Population & Event Handling ---
    function populateClassFilter(classes) {
        const classFilterSelect = document.createElement('select');
        classFilterSelect.id = 'class-filter';
        updateDropdown(classFilterSelect, ['Alle Klassen', ...classes.sort()]);
        classFilterContainer.innerHTML = '';
        classFilterContainer.appendChild(classFilterSelect);
        
        classFilterSelect.addEventListener('change', handleClassChange);
    }

    function setupFilterEventListeners() {
        assignmentFilterSelect.addEventListener('change', handleAssignmentChange);
        subAssignmentFilterSelect.addEventListener('change', handleSubAssignmentChange);
    }

    /**
     * ✅ UPDATED: This function no longer hides the file list. Instead, it filters it.
     */
    function handleClassChange(e) {
        const selectedClass = e.target.value;
        resetAssignmentFilters();
        
        if (selectedClass === 'Alle Klassen') {
            // If "All Classes" is selected, show the full file list
            renderSubmissionsByFile(masterSubmissionData);
        } else {
            // If a specific class is selected, filter the file list to show only that class
            const filteredSubmissions = { [selectedClass]: masterSubmissionData[selectedClass] };
            renderSubmissionsByFile(filteredSubmissions);
            
            // And enable the next filter level
            updateDropdown(assignmentFilterSelect, ['Aufgabe wählen', ...Object.keys(masterFilterData).sort()]);
            assignmentFilterSelect.disabled = false;
        }
    }
    
    async function handleAssignmentChange() {
        const selectedAssignment = assignmentFilterSelect.value;
        const className = document.getElementById('class-filter').value;
        
        resetAssignmentFilters(false);

        if (selectedAssignment !== 'Aufgabe wählen') {
            await fetchAndRenderFilteredAnswers(className, selectedAssignment);
            const subAssignments = masterFilterData[selectedAssignment] || [];
            updateDropdown(subAssignmentFilterSelect, ['Alle Teilaufgaben anzeigen', ...subAssignments]);
            subAssignmentFilterSelect.disabled = false;
        }
    }
    
    async function handleSubAssignmentChange() {
        const className = document.getElementById('class-filter').value;
        const assignmentName = assignmentFilterSelect.value;
        const subAssignmentName = subAssignmentFilterSelect.value;

        if (subAssignmentName === 'Alle Teilaufgaben anzeigen') {
            await fetchAndRenderFilteredAnswers(className, assignmentName);
        } else if (subAssignmentName !== 'Teilaufgabe wählen') {
            await fetchAndRenderFilteredAnswers(className, assignmentName, subAssignmentName);
        }
    }
    
    // --- Rendering Functions ---
    function renderSubmissionsByFile(submissionMap) {
        if (!submissionMap || Object.keys(submissionMap).length === 0) {
            submissionList.innerHTML = '<p>Für diese Auswahl keine Abgaben vorhanden.</p>';
            return;
        }
        let html = '';
        const sortedClasses = Object.keys(submissionMap).sort();
        for (const klasse of sortedClasses) {
            html += `<div class="class-group" data-class-name="${klasse}"><div class="class-name">${klasse}</div>`;
            const students = submissionMap[klasse];
            if (!students) continue;
            const sortedStudents = Object.keys(students).sort();
            for (const studentName of sortedStudents) {
                html += `<div class="student-group"><div class="student-name">${studentName}</div>`;
                students[studentName].forEach(file => {
                    let indicator = '', title = '';
                    if (file.changeData && file.changeData.similarityScore !== null) {
                        const score = file.changeData.similarityScore;
                        title = `Similarity: ${(score * 100).toFixed(0)}%`;
                        if (score < 0.3) indicator = '🚩';
                    } else {
                        title = 'First submission';
                    }
                    html += `<a class="submission-file" data-path="${file.path}"><span class="file-name">${file.name}</span><span class="change-indicator" title="${title}">${indicator}</span></a>`;
                });
                html += `</div>`;
            }
            html += `</div>`;
        }
        submissionList.innerHTML = html;
    }

    async function fetchAndRenderFilteredAnswers(className, assignmentName, subAssignmentName = null) {
        // ... this function remains unchanged ...
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = `<p>Lade Antworten für "${subAssignmentName || assignmentName}"...</p>`;
        try {
            const answers = await fetchApi('getFilteredAnswers', { className, assignmentName, subAssignmentName });
            
            if (answers.length > 0 && answers[0].subAssignments) {
                let fullHtml = `<h1>Alle Antworten für: "${assignmentName}"</h1><p class="subtitle">Klasse: ${className}</p>`;
                answers.forEach(item => {
                    let studentHtml = `<div class="assignment-block"><h2>${item.studentName}</h2>`;
                    if (item.subAssignments) {
                        for (const subTitle in item.subAssignments) {
                            const subData = item.subAssignments[subTitle];
                            studentHtml += `<div class="sub-answer-block">
                                              <h3>${subTitle}</h3>
                                              <div class="answer-box"><div class="ql-snow"><div class="ql-editor">${subData.answer}</div></div></div>
                                            </div>`;
                        }
                    } else {
                        studentHtml += `<p><i>Keine Antworten für diese Aufgabe gefunden.</i></p>`;
                    }
                    studentHtml += `</div>`;
                    fullHtml += studentHtml;
                });
                viewerContent.innerHTML = fullHtml;
            } 
            else {
                let fullHtml = `<h1>Antworten für: "${subAssignmentName}"</h1><p class="subtitle">Klasse: ${className} | Aufgabe: ${assignmentName}</p>`;
                if (answers.length === 0) fullHtml += '<p>Keine Antworten gefunden.</p>';
                answers.forEach(item => {
                    fullHtml += `<div class="assignment-block">
                                <h2>${item.studentName}</h2>
                                <div class="answer-box"><div class="ql-snow"><div class="ql-editor">${item.answer}</div></div></div>
                             </div>`;
                });
                viewerContent.innerHTML = fullHtml;
            }
        } catch (error) {
            handleError(error);
        }
    }
    
    async function fetchAndRenderSingleSubmission(path) {
        // ... this function remains unchanged ...
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = '<p>Lade Inhalt...</p>';
        try {
            const data = await fetchApi('getSubmission', { submissionPath: path });
            let contentHtml = `<h1>Abgabe vom ${new Date(data.createdAt).toLocaleString('de-CH')}</h1>`;
            for (const assignmentId in data.assignments) {
                for (const subId in data.assignments[assignmentId]) {
                    const subData = data.assignments[assignmentId][subId];
                    contentHtml += `<div class="assignment-block"><h2>${subData.title}</h2><div class="answer-box"><div class="ql-snow"><div class="ql-editor">${subData.answer}</div></div></div></div>`;
                }
            }
            viewerContent.innerHTML = contentHtml;
        } catch (error) {
            handleError(error);
        }
    }

    // --- Utility & Event Delegation ---
    function updateDropdown(selectElement, options) {
        selectElement.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    }

    function resetAssignmentFilters(resetSubAssignmentOnly = false) {
        if (!resetSubAssignmentOnly) {
            updateDropdown(assignmentFilterSelect, ['Zuerst Klasse wählen']);
            assignmentFilterSelect.disabled = true;
        }
        updateDropdown(subAssignmentFilterSelect, ['Zuerst Aufgabe wählen']);
        subAssignmentFilterSelect.disabled = true;
        viewerPlaceholder.style.display = 'block';
        viewerContent.innerHTML = '';
    }
    
    function handleError(error) {
        // ... this function remains unchanged ...
        console.error('Dashboard Error:', error);
        viewerContent.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
        if (error.message.includes('Invalid teacher key')) {
            sessionStorage.removeItem('teacherKey');
            loginStatus.textContent = "Schlüssel ungültig.";
            loginOverlay.classList.add('visible');
        }
    }

    submissionList.addEventListener('click', (e) => {
        // ... this function remains unchanged ...
        const fileLink = e.target.closest('.submission-file');
        if (fileLink) {
            const currentActive = submissionList.querySelector('.active');
            if (currentActive) currentActive.classList.remove('active');
            fileLink.classList.add('active');
            fetchAndRenderSingleSubmission(fileLink.dataset.path);
        }
        const classNameElement = e.target.closest('.class-name');
        if(classNameElement) {
            const studentGroups = classNameElement.parentElement.querySelectorAll('.student-group');
            studentGroups.forEach(group => group.style.display = group.style.display === 'none' ? 'block' : 'none');
        }
    });
    
    // --- Initial Check on Page Load ---
    if (sessionStorage.getItem('teacherKey')) {
        loginOverlay.classList.remove('visible');
        initializeDashboard();
    } else {
        loginOverlay.classList.add('visible');
    }
});