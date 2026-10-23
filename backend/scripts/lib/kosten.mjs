// Cost report: pure functions (no I/O). CONTRACT.md, «Cost report».
// kosten-bericht.mjs reads the data and calls these; test/kosten.test.mjs tests them.
//
// Sources, joined by formativ's request_id:
//   formativUsage (lmsbox)       which student asked which question when → request_id
//   formativ_verbrauch (formativ) what that request cost: model, provider, tokens, OpenRouter cost
//   gemini-verbrauch.jsonl       one line per Gemini call of the local evaluator (tokens; priced here)
//
// Unknown stays unknown: a missing cost is counted as «ohne Betrag», never as 0.

/** Every formativ request of the LMS Box: feedbacks (latest + frueher) and failed tries. */
export function collectRequests(usageDocs) {
    const out = [];
    for (const docData of usageDocs) {
        const { uid, assignmentId, slots } = docData || {};
        if (typeof uid !== 'string' || typeof assignmentId !== 'string' || !slots || typeof slots !== 'object') continue;
        for (const [key, e] of Object.entries(slots)) {
            const i = key.indexOf('::');
            if (i < 0 || !e || typeof e !== 'object') continue;
            const base = { uid, assignmentId, subId: key.slice(0, i), questionId: key.slice(i + 2) };
            const attempts = e.state === 'done' ? [...(Array.isArray(e.frueher) ? e.frueher : []), e] : [];
            attempts.forEach((a, n) => out.push({ ...base, art: 'rueckmeldung', versuch: n + 1, at: a.at ?? null, request_id: a.request_id ?? null }));
            for (const f of Array.isArray(e.ausfaelle) ? e.ausfaelle : []) {
                out.push({ ...base, art: 'ausfall', versuch: null, at: f.at ?? null, request_id: f.request_id ?? null });
            }
        }
    }
    return out;
}

const inRange = (at, { seit, bis }) => {
    if (!at) return !seit && !bis;
    const t = Date.parse(at);
    if (seit && t < Date.parse(seit)) return false;
    if (bis && t >= Date.parse(bis) + 24 * 3600 * 1000) return false;   // `bis` is inclusive (a day)
    return true;
};

/**
 * Joins LMS Box requests with formativ's log. → { rows, unmatched }
 * rows: each request plus { modell, anbieter, eingabe_token, ausgabe_token, kosten_usd, vollstaendig, protokoll }
 *   protokoll: 'ok' | 'kein_protokoll' (no request_id, or not in the log: before 23.10.2026 or log missing)
 * unmatched: formativ rows no LMS Box request points to (other callers such as bbw-hko,
 *   requests whose id was not kept), only those with `origin` when given.
 */
export function joinFormativ(requests, verbrauch, { seit = null, bis = null, origin = null } = {}) {
    const byId = new Map((verbrauch || []).filter((v) => v && typeof v.request_id === 'string').map((v) => [v.request_id, v]));
    const used = new Set();
    const rows = requests.filter((r) => inRange(r.at, { seit, bis })).map((r) => {
        const v = r.request_id ? byId.get(r.request_id) : null;
        if (v) used.add(r.request_id);
        return {
            ...r,
            modell: v?.modell ?? null,
            anbieter: v?.anbieter ?? null,
            eingabe_token: v?.eingabe_token ?? null,
            ausgabe_token: v?.ausgabe_token ?? null,
            kosten_usd: Number.isFinite(Number(v?.kosten_usd)) && v?.kosten_usd !== null ? Number(v.kosten_usd) : null,
            vollstaendig: v ? Boolean(v.vollstaendig) : false,
            protokoll: v ? 'ok' : 'kein_protokoll',
        };
    });
    const unmatched = (verbrauch || []).filter((v) => !used.has(v.request_id)
        && inRange(v.erstellt_um ? new Date(v.erstellt_um).toISOString() : null, { seit, bis })
        && (!origin || v.herkunft === origin));
    return { rows, unmatched };
}

/** The price period of a model on a day, or null. Keys match the start of the model version; longest wins. */
export function priceFor(prices, model, at) {
    if (!prices?.modelle || typeof model !== 'string') return null;
    const name = model.toLowerCase().replace(/^models\//, '');
    const key = Object.keys(prices.modelle).filter((k) => name.startsWith(k.toLowerCase())).sort((a, b) => b.length - a.length)[0];
    if (!key) return null;
    const day = at ? String(at).slice(0, 10) : null;
    const period = prices.modelle[key].find((p) => (!p.ab || !day || day >= p.ab) && (!p.bis || !day || day <= p.bis));
    return period ? { key, eingabe: period.eingabe, ausgabe: period.ausgabe } : null;
}

/** Gemini log lines priced with the table. Output price covers answer and thinking tokens. */
export function priceGemini(lines, prices, { seit = null, bis = null } = {}) {
    return (lines || []).filter((l) => l && inRange(l.at ? new Date(l.at).toISOString() : null, { seit, bis })).map((l) => {
        const model = l.modell_version || l.modell || null;
        const p = priceFor(prices, model, l.at);
        const tin = Number.isFinite(l.eingabe_token) ? l.eingabe_token : null;
        const tout = Number.isFinite(l.ausgabe_token) ? l.ausgabe_token + (Number.isFinite(l.gedanken_token) ? l.gedanken_token : 0) : null;
        const kosten = p && tin !== null && tout !== null ? (tin * p.eingabe + tout * p.ausgabe) / 1e6 : null;
        return { ...l, modell_preis: p?.key ?? null, kosten_usd: kosten, preis_fehlt: !p, ausgabe_gesamt: tout };
    });
}

function bucket() {
    return { anfragen: 0, rueckmeldungen: 0, ausfaelle: 0, kosten_usd: 0, mit_betrag: 0, ohne_betrag: 0, eingabe_token: 0, ausgabe_token: 0 };
}
function addCost(b, kosten, tin, tout) {
    b.anfragen += 1;
    if (kosten === null) b.ohne_betrag += 1; else { b.kosten_usd += kosten; b.mit_betrag += 1; }
    if (Number.isFinite(tin)) b.eingabe_token += tin;
    if (Number.isFinite(tout)) b.ausgabe_token += tout;
}
const avg = (b) => (b.mit_betrag ? b.kosten_usd / b.mit_betrag : null);

/**
 * The tables of the report. `roster`: Map uid → { name, classId }.
 * Gemini lines are matched to a student by the name the evaluator logged (that is the
 * liveview's display name from the same roster); unmatched names stay their own row.
 */
export function aggregate({ rows, unmatched, gemini, roster }) {
    const persons = new Map();
    const person = (key, name, klasse) => {
        if (!persons.has(key)) persons.set(key, { name, klasse, formativ: bucket(), gemini: bucket() });
        return persons.get(key);
    };
    const nameKey = new Map();
    for (const [uid, s] of roster) if (s?.name) nameKey.set(`${s.name}`.toLowerCase(), uid);

    const questions = new Map();
    const models = new Map();
    const total = { formativ: bucket(), gemini: bucket(), fremd: bucket() };

    for (const r of rows) {
        const s = roster.get(r.uid);
        const p = person(r.uid, s?.name ?? `(unbekannt: ${r.uid.slice(0, 6)}…)`, s?.classId ?? '');
        for (const b of [p.formativ, total.formativ]) {
            addCost(b, r.kosten_usd, r.eingabe_token, r.ausgabe_token);
            if (r.art === 'ausfall') b.ausfaelle += 1; else b.rueckmeldungen += 1;
        }
        const qk = `${r.assignmentId}\u0000${r.subId}\u0000${r.questionId}`;
        if (!questions.has(qk)) questions.set(qk, { assignmentId: r.assignmentId, subId: r.subId, questionId: r.questionId, personen: new Set(), ...bucket() });
        const q = questions.get(qk);
        q.personen.add(r.uid);
        addCost(q, r.kosten_usd, r.eingabe_token, r.ausgabe_token);
        if (r.art === 'ausfall') q.ausfaelle += 1; else q.rueckmeldungen += 1;
        const mk = `formativ\u0000${r.modell ?? '(kein Protokoll)'}\u0000${r.anbieter ?? ''}`;
        if (!models.has(mk)) models.set(mk, { quelle: 'formativ', modell: r.modell ?? '(kein Protokoll)', anbieter: r.anbieter ?? '', ...bucket() });
        addCost(models.get(mk), r.kosten_usd, r.eingabe_token, r.ausgabe_token);
    }
    for (const v of unmatched) {
        addCost(total.fremd, v.kosten_usd === null || v.kosten_usd === undefined ? null : Number(v.kosten_usd), v.eingabe_token, v.ausgabe_token);
    }
    for (const g of gemini) {
        const uid = g.student_name ? nameKey.get(String(g.student_name).toLowerCase()) : null;
        const key = uid ?? `gemini:${g.class_name ?? ''}:${g.student_name ?? '(ohne Namen)'}`;
        const s = uid ? roster.get(uid) : null;
        const p = person(key, s?.name ?? g.student_name ?? '(ohne Namen)', s?.classId ?? g.class_name ?? '');
        for (const b of [p.gemini, total.gemini]) addCost(b, g.kosten_usd, g.eingabe_token, g.ausgabe_gesamt);
        const mk = `gemini\u0000${g.modell_version || g.modell || '?'}\u0000`;
        if (!models.has(mk)) models.set(mk, { quelle: 'Gemini (Evaluator)', modell: g.modell_version || g.modell || '?', anbieter: 'Google', ...bucket() });
        addCost(models.get(mk), g.kosten_usd, g.eingabe_token, g.ausgabe_gesamt);
    }

    const byName = (a, b) => `${a.klasse} ${a.name}`.localeCompare(`${b.klasse} ${b.name}`, 'de');
    return {
        total,
        personen: [...persons.values()].sort(byName),
        fragen: [...questions.values()].map((q) => ({ ...q, personen: q.personen.size, durchschnitt_usd: avg(q) }))
            .sort((a, b) => `${a.assignmentId} ${a.subId} ${a.questionId}`.localeCompare(`${b.assignmentId} ${b.subId} ${b.questionId}`, 'de')),
        modelle: [...models.values()].map((m) => ({ ...m, durchschnitt_usd: avg(m) })).sort((a, b) => b.kosten_usd - a.kosten_usd),
    };
}

// ---- output ------------------------------------------------------------------------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const usd = (n) => (n === null || n === undefined ? '–' : `$${n < 0.01 && n > 0 ? n.toFixed(6) : n.toFixed(4)}`);
const num = (n) => (Number.isFinite(n) ? n.toLocaleString('de-CH') : '–');
const costCell = (b) => `${usd(b.kosten_usd)}${b.ohne_betrag ? ` <span class="ohne">+ ${b.ohne_betrag} ohne Betrag</span>` : ''}`;

/** One CSV file (semicolon, as Excel in de-CH opens it). */
export function toCsv(header, rows) {
    const cell = (v) => {
        const s = v === null || v === undefined ? '' : typeof v === 'number' ? String(v).replace('.', '.') : String(v);
        return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    return `﻿${[header, ...rows].map((r) => r.map(cell).join(';')).join('\r\n')}\r\n`;
}

export function csvFiles(rep, rows, gemini) {
    return {
        'pro-person.csv': toCsv(
            ['Klasse', 'Name', 'formativ Anfragen', 'davon Ausfälle', 'formativ USD', 'formativ ohne Betrag', 'Gemini Aufrufe', 'Gemini USD', 'Gemini ohne Preis'],
            rep.personen.map((p) => [p.klasse, p.name, p.formativ.anfragen, p.formativ.ausfaelle, p.formativ.kosten_usd, p.formativ.ohne_betrag, p.gemini.anfragen, p.gemini.kosten_usd, p.gemini.ohne_betrag])),
        'pro-frage.csv': toCsv(
            ['Auftrag', 'Teilauftrag', 'Frage', 'Personen', 'Rückmeldungen', 'Ausfälle', 'USD', 'ohne Betrag', 'Ø USD je Anfrage'],
            rep.fragen.map((q) => [q.assignmentId, q.subId, q.questionId, q.personen, q.rueckmeldungen, q.ausfaelle, q.kosten_usd, q.ohne_betrag, q.durchschnitt_usd])),
        'pro-modell.csv': toCsv(
            ['Quelle', 'Modell', 'Anbieter', 'Anfragen', 'Eingabe-Token', 'Ausgabe-Token', 'USD', 'ohne Betrag', 'Ø USD je Anfrage'],
            rep.modelle.map((m) => [m.quelle, m.modell, m.anbieter, m.anfragen, m.eingabe_token, m.ausgabe_token, m.kosten_usd, m.ohne_betrag, m.durchschnitt_usd])),
        'einzeln-formativ.csv': toCsv(
            ['Zeit', 'uid', 'Auftrag', 'Teilauftrag', 'Frage', 'Art', 'Versuch', 'request_id', 'Modell', 'Anbieter', 'Eingabe-Token', 'Ausgabe-Token', 'USD', 'vollständig', 'Protokoll'],
            rows.map((r) => [r.at, r.uid, r.assignmentId, r.subId, r.questionId, r.art, r.versuch, r.request_id, r.modell, r.anbieter, r.eingabe_token, r.ausgabe_token, r.kosten_usd, r.vollstaendig, r.protokoll])),
        'einzeln-gemini.csv': toCsv(
            ['Zeit', 'Klasse', 'Name', 'Auftrag', 'Fragen', 'Modell', 'Modellversion', 'Eingabe-Token', 'Ausgabe-Token inkl. Denken', 'USD', 'Preis aus'],
            gemini.map((g) => [g.at, g.class_name, g.student_name, g.assignment_id, g.fragen, g.modell, g.modell_version, g.eingabe_token, g.ausgabe_gesamt, g.kosten_usd, g.modell_preis])),
    };
}

/** The local HTML page. Carries names: written to .secrets/ only, never published. */
export function renderHtml(rep, { erstellt, zeitraum, preise, hinweise = [] }) {
    const t = rep.total;
    const table = (head, body) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.join('')}</tbody></table>`;
    const tr = (cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`;
    return `<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kosten LMS Box</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; margin: 24px; color: #212529; background: #fff; }
  h1 { font-size: 1.4em; } h2 { font-size: 1.1em; margin-top: 2em; }
  .warn { background: #fff3cd; border: 1px solid #ffe69c; padding: 8px 12px; border-radius: 6px; }
  .note { color: #6c757d; font-size: 0.9em; }
  table { border-collapse: collapse; margin-top: 8px; font-size: 0.9em; }
  th, td { border-bottom: 1px solid #dee2e6; padding: 4px 10px; text-align: left; vertical-align: top; }
  th { background: #f8f9fa; position: sticky; top: 0; }
  td:nth-child(n+3) { font-variant-numeric: tabular-nums; }
  .ohne { color: #a04d00; font-size: 0.85em; white-space: nowrap; }
  .kpi { display: flex; gap: 16px; flex-wrap: wrap; }
  .kpi div { border: 1px solid #dee2e6; border-radius: 8px; padding: 10px 14px; min-width: 180px; }
  .kpi b { display: block; font-size: 1.3em; }
</style></head><body>
<h1>Kosten der Rückmeldungen</h1>
<p class="warn">Enthält Namen von Lernenden. Nur lokal öffnen, nicht weitergeben, nicht hochladen (Router §4).</p>
<p class="note">Erstellt ${esc(erstellt)} · Zeitraum: ${esc(zeitraum)} · Beträge in USD. formativ: was OpenRouter belastet hat (pro Anfrage gemeldet). Gemini: Token × Preistabelle (Stand ${esc(preise.stand)}, ${esc(preise.quelle)}).</p>
${hinweise.map((h) => `<p class="note">${esc(h)}</p>`).join('\n')}
<div class="kpi">
  <div>formativ (Lernende)<b>${usd(t.formativ.kosten_usd)}</b>${num(t.formativ.rueckmeldungen)} ${t.formativ.rueckmeldungen === 1 ? 'Rückmeldung' : 'Rückmeldungen'}, ${num(t.formativ.ausfaelle)} ${t.formativ.ausfaelle === 1 ? 'Ausfall' : 'Ausfälle'}${t.formativ.ohne_betrag ? `<br><span class="ohne">${t.formativ.ohne_betrag} ohne Betrag</span>` : ''}</div>
  <div>Gemini (Evaluator)<b>${usd(t.gemini.kosten_usd)}</b>${num(t.gemini.anfragen)} ${t.gemini.anfragen === 1 ? 'Bewertung' : 'Bewertungen'}${t.gemini.ohne_betrag ? `<br><span class="ohne">${t.gemini.ohne_betrag} ohne Preis</span>` : ''}</div>
  <div>formativ, keiner Person zugeordnet<b>${usd(t.fremd.kosten_usd)}</b>${num(t.fremd.anfragen)} Anfragen${t.fremd.ohne_betrag ? `<br><span class="ohne">${t.fremd.ohne_betrag} ohne Betrag</span>` : ''}</div>
</div>

<h2>Pro Person</h2>
${table(['Klasse', 'Name', 'formativ: Rückmeldungen', 'Ausfälle', 'formativ', 'Gemini: Bewertungen', 'Gemini'],
        rep.personen.map((p) => tr([esc(p.klasse), esc(p.name), num(p.formativ.rueckmeldungen), num(p.formativ.ausfaelle), costCell(p.formativ), num(p.gemini.anfragen), costCell(p.gemini)])))}

<h2>Pro Frage (formativ)</h2>
${table(['Auftrag', 'Teilauftrag · Frage', 'Personen', 'Rückmeldungen', 'Ausfälle', 'Summe', 'Ø je Anfrage'],
        rep.fragen.map((q) => tr([esc(q.assignmentId), `${esc(q.subId)} · ${esc(q.questionId)}`, num(q.personen), num(q.rueckmeldungen), num(q.ausfaelle), costCell(q), usd(q.durchschnitt_usd)])))}

<h2>Pro Modell</h2>
${table(['Quelle', 'Modell', 'Anbieter', 'Anfragen', 'Eingabe-Token', 'Ausgabe-Token', 'Summe', 'Ø je Anfrage'],
        rep.modelle.map((m) => tr([esc(m.quelle), esc(m.modell), esc(m.anbieter), num(m.anfragen), num(m.eingabe_token), num(m.ausgabe_token), costCell(m), usd(m.durchschnitt_usd)])))}

<p class="note">«ohne Betrag»: für diese Anfragen gibt es keinen gemeldeten Betrag (vor dem 23.10.2026, Protokoll fehlt, oder ein Abbruch, den der Anbieter nicht abgerechnet hat). Sie sind nie als 0 mitgezählt. «Ausfälle» sind Versuche, die das Modell erreicht haben, aber keine brauchbare Rückmeldung brachten: die Lernenden bekamen den Versuch zurück, gekostet haben sie trotzdem.</p>
</body></html>
`;
}
