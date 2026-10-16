//
//  js/hko/blocks/selbst.js — Block `selbst`: Selbsteinschätzung je Kriterium (Radio, Stufen 3…0)
//  und zwei Textfelder (Vertrag §4, §6).
//
//  value = { stufen: { <kritId>: int 0–3 }, begruendung, verbessere }; `stufen` enthält nur gewählte
//  Kriterien (Zahlen, nie Strings), die Texte höchstens 1 500 Zeichen. Die Textfelder sind
//  <textarea> mit automatischer Höhe und guardPlain() (feld = `begruendung` / `verbessere`).
//
import { guardPlain, showFieldMessage } from '../plainGuard.js';
import { el, escapeHtml } from '../util.js';

export const MAX_CHARS = 1500;
const STUFEN = [3, 2, 1, 0];
let counter = 0;   // nur für eindeutige Element-Ids; kein Zustand eines Blocks

const kritIds = (block) => (Array.isArray(block?.kriterien) ? block.kriterien : [])
    .filter((k) => typeof k === 'string' && k);
const str = (v) => (typeof v === 'string' ? v : '');
const stufeOf = (value, id) => {
    const s = value && typeof value === 'object' && value.stufen && typeof value.stufen === 'object' ? value.stufen[id] : undefined;
    return Number.isInteger(s) && s >= 0 && s <= 3 ? s : null;
};
const kritName = (unit, id) => (typeof unit?.kriterien?.[id]?.name === 'string' && unit.kriterien[id].name) || id;
const stufenText = (unit, id, s) => {
    const t = unit?.kriterien?.[id]?.stufen?.[String(s)];
    return typeof t === 'string' ? t : '';
};
const indikator = (block, id) => (typeof block?.indikatoren?.[id] === 'string' ? block.indikatoren[id] : '');
const bezugTitel = (block, unit) => {
    const ref = block?.bezug_block;
    if (typeof ref !== 'string' || !ref) return '';
    const t = unit?.blocks?.[ref]?.titel;
    return typeof t === 'string' && t ? t : ref;
};

export function printHtml(value, block, unit) {
    const ids = kritIds(block);
    if (!ids.length) return '<p class="hko-leer">Keine Kriterien in diesem Auftrag.</p>';
    const rows = ids.map((id) => {
        const s = stufeOf(value, id);
        const txt = s === null ? 'nicht eingeschätzt' : `Stufe ${s}${stufenText(unit, id, s) ? ` – ${stufenText(unit, id, s)}` : ''}`;
        return `<li><strong>${escapeHtml(kritName(unit, id))}:</strong> ${escapeHtml(txt)}</li>`;
    }).join('');
    const feld = (titel, text) => `<p class="hko-print-meta"><strong>${escapeHtml(titel)}</strong></p>`
        + (text.trim() ? `<div class="hko-print-text">${escapeHtml(text)}</div>` : '<p class="hko-leer">Nichts geschrieben.</p>');
    const bezug = bezugTitel(block, unit);
    return (bezug ? `<p class="hko-print-meta">Bezieht sich auf: ${escapeHtml(bezug)}</p>` : '')
        + `<ul class="hko-print-stufen">${rows}</ul>`
        + feld('Begründung', str(value?.begruendung))
        + feld('Das verbessere ich', str(value?.verbessere));
}

export function create() {
    let ctx = null;
    let initializing = true;
    let enabled = true;
    let ids = [];
    const radios = new Map();     // kritId → [input]
    const areas = {};             // begruendung / verbessere → textarea

    const grow = (ta) => {
        ta.style.height = 'auto';
        ta.style.height = `${ta.scrollHeight + 2}px`;
    };
    const chosen = (id) => {
        const r = (radios.get(id) || []).find((x) => x.checked);
        return r ? Number(r.value) : null;
    };

    return {
        render(b, c) {
            ctx = c;
            const unit = c.unit;
            const base = ++counter;
            ids = kritIds(b);
            const wrap = el('div', 'hko-block hko-selbst');
            if (typeof b.auftrag === 'string' && b.auftrag) wrap.appendChild(el('p', 'hko-auftrag', b.auftrag));
            const bezug = bezugTitel(b, unit);
            if (bezug) wrap.appendChild(el('p', 'hko-bezug-block', `Bezieht sich auf: ${bezug}`));

            ids.forEach((id, k) => {
                const fs = el('fieldset', 'hko-krit');
                fs.dataset.krit = id;
                fs.appendChild(el('legend', 'hko-krit-name', kritName(unit, id)));
                const ind = indikator(b, id);
                if (ind) fs.appendChild(el('p', 'hko-krit-indikator', `Woran Sie es erkennen: ${ind}`));
                const list = [];
                for (const s of STUFEN) {
                    const row = el('div', 'hko-stufe');
                    const input = el('input');
                    input.type = 'radio';
                    input.name = `hko-selbst-${base}-k${k}`;
                    input.id = `hko-selbst-${base}-k${k}-s${s}`;
                    input.value = String(s);
                    input.addEventListener('change', () => {
                        if (initializing || !enabled || c.readonly) return;
                        c.changed();
                    });
                    const label = el('label');
                    label.htmlFor = input.id;
                    label.appendChild(el('span', 'hko-stufe-nr', `Stufe ${s}`));
                    const t = stufenText(unit, id, s);
                    if (t) {
                        label.appendChild(document.createTextNode(' '));
                        label.appendChild(el('span', 'hko-stufe-text', t));
                    }
                    row.appendChild(input);
                    row.appendChild(label);
                    fs.appendChild(row);
                    list.push(input);
                }
                radios.set(id, list);
                wrap.appendChild(fs);
            });
            if (!ids.length) wrap.appendChild(el('p', 'hko-leer', 'Keine Kriterien in diesem Auftrag.'));

            const felder = [['begruendung', 'Begründung'], ['verbessere', 'Das verbessere ich']];
            for (const [name, titel] of felder) {
                const box = el('div', 'hko-selbst-feld');
                const label = el('label', 'hko-selbst-label', titel);
                const ta = el('textarea', 'hko-selbst-text');
                ta.id = `hko-selbst-${base}-${name}`;
                ta.rows = 3;
                ta.setAttribute('autocomplete', 'off');
                label.htmlFor = ta.id;
                box.appendChild(label);
                box.appendChild(ta);
                wrap.appendChild(box);
                areas[name] = ta;
            }
            c.container.appendChild(wrap);

            for (const [name] of felder) {
                const ta = areas[name];
                guardPlain(ta, {
                    isActive: () => !initializing && enabled && !c.readonly,
                    report: (event) => c.reportPaste(name, event),
                    showMessage: (message) => showFieldMessage(ta, message),
                });
                ta.addEventListener('input', () => {
                    grow(ta);
                    if (initializing || !enabled || c.readonly) return;
                    c.changed();
                });
            }
            if (c.readonly) {
                enabled = false;
                for (const list of radios.values()) for (const r of list) r.disabled = true;
                for (const ta of Object.values(areas)) ta.readOnly = true;
            }
            // Wie renderer.js: bis restore() durch ist, zählt nichts als Eingabe.
            setTimeout(() => { initializing = false; }, 0);
        },
        collect() {
            const stufen = {};
            for (const id of ids) {
                const s = chosen(id);
                if (s !== null) stufen[id] = s;
            }
            return { stufen, begruendung: areas.begruendung.value, verbessere: areas.verbessere.value };
        },
        restore(value) {
            for (const id of ids) {
                const s = stufeOf(value, id);
                for (const r of radios.get(id) || []) r.checked = s !== null && Number(r.value) === s;
            }
            areas.begruendung.value = str(value?.begruendung);
            areas.verbessere.value = str(value?.verbessere);
            for (const ta of Object.values(areas)) grow(ta);
        },
        validate() {
            const hinweise = [];
            const zuGross = Object.values(areas).some((ta) => ta.value.length > MAX_CHARS);
            if (zuGross) hinweise.push(`Ein Text ist länger als ${MAX_CHARS} Zeichen.`);
            return { ok: !zuGross, hinweise, zuGross };
        },
        setEnabled(on) {
            enabled = !!on && !ctx?.readonly;
            for (const list of radios.values()) for (const r of list) r.disabled = !enabled;
            for (const ta of Object.values(areas)) ta.readOnly = !enabled;
        },
        printHtml,
    };
}
