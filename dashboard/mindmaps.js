//
//  dashboard/mindmaps.js — print view of the learners' unit mindmaps (teacher only).
//  Contract: backend/CONTRACT.md, «Mindmap print view». Reads, never writes.
//
import { initAuth } from './modules/auth.js';
import { loadClasses, getMindmapDraft } from './modules/api.js';
import { UNITS } from './modules/mindmapUnits.js';
import {
    MAPS_BASE, unitFromInput, noteOf, skeletonNames, cutSkeleton, parseNodes, fallbackSkeleton,
    buildTree, renderLearnerUnit, renderMissing,
} from './modules/mindmapPrint.js';

const $ = (id) => document.getElementById(id);
const classSelect = $('mm-class');
const topicSelect = $('mm-topic');
const unitsBox = $('mm-units');
const chosenBox = $('mm-chosen');
const freeInput = $('mm-free');
const loadBtn = $('mm-load');
const printBtn = $('mm-print');
const statusLine = $('mm-status');
const warningsList = $('mm-warnings');
const sheets = $('mm-sheets');

const params = new URLSearchParams(location.search);
const byName = (a, b) => a.localeCompare(b, 'de', { numeric: true, sensitivity: 'base' });
const PAGE_LIMIT = 2;          // the Lernkontrolle allows 2 A4 pages per learner

let classes = new Map();
const chosen = [];             // unit ids, in the order shown and printed

// ---- choosing units ---------------------------------------------------------------------

const folders = [...new Set(UNITS.map((u) => u.folder))];
for (const f of folders) topicSelect.append(new Option(f, f));

function sortChosen() {
    const pos = (u) => { const i = UNITS.findIndex((x) => x.unit === u); return i < 0 ? 1e6 : i; };
    chosen.sort((a, b) => pos(a) - pos(b) || byName(a, b));
}

function choose(unit, on) {
    const i = chosen.indexOf(unit);
    if (on && i < 0) chosen.push(unit);
    if (!on && i >= 0) chosen.splice(i, 1);
    sortChosen();
    renderUnits();
    renderChosen();
}

function renderUnits() {
    unitsBox.replaceChildren();
    for (const u of UNITS.filter((x) => x.folder === topicSelect.value)) {
        const label = document.createElement('label');
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = chosen.includes(u.unit);
        box.addEventListener('change', () => choose(u.unit, box.checked));
        label.append(box, ` ${u.note}`);
        unitsBox.append(label);
    }
}

function renderChosen() {
    chosenBox.replaceChildren();
    for (const unit of chosen) {
        const chip = document.createElement('span');
        chip.className = 'chip';
        chip.title = unit;
        const x = document.createElement('button');
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('aria-label', `${noteOf(unit)} entfernen`);
        x.addEventListener('click', () => choose(unit, false));
        chip.append(noteOf(unit), x);
        chosenBox.append(chip);
    }
    updateButtons();
}

function updateButtons() {
    loadBtn.disabled = !classSelect.value || chosen.length === 0;
}

topicSelect.addEventListener('change', renderUnits);
classSelect.addEventListener('change', updateButtons);
$('mm-free-add').addEventListener('click', () => {
    const unit = unitFromInput(freeInput.value);
    if (!unit) { statusLine.textContent = 'Diese Adresse ergibt keine Seite.'; return; }
    freeInput.value = '';
    choose(unit, true);
});

// Preselection from the address: ?klasse=…&einheit=…(&einheit=…)
for (const u of params.getAll('einheit')) { const unit = unitFromInput(u); if (unit) choose(unit, true); }
const firstChosen = UNITS.find((u) => chosen.includes(u.unit));
topicSelect.value = firstChosen ? firstChosen.folder : (folders.includes('08 Konsum und Wirtschaft') ? '08 Konsum und Wirtschaft' : folders[0]);
renderUnits();
renderChosen();

// ---- data -----------------------------------------------------------------------------

async function fetchSkeleton(unit) {
    for (const name of skeletonNames(unit)) {
        try {
            const res = await fetch(`${MAPS_BASE}${encodeURIComponent(name)}.json`, { cache: 'no-cache' });
            if (!res.ok) continue;
            const root = cutSkeleton((await res.json())?.root);
            if (root) return root;
        } catch { /* next one */ }
    }
    return null;
}

async function onTeacher() {
    try {
        classes = await loadClasses();
    } catch (error) {
        console.error(error);
        statusLine.textContent = `Klassenliste nicht lesbar: ${error.message || error}`;
        return;
    }
    classSelect.replaceChildren(new Option('-- Klasse wählen --', ''));
    for (const c of [...classes.keys()].sort(byName)) classSelect.append(new Option(c, c));
    classSelect.disabled = false;
    const wanted = params.get('klasse');
    if (wanted && classes.has(wanted)) classSelect.value = wanted;
    updateButtons();
}

async function run() {
    const classId = classSelect.value;
    const units = [...chosen];
    if (!classId || !units.length) return;
    loadBtn.disabled = true;
    printBtn.disabled = true;
    sheets.replaceChildren();
    warningsList.replaceChildren();
    statusLine.textContent = 'Lade …';

    const members = [...(classes.get(classId) || new Map())].map(([uid, name]) => ({ uid, name })).sort((a, b) => byName(a.name, b.name));
    let drafts;
    let skeletons;
    try {
        [skeletons, drafts] = await Promise.all([
            Promise.all(units.map(fetchSkeleton)),
            Promise.all(members.map((m) => Promise.all(units.map((u) => getMindmapDraft(m.uid, u))))),
        ]);
    } catch (error) {
        console.error(error);
        statusLine.textContent = error.code === 'permission-denied'
            ? 'Kein Lesezugriff auf die Mindmaps. Sind die Regeln vom 30.10.2026 deployt (firestore:lmsbox)?'
            : `Fehler beim Laden: ${error.message || error}`;
        updateButtons();
        return;
    }

    // Without a map file: a skeleton from what the learners hung on.
    const datas = drafts.map((row) => row.map((d) => (d ? parseNodes(d.nodes) : null)));
    skeletons = skeletons.map((s, j) => s || fallbackSkeleton(units[j], datas.map((row) => row[j])));

    const multi = units.length > 1;
    const missing = [];
    const empty = [];
    const tooLong = [];
    let sheetCount = 0;
    let withMap = 0;
    members.forEach((m, i) => {
        let pages = 0;
        let any = false;
        units.forEach((unit, j) => {
            const label = multi ? `${m.name} – ${noteOf(unit)}` : m.name;
            if (!drafts[i][j]) { missing.push(label); return; }
            const { tree, own } = buildTree(skeletons[j], datas[i][j]);
            if (own === 0) { empty.push(label); return; }
            any = true;
            pages += renderLearnerUnit(sheets, {
                name: m.name, classId, unitTitle: noteOf(unit), updatedAt: drafts[i][j].updatedAt, tree,
            });
        });
        if (any) withMap++;
        sheetCount += pages;
        if (pages > PAGE_LIMIT) tooLong.push(`${m.name}: ${pages} Seiten`);
    });
    renderMissing(sheets, { classId, unitTitles: units.map(noteOf), missing, empty });

    document.title = `${classId}_Mindmaps_${units.map((u) => noteOf(u).split(' ')[0]).join('_')}`;
    statusLine.textContent = `${classId}: ${withMap} von ${members.length} Lernenden mit Mindmap · ${sheetCount} Seite(n) Mindmaps`
        + ` + 1 Seite Liste · ohne Mindmap: ${missing.length} · ohne eigene Äste: ${empty.length}.`;
    for (const w of tooLong) {
        const li = document.createElement('li');
        li.textContent = `Mehr als ${PAGE_LIMIT} A4-Seiten: ${w}`;
        warningsList.append(li);
    }
    for (const s of sheets.querySelectorAll('.sheet.overflow')) {
        const li = document.createElement('li');
        li.textContent = `Passt auch auf zwei Seiten nicht ganz: ${s.querySelector('.who')?.textContent || ''} (${s.querySelector('.unit')?.textContent || ''})`;
        warningsList.append(li);
    }
    printBtn.disabled = false;
    updateButtons();
}

loadBtn.addEventListener('click', run);
printBtn.addEventListener('click', () => window.print());

initAuth(onTeacher)();
