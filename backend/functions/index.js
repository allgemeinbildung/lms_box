// LMS Box — callable functions for formative feedback (codebase `lmsbox`, europe-west6).
// Binding spec: ../CONTRACT.md, "Callable functions". Logic: ./formativ.js.
//
// Deploy only with a target:  firebase deploy --only functions:lmsbox
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineString, defineSecret } = require('firebase-functions/params');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const formativ = require('./formativ');

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
 *   already_used     409        already-exists       (details.result = stored public result, if done)
 *   conflict         409        aborted
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

exports.boxFormativStatus = onCall(
    { region: REGION, maxInstances: 10, timeoutSeconds: 30, memory: '256MiB' },
    async (request) => {
        const { uid } = await caller(request);
        const { assignmentId } = request.data || {};
        if (!assignmentId || typeof assignmentId !== 'string') throw badRequest("'boxFormativStatus' braucht 'assignmentId'.");
        checkIds({ assignmentId });
        const slots = await formativ.status({ store: formativ.firestoreStore(boxDb), uid, assignmentId });
        return { slots };
    },
);
