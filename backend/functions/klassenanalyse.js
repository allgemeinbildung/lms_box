// KI-Klassenanalyse: one analysis per (class, assignmentId, subId), made by Gemini from the
// answers and the formativ feedback of the students who completed that sub-assignment.
// Binding spec: ../CONTRACT.md, «Class analysis (klassenanalysen)».
//
// Pure logic with injected dependencies (deps), so the tests run without Firestore and
// without a model. index.js wires it to Firestore, the roster and the Gemini API.
//
// What goes to the model: the card (title, core, facts, model answer, «leicht verwechselt»),
// the questions with their rubric, three class counts, and per student who completed the
// card a pseudonym L01 … (shuffled per run) with answers, feedback counts and statuses.
// Never: names, uids, e-mail, classId, timestamps, paste hints, other cards.
const { htmlToText, stripMarkdown, maskOwnName, slotKey, formativConfig } = require('./formativ');

const COLLECTION = 'klassenanalysen';
const SCHWELLE = 5;                     // first automatic analysis at 5 completed students
const SCHRITT = 3;                      // then again at 8, 11, 14 …
const PAUSE_AUTO_MS = 10 * 60 * 1000;   // at most one automatic run per card and 10 minutes
const PAUSE_MANUELL_MS = 60 * 1000;     // a second click within a minute starts nothing
const LAUF_TTL_MS = 6 * 60 * 1000;      // a run older than this counts as crashed (function timeout 300 s)
const MAX_ANTWORT = 1500;               // characters of one answer sent to the model
const MAX_HINWEIS = 400;
const MAX_ZITAT = 120;
const PROBLEME = ['zu_mild', 'zu_streng', 'irrefuehrend', 'loesung_verraten'];
const GRENZEN = { muster: 4, gruppen: 3, einzelne: 6, gelungen: 4, rueckmeldung_check: 10 };
const TEXT = { lage: 1200, titel: 160, beschreibung: 1200, plenum_impuls: 600, ziel: 300, auftrag: 600, beobachtung: 600, naechster_schritt: 400, begruendung: 600 };

class AnalyseFehler extends Error {
    constructor(message, code) {
        super(message);
        this.name = 'AnalyseFehler';
        this.code = code;
    }
}

const enc = encodeURIComponent;
const analyseId = (classId, assignmentId, subId) => `${enc(classId)}__${enc(assignmentId)}__${enc(subId)}`;

// «Beantwortet» exactly as the teacher pages count it (dashboard/modules/renderer.js, spielfeld.html).
function istAntwort(a) {
    return typeof a === 'string' && a.trim() !== '' && a !== '<p><br></p>';
}
function antwortenVon(draft) {
    const list = Array.isArray(draft?.answers) ? draft.answers : [];
    return new Map(list.filter((a) => a && typeof a === 'object').map((a) => [a.questionId, a.answer]));
}
/** Completed: every question of the sub-assignment has a non-empty answer, feedback or not. */
function istAbgeschlossen(draft, fragen) {
    if (!draft || !fragen.length) return false;
    const a = antwortenVon(draft);
    return fragen.every((q) => istAntwort(a.get(q.id)));
}
function istBegonnen(draft, fragen) {
    if (!draft) return false;
    const a = antwortenVon(draft);
    return fragen.some((q) => istAntwort(a.get(q.id)));
}
/** 0 below 5 completed, then 1 at 5–7, 2 at 8–10, … An automatic run needs a higher step. */
function stufe(n) {
    return n < SCHWELLE ? 0 : Math.floor((n - SCHWELLE) / SCHRITT) + 1;
}

// ---- the card: what the content says about it ------------------------------------------

const ABSCHNITTE = ['THEMA', 'KERN', 'GESICHERTE FAKTEN', 'QUELLEN', 'SICHTWEISEN', 'BEGRIFFE', 'LEICHT VERWECHSELT', 'GRENZEN'];
/** The briefing of spielfeld's export (render/export_lmsbox.py) split into its sections. */
function kontextTeile(kontext) {
    const out = {};
    let aktuell = null;
    for (const zeile of String(kontext || '').split('\n')) {
        const kopf = zeile.trim();
        if (ABSCHNITTE.includes(kopf)) { aktuell = kopf; out[aktuell] = []; continue; }
        if (aktuell && kopf) out[aktuell].push(kopf);
    }
    return out;
}

function fragenDerKarte(assignment, subId) {
    const sub = assignment?.subAssignments?.[subId];
    if (!sub || !Array.isArray(sub.questions)) return null;
    return { sub, fragen: sub.questions.filter((q) => q && typeof q.id === 'string') };
}

/** Card and questions as the model sees them. Only content, nothing about students. */
function karteBauen(assignment, subId) {
    const { sub, fragen } = fragenDerKarte(assignment, subId);
    const loesungen = new Map((sub.solution?.solutions || []).map((s) => [s.id, s.answer]));
    let kern = [], fakten = [], thema = '';
    const qs = fragen.map((q) => {
        const cfg = formativConfig(assignment, sub, q) || {};
        const teile = kontextTeile(cfg.kontext);
        if (!kern.length && teile.KERN) kern = teile.KERN;
        if (!fakten.length && teile['GESICHERTE FAKTEN']) fakten = teile['GESICHERTE FAKTEN'];
        if (!thema && teile.THEMA) thema = teile.THEMA.join(' ');
        let muster = (teile.SICHTWEISEN || []).join('\n').replace(/^Musterlösung der Lehrperson:\s*/, '');
        if (!muster && loesungen.get(q.id)) muster = htmlToText(loesungen.get(q.id));
        return {
            id: q.id,
            text: stripMarkdown(q.text).slice(0, 4000),
            musterloesung: muster.slice(0, 3000) || null,
            leicht_verwechselt: (teile['LEICHT VERWECHSELT'] || []).map((s) => s.replace(/^-\s*/, '')).slice(0, 10),
            rubrik: (Array.isArray(cfg.rubrik) ? cfg.rubrik : []).map((k) => ({
                id: String(k.id), label: String(k.label || ''), erwartung: String(k.erwartung || ''), niveau: k.niveau ? String(k.niveau) : null,
            })),
        };
    });
    return {
        karte: { titel: sub.titel || subId, begriff: thema || null, kern: kern.join('\n') || null, gesicherte_fakten: fakten },
        fragen: qs,
    };
}

// ---- feedback of one question ----------------------------------------------------------

function versuche(entry) {
    if (!entry || typeof entry !== 'object' || entry.state !== 'done') return [];
    return [...(Array.isArray(entry.frueher) ? entry.frueher : []), entry].filter((a) => a && a.result);
}
const mitKriterien = (a) => a.result?.zustand !== 'nicht_verfuegbar' && Array.isArray(a.result?.kriterien) && a.result.kriterien.length > 0;

// ---- input for the model ----------------------------------------------------------------

function mischen(liste, random) {
    const a = [...liste];
    for (let i = a.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/** Every name part of the class, longest first: whoever signs with a name, it is masked. */
function namenMaskieren(text, namen) {
    let out = String(text || '');
    for (const n of namen) out = maskOwnName(out, n).text;
    return out;
}

/**
 * Builds what goes to the model and the mapping pseudonym → uid that stays here.
 *   members: [{ uid, name }] (roster), drafts: Map(uid → draft of this sub), usage: Map(uid → formativUsage doc)
 */
function eingabeBauen({ assignment, subId, members, drafts, usage, random = Math.random }) {
    const gefunden = fragenDerKarte(assignment, subId);
    if (!gefunden) throw new AnalyseFehler('Diese Karte gibt es im Auftrag nicht.', 'not_found');
    const { fragen } = gefunden;
    const { karte, fragen: fragenModell } = karteBauen(assignment, subId);
    const namen = members.map((m) => m.name).filter(Boolean);

    let begonnen = 0;
    const fertig = [];
    for (const m of members) {
        const d = drafts.get(m.uid);
        if (istBegonnen(d, fragen)) begonnen += 1;
        if (istAbgeschlossen(d, fragen)) fertig.push(m.uid);
    }
    const pseudonyme = new Map();      // pseudonym → uid (never leaves the function)
    const antwortenNachPseudonym = new Map();
    const lernende = mischen(fertig, random).map((uid, i) => {
        const p = `L${String(i + 1).padStart(2, '0')}`;
        pseudonyme.set(p, uid);
        const a = antwortenVon(drafts.get(uid));
        const slots = usage.get(uid)?.slots || {};
        const texte = [];
        const antworten = fragen.map((q) => {
            const antwort = namenMaskieren(htmlToText(a.get(q.id)), namen).slice(0, MAX_ANTWORT);
            texte.push(antwort);
            const vs = versuche(Object.prototype.hasOwnProperty.call(slots, slotKey(subId, q.id)) ? slots[slotKey(subId, q.id)] : null);
            const bewertet = vs.filter(mitKriterien);
            const erste = bewertet[0], letzte = bewertet[bewertet.length - 1];
            const kriterien = letzte ? letzte.result.kriterien.filter((k) => k && typeof k.id === 'string').map((k) => ({
                id: k.id,
                erste: erste.result.kriterien.find((x) => x.id === k.id)?.status ?? null,
                letzte: k.status ?? null,
                hinweis_letzte: k.hinweis ? namenMaskieren(String(k.hinweis), namen).slice(0, MAX_HINWEIS) : null,
            })) : [];
            return { frage: q.id, antwort, rueckmeldungen: vs.length, kriterien };
        });
        antwortenNachPseudonym.set(p, texte);
        return { pseudonym: p, antworten };
    });

    return {
        eingabe: {
            karte,
            fragen: fragenModell,
            klasse: { groesse: members.length, begonnen, abgeschlossen: fertig.length },
            lernende,
        },
        pseudonyme,
        antwortenNachPseudonym,
        basis: { klassengroesse: members.length, begonnen, abgeschlossen: fertig.length },
    };
}

// ---- prompt and schema --------------------------------------------------------------------

const SYSTEM = `Sie unterstützen eine Lehrperson der Berufsschule (Allgemeinbildung, Lernende 16–20 Jahre). Sie erhalten eine Lernkarte mit Fragen, Bewertungskriterien und Musterlösungen sowie die Antworten aller Lernenden, die die Karte abgeschlossen haben. Zu jeder Antwort steht, wie oft eine KI-Rückmeldung (formativ) geholt wurde und welchen Status jedes Kriterium in der ersten und in der letzten Rückmeldung hatte.

Ihre Aufgabe: eine Klassenanalyse für die Lehrperson, damit sie die nächste Lektion planen kann. Schreiben Sie Deutsch (Schweizer Rechtschreibung, «ss» statt «ß») und sprechen Sie die Lehrperson mit «Sie» an.

Regeln:
- Keine Noten, keine Punkte, keine Rangfolgen, keine Vergleiche, wer besser oder schlechter ist. Keine Urteile über Personen (nicht «ist faul», «ist schwach», «ist begabt»): Beschreiben Sie, was in den Antworten steht, nicht, wie jemand ist.
- Lernende heissen nur so, wie sie in der Eingabe stehen (L01, L02 …). Andere Bezeichnungen gibt es nicht. Nennen Sie Lernende nur in den Feldern «lernende»; in Freitexten (lage, beschreibung, plenum_impuls, ziel, auftrag, beobachtung, naechster_schritt, begruendung) keine Pseudonyme.
- Ein Zitat in «belege» ist ein wörtlicher Ausschnitt aus der Antwort genau dieser Person, höchstens 120 Zeichen, ohne Änderung, ohne Auslassungszeichen.
- «fragen» enthält Fragen-IDs aus der Eingabe, «kriterien» Kriterien in der Form «<Fragen-ID>/<Kriteriums-ID>», zum Beispiel «Q-1/k2».
- lage: 2–3 Sätze, wo die Klasse bei dieser Karte steht.
- muster: höchstens 4 Denkmuster oder Missverständnisse, die bei mehreren Lernenden vorkommen, mit Belegen und einem Impuls für das Plenum. Gelungenes gehört nicht hierher.
- gruppen: höchstens 3 Gruppen für eine Übung in der nächsten Lektion, mit Ziel und Auftrag.
- einzelne: höchstens 6 Lernende, die auffallen (zum Beispiel am Ziel vorbei, ein hartnäckiges Missverständnis, auffällig weit), mit Beobachtung und nächstem Schritt. Nur, wer wirklich auffällt.
- rueckmeldung_check: Fälle, in denen die KI-Rückmeldung (Status oder Hinweis der letzten Rückmeldung) nicht zur Antwort passt: zu_mild (erfüllt, obwohl es fehlt), zu_streng (fehlt, obwohl es da ist), irrefuehrend (Hinweis führt in die falsche Richtung) oder loesung_verraten (Hinweis nimmt die Lösung vorweg). Mit Begründung. Leer, wenn alles passt.
- gelungen: höchstens 4 Dinge, die der Klasse gut gelingen.
- Was die Daten nicht hergeben, lassen Sie weg. Lieber kurz und belegt als vollständig.`;

const S = (description) => ({ type: 'STRING', description });
const LISTE = (items, maxItems, description) => ({ type: 'ARRAY', items, maxItems, ...(description ? { description } : {}) });
const SCHEMA = {
    type: 'OBJECT',
    properties: {
        lage: S('2–3 Sätze zur Lage der Klasse bei dieser Karte'),
        muster: LISTE({
            type: 'OBJECT',
            properties: {
                titel: S('kurzer Titel des Musters'),
                beschreibung: S('was in den Antworten zu sehen ist'),
                kriterien: LISTE(S('<Fragen-ID>/<Kriteriums-ID>')),
                fragen: LISTE(S('Fragen-ID')),
                lernende: LISTE(S('Pseudonym L01 …')),
                belege: LISTE({
                    type: 'OBJECT',
                    properties: { lernende: S('Pseudonym'), zitat: S('wörtlich aus der Antwort, höchstens 120 Zeichen') },
                    required: ['lernende', 'zitat'],
                }, 4),
                plenum_impuls: S('Frage oder Impuls für das Plenum'),
            },
            required: ['titel', 'beschreibung', 'kriterien', 'fragen', 'lernende', 'belege', 'plenum_impuls'],
        }, GRENZEN.muster),
        gruppen: LISTE({
            type: 'OBJECT',
            properties: { ziel: S('Ziel der Gruppe'), lernende: LISTE(S('Pseudonym')), auftrag: S('Auftrag für die Gruppe') },
            required: ['ziel', 'lernende', 'auftrag'],
        }, GRENZEN.gruppen),
        einzelne: LISTE({
            type: 'OBJECT',
            properties: { lernende: S('Pseudonym'), beobachtung: S('was auffällt'), naechster_schritt: S('nächster Schritt') },
            required: ['lernende', 'beobachtung', 'naechster_schritt'],
        }, GRENZEN.einzelne),
        rueckmeldung_check: LISTE({
            type: 'OBJECT',
            properties: {
                lernende: S('Pseudonym'),
                frage: S('Fragen-ID'),
                kriterium: S('Kriteriums-ID, z. B. k2'),
                problem: { type: 'STRING', enum: PROBLEME },
                begruendung: S('warum die Rückmeldung nicht passt'),
            },
            required: ['lernende', 'frage', 'kriterium', 'problem', 'begruendung'],
        }, GRENZEN.rueckmeldung_check),
        gelungen: LISTE({
            type: 'OBJECT',
            properties: { beschreibung: S('was gelingt'), lernende: LISTE(S('Pseudonym')) },
            required: ['beschreibung', 'lernende'],
        }, GRENZEN.gelungen),
    },
    required: ['lage', 'muster', 'gruppen', 'einzelne', 'rueckmeldung_check', 'gelungen'],
};

function promptBauen(eingabe) {
    return {
        system: SYSTEM,
        user: `Daten der Karte und der Klasse (JSON):\n${JSON.stringify(eingabe)}`,
    };
}

// ---- model call ----------------------------------------------------------------------------

const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

async function geminiAufrufen({ system, user }, { apiKey, model, fetchFn = fetch, timeoutMs = 240000, baseUrl = GEMINI_URL }) {
    if (!apiKey) throw new AnalyseFehler('Die Klassenanalyse ist nicht eingerichtet (Schlüssel fehlt).', 'not_configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res;
    try {
        res = await fetchFn(`${baseUrl}/${encodeURIComponent(model)}:generateContent`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: 'user', parts: [{ text: user }] }],
                generationConfig: { temperature: 0.2, responseMimeType: 'application/json', responseSchema: SCHEMA, maxOutputTokens: 32768 },
            }),
            signal: controller.signal,
        });
    } catch (e) {
        throw new AnalyseFehler(e.name === 'AbortError' ? 'Das Modell hat nicht rechtzeitig geantwortet.' : 'Das Modell ist nicht erreichbar.', 'unavailable');
    } finally {
        clearTimeout(timer);
    }
    let data = null;
    try { data = await res.json(); } catch { /* empty */ }
    if (res.status === 429) throw new AnalyseFehler('Das Kontingent des Modells ist erschöpft.', 'quota');
    if (res.status !== 200 || !data) throw new AnalyseFehler(`Das Modell antwortet mit HTTP ${res.status}.`, 'unavailable');
    const cand = data.candidates?.[0];
    const text = (cand?.content?.parts || []).filter((p) => !p.thought && typeof p.text === 'string').map((p) => p.text).join('');
    const u = data.usageMetadata || {};
    const meta = {
        model_version: data.modelVersion || model,
        response_id: data.responseId || null,
        tokens: {
            eingabe: u.promptTokenCount ?? null,
            ausgabe: u.candidatesTokenCount ?? null,
            denken: u.thoughtsTokenCount ?? 0,
            gesamt: u.totalTokenCount ?? null,
        },
    };
    if (cand?.finishReason && cand.finishReason !== 'STOP') {
        const e = new AnalyseFehler(`Die Antwort des Modells ist unvollständig (${cand.finishReason}).`, 'unusable');
        e.meta = meta;
        throw e;
    }
    try {
        return { roh: JSON.parse(text), ...meta };
    } catch {
        const e = new AnalyseFehler('Die Antwort des Modells ist kein gültiges JSON.', 'unusable');
        e.meta = meta;
        throw e;
    }
}

// ---- checking the answer ------------------------------------------------------------------

const norm = (s) => String(s || '').replace(/[\s ]+/g, ' ').trim();
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const PSEUDO_RE = /\bL\d{2}\b/g;

/**
 * Keeps what the input allows and nothing else (CONTRACT: unknown pseudonyms and quotes
 * that are not verbatim in that person's answer are dropped), maps pseudonyms to uids and
 * returns the counts of what was dropped. Free text keeps a known pseudonym as {{uid:<uid>}}
 * (the page shows the name); an unknown one becomes «eine Person».
 */
function ergebnisPruefen(roh, { pseudonyme, antwortenNachPseudonym, fragen }) {
    const verworfen = { pseudonyme: 0, zitate: 0, fragen: 0, kriterien: 0 };
    const fragenIds = new Set(fragen.map((f) => f.id));
    const kriterienIds = new Set(fragen.flatMap((f) => f.rubrik.map((k) => `${f.id}/${k.id}`)));
    const uid = (p) => {
        const u = typeof p === 'string' ? pseudonyme.get(p.trim()) : undefined;
        if (!u) verworfen.pseudonyme += 1;
        return u;
    };
    const uids = (liste) => [...new Set((Array.isArray(liste) ? liste : []).map(uid).filter(Boolean))];
    const frei = (v, max) => text(v, max).replace(PSEUDO_RE, (p) => (pseudonyme.has(p) ? `{{uid:${pseudonyme.get(p)}}}` : 'eine Person'));
    const liste = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []).filter((x) => x && typeof x === 'object');
    const r = roh && typeof roh === 'object' ? roh : {};

    const muster = liste(r.muster, GRENZEN.muster).map((m) => ({
        titel: frei(m.titel, TEXT.titel),
        beschreibung: frei(m.beschreibung, TEXT.beschreibung),
        kriterien: (Array.isArray(m.kriterien) ? m.kriterien : []).filter((k) => {
            const ok = typeof k === 'string' && kriterienIds.has(k.trim());
            if (!ok) verworfen.kriterien += 1;
            return ok;
        }).map((k) => k.trim()),
        fragen: (Array.isArray(m.fragen) ? m.fragen : []).filter((f) => {
            const ok = typeof f === 'string' && fragenIds.has(f.trim());
            if (!ok) verworfen.fragen += 1;
            return ok;
        }).map((f) => f.trim()),
        lernende: uids(m.lernende),
        belege: liste(m.belege, 4).flatMap((b) => {
            const p = typeof b.lernende === 'string' ? b.lernende.trim() : '';
            const u = uid(p);
            if (!u) return [];
            const zitat = norm(b.zitat);
            const wörtlich = zitat.length > 0 && zitat.length <= MAX_ZITAT
                && (antwortenNachPseudonym.get(p) || []).some((a) => norm(a).includes(zitat));
            if (!wörtlich) { verworfen.zitate += 1; return []; }
            return [{ lernende: u, zitat }];
        }),
        plenum_impuls: frei(m.plenum_impuls, TEXT.plenum_impuls),
    })).filter((m) => m.titel);

    const gruppen = liste(r.gruppen, GRENZEN.gruppen).map((g) => ({
        ziel: frei(g.ziel, TEXT.ziel), lernende: uids(g.lernende), auftrag: frei(g.auftrag, TEXT.auftrag),
    })).filter((g) => g.lernende.length && g.ziel);

    const einzelne = liste(r.einzelne, GRENZEN.einzelne).flatMap((e) => {
        const u = uid(e.lernende);
        if (!u) return [];
        return [{ lernende: u, beobachtung: frei(e.beobachtung, TEXT.beobachtung), naechster_schritt: frei(e.naechster_schritt, TEXT.naechster_schritt) }];
    });

    const rueckmeldung_check = liste(r.rueckmeldung_check, GRENZEN.rueckmeldung_check).flatMap((c) => {
        const u = uid(c.lernende);
        if (!u) return [];
        const frage = text(c.frage, 200);
        const kriterium = text(c.kriterium, 64).replace(/^.*\//, '');
        if (!fragenIds.has(frage)) { verworfen.fragen += 1; return []; }
        if (!kriterienIds.has(`${frage}/${kriterium}`)) { verworfen.kriterien += 1; return []; }
        if (!PROBLEME.includes(c.problem)) return [];
        return [{ lernende: u, frage, kriterium, problem: c.problem, begruendung: frei(c.begruendung, TEXT.begruendung) }];
    });

    const gelungen = liste(r.gelungen, GRENZEN.gelungen).map((g) => ({
        beschreibung: frei(g.beschreibung, TEXT.beschreibung), lernende: uids(g.lernende),
    })).filter((g) => g.beschreibung);

    return { analyse: { lage: frei(r.lage, TEXT.lage), muster, gruppen, einzelne, rueckmeldung_check, gelungen }, verworfen };
}

// ---- lock and run ---------------------------------------------------------------------------

const alt = (iso, now) => !iso || now - Date.parse(iso) > LAUF_TTL_MS;

/**
 * Decides inside the transaction whether a run may start. `aktuell` is the stored document
 * (or null). Returns { ok, grund }.
 *   - a run is going (state 'laeuft', not older than LAUF_TTL_MS): never
 *   - auto: only if the number completed reached a higher step than the last analysis
 *     (5, 8, 11 …) and the last start is at least 10 minutes ago
 *   - manuell: at least 1 minute since the last start
 */
function darfStarten(aktuell, { modus, n, now }) {
    if (aktuell?.state === 'laeuft' && !alt(aktuell.laeuft_seit, now)) return { ok: false, grund: 'laeuft' };
    if (n < SCHWELLE) return { ok: false, grund: 'zu_wenige' };
    const gestartet = aktuell?.gestartet ? Date.parse(aktuell.gestartet) : 0;
    if (modus === 'auto') {
        if (stufe(n) <= stufe(aktuell?.basis?.abgeschlossen ?? 0)) return { ok: false, grund: 'schwelle' };
        if (gestartet && now - gestartet < PAUSE_AUTO_MS) return { ok: false, grund: 'pause' };
    } else if (gestartet && now - gestartet < PAUSE_MANUELL_MS) {
        return { ok: false, grund: 'pause' };
    }
    return { ok: true };
}

/**
 * One analysis, start to end. deps:
 *   loadAssignment(aid), loadMembers(classId) → [{uid, name}], loadDrafts(uids, aid, subId) → [draft],
 *   loadUsage(uids, aid) → Map(uid → doc), store { lesen(id), reservieren(id, entscheiden), schreiben(id, daten) },
 *   gemini { apiKey, model, fetchFn }, now(), random()
 * Returns { status: 'fertig' | 'uebersprungen', grund?, id, basis? }. Throws AnalyseFehler.
 */
async function analysieren({ classId, assignmentId, subId, modus, ausgeloest_von = null }, deps) {
    const now = deps.now ? deps.now() : Date.now();
    const id = analyseId(classId, assignmentId, subId);
    const assignment = await deps.loadAssignment(assignmentId);
    const gefunden = fragenDerKarte(assignment, subId);
    if (!gefunden) throw new AnalyseFehler('Diese Karte gibt es im Auftrag nicht.', 'not_found');
    const members = await deps.loadMembers(classId);
    if (!members.length) throw new AnalyseFehler('Die Klasse hat keine Lernenden.', 'not_found');
    const draftList = await deps.loadDrafts(members.map((m) => m.uid), assignmentId, subId);
    const erlaubt = new Set(members.map((m) => m.uid));
    const drafts = new Map(draftList
        .filter((d) => d && erlaubt.has(d.uid) && d.assignmentId === assignmentId && d.subId === subId)
        .map((d) => [d.uid, d]));
    const n = members.filter((m) => istAbgeschlossen(drafts.get(m.uid), gefunden.fragen)).length;

    const r = await deps.store.reservieren(id, (aktuell) => {
        const d = darfStarten(aktuell, { modus, n, now });
        if (!d.ok) return d;
        return {
            ok: true,
            daten: {
                classId, assignmentId, subId,
                state: 'laeuft', laeuft_seit: new Date(now).toISOString(), gestartet: new Date(now).toISOString(),
                ausloeser: modus, ausgeloest_von,
            },
        };
    });
    if (!r.ok) {
        if (modus === 'auto' || r.grund === 'schwelle') return { status: 'uebersprungen', grund: r.grund, id, n };
        const meldung = {
            laeuft: 'Die Analyse dieser Karte läuft gerade.',
            pause: 'Die Analyse wurde eben gestartet. Warten Sie eine Minute.',
            zu_wenige: `Die Analyse braucht ${SCHWELLE} Abgeschlossene (jetzt ${n}).`,
        }[r.grund];
        throw new AnalyseFehler(meldung, r.grund);
    }

    const start = deps.now ? deps.now() : Date.now();
    try {
        const fertigUids = members.filter((m) => istAbgeschlossen(drafts.get(m.uid), gefunden.fragen)).map((m) => m.uid);
        const usage = await deps.loadUsage(fertigUids, assignmentId);
        const ein = eingabeBauen({ assignment, subId, members, drafts, usage, random: deps.random || Math.random });
        const antwort = await geminiAufrufen(promptBauen(ein.eingabe), deps.gemini);
        const { analyse, verworfen } = ergebnisPruefen(antwort.roh, { ...ein, fragen: ein.eingabe.fragen });
        const ende = deps.now ? deps.now() : Date.now();
        await deps.store.schreiben(id, {
            state: 'fertig', laeuft_seit: null,
            analyse, verworfen, basis: ein.basis,
            erstellt: new Date(ende).toISOString(), dauer_ms: ende - start,
            modell: deps.gemini.model, model_version: antwort.model_version, response_id: antwort.response_id, tokens: antwort.tokens,
            fehler: null,
        });
        return { status: 'fertig', id, basis: ein.basis };
    } catch (e) {
        const ende = deps.now ? deps.now() : Date.now();
        // The previous analysis stays; the document says that this run failed.
        await deps.store.schreiben(id, {
            state: 'fehler', laeuft_seit: null,
            fehler: { code: e.code || 'internal', at: new Date(ende).toISOString(), ...(e.meta ? { model_version: e.meta.model_version, tokens: e.meta.tokens } : {}) },
        });
        throw e instanceof AnalyseFehler ? e : new AnalyseFehler('Die Analyse ist fehlgeschlagen.', 'internal');
    }
}

/**
 * Trigger on drafts/{id}: start an automatic analysis for each class of the student when
 * this write leaves the sub-assignment completed and the assignment has `klassenanalyse: true`.
 * Cheap exits first: no flag, not completed, a run going or the 10-minute pause.
 */
async function beiDraft(after, deps) {
    if (!after || typeof after.uid !== 'string' || typeof after.assignmentId !== 'string' || typeof after.subId !== 'string') return [];
    const assignment = await deps.loadAssignment(after.assignmentId);
    if (assignment?.klassenanalyse !== true) return [];
    const gefunden = fragenDerKarte(assignment, after.subId);
    if (!gefunden || !istAbgeschlossen(after, gefunden.fragen)) return [];
    const classes = await deps.loadStudentClasses(after.uid);
    const now = deps.now ? deps.now() : Date.now();
    const out = [];
    for (const classId of classes) {
        const id = analyseId(classId, after.assignmentId, after.subId);
        const aktuell = await deps.store.lesen(id);
        const gestartet = aktuell?.gestartet ? Date.parse(aktuell.gestartet) : 0;
        if ((aktuell?.state === 'laeuft' && !alt(aktuell.laeuft_seit, now)) || (gestartet && now - gestartet < PAUSE_AUTO_MS)) {
            out.push({ status: 'uebersprungen', grund: aktuell?.state === 'laeuft' ? 'laeuft' : 'pause', id });
            continue;
        }
        try {
            out.push(await analysieren({ classId, assignmentId: after.assignmentId, subId: after.subId, modus: 'auto' }, deps));
        } catch (e) {
            out.push({ status: 'fehler', code: e.code, id });
        }
    }
    return out;
}

// ---- Firestore wiring ------------------------------------------------------------------------

/** Dependencies on the real databases. rosterDb = (default), boxDb = lmsbox (Admin SDK). */
function firestoreDeps({ rosterDb, boxDb, gemini }) {
    const IN_LIMIT = 30;
    const chunks = (list) => { const out = []; for (let i = 0; i < list.length; i += IN_LIMIT) out.push(list.slice(i, i + IN_LIMIT)); return out; };
    const cache = new Map();   // assignment docs for one minute per instance (the trigger runs on every draft write)
    return {
        gemini,
        async loadAssignment(aid) {
            const hit = cache.get(aid);
            if (hit && Date.now() - hit.at < 60000) return hit.data;
            const data = (await boxDb.doc(`assignments/${enc(aid)}`).get()).data() ?? null;
            cache.set(aid, { at: Date.now(), data });
            return data;
        },
        async loadMembers(classId) {
            const [a, b] = await Promise.all([
                rosterDb.collection('students').where('classIds', 'array-contains', classId).get(),
                rosterDb.collection('students').where('classId', '==', classId).get(),
            ]);
            const byUid = new Map();
            for (const d of [...a.docs, ...b.docs]) {
                const s = d.data();
                const classes = Array.isArray(s.classIds) && s.classIds.length ? s.classIds : [s.classId];
                if (!classes.includes(classId)) continue;   // same rule as the dashboard (classIds wins over classId)
                byUid.set(d.id, { uid: d.id, name: String(s.name || s.username || '') });
            }
            return [...byUid.values()];
        },
        async loadStudentClasses(uid) {
            const s = (await rosterDb.doc(`students/${uid}`).get()).data();
            if (!s || s.active === false) return [];
            const classes = Array.isArray(s.classIds) && s.classIds.length ? s.classIds : [s.classId];
            return classes.filter((c) => typeof c === 'string' && c);
        },
        async loadDrafts(uids, aid, subId) {
            const out = [];
            for (const c of chunks(uids)) {
                const snap = await boxDb.collection('drafts').where('uid', 'in', c).where('assignmentId', '==', aid).where('subId', '==', subId).get();
                snap.forEach((d) => out.push(d.data()));
            }
            return out;
        },
        async loadUsage(uids, aid) {
            const out = new Map();
            if (!uids.length) return out;
            const refs = uids.map((u) => boxDb.doc(`formativUsage/${u}__${enc(aid)}`));
            const snaps = await boxDb.getAll(...refs);
            snaps.forEach((s, i) => { if (s.exists) out.set(uids[i], s.data()); });
            return out;
        },
        store: {
            async lesen(id) {
                const s = await boxDb.doc(`${COLLECTION}/${id}`).get();
                return s.exists ? s.data() : null;
            },
            async reservieren(id, entscheiden) {
                const ref = boxDb.doc(`${COLLECTION}/${id}`);
                return boxDb.runTransaction(async (tx) => {
                    const s = await tx.get(ref);
                    const r = entscheiden(s.exists ? s.data() : null);
                    if (r.ok) tx.set(ref, r.daten, { merge: true });
                    return r;
                });
            },
            async schreiben(id, daten) {
                await boxDb.doc(`${COLLECTION}/${id}`).set(daten, { merge: true });
            },
        },
    };
}

module.exports = {
    COLLECTION, SCHWELLE, SCHRITT, PAUSE_AUTO_MS, PAUSE_MANUELL_MS, LAUF_TTL_MS, MAX_ANTWORT, SCHEMA, SYSTEM, PROBLEME,
    AnalyseFehler, analyseId, istAntwort, istAbgeschlossen, stufe, kontextTeile, karteBauen,
    eingabeBauen, promptBauen, geminiAufrufen, ergebnisPruefen, darfStarten, analysieren, beiDraft, firestoreDeps,
};
