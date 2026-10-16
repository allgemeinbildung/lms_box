//
//  js/hko/util.js — kleine DOM-Hilfen für die HKO-Module. Werte gehen nur als Text ins DOM.
//

/** Element mit Klasse und Text (textContent, nie HTML). */
export function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text !== undefined && text !== null) e.textContent = String(text);
    return e;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
/** Für HTML-Fragmente (Druck): jeden Wert hier durchschicken. */
export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Wörter in einem Text (Leerraum-getrennt). */
export function countWords(text) {
    const t = String(text ?? '').trim();
    return t ? t.split(/\s+/).length : 0;
}

/** «3-jährige Lehre» aus '3J'. */
export function lehreText(variante) {
    const m = /^(\d)J$/.exec(String(variante ?? ''));
    return m ? `${m[1]}-jährige Lehre` : 'Lehre';
}
