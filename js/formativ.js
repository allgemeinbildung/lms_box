//
//  js/formativ.js — "Rückmeldung holen" under each Quill editor.
//
//  Shown only for questions that carry a rubric (question.formativ) and only
//  to logged-in students. Up to `max` feedbacks per field (2), a further one
//  only after the text changed: the server enforces it, the page only mirrors
//  it. All feedback of the field stays visible, the latest open. The result is
//  feedback, never a score. Contract: backend/CONTRACT.md, «Formative feedback».
//
import { getFormativStatus, requestFormativ } from './api.js';
import { attemptsOf, renderAttempts, addQuestion, emptyCounts, announce, el } from './formativ-trail.js';
import { setFormativCounts } from './progress.js';

const sanitize = (s) => String(s).replace(/[^a-zA-Z0-9-_]/g, '-');
const slotKey = (subId, questionId) => `${subId}::${questionId}`;

/** Same minimum as MIN_WORDS in backend/functions/formativ.js, which enforces it. */
const MIN_WORDS = 15;

/** Scrolls the page's own container so the panel is visible. Deliberately not
 *  scrollIntoView(): inside an iframe that can also scroll the host page. */
function revealInContainer(node) {
    const box = document.getElementById('assignment-container');
    if (!box) return;
    const bottom = node.getBoundingClientRect().bottom - box.getBoundingClientRect().bottom;
    if (bottom > 0) box.scrollTop += bottom + 12;
}

function attach({ question, subId, assignmentId, slot, max, onChange }) {
    const editorDiv = document.getElementById(`quill-editor-${sanitize(subId)}-${sanitize(question.id)}`);
    const block = editorDiv?.closest('.question-block');
    const quill = editorDiv && window.Quill ? window.Quill.find(editorDiv) : null;
    if (!block || !quill) return null;

    const wrap = el('div', 'formativ');
    const button = el('button', 'formativ-button', 'Rückmeldung holen');
    button.type = 'button';
    const info = el('span', 'formativ-info');
    const live = el('div', 'formativ-live');
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    const panel = el('div', 'formativ-panel');
    const bar = el('div', 'formativ-bar');
    bar.append(button, info);
    wrap.append(bar, live, panel);
    block.appendChild(wrap);

    const field = { attempts: attemptsOf(slot), exhausted: false };

    /** Button and info line from the number of attempts. */
    function renderButton() {
        const n = field.exhausted ? max : field.attempts.length;
        button.disabled = n >= max;
        if (n === 0) {
            button.textContent = max > 1 ? `Rückmeldung holen (1 von ${max})` : 'Rückmeldung holen';
            info.textContent = max > 1 ? `Bis zu ${max} Rückmeldungen pro Frage, die nächste nach dem Überarbeiten.` : 'Nur einmal pro Frage möglich.';
        } else if (n < max) {
            button.textContent = `${n === 1 ? 'Zweite' : `${n + 1}.`} Rückmeldung holen (${n + 1} von ${max})`;
            info.textContent = 'Überarbeite deine Antwort mit der Rückmeldung, dann hol die nächste.';
        } else {
            button.textContent = max === 2 ? 'Beide Rückmeldungen erhalten' : 'Alle Rückmeldungen erhalten';
            info.textContent = '';
        }
    }

    function renderPanel() {
        renderAttempts(panel, field.attempts, { max, answerText: quill.getText() });
    }

    renderPanel();
    if (slot?.state === 'pending' || slot?.pending) {
        button.disabled = true;
        button.textContent = 'Wird erstellt …';
        info.textContent = 'Rückmeldung wird gerade erstellt. Lade die Seite in einer Minute neu.';
        return field;
    }
    renderButton();

    button.addEventListener('click', async () => {
        const text = quill.root.innerHTML;
        const words = quill.getText().trim().split(/\s+/).filter(Boolean).length;
        if (words < MIN_WORDS) {
            live.textContent = `Schreibe zuerst eine Antwort (mindestens ${MIN_WORDS} Wörter).`;
            return;
        }
        // One click starts it directly (decided 28.09.2026: no confirmation step).
        button.disabled = true;
        button.textContent = 'Wird erstellt …';
        info.textContent = '';
        live.textContent = 'Deine Antwort wird geprüft. Das dauert etwa 5 bis 30 Sekunden.';
        quill.enable(false); // freeze the text the feedback refers to

        try {
            const res = await requestFormativ(assignmentId, subId, question.id, text);
            field.attempts.push({ at: new Date().toISOString(), result: res.result });
            live.textContent = field.attempts.length > 1 ? 'Neue Rückmeldung erhalten.' : 'Rückmeldung erhalten.';
            renderPanel();
            renderButton();
            revealInContainer(panel);
            announce({ assignmentId, subId, questionId: question.id });
            onChange();
        } catch (e) {
            if (e.code === 'already_used') {
                // Another tab or frame used the last attempt: show what the server has.
                if (e.result && !field.attempts.length) { field.attempts.push({ at: null, result: e.result }); renderPanel(); }
                field.exhausted = true;
                renderButton();
                live.textContent = e.message;
            } else {
                renderButton();
                live.textContent = e.message || 'Die Rückmeldung ist gerade nicht verfügbar. Dein Versuch zählt nicht.';
            }
        } finally {
            quill.enable(true);
        }
    });
    return field;
}

export async function initFormativ(assignmentData, assignmentId, subId) {
    const sub = assignmentData?.subAssignments?.[subId];
    // Same rule as the function (backend/functions/formativ.js): question overrides sub-assignment overrides assignment.
    const enabled = (q) => q.formativ === false ? false
        : Boolean(q.formativ) || sub?.formativ === true || assignmentData?.formativ === true;
    const questions = (sub?.questions || []).filter(enabled);
    if (questions.length === 0) return;

    let status;
    try {
        status = await getFormativStatus(assignmentId);
    } catch {
        return; // backend without formativ: page stays exactly as before
    }
    const slots = status.slots || {};
    const max = Number.isInteger(status.max) && status.max > 0 ? status.max : 1;

    const fields = [];
    // Trail counts for the host page (progress message): numbers only.
    const report = () => {
        const counts = emptyCounts();
        for (const f of fields) addQuestion(counts, f.attempts);
        setFormativCounts(counts);
    };
    for (const question of questions) {
        const field = attach({ question, subId, assignmentId, slot: slots[slotKey(subId, question.id)], max, onChange: report });
        if (field) fields.push(field);
    }
    report();
}
