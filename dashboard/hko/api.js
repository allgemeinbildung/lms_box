//
//  dashboard/hko/api.js — the only data access of the HKO teacher view (read only).
//
//  Roster: `students` in the (default) database (Lite, one request).
//  HKO data: `classes`, `units`, `answers`, `pasteEvents` in the database HKO.database.
//
//  Answers and paste events are searched by the UIDS OF THE CLASS LIST, never by the
//  `classId` written in a document: a student can write any classId into their own document
//  (Vertrag §4, CLAUDE.md). Firestore allows 30 values in an `in` filter, so a class is
//  watched with one listener per 30 uids (as watchClass in dashboard/modules/api.js).
//
import { rosterDb, collection as rosterCollection, getDocs as rosterGetDocs } from '../../js/firebase.js';
import { hkoDb, collection, query, where, getDocs, onSnapshot } from './firestore.js';

const IN_LIMIT = 30;

/**
 * classId -> [{ uid, name }], sorted by name. Display names are made unique within a class
 * by the user name (two people with one name would be indistinguishable in the grid).
 */
export async function loadRoster() {
    const snap = await rosterGetDocs(rosterCollection(rosterDb, 'students'));
    const byClass = new Map();
    snap.forEach((d) => {
        const s = d.data();
        const classes = Array.isArray(s.classIds) && s.classIds.length ? s.classIds : [s.classId];
        for (const classId of classes) {
            if (typeof classId !== 'string' || !classId) continue;
            if (!byClass.has(classId)) byClass.set(classId, []);
            byClass.get(classId).push({ uid: d.id, name: String(s.name || s.username || d.id), username: String(s.username || d.id) });
        }
    });
    const out = new Map();
    for (const [classId, members] of byClass) {
        const count = new Map();
        for (const m of members) count.set(m.name, (count.get(m.name) || 0) + 1);
        out.set(classId, members
            .map((m) => ({ uid: m.uid, name: count.get(m.name) > 1 ? `${m.name} (${m.username})` : m.name }))
            .sort((a, b) => a.name.localeCompare(b.name, 'de')));
    }
    return out;
}

/** classId -> { variante, lehrjahr, aktiv } for every document of `classes`. */
export async function loadClasses() {
    const snap = await getDocs(collection(hkoDb, 'classes'));
    const out = new Map();
    snap.forEach((d) => out.set(d.id, d.data()));
    return out;
}

/** unitId -> unit document (build format 1:1). */
export async function loadUnits() {
    const snap = await getDocs(collection(hkoDb, 'units'));
    const out = new Map();
    snap.forEach((d) => out.set(d.id, d.data()));
    return out;
}

const chunks = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
};

/**
 * Live view of one class x one unit.
 *   uids        the class list (the only source of which documents are asked for)
 *   unitId      unit id
 *   onChange()  called after every snapshot
 *   onError(e)  called when a listener fails
 * Returns { stop, answers(), pastes(), listeners }: Maps keyed `<uid>__<blockId>` (pastes: arrays, oldest first).
 * Documents that do not belong are dropped here as well (id must be `<uid>__<unitId>__<blockId>`).
 */
export function watchClassUnit({ uids, unitId, onChange, onError }) {
    const uidSet = new Set(uids);
    const answerDocs = [];   // per chunk: Map(docId -> data)
    const pasteDocs = [];
    const unsubscribes = [];

    const listen = (collectionName, store, chunk) => {
        const bucket = new Map();
        store.push(bucket);
        const q = query(collection(hkoDb, collectionName), where('uid', 'in', chunk), where('unitId', '==', unitId));
        unsubscribes.push(onSnapshot(q, (snap) => {
            bucket.clear();
            snap.forEach((d) => bucket.set(d.id, d.data()));
            onChange?.();
        }, (error) => {
            console.error(`[hko] ${collectionName} listener:`, error);
            onError?.(error);
        }));
    };
    for (const chunk of chunks(uids, IN_LIMIT)) {
        listen('answers', answerDocs, chunk);
        listen('pasteEvents', pasteDocs, chunk);
    }

    const answers = () => {
        const out = new Map();
        for (const bucket of answerDocs) {
            for (const [id, a] of bucket) {
                if (!a || !uidSet.has(a.uid) || a.unitId !== unitId || typeof a.blockId !== 'string') continue;
                if (id !== `${a.uid}__${unitId}__${a.blockId}`) continue;
                out.set(`${a.uid}__${a.blockId}`, a);
            }
        }
        return out;
    };
    const pastes = () => {
        const out = new Map();
        for (const bucket of pasteDocs) {
            for (const [id, e] of bucket) {
                if (!e || !uidSet.has(e.uid) || e.unitId !== unitId || typeof e.blockId !== 'string') continue;
                if (!id.startsWith(`${e.uid}__${unitId}__${e.blockId}__`)) continue;
                const key = `${e.uid}__${e.blockId}`;
                if (!out.has(key)) out.set(key, []);
                out.get(key).push(e);
            }
        }
        const millis = (e) => (e.at && typeof e.at.toMillis === 'function' ? e.at.toMillis() : 0);
        for (const list of out.values()) list.sort((a, b) => millis(a) - millis(b));
        return out;
    };

    return {
        listeners: unsubscribes.length,
        answers,
        pastes,
        stop: () => unsubscribes.forEach((off) => off()),
    };
}
