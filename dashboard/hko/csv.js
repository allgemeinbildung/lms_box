//
//  dashboard/hko/csv.js — pure helpers: answer -> plain text, short status, CSV.
//
//  No DOM, no Firebase: importable in Node (backend/test/hko-csv.test.mjs).
//  Answers are plain text (Vertrag §4), never HTML. Nothing here trusts a value: a student
//  can write any shape into their own document, so every access checks the type first.
//
//  The CSV carries names: save it locally only (Router §4), never into a repo or an artifact.
//

export const CSV_HEADER = ['Name', 'Klasse', 'Variante', 'Block', 'Typ', 'Stand', 'Antwort', 'Paste-Hinweise'];

export const str = (v) => (typeof v === 'string' ? v : '');
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const wordCount = (text) => { const m = str(text).trim().match(/\S+/g); return m ? m.length : 0; };

/** Cells of a raster row as an array of strings, whatever was stored. */
export const rowCells = (row) => (isObj(row) && Array.isArray(row.c) ? row.c.map(str) : []);

/** `{ antworten: [{frageId, text}] }` -> array of well-formed entries. */
export const itemAnswers = (value) => (isObj(value) && Array.isArray(value.antworten) ? value.antworten : [])
    .filter((a) => isObj(a) && str(a.frageId))
    .map((a) => ({ frageId: str(a.frageId), text: str(a.text) }));

/** `{ stufen: {kritId: n} }` -> [[kritId, n]] with 0..3 integers only. */
export const stufenOf = (value) => (isObj(value) && isObj(value.stufen) ? Object.entries(value.stufen) : [])
    .filter(([, n]) => Number.isInteger(n) && n >= 0 && n <= 3);

/** The answer as plain text, parts separated by ` | ` (CSV column "Antwort"). */
export function answerText(type, value) {
    if (!isObj(value)) return '';
    const parts = [];
    if (type === 'text') {
        parts.push(str(value.text));
    } else if (type === 'items') {
        for (const a of itemAnswers(value)) parts.push(`${a.frageId}: ${a.text}`);
    } else if (type === 'raster') {
        (Array.isArray(value.zeilen) ? value.zeilen : []).forEach((row, i) => {
            const cells = rowCells(row);
            if (cells.some((c) => c.trim())) parts.push(`Zeile ${i + 1}: ${cells.join(' / ')}`);
        });
        if (str(value.befund).trim()) parts.push(`Befund: ${str(value.befund)}`);
    } else if (type === 'selbst') {
        for (const [k, n] of stufenOf(value)) parts.push(`${k}: ${n}`);
        if (str(value.begruendung).trim()) parts.push(`Begründung: ${str(value.begruendung)}`);
        if (str(value.verbessere).trim()) parts.push(`Verbessere: ${str(value.verbessere)}`);
    }
    return parts.join(' | ');
}

/** `dd.mm.yyyy HH:MM` of a Firestore Timestamp (or Date / millis); '' when unknown. */
export function formatTime(ts) {
    let d = null;
    if (ts && typeof ts.toDate === 'function') d = ts.toDate();
    else if (ts instanceof Date) d = ts;
    else if (typeof ts === 'number') d = new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return '';
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Short status of one answer: '–' without a document, else words / filled fields. `block` is the unit's block. */
export function shortStatus(answer, block) {
    if (!answer) return '–';
    const { type, value } = answer;
    let s = 'angefangen';
    if (isObj(value)) {
        if (type === 'text') {
            const w = wordCount(value.text);
            if (w) s = `${w} ${w === 1 ? 'Wort' : 'Wörter'}`;
        } else if (type === 'items') {
            const filled = itemAnswers(value).filter((a) => a.text.trim()).length;
            const total = Array.isArray(block?.fragen) ? block.fragen.length : 0;
            if (filled) s = total ? `${filled}/${total} beantwortet` : `${filled} beantwortet`;
        } else if (type === 'raster') {
            const cells = (Array.isArray(value.zeilen) ? value.zeilen : []).reduce((n, r) => n + rowCells(r).filter((c) => c.trim()).length, 0);
            const total = Number.isInteger(block?.zeilen) && Array.isArray(block?.spalten) ? block.zeilen * block.spalten.length : 0;
            const befund = str(value.befund).trim() ? ' + Befund' : '';
            if (cells || befund) s = `${total ? `${cells}/${total}` : cells} Zellen${befund}`;
        } else if (type === 'selbst') {
            const n = stufenOf(value).length;
            const total = Array.isArray(block?.kriterien) ? block.kriterien.length : 0;
            if (n) s = total ? `${n}/${total} Kriterien` : `${n} Kriterien`;
        }
    }
    return answer.status === 'abgegeben' ? `${s}, abgegeben` : s;
}

const KIND = { paste: 'Einfügen', drop: 'Ablegen', bulk: 'Grosser Zuwachs', fast: 'Sehr schnell' };
export const kindLabel = (k) => KIND[k] || str(k) || '?';

/** One paste event as one line of text. */
export const pasteLine = (e) => {
    const chars = Number.isFinite(e.chars) ? `${e.chars} Zeichen` : '';
    const ex = str(e.excerpt) ? `: «${str(e.excerpt)}»` : '';
    return `${kindLabel(e.kind)} in ${str(e.feld) || '?'}${chars ? `, ${chars}` : ''}${ex}`;
};

/** Formula injection: a field that Excel would run as a formula gets a leading apostrophe. */
export const guard = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);

/** One CSV field: formula guard, then quotes around `;` `"` and line breaks. */
export function csvField(value) {
    const s = guard(value === undefined || value === null ? '' : String(value));
    return /[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows (arrays of 8 values) -> CSV text: `;`, CRLF, UTF-8 BOM in front (Excel). */
export function buildCsv(rows) {
    return '\uFEFF' + [CSV_HEADER, ...rows].map((r) => r.map(csvField).join(';')).join('\r\n') + '\r\n';
}
