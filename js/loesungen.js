//
//  js/loesungen.js — released model solutions under each editor of this frame.
//
//  Asks the function boxLoesungen once per page load. The server decides by roster class and
//  its own clock (CONTRACT.md, «Released solutions»); before the release it answers
//  `{ frei: false }` and nothing is drawn. Text only (textContent), never HTML.
//
import { getLoesungen } from './api.js';

const KARTE = 'margin-top: 8px; background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 6px 12px; color: #334155;';

export const fetchAndRenderLoesungen = async (assignmentId, subId) => {
    let res;
    try {
        res = await getLoesungen(assignmentId);
    } catch (e) {
        return;   // silent: the page stays as it is
    }
    if (!res || res.frei !== true || !res.loesungen) return;
    const fuerSub = res.loesungen[subId];
    if (!fuerSub || typeof fuerSub !== 'object') return;

    document.querySelectorAll('.musterloesung').forEach((n) => n.remove());
    const sanitizedSubId = String(subId).replace(/[^a-zA-Z0-9-_]/g, '-');
    for (const [questionId, text] of Object.entries(fuerSub)) {
        if (typeof text !== 'string' || !text.trim()) continue;
        const sanitizedQuestionId = String(questionId).replace(/[^a-zA-Z0-9-_]/g, '-');
        const block = document.getElementById(`quill-editor-${sanitizedSubId}-${sanitizedQuestionId}`)?.closest('.question-block');
        if (!block) continue;

        const details = document.createElement('details');
        details.className = 'musterloesung';
        details.style.cssText = KARTE;
        const summary = document.createElement('summary');
        summary.style.cssText = 'cursor: pointer; font-weight: 600;';
        summary.textContent = 'Musterlösung';
        const body = document.createElement('div');
        body.style.cssText = 'white-space: pre-line; font-size: 0.9em; margin-top: 6px;';
        body.textContent = text;
        details.append(summary, body);
        block.appendChild(details);
    }
};
