import { SCRIPT_URL } from '../../js/config.js';
import { state } from './state.js';

export const listDrafts = async () => {
    const response = await fetch(SCRIPT_URL, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'listDrafts', teacherKey: state.currentTeacherKey })
    });
    return await response.json();
};

export const fetchDraftContent = async (path) => {
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'getDraft', teacherKey: state.currentTeacherKey, draftPath: path })
        });
        const data = await response.json();
        if (data.status === 'error') throw new Error(data.message);
        return data;
    } catch (error) { return null; }
};

export const getMasterAssignment = async (assignmentId) => {
    try {
        const masterRes = await fetch('http://localhost:5000/get_master_assignment', {
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
        const response = await fetch('http://localhost:5000/get_feedback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ className, assignmentId, studentName })
        });
        return await response.json();
    } catch (e) {
        return null;
    }
};

export const publishFeedback = async (targetStudentKey, assignmentId, feedbackData, releaseSettings, released) => {
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'saveFeedback',
                teacherKey: state.currentTeacherKey,
                targetStudentKey,
                assignmentId,
                feedbackData,
                releaseSettings,
                released
            })
        });
        return await response.json();
    } catch (e) {
        return { status: 'error', message: e.message };
    }
};

export const getPublishedFeedbackStatus = async (targetStudentKey, assignmentId) => {
    try {
        const response = await fetch(SCRIPT_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action: 'getFeedbackStatus',
                teacherKey: state.currentTeacherKey,
                targetStudentKey,
                assignmentId
            })
        });
        return await response.json();
    } catch (e) {
        return { found: false, released: false, releaseSettings: {} };
    }
};

export const updateFeedback = async (className, assignmentId, studentName, questionId, score, conciseFeedback, detailedFeedback) => {
    try {
        const response = await fetch('http://localhost:5000/update_feedback', {
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
        const response = await fetch('http://localhost:5000/assess', {
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
