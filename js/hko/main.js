//
//  js/hko/main.js — Ablauf der Lernendenseite hko.html (Plan §2.3, Vertrag §7).
//
//    URL (unit, block) → authenticate() → Einheit + Variante → Block rendern → Speichern
//
//  Alles aus URL und DB geht per textContent ins DOM. Für Tests trägt #content-renderer
//  data-modus = 'bearbeiten' | 'lesen' | 'kn' | 'fehler' und ein Hinweis #hko-hinweis data-reason.
//
import { initEmbedHeight } from '../embedHeight.js';
import { authenticate } from '../auth.js';
import * as api from './api.js';
import { ID_PATTERN } from './api.js';
import { blockEntry } from './registry.js';
import { createSaver, readMarker } from './save.js';
import { ermittleVariante, pruefeBlock } from './variante.js';
import { renderKiRegel } from './kiRegel.js';
import { printAnswers } from './print.js';
import { el } from './util.js';

export const KN_TEXT = 'Dieser Teil ist der Kompetenznachweis. Er findet nicht hier statt; Ihre Lehrperson gibt Ihnen die Unterlagen.';

const $ = (id) => document.getElementById(id);
const container = () => $('content-renderer');

function setTitles(main, sub) {
    $('main-title').textContent = main || '';
    $('sub-title').textContent = sub || '';
}

/** Hinweis über dem Block (oder statt des Blocks). */
function hinweis(reason, text, { art = 'info', reload = false } = {}) {
    const box = el('div', `hko-hinweis hko-hinweis-${art}`);
    box.id = 'hko-hinweis';
    box.dataset.reason = reason;
    box.setAttribute('role', art === 'fehler' ? 'alert' : 'note');
    box.appendChild(el('p', '', text));
    if (reload) {
        const a = el('a', 'hko-link', 'Seite neu laden');
        a.href = '#';
        a.addEventListener('click', (e) => { e.preventDefault(); window.location.reload(); });
        const p = el('p', '');
        p.appendChild(a);
        box.appendChild(p);
    }
    return box;
}

/** Fehler statt Inhalt: kein Block, kein Druck. */
function zeigeFehler(reason, text, opts = {}) {
    container().dataset.modus = 'fehler';
    container().replaceChildren(hinweis(reason, text, { art: 'fehler', ...opts }));
    $('hko-ki-regel').hidden = true;
    const actions = $('action-container');
    const print = $('print-answers');
    if (print) print.hidden = true;
    if (actions && !$('auth-user')) actions.hidden = true;
}

function notify(message) {
    let box = $('hko-meldung');
    if (!box) {
        box = el('p', 'hko-meldung');
        box.id = 'hko-meldung';
        box.setAttribute('role', 'status');
        $('action-container').after(box);
    }
    box.textContent = message;
}

async function start() {
    initEmbedHeight();

    // 1. URL. Beide Ids nach Vertrag §2, sonst Fehlertext (der Wert erscheint nur als Text).
    const params = new URLSearchParams(window.location.search);
    const unitId = params.get('unit') ?? '';
    const blockId = params.get('block') ?? '';
    if (!ID_PATTERN.test(unitId) || !ID_PATTERN.test(blockId)) {
        setTitles('', 'Ungültiger Link');
        zeigeFehler('ungueltiger-link', `Dieser Link ist ungültig (Einheit «${unitId}», Auftrag «${blockId}»). Melden Sie das Ihrer Lehrperson.`);
        return;
    }

    // 2. Anmeldung (geteilter Dialog, js/auth.js). Löst nur für Lernende mit Roster-Eintrag auf.
    const { uid, student } = await authenticate();

    // 3. Einheit und Variante parallel.
    let unit = null;
    let unitFailed = false;
    const [unitResult, v] = await Promise.all([
        api.getUnit(unitId).catch((error) => { console.error('[hko] units:', error); unitFailed = true; return null; }),
        ermittleVariante(student, api),
    ]);
    unit = unitResult;
    if (unitFailed) {
        setTitles('', 'Auftrag');
        zeigeFehler('einheit-fehler', 'Die Einheit konnte nicht geladen werden. Prüfen Sie Ihre Internetverbindung und laden Sie die Seite neu.', { reload: true });
        return;
    }
    if (!unit) {
        setTitles('', 'Auftrag');
        zeigeFehler('einheit-fehlt', `Die Einheit «${unitId}» gibt es nicht. Melden Sie das Ihrer Lehrperson.`);
        return;
    }
    const block = unit.blocks && typeof unit.blocks === 'object' ? unit.blocks[blockId] : null;
    setTitles(typeof unit.titel === 'string' ? unit.titel : unitId, block && typeof block.titel === 'string' ? block.titel : blockId);
    if (!block || typeof block !== 'object') {
        zeigeFehler('block-fehlt', `Den Auftrag «${blockId}» gibt es in dieser Einheit nicht. Melden Sie das Ihrer Lehrperson.`);
        return;
    }
    if (v.fall === 'fehler') {
        zeigeFehler('klasse-fehler', v.text, { reload: true });
        return;
    }

    // 4. KI-Regel über jedem Block.
    renderKiRegel($('hko-ki-regel'), block, blockId);

    // 5. Druckknopf (Druckansicht: js/hko/print.js).
    const printBtn = $('print-answers');
    printBtn.hidden = false;
    printBtn.addEventListener('click', async () => {
        printBtn.disabled = true;
        try {
            await printAnswers({ unit, unitId, variante: v.variante, studentName: student.name, api, blockEntry, notify });
        } catch (error) {
            console.error('[hko] Druck:', error);
            notify('Die Druckansicht konnte nicht geöffnet werden.');
        } finally {
            printBtn.disabled = false;
        }
    });

    const box = container();
    box.replaceChildren();

    // 6. Kompetenznachweis: Hinweis statt Eingabe, nichts speicherbar (Vertrag §6, Plan A14).
    if (block.kn === true) {
        box.dataset.modus = 'kn';
        box.appendChild(hinweis('kn', KN_TEXT));
        return;
    }

    // 7. Darf die Person hier schreiben?
    const check = pruefeBlock(v, unit, block);
    if (!check.speicherbar) box.appendChild(hinweis(check.fall, check.text));
    const entry = blockEntry(block.type);
    const instance = entry.modul.create();
    const saves = entry.speichert && typeof instance.collect === 'function' && typeof instance.restore === 'function';
    const readonly = !check.speicherbar;
    box.dataset.type = String(block.type ?? '');

    // Stand vor dem Rendern holen: eine Marke im Cache (nur wer schreiben darf) und der Server.
    let marker = null;
    let server = null;
    if (saves) {
        const [m, s] = await Promise.all([
            readonly ? null : readMarker(unitId, blockId),
            api.getAnswer(unitId, blockId).catch((error) => { console.error('[hko] answers:', error); return undefined; }),
        ]);
        marker = m;
        server = s;
        if (server === undefined && !marker) {
            zeigeFehler('antwort-fehler', 'Ihre Antwort konnte nicht geladen werden. Prüfen Sie Ihre Internetverbindung und laden Sie die Seite neu.', { reload: true });
            return;
        }
    }

    let saver = null;
    const ctx = {
        uid,
        classId: v.classId,
        variante: v.variante,
        unit,
        block,
        unitId,
        blockId,
        readonly,
        api,
        changed: () => saver?.changed(),
        container: box,
        reportPaste: (feld, event) => (readonly ? Promise.resolve() : api.reportPaste(unitId, blockId, feld, event)),
    };
    if (saves && !readonly) {
        saver = createSaver({
            api,
            instance,
            serverHas: !!server,
            target: {
                uid,
                classId: v.classId,
                variante: v.variante,
                unitId,
                blockId,
                unitVersion: unit.version,
                type: block.type,
                kn: block.kn === true,
            },
        });
    }

    // render() und restore() im selben Tick: isInitializing (Block und Saver) deckt beides ab.
    instance.render(block, ctx);
    if (saves) {
        const initial = marker ? marker.value : server?.value;
        if (initial) instance.restore(initial);
    }
    if (readonly) instance.setEnabled(false);
    if (saver) {
        saver.endInit();
        if (marker) saver.resumeFromMarker(marker);
    }
    box.dataset.modus = readonly ? 'lesen' : 'bearbeiten';   // last: the block is rendered and restored
}

start().catch((error) => {
    console.error('[hko] Start fehlgeschlagen:', error);
    zeigeFehler('start-fehler', 'Der Auftrag konnte nicht geladen werden. Laden Sie die Seite neu.', { reload: true });
});
