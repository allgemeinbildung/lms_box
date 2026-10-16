//
//  js/hko/blocks/platzhalter.js — neutraler Platzhalter für Typen, die die Box (noch) nicht kann:
//  upload, link, roleplay, peer, audio und Unbekanntes (Vertrag §6). Speichert nichts.
//
import { el, escapeHtml } from '../util.js';

export const TEXT = 'Dieser Auftragstyp ist in der Box noch nicht verfügbar.';

export function printHtml() {
    return `<p class="hko-platzhalter">${escapeHtml(TEXT)}</p>`;
}

export function create() {
    return {
        render(block, ctx) {
            const wrap = el('div', 'hko-block hko-platzhalter-block');
            wrap.dataset.type = String(block?.type ?? '');
            if (typeof block?.auftrag === 'string' && block.auftrag) wrap.appendChild(el('p', 'hko-auftrag', block.auftrag));
            const p = el('p', 'hko-platzhalter', TEXT);
            p.id = 'hko-platzhalter';
            wrap.appendChild(p);
            ctx.container.appendChild(wrap);
        },
        validate: () => ({ ok: true, hinweise: [], zuGross: false }),
        setEnabled() {},
        printHtml,
    };
}
