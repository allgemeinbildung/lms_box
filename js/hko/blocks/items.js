//
//  js/hko/blocks/items.js — Block `items`: je Frage ein Quill-Feld, gespeichert als reiner Text (Vertrag §4, §6).
//
//  Aufbau wie text.js: Quill 1.3.6, toolbar false, formats [], guardEditor() aus js/pasteGuard.js
//  unverändert, `feld` der Paste-Meldung = frageId. value = { antworten: [{ frageId, text }] },
//  höchstens 12 Einträge, text höchstens 3 000 Zeichen.
//
//  collect() nimmt nur Fragen mit Text auf (in der Reihenfolge der Fragen): ein Block ohne Eingabe
//  ergibt { antworten: [] } und damit «leer» (keine leeren Erstdokumente), und die 12-Grenze der
//  Rules wird nur von Personen gerissen, die mehr als 12 Fragen wirklich beantworten.
//
import { guardEditor } from '../../pasteGuard.js';
import { showFieldMessage } from '../plainGuard.js';
import { el, escapeHtml } from '../util.js';

export const MAX_ANSWERS = 12;
export const MAX_CHARS = 3000;
let counter = 0;   // nur für eindeutige Element-Ids; kein Zustand eines Blocks

const fragenOf = (block) => (Array.isArray(block?.fragen) ? block.fragen : [])
    .filter((f) => f && typeof f.id === 'string' && f.id && typeof f.text === 'string');

/** frageId → text aus einem (möglicherweise älteren oder fremden) value. */
function antwortMap(value) {
    const map = new Map();
    const list = value && typeof value === 'object' && Array.isArray(value.antworten) ? value.antworten : [];
    for (const a of list) {
        if (a && typeof a === 'object' && typeof a.frageId === 'string' && typeof a.text === 'string' && !map.has(a.frageId)) {
            map.set(a.frageId, a.text);
        }
    }
    return map;
}

export function printHtml(value, block) {
    const antworten = antwortMap(value);
    const fragen = fragenOf(block);
    if (!fragen.length) return '<p class="hko-leer">Keine Fragen in diesem Auftrag.</p>';
    return fragen.map((f, i) => {
        const t = antworten.get(f.id) || '';
        const body = t.trim() ? `<div class="hko-print-text">${escapeHtml(t)}</div>` : '<p class="hko-leer">Nicht beantwortet.</p>';
        return `<div class="hko-print-frage"><p class="hko-print-fragetext"><strong>${i + 1}.</strong> ${escapeHtml(f.text)}</p>${body}</div>`;
    }).join('');
}

export function create() {
    let ctx = null;
    let initializing = true;
    let enabled = true;
    const felder = [];   // { id, editorDiv, labelId, quill }

    const textOf = (quill) => quill.getText().replace(/\n$/, '');

    return {
        render(b, c) {
            ctx = c;
            const base = ++counter;
            const wrap = el('div', 'hko-block hko-items');
            if (typeof b.auftrag === 'string' && b.auftrag) wrap.appendChild(el('p', 'hko-auftrag', b.auftrag));

            const fragen = fragenOf(b);
            if (!fragen.length) wrap.appendChild(el('p', 'hko-leer', 'Keine Fragen in diesem Auftrag.'));
            fragen.forEach((f, i) => {
                const item = el('div', 'hko-item');
                const label = el('p', 'hko-item-frage');
                label.id = `hko-items-${base}-q${i}`;
                label.appendChild(el('span', 'hko-item-nr', `${i + 1}.`));
                label.appendChild(document.createTextNode(' '));
                label.appendChild(el('span', 'hko-item-text', f.text));
                item.appendChild(label);
                const editorDiv = el('div', 'hko-editor hko-item-editor');
                editorDiv.id = `hko-items-${base}-e${i}`;
                item.appendChild(editorDiv);
                wrap.appendChild(item);
                felder.push({ id: f.id, editorDiv, labelId: label.id, quill: null });
            });
            c.container.appendChild(wrap);

            // Quill erst nach dem Einhängen aufbauen (wie text.js).
            for (const feld of felder) {
                const quill = new window.Quill(feld.editorDiv, {
                    theme: 'snow',
                    placeholder: 'Ihre Antwort …',
                    modules: { toolbar: false },
                    formats: [],
                });
                quill.root.setAttribute('aria-labelledby', feld.labelId);
                quill.root.setAttribute('role', 'textbox');
                quill.root.setAttribute('aria-multiline', 'true');
                feld.quill = quill;
                guardEditor(quill, {
                    isActive: () => !initializing && enabled && !c.readonly,
                    report: (event) => c.reportPaste(feld.id, event),
                    showMessage: (message) => showFieldMessage(quill.root, message),
                });
                quill.on('text-change', (delta, oldDelta, source) => {
                    if (initializing || source !== 'user' || !enabled || c.readonly) return;
                    c.changed();
                });
                if (c.readonly) quill.disable();
            }
            if (c.readonly) enabled = false;
            // Wie renderer.js: bis restore() durch ist, zählt nichts als Eingabe.
            setTimeout(() => { initializing = false; }, 0);
        },
        collect() {
            const antworten = [];
            for (const f of felder) {
                const t = textOf(f.quill);
                if (t.trim()) antworten.push({ frageId: f.id, text: t });
            }
            return { antworten };
        },
        restore(value) {
            const map = antwortMap(value);
            for (const f of felder) {
                f.quill.setText(map.get(f.id) || '', 'silent');
                f.quill.update('silent');
            }
        },
        validate() {
            const hinweise = [];
            let zuGross = false;
            let gefuellt = 0;
            for (const f of felder) {
                const t = textOf(f.quill);
                if (t.trim()) gefuellt += 1;
                if (t.length > MAX_CHARS) zuGross = true;
            }
            if (zuGross) hinweise.push(`Eine Ihrer Antworten ist länger als ${MAX_CHARS} Zeichen.`);
            if (gefuellt > MAX_ANSWERS) {
                zuGross = true;
                hinweise.push(`Es können höchstens ${MAX_ANSWERS} Antworten gespeichert werden.`);
            }
            return { ok: !zuGross, hinweise, zuGross };
        },
        setEnabled(on) {
            enabled = !!on && !ctx?.readonly;
            for (const f of felder) f.quill?.enable(enabled);
        },
        printHtml,
    };
}
