//
//  dashboard/hko/main.js — HKO teacher view (read only): class x unit -> grid person x block.
//
//  Login: dashboard/modules/auth.js, unchanged (role == "teacher"). Data: ./api.js only.
//  No evaluator, no release, no solutions (Phase P1).
//
import { initAuth } from '../modules/auth.js';
import { loadRoster, loadClasses, loadUnits, watchClassUnit } from './api.js';
import { visibleBlocks, renderGrid } from './grid.js';
import { renderDetail } from './detail.js';
import { buildCsv, shortStatus, answerText, pasteLine, str } from './csv.js';

const $ = (id) => document.getElementById(id);
const classSelect = $('class-select');
const unitSelect = $('unit-select');
const statusEl = $('status');
const infoEl = $('class-info');
const gridEl = $('grid');
const detailEl = $('detail');
const csvBtn = $('csv-btn');

let roster = new Map();    // classId -> [{uid, name}]
let classes = new Map();   // classId -> {variante, lehrjahr, aktiv}
let units = new Map();     // unitId -> unit
let watcher = null;
let selected = null;       // {uid, blockId}
let scheduled = false;

const setStatus = (text, isError = false) => {
    statusEl.textContent = text;
    statusEl.classList.toggle('error', isError);
};

const optionOf = (value, text) => {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = text;
    return o;
};

/** Variant of the class: from `classes` (hko), never from a document of a student. */
const varianteOf = (classId) => {
    const c = classes.get(classId);
    return c && typeof c.variante === 'string' && c.variante ? c.variante : null;
};

function classLabel(classId) {
    const c = classes.get(classId);
    if (!c) return `${classId} (nicht erfasst)`;
    return `${classId} · ${str(c.variante) || '?'} · LJ ${c.lehrjahr ?? '?'}${c.aktiv === false ? ' · inaktiv' : ''}`;
}

function fillSelects() {
    const classIds = [...roster.keys()].sort((a, b) => a.localeCompare(b, 'de'));
    classSelect.replaceChildren(optionOf('', 'Klasse wählen …'), ...classIds.map((id) => optionOf(id, classLabel(id))));
    const unitIds = [...units.keys()].sort((a, b) => a.localeCompare(b, 'de'));
    unitSelect.replaceChildren(optionOf('', 'Einheit wählen …'), ...unitIds.map((id) => optionOf(id, `${str(units.get(id).titel) || id} (${id})`)));
    classSelect.disabled = false;
    unitSelect.disabled = false;
}

function current() {
    const classId = classSelect.value;
    const unit = units.get(unitSelect.value);
    if (!classId || !unit || !roster.has(classId)) return null;
    const variante = varianteOf(classId);
    return { classId, unitId: unitSelect.value, unit, variante, people: roster.get(classId), blocks: visibleBlocks(unit, variante) };
}

function render() {
    scheduled = false;
    const cur = current();
    if (!cur) { gridEl.replaceChildren(); detailEl.replaceChildren(); csvBtn.disabled = true; return; }
    const answers = watcher ? watcher.answers() : new Map();
    const pastes = watcher ? watcher.pastes() : new Map();
    csvBtn.disabled = false;
    renderGrid(gridEl, { people: cur.people, blocks: cur.blocks, answers, pastes, variante: cur.variante, selected }, (sel) => {
        selected = sel;
        render();
    });
    const person = selected && cur.people.find((p) => p.uid === selected.uid);
    const entry = selected && cur.blocks.find((b) => b.id === selected.blockId);
    if (person && entry) {
        const key = `${person.uid}__${entry.id}`;
        renderDetail(detailEl, {
            person, classId: cur.classId, variante: cur.variante, unit: cur.unit, blockId: entry.id, block: entry.block,
            answer: answers.get(key) || null, pastes: pastes.get(key) || [],
        });
    } else {
        detailEl.replaceChildren();
    }
}
const scheduleRender = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(render); } };

function select() {
    watcher?.stop();
    watcher = null;
    selected = null;
    const cur = current();
    infoEl.textContent = '';
    if (!cur) { render(); setStatus(''); return; }
    infoEl.textContent = cur.variante
        ? `Variante der Klasse: ${cur.variante}. Spalten: ${cur.blocks.length} Blöcke.`
        : 'Klasse nicht erfasst: Die Variante ist unbekannt, es werden alle Blöcke ohne Mitnahme und Kompetenznachweis gezeigt.';
    setStatus('Lade Antworten …');
    let first = true;
    watcher = watchClassUnit({
        uids: cur.people.map((p) => p.uid),
        unitId: cur.unitId,
        onChange: () => { if (first) { first = false; setStatus(''); } scheduleRender(); },
        onError: () => setStatus('Die Antworten konnten nicht geladen werden (Berechtigung oder Verbindung).', true),
    });
    render();
}

/** One row per person x block: Name;Klasse;Variante;Block;Typ;Stand;Antwort;Paste-Hinweise */
function csvRows() {
    const cur = current();
    if (!cur) return [];
    const answers = watcher.answers();
    const pastes = watcher.pastes();
    const rows = [];
    for (const person of cur.people) {
        for (const { id, block } of cur.blocks) {
            const a = answers.get(`${person.uid}__${id}`) || null;
            const events = pastes.get(`${person.uid}__${id}`) || [];
            const docVar = a && cur.variante && str(a.variante) !== cur.variante ? ` (Dokument: ${str(a.variante) || '?'})` : '';
            rows.push([
                person.name, cur.classId, `${cur.variante || 'unbekannt'}${docVar}`,
                `${str(block.titel) || id} (${id})`, str(block.type), shortStatus(a, block),
                a ? answerText(block.type, a.value) : '', events.map(pasteLine).join(' | '),
            ]);
        }
    }
    return rows;
}

function downloadCsv() {
    const cur = current();
    if (!cur || !watcher) return;
    const blob = new Blob([buildCsv(csvRows())], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hko-${cur.classId}-${cur.unitId}.csv`.replace(/[^\w.-]+/g, '_');
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
}

async function load() {
    setStatus('Lade Klassen und Einheiten …');
    try {
        [roster, classes, units] = await Promise.all([loadRoster(), loadClasses(), loadUnits()]);
    } catch (error) {
        console.error('[hko] load:', error);
        setStatus('Klassen und Einheiten konnten nicht geladen werden.', true);
        return;
    }
    fillSelects();
    setStatus(units.size ? '' : 'Keine Einheiten in der Datenbank. Zuerst hochladen (hko-upload.mjs).');
}

classSelect.addEventListener('change', select);
unitSelect.addEventListener('change', select);
csvBtn.addEventListener('click', downloadCsv);

const checkAuth = initAuth(load);
checkAuth();
