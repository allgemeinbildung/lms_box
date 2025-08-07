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
    let masterFilterData = {}; // Stores the { assignment: [subA, subB] } hierarchy
    let masterSubmissionData = {}; // Stores the { class: { student: [files] } } hierarchy

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
            renderSubmissionsByFile(masterSubmissionData); // Render initial file list
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

    function handleClassChange(e) {
        const selectedClass = e.target.value;
        resetAssignmentFilters();
        
        if (selectedClass === 'Alle Klassen') {
            submissionListContainer.style.display = 'block';
            viewerPlaceholder.style.display = 'block';
            viewerContent.innerHTML = '';
            renderSubmissionsByFile(masterSubmissionData);
        } else {
            submissionListContainer.style.display = 'none'; // Hide file view
            const filteredSubmissions = { [selectedClass]: masterSubmissionData[selectedClass] };
            renderSubmissionsByFile(filteredSubmissions); // Show only selected class files in background
            assignmentFilterSelect.disabled = false;
            updateDropdown(assignmentFilterSelect, ['Aufgabe wählen', ...Object.keys(masterFilterData).sort()]);
        }
    }
    
    function handleAssignmentChange() {
        const selectedAssignment = assignmentFilterSelect.value;
        resetAssignmentFilters(false);
        if (selectedAssignment !== 'Aufgabe wählen') {
            const subAssignments = masterFilterData[selectedAssignment] || [];
            updateDropdown(subAssignmentFilterSelect, ['Teilaufgabe wählen', ...subAssignments]);
            subAssignmentFilterSelect.disabled = false;
        }
    }

    // ✅ UPDATED: Now triggers a fetch for the whole assignment
    async function handleAssignmentChange() {
        const selectedAssignment = assignmentFilterSelect.value;
        const className = document.getElementById('class-filter').value;
        resetAssignmentFilters(false);

        if (selectedAssignment !== 'Aufgabe wählen') {
            // Fetch all answers for this assignment
            await fetchAndRenderFilteredAnswers(className, selectedAssignment);
            
            // Populate the next dropdown
            const subAssignments = masterFilterData[selectedAssignment] || [];
            updateDropdown(subAssignmentFilterSelect, ['Teilaufgabe wählen (Alle angezeigt)', ...subAssignments]);
            subAssignmentFilterSelect.disabled = false;
        }
    }
    
    // --- Rendering Functions ---
    function renderSubmissionsByFile(submissionMap) {
        // This is your previous rendering function, slightly adapted
        if (Object.keys(submissionMap).length === 0) {
            submissionList.innerHTML = '<p>Noch keine Abgaben vorhanden.</p>';
            return;
        }
        let html = '';
        const sortedClasses = Object.keys(submissionMap).sort();
        for (const klasse of sortedClasses) {
            html += `<div class="class-group" data-class-name="${klasse}"><div class="class-name">${klasse}</div>`;
            const students = submissionMap[klasse];
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

    // ✅ UPDATED: Can now render two different data structures
    const fetchAndRenderFilteredAnswers = async (className, assignmentName, subAssignmentName = null) => {
        viewerPlaceholder.style.display = 'none';
        viewerContent.innerHTML = `<p>Lade Antworten für "${subAssignmentName || assignmentName}"...</p>`;
        try {
            const answers = await fetchApi('getFilteredAnswers', { className, assignmentName, subAssignmentName });
            
            // --- RENDER MULTIPLE SUB-ASSIGNMENTS (ASSIGNMENT-LEVEL VIEW) ---
            if (answers[0] && answers[0].subAssignments) {
                viewerContent.innerHTML = `<h1>Alle Antworten für: "${assignmentName}"</h1><p class="subtitle">Klasse: ${className}</p>`;
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
                    viewerContent.innerHTML += studentHtml;
                });
            } 
            // --- RENDER A SINGLE SUB-ASSIGNMENT (SUB-ASSIGNMENT-LEVEL VIEW) ---
            else {
                viewerContent.innerHTML = `<h1>Antworten für: "${subAssignmentName}"</h1><p class="subtitle">Klasse: ${className} | Aufgabe: ${assignmentName}</p>`;
                if (answers.length === 0) viewerContent.innerHTML += '<p>Keine Antworten gefunden.</p>';
                answers.forEach(item => {
                    viewerContent.innerHTML += `<div class="assignment-block">
                                <h2>${item.studentName}</h2>
                                <div class="answer-box"><div class="ql-snow"><div class="ql-editor">${item.answer}</div></div></div>
                             </div>`;
                });
            }
        } catch (error) {
            handleError(error);
        }
    };
    
    async function fetchAndRenderSingleSubmission(path) {
        // This is your previous function for viewing a single file
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
    function updateDropdown(selectElement, options, firstOptionText = '') {
        selectElement.innerHTML = options.map(opt => `<option value="${opt}">${opt}</option>`).join('');
    }

    function resetAssignmentFilters(resetBoth = true) {
        if (resetBoth) {
            updateDropdown(assignmentFilterSelect, ['Zuerst Klasse wählen']);
            assignmentFilterSelect.disabled = true;
        }
        updateDropdown(subAssignmentFilterSelect, ['Zuerst Aufgabe wählen']);
        subAssignmentFilterSelect.disabled = true;
        viewerPlaceholder.style.display = 'block';
        viewerContent.innerHTML = '';
    }
    
    function handleError(error) {
        console.error('Dashboard Error:', error);
        viewerContent.innerHTML = `<p style="color: red;">Fehler: ${error.message}</p>`;
        if (error.message.includes('Invalid teacher key')) {
            sessionStorage.removeItem('teacherKey');
            loginStatus.textContent = "Schlüssel ungültig.";
            loginOverlay.classList.add('visible');
        }
    }

    submissionList.addEventListener('click', (e) => {
        const fileLink = e.target.closest('.submission-file');
        if (fileLink) {
            const currentActive = submissionList.querySelector('.active');
            if (currentActive) currentActive.classList.remove('active');
            fileLink.classList.add('active');
            fetchAndRenderSingleSubmission(fileLink.dataset.path);
        }
        if(e.target.classList.contains('class-name')) {
            const studentGroups = e.target.parentElement.querySelectorAll('.student-group');
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