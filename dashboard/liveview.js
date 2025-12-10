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
    const downloadBtn = document.getElementById('download-btn'); 
    const contentRenderer = document.getElementById('live-content-renderer');
    
    // Header Controls
    const controlsBar = document.getElementById('controls-bar');
    const buttonGroup = controlsBar.querySelector('.button-group');
    
    const printAllBtn = document.createElement('button');
    printAllBtn.id = 'print-all-btn';
    printAllBtn.textContent = '🖨️ Klasse Drucken';
    printAllBtn.disabled = true;
    printAllBtn.style.cssText = "background-color: #6c757d; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer; font-weight: bold; height: 100%; margin-top: 18px; margin-left: 10px;";
    buttonGroup.appendChild(printAllBtn);

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

    // --- 2. Data Loading ---
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
        if (classes.includes(currentVal)) classSelect.value = currentVal;
        downloadBtn.disabled = !classSelect.value;
    };

    // --- Helper Functions ---
    const parseSimpleMarkdown = (text) => text ? text.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>') : '';
    
    // Scan Logic
    classSelect.addEventListener('change', async () => {
        const selectedClass = classSelect.value;
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
            } catch (e) { console.warn(`Scan error: ${name}`); }
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

    assignmentSelect.addEventListener('change', () => renderLiveGrid());
    refreshBtn.addEventListener('click', () => classSelect.value && assignmentSelect.value ? renderLiveGrid() : initDataLoad());

    // --- RENDER GRID ---
    const renderLiveGrid = async () => {
        const cls = classSelect.value;
        const assId = assignmentSelect.value;
        if (!cls || !assId) return;
        
        printAllBtn.disabled = false;
        printAllBtn.style.backgroundColor = "#17a2b8"; 

        contentRenderer.innerHTML = '<p style="text-align:center; margin-top:2em;">Lade Daten aller Schüler/innen...</p>';
        
        const students = draftsMap[cls];
        const studentNames = Object.keys(students).sort();
        const grid = document.createElement('div');
        grid.id = 'live-grid';

        const promises = studentNames.map(async (name) => {
            const files = students[name];
            if (!files || files.length === 0) return null;
            const sortedFiles = [...files].sort((a, b) => b.name.localeCompare(a.name));
            try {
                const data = await fetchDraftContent(sortedFiles[0].path);
                return { name, data };
            } catch (e) { return { name, error: true }; }
        });

        const results = await Promise.all(promises);

        results.forEach(res => {
            if (!res) return;

            const card = document.createElement('div');
            card.className = 'student-card';
            card.dataset.studentName = res.name;

            let assignmentData = null;
            if (res.data && res.data.assignments) {
                if (res.data.assignments[assId]) {
                    assignmentData = res.data.assignments[assId];
                } else {
                    const foundKey = Object.keys(res.data.assignments).find(k => decodeURIComponent(k).trim() === decodeURIComponent(assId).trim());
                    if (foundKey) assignmentData = res.data.assignments[foundKey];
                }
            }

            let totalQuestions = 0, answeredQuestions = 0, totalWords = 0;
            if (assignmentData) {
                Object.values(assignmentData).forEach(subTask => {
                    if (subTask.questions) totalQuestions += subTask.questions.length;
                    if (subTask.answers) subTask.answers.forEach(a => {
                        if (a.answer && a.answer.trim() !== '' && a.answer !== '<p><br></p>') {
                            answeredQuestions++;
                            totalWords += a.answer.replace(/<[^>]*>/g, ' ').trim().split(/\s+/).filter(w => w.length > 0).length;
                        }
                    });
                });
            }
            
            const progressPercent = totalQuestions > 0 ? Math.round((answeredQuestions / totalQuestions) * 100) : 0;
            const progressColor = progressPercent >= 80 ? '#28a745' : progressPercent >= 50 ? '#ffc107' : '#dc3545';
            
            let lastUpdateStr = '-';
            if (res.data && res.data.createdAt) {
                const date = new Date(res.data.createdAt);
                lastUpdateStr = date.toLocaleTimeString('de-DE', {hour: '2-digit', minute:'2-digit'});
            }

            const header = document.createElement('div');
            header.className = 'student-header';
            header.innerHTML = `
                <div class="header-left">
                    <span class="toggle-icon">▶</span>
                    <span class="student-name">${res.name}</span>
                </div>
                <div class="student-stats">
                    <span class="progress-badge" style="background:${progressColor}">${answeredQuestions}/${totalQuestions} ✓</span>
                    <span class="word-count-badge">${totalWords} 📝</span>
                    <span class="last-update-badge">🕒 ${lastUpdateStr}</span>
                    <button class="live-feedback-btn" style="margin-left:5px; padding:3px 8px; border-radius:4px; border:1px solid #ccc; background:#fff; cursor:pointer; font-size:0.8em; font-weight:bold; color:#555;">⚡ Feedback</button>
                </div>
            `;

            // --- INLINE FEEDBACK RENDERER ---
            const distributeFeedback = (feedbackData, container) => {
                // 1. Render Top Controls (Date + Print)
                const existingHeader = container.querySelector('.feedback-controls-header');
                if (existingHeader) existingHeader.remove();

                const dateStr = feedbackData.date_str || "Gerade eben";
                const controlsHeader = document.createElement('div');
                controlsHeader.className = 'feedback-controls-header';
                controlsHeader.style.cssText = "display:flex; justify-content:space-between; align-items:center; background:#f0f9ff; padding:10px; border-radius:6px; margin-bottom:15px; border:1px solid #bae6fd;";
                controlsHeader.innerHTML = `
                    <div style="font-size:0.9em; color:#0369a1;"><strong>⚡ KI-Status:</strong> <span style="color:#666;">${dateStr}</span></div>
                    <button class="print-single-btn" style="border:none; background:none; cursor:pointer; font-size:1.2em;" title="Feedback drucken">🖨️</button>
                `;
                
                // Print Button Logic
                controlsHeader.querySelector('.print-single-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPrintDialog((mode) => {
                        printFeedback(res.name, assId, feedbackData, mode);
                    });
                });

                container.prepend(controlsHeader);

                // 2. Clear old feedback slots
                container.querySelectorAll('.inline-feedback').forEach(el => {
                    el.innerHTML = ''; 
                    el.style.display = 'none';
                    delete el.dataset.feedbackJson;
                });

                // 3. Inject new feedback into slots
                if (feedbackData.results) {
                    feedbackData.results.forEach(item => {
                        // Find the matching QA container
                        const targetSlot = container.querySelector(`.inline-feedback[data-qid="${item.question_id}"]`);
                        
                        if (targetSlot) {
                            let color = '#ef4444'; 
                            if (item.score === 2) color = '#f59e0b'; 
                            if (item.score === 3) color = '#22c55e';

                            targetSlot.innerHTML = `
                                <div style="display:flex; align-items:center; gap:8px; margin-bottom:4px;">
                                    <span style="background:${color}; color:white; padding:1px 6px; border-radius:4px; font-size:0.8em; font-weight:bold;">Score: ${item.score}</span>
                                    <span style="color:#334155; font-weight:600; font-size:0.95em;">${item.concise_feedback}</span>
                                </div>
                                <div style="font-size:0.9em; color:#555; background:white; padding:8px; border-left:3px solid #e2e8f0; margin-top:5px;">
                                    ${item.detailed_feedback}
                                </div>
                            `;
                            
                            // Attach data for Bulk Print scraper
                            targetSlot.dataset.score = item.score;
                            targetSlot.dataset.concise = item.concise_feedback;
                            targetSlot.dataset.detailed = item.detailed_feedback;
                            targetSlot.dataset.qtext = item.question_text;
                            
                            targetSlot.style.display = 'block';
                        }
                    });
                }
            };

            header.addEventListener('click', (e) => {
                if (e.target.closest('button')) return; 
                card.classList.toggle('open');
            });

            const feedbackBtn = header.querySelector('.live-feedback-btn');
            feedbackBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                feedbackBtn.disabled = true;
                feedbackBtn.textContent = "Analysiere...";
                feedbackBtn.style.backgroundColor = "#fff3cd";

                try {
                    const response = await fetch('http://localhost:5000/assess', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            className: cls,
                            assignmentId: assId,
                            studentName: res.name,
                            studentData: res.data
                        })
                    });
                    const result = await response.json();
                    if (result.error) throw new Error(result.error);

                    const contentArea = card.querySelector('.student-card-content');
                    distributeFeedback(result, contentArea);
                    
                    if (!card.classList.contains('open')) card.classList.add('open');
                    feedbackBtn.textContent = "Fertig ✓";
                    feedbackBtn.style.backgroundColor = "#dcfce7";

                } catch (err) {
                    alert("Fehler: " + err.message);
                    feedbackBtn.textContent = "Fehler ❌";
                    feedbackBtn.style.backgroundColor = "#fee2e2";
                } finally {
                    setTimeout(() => {
                        feedbackBtn.disabled = false;
                        if(feedbackBtn.textContent.includes('Fertig') || feedbackBtn.textContent.includes('Fehler')) {
                            feedbackBtn.textContent = "⚡ Feedback";
                            feedbackBtn.style.backgroundColor = "#fff";
                        }
                    }, 3000);
                }
            });

            card.appendChild(header);

            const cardContent = document.createElement('div');
            cardContent.className = 'student-card-content';
            
            if (assignmentData) {
                const subIds = Object.keys(assignmentData).sort();
                if (subIds.length === 0) cardContent.innerHTML += '<p style="color:orange;">Keine Teilaufgaben.</p>';
                subIds.forEach(subId => {
                    const subTask = assignmentData[subId];
                    const subBlock = document.createElement('div');
                    subBlock.className = 'sub-assignment-block';
                    subBlock.innerHTML = `<div class="sub-title">${subTask.title || subId}</div>`;
                    
                    const answerMap = new Map((subTask.answers || []).map(a => [a.questionId, a.answer]));
                    
                    (subTask.questions || []).forEach((q, idx) => {
                        const ans = answerMap.get(q.id);
                        const qIdString = `${subId}_${q.id}`; // Matches Python Logic

                        // Wrapper for Q + Feedback + A
                        const qaWrapper = document.createElement('div');
                        qaWrapper.style.marginBottom = "20px";
                        
                        // 1. Question
                        qaWrapper.innerHTML += `<div class="question-text" style="font-weight:bold; color:#333; margin-bottom:5px;">${idx+1}. ${parseSimpleMarkdown(q.text)}</div>`;
                        
                        // 2. Feedback Slot (Between Q and A)
                        const feedbackSlot = document.createElement('div');
                        feedbackSlot.className = 'inline-feedback';
                        feedbackSlot.dataset.qid = qIdString; // Identity for matching
                        feedbackSlot.style.cssText = "display:none; background:#f0f9ff; border:1px solid #bae6fd; border-radius:6px; padding:10px; margin-bottom:10px;";
                        qaWrapper.appendChild(feedbackSlot);

                        // 3. Answer
                        const answerDiv = document.createElement('div');
                        if(ans) {
                            answerDiv.className = "read-only-answer ql-editor";
                            answerDiv.innerHTML = ans;
                        } else {
                            answerDiv.className = "empty-answer-placeholder";
                            answerDiv.textContent = "(Keine Antwort)";
                        }
                        qaWrapper.appendChild(answerDiv);

                        subBlock.appendChild(qaWrapper);
                    });
                    cardContent.appendChild(subBlock);
                });
            } else {
                cardContent.innerHTML += '<p style="color:#ccc;">Noch nicht begonnen.</p>';
            }

            card.appendChild(cardContent);
            grid.appendChild(card);

            // Auto-load existing feedback
            fetch('http://localhost:5000/get_feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ className: cls, assignmentId: assId, studentName: res.name })
            })
            .then(r => r.json())
            .then(data => {
                if (data.found && data.data) {
                    distributeFeedback(data.data, cardContent);
                }
            })
            .catch(e => console.log("Local server offline or no feedback"));
        });

        contentRenderer.innerHTML = '';
        contentRenderer.appendChild(grid);
    };

    // --- PRINT DIALOG ---
    const showPrintDialog = (onConfirm) => {
        const dialogOverlay = document.createElement('div');
        dialogOverlay.style.cssText = "position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; z-index:9999;";
        
        const dialogBox = document.createElement('div');
        dialogBox.style.cssText = "background:white; padding:25px; border-radius:8px; width:350px; text-align:center; box-shadow:0 4px 15px rgba(0,0,0,0.2); font-family: sans-serif;";
        dialogBox.innerHTML = `
            <h3 style="margin-top:0; color:#333;">Druckoptionen</h3>
            <p style="color:#666; margin-bottom:20px;">Welchen Detaillierungsgrad möchtest du drucken?</p>
            <div style="display:flex; flex-direction:column; gap:10px;">
                <button id="print-full" style="padding:12px; border:1px solid #007bff; background:#e9f3ff; color:#0056b3; border-radius:4px; cursor:pointer; font-weight:bold;">📄 Ausführlicher Bericht (Beides)</button>
                <button id="print-concise" style="padding:12px; border:1px solid #ccc; background:#fff; color:#333; border-radius:4px; cursor:pointer;">✂️ Kurzbericht (Nur 'Was fehlt')</button>
            </div>
            <button id="print-cancel" style="margin-top:20px; border:none; background:transparent; color:#888; cursor:pointer; text-decoration:underline;">Abbrechen</button>
        `;

        dialogOverlay.appendChild(dialogBox);
        document.body.appendChild(dialogOverlay);

        const close = () => dialogOverlay.remove();
        dialogBox.querySelector('#print-full').addEventListener('click', () => { close(); onConfirm('full'); });
        dialogBox.querySelector('#print-concise').addEventListener('click', () => { close(); onConfirm('concise'); });
        dialogBox.querySelector('#print-cancel').addEventListener('click', close);
        dialogOverlay.addEventListener('click', (e) => { if(e.target === dialogOverlay) close(); });
    };

    // --- UPDATED PRINTING FUNCTIONS ---

    const printFeedback = (studentName, assignmentName, feedbackData, mode) => {
        const printWindow = window.open('', '_blank');
        const html = generatePrintHTML([feedbackData], assignmentName, mode);
        printWindow.document.write(html);
        printWindow.document.close();
    };

    printAllBtn.addEventListener('click', () => {
        const cards = document.querySelectorAll('.student-card');
        const allFeedbacks = [];
        const assignmentName = assignmentSelect.value;

        cards.forEach(card => {
            // Find filled slots
            const slots = card.querySelectorAll('.inline-feedback[style*="block"]');
            if (slots.length > 0) {
                const studentName = card.querySelector('.student-name').textContent;
                const items = [];
                
                slots.forEach(slot => {
                    items.push({
                        question_id: slot.dataset.qid, // Required for grouping
                        question_text: slot.dataset.qtext,
                        score: parseInt(slot.dataset.score),
                        concise_feedback: slot.dataset.concise,
                        detailed_feedback: slot.dataset.detailed
                    });
                });
                
                // Get date from header
                const dateHeader = card.querySelector('.feedback-controls-header span');
                const dateStr = dateHeader ? dateHeader.textContent : '';

                allFeedbacks.push({
                    student_name: studentName,
                    date_str: dateStr,
                    results: items
                });
            }
        });

        if (allFeedbacks.length === 0) {
            alert("Es wurden keine Feedbacks gefunden. Bitte erst Feedbacks generieren.");
            return;
        }

        showPrintDialog((mode) => {
            const printWindow = window.open('', '_blank');
            const html = generatePrintHTML(allFeedbacks, assignmentName, mode);
            printWindow.document.write(html);
            printWindow.document.close();
        });
    });

    const generatePrintHTML = (feedbackList, assignmentName, mode) => {
        let bodyContent = '';
        const date = new Date().toLocaleDateString('de-DE');

        feedbackList.forEach(fb => {
            bodyContent += `
            <div class="page">
                <div class="header">
                    <h2>Feedback: ${assignmentName}</h2>
                    <p><strong>Schüler:in:</strong> ${fb.student_name} | <strong>Erstellt am:</strong> ${date}</p>
                </div>
                <hr>
                <div class="feedback-list">`;
            
            let lastSection = "";

            fb.results.forEach(item => {
                // Grouping Logic
                let currentSection = "";
                if (item.question_id) {
                    const parts = item.question_id.split('_');
                    if (parts.length > 0) currentSection = parts[0]; 
                }

                if (currentSection && currentSection !== lastSection) {
                    bodyContent += `<h3 class="section-header">${currentSection}</h3>`;
                    lastSection = currentSection;
                }

                let colorClass = 'score-low';
                if (item.score === 2) colorClass = 'score-mid';
                if (item.score === 3) colorClass = 'score-high';

                const formattedQuestion = parseSimpleMarkdown(item.question_text);

                bodyContent += `
                    <div class="item">
                        <div class="question">${formattedQuestion}</div>
                        <div class="concise"><span class="badge ${colorClass}">Score: ${item.score}</span> ${item.concise_feedback}</div>`;
                
                if (mode === 'full') {
                    bodyContent += `<div class="detailed">${item.detailed_feedback}</div>`;
                }

                bodyContent += `</div>`;
            });

            bodyContent += `</div></div>`;
        });

        return `
        <!DOCTYPE html>
        <html>
        <head>
            <title>Feedback Drucken</title>
            <style>
                body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #333; line-height: 1.5; }
                .page { page-break-after: always; padding: 40px; max-width: 800px; margin: 0 auto; }
                .header { margin-bottom: 20px; }
                .header h2 { margin-bottom: 5px; color: #0056b3; }
                
                .section-header { 
                    margin-top: 30px; 
                    margin-bottom: 15px; 
                    padding-bottom: 5px; 
                    border-bottom: 2px solid #0056b3; 
                    color: #0056b3; 
                    font-size: 1.2em; 
                }

                .item { margin-bottom: 25px; border-bottom: 1px solid #eee; padding-bottom: 15px; }
                .question { margin-bottom: 8px; color: #222; font-size: 1.05em; }
                .concise { margin-bottom: 8px; font-weight: 600; color: #444; }
                .detailed { font-size: 0.95em; color: #555; background: #f8f9fa; padding: 12px; border-left: 4px solid #ced4da; border-radius: 4px; margin-top: 8px; }
                .badge { color: white; padding: 3px 8px; border-radius: 4px; font-size: 0.85em; margin-right: 8px; vertical-align: middle; }
                .score-low { background-color: #ef4444; }
                .score-mid { background-color: #f59e0b; }
                .score-high { background-color: #22c55e; }
                
                b, strong { font-weight: 700; color: #000; }
                
                @media print { body { -webkit-print-color-adjust: exact; } }
            </style>
        </head>
        <body>${bodyContent}</body>
        </html>`;
    };

    // --- HELPER: Fetch Single Draft ---
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
        } catch (error) { return null; }
    };

    checkAuth();
});