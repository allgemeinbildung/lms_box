//
//  js/hko/plainGuard.js — Paste-Hinweis für <textarea>-Felder (raster, selbst), Plan §2.8.
//
//  Quill-Felder (text, items) nutzen js/pasteGuard.js unverändert; dieses Modul bildet
//  dasselbe für <textarea> nach, mit den Arten paste, drop, bulk (gleiche Schwelle
//  BULK_CHARS, aus js/pasteGuard.js importiert). Kein 'fast' (die Felder sind kurz).
//  Ein Hinweis ist kein Beweis und nie eine Sanktion. Meldetexte in Sie-Form.
//
//  Ausserdem: `showFieldMessage(anchor, message)` – kurze Meldung über einem Feld, und
//  `sieForm(message)`, das die Meldungen von js/pasteGuard.js (Du-Form) in Sie-Form bringt.
//
import { BULK_CHARS } from '../pasteGuard.js';

export const BLOCKED_MESSAGE = 'Einfügen ist deaktiviert, um die Kreativität und das kritische Denken zu fördern.';
export const NOTICED_MESSAGE = 'Eingefügter Text erkannt. Ihre Lehrperson sieht diesen Hinweis.';
const NATIVE_INPUT_MS = 1000;
const MAX_REPORTS = 30;          // pro Feld und Seitenaufruf
const MAX_DELETED = 20000;

/** Meldungen aus js/pasteGuard.js in Sie-Form. */
export function sieForm(message) {
    if (/^Eingefügter Text erkannt/.test(message)) return NOTICED_MESSAGE;
    return String(message).replace(/\bDeine\b/g, 'Ihre').replace(/\bdeine\b/g, 'Ihre');
}

/** Zeigt `message` drei Sekunden lang über `anchor` (Feld oder Editor). Nur textContent. */
export function showFieldMessage(anchor, message) {
    const host = anchor?.parentNode;
    if (!host) return;
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    const box = document.createElement('div');
    box.className = 'hko-feld-meldung';
    box.setAttribute('role', 'status');
    box.textContent = sieForm(message);
    host.appendChild(box);
    setTimeout(() => box.remove(), 3000);
}

const normalize = (text) => String(text).replace(/\s+/g, ' ').trim();

/** Eingefügter und gelöschter Text zwischen zwei Fassungen eines Feldes. */
export function diffPlain(before, after) {
    let start = 0;
    const max = Math.min(before.length, after.length);
    while (start < max && before[start] === after[start]) start++;
    let endB = before.length;
    let endA = after.length;
    while (endB > start && endA > start && before[endB - 1] === after[endA - 1]) { endB--; endA--; }
    return { inserted: after.slice(start, endA), deleted: before.slice(start, endB) };
}

/**
 * @param {HTMLTextAreaElement|HTMLInputElement} field
 * @param {{ isActive: () => boolean,
 *           report: (event: {kind: string, chars: number, excerpt: string}) => Promise<void>,
 *           showMessage?: (message: string) => void }} options
 *   isActive: false, solange die Seite das Feld selbst füllt.
 */
export function guardPlain(field, { isActive, report, showMessage }) {
    const show = showMessage || ((m) => showFieldMessage(field, m));
    let nativeKind = null;
    let nativeUntil = 0;
    let before = field.value;
    let deletedText = '';
    let reports = 0;

    const send = (kind, text) => {
        if (reports >= MAX_REPORTS) return;
        reports += 1;
        show(NOTICED_MESSAGE);
        const event = { kind, chars: text.length, excerpt: text.slice(0, 300) };
        Promise.resolve().then(() => report(event)).catch(() => {
            setTimeout(() => Promise.resolve().then(() => report(event)).catch(() => {}), 5000);
        });
    };
    const isOwnText = (text, old) => {
        const n = normalize(text);
        return n.length > 0 && (normalize(deletedText).includes(n) || normalize(old).includes(n));
    };

    field.addEventListener('paste', (e) => { e.preventDefault(); show(BLOCKED_MESSAGE); });
    field.addEventListener('drop', (e) => { e.preventDefault(); show(BLOCKED_MESSAGE); });
    field.addEventListener('focus', () => { before = field.value; });
    field.addEventListener('beforeinput', (e) => {
        before = field.value;   // the value restore() set is taken in here, before the first change
        if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromPasteAsQuotation') nativeKind = 'paste';
        else if (e.inputType === 'insertFromDrop') nativeKind = 'drop';
        else return;
        nativeUntil = Date.now() + NATIVE_INPUT_MS;
    });
    field.addEventListener('input', () => {
        const old = before;
        const now = field.value;
        before = now;
        if (!isActive()) return;
        const { inserted, deleted } = diffPlain(old, now);
        if (deleted) deletedText = (deletedText + '\n' + deleted).slice(-MAX_DELETED);
        const native = Date.now() < nativeUntil ? nativeKind : null;
        nativeKind = null;
        nativeUntil = 0;
        if (!inserted) return;
        if ((native || inserted.length >= BULK_CHARS) && !isOwnText(inserted, old)) send(native || 'bulk', inserted);
    });
}
