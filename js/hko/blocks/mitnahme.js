//
//  js/hko/blocks/mitnahme.js — Block `mitnahme`: zeigt eigene frühere Antworten als Text (Vertrag §4, §7).
//
//  quellen[{ unitId, blockId, feld?, label, kn? }] → je Quelle `label` als Überschrift, darunter der
//  Wert der eigenen Antwort `answers/{uid}__{unitId}__{blockId}` (auch aus anderen Einheiten).
//  Speichert nie (kein collect/restore). Live über BroadcastChannel('hko-answers') (nur die eigene
//  uid), dazu neu vom Server lesen, sobald die Seite wieder sichtbar wird oder den Fokus bekommt.
//  Quellen mit kn: true (an der Quelle, am Block der Einheit der Quelle oder an der Antwort) zeigen nichts.
//  Eine Marke `unsynced_hko_…` im Cache (eigener Text, noch nicht auf dem Server) gewinnt über den
//  Server, wie beim Laden des Blocks selbst: ein iframe, das kurz nach dem Tippen lädt, zeigt sonst
//  bis zum nächsten Tastendruck den alten Stand. Der Cache gehört der angemeldeten Person (js/auth.js).
//  Alles per textContent; Zeilenumbrüche per CSS (white-space: pre-wrap).
//
import { onAnswer, onWake } from '../channel.js';
import { el } from '../util.js';
import { readMarker } from '../save.js';

export const LEER = 'Noch nichts geschrieben.';
const FELDER = new Set(['text', 'befund', 'zeilen', 'stufen', 'begruendung', 'verbessere']);
const ID = /^[a-z0-9-]{1,100}$/;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');
const own = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const LIVE_MS = 5000;   // so lange nach einem Broadcast liest das Aufwachen nicht neu (Debounce 2 s + Schreiben)

/** Typ aus der Form des Werts (Broadcast-Nachrichten tragen keinen `type`). */
function typVon(value) {
    if (!isObj(value)) return null;
    if ('zeilen' in value) return 'raster';
    if ('stufen' in value) return 'selbst';
    if ('antworten' in value) return 'items';
    if ('text' in value) return 'text';
    return null;
}

const zeilenText = (zeilen) => (Array.isArray(zeilen) ? zeilen : [])
    .map((z) => (Array.isArray(z?.c) ? z.c.map(str).join(' | ') : ''))
    .filter((t) => t.replace(/[\s|]/g, '') !== '')
    .join('\n');

/** «Kriterium: Stufe n»; `titelVon(kritId)` löst den Anzeigenamen auf (sonst die Id). */
const stufenText = (stufen, titelVon) => (isObj(stufen) ? Object.entries(stufen) : [])
    .filter(([, n]) => Number.isInteger(n))
    .map(([id, n]) => `${titelVon(id)}: Stufe ${n}`)
    .join('\n');

const antwortenText = (antworten, frageVon) => (Array.isArray(antworten) ? antworten : [])
    .filter((a) => isObj(a) && str(a.text).trim())
    .map((a) => `${frageVon(str(a.frageId))}: ${a.text}`)
    .join('\n\n');

/** Braucht die Darstellung Fragetexte oder Kriteriennamen aus der Einheit der Quelle? */
const brauchtEinheit = (type, value, feld) => (feld ? feld === 'stufen' : ['items', 'selbst'].includes(type || typVon(value)));

/**
 * Der anzuzeigende Text zu `value`. `feld` ist ein Pfad (Vertrag §4); unbekannte Pfade ergeben ''.
 * `unit` (die Einheit der Quelle, wenn bekannt) liefert Fragetexte und Kriteriennamen.
 */
export function wertText(value, type, feld, unit, blockId) {
    if (!isObj(value)) return '';
    const frageVon = (id) => {
        const fragen = own(own(unit?.blocks, blockId), 'fragen');
        const f = Array.isArray(fragen) ? fragen.find((x) => x?.id === id) : null;
        return str(f?.text) || id;
    };
    const titelVon = (id) => str(own(own(unit?.kriterien, id), 'name')) || id;

    if (feld) {
        const m = /^antworten\.([a-z0-9-]{1,100})$/.exec(feld);
        if (m) {
            const a = (Array.isArray(value.antworten) ? value.antworten : []).find((x) => isObj(x) && x.frageId === m[1]);
            return str(a?.text);
        }
        if (!FELDER.has(feld) || !Object.hasOwn(value, feld)) return '';
        if (feld === 'zeilen') return zeilenText(value.zeilen);
        if (feld === 'stufen') return stufenText(value.stufen, titelVon);
        return str(value[feld]);
    }
    switch (type || typVon(value)) {
        case 'text': return str(value.text);
        case 'items': return antwortenText(value.antworten, frageVon);
        case 'raster': {
            const z = zeilenText(value.zeilen);
            const b = str(value.befund).trim() ? `Befund: ${value.befund}` : '';
            return [z, b].filter(Boolean).join('\n\n');
        }
        case 'selbst':
            return [
                stufenText(value.stufen, titelVon),
                str(value.begruendung).trim() ? `Begründung: ${value.begruendung}` : '',
                str(value.verbessere).trim() ? `Das verbessere ich: ${value.verbessere}` : '',
            ].filter(Boolean).join('\n\n');
        default: return '';
    }
}

/** Die Druckansicht lässt `mitnahme` aus (nichts Eigenes); das Interface verlangt die Funktion. */
export function printHtml() {
    return '';
}

export function create() {
    let ctx = null;
    let zeilen = [];               // pro sichtbarer Quelle: { q, sectionEl, wertEl, gen, seq, value, type }
    const einheiten = new Map();   // unitId → Promise<unit|null> (Fragetexte, Kriteriennamen)
    const aus = [];

    function einheit(unitId) {
        if (unitId === ctx.unitId) return Promise.resolve(ctx.unit);
        if (!einheiten.has(unitId)) einheiten.set(unitId, Promise.resolve(ctx.api.getUnit(unitId)).catch(() => null));
        return einheiten.get(unitId);
    }

    async function zeige(z) {
        const seq = ++z.seq;
        const unit = brauchtEinheit(z.type, z.value, z.q.feld) ? await einheit(z.q.unitId) : null;
        if (seq !== z.seq) return;   // inzwischen kam etwas Neueres
        const t = wertText(z.value, z.type, z.q.feld, unit, z.q.blockId);
        const leer = !t.trim();
        z.wertEl.classList.toggle('hko-leer', leer);
        z.wertEl.textContent = leer ? LEER : t;
        z.wertEl.dataset.leer = leer ? 'ja' : 'nein';
    }

    /** Liest vom Server; ein Broadcast, der währenddessen eintrifft, ist neuer und gewinnt. */
    async function lade(z) {
        const gen = z.gen;
        try {
            const [doc, marker, unit] = await Promise.all([
                ctx.api.getAnswer(z.q.unitId, z.q.blockId),
                readMarker(z.q.unitId, z.q.blockId),
                z.q.unitId === ctx.unitId ? null : einheit(z.q.unitId),
            ]);
            if (z.gen !== gen) return;
            if ((doc && doc.kn === true) || own(own(unit?.blocks, z.q.blockId), 'kn') === true) {
                z.sectionEl.hidden = true;
                return;
            }
            z.value = marker ? marker.value : doc ? doc.value : null;
            z.type = marker ? null : doc ? doc.type : null;
        } catch (error) {
            console.error('[hko] mitnahme:', error);
            if (z.value === undefined) {
                z.wertEl.textContent = 'Ihre Antwort konnte nicht geladen werden.';
                z.wertEl.dataset.leer = 'fehler';
            }
            return;
        }
        await zeige(z);
    }

    return {
        render(block, c) {
            ctx = c;
            const wrap = el('div', 'hko-block hko-mitnahme');
            if (typeof block.auftrag === 'string' && block.auftrag) wrap.appendChild(el('p', 'hko-auftrag', block.auftrag));
            const quellen = Array.isArray(block.quellen) ? block.quellen : [];
            zeilen = [];
            for (const q of quellen) {
                if (!isObj(q) || !ID.test(str(q.unitId)) || !ID.test(str(q.blockId))) continue;
                if (q.kn === true) continue;
                if (q.unitId === c.unitId && c.unit?.blocks?.[q.blockId]?.kn === true) continue;
                const sectionEl = el('section', 'hko-mitnahme-quelle');
                sectionEl.dataset.unit = q.unitId;
                sectionEl.dataset.block = q.blockId;
                sectionEl.appendChild(el('h4', 'hko-mitnahme-label', str(q.label) || q.blockId));
                const wertEl = el('div', 'hko-mitnahme-wert hko-leer', 'Lade …');
                wertEl.dataset.leer = 'laedt';
                sectionEl.appendChild(wertEl);
                wrap.appendChild(sectionEl);
                zeilen.push({
                    q: { unitId: q.unitId, blockId: q.blockId, feld: str(q.feld) },
                    sectionEl, wertEl, gen: 0, seq: 0, liveAt: 0, value: undefined, type: null,
                });
            }
            c.container.appendChild(wrap);

            aus.push(onAnswer(c.uid, ({ unitId, blockId, value }) => {
                for (const z of zeilen) {
                    if (z.q.unitId !== unitId || z.q.blockId !== blockId || z.sectionEl.hidden) continue;
                    z.gen++;
                    z.liveAt = Date.now();
                    z.value = value;
                    z.type = null;
                    zeige(z);
                }
            }));
            // Nach dem Aufwachen neu lesen, ausser dort, wo eben ein Broadcast Neueres gebracht hat
            // (dessen Marke oder Speicherung kann noch unterwegs sein).
            aus.push(onWake(() => { for (const z of zeilen) if (!z.sectionEl.hidden && Date.now() - z.liveAt > LIVE_MS) lade(z); }));
            for (const z of zeilen) lade(z);
        },
        destroy() { while (aus.length) aus.pop()(); },
        validate: () => ({ ok: true, hinweise: [], zuGross: false }),
        setEnabled() {},
        printHtml,
    };
}
