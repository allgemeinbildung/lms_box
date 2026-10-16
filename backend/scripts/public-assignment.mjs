// The public copy of an assignment (CONTRACT.md, «Public copy and guest mode»).
// A whitelist: a field that is not named here never reaches `publicAssignments`,
// so a solution or rubric added to the content later stays private by default.

const flag = (v) => (v === undefined ? undefined : v !== false && v !== null && v !== 0 && v !== '');

/** Drops keys whose value is undefined (Firestore refuses them). */
function compact(obj) {
    return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}

/**
 * @param {object} data the content JSON plus `assignmentId`, as written to `assignments`
 * @returns {object} what may be read without sign-in
 */
export function publicCopy(data) {
    const subs = data?.subAssignments && typeof data.subAssignments === 'object' ? data.subAssignments : {};
    return compact({
        assignmentId: String(data.assignmentId),
        assignmentTitle: String(data.assignmentTitle ?? ''),
        formativ: flag(data.formativ),
        subAssignments: Object.fromEntries(Object.entries(subs).map(([subId, sub]) => [subId, compact({
            type: String(sub?.type ?? ''),
            titel: typeof sub?.titel === 'string' ? sub.titel : undefined,
            formativ: flag(sub?.formativ),
            questions: (Array.isArray(sub?.questions) ? sub.questions : []).map((q) => compact({
                id: String(q?.id ?? ''),
                text: String(q?.text ?? ''),
                formativ: flag(q?.formativ),
            })),
        })])),
    });
}
