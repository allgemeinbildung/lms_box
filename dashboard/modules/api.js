//
//  dashboard/modules/api.js — the only data module of the teacher dashboard.
//
//  Firebase Auth + Firestore (database `lmsbox`, roster in `(default)`) and the local
//  evaluator on http://localhost:5000. Binding spec: backend/CONTRACT.md.
//
//  The other dashboard modules still speak the vocabulary of the old Cloud Function:
//  a student is a `studentKey`, a draft is a file `{ name, path }`. Both are mapped
//  here and nowhere else:
//      studentKey  = the student's uid
//      file.name   = assignmentId
//      file.path   = `drafts/${uid}/${encodeURIComponent(assignmentId)}`
//  (renderer.js takes path.split('/')[1] as the studentKey, as it did with bucket paths.)
//
import {
    auth, rosterDb, onAuthStateChanged, signOut as fbSignOut,
    collection as rosterCollection, getDocs as rosterGetDocs,   // Lite: one request, no stream
} from '../../js/firebase.js';
import { signIn as accountSignIn } from '../../js/api.js';     // same username -> e-mail rule as the student page
import {
    liveDb, doc, getDoc, getDocs, collection, query, where, onSnapshot, writeBatch, serverTimestamp,
} from './firestore.js';

const EVALUATOR_URL = 'http://localhost:5000';

// ---- ids (CONTRACT.md, "Ids") -------------------------------------------------

const enc = encodeURIComponent;
const pairDoc = (uid, assignmentId) => `${uid}__${enc(assignmentId)}`;
const draftPath = (uid, assignmentId) => `drafts/${uid}/${enc(assignmentId)}`;
function parseDraftPath(path) {
    const [, uid, encoded] = String(path || '').split('/');
    if (!uid || !encoded) return null;
    try { return { uid, assignmentId: decodeURIComponent(encoded) }; } catch { return null; }
}

// ---- login ----------------------------------------------------------------------

/** Throws an error whose `code` is the Firebase code (`auth/invalid-credential`, …). */
export const signIn = (username, password) => accountSignIn(username, password);

export const signOut = () => {
    stopWatching();
    published.unsubscribe?.();
    published = noAssignments();
    return fbSignOut(auth);
};

/**
 * Calls `callback({ signedIn, isTeacher, email })` once the stored session is known
 * and on every later change. `isTeacher` is the custom claim `role == "teacher"` on
 * the ID token; the security rules check the same claim.
 */
export const onTeacherAuth = (callback) => onAuthStateChanged(auth, async (user) => {
    if (!user) { callback({ signedIn: false, isTeacher: false, email: null }); return; }
    let isTeacher = false;
    try { isTeacher = (await user.getIdTokenResult()).claims.role === 'teacher'; } catch { /* no token: no access */ }
    callback({ signedIn: true, isTeacher, email: user.email });
});

// ---- roster: classes and students ---------------------------------------------------

/** classId -> Map(uid -> display name). Display names are unique within a class. */
let classIndex = new Map();

async function loadRoster() {
    const snap = await rosterGetDocs(rosterCollection(rosterDb, 'students'));
    const byClass = new Map();
    snap.forEach((d) => {
        const s = d.data();
        const classes = Array.isArray(s.classIds) && s.classIds.length ? s.classIds : [s.classId];
        for (const classId of classes) {
            if (!classId) continue;
            if (!byClass.has(classId)) byClass.set(classId, []);
            byClass.get(classId).push({ uid: d.id, name: String(s.name || s.username || d.id), username: s.username || d.id });
        }
    });
    classIndex = new Map();
    for (const [classId, members] of byClass) {
        const count = new Map();
        for (const m of members) count.set(m.name, (count.get(m.name) || 0) + 1);
        // Cards, exports and the evaluator's folders are keyed by name: two people with the
        // same name in one class are told apart by their username.
        classIndex.set(classId, new Map(members.map((m) => [m.uid, count.get(m.name) > 1 ? `${m.name} (${m.username})` : m.name])));
    }
}

// ---- assignments that exist ---------------------------------------------------------------

/**
 * The ids of the documents in `assignments`, kept live by one listener for the whole session.
 * A student can write any `assignmentId` into an own draft; only ids from this set are offered
 * in the dashboard. (The teacher may read the collection; it is what the evaluator works from.)
 */
const noAssignments = () => ({ ids: new Set(), ready: null, unsubscribe: null });
let published = noAssignments();

function watchAssignments() {
    if (published.ready) return published.ready;
    const mine = noAssignments();
    published = mine;
    mine.ready = new Promise((resolve, reject) => {
        let first = true;
        mine.unsubscribe = onSnapshot(collection(liveDb, 'assignments'), (snap) => {
            const ids = new Set();
            snap.forEach((d) => {
                let id = d.get('assignmentId');
                if (typeof id !== 'string' || !id) { try { id = decodeURIComponent(d.id); } catch { id = d.id; } }
                ids.add(id);
            });
            mine.ids = ids;
            if (first) { first = false; resolve(); return; }
            // An assignment was published or removed while a class is open: offer / withdraw it.
            if (published === mine && watch.settled) watch.onUpdate?.({ students: studentsOf(watch.classId), changed: [] });
        }, (error) => {
            console.error('[assignments] listener:', error);
            if (published === mine) published = noAssignments();   // the next class selection tries again
            if (first) { first = false; reject(error); }
        });
    });
    return mine.ready;
}

// ---- drafts: live listeners on the members of one class ---------------------------------

/** Firestore allows at most 30 values in an `in` filter. */
const IN_LIMIT = 30;

const emptyWatch = () => ({ classId: null, uids: [], unsubscribes: [], drafts: new Map(), onUpdate: null, settled: false });

/** The class being watched and the draft documents its listeners delivered (doc id -> data). */
let watch = emptyWatch();

function stopWatching() {
    watch.unsubscribes.forEach((off) => off());
    watch = emptyWatch();
}

/**
 * `{ [studentName]: [{ name: assignmentId, path }] }` for one class: every student on the
 * roster of that class (an empty list when they have no draft), one "file" per assignment.
 * Only assignments that exist in the `assignments` collection are listed.
 */
function studentsOf(classId) {
    const members = classIndex.get(classId) || new Map();
    const out = {};
    for (const name of members.values()) out[name] = [];
    if (watch.classId !== classId) return out;
    const seen = new Set();
    for (const d of watch.drafts.values()) {
        const name = members.get(d.uid);
        if (!name) continue;                               // cannot happen: the listeners ask for members only
        if (!published.ids.has(d.assignmentId)) continue;  // invented by the student, or not published
        const key = `${d.uid}\n${d.assignmentId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out[name].push({ name: d.assignmentId, path: draftPath(d.uid, d.assignmentId) });
    }
    return out;
}

/**
 * Loads the roster and returns `{ [classId]: { [studentName]: files[] } }`, the shape of
 * the old `listDrafts`. Files are filled for the class that is being watched; the other
 * classes get their files when they are selected (watchClass).
 */
export const listDrafts = async () => {
    await loadRoster();
    const out = {};
    for (const classId of classIndex.keys()) out[classId] = studentsOf(classId);
    return out;
};

/**
 * Starts the live listeners on the drafts of one class (and ends the previous ones).
 *
 * Whose drafts: those of the class's roster members, asked for by **uid** — `where('uid', 'in',
 * [...])`, at most 30 uids per listener, so ceil(members / 30) listeners. The `classId` a draft
 * carries is not looked at: the student's browser stamped it, it may be empty, another of the
 * student's classes or outdated. Drafts of uids that are not on this roster are never requested.
 *
 * Resolves with the class's students (see studentsOf) once every listener has delivered its
 * first result. Every later change calls `onUpdate({ students, changed: [{ studentName, assignmentId }] })`.
 * `watchClass(null)` only stops listening.
 */
export const watchClass = (classId, onUpdate) => {
    stopWatching();
    if (!classId) return Promise.resolve({});
    const members = classIndex.get(classId) || new Map();
    const uids = [...members.keys()];
    const mine = { ...emptyWatch(), classId, uids, onUpdate };
    watch = mine;
    const chunks = [];
    for (let i = 0; i < uids.length; i += IN_LIMIT) chunks.push(uids.slice(i, i + IN_LIMIT));

    return new Promise((resolve, reject) => {
        let waiting = chunks.length + 1;   // + the assignments listener
        let failed = false;
        const ready = () => {
            waiting -= 1;
            if (waiting > 0 || failed || watch !== mine) return;
            mine.settled = true;
            resolve(studentsOf(classId));
        };
        const fail = (error) => {
            if (mine.settled || failed) return;
            failed = true;
            reject(error);
        };
        watchAssignments().then(ready, fail);
        for (const chunk of chunks) {
            let first = true;
            mine.unsubscribes.push(onSnapshot(
                query(collection(liveDb, 'drafts'), where('uid', 'in', chunk)),
                (snap) => {
                    if (watch !== mine) return;
                    const changed = [];
                    snap.docChanges().forEach((change) => {
                        const d = change.doc.data();
                        // Kept as delivered, unfiltered: watchInfo() shows what the query really returned.
                        if (change.type === 'removed') mine.drafts.delete(change.doc.id);
                        else mine.drafts.set(change.doc.id, d);
                        const studentName = members.get(d.uid);
                        if (studentName && published.ids.has(d.assignmentId)) changed.push({ studentName, assignmentId: d.assignmentId });
                    });
                    if (first) { first = false; ready(); return; }
                    if (mine.settled && changed.length) onUpdate?.({ students: studentsOf(classId), changed });
                },
                (error) => {
                    console.error('[drafts] listener:', error);
                    fail(error);
                },
            ));
        }
    });
};

/**
 * What the listeners of the watched class hold right now — for the tests and for a look in the
 * console: the class, the uids asked for, the number of draft listeners, the ids of every draft
 * document they delivered (also those of invented assignments, which are shown nowhere) and
 * the published assignment ids.
 */
export const watchInfo = () => ({
    classId: watch.classId,
    uids: [...watch.uids],
    draftListeners: watch.unsubscribes.length,
    draftIds: [...watch.drafts.keys()],
    assignmentIds: [...published.ids],
});

/**
 * All drafts of one student for one assignment, in the shape the old draft file had:
 * `{ assignments: { [assignmentId]: { [subId]: { title, type, questions, answers } } }, createdAt }`.
 * `createdAt` is the newest `updatedAt` of the sub-assignments. Returns null on failure.
 */
export const fetchDraftContent = async (path) => {
    try {
        const target = parseDraftPath(path);
        if (!target) return null;
        let docs = [...watch.drafts.values()].filter((d) => d.uid === target.uid && d.assignmentId === target.assignmentId);
        if (docs.length === 0) {
            // Not held by the listeners (the class was just switched): read it once — but only
            // for a uid on the roster of the watched class. No other uid's drafts are ever fetched.
            if (!watch.uids.includes(target.uid)) return null;
            const snap = await getDocs(query(collection(liveDb, 'drafts'),
                where('uid', '==', target.uid), where('assignmentId', '==', target.assignmentId)));
            docs = snap.docs.map((d) => d.data());
        }
        const subs = {};
        let newest = 0;
        for (const d of docs) {
            subs[d.subId] = { title: d.title || d.subId, type: d.type || 'quill', questions: d.questions || [], answers: d.answers || [] };
            newest = Math.max(newest, d.updatedAt?.toMillis?.() || 0);
        }
        const data = { assignments: { [target.assignmentId]: subs } };
        if (newest) data.createdAt = new Date(newest).toISOString();
        return data;
    } catch (error) {
        console.error('[drafts] read:', error);
        return null;
    }
};

// ---- feedback: feedback/{pairDoc} and its released copy -------------------------------

const NAME_KEYS = ['student_name', 'studentName', 'class_name', 'className'];
/** A JSON copy without name fields: `feedback` documents carry the uid, never a name. */
function withoutNames(value) {
    const copy = JSON.parse(JSON.stringify(value ?? {}));
    const strip = (o) => { if (o && typeof o === 'object') for (const k of NAME_KEYS) delete o[k]; };
    strip(copy);
    if (Array.isArray(copy.results)) copy.results.forEach(strip);
    return copy;
}

const normalizeSettings = (s) => ({
    kurzbericht: s?.kurzbericht !== false,
    ausfuehrlich: s?.ausfuehrlich !== false,
    punkte: s?.punkte !== false,
    loesung: s?.loesung === true,
});

/** CONTRACT.md, "Release filter": what a student may see of one result. */
function releaseFilter(results, settings) {
    return (Array.isArray(results) ? results : []).map((item) => {
        const out = { question_id: item.question_id };
        if (item.question_text !== undefined) out.question_text = item.question_text;
        if (settings.punkte && item.score !== undefined) out.score = item.score;
        if (settings.kurzbericht && item.concise_feedback !== undefined) out.concise_feedback = item.concise_feedback;
        if (settings.ausfuehrlich) {
            let detail = String(item.detailed_feedback || '');
            if (!settings.loesung) detail = detail.replace(/\s*\(Lösung:[^)]*\)\s*$/, '').trim();
            out.detailed_feedback = detail;
        }
        return out;
    });
}

/**
 * Saves the assessment in `feedback/{pairDoc}` and, in the same batch, writes the filtered
 * copy to `feedbackReleased/{pairDoc}` (released) or deletes it (not released). One commit:
 * the two documents cannot end up contradicting each other.
 */
export const publishFeedback = async (targetStudentKey, assignmentId, feedbackData, releaseSettings, released) => {
    try {
        if (!targetStudentKey || !assignmentId) throw new Error("'publishFeedback' braucht Lernende/n und Aufgabe.");
        const uid = targetStudentKey;
        const id = pairDoc(uid, assignmentId);
        const settings = normalizeSettings(releaseSettings);
        const data = withoutNames(feedbackData);

        const batch = writeBatch(liveDb);
        batch.set(doc(liveDb, 'feedback', id), {
            ...data, uid, assignmentId, released: !!released, releaseSettings: settings, publishedAt: serverTimestamp(),
        });
        const releasedRef = doc(liveDb, 'feedbackReleased', id);
        if (released) {
            const copy = { uid, assignmentId, results: releaseFilter(data.results, settings), releaseSettings: settings };
            if (data.date_str !== undefined) copy.date_str = data.date_str;
            batch.set(releasedRef, copy);
        } else {
            batch.delete(releasedRef);
        }
        await batch.commit();
        return { status: 'success' };
    } catch (e) {
        console.error('[feedback] save:', e);
        return { status: 'error', message: e.message };
    }
};

export const getPublishedFeedbackStatus = async (targetStudentKey, assignmentId) => {
    try {
        const snap = await getDoc(doc(liveDb, 'feedback', pairDoc(targetStudentKey, assignmentId)));
        if (!snap.exists()) return { found: false, released: false, releaseSettings: {} };
        return { found: true, released: !!snap.get('released'), releaseSettings: snap.get('releaseSettings') || {} };
    } catch (e) {
        return { found: false, released: false, releaseSettings: {} };
    }
};

// ---- formativ: what the student received, for the teacher --------------------------------

/**
 * The finished formativ feedback of one student for one assignment, keyed
 * `"<subId>::<questionId>"` — the view the old `formativTeacher` action returned.
 */
export const getFormativSlots = async (targetStudentKey, assignmentId) => {
    const snap = await getDoc(doc(liveDb, 'formativUsage', pairDoc(targetStudentKey, assignmentId)));
    const out = {};
    for (const [key, e] of Object.entries((snap.exists() && snap.get('slots')) || {})) {
        if (e?.state !== 'done') continue;
        const view = (a) => ({
            at: a.at, result: a.result, gesendet: a.gesendet ?? null,
            prompt_version: a.prompt_version ?? null, rubrik_version: a.rubrik_version ?? null,
            names_masked: a.names_masked ?? 0,
        });
        // The latest attempt is flat in the entry, earlier ones in frueher[] (CONTRACT.md, «Formative feedback»).
        out[key] = { ...view(e), frueher: (Array.isArray(e.frueher) ? e.frueher : []).map(view) };
    }
    return out;
};

// ---- paste hints: pasteEvents (CONTRACT.md) ------------------------------------------------

/**
 * Hints that a student inserted text instead of typing it, for one assignment, oldest first:
 * `[{ subId, questionId, kind, chars, excerpt, at: Date|null }]`. Asked for by uid, like the drafts.
 */
export const getPasteEvents = async (targetStudentKey, assignmentId) => {
    const snap = await getDocs(query(collection(liveDb, 'pasteEvents'),
        where('uid', '==', targetStudentKey), where('assignmentId', '==', assignmentId)));
    return snap.docs.map((d) => {
        const e = d.data();
        return {
            subId: String(e.subId ?? ''), questionId: String(e.questionId ?? ''),
            kind: String(e.kind ?? ''), chars: Number(e.chars) || 0,
            excerpt: String(e.excerpt ?? ''), at: e.at?.toDate?.() || null,
        };
    }).sort((a, b) => (a.at?.getTime() || 0) - (b.at?.getTime() || 0));
};

// ---- local evaluator (http://localhost:5000) — unchanged interface --------------------------
// `className` is the class id and `studentName` the display name from the roster: the
// evaluator files its results in folders by those two.

export const getMasterAssignment = async (assignmentId) => {
    try {
        const masterRes = await fetch(`${EVALUATOR_URL}/get_master_assignment`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ assignmentId })
        });
        if (masterRes.ok) {
            return await masterRes.json();
        }
    } catch (e) {
        console.log("Local server offline or master not found.");
    }
    return null;
};

export const getFeedback = async (className, assignmentId, studentName) => {
    try {
        const response = await fetch(`${EVALUATOR_URL}/get_feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className, assignmentId, studentName })
        });
        return await response.json();
    } catch (e) {
        return null;
    }
};

export const updateFeedback = async (className, assignmentId, studentName, questionId, score, conciseFeedback, detailedFeedback) => {
    try {
        const response = await fetch(`${EVALUATOR_URL}/update_feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                className,
                assignmentId,
                studentName,
                questionId,
                score,
                concise_feedback: conciseFeedback,
                detailed_feedback: detailedFeedback
            })
        });
        return await response.json();
    } catch (e) {
        return { error: e.message || 'Netzwerkfehler bei /update_feedback' };
    }
};

export const assessStudent = async (className, assignmentId, studentName, studentData) => {
    const controller = new AbortController();
    const timeoutMs = 120000;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`${EVALUATOR_URL}/assess`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: controller.signal,
            body: JSON.stringify({
                className,
                assignmentId,
                studentName,
                studentData
            })
        });
        return await response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            return { error: `Timeout nach ${Math.round(timeoutMs / 1000)}s bei der Bewertung.` };
        }
        return { error: error.message || 'Netzwerkfehler bei /assess' };
    } finally {
        clearTimeout(timeoutId);
    }
};
