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

export const assessStudent = async (className, assignmentId, studentName, studentData) => {
    const response = await fetch('http://localhost:5000/assess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            className,
            assignmentId,
            studentName,
            studentData
        })
    });
    return await response.json();
};
