// LMS Box — callable functions for formative feedback and the class analysis (codebase `lmsbox`, europe-west6).
// Binding spec: ../CONTRACT.md, "Callable functions". Logic: ./formativ.js.
//
// Deploy only with a target:  firebase deploy --only functions:lmsbox
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString, defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const formativ = require('./formativ');
const klassenanalyse = require('./klassenanalyse');

// Set at deploy time, never in code (the repo is public).
const FORMATIV_URL = defineString('FORMATIV_URL', {
    default: '', description: 'Base URL of the formativ service. Empty = feedback switched off (not_configured).',
});
const FORMATIV_ORIGIN = defineString('FORMATIV_ORIGIN', {
    default: '', description: 'Origin header the formativ service expects from this caller.',
});
const FORMATIV_NAME_REPLACEMENT = defineString('FORMATIV_NAME_REPLACEMENT', {
    default: 'mask', description: '"mask": own name becomes [Name]. "pseudonym": own name becomes the pseudonym.',
});
const FORMATIV_PSEUDONYM_SECRET = defineSecret('FORMATIV_PSEUDONYM_SECRET');

const REGION = 'europe-west6';
const app = initializeApp();
const rosterDb = getFirestore(app);            // (default): students/{uid}, read only
const boxDb = getFirestore(app, 'lmsbox');     // assignments, formativUsage

/*
 * FormativError.code → HttpsError status. `details` is always { code, result? };
 * the client branches on details.code, the status only mirrors the old HTTP status.
 *
 *   code             old HTTP   HttpsError status
 *   unauthenticated  401        unauthenticated
 *   forbidden        —          permission-denied    (new: no active roster doc; raised here)
 *   bad_request      400        invalid-argument
 *   too_short        400        invalid-argument
 *   not_found        404        not-found
 *   not_configured   404        not-found            (question has no formativ config)
 *   not_configured   503        unavailable          (FORMATIV_URL empty; raised here)
 *   already_used     409        already-exists       (no attempt left; details.result = latest public result)
 *   unchanged        409        failed-precondition  (further attempt with the same text as the latest)
 *   conflict         409        aborted              (a request for this field is running)
 *   quota            503        resource-exhausted
 *   unavailable      503        unavailable
 *
 * Anything that is not a FormativError leaves as `internal` without details.
 */
const STATUS = {
    unauthenticated: 'unauthenticated',
    bad_request: 'invalid-argument',
    too_short: 'invalid-argument',
    not_found: 'not-found',
    not_configured: 'not-found',
    already_used: 'already-exists',
    unchanged: 'failed-precondition',
    conflict: 'aborted',
    quota: 'resource-exhausted',
    unavailable: 'unavailable',
};

function toHttpsError(e) {
    const details = { code: e.code };
    if (e.entry?.result) details.result = e.entry.result;
    return new HttpsError(STATUS[e.code] || 'unknown', e.message, details);
}

/** Signed in and on the roster. The name comes from the roster, never from the client. */
async function caller(request) {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.', { code: 'unauthenticated' });
    const snap = await rosterDb.doc(`students/${uid}`).get();
    if (!snap.exists || snap.get('active') === false) {
        throw new HttpsError('permission-denied', 'Kein Zugang mit diesem Konto.', { code: 'forbidden' });
    }
    return { uid, studentInfo: { name: snap.get('name') || '' } };
}

function badRequest(message) {
    return new HttpsError('invalid-argument', message, { code: 'bad_request' });
}

const MAX_ID = 500;     // the rules cap assignmentId and subId at 500 characters, too

/**
 * Ids that become document paths or map keys. Empty, over-long, or (assignmentId, which
 * is used as a document id after encodeURIComponent) "." / ".." / containing "/" is the
 * caller's mistake: bad_request, not an internal error from Firestore.
 */
function checkIds({ assignmentId, subId, questionId }) {
    for (const [name, v] of [['assignmentId', assignmentId], ['subId', subId], ['questionId', questionId]]) {
        if (v == null) continue;
        if (typeof v !== 'string') throw badRequest('assignmentId, subId und questionId müssen Text sein.');
        if (v.length === 0 || v.length > MAX_ID) throw badRequest(`${name} ist leer oder länger als ${MAX_ID} Zeichen.`);
    }
    if (typeof assignmentId === 'string' && (assignmentId === '.' || assignmentId === '..' || assignmentId.includes('/'))) {
        throw badRequest('assignmentId ist ungültig.');
    }
}

// timeoutSeconds: the model call aborts itself after 65 s; reserve + settle need a few
// Firestore round trips around it. Stays below formativ's 2-minute pending TTL.
exports.boxFormativ = onCall(
    { region: REGION, maxInstances: 10, timeoutSeconds: 100, memory: '256MiB', secrets: [FORMATIV_PSEUDONYM_SECRET] },
    async (request) => {
        const { uid, studentInfo } = await caller(request);
        const url = FORMATIV_URL.value();
        if (!url) throw new HttpsError('unavailable', 'Rückmeldung ist nicht eingerichtet.', { code: 'not_configured' });

        const { assignmentId, subId, questionId, text } = request.data || {};
        checkIds({ assignmentId, subId, questionId });
        try {
            return await formativ.requestFeedback(
                { uid, studentInfo, assignmentId, subId, questionId, text },
                {
                    store: formativ.firestoreStore(boxDb, { uid, assignmentId }),
                    loadAssignment: async (id) => (await boxDb.doc(`assignments/${encodeURIComponent(id)}`).get()).data() ?? null,
                    formativ: { url, origin: FORMATIV_ORIGIN.value() },
                    pseudonymSecret: FORMATIV_PSEUDONYM_SECRET.value(),
                    nameReplacement: FORMATIV_NAME_REPLACEMENT.value(),
                },
            );
        } catch (e) {
            if (e instanceof formativ.FormativError) throw toHttpsError(e);
            throw e;
        }
    },
);

/*
 * Single sign-on from the Lernportal (CONTRACT.md, «Single sign-on»). A student who is
 * signed in at the Lernportal asks, from a popup on the Lernportal's own origin, for a
 * custom token; LMS Box signs in with it (`signInWithCustomToken`) and the student has
 * the same uid as at the Lernportal, without typing the password again.
 *
 * The caller must be what the rules call a school account (password sign-in, address
 * @lernende.bbw.ch) and be on the roster. The token carries the claim `lmsboxSso`; that
 * claim is what `isSchoolAccount()` accepts in place of the password provider, so only
 * this function can create such a session (it alone holds the signing right).
 */
const SCHOOL_DOMAIN = '@lernende.bbw.ch';

exports.boxSsoToken = onCall(
    { region: REGION, maxInstances: 10, timeoutSeconds: 30, memory: '256MiB' },
    async (request) => {
        const { uid } = await caller(request);
        const t = request.auth.token || {};
        const email = String(t.email || '').toLowerCase();
        if (t.firebase?.sign_in_provider !== 'password' || !email.endsWith(SCHOOL_DOMAIN)) {
            throw new HttpsError('permission-denied', 'Nur für Lernenden-Konten.', { code: 'forbidden' });
        }
        const token = await getAuth(app).createCustomToken(uid, { lmsboxSso: true });
        return { token };
    },
);

/*
 * KI-Klassenanalyse (CONTRACT.md, «Class analysis»), Infomaniak or Gemini. Callable for the teacher and a trigger
 * on drafts that starts it on its own at 5, 8, 11 … completed students, for assignments with
 * `klassenanalyse: true`. Logic: ./klassenanalyse.js.
 *
 *   code        HttpsError status
 *   forbidden   permission-denied    (no teacher claim)
 *   bad_request invalid-argument
 *   not_found   not-found            (assignment, card or class unknown)
 *   zu_wenige   failed-precondition  (fewer than 5 completed)
 *   laeuft      aborted              (a run for this card is going)
 *   pause       resource-exhausted   (started less than a minute ago)
 *   not_configured, unavailable, unusable  unavailable
 *   quota       resource-exhausted
 */
const GEMINI_API_KEY = defineSecret('GEMINI_API_KEY');
const INFOMANIAK_API_TOKEN = defineSecret('INFOMANIAK_API_TOKEN');
const KLASSENANALYSE_ANBIETER = defineString('KLASSENANALYSE_ANBIETER', {
    default: 'infomaniak', description: 'Provider of the class analysis: "infomaniak" (Switzerland) or "gemini" (Google). The teacher may pick the other one per run.',
});
const KLASSENANALYSE_MODELL_INFOMANIAK = defineString('KLASSENANALYSE_MODELL_INFOMANIAK', {
    default: 'google/gemma-4-31B-it', description: 'Infomaniak model of the class analysis.',
});
const KLASSENANALYSE_MODELL_GEMINI = defineString('KLASSENANALYSE_MODELL_GEMINI', {
    default: 'gemini-3.8-flash', description: 'Gemini model of the class analysis (prices: scripts/kosten-preise.json).',
});
const INFOMANIAK_PRODUKT = defineString('INFOMANIAK_PRODUKT', {
    description: 'Infomaniak AI Tools product_id (GET /1/ai), digits only.',
});
const ANALYSE_STATUS = {
    not_found: 'not-found', zu_wenige: 'failed-precondition', laeuft: 'aborted', pause: 'resource-exhausted',
    not_configured: 'unavailable', unavailable: 'unavailable', unusable: 'unavailable', quota: 'resource-exhausted',
};

function analyseDeps() {
    // Emulator only: local stand-ins for both providers (test/fake-gemini.js). Ignored in the cloud.
    const emu = process.env.FUNCTIONS_EMULATOR === 'true';
    return klassenanalyse.firestoreDeps({
        rosterDb, boxDb,
        modell: {
            anbieter: KLASSENANALYSE_ANBIETER.value(),
            infomaniak: {
                apiKey: INFOMANIAK_API_TOKEN.value(), produktId: INFOMANIAK_PRODUKT.value(),
                // reasoning_effort per model: klassenanalyse.INFOMANIAK_MODELLE (Gemma: high)
                model: KLASSENANALYSE_MODELL_INFOMANIAK.value(), reasoningEffort: 'high',
                ...(emu && process.env.INFOMANIAK_BASE_URL ? { baseUrl: process.env.INFOMANIAK_BASE_URL } : {}),
            },
            gemini: {
                apiKey: GEMINI_API_KEY.value(), model: KLASSENANALYSE_MODELL_GEMINI.value(),
                ...(emu && process.env.GEMINI_BASE_URL ? { baseUrl: process.env.GEMINI_BASE_URL } : {}),
            },
        },
    });
}

/** The caller must carry the custom claim role == "teacher" (as the rules' isTeacher()). */
function teacher(request) {
    if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Anmeldung erforderlich.', { code: 'unauthenticated' });
    if (request.auth.token?.role !== 'teacher') {
        throw new HttpsError('permission-denied', 'Nur für Lehrpersonen.', { code: 'forbidden' });
    }
    return request.auth.uid;
}

exports.boxKlassenanalyse = onCall(
    { region: REGION, maxInstances: 5, timeoutSeconds: 300, memory: '512MiB', secrets: [GEMINI_API_KEY, INFOMANIAK_API_TOKEN] },
    async (request) => {
        const uid = teacher(request);
        const { classId, assignmentId, subId, anbieter = null, modell = null } = request.data || {};
        checkIds({ assignmentId, subId });
        if (anbieter !== null && !klassenanalyse.ANBIETER.includes(anbieter)) throw badRequest("anbieter ist 'infomaniak' oder 'gemini'.");
        if (modell !== null && (anbieter !== 'infomaniak' || !klassenanalyse.INFOMANIAK_MODELLE[modell])) {
            throw badRequest('Dieses Modell ist für die Klassenanalyse nicht freigegeben.');
        }
        if (typeof classId !== 'string' || !classId || classId.length > 100 || !assignmentId || !subId) {
            throw badRequest("'boxKlassenanalyse' braucht classId, assignmentId und subId.");
        }
        try {
            return await klassenanalyse.analysieren({ classId, assignmentId, subId, modus: 'manuell', ausgeloest_von: uid, anbieter, modell }, analyseDeps());
        } catch (e) {
            if (e instanceof klassenanalyse.AnalyseFehler) {
                throw new HttpsError(ANALYSE_STATUS[e.code] || 'internal', e.message, { code: e.code });
            }
            throw e;
        }
    },
);

exports.boxKlassenanalyseAuto = onDocumentWritten(
    {
        document: 'drafts/{draftId}', database: 'lmsbox', region: REGION,
        maxInstances: 5, timeoutSeconds: 300, memory: '512MiB', secrets: [GEMINI_API_KEY, INFOMANIAK_API_TOKEN], retry: false,
    },
    async (event) => {
        const after = event.data?.after?.exists ? event.data.after.data() : null;
        const out = await klassenanalyse.beiDraft(after, analyseDeps());
        for (const r of out) if (r.status !== 'uebersprungen') console.log('klassenanalyse', r.status, r.code || '', r.id);
    },
);

exports.boxFormativStatus = onCall(
    { region: REGION, maxInstances: 10, timeoutSeconds: 30, memory: '256MiB' },
    async (request) => {
        const { uid } = await caller(request);
        const { assignmentId } = request.data || {};
        if (!assignmentId || typeof assignmentId !== 'string') throw badRequest("'boxFormativStatus' braucht 'assignmentId'.");
        checkIds({ assignmentId });
        const slots = await formativ.status({ store: formativ.firestoreStore(boxDb), uid, assignmentId });
        return { slots, max: formativ.MAX_VERSUCHE };
    },
);
