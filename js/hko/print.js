//
//  js/hko/print.js — Druckansicht (Plan §2.8, Vertrag §7 «Druck»).
//
//    printAnswers({ unit, unitId, variante, studentName, api, blockEntry, notify })
//      → Promise<void>; wirft nicht.
//
//  Liest die eigenen Antworten frisch vom Server (api.listOwnAnswers), baut daraus ein HTML-Dokument
//  mit allen Blöcken der eigenen Variante in unit.reihenfolge und öffnet es in einem Popup
//  (window.open('') + document.write + print()). Kein Download (die Einbettung hat kein
//  allow-downloads). Ausgelassen werden: Blöcke einer anderen Variante, kn: true, mitnahme und
//  Platzhalter-Typen. Jeder Wert aus DB und Inhalt geht durch escapeHtml().
//  Eine Marke `unsynced_hko_…` im Cache (eigener Text, der noch auf den Debounce wartet oder nicht
//  gespeichert werden konnte, auch aus einem Geschwister-iframe) gewinnt über den Server: gedruckt
//  wird, was die Person sieht. Der Cache gehört der angemeldeten Person (js/auth.js).
//  Bei Popup-Sperre ein Hinweis über notify(), nie alert().
//
import { escapeHtml, inlineHtml } from './util.js';
import { readMarker } from './save.js';

const STILE = `
body { font: 11pt/1.45 Arial, Helvetica, sans-serif; color: #111; margin: 18mm 16mm; }
h1 { font-size: 17pt; margin: 0 0 4pt 0; }
h2 { font-size: 13pt; margin: 0 0 4pt 0; }
.hko-kopf { border-bottom: 1px solid #444; margin-bottom: 14pt; padding-bottom: 6pt; }
.hko-kopf p { margin: 0; color: #333; }
.hko-druck-block { margin: 0 0 16pt 0; break-inside: avoid-page; }
.hko-druck-auftrag { margin: 0 0 6pt 0; color: #444; font-style: italic; }
.hko-druck-wert { border-left: 3px solid #bbb; padding-left: 8pt; }
[class*="hko-print"] { white-space: pre-wrap; overflow-wrap: anywhere; }
.hko-print-meta { color: #666; font-size: 9pt; margin: 4pt 0 0 0; }
.hko-leer { color: #666; font-style: italic; margin: 0; }
table { border-collapse: collapse; width: 100%; margin: 4pt 0; }
th, td { border: 1px solid #888; padding: 3pt 5pt; text-align: left; vertical-align: top; white-space: pre-wrap; }
@media print { body { margin: 0; } }
`;

/** Welche Blöcke gedruckt werden, in der Reihenfolge der Einheit. */
export function druckBloecke(unit, variante, blockEntry) {
    const reihenfolge = Array.isArray(unit?.reihenfolge) ? unit.reihenfolge : [];
    const out = [];
    for (const id of reihenfolge) {
        const block = unit?.blocks && Object.hasOwn(unit.blocks, id) ? unit.blocks[id] : null;
        if (!block || typeof block !== 'object') continue;
        if (block.kn === true || block.type === 'mitnahme') continue;
        const entry = blockEntry(block.type);
        if (!entry?.speichert || typeof entry.modul?.printHtml !== 'function') continue;   // Platzhalter
        if (block.nur_variante && block.nur_variante !== variante) continue;
        out.push({ id, block, entry });
    }
    return out;
}

/** Das ganze Dokument als escaptes HTML. */
export function druckDokument({ unit, unitId, variante, studentName, antworten, blockEntry, datum }) {
    const titel = typeof unit?.titel === 'string' && unit.titel ? unit.titel : String(unitId ?? '');
    const abschnitte = druckBloecke(unit, variante, blockEntry).map(({ id, block, entry }) => {
        const a = antworten.find((x) => x && x.blockId === id && x.type === block.type);
        let inhalt;
        try {
            inhalt = entry.modul.printHtml(a ? a.value : null, block, unit);
        } catch (error) {
            console.error('[hko] Druck:', id, error);
            inhalt = '<p class="hko-leer">Diese Antwort konnte nicht dargestellt werden.</p>';
        }
        const auftrag = typeof block.auftrag === 'string' && block.auftrag
            ? `<p class="hko-druck-auftrag">${inlineHtml(block.auftrag)}</p>` : '';
        return `<section class="hko-druck-block" data-block="${escapeHtml(id)}">`
            + `<h2>${escapeHtml(typeof block.titel === 'string' && block.titel ? block.titel : id)}</h2>`
            + `${auftrag}<div class="hko-druck-wert">${inhalt}</div></section>`;
    });
    const name = String(studentName ?? '').trim();
    return `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>${escapeHtml(titel)}</title>`
        + `<style>${STILE}</style></head><body>`
        + `<header class="hko-kopf"><h1>${escapeHtml(titel)}</h1>`
        + `<p>${name ? `${escapeHtml(name)}, ` : ''}${escapeHtml(datum)}</p></header>`
        + (abschnitte.length ? abschnitte.join('\n') : '<p class="hko-leer">Es gibt nichts zu drucken.</p>')
        + '</body></html>';
}

export async function printAnswers({ unit, unitId, variante, studentName, api, blockEntry, notify }) {
    try {
        // Popup zuerst öffnen, solange die Aktivierung durch den Klick noch gilt.
        const w = window.open('');
        if (!w) {
            notify('Das Fenster für die Druckansicht wurde blockiert. Erlauben Sie Pop-ups für diese Seite und versuchen Sie es nochmals.');
            return;
        }
        let antworten;
        try {
            antworten = await api.listOwnAnswers(unitId);
        } catch (error) {
            console.error('[hko] Druck:', error);
            try { w.close(); } catch { /* egal */ }
            notify('Ihre Antworten konnten nicht geladen werden. Prüfen Sie Ihre Internetverbindung und versuchen Sie es nochmals.');
            return;
        }
        const bloecke = druckBloecke(unit, variante, blockEntry);
        const marken = await Promise.all(bloecke.map(({ id }) => readMarker(unitId, id)));
        bloecke.forEach(({ id, block }, i) => {
            if (!marken[i]) return;
            antworten = antworten.filter((x) => !(x && x.blockId === id));
            antworten.push({ blockId: id, type: block.type, value: marken[i].value });
        });
        const html = druckDokument({
            unit, unitId, variante, studentName, antworten, blockEntry,
            datum: new Date().toLocaleDateString('de-CH', { day: 'numeric', month: 'long', year: 'numeric' }),
        });
        if (w.closed) return;   // in der Zwischenzeit von Hand geschlossen
        w.document.open();
        w.document.write(html);
        w.document.close();
        setTimeout(() => {
            try { w.focus(); w.print(); } catch (error) { console.error('[hko] Druck:', error); }
        }, 300);
    } catch (error) {
        console.error('[hko] Druck:', error);
        notify('Die Druckansicht konnte nicht geöffnet werden.');
    }
}
