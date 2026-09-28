//
//  js/api.js — the only place in the student surface that talks to the network.
//
//  Every other module calls these named functions and never sees URLs,
//  request bodies or response formats. Swapping the backend (Supabase,
//  Firestore) later means changing this file only.
//
import { SCRIPT_URL } from './config.js';

export class ApiError extends Error {
    constructor(message, { status = null, code = null } = {}) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
    }
}

async function parse(response) {
    let data = null;
    try { data = await response.json(); } catch { /* non-JSON body */ }
    if (!response.ok || data?.status === 'error') {
        throw new ApiError(data?.message || `Server antwortete mit ${response.status}`, {
            status: response.status,
            code: data?.code || null,
        });
    }
    return data;
}

async function post(action, body = {}) {
    const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...body }),
    });
    return parse(response);
}

export async function getAssignment(assignmentId) {
    const response = await fetch(`${SCRIPT_URL}?assignmentId=${encodeURIComponent(assignmentId)}`);
    return parse(response);
}

export const authenticateStudent = (studentKey, mode) =>
    post('authenticateStudent', { studentKey, mode });

export const getDraft = (studentKey, assignmentId, mode) =>
    post('getDraft', { studentKey, assignmentId, mode });

export const saveDraft = (studentKey, assignmentId, payload, mode) =>
    post('saveDraft', { studentKey, assignmentId, payload, mode });

export const submitAssignments = (identifier, payload, mode) =>
    post('submit', { identifier, payload, mode });

export const getReleasedFeedback = (studentKey, assignmentId, mode) =>
    post('getFeedback', { studentKey, assignmentId, mode });

/** Which questions of this assignment already used their formativ feedback. */
export const getFormativStatus = (studentKey, assignmentId, mode) =>
    post('formativStatus', { studentKey, assignmentId, mode });

/**
 * Asks for formative feedback on one answer. The rubric is looked up on the
 * server; the client only says which field and sends the frozen text.
 */
export const requestFormativ = (studentKey, assignmentId, subId, questionId, text, mode) =>
    post('formativ', { studentKey, assignmentId, subId, questionId, text, mode });
