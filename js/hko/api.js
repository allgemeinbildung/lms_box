//
//  js/hko/api.js — der einzige Ort im Browser, der die Datenbank `hko` anspricht.
//
//  Vertrag: backend/HKO.md, «Phase P1 — Vertrag» §2–§5 und §7. Alle anderen HKO-Module
//  rufen diese Funktionen auf und sehen nie Collections, Dokument-Ids oder SDK-Aufrufe.
//  Anmeldung und Roster (`students/{uid}` in `(default)`) laufen über js/auth.js / js/api.js.
//
import {
    auth, namedDb,
    doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp,
} from '../firebase.js';
import { HKO } from './config.js';

const hko = () => namedDb(HKO.database);

export const ID_PATTERN = /^[a-z0-9-]{1,80}$/;
export const SAVE_TYPES = Object.freeze(['items', 'text', 'raster', 'selbst']);
const PASTE_KINDS = new Set(['paste', 'drop', 'bulk', 'fast']);
const MAX_PASTE_CHARS = 20000;

export class HkoApiError extends Error {
    constructor(message, code = null) {
        super(message);
        this.name = 'HkoApiError';
        this.code = code;
    }
}

function requireUid() {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new HkoApiError('Sie sind nicht angemeldet. Bitte laden Sie die Seite neu.', 'unauthenticated');
    return uid;
}

/** `answers/{uid}__{unitId}__{blockId}` — alle Ids sind [a-z0-9-], also ohne Kodierung. */
export const answerId = (uid, unitId, blockId) => `${uid}__${unitId}__${blockId}`;

function checkIds(unitId, blockId) {
    if (!ID_PATTERN.test(String(unitId)) || (blockId !== undefined && !ID_PATTERN.test(String(blockId)))) {
        throw new HkoApiError('Ungültige Id.', 'invalid');
    }
}

// ---- Inhalt ------------------------------------------------------------------------

/** `units/{unitId}` oder null, wenn es die Einheit nicht gibt. */
export async function getUnit(unitId) {
    checkIds(unitId);
    const snap = await getDoc(doc(hko(), 'units', unitId));
    return snap.exists() ? snap.data() : null;
}

/** `classes/{classId}` = `{ variante, lehrjahr, aktiv }` oder null. Wirft bei Netzfehlern. */
export async function getClass(classId) {
    const id = String(classId ?? '');
    if (!id || id.length > 100 || id.includes('/')) return null;
    const snap = await getDoc(doc(hko(), 'classes', id));
    return snap.exists() ? snap.data() : null;
}

// ---- Antworten -----------------------------------------------------------------------

/** Die eigene Antwort zu einem Block (auch aus einer anderen Einheit), oder null. */
export async function getAnswer(unitId, blockId) {
    checkIds(unitId, blockId);
    const uid = requireUid();
    const snap = await getDoc(doc(hko(), 'answers', answerId(uid, unitId, blockId)));
    return snap.exists() ? snap.data() : null;
}

/** Alle eigenen Antworten einer Einheit (Druck): `where uid ==` und `where unitId ==`. */
export async function listOwnAnswers(unitId) {
    checkIds(unitId);
    const uid = requireUid();
    const snap = await getDocs(query(collection(hko(), 'answers'),
        where('uid', '==', uid), where('unitId', '==', unitId)));
    return snap.docs.map((d) => d.data());
}

/**
 * Schreibt die Antwort eines Blocks als ganzes Dokument (setDoc, kein Merge). Felder genau
 * nach Vertrag §4. Wirft HkoApiError; `code` ist der Firestore-Code (`permission-denied` …).
 * @param {{unitId: string, blockId: string, classId: string, unitVersion: number,
 *          variante: string, type: string, value: object, kn: boolean}} a
 */
export async function saveAnswer(a) {
    checkIds(a.unitId, a.blockId);
    const uid = requireUid();
    const data = {
        uid,
        classId: String(a.classId ?? '').slice(0, 100),
        unitId: a.unitId,
        blockId: a.blockId,
        unitVersion: Number.isInteger(a.unitVersion) && a.unitVersion >= 1 ? a.unitVersion : 1,
        variante: a.variante,
        type: a.type,
        value: a.value,
        status: 'entwurf',
        kn: a.kn === true,
        updatedAt: serverTimestamp(),
    };
    try {
        await setDoc(doc(hko(), 'answers', answerId(uid, a.unitId, a.blockId)), data);
    } catch (e) {
        throw new HkoApiError(e?.message || 'Speichern fehlgeschlagen.', e?.code || null);
    }
}

// ---- Paste-Hinweise (Vertrag §5) -------------------------------------------------------

function eventId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Hält fest, dass Text eingefügt statt getippt wurde. Nur anlegen; die Person kann den
 * Eintrag weder lesen noch löschen. Ein Hinweis, keine Sanktion.
 * @param {string} feld `text`, eine `frageId`, `r<zeile>c<spalte>`, `befund`, `begruendung`, `verbessere`
 * @param {{kind: string, chars: number, excerpt: string}} event
 */
export async function reportPaste(unitId, blockId, feld, event) {
    checkIds(unitId, blockId);
    const uid = requireUid();
    if (!PASTE_KINDS.has(event?.kind)) throw new HkoApiError('Unbekannte Art.', 'invalid');
    const data = {
        uid,
        unitId,
        blockId,
        feld: String(feld || 'text').slice(0, 100),
        kind: event.kind,
        chars: Math.max(0, Math.min(MAX_PASTE_CHARS, Math.round(event.chars) || 0)),
        excerpt: String(event.excerpt ?? '').slice(0, 300),
        at: serverTimestamp(),
    };
    try {
        await setDoc(doc(hko(), 'pasteEvents', `${answerId(uid, unitId, blockId)}__${eventId()}`), data);
    } catch (e) {
        throw new HkoApiError(e?.message || 'Meldung fehlgeschlagen.', e?.code || null);
    }
}
