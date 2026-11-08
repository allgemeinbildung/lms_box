//
//  dashboard/modules/klassenanalyse.js — the KI-Klassenanalyse for the teacher pages:
//  dashboard/spielfeld.html and dashboard/liveview.html show it with this one module.
//
//  Reads klassenanalysen/{id} (teachers only, see backend/CONTRACT.md «Class analysis»),
//  starts the callable boxKlassenanalyse, and draws the result. Everything from the
//  document goes into the DOM as text; uids become names only through the page's roster.
//
import { db, doc, getDoc, functions, httpsCallable } from '../../js/firebase.js';

export const SCHWELLE = 5;
const enc = encodeURIComponent;
export const analyseDocId = (classId, assignmentId, subId) => `${enc(classId)}__${enc(assignmentId)}__${enc(subId)}`;
const LAUF_TTL_MS = 6 * 60 * 1000;

// «Beantwortet» as everywhere in the teacher pages (renderer.js, spielfeld.html).
export function istAntwort(a) {
    return typeof a === 'string' && a.trim() !== '' && a !== '<p><br></p>';
}
/** Completed: every question has a non-empty answer (feedback or not). Same rule as the function. */
export function istAbgeschlossen(draft, questionIds) {
    if (!draft || !questionIds.length) return false;
    const m = new Map((Array.isArray(draft.answers) ? draft.answers : []).filter((a) => a && typeof a === 'object').map((a) => [a.questionId, a.answer]));
    return questionIds.every((q) => istAntwort(m.get(q)));
}

/** The stored analysis of one card, or null. Throws on a read error (rules, network). */
export async function analyseLesen(classId, assignmentId, subId) {
    const s = await getDoc(doc(db, 'klassenanalysen', analyseDocId(classId, assignmentId, subId)));
    return s.exists() ? s.data() : null;
}

const callable = httpsCallable(functions, 'boxKlassenanalyse', { timeout: 310000 });
/** Starts an analysis now; resolves when it is stored. Errors carry `details.code`. */
export const analyseStarten = (classId, assignmentId, subId) => callable({ classId, assignmentId, subId });

// ---- drawing -------------------------------------------------------------------------------

const CSS = `
.ka{border:1px solid #D9DEEA;border-radius:12px;background:#fff;padding:12px 14px;margin:0 0 14px;color:#14213D;font-size:14px;line-height:1.45;min-width:0;overflow-wrap:break-word}
.ka h3,.ka h4{margin:0 0 6px}.ka h3{font-size:15px}.ka h4{font-size:13.5px;margin-top:12px}
.ka .ka-kopf{display:flex;justify-content:space-between;align-items:baseline;gap:6px 12px;flex-wrap:wrap}
.ka .ka-stand{font-size:12px;color:#6B7590}
.ka .ka-ki{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.03em;background:#EEE9FB;color:#5B3FB0;border-radius:99px;padding:1px 8px;margin-right:6px}
.ka .ka-lage{margin:6px 0 4px}
.ka .ka-leer{color:#6B7590;font-style:italic;margin:4px 0}
.ka .ka-fehler{color:#B0472F;font-size:12.5px;margin:4px 0}
.ka .ka-btn{font:inherit;font-size:12.5px;font-weight:600;border:1px solid #C8CFE0;background:#fff;color:#1F3A93;border-radius:8px;padding:4px 10px;cursor:pointer}
.ka .ka-btn:disabled{opacity:.55;cursor:default}
.ka .ka-muster{border-left:4px solid #8E6FD8;background:#FBFAFF;border-radius:0 10px 10px 0;padding:8px 10px;margin:8px 0}
.ka .ka-muster b{display:block}
.ka .ka-meta{font-size:12px;color:#6B7590;margin-top:4px}
.ka .ka-zitat{font-family:Georgia,serif;font-size:13px;color:#3C4A6B;margin:4px 0 0 0}
.ka .ka-impuls{margin-top:6px;font-size:13px}
.ka .ka-name{display:inline-block;border:1px solid #D9DEEA;border-radius:99px;padding:0 8px;margin:2px 3px 2px 0;font-size:12.5px;background:#fff;white-space:nowrap}
.ka button.ka-name{font:inherit;font-size:12.5px;cursor:pointer;color:inherit}
.ka ul{margin:4px 0;padding-left:18px}.ka li{margin:4px 0}
.ka .ka-check{font-size:13px}.ka .ka-problem{font-weight:700;color:#B0472F;margin-right:4px}
.ka .ka-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:8px 14px}
.ka .ka-hinweis{font-size:11.5px;color:#6B7590;margin-top:10px}
.ka.ka-kompakt{padding:10px 12px}
`;
function stil() {
    if (document.getElementById('ka-css')) return;
    const s = document.createElement('style');
    s.id = 'ka-css';
    s.textContent = CSS;
    document.head.appendChild(s);
}
function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
}
function zeit(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const PROBLEM = { zu_mild: 'zu mild', zu_streng: 'zu streng', irrefuehrend: 'irreführend', loesung_verraten: 'Lösung verraten' };

/**
 * Text that may carry {{uid:…}} markers: each becomes the name (as text, or a chip).
 * Unknown uids (not on the roster any more) become «eine Person».
 */
function freitext(text, ctx, tag = 'span', cls = '') {
    const out = el(tag, cls);
    String(text || '').split(/(\{\{uid:[^}]+\}\})/).forEach((teil) => {
        const m = /^\{\{uid:([^}]+)\}\}$/.exec(teil);
        if (m) out.append(ctx.name(m[1]) || 'eine Person');
        else if (teil) out.append(teil);
    });
    return out;
}
function namen(uids, ctx) {
    const box = el('span');
    for (const u of uids || []) {
        const n = ctx.name(u);
        if (!n) continue;
        if (ctx.onName) {
            const b = el('button', 'ka-name', n);
            b.type = 'button';
            b.addEventListener('click', () => ctx.onName(u));
            box.append(b);
        } else box.append(el('span', 'ka-name', n));
    }
    return box;
}
const laeuft = (d) => d?.state === 'laeuft' && d.laeuft_seit && Date.now() - Date.parse(d.laeuft_seit) < LAUF_TTL_MS;

/**
 * One box for one card.
 *   ctx = {
 *     doc,                   // klassenanalysen document or null
 *     n,                     // completed students now (computed by the page from its drafts)
 *     auto,                  // assignment has klassenanalyse: true (runs on its own)
 *     name(uid) → string,    // roster name, or '' if unknown
 *     onName?(uid),          // click on a name
 *     frage(qid) → label,    // short label of a question
 *     kriterium(qid, kid) → label,
 *     kompakt?, onOpen?,     // compact: lage + pattern titles + «ganze Analyse»
 *     onStart?()             // start the analysis; resolves when done (page reloads the doc)
 *     titel?                 // heading
 *   }
 */
export function analyseKasten(ctx) {
    stil();
    const d = ctx.doc;
    const a = d?.analyse;
    const box = el('section', 'ka' + (ctx.kompakt ? ' ka-kompakt' : ''));
    const kopf = el('div', 'ka-kopf');
    const h = el('h3');
    h.append(el('span', 'ka-ki', 'KI'), ctx.titel || 'KI-Klassenanalyse');
    kopf.append(h);
    if (a && d.basis) {
        const st = `aus ${d.basis.abgeschlossen} Abgeschlossenen · ${d.model_version || d.modell || 'Modell ?'} · ${zeit(d.erstellt)}`;
        kopf.append(el('span', 'ka-stand', st));
    }
    box.append(kopf);

    const knopf = (text) => {
        const b = el('button', 'ka-btn', text);
        b.type = 'button';
        b.addEventListener('click', async () => {
            b.disabled = true;
            b.textContent = 'Analyse läuft … (bis 2 Minuten)';
            meldung.textContent = '';
            try { await ctx.onStart(); } catch (e) {
                meldung.textContent = startFehler(e);
                b.disabled = false;
                b.textContent = text;
            }
        });
        return b;
    };
    const meldung = el('div', 'ka-fehler');

    if (laeuft(d)) {
        box.append(el('p', 'ka-leer', `Die Analyse läuft seit ${zeit(d.laeuft_seit)}. Laden Sie in einer Minute neu.`));
    } else if (!a && ctx.n < SCHWELLE) {
        box.append(el('p', 'ka-leer', `Analyse ab ${SCHWELLE} Abgeschlossenen (${ctx.n}/${SCHWELLE}).`));
    } else if (!a) {
        box.append(el('p', 'ka-leer', ctx.auto
            ? `${ctx.n} haben die Karte abgeschlossen. Die Analyse startet automatisch; Sie können sie auch selbst starten.`
            : `${ctx.n} haben die Karte abgeschlossen.`));
        if (ctx.onStart) box.append(knopf('Klassenanalyse erstellen'));
    }
    if (d?.state === 'fehler' && d.fehler) {
        box.append(el('p', 'ka-fehler', `Der letzte Lauf ist fehlgeschlagen (${d.fehler.code}, ${zeit(d.fehler.at)}).${a ? ' Angezeigt ist die vorherige Analyse.' : ''}`));
    }
    if (!a) { box.append(meldung); return box; }

    box.append(freitext(a.lage, ctx, 'p', 'ka-lage'));
    if (ctx.n > (d.basis?.abgeschlossen ?? 0)) box.append(el('div', 'ka-stand', `Inzwischen ${ctx.n} abgeschlossen.`));

    if (ctx.kompakt) {
        if (a.muster?.length) {
            const ul = el('ul');
            for (const m of a.muster) { const li = el('li'); li.append(freitext(m.titel, ctx, 'b'), ` · ${m.lernende?.length || 0} Lernende`); ul.append(li); }
            box.append(ul);
        }
        if (ctx.onOpen) {
            const b = el('button', 'ka-btn', 'Ganze Analyse →');
            b.type = 'button';
            b.addEventListener('click', ctx.onOpen);
            box.append(b);
        }
        return box;
    }

    const krit = (k) => { const [q, kid] = String(k).split('/'); return ctx.kriterium(q, kid) || k; };
    if (a.muster?.length) {
        box.append(el('h4', '', 'Muster in den Antworten'));
        for (const m of a.muster) {
            const mb = el('div', 'ka-muster');
            mb.append(freitext(m.titel, ctx, 'b'), freitext(m.beschreibung, ctx, 'div'));
            const meta = [];
            if (m.fragen?.length) meta.push(m.fragen.map((q) => ctx.frage(q) || q).join(', '));
            if (m.kriterien?.length) meta.push('Kriterien: ' + m.kriterien.map(krit).join(' · '));
            if (meta.length) mb.append(el('div', 'ka-meta', meta.join(' — ')));
            if (m.lernende?.length) mb.append(namen(m.lernende, ctx));
            for (const b of m.belege || []) {
                const z = el('div', 'ka-zitat', `«${b.zitat}»`);
                z.append(el('span', 'ka-meta', ` — ${ctx.name(b.lernende) || 'eine Person'}`));
                mb.append(z);
            }
            if (m.plenum_impuls) { const p = el('div', 'ka-impuls'); p.append(el('b', '', 'Im Plenum: '), freitext(m.plenum_impuls, ctx)); p.firstChild.style.display = 'inline'; mb.append(p); }
            box.append(mb);
        }
    }
    const grid = el('div', 'ka-grid');
    if (a.gruppen?.length) {
        const g = el('div');
        g.append(el('h4', '', 'Gruppen für die nächste Lektion'));
        for (const x of a.gruppen) {
            const d2 = el('div');
            d2.append(freitext(x.ziel, ctx, 'b'), el('br'), namen(x.lernende, ctx), freitext(x.auftrag, ctx, 'div', 'ka-meta'));
            d2.style.marginBottom = '8px';
            g.append(d2);
        }
        grid.append(g);
    }
    if (a.einzelne?.length) {
        const g = el('div');
        g.append(el('h4', '', 'Einzelne'));
        const ul = el('ul');
        for (const x of a.einzelne) {
            const li = el('li');
            li.append(namen([x.lernende], ctx), freitext(x.beobachtung, ctx), el('br'), el('span', 'ka-meta', 'Nächster Schritt: '), freitext(x.naechster_schritt, ctx));
            ul.append(li);
        }
        g.append(ul);
        grid.append(g);
    }
    if (a.gelungen?.length) {
        const g = el('div');
        g.append(el('h4', '', 'Gelungen'));
        const ul = el('ul');
        for (const x of a.gelungen) { const li = el('li'); li.append(freitext(x.beschreibung, ctx), ' ', namen(x.lernende, ctx)); ul.append(li); }
        g.append(ul);
        grid.append(g);
    }
    if (grid.children.length) box.append(grid);
    if (a.rueckmeldung_check?.length) {
        box.append(el('h4', '', 'Prüfung der KI-Rückmeldung (formativ)'));
        const ul = el('ul', 'ka-check');
        for (const c of a.rueckmeldung_check) {
            const li = el('li');
            li.append(el('span', 'ka-problem', PROBLEM[c.problem] || c.problem), namen([c.lernende], ctx),
                el('span', 'ka-meta', `${ctx.frage(c.frage) || c.frage}, ${ctx.kriterium(c.frage, c.kriterium) || c.kriterium}: `), freitext(c.begruendung, ctx));
            ul.append(li);
        }
        box.append(ul);
    }
    if (ctx.onStart) box.append(knopf('Neu analysieren'));
    box.append(meldung);
    box.append(el('p', 'ka-hinweis', 'Von einer KI aus den Antworten erstellt. Sie kann irren: Prüfen Sie die Belege, bevor Sie handeln. Keine Noten, keine Rangfolge.'));
    return box;
}

/** Human message for a failed start (HttpsError details.code from the function). */
export function startFehler(e) {
    const code = e?.details?.code || e?.code;
    return {
        zu_wenige: `Die Analyse braucht ${SCHWELLE} Abgeschlossene.`,
        laeuft: 'Die Analyse dieser Karte läuft gerade.',
        pause: 'Die Analyse wurde eben gestartet. Warten Sie eine Minute.',
        forbidden: 'Nur für Lehrpersonen.',
        not_configured: 'Die Klassenanalyse ist noch nicht eingerichtet.',
        quota: 'Das Kontingent des Modells ist erschöpft. Später nochmals.',
    }[code] || e?.message || 'Die Analyse ist fehlgeschlagen.';
}

// ---- panel for dashboard/liveview.html ------------------------------------------------------

/**
 * The analysis of one sub-assignment of the chosen assignment, with a choice of sub-assignment.
 *   host: element to draw into
 *   data: { classId, assignmentId, members: [{uid, name}], drafts: [draft], shape: { klassenanalyse, subs: [{subId, questions:[{id, text}]}] } }
 * Reads klassenanalysen for the chosen card; nothing else.
 */
export async function analysePanel(host, data) {
    stil();
    const { classId, assignmentId, members, drafts, shape } = data;
    const subs = shape?.subs || [];
    host.replaceChildren();
    if (!classId || !assignmentId || !subs.length) { host.hidden = true; return; }
    host.hidden = false;
    const key = `ka-sub:${assignmentId}`;
    let subId;
    try { subId = localStorage.getItem(key); } catch { subId = null; }
    if (!subs.some((s) => s.subId === subId)) subId = subs[0].subId;

    const namen = new Map(members.map((m) => [m.uid, m.name]));
    const zeile = el('div', 'ka-kopf');
    const sel = el('select');
    sel.setAttribute('aria-label', 'Teilaufgabe der Klassenanalyse');
    sel.style.cssText = 'max-width:100%;font:inherit;padding:4px 6px;border-radius:6px;border:1px solid #C8CFE0';
    for (const s of subs) { const o = el('option', '', s.subId); o.value = s.subId; sel.append(o); }
    sel.value = subId;
    zeile.append(el('span', 'ka-stand', 'Teilaufgabe:'), sel);
    const ziel = el('div');
    host.append(zeile, ziel);

    const zeichnen = async () => {
        subId = sel.value;
        try { localStorage.setItem(key, subId); } catch { /* egal */ }
        const sub = subs.find((s) => s.subId === subId);
        const qids = sub.questions.map((q) => q.id);
        const mine = new Map(drafts.filter((d) => d.assignmentId === assignmentId && d.subId === subId).map((d) => [d.uid, d]));
        const n = members.filter((m) => istAbgeschlossen(mine.get(m.uid), qids)).length;
        let d = null, fehler = '';
        try { d = await analyseLesen(classId, assignmentId, subId); } catch (e) { fehler = `Die Analyse konnte nicht gelesen werden (${e?.code || e}).`; }
        if (sel.value !== subId) return;
        const qText = new Map(sub.questions.map((q, i) => [q.id, `Frage ${i + 1}`]));
        const kasten = analyseKasten({
            doc: d, n, auto: shape.klassenanalyse === true,
            name: (u) => namen.get(u) || '',
            frage: (q) => qText.get(q) || q,
            kriterium: (q, k) => sub.questions.find((x) => x.id === q)?.kriterien?.[k] || k,
            titel: `KI-Klassenanalyse · ${subId}`,
            onStart: async () => { await analyseStarten(classId, assignmentId, subId); await zeichnen(); },
        });
        if (fehler) kasten.append(el('p', 'ka-fehler', fehler));
        ziel.replaceChildren(kasten);
    };
    sel.addEventListener('change', zeichnen);
    await zeichnen();
}
