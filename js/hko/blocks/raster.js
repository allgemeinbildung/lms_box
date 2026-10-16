//
//  js/hko/blocks/raster.js — Block `raster`: Tabelle aus <textarea>-Zellen plus optionaler Befund
//  (Vertrag §4, §6; Interface: js/hko/registry.js).
//
//  value = { zeilen: [{ c: [string × spalten] }] × block.zeilen, befund: string } — immer volle
//  Länge, leere Zellen ''. Grenzen: ≤ 8 Zeilen, ≤ 6 Zellen à ≤ 500 Zeichen, Befund ≤ 3 000.
//  Paste-Feld (§5): `r<zeile>c<spalte>` (0-basiert) und `befund`. Handy: dieselben Elemente als
//  Karten (CSS, kein zweites DOM). Der Bezug (Quelle/Lehrmittel) kommt aus js/hko/quelle.js.
//
import { guardPlain } from '../plainGuard.js';
import { renderBezug, bezugZeilen } from '../quelle.js';
import { el, escapeHtml } from '../util.js';

export const MAX_ZEILEN = 8;
export const MAX_SPALTEN = 6;
export const MAX_ZELLE = 500;
export const MAX_BEFUND = 3000;
let counter = 0;   // nur für eindeutige Element-Ids

const str = (v) => (typeof v === 'string' ? v : '');
const dim = (n) => (Number.isInteger(n) && n > 0 ? n : 0);
const spaltenOf = (block) => (Array.isArray(block?.spalten) ? block.spalten.map((s) => str(s)) : []);
const cell = (value, r, c) => {
    const row = Array.isArray(value?.zeilen) ? value.zeilen[r] : null;
    return row && typeof row === 'object' && Array.isArray(row.c) ? str(row.c[c]) : '';
};
const befundOf = (value) => (value && typeof value === 'object' ? str(value.befund) : '');

export function printHtml(value, block, unit) {
    const spalten = spaltenOf(block);
    const n = dim(block?.zeilen);
    const rows = [];
    let any = !!befundOf(value).trim();
    for (let r = 0; r < n; r++) {
        const cells = spalten.map((_, c) => {
            const t = cell(value, r, c);
            if (t.trim()) any = true;
            return `<td>${escapeHtml(t)}</td>`;
        });
        rows.push(`<tr>${cells.join('')}</tr>`);
    }
    if (!any) return '<p class="hko-leer">Noch nichts eingetragen.</p>';
    const bezug = bezugZeilen(block, unit).map((z) => `<p class="hko-print-meta">${escapeHtml(z)}</p>`).join('');
    const kopf = `<tr>${spalten.map((s) => `<th>${escapeHtml(s)}</th>`).join('')}</tr>`;
    const befund = block?.befund
        ? `<p class="hko-print-meta"><strong>Befund</strong></p><div class="hko-print-text">${escapeHtml(befundOf(value))}</div>`
        : '';
    return `${bezug}<table class="hko-print-raster"><thead>${kopf}</thead><tbody>${rows.join('')}</tbody></table>${befund}`;
}

export function create() {
    let ctx = null;
    let block = null;
    let initializing = true;
    let enabled = true;
    let fields = [];      // [zeile][spalte] → textarea
    let befundField = null;

    const all = () => (befundField ? [...fields.flat(), befundField] : fields.flat());
    const grow = (f) => {
        f.style.height = 'auto';
        if (f.scrollHeight > 0) f.style.height = `${f.scrollHeight + 2}px`;
    };
    const growAll = () => all().forEach(grow);

    function makeField(feldName, label, className) {
        const f = el('textarea', className);
        f.rows = 1;
        f.setAttribute('aria-label', label);
        f.dataset.feld = feldName;
        f.addEventListener('input', () => {
            grow(f);
            if (initializing || !enabled || ctx.readonly) return;
            ctx.changed();
        });
        guardPlain(f, {
            isActive: () => !initializing && enabled && !ctx.readonly,
            report: (event) => ctx.reportPaste(feldName, event),
        });
        return f;
    }

    return {
        render(b, c) {
            block = b;
            ctx = c;
            const spalten = spaltenOf(b);
            const n = dim(b.zeilen);
            const wrap = el('div', 'hko-block hko-raster');
            if (typeof b.auftrag === 'string' && b.auftrag) wrap.appendChild(el('p', 'hko-auftrag', b.auftrag));
            const bezug = renderBezug(b, c.unit);
            if (bezug) wrap.appendChild(bezug);

            const table = el('table', 'hko-raster-tabelle');
            const thead = el('thead');
            const hr = el('tr');
            spalten.forEach((s, i) => {
                const th = el('th', i === spalten.length - 1 && spalten.length > 1 ? 'hko-raster-begriff' : '', s);
                th.scope = 'col';
                hr.appendChild(th);
            });
            thead.appendChild(hr);
            table.appendChild(thead);

            const tbody = el('tbody');
            const beispiele = Array.isArray(b.beispielzeilen) ? b.beispielzeilen : [];
            for (const bz of beispiele) {
                const cs = Array.isArray(bz?.c) ? bz.c : [];
                const tr = el('tr', 'hko-raster-beispiel');
                spalten.forEach((s, i) => {
                    const td = el('td');
                    td.dataset.label = s;
                    if (i === 0) td.appendChild(el('span', 'hko-raster-marke', 'Beispiel'));
                    td.appendChild(el('span', 'hko-raster-beispieltext', str(cs[i])));
                    tr.appendChild(td);
                });
                tbody.appendChild(tr);
            }

            fields = [];
            for (let r = 0; r < n; r++) {
                const tr = el('tr', 'hko-raster-zeile');
                const row = [];
                spalten.forEach((s, i) => {
                    const td = el('td');
                    td.dataset.label = s;
                    const f = makeField(`r${r}c${i}`, `Zeile ${r + 1}, ${s}`, 'hko-raster-zelle');
                    row.push(f);
                    td.appendChild(f);
                    tr.appendChild(td);
                });
                fields.push(row);
                tbody.appendChild(tr);
            }
            table.appendChild(tbody);
            wrap.appendChild(table);

            befundField = null;
            if (b.befund) {
                const box = el('div', 'hko-raster-befund');
                const id = `hko-befund-${++counter}`;
                const label = el('label', 'hko-raster-befund-titel', 'Befund');
                label.htmlFor = id;
                befundField = makeField('befund', 'Befund', 'hko-raster-befund-feld');
                befundField.id = id;
                befundField.rows = 3;
                box.append(label, befundField);
                wrap.appendChild(box);
            }
            c.container.appendChild(wrap);

            // Bis restore() durch ist, zählt nichts als Eingabe (wie text.js / renderer.js).
            setTimeout(() => { initializing = false; }, 0);
            window.addEventListener('resize', growAll);
            if (c.readonly) { enabled = false; all().forEach((f) => { f.disabled = true; }); }
            growAll();
        },
        collect() {
            return {
                zeilen: fields.map((row) => ({ c: row.map((f) => f.value) })),
                befund: befundField ? befundField.value : '',
            };
        },
        restore(value) {
            fields.forEach((row, r) => row.forEach((f, c) => { f.value = cell(value, r, c); }));
            if (befundField) befundField.value = befundOf(value);
            growAll();
        },
        validate() {
            const hinweise = [];
            let zuGross = false;
            if (fields.length > MAX_ZEILEN) { zuGross = true; hinweise.push(`Das Raster hat mehr als ${MAX_ZEILEN} Zeilen.`); }
            if (spaltenOf(block).length > MAX_SPALTEN) { zuGross = true; hinweise.push(`Das Raster hat mehr als ${MAX_SPALTEN} Spalten.`); }
            if (fields.flat().some((f) => f.value.length > MAX_ZELLE)) {
                zuGross = true;
                hinweise.push(`Eine Zelle ist länger als ${MAX_ZELLE} Zeichen.`);
            }
            if (befundField && befundField.value.length > MAX_BEFUND) {
                zuGross = true;
                hinweise.push(`Ihr Befund ist länger als ${MAX_BEFUND} Zeichen.`);
            }
            return { ok: !zuGross, hinweise, zuGross };
        },
        setEnabled(on) {
            enabled = !!on && !ctx?.readonly;
            all().forEach((f) => { f.disabled = !enabled; });
        },
        printHtml,
    };
}
