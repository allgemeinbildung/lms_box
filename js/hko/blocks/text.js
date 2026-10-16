//
//  js/hko/blocks/text.js — Block `text`: ein Quill-Feld, gespeichert als reiner Text (Vertrag §4, §6).
//
//  Referenz-Block für die anderen Typen (Interface: js/hko/registry.js).
//  Quill 1.3.6 wie js/renderer.js: toolbar false, formats [], dazu guardEditor() aus
//  js/pasteGuard.js unverändert. genre, konventionen, min_woerter, max_woerter sind nur
//  Hinweise und blockieren nichts. value = { text }, höchstens 20 000 Zeichen.
//
import { guardEditor } from '../../pasteGuard.js';
import { showFieldMessage } from '../plainGuard.js';
import { el, escapeHtml, countWords } from '../util.js';

export const MAX_CHARS = 20000;
let counter = 0;   // nur für eindeutige Element-Ids; kein Zustand eines Blocks

const textOf = (value) => (value && typeof value === 'object' && typeof value.text === 'string' ? value.text : '');
const num = (v) => (Number.isInteger(v) && v > 0 ? v : null);

function umfangText(block) {
    const min = num(block?.min_woerter);
    const max = num(block?.max_woerter);
    if (min && max) return `${min}–${max} Wörter`;
    if (min) return `mindestens ${min} Wörter`;
    if (max) return `höchstens ${max} Wörter`;
    return '';
}

export function printHtml(value, block) {
    const t = textOf(value);
    if (!t.trim()) return '<p class="hko-leer">Noch nichts geschrieben.</p>';
    const words = countWords(t);
    return `<div class="hko-print-text">${escapeHtml(t)}</div><p class="hko-print-meta">${words} Wörter${umfangText(block) ? ` (Vorgabe: ${escapeHtml(umfangText(block))})` : ''}</p>`;
}

export function create() {
    let quill = null;
    let ctx = null;
    let block = null;
    let countEl = null;
    let initializing = true;
    let enabled = true;

    const currentText = () => (quill ? quill.getText().replace(/\n$/, '') : '');

    function updateCount() {
        if (!countEl) return;
        const words = countWords(currentText());
        const min = num(block?.min_woerter);
        const max = num(block?.max_woerter);
        countEl.textContent = `${words} ${words === 1 ? 'Wort' : 'Wörter'}${umfangText(block) ? ` · Vorgabe: ${umfangText(block)}` : ''}`;
        countEl.dataset.words = String(words);
        countEl.dataset.lage = min && words < min ? 'unter' : max && words > max ? 'ueber' : 'ok';
    }

    return {
        render(b, c) {
            block = b;
            ctx = c;
            const wrap = el('div', 'hko-block hko-text');
            if (typeof b.auftrag === 'string' && b.auftrag) wrap.appendChild(el('p', 'hko-auftrag', b.auftrag));

            const hinweise = el('div', 'hko-vorgaben');
            if (typeof b.genre === 'string' && b.genre) hinweise.appendChild(el('p', 'hko-genre', `Textsorte: ${b.genre}`));
            const konv = Array.isArray(b.konventionen) ? b.konventionen.filter((k) => typeof k === 'string' && k) : [];
            if (konv.length) {
                hinweise.appendChild(el('p', 'hko-vorgaben-titel', 'Darauf achten Sie:'));
                const ul = el('ul', 'hko-konventionen');
                for (const k of konv) ul.appendChild(el('li', '', k));
                hinweise.appendChild(ul);
            }
            if (hinweise.childElementCount) wrap.appendChild(hinweise);

            const editorDiv = el('div', 'hko-editor');
            editorDiv.id = `hko-text-${++counter}`;
            wrap.appendChild(editorDiv);
            countEl = el('p', 'hko-woerter');
            countEl.setAttribute('aria-live', 'polite');
            wrap.appendChild(countEl);
            c.container.appendChild(wrap);

            quill = new window.Quill(editorDiv, {
                theme: 'snow',
                placeholder: 'Ihre Antwort …',
                modules: { toolbar: false },
                formats: [],
            });
            // Wie renderer.js: bis restore() durch ist, zählt nichts als Eingabe.
            setTimeout(() => { initializing = false; }, 0);

            guardEditor(quill, {
                isActive: () => !initializing && enabled && !c.readonly,
                report: (event) => c.reportPaste('text', event),
                showMessage: (message) => showFieldMessage(quill.root, message),
            });
            quill.on('text-change', (delta, oldDelta, source) => {
                updateCount();
                if (initializing || source !== 'user' || !enabled || c.readonly) return;
                c.changed();
            });
            if (c.readonly) { enabled = false; quill.disable(); }
            updateCount();
        },
        collect() {
            return { text: currentText() };
        },
        restore(value) {
            const t = textOf(value);
            quill.setText(t, 'silent');
            quill.update('silent');
            updateCount();
        },
        validate() {
            const t = currentText();
            const words = countWords(t);
            const hinweise = [];
            const min = num(block?.min_woerter);
            const max = num(block?.max_woerter);
            if (min && words < min) hinweise.push(`Ihr Text hat ${words} Wörter; vorgesehen sind mindestens ${min}.`);
            if (max && words > max) hinweise.push(`Ihr Text hat ${words} Wörter; vorgesehen sind höchstens ${max}.`);
            const zuGross = t.length > MAX_CHARS;
            if (zuGross) hinweise.push(`Ihr Text ist länger als ${MAX_CHARS} Zeichen.`);
            return { ok: !zuGross, hinweise, zuGross };
        },
        setEnabled(on) {
            enabled = !!on && !ctx?.readonly;
            quill?.enable(enabled);
        },
        printHtml,
    };
}
