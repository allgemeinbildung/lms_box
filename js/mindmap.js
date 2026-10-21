//
//  js/mindmap.js — saving for the mindmap editor of allgemeinbildung.github.io/mindmap.
//  Contract: backend/CONTRACT.md, «Mindmap editor» and `mindmapDrafts`.
//
//  The mindmap page lives in another repo on the same origin and imports this module as
//  ../lms_box/js/mindmap.js. It thereby shares the LMS Box login (one session for every
//  iframe of this origin on the same host page) and never names the Firebase SDK itself.
//
import { db, doc, getDoc, setDoc, serverTimestamp } from './firebase.js';
import { onAuthChange } from './api.js';
import { showLoginDialog, closeLoginDialog, logout } from './auth.js';

const SCHOOL = /@lernende\.bbw\.ch$/i;
const MAX_MAP_ID = 300;
const MAX_NODES_CHARS = 20000;      // as in the rules (mapOk)

let user = null;

const canSave = () => !!user && SCHOOL.test(user.email || '');
const docId = (mapId) => `${user.uid}__${encodeURIComponent(mapId)}`;

export function validMapId(mapId) {
    return typeof mapId === 'string' && mapId.length > 0 && mapId.length <= MAX_MAP_ID;
}

/** Calls back with `{ canSave, email }` once the session is known, and after every change. */
export function onAccount(callback) {
    onAuthChange((u) => {
        closeLoginDialog();     // also when a sibling iframe did the login
        user = u;
        callback({ canSave: canSave(), email: u?.email || null });
    });
}

/** The parsed `nodes` of the student's own document, or null. Unchecked: the caller validates. */
export async function loadMap(mapId) {
    if (!canSave() || !validMapId(mapId)) return null;
    const snap = await getDoc(doc(db, 'mindmapDrafts', docId(mapId)));
    if (!snap.exists()) return null;
    try { return JSON.parse(snap.data().nodes); } catch { return null; }
}

/** Saves `data` (the `{ v, add }` object). Throws with a `code` when it is refused. */
export async function saveMap(mapId, data) {
    if (!canSave()) throw Object.assign(new Error('signed out'), { code: 'signed-out' });
    if (!validMapId(mapId)) throw Object.assign(new Error('bad map id'), { code: 'invalid' });
    const nodes = JSON.stringify(data);
    if (nodes.length > MAX_NODES_CHARS) throw Object.assign(new Error('too large'), { code: 'too-large' });
    await setDoc(doc(db, 'mindmapDrafts', docId(mapId)), {
        uid: user.uid, mapId, nodes, updatedAt: serverTimestamp(),
    });
}

export const showLogin = () => showLoginDialog({ closable: true });
export { logout };
