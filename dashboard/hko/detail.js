//
//  dashboard/hko/detail.js — detail of one answer, by type (Vertrag §4). textContent only.
//  Answers are plain text; a value of an odd shape shows as empty, never as markup.
//
import { str, isObj, itemAnswers, stufenOf, rowCells, formatTime, pasteLine, wordCount } from './csv.js';
import { varianteNote } from './grid.js';

const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
};
const textBox = (text) => el('div', 'hko-text', text);   // CSS: white-space: pre-wrap
const orDash = (text) => (text.trim() ? textBox(text) : el('p', 'hko-empty', '–'));

/**
 * d = { person: {uid, name}, classId, variante (computed or null), unit, blockId, block,
 *       answer|null, pastes: [] }
 */
export function renderDetail(container, d) {
    const { person, block, blockId, answer, pastes, unit, variante } = d;
    const root = el('div', 'hko-detail-inner');
    root.append(el('h2', null, `${person.name} — ${str(block.titel) || blockId}`));
    root.append(el('p', 'hko-meta', `Klasse ${d.classId}, Variante ${variante || 'unbekannt'}, Typ ${str(block.type)}`));

    if (!answer) {
        root.append(el('p', 'hko-empty', 'Noch keine Antwort.'));
    } else {
        const note = varianteNote(answer, variante);
        if (note) root.append(el('p', 'hko-warn', `${note} (berechnet aus der Klasse: ${variante}). Das Dokument stammt aus dem Browser der Person und beweist nichts.`));
        const info = [`Zuletzt gespeichert: ${formatTime(answer.updatedAt) || 'unbekannt'}`, `Status: ${str(answer.status) || '?'}`];
        if (answer.unitVersion !== unit.version) info.push(`Einheit Version ${answer.unitVersion} (aktuell ${unit.version})`);
        if (answer.type !== block.type) info.push(`Typ im Dokument: ${str(answer.type) || '?'}`);
        root.append(el('p', 'hko-meta', info.join(' · ')));
        root.append(renderValue(answer, block, unit));
    }

    const events = Array.isArray(pastes) ? pastes : [];
    root.append(el('h3', null, `Paste-Hinweise (${events.length})`));
    if (!events.length) root.append(el('p', 'hko-empty', 'Keine.'));
    else {
        const ul = el('ul', 'hko-paste-list');
        for (const e of events) ul.append(el('li', null, `${formatTime(e.at) || '?'} — ${pasteLine(e)}`));
        root.append(ul);
    }
    container.replaceChildren(root);
}

function renderValue(answer, block, unit) {
    const value = isObj(answer.value) ? answer.value : {};
    const box = el('div', 'hko-value');
    const type = block.type;
    if (type === 'text') {
        const t = str(value.text);
        box.append(textBox(t), el('p', 'hko-meta', `${wordCount(t)} Wörter, ${t.length} Zeichen`));
    } else if (type === 'items') {
        const fragen = (Array.isArray(block.fragen) ? block.fragen : []).filter(isObj);
        const known = new Set(fragen.map((f) => str(f.id)));
        const given = new Map(itemAnswers(value).map((a) => [a.frageId, a.text]));
        for (const f of fragen) {
            box.append(el('h4', 'hko-frage', str(f.text) || str(f.id)), orDash(given.get(str(f.id)) || ''));
        }
        for (const [id, text] of given) {
            if (known.has(id)) continue;
            box.append(el('h4', 'hko-frage', `Frage ${id} (nicht in der Einheit)`), textBox(text));
        }
    } else if (type === 'raster') {
        const rows = Array.isArray(value.zeilen) ? value.zeilen : [];
        const spalten = Array.isArray(block.spalten) ? block.spalten.map(str) : [];
        const width = Math.max(spalten.length, ...rows.map((r) => rowCells(r).length), 0);
        const table = el('table', 'hko-raster');
        const thead = el('thead');
        const tr0 = el('tr');
        for (let i = 0; i < width; i++) tr0.append(el('th', null, spalten[i] ?? `Spalte ${i + 1}`));
        thead.append(tr0);
        table.append(thead);
        const body = el('tbody');
        for (const row of rows) {
            const cells = rowCells(row);
            const tr = el('tr');
            for (let i = 0; i < width; i++) tr.append(el('td', null, cells[i] ?? ''));
            body.append(tr);
        }
        table.append(body);
        box.append(table);
        if (block.befund === true || str(value.befund)) box.append(el('h4', 'hko-frage', 'Befund'), orDash(str(value.befund)));
    } else if (type === 'selbst') {
        const stufen = new Map(stufenOf(value));
        const krit = isObj(unit.kriterien) ? unit.kriterien : {};
        const ul = el('ul', 'hko-stufen');
        for (const id of Array.isArray(block.kriterien) ? block.kriterien : []) {
            const k = isObj(krit[id]) ? krit[id] : {};
            const n = stufen.get(id);
            const text = n === undefined ? 'nicht eingeschätzt' : `Stufe ${n}: ${isObj(k.stufen) ? str(k.stufen[n]) : ''}`;
            ul.append(el('li', null, `${str(k.name) || id} — ${text}`));
        }
        box.append(ul, el('h4', 'hko-frage', 'Begründung'), orDash(str(value.begruendung)),
            el('h4', 'hko-frage', 'Das verbessere ich'), orDash(str(value.verbessere)));
    } else {
        box.append(el('p', 'hko-empty', 'Dieser Auftragstyp wird in der Lehrpersonen-Ansicht noch nicht angezeigt.'));
    }
    return box;
}
