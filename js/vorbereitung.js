//
//  js/vorbereitung.js — Vorbereitungsseite für Lehrpersonen (vorbereitung.html).
//  Vertrag: backend/CONTRACT.md, «Teacher materials (teacherMaterials, preparation page)».
//
//  - teacherMaterials wird nur gelesen, wenn das ID-Token role == "teacher" trägt. Gast und
//    Konten ohne diese Rolle sehen nur den Hinweis; die Seite stellt dann KEINE Anfrage an
//    teacherMaterials (die Regeln würden sie ohnehin abweisen).
//  - Die Seite rechnet im Browser und speichert nichts. Einzige Merkhilfe: die zuletzt
//    gewählte Einheit in localStorage. Kein Sprachmodell.
//  - Alles aus den Daten geht als Text ins DOM (textContent / createElement), nie als HTML.
//  - Ids S, M, L bleiben intern; angezeigt werden die Namen aus hpTeacher.wege (Invariante 13).
//    Zeitspannen nur aus hpTeacher.wege.zeit_spanne_min — die Seite erfindet keine eigenen.
//
import { auth, db, onAuthStateChanged, collection, getDocs } from './firebase.js';
import { signIn, signOut } from './api.js';

const PFADE = ['S', 'M', 'L'];            // von schmal nach breit (Ids, nie angezeigt)
// Wahl-Buttons (26.10.2026): zwei von drei zur Wahl, Vorwahl-Link «#hp=S,M» (publish.js der Site)
const PAARE = ['S,M', 'M,L', 'S,L'];
const wegeVon = (v) => (v === 'frei' ? PFADE : String(v).split(','));
const LEKTION_MIN = 45;
// Wie tools/render_eb_page.py: SITE und Adresse der Vorwahl-Links (Leerzeichen als +, «#hp=…»)
const SITE = 'https://zh.abu-hko.ch';
// weiterentwicklung-paket/kurzlinks/SCHEMA.md: Einheits-Code = Einheitsnummer ohne Punkte, 3 Ziffern
const KURZ_HOST = 'https://abu-hko.ch';
const MERK_KEY = 'lmsbox-vorbereitung-einheit';

const $ = (id) => document.getElementById(id);

// ---- kleine DOM-Helfer (nur Text) -----------------------------------------------------------

function el(tag, attrs = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else n.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) if (kid != null) n.append(kid instanceof Node ? kid : String(kid));
    return n;
}

/** Text mit **fett** als <strong>, sonst reiner Text; Absätze an Leerzeilen. */
function richText(text) {
    const frag = document.createDocumentFragment();
    for (const absatz of String(text ?? '').split(/\n{2,}/)) {
        if (!absatz.trim()) continue;
        const p = el('p');
        absatz.split(/(\*\*[^*]+\*\*)/).forEach((teil) => {
            if (/^\*\*[^*]+\*\*$/.test(teil)) p.append(el('strong', { text: teil.slice(2, -2) }));
            else if (teil) p.append(teil);
        });
        frag.append(p);
    }
    return frag;
}

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));
const nr = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ---- Daten einer Einheit -----------------------------------------------------------------

/** Anzeigename einer Variante, nur aus hpTeacher.wege. */
function name(m, p) {
    return str(m.hpTeacher?.wege?.anzeige_lehrperson?.[p]) || `Variante ${p}`;
}

/** Anzeige einer Auswahl: eine Variante oder «Wahl zwischen … und …». */
function auswahlName(m, v) {
    const w = wegeVon(v);
    return w.length === 2 ? `Wahl zwischen ${name(m, w[0])} und ${name(m, w[1])}` : name(m, w[0]);
}

/** [unten, oben] in Minuten aus hpTeacher.wege.zeit_spanne_min, oder null. */
function spanne(m, p) {
    const s = m.hpTeacher?.wege?.zeit_spanne_min?.[p];
    return Array.isArray(s) && s.length === 2 && s.every((x) => Number.isFinite(Number(x))) ? [Number(s[0]), Number(s[1])] : null;
}

/** «{heft:<id>}» (Platzhalter in lehrperson-karten.json) als Fundort, wie ihn die Daten kennen. */
function setzeHeft(text, m) {
    return str(text).replace(/\{heft:([a-z0-9.\-]+)\}/g, (_, id) => {
        const h = m.hpTeacher?.heft?.bausteine?.[id];
        if (h && h.seite != null) return `Heft S. ${h.seite}`;
        const v = (m.vollfassung || []).find((x) => x.id === id);
        if (v) return `Vollfassung für Lehrpersonen${v.webcode ? `, Webcode ${v.webcode}` : ''}`;
        if (h && h.webcode) return `Webcode ${h.webcode}`;
        return `Baustein «${id}»`;
    });
}

function vorwahlBasis(m) {
    const lb = str(m.hpTeacher?.situation?.lebensbezug);
    const aid = str(m.assignmentId);
    if (!/^\d+\.\d+$/.test(lb) || !aid) return null;
    return `${SITE}/T${lb.split('.')[0]}/${lb}/${quotePlus(aid)}`;
}

/** Python urllib.parse.quote_plus: nur A–Z a–z 0–9 _ . - ~ bleiben, Leerzeichen wird +. */
function quotePlus(s) {
    return encodeURIComponent(s)
        .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
        .replace(/%20/g, '+');
}

function kurzlink(m) {
    const k = /(\d)\.(\d)\.(\d)$/.exec(str(m.einheitId));
    return k ? `${KURZ_HOST}/${k[1]}${k[2]}${k[3]}` : null;
}

/**
 * Passt die Variante in die verfügbaren Minuten? Massstab ist die Obergrenze der Spanne.
 * Wenn nicht: die nächst schmalere Variante, deren Obergrenze passt (bei «frei» von der breitesten
 * abwärts), sonst keine.
 */
function passung(m, variante, minuten) {
    const wege = wegeVon(variante);
    const sp = wege.length > 1
        ? (() => {
            const alle = wege.map((p) => spanne(m, p)).filter(Boolean);
            return alle.length ? [Math.min(...alle.map((s) => s[0])), Math.max(...alle.map((s) => s[1]))] : null;
        })()
        : spanne(m, variante);
    if (!sp) return { sp: null, passt: null, vorschlag: null };
    if (sp[1] <= minuten) return { sp, passt: true, vorschlag: null };
    // bei mehreren Wegen: von der breitesten der Auswahl abwärts (die breiteste selbst passt nicht)
    const breiteste = wege[wege.length - 1];
    const kandidaten = variante === 'frei' ? [...PFADE].reverse() : PFADE.slice(0, PFADE.indexOf(breiteste)).reverse();
    const vorschlag = kandidaten.find((p) => { const s = spanne(m, p); return s && s[1] <= minuten; }) || null;
    return { sp, passt: false, vorschlag };
}

function datumText(iso) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso || '')) return 'ohne Datum';
    const [y, mo, d] = iso.split('-').map(Number);
    return new Date(y, mo - 1, d).toLocaleDateString('de-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

/** Ablaufschritte mit Minuten-Fenstern; «Lektion n:» am Anfang beginnt die Zählung neu. */
function fenster(schritte) {
    let lektion = null, t = 0;
    return (Array.isArray(schritte) ? schritte : []).map((s) => {
        const text = str(s?.schritt);
        const l = /^Lektion\s+(\d+)/.exec(text);
        if (l && l[1] !== lektion) { lektion = l[1]; t = 0; }
        const min = nr(s?.min);
        const von = t; t += min;
        return { lektion, von, bis: t, min, text };
    });
}

// ---- Zustand ----------------------------------------------------------------------------------

const materialien = new Map();   // einheitId -> Dokument
let geladen = false;

function auswahl() {
    const m = materialien.get($('vb-einheit').value);
    const klasse = document.querySelector('input[name="vb-klasse"]:checked')?.value || '4J';
    const lektionen = Math.max(1, Math.min(20, Math.round(nr($('vb-lektionen').value)) || 1));
    return { m, klasse, datum: $('vb-datum').value, lektionen, minuten: lektionen * LEKTION_MIN, variante: $('vb-variante').value || 'frei' };
}

function variantenOptionen(m) {
    const sel = $('vb-variante');
    const vorher = sel.value || 'frei';
    sel.replaceChildren(
        ...PFADE.map((p) => {
            const s = spanne(m, p);
            return el('option', { value: p, text: `${name(m, p)}${s ? ` – ca. ${s[0]}–${s[1]} min` : ''}` });
        }),
        ...PAARE.map((v) => el('option', { value: v, text: `${auswahlName(m, v)} – die Lernenden wählen zwischen diesen zwei` })),
        el('option', { value: 'frei', text: 'frei – jede Person wählt ihren Weg' }),
    );
    sel.value = [...PFADE, ...PAARE, 'frei'].includes(vorher) ? vorher : 'frei';
}

// ---- Ausgabe ------------------------------------------------------------------------------------

function kopfzeile(a) {
    const v = a.variante === 'frei' ? 'frei (jede Person wählt)' : auswahlName(a.m, a.variante);
    return `Klasse ${a.klasse} · ${datumText(a.datum)} · ${a.lektionen} ${a.lektionen === 1 ? 'Lektion' : 'Lektionen'} à 45 min (${a.minuten} min) · ${v}`;
}

function passungsBlock(a) {
    const { m, variante, minuten, lektionen } = a;
    const r = passung(m, variante, minuten);
    const wege = wegeVon(variante);
    const wer = variante === 'frei' ? 'alle drei Varianten (frei)'
        : wege.length === 2 ? `die ${name(m, wege[0])} und die ${name(m, wege[1])} (zur Wahl)` : `die ${name(m, variante)}`;
    if (!r.sp) return el('p', { class: 'vb-fit vb-fit-no', 'data-fit': 'unbekannt', text: 'Für diese Einheit ist keine Zeitspanne hinterlegt.' });
    if (r.passt) {
        return el('p', { class: 'vb-fit vb-fit-ok', 'data-fit': 'passt',
            text: `Passt: Die Schätzung für ${wer} liegt bei ca. ${r.sp[0]}–${r.sp[1]} min. Du hast ${lektionen} × 45 = ${minuten} min.` });
    }
    const box = el('div', { class: 'vb-fit vb-fit-no', 'data-fit': r.vorschlag ? 'vorschlag' : 'keine' });
    box.append(el('p', { text: `Passt nicht sicher: Die obere Schätzung für ${wer} (${r.sp[1]} min) ist grösser als deine ${minuten} min (${lektionen} × 45).` }));
    if (r.vorschlag) {
        const s = spanne(m, r.vorschlag);
        box.append(el('p', { 'data-vorschlag': r.vorschlag,
            text: `Vorschlag: die ${name(m, r.vorschlag)} (ca. ${s[0]}–${s[1]} min) passt in ${lektionen} ${lektionen === 1 ? 'Lektion' : 'Lektionen'}.` }));
        box.append(el('button', { type: 'button', class: 'vb-small', text: `${name(m, r.vorschlag)} übernehmen`,
            onclick: () => { $('vb-variante').value = r.vorschlag; zeichne(); } }));
    } else {
        const noetig = Math.ceil(r.sp[1] / LEKTION_MIN);
        box.append(el('p', { text: variante === 'frei' || variante === 'S'
            ? `Keine schmalere Variante passt in ${minuten} min. Nach der Schätzung brauchst du ${noetig} Lektionen.`
            : `Keine schmalere Variante passt in ${minuten} min. Für ${wer} brauchst du nach der Schätzung ${noetig} Lektionen.` }));
    }
    return box;
}

function spannenTabelle(a) {
    const { m, variante } = a;
    const t = el('table', { class: 'vb-table' },
        el('thead', {}, el('tr', {}, el('th', { text: 'Variante' }), el('th', { text: 'Zeit für die digitale Einheit (Schätzung)' }))));
    const tb = el('tbody');
    for (const p of PFADE) {
        const s = spanne(m, p);
        tb.append(el('tr', { class: variante !== 'frei' && wegeVon(variante).includes(p) ? 'vb-gewaehlt' : null },
            el('td', { text: name(m, p) }), el('td', { text: s ? `ca. ${s[0]}–${s[1]} min` : '–' })));
    }
    t.append(tb);
    return t;
}

function ablaufListe(schritte, m) {
    const ol = el('ol', { class: 'vb-ablauf' });
    for (const s of fenster(schritte)) {
        const zeit = s.min === 0 ? 'Hinweis' : `${s.lektion ? `L${s.lektion} · ` : ''}Min. ${s.von}–${s.bis}`;
        ol.append(el('li', {}, el('span', { class: 'vb-zeit', text: zeit }), el('span', { text: setzeHeft(s.text, m) })));
    }
    return ol;
}

function startListe(m) {
    const ol = el('ol', { class: 'vb-ablauf' });
    for (const s of Array.isArray(m.lehrpersonKarten?.start_im_unterricht) ? m.lehrpersonKarten.start_im_unterricht : []) {
        const min = nr(s?.min);
        ol.append(el('li', {}, el('span', { class: 'vb-zeit', text: min ? `${min} min` : 'Hinweis' }), el('span', { text: setzeHeft(s?.schritt, m) })));
    }
    return ol;
}

function karte(m, p) {
    // hpTeacher.karten trägt die Fundorte schon eingesetzt; lehrperson-karten.json als Rückfall
    return m.hpTeacher?.karten?.[p] || m.lehrpersonKarten?.karten?.[p] || null;
}

function kartenBlock(a, mitTitel = true) {
    const { m, variante } = a;
    const wege = wegeVon(variante);
    const wrap = el('div');
    for (const p of wege) {
        const k = karte(m, p);
        if (!k) continue;
        if (mitTitel) wrap.append(el('h4', { text: `${name(m, p)}: ${setzeHeft(k.titel, m)}` }));
        if (k.zeit_unterricht) wrap.append(el('p', { class: 'vb-muted', text: setzeHeft(k.zeit_unterricht, m) }));
        wrap.append(ablaufListe(k.ablauf, m));
    }
    return wrap;
}

function heftHinweis(a) {
    return a.klasse === '3J'
        ? el('p', { class: 'vb-muted', text: 'Seitenzahlen nach dem Heft 4J. Im Heft 3J können sie abweichen; der Webcode gilt in beiden.' })
        : null;
}

function zeichnePlan(a) {
    const { m } = a;
    const w = m.hpTeacher?.wege || {};
    const sec = $('vb-plan');
    sec.replaceChildren(...[
        el('h2', { id: 'vb-plan-h', text: `Ablauf: ${str(m.assignmentId) || str(m.einheitId)}` }),
        el('p', { class: 'vb-meta', text: kopfzeile(a) }),
        el('h3', { text: `1 · Digitale Einheit (ab ${datumText(a.datum)})` }),
        w.formel ? el('p', { text: str(w.formel) }) : null,
        spannenTabelle(a),
        el('p', { class: 'vb-muted', text: str(w.zeit_hinweis) || 'Schätzung' }),
        passungsBlock(a),
        el('h3', { text: '2 · Danach im Unterricht' }),
        m.lehrpersonKarten?.zeitmodell ? el('p', { text: setzeHeft(m.lehrpersonKarten.zeitmodell, m) }) : null,
        el('h4', { text: 'Start in der ersten Lektion' }),
        startListe(m),
        kartenBlock(a),
        heftHinweis(a),
        el('p', { class: 'vb-muted', text: 'Den Abgabetermin setzt du; die Seite schlägt keinen vor.' }),
    ].filter(Boolean));
}

function linkZeile(label, url, hinweis, id) {
    const input = el('input', { type: 'text', readonly: true, value: url, class: 'vb-url', id, 'aria-label': label });
    const status = el('span', { class: 'vb-copied', role: 'status' });
    const btn = el('button', { type: 'button', class: 'vb-small', text: 'Kopieren', onclick: async () => {
        try { await navigator.clipboard.writeText(url); status.textContent = 'Kopiert'; } catch {
            input.focus(); input.select(); status.textContent = 'Markiert – mit Ctrl+C kopieren';
        }
        setTimeout(() => { status.textContent = ''; }, 2500);
    } });
    return el('div', { class: 'vb-link' }, el('div', { class: 'vb-link-label', text: label }),
        el('div', { class: 'vb-link-row' }, input, btn, status), hinweis ? el('p', { class: 'vb-muted', text: hinweis }) : null);
}

function zeichneLinks(a) {
    const { m, variante } = a;
    const basis = vorwahlBasis(m);
    const kurz = kurzlink(m);
    const sec = $('vb-links');
    sec.replaceChildren(el('h2', { text: 'Links für die Klasse' }));
    if (basis) {
        const vorwahl = `${basis}#hp=${variante}`;
        const zwei = wegeVon(variante).length === 2;
        sec.append(linkZeile(
            variante === 'frei' ? 'Vorwahl-Link: frei wählen' : `Vorwahl-Link: ${auswahlName(m, variante)}`,
            vorwahl,
            variante === 'frei'
                ? 'Hebt eine frühere Vorwahl auf; die Lernenden wählen ihren Weg selbst.'
                : zwei
                    ? 'Die Lernenden sehen nur die Knöpfe dieser zwei Wege und wählen zwischen ihnen. Die Vorwahl gilt im Browser der Lernenden, bis sie den Link «frei wählen» öffnen.'
                    : 'Die Einheit zeigt dann nur diesen Weg; die Lernenden können ihn nicht ändern. Die Vorwahl gilt im Browser der Lernenden, bis sie den Link «frei wählen» öffnen.',
            'vb-link-vorwahl'));
        if (variante !== 'frei') {
            sec.append(linkZeile('Vorwahl-Link: frei wählen', `${basis}#hp=frei`,
                'Hebt die Vorwahl wieder auf. Auf der Einheit selbst stehen die Vorwahl-Links nicht, solange eine Vorwahl gilt.',
                'vb-link-frei'));
        }
    } else {
        sec.append(el('p', { class: 'vb-muted', text: 'Für diese Einheit fehlt die Adresse der Einheit.' }));
    }
    if (kurz) sec.append(linkZeile('Kurzlink (fürs Heft und zum Abtippen)', kurz, 'Der Kurzlink setzt keine Vorwahl: Er öffnet die Startseite der Einheit, die Lernenden wählen selbst.', 'vb-link-kurz'));
}

function zeichneHandout(a) {
    const { m } = a;
    const jig = m.hpTeacher?.jigsaw_plan_b || m.lehrpersonKarten?.jigsaw_plan_b || null;
    const h = $('vb-handout');
    const kids = [
        el('h3', { class: 'vb-ho-title', text: str(m.assignmentId) || str(m.einheitId) }),
        el('p', { class: 'vb-meta', text: kopfzeile(a) }),
        el('h4', { text: 'Ablauf' }),
    ];
    const r = passung(m, a.variante, a.minuten);
    kids.push(el('p', { text: r.sp
        ? `Digitale Einheit: ca. ${r.sp[0]}–${r.sp[1]} min (${str(m.hpTeacher?.wege?.zeit_hinweis) || 'Schätzung'}), geplant ${a.lektionen} × 45 min.`
        : `Digitale Einheit: geplant ${a.lektionen} × 45 min.` }));
    kids.push(kartenBlock(a));
    kids.push(el('h4', { text: 'Regeln für den Start' }), startListe(m));
    if (jig) {
        kids.push(el('h4', { text: 'Jigsaw-Plan B' }));
        if (jig.wann) kids.push(el('p', { text: setzeHeft(jig.wann, m) }));
        if (Array.isArray(jig.ablauf)) kids.push(ablaufListe(jig.ablauf, m));
        if (jig.gruppen && typeof jig.gruppen === 'object') {
            const ul = el('ul');
            for (const p of PFADE) if (jig.gruppen[p]) ul.append(el('li', {}, el('strong', { text: `${name(m, p)}: ` }), setzeHeft(jig.gruppen[p], m)));
            kids.push(ul);
        }
        if (jig.wenn_eine_gruppe_fehlt) kids.push(el('p', {}, el('strong', { text: 'Wenn eine Gruppe fehlt: ' }), setzeHeft(jig.wenn_eine_gruppe_fehlt, m)));
    }
    const hh = heftHinweis(a);
    if (hh) kids.push(hh);
    h.replaceChildren(...kids);
}

function zeichneVollfassung(a) {
    const liste = Array.isArray(a.m.vollfassung) ? a.m.vollfassung : [];
    const sec = $('vb-voll');
    sec.replaceChildren(el('h2', { text: 'Vollfassung für Lehrpersonen' }));
    if (!liste.length) {
        sec.append(el('p', { class: 'vb-muted', text: 'Diese Einheit braucht keine Bausteine aus der Vollfassung: Alles steht im Heft.' }));
        return;
    }
    sec.append(el('p', { class: 'vb-muted', text: `${liste.length} ${liste.length === 1 ? 'Baustein steht' : 'Bausteine stehen'} nicht im Heft. Die Lernenden bekommen den Text von dir.` }));
    for (const v of liste) {
        sec.append(el('details', { class: 'vb-baustein', 'data-id': str(v.id) },
            el('summary', { text: `${str(v.titel)}${v.webcode ? ` · ${v.webcode}` : ''}` }),
            el('div', { class: 'vb-text' }, richText(v.text))));
    }
}

function zeichne() {
    const a = auswahl();
    if (!a.m) return;
    try { localStorage.setItem(MERK_KEY, a.m.einheitId); } catch { /* Merkhilfe ist freiwillig */ }
    zeichnePlan(a);
    zeichneLinks(a);
    zeichneHandout(a);
    zeichneVollfassung(a);
}

// ---- Laden (nur Lehrperson) ---------------------------------------------------------------------

async function ladeEinheiten() {
    if (geladen) return;
    geladen = true;
    $('vb-load-status').textContent = 'Einheiten werden geladen …';
    try {
        const snap = await getDocs(collection(db, 'teacherMaterials'));
        snap.forEach((d) => { const v = d.data(); if (v && typeof v.einheitId === 'string') materialien.set(v.einheitId, v); });
    } catch (e) {
        $('vb-load-status').textContent = 'Die Einheiten konnten nicht geladen werden. Lade die Seite neu.';
        console.error('[vorbereitung]', e);
        return;
    }
    const ids = [...materialien.keys()].sort((x, y) => x.localeCompare(y, 'de', { numeric: true }));
    if (!ids.length) { $('vb-load-status').textContent = 'Es sind noch keine Einheiten hochgeladen.'; return; }
    $('vb-load-status').textContent = '';
    $('vb-einheit').replaceChildren(...ids.map((id) => {
        const m = materialien.get(id);
        return el('option', { value: id, text: str(m.assignmentId) || id });
    }));
    let merk = null;
    try { merk = localStorage.getItem(MERK_KEY); } catch { /* ohne Merkhilfe */ }
    if (merk && materialien.has(merk)) $('vb-einheit').value = merk;
    variantenOptionen(materialien.get($('vb-einheit').value));
    zeichne();
}

function initForm() {
    const heute = new Date();
    $('vb-datum').value = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, '0')}-${String(heute.getDate()).padStart(2, '0')}`;
    $('vb-form').addEventListener('submit', (e) => e.preventDefault());
    $('vb-einheit').addEventListener('change', () => { variantenOptionen(materialien.get($('vb-einheit').value)); zeichne(); });
    for (const id of ['vb-datum', 'vb-lektionen', 'vb-variante']) $(id).addEventListener('input', zeichne);
    $('vb-variante').addEventListener('change', zeichne);
    for (const r of document.querySelectorAll('input[name="vb-klasse"]')) r.addEventListener('change', zeichne);
    $('vb-print').addEventListener('click', () => {
        document.body.classList.add('vb-druck');
        window.print();
    });
    window.addEventListener('afterprint', () => document.body.classList.remove('vb-druck'));
}

// ---- Anmeldung ----------------------------------------------------------------------------------

const LOGIN_FEHLER = {
    'auth/invalid-credential': 'Benutzername oder Passwort ist falsch.',
    'auth/wrong-password': 'Benutzername oder Passwort ist falsch.',
    'auth/user-not-found': 'Benutzername oder Passwort ist falsch.',
    'auth/invalid-email': 'Benutzername oder Passwort ist falsch.',
    'auth/user-disabled': 'Dieses Konto ist gesperrt.',
    'auth/too-many-requests': 'Zu viele Versuche. Warte einen Moment und versuche es nochmals.',
    'auth/network-request-failed': 'Keine Verbindung. Prüfe dein Internet und versuche es nochmals.',
};

function zeigeGate(user) {
    $('vb-wait').hidden = true;
    $('vb-app').hidden = true;
    $('vb-gate').hidden = false;
    const who = $('vb-gate-who');
    if (user) {
        who.hidden = false;
        who.textContent = `Du bist als ${user.email || 'Konto ohne E-Mail'} angemeldet. Dieses Konto hat keine Lehrpersonen-Rolle.`;
        $('vb-gate-logout').hidden = false;
        $('vb-login').hidden = true;
    } else {
        who.hidden = true;
        $('vb-gate-logout').hidden = true;
        $('vb-login').hidden = false;
    }
    $('vb-account').textContent = '';
}

function zeigeApp(user) {
    $('vb-wait').hidden = true;
    $('vb-gate').hidden = true;
    $('vb-app').hidden = false;
    $('vb-account').replaceChildren(
        el('span', { text: user.email || '' }), ' ',
        el('button', { type: 'button', class: 'vb-small', text: 'Abmelden', onclick: () => signOut() }));
    ladeEinheiten();
}

function initLogin() {
    $('vb-login').addEventListener('submit', async (e) => {
        e.preventDefault();
        const status = $('vb-login-status');
        const u = $('vb-username').value.trim(), pw = $('vb-password').value;
        if (!u || !pw) { status.textContent = 'Bitte Benutzername und Passwort eingeben.'; return; }
        status.textContent = '';
        $('vb-login-btn').disabled = true;
        try { await signIn(u, pw); $('vb-password').value = ''; } catch (err) {
            status.textContent = LOGIN_FEHLER[err.code] || 'Anmeldung fehlgeschlagen. Versuche es nochmals.';
        } finally { $('vb-login-btn').disabled = false; }
    });
    $('vb-gate-logout').addEventListener('click', () => signOut());
}

let warLehrperson = false;
initForm();
initLogin();
onAuthStateChanged(auth, async (user) => {
    let lehrperson = false;
    if (user) {
        try { lehrperson = (await user.getIdTokenResult()).claims.role === 'teacher'; } catch { /* ohne Token kein Zugang */ }
    }
    if (lehrperson) { warLehrperson = true; zeigeApp(user); return; }
    if (warLehrperson) { window.location.reload(); return; }   // abgemeldet oder anderes Konto: sauber neu
    zeigeGate(user);
});
