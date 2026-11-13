// LMS Box — Musterlösungen für Lernende, freigegeben nach Klasse und Zeit.
// Binding spec: ../CONTRACT.md, «Released solutions». Pure logic; index.js wires Firestore.
//
// Source is the assignment document itself (`assignments/...`, teacher-only, the same JSON as
// content/): a question may carry `loesung` (text for students), the assignment carries
//   loesungFreigabe: [ { klassen: ['4pk25a'], ab: '2026-11-13T17:00:00+01:00' } ]
// The server compares the caller's roster class with `klassen` and the server clock with `ab`.
// Nothing is returned before then, not even the existence of a solution. The public copy
// (publicAssignments) is a whitelist and never carries either field.

/** Class ids compared case-insensitively and without surrounding blanks. */
function norm(s) {
    return String(s ?? '').trim().toLowerCase();
}

/** The classes of a roster record: `classIds` (list) and `classId` (single), merged. */
function classesOf(student) {
    const out = new Set();
    for (const c of Array.isArray(student?.classIds) ? student.classIds : []) out.add(norm(c));
    if (student?.classId) out.add(norm(student.classId));
    out.delete('');
    return out;
}

/** `ab` as a Date: ISO string with offset, a Date, or a Firestore Timestamp. Invalid → null. */
function toDate(ab) {
    if (ab == null) return null;
    const d = typeof ab.toDate === 'function' ? ab.toDate() : new Date(ab);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** `{ [subId]: { [questionId]: text } }` of all questions that carry a non-empty `loesung`. */
function sammeln(assignment) {
    const out = {};
    for (const [subId, sub] of Object.entries(assignment?.subAssignments ?? {})) {
        for (const q of Array.isArray(sub?.questions) ? sub.questions : []) {
            if (typeof q?.loesung === 'string' && q.loesung.trim() && q.id != null) (out[subId] ??= {})[String(q.id)] = q.loesung;
        }
    }
    return out;
}

/**
 * @param {{classIds?: string[], classId?: string}} student  roster record (students/{uid})
 * @param {object|null} assignment                            the `assignments/...` document
 * @param {Date} now                                          server time
 * @returns {{frei: boolean, loesungen?: object}}             `loesungen` only when frei
 */
function freigegeben(student, assignment, now) {
    if (!assignment || typeof assignment !== 'object') return { frei: false };
    const mine = classesOf(student);
    if (mine.size === 0) return { frei: false };
    for (const f of Array.isArray(assignment.loesungFreigabe) ? assignment.loesungFreigabe : []) {
        const ab = toDate(f?.ab);
        if (!ab || ab.getTime() > now.getTime()) continue;
        const klassen = (Array.isArray(f.klassen) ? f.klassen : []).map(norm);
        if (!klassen.some((k) => mine.has(k))) continue;
        const loesungen = sammeln(assignment);
        return Object.keys(loesungen).length ? { frei: true, loesungen } : { frei: false };
    }
    return { frei: false };
}

module.exports = { freigegeben, classesOf, toDate, sammeln };
