//
//  dashboard/modules/formativ.js — shows the teacher which formativ feedback
//  each student received: status, hint, time, and the text that was sent to
//  the model (name already masked by the function). Read from formativUsage
//  through api.js.
//
import { getFormativSlots } from './api.js';

const STATUS = {
    erfuellt: { text: '✓ erfüllt', color: '#146c43' },
    teilweise: { text: '◐ teilweise', color: '#a04d00' },
    fehlt: { text: '✗ fehlt', color: '#b02a37' },
    nicht_beurteilbar: { text: '– nicht beurteilbar', color: '#6c757d' },
};

function el(tag, css, text) {
    const e = document.createElement(tag);
    if (css) e.style.cssText = css;
    if (text !== undefined) e.textContent = text; // never innerHTML: model output and student text
    return e;
}

function renderSlot(slot) {
    const attempts = [...(slot.frueher || []), slot];
    if (attempts.length === 1) return renderAttempt(slot, null);
    const wrap = el('div', '');
    wrap.className = 'formativ-teacher-group';
    attempts.forEach((a, i) => wrap.appendChild(renderAttempt(a, i + 1)));
    return wrap;
}

function renderAttempt(slot, nr) {
    const box = el('div', 'margin:6px 0 10px; padding:8px 10px; border-left:3px solid #0d6efd; background:#f5f8ff; border-radius:0 6px 6px 0; font-size:0.9em;');
    box.className = 'formativ-teacher';
    const when = slot.at ? new Date(slot.at).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
    const label = nr ? `${nr}. formativ-Rückmeldung` : 'formativ-Rückmeldung';
    box.appendChild(el('div', 'font-weight:600; color:#0d6efd; margin-bottom:4px;', `💬 ${label} an die lernende Person · ${when}`));
    for (const k of slot.result?.kriterien || []) {
        const st = STATUS[k.status] || STATUS.nicht_beurteilbar;
        const line = el('div', 'margin:2px 0;');
        line.appendChild(el('span', `font-weight:600; color:${st.color}; margin-right:6px;`, st.text));
        line.appendChild(el('span', '', k.hinweis || ''));
        box.appendChild(line);
    }
    if (slot.gesendet) {
        const det = el('details', 'margin-top:4px;');
        det.appendChild(el('summary', 'cursor:pointer; color:#555;', 'An das Modell gesendeter Text'));
        det.appendChild(el('div', 'white-space:pre-wrap; background:#fff; border:1px solid #dee2e6; border-radius:4px; padding:6px; margin-top:4px;', slot.gesendet));
        box.appendChild(det);
    }
    if (slot.prompt_version) box.appendChild(el('div', 'color:#888; font-size:0.8em; margin-top:3px;', `Prompt: ${slot.prompt_version}`));
    return box;
}

/**
 * Loads the student's formativ feedback and places it under the matching
 * answers of the card (slot key "subId::questionId" ↔ data-qid "subId_questionId").
 * Adds a count badge to the card header. Fails silently: the card stays as it is.
 */
export async function attachFormativToCard(card, studentKey, assignmentId) {
    if (!studentKey) return;
    let slots;
    try { slots = await getFormativSlots(studentKey, assignmentId); } catch { return; }   // studentKey = uid
    const entries = Object.entries(slots);
    if (entries.length === 0) return;

    for (const [key, slot] of entries) {
        const i = key.indexOf('::');
        const qid = `${key.slice(0, i)}_${key.slice(i + 2)}`;
        const feedbackSlot = [...card.querySelectorAll('.inline-feedback')].find((s) => s.dataset.qid === qid);
        const wrapper = feedbackSlot?.closest('.qa-wrapper');
        if (wrapper) wrapper.appendChild(renderSlot(slot));
    }
    const stats = card.querySelector('.student-stats');
    if (stats) {
        const total = entries.reduce((n, [, s]) => n + 1 + (s.frueher?.length || 0), 0);
        const badge = el('span', 'background:#e7f1ff; color:#0d6efd; border:1px solid #b6d4fe; border-radius:4px; padding:1px 6px; font-size:0.8em; font-weight:600;', `💬 ${total}`);
        badge.title = `${total} formativ-Rückmeldung(en) zu ${entries.length} Frage(n) erhalten`;
        badge.className = 'formativ-count-badge';
        stats.insertBefore(badge, stats.firstChild);
    }
}
