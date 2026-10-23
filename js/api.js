//
//  js/api.js — the only place in the student surface that talks to the backend.
//
//  Every other module calls these named functions and never sees collections,
//  document ids or SDK calls. Backend: Firebase Auth + Firestore database
//  `lmsbox` + callable functions, reached through js/firebase.js.
//  Binding spec: backend/CONTRACT.md.
//
import {
    auth, db, rosterDb, functions,
    signInWithEmailAndPassword, signInWithCustomToken, signOut as fbSignOut, onAuthStateChanged,
    doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp,
    httpsCallable,
} from './firebase.js';

const EMAIL_DOMAIN = '@lernende.bbw.ch';
/** All answers of one sub-assignment together; enforced by the security rules. */
export const MAX_ANSWER_CHARS = 200000;

export class ApiError extends Error {
    constructor(message, { status = null, code = null, result = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.result = result;
    }
}

// ---- ids (CONTRACT.md, "Ids") -------------------------------------------------

const enc = encodeURIComponent;
const assignmentDoc = (assignmentId) => enc(assignmentId);
const draftDoc = (uid, assignmentId, subId) => `${uid}__${enc(assignmentId)}__${enc(subId)}`;
const pairDoc = (uid, assignmentId) => `${uid}__${enc(assignmentId)}`;

function requireUid() {
    const uid = auth.currentUser?.uid;
    if (!uid) throw new ApiError('Du bist nicht angemeldet. Bitte lade die Seite neu.', { code: 'unauthenticated' });
    return uid;
}

// ---- login ----------------------------------------------------------------------

/** `vorname.nachname` -> BBW address; anything with an @ is used as it is. */
function resolveToEmail(input) {
    const v = String(input).trim().toLowerCase();
    return v.includes('@') ? v : v + EMAIL_DOMAIN;
}

/**
 * Signs in. Throws an ApiError whose `code` is the Firebase code
 * (`auth/invalid-credential`, `auth/too-many-requests`, …).
 */
export async function signIn(username, password) {
    try {
        const cred = await signInWithEmailAndPassword(auth, resolveToEmail(username), password);
        return { uid: cred.user.uid };
    } catch (e) {
        throw new ApiError(e?.message || 'Anmeldung fehlgeschlagen.', { code: e?.code || null });
    }
}

/** Signs in with a custom token from the function `boxSsoToken` (js/sso.js). */
export async function signInWithPortalToken(token) {
    try {
        const cred = await signInWithCustomToken(auth, token);
        return { uid: cred.user.uid };
    } catch (e) {
        throw new ApiError(e?.message || 'Anmeldung fehlgeschlagen.', { code: e?.code || null });
    }
}

export const signOut = () => fbSignOut(auth);

/**
 * Calls `callback({ uid, email } | null)` once the stored session is known and on
 * every later change — also when another iframe or tab of this page signs in or out.
 */
export const onAuthChange = (callback) =>
    onAuthStateChanged(auth, (user) => callback(user ? { uid: user.uid, email: user.email } : null));

/** The signed-in account's roster entry (`students/{uid}`), or null if it has none. */
let currentStudent = null;
export async function getStudent() {
    const uid = requireUid();
    const snap = await getDoc(doc(rosterDb, 'students', uid));
    currentStudent = snap.exists() ? { uid, ...snap.data() } : null;
    return currentStudent;
}

// ---- assignments ------------------------------------------------------------------

/**
 * The public copy of the assignment (no solutions; CONTRACT.md, «Public copy and guest mode»).
 * Readable without sign-in; the page uses it signed in or not.
 */
export async function getAssignment(assignmentId) {
    const snap = await getDoc(doc(db, 'publicAssignments', assignmentDoc(assignmentId)));
    if (!snap.exists()) throw new ApiError(`Aufgabe "${assignmentId}" nicht gefunden.`, { status: 404, code: 'not_found' });
    return snap.data();
}

// ---- drafts: one document per sub-assignment ---------------------------------------

/**
 * All of the student's drafts of one assignment, in the shape the renderer and
 * the printer work with: `{ assignments: { [assignmentId]: { [subId]: { title, type, questions, answers } } } }`.
 */
export async function getDraft(assignmentId) {
    const uid = requireUid();
    const snap = await getDocs(query(collection(db, 'drafts'),
        where('uid', '==', uid), where('assignmentId', '==', assignmentId)));
    const subs = {};
    snap.forEach((d) => {
        const { subId, title, type, questions, answers } = d.data();
        subs[subId] = { title, type, questions: questions || [], answers: answers || [] };
    });
    return { assignments: { [assignmentId]: subs } };
}

/**
 * Writes the draft of ONE sub-assignment as a whole document.
 * @param {{title?: string, type?: string, questions?: Array, answers: Array<{questionId: string, answer: string}>}} draft
 * Throws ApiError; `code === 'too_large'` when the rules refused it for its size.
 */
export async function saveDraft(assignmentId, subId, draft) {
    const uid = requireUid();
    const answers = (draft.answers || []).map((a) => ({ questionId: String(a.questionId), answer: String(a.answer ?? '') }));
    const data = {
        uid,
        classId: String(currentStudent?.classId ?? ''),   // query filter for the dashboard only; no name here
        assignmentId,
        subId,
        title: String(draft.title ?? subId),
        type: String(draft.type ?? 'quill'),
        // The rules accept {id, text} only — and a rubric must not travel with the draft.
        questions: (draft.questions || []).map((q) => ({ id: String(q.id), text: String(q.text ?? '') })),
        answers,
        updatedAt: serverTimestamp(),
    };
    try {
        await setDoc(doc(db, 'drafts', draftDoc(uid, assignmentId, subId)), data);
    } catch (e) {
        const size = answers.reduce((n, a) => n + a.answer.length, 0);
        if (e?.code === 'permission-denied' && size > MAX_ANSWER_CHARS) {
            throw new ApiError('Die Antwort ist zu lang.', { status: 413, code: 'too_large' });
        }
        throw new ApiError(e?.message || 'Speichern fehlgeschlagen.', { code: e?.code || null });
    }
}

// ---- paste hints (CONTRACT.md, pasteEvents) -----------------------------------------

const PASTE_KINDS = new Set(['paste', 'drop', 'bulk', 'fast']);

/** A random id for one event: 20 characters of [A-Za-z0-9]. */
function eventId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    const bytes = crypto.getRandomValues(new Uint8Array(20));
    return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Records that text was inserted into an editor rather than typed. Create-only:
 * the student can neither read nor delete it. Throws ApiError on failure.
 * @param {{kind: string, chars: number, excerpt: string}} event
 */
export async function reportPaste(assignmentId, subId, questionId, event) {
    const uid = requireUid();
    if (!PASTE_KINDS.has(event.kind)) throw new ApiError('Unbekannte Art.', { code: 'invalid' });
    const data = {
        uid,
        assignmentId,
        subId,
        questionId: String(questionId),
        kind: event.kind,
        chars: Math.max(0, Math.min(MAX_ANSWER_CHARS, Math.round(event.chars) || 0)),
        excerpt: String(event.excerpt ?? '').slice(0, 300),
        at: serverTimestamp(),
    };
    try {
        await setDoc(doc(db, 'pasteEvents', `${draftDoc(uid, assignmentId, subId)}__${eventId()}`), data);
    } catch (e) {
        throw new ApiError(e?.message || 'Meldung fehlgeschlagen.', { code: e?.code || null });
    }
}

// ---- released feedback ---------------------------------------------------------------

/** `{ found, data }` — `data` is the already filtered copy the teacher released. */
export async function getReleasedFeedback(assignmentId) {
    const uid = requireUid();
    const snap = await getDoc(doc(db, 'feedbackReleased', pairDoc(uid, assignmentId)));
    return snap.exists() ? { found: true, data: snap.data() } : { found: false, data: null };
}

// ---- formativ (callable functions) -----------------------------------------------------

/** HttpsError -> ApiError: `details.code` is what the old ApiError.code carried. */
async function call(name, payload) {
    requireUid();   // a guest sends nothing to the functions
    try {
        return (await httpsCallable(functions, name)(payload)).data;
    } catch (e) {
        const details = e?.details && typeof e.details === 'object' ? e.details : {};
        throw new ApiError(e?.message || 'Der Dienst ist gerade nicht verfügbar.', {
            status: e?.code || null,          // e.g. "functions/already-exists"
            code: details.code || null,       // e.g. "already_used", "too_short"
            result: details.result ?? null,
        });
    }
}

/**
 * The formativ feedback of this assignment per field, and how many attempts a field
 * allows (`max`; 1 from a function older than 23.10.2026, which did not send it).
 */
export async function getFormativStatus(assignmentId) {
    const data = await call('boxFormativStatus', { assignmentId });
    return { slots: data?.slots || {}, max: Number.isInteger(data?.max) ? data.max : 1 };
}

/**
 * Asks for formative feedback on one answer. The rubric is looked up on the
 * server; the client only says which field and sends the frozen text.
 */
export async function requestFormativ(assignmentId, subId, questionId, text) {
    const data = await call('boxFormativ', { assignmentId, subId, questionId, text });
    // Accepts both `{ status, result }` (what formativ.requestFeedback returns) and the bare result.
    return { result: data?.result ?? data };
}
