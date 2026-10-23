//
//  js/formativ-trail.js — shared by the box (js/formativ.js) and the overview
//  (js/rueckmeldungen.js): how one formativ feedback is drawn, and the «trail»
//  that shows whether the feedback was used. Contract: backend/CONTRACT.md,
//  «Formative feedback: attempts, trail, overview».
//
//  The trail is never a score: marks are counted, never added into one number,
//  never weighted, never compared with anyone. «verbessert» is shown as
//  prominently as «direkt»: using the feedback is the point.
//
//  Everything from the service is text: textContent only, never innerHTML.
//

export const STATUS = {
    erfuellt:          { icon: '✓', text: 'erfüllt',           cls: 'ok' },
    teilweise:         { icon: '◐', text: 'teilweise',         cls: 'part' },
    fehlt:             { icon: '✗', text: 'fehlt',             cls: 'miss' },
    nicht_beurteilbar: { icon: '–', text: 'nicht beurteilbar', cls: 'na' },
};

const RANK = { fehlt: 0, teilweise: 1, erfuellt: 2 };

export const MARKS = {
    direkt:     { icon: '●', up: false, text: 'direkt erfüllt',       cls: 'direkt' },
    verbessert: { icon: '●', up: true,  text: 'verbessert',           cls: 'verbessert' },
    besser:     { icon: '◐', up: true,  text: 'teilweise verbessert', cls: 'besser' },
    offen:      { icon: '○', up: false, text: 'offen',                cls: 'offen' },
};
export const MARK_ORDER = ['direkt', 'verbessert', 'besser', 'offen'];

export function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
}

export function formatTime(iso) {
    try {
        return new Date(iso).toLocaleString('de-CH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
}

/** All attempts of a status slot, oldest first. Also reads a slot from before 23.10.2026. */
export function attemptsOf(slot) {
    if (!slot || slot.state !== 'done') return [];
    if (Array.isArray(slot.versuche) && slot.versuche.length) return slot.versuche.filter((v) => v && v.result);
    return slot.result ? [{ at: slot.at, result: slot.result }] : [];
}

const hasCriteria = (a) => a?.result?.zustand !== 'nicht_verfuegbar' && (a?.result?.kriterien || []).length > 0;

/**
 * One mark per criterion (by `kriterien[].id`): its status in the first and the latest
 * attempt that rated it. Attempts without criteria are skipped.
 * → [{ id, label, first, last, mark }]
 */
export function criterionMarks(attempts) {
    const rated = (attempts || []).filter(hasCriteria);
    const byId = new Map();
    for (const a of rated) {
        for (const k of a.result.kriterien) {
            if (!k || typeof k.id !== 'string') continue;
            const c = byId.get(k.id) || { id: k.id, label: k.label || '', seen: [] };
            c.seen.push(k.status);
            c.label = k.label || c.label;
            byId.set(k.id, c);
        }
    }
    return [...byId.values()].map(({ id, label, seen }) => {
        const first = seen[0];
        const last = seen[seen.length - 1];
        let mark = 'offen';
        if (first === 'erfuellt') mark = 'direkt';
        else if (seen.length > 1 && last === 'erfuellt') mark = 'verbessert';
        else if (seen.length > 1 && first in RANK && last in RANK && RANK[last] > RANK[first]) mark = 'besser';
        return { id, label, first, last, mark };
    });
}

export function emptyCounts() {
    return { direkt: 0, verbessert: 0, besser: 0, offen: 0, ohne: 0 };
}

/** Adds one question to `counts`: its marks, or one `ohne` when it has no feedback yet. */
export function addQuestion(counts, attempts) {
    if (!attempts.length) { counts.ohne += 1; return counts; }
    for (const m of criterionMarks(attempts)) counts[m.mark] += 1;
    return counts;
}

function markEl(key, small) {
    const m = MARKS[key];
    const span = el('span', `formativ-mark formativ-mark-${m.cls}${small ? ' is-small' : ''}`);
    span.appendChild(el('span', 'formativ-mark-dot', m.icon));
    if (m.up) span.appendChild(el('span', 'formativ-mark-up', '↑'));
    span.title = m.text;
    return span;
}

/** The row of marks of one question; the text of each mark is in the title and for screen readers. */
export function renderMarks(marks) {
    const row = el('span', 'formativ-marks');
    row.setAttribute('role', 'img');
    row.setAttribute('aria-label', `Spur: ${marks.map((m) => MARKS[m.mark].text).join(', ')}`);
    for (const m of marks) row.appendChild(markEl(m.mark, false));
    return row;
}

/** «4 direkt erfüllt · 3 verbessert · …» — the counts side by side, no total. */
export function renderCounts(counts, { withOhne = true } = {}) {
    const box = el('div', 'formativ-counts');
    for (const key of MARK_ORDER) {
        if (!counts[key]) continue;
        const item = el('span', 'formativ-count');
        item.appendChild(markEl(key, true));
        item.appendChild(el('span', 'formativ-count-text', `${counts[key]} ${MARKS[key].text}`));
        box.appendChild(item);
    }
    if (withOhne && counts.ohne) {
        box.appendChild(el('span', 'formativ-count formativ-count-ohne', `${counts.ohne} ${counts.ohne === 1 ? 'Frage' : 'Fragen'} noch ohne Rückmeldung`));
    }
    return box;
}

/** The service quotes the answer as evidence; when that is (nearly) all of it, it only repeats the text. */
const QUOTE_MAX_SHARE = 0.6;
function quoteIsPartOfAnswer(quote, answerText) {
    const norm = (t) => String(t || '').replace(/\s+/g, ' ').trim();
    const answer = norm(answerText);
    if (!answer) return true;
    return norm(quote).length < answer.length * QUOTE_MAX_SHARE;
}

/**
 * The criteria of one attempt. With `previous` (the attempt before), each criterion
 * shows where it came from: «✗ fehlt → ◐ teilweise».
 */
export function renderCriteria(result, { previous = null, answerText = null } = {}) {
    if (result?.zustand === 'nicht_verfuegbar') {
        return el('p', 'formativ-note', 'Zu dieser Antwort konnte keine Rückmeldung erstellt werden.');
    }
    const before = new Map((previous?.result?.kriterien || []).map((k) => [k.id, k.status]));
    const list = el('ul', 'formativ-list');
    for (const k of result?.kriterien || []) {
        const st = STATUS[k.status] || STATUS.nicht_beurteilbar;
        const li = el('li', `formativ-item formativ-${st.cls}`);
        const line = el('div', 'formativ-line');
        const was = before.get(k.id);
        if (was && was !== k.status) {
            const from = STATUS[was] || STATUS.nicht_beurteilbar;
            const change = el('span', 'formativ-change');
            change.appendChild(el('span', `formativ-badge formativ-was formativ-was-${from.cls}`, `${from.icon} ${from.text}`));
            change.appendChild(el('span', 'formativ-arrow', '→'));
            change.appendChild(el('span', 'formativ-badge', `${st.icon} ${st.text}`));
            line.appendChild(change);
        } else {
            line.appendChild(el('span', 'formativ-badge', `${st.icon} ${st.text}`));
        }
        if (k.hinweis) line.appendChild(el('span', 'formativ-hint', k.hinweis));
        li.appendChild(line);
        if (k.beleg && (answerText === null || quoteIsPartOfAnswer(k.beleg, answerText))) {
            li.appendChild(el('div', 'formativ-quote', `«${k.beleg}»`));
        }
        list.appendChild(li);
    }
    return list;
}

/**
 * All attempts of one question: the latest open, the earlier ones folded below it.
 * `max` is the number of attempts allowed (for «2. Rückmeldung von 2»).
 */
export function renderAttempts(container, attempts, { max = attempts.length, answerText = null, foot = true } = {}) {
    container.replaceChildren();
    if (!attempts.length) return;
    const latest = attempts[attempts.length - 1];
    const n = attempts.length;

    const head = el('div', 'formativ-head', n > 1 || max > 1 ? `${n}. Rückmeldung` : 'Rückmeldung zu deiner Antwort');
    if (latest.at) head.appendChild(el('span', 'formativ-time', ` · ${formatTime(latest.at)}`));
    const marks = criterionMarks(attempts);
    if (marks.length) head.appendChild(renderMarks(marks));
    container.appendChild(head);
    container.appendChild(renderCriteria(latest.result, { previous: n > 1 ? attempts[n - 2] : null, answerText }));

    for (let i = n - 2; i >= 0; i -= 1) {
        const det = el('details', 'formativ-earlier');
        const sum = el('summary', '', `${i + 1}. Rückmeldung`);
        if (attempts[i].at) sum.appendChild(el('span', 'formativ-time', ` · ${formatTime(attempts[i].at)}`));
        det.appendChild(sum);
        det.appendChild(renderCriteria(attempts[i].result, { previous: i > 0 ? attempts[i - 1] : null, answerText: null }));
        container.appendChild(det);
    }
    if (foot) {
        container.appendChild(el('p', 'formativ-foot', 'Die Rückmeldung ist ein Hinweis zum Weiterarbeiten, keine Note. Sie bezieht sich auf deinen Text zum Zeitpunkt der Anfrage.'));
    }
}

/** The channel the box uses to tell the overview about a new feedback (ids only). */
export const CHANNEL = 'lmsbox-formativ';
export function announce(message) {
    try {
        const ch = new BroadcastChannel(CHANNEL);
        ch.postMessage({ type: 'formativ-neu', ...message });
        ch.close();
    } catch { /* no BroadcastChannel: the overview updates on its next load */ }
}
