//
//  dashboard/hko/grid.js — grid person x block. Every value goes in via textContent.
//
import { shortStatus, formatTime, str } from './csv.js';

/**
 * The columns: blocks in the order of `unit.reihenfolge` that belong to the variant of the class.
 * Never a column: `mitnahme` (shows own answers, collects none) and `kn: true` (the KN happens
 * outside the box in P1). With an unknown variant (class not recorded) no variant filter applies.
 */
export function visibleBlocks(unit, variante) {
    const order = Array.isArray(unit?.reihenfolge) ? unit.reihenfolge : [];
    const blocks = unit?.blocks && typeof unit.blocks === 'object' ? unit.blocks : {};
    const out = [];
    for (const id of order) {
        const block = blocks[id];
        if (!block || typeof block !== 'object') continue;
        if (block.type === 'mitnahme' || block.kn === true) continue;
        if (variante && block.nur_variante && block.nur_variante !== variante) continue;
        out.push({ id, block });
    }
    return out;
}

const el = (tag, className, text) => {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined) e.textContent = text;
    return e;
};

/** Marking text when the variant in the document differs from the one computed from the class. */
export const varianteNote = (answer, variante) =>
    (answer && variante && str(answer.variante) !== variante ? `Variante im Dokument: ${str(answer.variante) || '?'}` : '');

/**
 * model = { people: [{uid, name}], blocks: [{id, block}], answers: Map, pastes: Map, variante,
 *           selected: {uid, blockId}|null }
 */
export function renderGrid(container, model, onSelect) {
    const { people, blocks, answers, pastes, variante, selected } = model;
    if (!people.length) { container.replaceChildren(el('p', 'hko-empty', 'Diese Klasse hat keine Personen in der Klassenliste.')); return; }
    if (!blocks.length) { container.replaceChildren(el('p', 'hko-empty', 'Diese Einheit hat keine Blöcke für diese Variante.')); return; }

    const table = el('table', 'hko-grid');
    const thead = el('thead');
    const head = el('tr');
    head.append(el('th', 'hko-name-h', 'Person'));
    for (const { id, block } of blocks) {
        const th = el('th', 'hko-block-h');
        th.dataset.blockId = id;
        th.title = id;
        th.append(el('span', 'hko-block-title', str(block.titel) || id), el('span', 'hko-block-type', str(block.type)));
        head.append(th);
    }
    thead.append(head);
    table.append(thead);

    const body = el('tbody');
    for (const person of people) {
        const tr = el('tr');
        tr.dataset.uid = person.uid;
        const name = el('th', 'hko-name', person.name);
        name.scope = 'row';
        tr.append(name);
        for (const { id, block } of blocks) {
            const key = `${person.uid}__${id}`;
            const answer = answers.get(key) || null;
            const events = pastes.get(key) || [];
            const td = el('td', 'hko-cell');
            td.dataset.blockId = id;
            const btn = el('button', 'hko-cell-btn');
            btn.type = 'button';
            btn.dataset.uid = person.uid;
            btn.dataset.blockId = id;
            if (!answer) btn.classList.add('empty');
            if (selected && selected.uid === person.uid && selected.blockId === id) btn.classList.add('selected');
            btn.append(el('span', 'hko-stand', shortStatus(answer, block)));
            if (answer) {
                const when = formatTime(answer.updatedAt);
                if (when) btn.append(el('span', 'hko-when', when));
            }
            if (events.length) {
                const p = el('span', 'hko-paste', `⧉ ${events.length}`);
                p.title = `${events.length} Einfüge-Hinweis${events.length === 1 ? '' : 'e'}`;
                btn.append(p);
            }
            const note = varianteNote(answer, variante);
            if (note) {
                const v = el('span', 'hko-variante-flag', note);
                v.title = note;
                btn.append(v);
            }
            btn.addEventListener('click', () => onSelect({ uid: person.uid, blockId: id }));
            td.append(btn);
            tr.append(td);
        }
        body.append(tr);
    }
    table.append(body);
    container.replaceChildren(table);
}
