//
//  js/hko/kiRegel.js — Kasten mit der KI-Regel über jedem Block (Vertrag §6).
//
//  block.ki_regel = { stufe, text }, stufe ∈ verboten | eingeschraenkt | erlaubt | gegenstand.
//  Fehlt sie, zeigt der Kasten «KI-Regel fehlt – bitte der Lehrperson melden». Alles per textContent.
//
export const KI_STUFEN = Object.freeze({
    verboten: 'KI nicht erlaubt',
    eingeschraenkt: 'KI eingeschränkt',
    erlaubt: 'KI erlaubt',
    gegenstand: 'KI ist Gegenstand',
});
export const KI_FEHLT = 'KI-Regel fehlt – bitte der Lehrperson melden';

/** Liefert `{ stufe, label, text }`; `stufe` ist 'fehlt', wenn die Regel fehlt oder unbekannt ist. */
export function kiRegelInfo(block) {
    const regel = block?.ki_regel;
    const stufe = regel && typeof regel === 'object' ? String(regel.stufe ?? '') : '';
    const text = regel && typeof regel === 'object' && typeof regel.text === 'string' ? regel.text : '';
    if (!Object.hasOwn(KI_STUFEN, stufe)) return { stufe: 'fehlt', label: KI_FEHLT, text };
    return { stufe, label: KI_STUFEN[stufe], text };
}

/** Füllt `el` (#hko-ki-regel) mit dem Kasten. */
export function renderKiRegel(el, block, blockId = '') {
    const info = kiRegelInfo(block);
    if (info.stufe === 'fehlt') console.warn(`[hko] KI-Regel fehlt oder ist unbekannt: Block ${blockId}`);
    el.replaceChildren();
    el.className = 'hko-ki-regel';
    el.dataset.stufe = info.stufe;
    el.setAttribute('role', 'note');
    const label = document.createElement('strong');
    label.className = 'hko-ki-stufe';
    label.textContent = info.label;
    el.appendChild(label);
    if (info.text) {
        const text = document.createElement('span');
        text.className = 'hko-ki-text';
        text.textContent = info.text;
        el.append(' ', text);
    }
    el.hidden = false;
}
