//
//  dashboard/modules/overview.js — class tiles and the class matrix of the Live View.
//
//  Rows = students, columns = assignments (chapters). Each cell comes from the drafts the
//  class listener already holds (api.js: getClassOverviewData) — no extra reads. The formativ
//  Rückmeldungen come from one query per 30 students (getClassFormativ) and are optional:
//  without them (rules, network, older data) the matrix works on drafts alone.
//
//  Everything from Firestore (names, assignment ids, titles, question texts) goes into the DOM as
//  text (textContent / title), never as HTML. Answer text is only measured here, not shown.
//
//  Drill-down: a column header or a cell selects the assignment in the existing
//  #assignment-select, so the detail view (renderer.js) runs unchanged; a cell also opens the
//  student's card.
//
import { state } from './state.js';
import { getClassOverviewData, getClassFormativ } from './api.js';
import { criterionMarks, emptyCounts, MARKS, MARK_ORDER } from '../../js/formativ-trail.js';

/** A question counts as answered at this many characters of plain text (js/progress.js, «bearbeitet» rule). */
export const MIN_CHARS = 15;

const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
};

const byNumber = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

/** Length of the trimmed plain text of a Quill answer. The parsed document is inert: nothing runs, nothing loads. */
export function plainLength(html) {
    const raw = String(html ?? '');
    if (!raw.includes('<')) return raw.trim().length;
    try {
        return (new DOMParser().parseFromString(raw, 'text/html').body.textContent || '').trim().length;
    } catch { return raw.replace(/<[^>]*>/g, ' ').trim().length; }
}

// ---- computation (pure) ---------------------------------------------------------------------

/**
 * Progress of one student in one assignment.
 * → { state: 'none' | 'started' | 'done', answered, total, started, lastUpdate }
 * `total` is the number of questions the published assignment has; if its shape is unknown, the
 * number of answers the student has.
 */
export function cellProgress(drafts, shape) {
    const lengths = new Map();   // "subId::questionId" -> chars
    let last = 0;
    for (const d of drafts) {
        last = Math.max(last, d.updatedAt?.toMillis?.() || 0);
        for (const a of Array.isArray(d.answers) ? d.answers : []) {
            const key = `${d.subId}::${a?.questionId}`;
            lengths.set(key, Math.max(lengths.get(key) || 0, plainLength(a?.answer)));
        }
    }
    const keys = shape ? shape.subs.flatMap((s) => s.questions.map((q) => `${s.subId}::${q.id}`)) : [...lengths.keys()];
    let answered = 0;
    let started = 0;
    for (const k of keys) {
        const n = lengths.get(k) || 0;
        if (n > 0) started += 1;
        if (n >= MIN_CHARS) answered += 1;
    }
    const total = keys.length;
    const st = total > 0 && answered === total ? 'done' : started > 0 ? 'started' : 'none';
    return { state: st, answered, total, started, lastUpdate: last };
}

/** The attempts of one stored slot, oldest first (`frueher[]` + the latest, flat). */
const attemptsOfSlot = (slot) => [...(slot.frueher || []), slot].filter((a) => a?.result && a.result.zustand !== 'nicht_verfuegbar');

/**
 * Rückmeldungen of one student in one assignment.
 * → { offered, questions: [{ key, label, attempts, marks: [{mark}] }], attempts, counts, improved }
 * `offered`: the assignment has questions with formativ. Older data (one attempt, flat) works as it is.
 */
export function cellFormativ(slots, shape) {
    const offered = !!shape && shape.subs.some((s) => s.questions.some((q) => q.formativ));
    const textOf = new Map();
    for (const s of shape?.subs || []) for (const q of s.questions) textOf.set(`${s.subId}::${q.id}`, q.text);
    const questions = [];
    const counts = emptyCounts();
    let attempts = 0;
    for (const [key, slot] of Object.entries(slots || {})) {
        const list = attemptsOfSlot(slot);
        if (!list.length) continue;
        const marks = criterionMarks(list);
        for (const m of marks) counts[m.mark] += 1;
        attempts += list.length;
        questions.push({ key, label: textOf.get(key) || key.split('::')[1] || key, attempts: list.length, marks });
    }
    return { offered, questions, attempts, counts, improved: counts.verbessert + counts.besser };
}

/** Everything the matrix shows, from the class data (and the formativ map, when there is one). */
export function buildMatrix(data, formativ) {
    const byStudent = new Map();   // uid -> Map(assignmentId -> drafts[])
    const used = new Set();
    for (const d of data.drafts) {
        if (!byStudent.has(d.uid)) byStudent.set(d.uid, new Map());
        const per = byStudent.get(d.uid);
        if (!per.has(d.assignmentId)) per.set(d.assignmentId, []);
        per.get(d.assignmentId).push(d);
        used.add(d.assignmentId);
    }
    const assignments = [...used].sort(byNumber).map((id) => ({ id, shape: data.shapes.get(id) || null }));
    const rows = [...data.members].sort((a, b) => a.name.localeCompare(b.name, 'de')).map((m) => {
        const cells = assignments.map((a) => {
            const drafts = byStudent.get(m.uid)?.get(a.id) || [];
            return {
                progress: cellProgress(drafts, a.shape),
                formativ: formativ ? cellFormativ(formativ.get(m.uid)?.get(a.id), a.shape) : null,
            };
        });
        return {
            uid: m.uid, name: m.name, cells,
            done: cells.filter((c) => c.progress.state === 'done').length,
            attempts: cells.reduce((n, c) => n + (c.formativ?.attempts || 0), 0),
            improved: cells.reduce((n, c) => n + (c.formativ?.improved || 0), 0),
        };
    });
    return { assignments, rows };
}

// ---- view ---------------------------------------------------------------------------------------

const PROGRESS_TEXT = { none: 'nichts', started: 'angefangen', done: 'alle Fragen beantwortet' };
const PROGRESS_GLYPH = { none: '–', started: '◔', done: '✓' };
const timeOf = (d) => d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function markSummary(counts) {
    const row = el('span', 'ov-marks');
    for (const key of MARK_ORDER) {
        if (!counts[key]) continue;
        const m = MARKS[key];
        const s = el('span', `ov-mark ov-mark-${m.cls}`, `${m.icon}${m.up ? '↑' : ''}${counts[key]}`);
        s.title = `${counts[key]} × ${m.text}`;
        row.appendChild(s);
    }
    return row;
}

function progressCell(c) {
    const p = c.progress;
    const b = el('button', `ov-cell ov-${p.state}`);
    b.type = 'button';
    b.appendChild(el('span', 'ov-glyph', PROGRESS_GLYPH[p.state]));
    if (p.total) b.appendChild(el('span', 'ov-frac', `${p.answered}/${p.total}`));
    return b;
}

function formativCell(c) {
    const f = c.formativ;
    const b = el('button', `ov-cell ${f && f.attempts ? 'ov-fb' : 'ov-fb-none'}`);
    b.type = 'button';
    if (!f || !f.offered) { b.classList.add('ov-na'); b.appendChild(el('span', 'ov-glyph', '·')); return b; }
    if (!f.attempts) { b.appendChild(el('span', 'ov-glyph', '–')); return b; }
    b.appendChild(el('span', 'ov-frac', `💬 ${f.attempts}`));
    b.appendChild(markSummary(f.counts));
    return b;
}

function cellTitle(row, a, c, mode) {
    const lines = [`${row.name} · ${a.id}`];
    const p = c.progress;
    lines.push(`${PROGRESS_TEXT[p.state]}${p.total ? ` (${p.answered} von ${p.total} Fragen mit mindestens ${MIN_CHARS} Zeichen)` : ''}`);
    if (p.lastUpdate) lines.push(`zuletzt geändert ${timeOf(new Date(p.lastUpdate))}`);
    const f = c.formativ;
    if (mode === 'rueckmeldungen' || (f && f.attempts)) {
        if (!f) lines.push('Rückmeldungen: (noch) nicht geladen');
        else if (!f.offered) lines.push('Rückmeldungen: in diesem Kapitel nicht angeboten');
        else if (!f.attempts) lines.push('Rückmeldungen: keine geholt');
        else {
            lines.push(`Rückmeldungen: ${f.attempts} bei ${f.questions.length} Frage(n)`);
            for (const q of f.questions) {
                const spur = q.marks.map((m) => MARKS[m.mark].text).join(', ');
                lines.push(`  ${q.label.slice(0, 50)}: ${q.attempts}×${spur ? ` — ${spur}` : ''}`);
            }
        }
    }
    lines.push('Klicken: Antworten dieser Person ansehen');
    return lines.join('\n');
}

export function renderMatrix(host, matrix, { mode, formativStatus, onColumn, onCell }) {
    host.replaceChildren();
    if (!matrix.assignments.length) {
        host.appendChild(el('p', 'ov-empty', 'In dieser Klasse gibt es noch keine Antworten.'));
        return;
    }
    const fb = mode === 'rueckmeldungen';
    const table = el('table', 'ov-table');
    const head = el('tr');
    head.appendChild(el('th', 'ov-corner', 'Lernende'));
    for (const a of matrix.assignments) {
        const th = el('th', 'ov-colhead');
        const b = el('button', 'ov-colbtn', a.id);
        b.type = 'button';
        b.title = `${a.shape?.title ? `${a.shape.title}\n` : ''}Kapitel öffnen: alle Antworten der Klasse`;
        b.addEventListener('click', () => onColumn(a.id));
        th.appendChild(b);
        head.appendChild(th);
    }
    head.appendChild(el('th', 'ov-sum', fb ? 'Rückmeldungen' : 'Fertig'));
    table.appendChild(el('thead')).appendChild(head);

    const body = el('tbody');
    for (const row of matrix.rows) {
        const tr = el('tr');
        tr.appendChild(el('th', 'ov-name', row.name));
        matrix.assignments.forEach((a, i) => {
            const c = row.cells[i];
            const td = el('td');
            const b = fb ? formativCell(c) : progressCell(c);
            b.title = cellTitle(row, a, c, mode);
            b.addEventListener('click', () => onCell(a.id, row.name));
            td.appendChild(b);
            tr.appendChild(td);
        });
        const sum = el('td', 'ov-sumcell');
        if (fb) {
            sum.textContent = formativStatus === 'ok' ? `💬 ${row.attempts}${row.improved ? `  ↑${row.improved}` : ''}` : '';
            if (row.improved) sum.title = `${row.improved} Kriterien nach der Rückmeldung verbessert`;
        } else {
            sum.textContent = `${row.done}/${matrix.assignments.length}`;
        }
        tr.appendChild(sum);
        body.appendChild(tr);
    }
    // Foot: per chapter, how many have finished / started, or how many Rückmeldungen were fetched.
    const foot = el('tr', 'ov-foot');
    foot.appendChild(el('th', 'ov-name', 'Klasse'));
    matrix.assignments.forEach((a, i) => {
        const cells = matrix.rows.map((r) => r.cells[i]);
        const td = el('td');
        if (fb) {
            const n = cells.reduce((s, c) => s + (c.formativ?.attempts || 0), 0);
            const people = cells.filter((c) => c.formativ?.attempts).length;
            td.textContent = formativStatus === 'ok' && n ? `💬 ${n} (${people} Pers.)` : '';
        } else {
            const done = cells.filter((c) => c.progress.state === 'done').length;
            const started = cells.filter((c) => c.progress.state === 'started').length;
            td.textContent = `${done} fertig · ${started} angefangen`;
        }
        foot.appendChild(td);
    });
    foot.appendChild(el('td'));
    body.appendChild(foot);
    table.appendChild(body);
    host.appendChild(table);
}

// ---- wiring ---------------------------------------------------------------------------------------

export function initOverview({ classSelect, assignmentSelect, contentRenderer, refreshBtn }) {
    const tiles = document.getElementById('class-tiles');
    const matrixHost = document.getElementById('overview-matrix');
    const overviewEl = document.getElementById('overview');
    const detailBar = document.getElementById('detail-bar');
    const backBtn = document.getElementById('back-to-overview');
    const detailTitle = document.getElementById('detail-title');
    const modeButtons = Array.from(document.querySelectorAll('[data-ov-mode]'));
    const note = document.getElementById('ov-note');
    const legend = document.getElementById('ov-legend');

    let mode = 'fortschritt';
    let formativ = null;                 // Map(uid -> Map(assignmentId -> slots)) of the shown class
    let formativStatus = 'none';         // none | loading | ok | error
    let formativClass = null;
    let timer = null;

    const setNote = () => {
        if (!note) return;
        note.hidden = mode !== 'rueckmeldungen';
        note.textContent = formativStatus === 'loading' ? 'Rückmeldungen werden geladen …'
            : formativStatus === 'error' ? 'Rückmeldungen konnten nicht geladen werden.'
            : formativStatus === 'ok' ? `Rückmeldungen Stand ${timeOf(new Date()).slice(-5)}` : '';
    };

    const showOverview = () => {
        overviewEl.hidden = false;
        detailBar.hidden = true;
        contentRenderer.hidden = true;
        render();
    };
    const showDetail = (assId) => {
        overviewEl.hidden = true;
        detailBar.hidden = false;
        contentRenderer.hidden = false;
        detailTitle.textContent = `${classSelect.value} · ${assId}`;
    };

    function render() {
        if (overviewEl.hidden) return;
        const cls = classSelect.value;
        if (!cls) {
            matrixHost.replaceChildren(el('p', 'ov-empty', 'Klasse wählen: Dann sehen Sie, wer in welchem Kapitel schon etwas geschrieben hat.'));
            return;
        }
        const data = getClassOverviewData(cls);
        if (!data) { matrixHost.replaceChildren(el('p', 'ov-empty', 'Lade Klasse …')); return; }
        renderMatrix(matrixHost, buildMatrix(data, formativClass === cls ? formativ : null), {
            mode, formativStatus: formativClass === cls ? formativStatus : 'none',
            onColumn: (assId) => open(assId, null),
            onCell: (assId, name) => open(assId, name),
        });
    }

    /** Opens the detail view of a chapter, and the card of one student when `name` is given. */
    function open(assId, name) {
        if (![...assignmentSelect.options].some((o) => o.value === assId)) return;
        assignmentSelect.value = assId;
        assignmentSelect.dispatchEvent(new Event('change'));
        if (!name) return;
        let tries = 0;
        const find = () => {
            const card = Array.from(document.querySelectorAll('.student-card')).find((c) => c.dataset.studentName === name);
            if (card) { card.classList.add('open'); card.scrollIntoView({ block: 'start' }); return; }
            if (++tries < 60 && assignmentSelect.value === assId) setTimeout(find, 250);
        };
        find();
    }

    async function loadFormativ(cls) {
        formativClass = cls;
        formativ = null;
        formativStatus = 'loading';
        setNote();
        try {
            const result = await getClassFormativ(cls);
            if (classSelect.value !== cls) return;
            formativ = result;
            formativStatus = 'ok';
        } catch (error) {
            console.warn('[overview] formativ:', error);
            if (classSelect.value !== cls) return;
            formativStatus = 'error';
        }
        setNote();
        render();
    }

    function setMode(next) {
        mode = next;
        modeButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.ovMode === mode)));
        setNote();
        if (legend) {
            legend.textContent = mode === 'rueckmeldungen'
                ? '💬 geholte Rückmeldungen · ●↑ verbessert · ● direkt erfüllt · ◐↑ teilweise verbessert · ○ offen · – keine geholt · · nicht angeboten'
                : `✓ alle Fragen beantwortet · ◔ angefangen · – nichts · eine Frage zählt ab ${MIN_CHARS} Zeichen`;
        }
        render();
    }
    modeButtons.forEach((b) => b.addEventListener('click', () => setMode(b.dataset.ovMode)));

    backBtn.addEventListener('click', () => {
        assignmentSelect.value = '';
        assignmentSelect.dispatchEvent(new Event('change'));
    });
    assignmentSelect.addEventListener('change', () => {
        if (assignmentSelect.value) showDetail(assignmentSelect.value);
        else showOverview();
    });
    // «Aktualisieren» in the overview: fetch the Rückmeldungen again (drafts are live anyway).
    refreshBtn.addEventListener('click', () => {
        if (!overviewEl.hidden && classSelect.value && !assignmentSelect.value) loadFormativ(classSelect.value);
    });

    const selectClass = (cls) => {
        if (classSelect.value === cls && !overviewEl.hidden) return;
        classSelect.value = cls;
        classSelect.dispatchEvent(new Event('change'));
        formativ = null; formativClass = null; formativStatus = 'none'; setNote();
        showOverview();
        renderTiles();
    };

    function renderTiles() {
        const classes = Object.keys(state.draftsMap).sort(byNumber);
        tiles.replaceChildren();
        if (!classes.length) { tiles.appendChild(el('span', 'ov-empty', 'Keine Klassen gefunden.')); return; }
        for (const c of classes) {
            const n = Object.keys(state.draftsMap[c] || {}).length;
            const b = el('button', 'class-tile');
            b.type = 'button';
            b.dataset.classId = c;
            b.setAttribute('aria-pressed', String(classSelect.value === c));
            b.appendChild(el('span', 'class-tile-name', c));
            b.appendChild(el('span', 'class-tile-count', `${n} Lernende`));
            b.addEventListener('click', () => selectClass(c));
            tiles.appendChild(b);
        }
    }

    setMode('fortschritt');
    showOverview();

    return {
        /** The class list changed (login, «Aktualisieren»). With one class only, it is chosen at once. */
        classesLoaded() {
            const classes = Object.keys(state.draftsMap);
            renderTiles();
            if (classes.length === 1 && !classSelect.value) selectClass(classes[0]);
        },
        /** The listener of the chosen class delivered its first result. */
        classReady() {
            renderTiles();
            if (!assignmentSelect.value) showOverview();
            const cls = classSelect.value;
            if (cls && (formativClass !== cls || formativStatus === 'none')) loadFormativ(cls);
        },
        /** Drafts changed (live). */
        draftsChanged() {
            clearTimeout(timer);
            timer = setTimeout(render, 300);
        },
    };
}
