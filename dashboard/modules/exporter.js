import { state } from './state.js';
import { getMasterAssignment, getFeedback, fetchDraftContent } from './api.js';

export const setupAnalysisExport = (exportBtn, getSelections) => {
    exportBtn.addEventListener('click', async () => {
        const { cls, assId } = getSelections();
        if (!cls || !assId) return;

        const originalText = exportBtn.textContent;
        exportBtn.textContent = "Lade Daten...";
        exportBtn.disabled = true;

        // 1. Get Master Questions
        let questionsMap = [];
        try {
            const masterAss = await getMasterAssignment(assId);
            if (masterAss && masterAss.subAssignments) {
                Object.keys(masterAss.subAssignments).sort().forEach(subTitle => {
                    const sub = masterAss.subAssignments[subTitle];
                    sub.questions.forEach((q, idx) => {
                        questionsMap.push({
                            id: `${subTitle}_${q.id}`,
                            label: `Q${questionsMap.length + 1} (${q.id})`
                        });
                    });
                });
            }
        } catch (e) { console.error("Export: Master fetch failed", e); }

        // 2. CSV Header
        const headerRow = ["Name", "Bewertungs-Datum", "Summe Punkte", "Durchschnitt"];
        questionsMap.forEach(q => headerRow.push(`${q.label} Punkte`));

        const csvRows = [headerRow.join(";")];

        // 3. Loop Students
        const students = state.draftsMap[cls];
        const studentNames = Object.keys(students).sort();

        for (const name of studentNames) {
            let row = [name, "-", "0", "0"];
            let feedbackScores = {};

            try {
                const fbData = await getFeedback(cls, assId, name);

                if (fbData && fbData.found && fbData.data) {
                    const latest = fbData.data.history ? fbData.data.history[fbData.data.history.length - 1] : fbData.data;
                    row[1] = latest.date_str || "-";

                    let totalScore = 0;
                    let count = 0;

                    if (latest.results) {
                        latest.results.forEach(r => {
                            feedbackScores[r.question_id] = r.score;
                            totalScore += (r.score || 0);
                            count++;
                        });
                    }
                    row[2] = totalScore;
                    row[3] = count > 0 ? (totalScore / count).toFixed(2).replace('.', ',') : "0";
                }
            } catch (e) { /* no feedback found */ }

            // Fill columns
            questionsMap.forEach(q => {
                const s = feedbackScores[q.id];
                row.push(s !== undefined ? s : "-");
            });

            csvRows.push(row.join(";"));
        }

        // 4. Download
        downloadCsv(csvRows.join("\n"), `Analyse_${cls}_${assId}.csv`);

        exportBtn.textContent = originalText;
        exportBtn.disabled = false;
    });
};

export const setupRawDownload = (downloadBtn, getSelections) => {
    downloadBtn.addEventListener('click', async () => {
        const { cls, assId } = getSelections();
        if (!cls || !assId) return;

        downloadBtn.textContent = "Generiere...";
        downloadBtn.disabled = true;

        // Get Master Total
        let maxPoints = 0;
        try {
            const masterAss = await getMasterAssignment(assId);
            if (masterAss && masterAss.subAssignments) {
                Object.values(masterAss.subAssignments).forEach(subTask => {
                    if (subTask.questions) maxPoints += subTask.questions.length;
                });
            }
        } catch (e) { }

        const students = state.draftsMap[cls];
        const studentNames = Object.keys(students).sort();
        const csvRows = [];
        csvRows.push("Anmeldename;Vorname;Nachname;Punkte;Max.");

        for (const name of studentNames) {
            const nameParts = name.trim().split(/\s+/);
            let vorname = "";
            let nachname = name;
            if (nameParts.length > 1) {
                nachname = nameParts.pop();
                vorname = nameParts.join(" ");
            } else {
                vorname = name;
                nachname = "";
            }
            const cleanVorname = vorname.toLowerCase().replace(/\s+/g, '.');
            const cleanNachname = nachname.toLowerCase().replace(/\s+/g, '.');
            const anmeldename = `${cleanVorname}.${cleanNachname}`;

            const files = students[name];
            let targetFile = null;
            if (files && files.length > 0) {
                const sortedFiles = [...files].sort((a, b) => b.name.localeCompare(a.name));
                targetFile = sortedFiles.find(f => f.name.replace(/\.json$/i, '').trim() === assId.trim());
                if (!targetFile) targetFile = sortedFiles.find(f => f.name.includes(assId));
                if (!targetFile) targetFile = sortedFiles[0];
            }

            let points = 0;
            let currentMax = maxPoints;

            if (targetFile) {
                try {
                    const data = await fetchDraftContent(targetFile.path);
                    let assignmentData = null;
                    if (data && data.assignments) {
                        if (data.assignments[assId]) {
                            assignmentData = data.assignments[assId];
                        } else {
                            const foundKey = Object.keys(data.assignments).find(k =>
                                decodeURIComponent(k).trim() === decodeURIComponent(assId).trim()
                            );
                            if (foundKey) assignmentData = data.assignments[foundKey];
                        }
                    }
                    if (assignmentData) {
                        let studentParamCount = 0;
                        Object.values(assignmentData).forEach(subTask => {
                            if (subTask.questions) studentParamCount += subTask.questions.length;
                            if (subTask.answers) {
                                subTask.answers.forEach(a => {
                                    if (a.answer && a.answer.trim() !== '' && a.answer !== '<p><br></p>') {
                                        points++;
                                    }
                                });
                            }
                        });
                        if (currentMax === 0) currentMax = studentParamCount;
                    }
                } catch (e) { /* ignore */ }
            }
            csvRows.push(`${anmeldename};${vorname};${nachname};${points};${currentMax}`);
        }

        downloadCsv(csvRows.join("\n"), `${cls}_${assId.replace(/[^a-z0-9]/gi, '_')}.csv`);

        downloadBtn.textContent = "📥 Download";
        downloadBtn.disabled = false;
    });
};

const downloadCsv = (content, filename) => {
    const bom = "\uFEFF";
    const csvString = bom + content;
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};
