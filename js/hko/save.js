//
//  js/hko/save.js — Speichern eines HKO-Blocks (Vertrag §7, Plan §2.5).
//
//  Nachgebaut nach js/renderer.js (nicht importiert: renderer.js hält modulglobalen Zustand
//  für lms_box). Eine Seite = ein Block = ein Saver.
//
//  - Gespeichert wird immer aus dem eigenen DOM (`instance.collect()`), nie aus dem Cache.
//    IndexedDB wird von allen iframes der Host-Seite geteilt.
//  - Jede Eingabe: neue Revision, im selben storage.atomic() die Marke
//    `unsynced_hko_<unitId>_<blockId>` = { rev, state: 'local', value }, dann Debounce 2 s.
//  - Ein Schreibvorgang gleichzeitig (Warteschlange). Nach Erfolg wird die Marke nur gelöscht,
//    wenn sie noch dieselbe Revision trägt; bei Fehler bekommt sie state 'error' | 'too_large'.
//  - Beim Laden gewinnt eine gültige Marke über den Server, wird gezeigt und sofort gespeichert.
//  - `isInitializing`: Eingaben zählen erst nach restore() und einem setTimeout(0).
//  - Keine leeren Erstdokumente: ist nichts eingegeben und hat der Server noch nichts, wird
//    nicht geschrieben.
//  - Logout-Koordination: registerSaver() in js/auth.js.
//  - Live-Mitnahme: jede lokale Änderung geht sofort auf BroadcastChannel('hko-answers').
//
import * as storage from '../storage.js';
import { registerSaver } from '../auth.js';
import { sendAnswer } from './channel.js';

export const UNSYNCED_PREFIX = 'unsynced_hko_';
export const unsyncedKey = (unitId, blockId) => `${UNSYNCED_PREFIX}${unitId}_${blockId}`;
const DEBOUNCE_MS = 2000;

const STATUS_TEXT = {
    saving: 'Speichere …',
    local: 'Lokal gespeichert.',
    cloud: 'In der Cloud gespeichert.',
    error: 'Nicht gespeichert: keine Verbindung zur Cloud. Ihre Antwort ist nur auf diesem Gerät gesichert.',
    too_large: 'Nicht gespeichert: Ihre Antwort ist zu lang. Bitte kürzen Sie sie.',
};

/** Zeigt den Speicherstand in #save-status ('' = nichts anzeigen). */
export function showStatus(state) {
    const el = document.getElementById('save-status');
    if (!el) return;
    el.dataset.state = state || '';
    el.textContent = STATUS_TEXT[state] || '';
    el.className = state ? `hko-status hko-status-${state}` : 'hko-status';
}

/** true, wenn ein Wert nichts Eingegebenes enthält (nur leere Texte, keine Zahlen). */
export function isEmptyValue(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return v.trim() === '';
    if (typeof v === 'number' || typeof v === 'boolean') return false;
    if (Array.isArray(v)) return v.every(isEmptyValue);
    if (typeof v === 'object') return Object.values(v).every(isEmptyValue);
    return true;
}

/** Eine gültige Marke dieses Blocks aus dem Cache, oder null. */
export async function readMarker(unitId, blockId) {
    try {
        const m = await storage.get(unsyncedKey(unitId, blockId));
        if (m && typeof m === 'object' && typeof m.rev === 'string' && m.rev && m.value && typeof m.value === 'object') return m;
    } catch (error) {
        console.error('[hko] Marke nicht lesbar:', error);
    }
    return null;
}

/**
 * @param {object} o
 * @param {object} o.api        js/hko/api.js
 * @param {object} o.instance   Block-Instanz (collect, validate, setEnabled)
 * @param {object} o.target     { uid, classId, variante, unitId, blockId, unitVersion, type, kn }
 * @param {boolean} o.serverHas es gibt schon ein Dokument auf dem Server
 */
export function createSaver({ api, instance, target, serverHas = false }) {
    const { uid, unitId, blockId } = target;
    const key = unsyncedKey(unitId, blockId);
    let rev = null;                 // jüngste Änderung, die noch nicht auf dem Server ist
    let initializing = true;
    let closed = false;             // false | 'suspended' | 'committed'
    let onServer = !!serverHas;
    let shown = '';
    let timer = null;
    let localWrites = Promise.resolve();
    let saveQueue = Promise.resolve();

    const status = (s) => { shown = s; showStatus(s); };
    const newRev = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    async function saveNow() {
        if (rev === null || closed === 'committed') return;
        await localWrites;
        const mine = rev;
        if (mine === null) return;
        const value = instance.collect();
        let failure = null;
        let skipped = false;

        if (isEmptyValue(value) && !onServer) {
            skipped = true;   // keine leeren Erstdokumente
        } else if (instance.validate?.()?.zuGross) {
            failure = 'too_large';
        } else {
            if (shown !== 'error' && shown !== 'too_large') status('saving');
            try {
                await api.saveAnswer({ ...target, value });
                onServer = true;
            } catch (error) {
                console.error('[hko] Speichern fehlgeschlagen:', error);
                failure = 'error';
            }
        }

        if (closed !== 'committed') {
            try {
                await storage.atomic(async (tx) => {
                    const marker = await tx.get(key);
                    if (marker && marker.rev !== mine) return;   // eine neuere Änderung wartet auf ihre eigene Speicherung
                    if (failure) await tx.set(key, { rev: mine, state: failure, value });
                    else if (marker) await tx.remove(key);
                });
            } catch (error) {
                console.error('[hko] Marke nicht nachgeführt:', error);
            }
        }
        if (rev !== mine) return;   // weitergetippt: das Gezeigte ist noch nicht gespeichert
        if (failure) {
            status(failure);
        } else {
            rev = null;
            status(skipped ? '' : 'cloud');
        }
    }

    function enqueue() {
        saveQueue = saveQueue.then(saveNow).catch((error) => console.error('[hko] Speichern unerwartet fehlgeschlagen:', error));
        return saveQueue;
    }

    function schedule() {
        clearTimeout(timer);
        timer = setTimeout(() => { timer = null; enqueue(); }, DEBOUNCE_MS);
    }

    const saver = {
        /** Vom Block bei jeder Eingabe der Person (über ctx.changed). */
        changed() {
            if (initializing || closed) return;
            const r = newRev();
            rev = r;
            const value = instance.collect();
            status('saving');
            sendAnswer({ uid, unitId, blockId, value, rev: r });
            localWrites = localWrites
                .then(() => storage.atomic((tx) => tx.set(key, { rev: r, state: 'local', value })))
                .then(() => { if (rev === r && shown === 'saving') status('local'); },
                    (error) => console.error('[hko] Lokal nicht gespeichert:', error));
            schedule();
        },
        /** Nach restore(): ab dem nächsten Tick zählen Eingaben. */
        endInit() { setTimeout(() => { initializing = false; }, 0); },
        get initializing() { return initializing; },
        /** Eine Marke aus dem Cache gewinnt: anzeigen (hat main.js getan) und sofort speichern. */
        resumeFromMarker(marker) {
            rev = marker.rev;
            status(['error', 'too_large'].includes(marker.state) ? marker.state : 'local');
            enqueue();
        },
        // ---- registerSaver (js/auth.js) ----
        flush() {
            if (timer) { clearTimeout(timer); timer = null; enqueue(); }
            else if (rev !== null) enqueue();
            return saveQueue;
        },
        hasUnsaved: () => rev !== null,
        async hasUnsynced() {
            if (rev !== null) return true;
            try { return !!(await storage.get(key)); } catch { return false; }
        },
        suspend() {
            if (closed) return;
            closed = 'suspended';
            instance.setEnabled(false);
        },
        resume() {
            if (closed !== 'suspended') return;
            closed = false;
            instance.setEnabled(true);
            if (rev !== null) enqueue();
        },
        close() {
            closed = 'committed';
            clearTimeout(timer);
            timer = null;
            instance.setEnabled(false);
        },
    };
    registerSaver(saver);
    return saver;
}
