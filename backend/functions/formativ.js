// formativ.js — formative feedback on a single Quill answer via the formativ service.
//
// Rules this module enforces (Router §4, formativ KONZEPT §6/§9):
//   - only logged-in students (the caller has already checked the roster doc of the uid);
//   - one feedback per Quill field and student; a technical failure gives the
//     attempt back, because an outage must not lock anyone out;
//   - the rubric comes from the assignment on the server, never from the client;
//   - no name, key or class goes to formativ. The student's own name is also
//     masked inside the text — that lowers the risk, it does not anonymise.

const crypto = require('crypto');

const USAGE_COLLECTION = 'formativUsage';
const MIN_WORDS = 15;
const MAX_CHARS = 16000;
const NAME_MASK = '[Name]';
// A reservation older than this belongs to a crashed call and is free again.
const PENDING_TTL_MS = 2 * 60 * 1000;

// Codes in formativ SCHEMA §3 that describe the service, not the text.
const TECHNICAL_REASONS = new Set(['modell_ausfall', 'zeit_ueberschritten', 'antwort_unbrauchbar', 'antwort_abgeschnitten']);

class FormativError extends Error {
    constructor(message, code, httpStatus = 400) {
        super(message);
        this.code = code;
        this.httpStatus = httpStatus;
    }
}

const ENTITIES = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

/** Quill HTML → plain text, paragraphs as line breaks. */
function htmlToText(html) {
    return String(html || '')
        .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<li[^>]*>/gi, '- ')
        .replace(/<[^>]+>/g, '')
        .replace(/&[a-z#0-9]+;/gi, (e) => ENTITIES[e.toLowerCase()] ?? ' ')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

/** Markdown emphasis from the question text is noise for the model. */
function stripMarkdown(text) {
    return String(text || '').replace(/\*\*(.*?)\*\*/g, '$1').replace(/(^|\W)[_*](.+?)[_*](?=\W|$)/g, '$1$2');
}

function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Replaces each part of the student's registered name (≥ 3 letters) in the text.
 * Catches the obvious case — a student signing with their own name. It does not
 * find classmates, employers or anything else identifying (KONZEPT §9.3).
 */
function maskOwnName(text, fullName, replacement = NAME_MASK) {
    const parts = String(fullName || '')
        .split(/[\s,.\-]+/)
        .map((p) => p.trim())
        .filter((p) => p.length >= 3);
    let out = text;
    let masked = 0;
    for (const part of parts) {
        const re = new RegExp(`(?<![\\p{L}])${escapeRegex(part)}(?![\\p{L}])`, 'giu');
        out = out.replace(re, () => { masked += 1; return replacement; });
    }
    return { text: out, masked };
}

/**
 * Stable pseudonym per student: HMAC of the uid with a secret.
 * Same student → same pseudonym, recomputable by whoever holds uids and secret;
 * without the secret it points to no one. No mapping table is stored.
 */
function pseudonym(uid, secret) {
    if (!secret || !uid) return null;
    return `L-${crypto.createHmac('sha256', secret).update(String(uid)).digest('hex').slice(0, 8)}`;
}

function slotKey(subId, questionId) {
    return `${subId}::${questionId}`;
}

function findQuestion(assignment, subId, questionId) {
    const sub = assignment?.subAssignments?.[subId];
    if (!sub) return null;
    const question = (sub.questions || []).find((q) => q.id === questionId);
    if (!question) return null;
    const solution = (sub.solution?.solutions || []).find((s) => s.id === questionId) || null;
    return { sub, question, solution };
}

const AUTO_MAX_KRITERIEN = 2;
const AUTO_RUBRIK_VERSION = 'auto-v1';

/**
 * Criteria straight from the question text: one per sentence of the question,
 * at most two (tested 28.09.2026: more than two is too much for short
 * questions). Extra sentences are merged into the second criterion. The model
 * answer goes along as context and is the yardstick.
 */
function autoRubrik(questionText, max = AUTO_MAX_KRITERIEN) {
    const MARK = '\u0000';
    // Protect abbreviations so "OR Art. 11" or "S. 245" do not end a sentence.
    const guarded = stripMarkdown(questionText).replace(/\b(Art|S|z\.B|bzw|vgl|ca|Abs|Nr)\./g, `$1${MARK}`);
    const parts = guarded
        .split(/(?<=[?!])\s+|(?<=\.)\s+(?=[A-ZÄÖÜ])/)
        .map((s) => s.split(MARK).join('.').trim())
        .filter((s) => s.split(/\s+/).length >= 3);
    if (parts.length === 0) parts.push(stripMarkdown(questionText).trim());
    if (parts.length > max) parts.splice(max - 1, parts.length, parts.slice(max - 1).join(' '));
    // The label sits right under the question on the page: a short cue, not the question again.
    const shortLabel = (p) => {
        const words = p.replace(/\s*\([^)]*\)/g, '').split(/\s+/);
        return words.length <= 6 ? words.join(' ') : `${words.slice(0, 6).join(' ').replace(/[,:;]$/, '')} …`;
    };
    return parts.map((p, i) => ({
        id: `k${i + 1}`,
        label: shortLabel(p),
        erwartung: `${p} Massstab ist die Musterlösung im Kontext.`.slice(0, 1000),
    }));
}

/**
 * Where feedback is switched on, most specific first:
 *   question.formativ  — object with its own rubric, `true` for auto, `false` to switch off
 *   sub.formativ       — `true`: auto for every question of this sub-assignment
 *   assignment.formativ — `true`: auto for the whole assignment
 * Returns null when feedback is off for this question.
 */
function formativConfig(assignment, sub, question) {
    const own = question.formativ;
    if (own === false) return null;
    if (own && typeof own === 'object') return own;
    const on = own === true || sub?.formativ === true || assignment?.formativ === true;
    if (!on) return null;
    return { rubrik_version: AUTO_RUBRIK_VERSION, rubrik: autoRubrik(question.text) };
}

/**
 * The request body for formativ POST /v1/bewerten (SCHEMA §1).
 * An explicit rubric object may carry: { rubrik_version, rubrik[] | standardrubrik,
 * kontext?, mehrdeutig?, kontext_aus_musterloesung? }.
 */
function buildRequest({ assignmentId, subId, assignment, sub, question, solution }, text) {
    const cfg = formativConfig(assignment, sub, question);
    if (!cfg) throw new FormativError('Für diese Frage ist keine Rückmeldung eingerichtet.', 'not_configured', 404);

    let kontext = cfg.kontext ?? null;
    if (!kontext && cfg.kontext_aus_musterloesung !== false && solution?.answer) {
        kontext = `Musterlösung der Lehrperson:\n${htmlToText(solution.answer)}`;
    }

    const body = {
        aufgabe: stripMarkdown(question.text).slice(0, 4000),
        kontext: kontext ? kontext.slice(0, 8000) : null,
        mehrdeutig: cfg.mehrdeutig ?? null,
        rubrik_version: String(cfg.rubrik_version || 'v0').slice(0, 64),
        antwort: text,
        feld_id: `${assignmentId}:${subId}:${question.id}`.replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 128),
    };
    if (cfg.standardrubrik) body.standardrubrik = cfg.standardrubrik;
    else body.rubrik = cfg.rubrik;
    return body;
}

/** Retry only makes sense if at least one reason is technical (SCHEMA §4). */
function isTechnicalFailure(result) {
    if (!result || result.zustand !== 'nicht_verfuegbar') return false;
    return (result.kriterien || []).some((k) => TECHNICAL_REASONS.has(k.grund));
}

/** What the student sees. No score is ever derived (VERTRAG §4). */
function publicResult(result) {
    return {
        zustand: result.zustand,
        kriterien: (result.kriterien || []).map((k) => ({
            id: k.id, label: k.label, status: k.status, hinweis: k.hinweis, beleg: k.beleg ?? null, grund: k.grund ?? null,
        })),
    };
}

async function callFormativ(body, { url, origin, fetchFn = fetch, timeoutMs = 65000 }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = { 'content-type': 'application/json' };
        if (origin) headers.origin = origin;
        const response = await fetchFn(`${url.replace(/\/$/, '')}/v1/bewerten`, {
            method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal,
        });
        let data = null;
        try { data = await response.json(); } catch { /* empty */ }
        return { status: response.status, data };
    } catch (e) {
        return { status: 0, data: null, error: e.name === 'AbortError' ? 'timeout' : 'network' };
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Storage for used slots: formativUsage/{uid}__{enc(assignmentId)} (CONTRACT "Ids", pairDoc).
 * `store` has read(path) → { data, generation } and write(path, data, generation)
 * that fails with code 'precondition' if the generation changed (GCS
 * ifGenerationMatch, Firestore updateTime). That makes the reservation atomic:
 * two clicks in two iframes cannot both get through.
 */
function usagePath(uid, assignmentId) {
    return `${USAGE_COLLECTION}/${uid}__${encodeURIComponent(assignmentId)}`;
}

async function reserve(store, path, key) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const { data, generation } = await store.read(path);
        const usage = data || {};
        const existing = usage[key];
        const stale = existing?.state === 'pending' && Date.now() - Date.parse(existing.at) > PENDING_TTL_MS;
        if (existing && !stale) return { reserved: false, entry: existing };
        usage[key] = { state: 'pending', at: new Date().toISOString() };
        try {
            await store.write(path, usage, generation);
            return { reserved: true };
        } catch (e) {
            if (e.code !== 'precondition') throw e;
        }
    }
    throw new FormativError('Gleichzeitige Anfrage, bitte nochmals versuchen.', 'conflict', 409);
}

async function settle(store, path, key, entry) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
        const { data, generation } = await store.read(path);
        const usage = data || {};
        if (entry === null) delete usage[key];
        else usage[key] = entry;
        try {
            await store.write(path, usage, generation);
            return;
        } catch (e) {
            if (e.code !== 'precondition') throw e;
        }
    }
}

/** Status for all fields of one assignment, so the page can render used buttons. */
async function status({ store, uid, assignmentId }) {
    const { data } = await store.read(usagePath(uid, assignmentId));
    const out = {};
    for (const [key, entry] of Object.entries(data || {})) {
        if (entry.state === 'done') out[key] = { state: 'done', at: entry.at, result: entry.result };
        else if (entry.state === 'pending') out[key] = { state: 'pending', at: entry.at };
    }
    return out;
}

/**
 * Teacher view: everything stored for one student and assignment, including
 * the text that was sent to the model (name already masked) and the prompt
 * version. Not exposed as a callable: the dashboard reads formativUsage directly.
 */
async function statusTeacher({ store, uid, assignmentId }) {
    const { data } = await store.read(usagePath(uid, assignmentId));
    const out = {};
    for (const [key, e] of Object.entries(data || {})) {
        if (e.state !== 'done') continue;
        out[key] = {
            at: e.at, result: e.result, gesendet: e.gesendet ?? null,
            prompt_version: e.prompt_version ?? null, rubrik_version: e.rubrik_version ?? null,
            names_masked: e.names_masked ?? 0,
        };
    }
    return out;
}

/**
 * The whole flow for one click.
 * deps: { store, loadAssignment(assignmentId), formativ: { url, origin, fetchFn } }
 */
async function requestFeedback({ uid, studentInfo, assignmentId, subId, questionId, text }, deps) {
    if (!uid || !studentInfo) throw new FormativError('Anmeldung erforderlich.', 'unauthenticated', 401);
    if (!assignmentId || !subId || !questionId) throw new FormativError('assignmentId, subId und questionId fehlen.', 'bad_request');

    const assignment = await deps.loadAssignment(assignmentId);
    const found = findQuestion(assignment, subId, questionId);
    if (!found) throw new FormativError('Frage nicht gefunden.', 'not_found', 404);

    const plain = htmlToText(text).slice(0, MAX_CHARS);
    const words = plain.split(/\s+/).filter(Boolean).length;
    if (words < MIN_WORDS) {
        throw new FormativError(`Schreibe zuerst mindestens ${MIN_WORDS} Wörter.`, 'too_short');
    }

    const pseudo = pseudonym(uid, deps.pseudonymSecret);
    // Default: the name becomes "[Name]". With nameReplacement 'pseudonym' it becomes the student's pseudonym.
    const replacement = deps.nameReplacement === 'pseudonym' && pseudo ? pseudo : NAME_MASK;
    const { text: masked, masked: maskedCount } = maskOwnName(plain, studentInfo.name, replacement);
    const body = buildRequest({ assignmentId, subId, assignment, ...found }, masked);

    const path = usagePath(uid, assignmentId);
    const key = slotKey(subId, questionId);
    const reservation = await reserve(deps.store, path, key);
    if (!reservation.reserved) {
        const e = new FormativError('Für diese Frage hast du die Rückmeldung bereits erhalten.', 'already_used', 409);
        e.entry = reservation.entry;
        throw e;
    }

    const started = Date.now();
    const { status: httpStatus, data, error } = await callFormativ(body, deps.formativ);
    const duration = Date.now() - started;

    // No verdict or a purely technical one: give the attempt back.
    if (httpStatus !== 200 || !data || isTechnicalFailure(data)) {
        await settle(deps.store, path, key, null);
        const quota = httpStatus === 429;
        throw new FormativError(
            quota ? 'Das Tageskontingent ist erreicht. Versuche es später wieder.'
                  : 'Die Rückmeldung ist gerade nicht verfügbar. Dein Versuch zählt nicht — versuche es später nochmals.',
            quota ? 'quota' : 'unavailable', 503,
        );
    }

    const result = publicResult(data);
    await settle(deps.store, path, key, {
        state: 'done',
        at: new Date().toISOString(),
        textHash: crypto.createHash('sha256').update(plain).digest('hex').slice(0, 16),
        rubrik_version: body.rubrik_version,
        request_id: data.meta?.request_id ?? null,
        // Which system prompt produced this feedback (formativ PROMPT-VERLAUF.md).
        prompt_version: data.meta?.prompt_version ?? null,
        duration_ms: duration,
        pseudonym: pseudo,
        names_masked: maskedCount,
        // Exactly what went to the model (own name masked), for the teacher.
        gesendet: body.antwort,
        result,
    });
    return { status: 'success', result };
}

/** GCS-backed store with generation preconditions. */
function gcsStore(bucket) {
    return {
        async read(path) {
            const file = bucket.file(path);
            const [exists] = await file.exists();
            if (!exists) return { data: null, generation: 0 };
            const [[content], [meta]] = await Promise.all([file.download(), file.getMetadata()]);
            return { data: JSON.parse(content.toString('utf8')), generation: Number(meta.generation) };
        },
        async write(path, data, generation) {
            try {
                await bucket.file(path).save(JSON.stringify(data, null, 2), {
                    contentType: 'application/json',
                    resumable: false,
                    preconditionOpts: { ifGenerationMatch: generation },
                });
            } catch (e) {
                if (e.code === 412) { const p = new Error('precondition'); p.code = 'precondition'; throw p; }
                throw e;
            }
        },
    };
}

/**
 * Firestore-backed store, same contract as gcsStore. `path` is a document path.
 *
 *   document   = { ...fields, slots: <data> }     fields: e.g. { uid, assignmentId }
 *   generation = the document's updateTime, 0 when the document does not exist
 *
 * write() is one commit with a server-side precondition, the Firestore twin of
 * ifGenerationMatch:
 *   generation 0  → create(): fails if the document exists by now;
 *   otherwise     → update() with lastUpdateTime: fails if the document was
 *                   written (or deleted) since the read.
 * Either failure surfaces as code 'precondition'. No transaction: under
 * contention the emulator aborts every one of them, so nobody would win.
 *
 * update() names top-level fields only (`slots` and the keys of `fields`, which
 * must not contain dots); `slots` is replaced as a whole map, so the dots in the
 * slot keys are never read as field paths. The data goes through JSON like in
 * gcsStore, so `undefined` is dropped instead of being rejected by Firestore.
 */
function firestoreStore(db, fields = {}) {
    const GRPC_NOT_FOUND = 5;
    const GRPC_ALREADY_EXISTS = 6;
    const GRPC_FAILED_PRECONDITION = 9;
    return {
        async read(path) {
            const snap = await db.doc(path).get();
            if (!snap.exists) return { data: null, generation: 0 };
            return { data: snap.get('slots') || {}, generation: snap.updateTime };
        },
        async write(path, data, generation) {
            const ref = db.doc(path);
            const doc = { ...fields, slots: JSON.parse(JSON.stringify(data)) };
            try {
                if (!generation) await ref.create(doc);
                else await ref.update(doc, { lastUpdateTime: generation });
            } catch (e) {
                const lost = generation
                    ? e.code === GRPC_FAILED_PRECONDITION || e.code === GRPC_NOT_FOUND
                    : e.code === GRPC_ALREADY_EXISTS;
                if (lost) { const p = new Error('precondition'); p.code = 'precondition'; throw p; }
                throw e;
            }
        },
    };
}

module.exports = {
    FormativError, htmlToText, stripMarkdown, maskOwnName, pseudonym, slotKey, findQuestion,
    autoRubrik, formativConfig, AUTO_RUBRIK_VERSION, statusTeacher,
    buildRequest, isTechnicalFailure, publicResult, callFormativ, requestFeedback, status, gcsStore, firestoreStore, usagePath,
    MIN_WORDS,
};
