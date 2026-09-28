//
//  js/formativ.js — "Rückmeldung holen" under each Quill editor.
//
//  Shown only for questions that carry a rubric (question.formativ) and only
//  to logged-in students. One feedback per field: the server enforces it, the
//  page only mirrors it. The result is feedback, never a score.
//
import { getFormativStatus, requestFormativ } from './api.js';

const STATUS = {
    erfuellt:          { icon: '✓', text: 'erfüllt',           cls: 'ok' },
    teilweise:         { icon: '◐', text: 'teilweise',         cls: 'part' },
    fehlt:             { icon: '✗', text: 'fehlt',             cls: 'miss' },
    nicht_beurteilbar: { icon: '–', text: 'nicht beurteilbar', cls: 'na' },
};

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, '-');
const slotKey = (subId, questionId) => `${subId}::${questionId}`;

function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text; // never innerHTML: feedback is text (KONZEPT §7.5)
    return e;
}

function formatTime(iso) {
    try {
        return new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

function renderResult(panel, result, at) {
    panel.replaceChildren();
    const head = el('div', 'formativ-head', 'Rückmeldung zu deiner Antwort');
    if (at) head.appendChild(el('span', 'formativ-time', ` · ${formatTime(at)}`));
    panel.appendChild(head);

    if (result.zustand === 'nicht_verfuegbar') {
        panel.appendChild(el('p', 'formativ-note', 'Zu dieser Antwort konnte keine Rückmeldung erstellt werden.'));
        return;
    }

    const list = el('ul', 'formativ-list');
    for (const k of result.kriterien || []) {
        const st = STATUS[k.status] || STATUS.nicht_beurteilbar;
        const li = el('li', `formativ-item formativ-${st.cls}`);
        // Status and hint on one line; the criterion label is not shown (it
        // only repeated the question right above).
        const line = el('div', 'formativ-line');
        line.appendChild(el('span', 'formativ-badge', `${st.icon} ${st.text}`));
        if (k.hinweis) line.appendChild(el('span', 'formativ-hint', k.hinweis));
        li.appendChild(line);
        if (k.beleg) li.appendChild(el('div', 'formativ-quote', `«${k.beleg}»`));
        list.appendChild(li);
    }
    panel.appendChild(list);
    panel.appendChild(el('p', 'formativ-foot', 'Die Rückmeldung ist ein Hinweis zum Weiterarbeiten, keine Note. Sie bezieht sich auf deinen Text zum Zeitpunkt der Anfrage.'));
}

/** Scrolls the page's own container so the panel is visible. Deliberately not
 *  scrollIntoView(): inside an iframe that can also scroll the host page. */
function revealInContainer(el) {
    const box = document.getElementById('assignment-container');
    if (!box) return;
    const bottom = el.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (bottom > 0) box.scrollTop += bottom + 12;
}

function attach({ question, subId, assignmentId, studentKey, mode, slot }) {
    const editorDiv = document.getElementById(`quill-editor-${sanitize(subId)}-${sanitize(question.id)}`);
    const block = editorDiv?.closest('.question-block');
    const quill = editorDiv && window.Quill ? window.Quill.find(editorDiv) : null;
    if (!block || !quill) return;

    const wrap = el('div', 'formativ');
    const button = el('button', 'formativ-button', 'Rückmeldung holen');
    button.type = 'button';
    const info = el('span', 'formativ-info', 'Nur einmal pro Frage möglich.');
    const live = el('div', 'formativ-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    const panel = el('div', 'formativ-panel');
    const bar = el('div', 'formativ-bar');
    bar.append(button, info);
    wrap.append(bar, live, panel);
    block.appendChild(wrap);

    const markUsed = () => {
        button.disabled = true;
        button.textContent = 'Rückmeldung erhalten';
        info.textContent = '';
    };

    if (slot?.state === 'done') {
        markUsed();
        renderResult(panel, slot.result, slot.at);
        return;
    }
    if (slot?.state === 'pending') {
        button.disabled = true;
        info.textContent = 'Rückmeldung wird gerade erstellt. Lade die Seite in einer Minute neu.';
        return;
    }

    button.addEventListener('click', async () => {
        const text = quill.root.innerHTML;
        const words = quill.getText().trim().split(/\s+/).filter(Boolean).length;
        if (words < 5) {
            live.textContent = 'Schreibe zuerst eine Antwort (mindestens 5 Wörter).';
            return;
        }
        // One click starts it directly (decided 28.09.2026: no confirmation step).
        button.disabled = true;
        button.textContent = 'Wird erstellt …';
        info.textContent = '';
        live.textContent = 'Deine Antwort wird geprüft. Das dauert etwa 5 bis 30 Sekunden.';
        quill.enable(false); // freeze the text the feedback refers to

        try {
            const res = await requestFormativ(studentKey, assignmentId, subId, question.id, text, mode);
            markUsed();
            live.textContent = 'Rückmeldung erhalten.';
            renderResult(panel, res.result, new Date().toISOString());
            revealInContainer(panel);
        } catch (e) {
            if (e.code === 'already_used') {
                markUsed();
                live.textContent = e.message;
            } else if (e.code === 'too_short') {
                button.disabled = false;
                button.textContent = 'Rückmeldung holen';
                live.textContent = e.message;
            } else {
                button.disabled = false;
                button.textContent = 'Rückmeldung holen';
                live.textContent = e.message || 'Die Rückmeldung ist gerade nicht verfügbar. Dein Versuch zählt nicht.';
            }
        } finally {
            quill.enable(true);
        }
    });
}

export async function initFormativ(assignmentData, assignmentId, subId, studentKey, mode) {
    const sub = assignmentData?.subAssignments?.[subId];
    // Same rule as the Cloud Function: question overrides sub-assignment overrides assignment.
    const enabled = (q) => q.formativ === false ? false
        : Boolean(q.formativ) || sub?.formativ === true || assignmentData?.formativ === true;
    const questions = (sub?.questions || []).filter(enabled);
    if (!studentKey || questions.length === 0) return;

    let slots = {};
    try {
        slots = (await getFormativStatus(studentKey, assignmentId, mode)).slots || {};
    } catch {
        return; // backend without formativ: page stays exactly as before
    }
    for (const question of questions) {
        attach({ question, subId, assignmentId, studentKey, mode, slot: slots[slotKey(subId, question.id)] });
    }
}
