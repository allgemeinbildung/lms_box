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

// Fett und kursiv wie im Altsystem (js/renderer.js): **fett**, *kursiv*, _kursiv_.
// Nur diese drei Marken; alles andere bleibt Text. `_` zählt nur an Wortgrenzen (nicht in a_b).
const INLINE = /\*\*(?!\s)(.+?)(?<!\s)\*\*|\*(?![\s*])(.+?)(?<![\s*])\*|(?<![\p{L}\p{N}])_(?!\s)(.+?)(?<!\s)_(?![\p{L}\p{N}])/gu;

// Hängt `text` an `parent` an: doppelte Sterne werden <strong>, einfache Sterne oder Unterstriche <em>.
// Werte gehen nur als Textknoten ins DOM.
export function appendInline(parent, text) {
    const s = String(text ?? '');
    let last = 0;
    for (const m of s.matchAll(INLINE)) {
        if (m.index > last) parent.appendChild(document.createTextNode(s.slice(last, m.index)));
        parent.appendChild(el(m[1] !== undefined ? 'strong' : 'em', null, m[1] ?? m[2] ?? m[3]));
        last = m.index + m[0].length;
    }
    if (last < s.length) parent.appendChild(document.createTextNode(s.slice(last)));
    return parent;
}

/** Für HTML-Fragmente (Druck): escapeHtml, danach dieselben Marken als <strong>/<em>. */
export function inlineHtml(text) {
    return escapeHtml(text).replace(INLINE, (_m, b, i1, i2) => (b !== undefined ? `<strong>${b}</strong>` : `<em>${i1 ?? i2}</em>`));
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
