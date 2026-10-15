//
//  dashboard/modules/pasteHints.js — shows the teacher where a student inserted
//  text instead of typing it (pasteEvents, written by js/pasteGuard.js on the
//  student page). A hint, not proof: dictation can insert a sentence at once.
//  Read through api.js; every value goes into the DOM as text.
//
import { getPasteEvents } from './api.js';

const KIND = {
    paste: 'Eingefügt (Sperre umgangen)',
    drop: 'Hineingezogen (Drag & Drop)',
    bulk: 'Grosser Textblock auf einmal',
    fast: 'Schneller als Tippen',
};

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text; // never innerHTML: student text
    return e;
}

function renderEvents(events) {
    const box = el('div', 'margin:6px 0 10px; padding:8px 10px; border-left:3px solid #b02a37; background:#fff5f5; border-radius:0 6px 6px 0; font-size:0.9em;');
    box.className = 'paste-teacher';
    box.appendChild(el('div', 'font-weight:600; color:#b02a37; margin-bottom:4px;', `📋 Text eingefügt statt getippt (${events.length}×)`));
    for (const e of events) {
        const when = e.at ? e.at.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        const det = el('details', 'margin:3px 0;');
        det.appendChild(el('summary', 'cursor:pointer;', `${when} · ${KIND[e.kind] || e.kind} · ${e.chars} Zeichen`));
        det.appendChild(el('div', 'white-space:pre-wrap; background:#fff; border:1px solid #dee2e6; border-radius:4px; padding:6px; margin-top:4px; color:#333;',
            e.excerpt + (e.chars > e.excerpt.length ? ' …' : '')));
        box.appendChild(det);
    }
    return box;
}

/**
 * Loads the student's paste hints and places them under the matching answers of the
 * card (event subId/questionId ↔ data-qid "subId_questionId"). Adds a count badge to
 * the card header. Fails silently: the card stays as it is.
 */
export async function attachPasteToCard(card, studentKey, assignmentId) {
    if (!studentKey) return;
    let events;
    try { events = await getPasteEvents(studentKey, assignmentId); } catch { return; }   // studentKey = uid
    if (events.length === 0) return;

    const byQid = new Map();
    for (const e of events) {
        const qid = `${e.subId}_${e.questionId}`;
        if (!byQid.has(qid)) byQid.set(qid, []);
        byQid.get(qid).push(e);
    }
    for (const [qid, list] of byQid) {
        const feedbackSlot = [...card.querySelectorAll('.inline-feedback')].find((s) => s.dataset.qid === qid);
        const wrapper = feedbackSlot?.closest('.qa-wrapper');
        if (wrapper) wrapper.appendChild(renderEvents(list));
    }
    const stats = card.querySelector('.student-stats');
    if (stats) {
        const badge = el('span', 'background:#fff5f5; color:#b02a37; border:1px solid #f1aeb5; border-radius:4px; padding:1px 6px; font-size:0.8em; font-weight:600;', `📋 ${events.length}`);
        badge.title = `${events.length}× Text eingefügt statt getippt`;
        badge.className = 'paste-count-badge';
        stats.insertBefore(badge, stats.firstChild);
    }
}
