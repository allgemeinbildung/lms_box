//
//  js/rueckmeldungen.js — «Meine Rückmeldungen»: every formativ feedback of every
//  LMS Box on one host page, in page order. Contract: backend/CONTRACT.md,
//  «Formative feedback: attempts, trail, overview».
//
//  publish.js opens rueckmeldungen.html?parent=<origin>&items=<JSON> in a side panel.
//  `items` are ids only; this page reads the questions (publicAssignments) and the
//  student's own feedback (boxFormativStatus) itself, so no feedback text passes
//  through the host page. Nothing is written. Everything goes in as text.
//
import { onAuthChange, getAssignment, getFormativStatus } from './api.js';
import { showLoginDialog, closeLoginDialog, logout } from './auth.js';
import {
    attemptsOf, criterionMarks, renderAttempts, renderCounts, renderMarks, addQuestion, emptyCounts,
    el, CHANNEL, MARKS, MARK_ORDER,
} from './formativ-trail.js';

const ALLOWED_PARENTS = ['https://lehrmittel.aburossi.ch'];
const LOCAL_HOST = /^(localhost|127\.0\.0\.1)$/;
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/;
const MAX_ITEMS = 40;
const MAX_ID = 500;
const MAX_TITLE = 200;

const root = document.getElementById('rm');
const params = new URLSearchParams(window.location.search);

/** The host page's origin from ?parent=, or null when it is not on the list. */
function allowedParent() {
    if (window.parent === window) return null;
    const origin = params.get('parent');
    if (!origin) return null;
    if (ALLOWED_PARENTS.includes(origin)) return origin;
    if (LOCAL_HOST.test(window.location.hostname) && LOCAL_ORIGIN.test(origin)) return origin;
    return null;
}
const PARENT = allowedParent();

/** ?items= → [{ index, assignmentId, subId, section }]; anything that does not fit is dropped. */
function readItems() {
    let raw;
    try { raw = JSON.parse(params.get('items') || '[]'); } catch { return []; }
    if (!Array.isArray(raw)) return [];
    const okId = (v) => typeof v === 'string' && v.length > 0 && v.length <= MAX_ID;
    const out = [];
    raw.slice(0, MAX_ITEMS).forEach((it, index) => {
        if (!Array.isArray(it) || !okId(it[0]) || !okId(it[1])) return;
        const section = typeof it[2] === 'string' ? it[2].slice(0, MAX_TITLE) : '';
        out.push({ index, assignmentId: it[0], subId: it[1], section });
    });
    return out;
}
const ITEMS = readItems();

// Per assignment: { assignment, status } once loaded, or { error }.
const cache = new Map();
let user = null;

const plain = (t) => String(t || '').replace(/<[^>]+>/g, ' ').replace(/\*\*(.*?)\*\*/g, '$1').replace(/\s+/g, ' ').trim();

function formativQuestions(assignment, subId) {
    const sub = assignment?.subAssignments?.[subId];
    const on = (q) => q.formativ === false ? false
        : Boolean(q.formativ) || sub?.formativ === true || assignment?.formativ === true;
    return { sub, questions: (sub?.questions || []).filter(on) };
}

async function load(assignmentId) {
    try {
        const [assignment, status] = await Promise.all([getAssignment(assignmentId), getFormativStatus(assignmentId)]);
        cache.set(assignmentId, { assignment, status });
    } catch (error) {
        cache.set(assignmentId, { error });
    }
}

function link(text, onClick) {
    const a = el('a', null, text);
    a.href = '#';
    a.addEventListener('click', (e) => { e.preventDefault(); onClick(); });
    return a;
}

function stateLine(...parts) {
    const p = el('p', 'rm-state');
    p.append(...parts);
    root.replaceChildren(p);
}

function goto(index) {
    if (PARENT) window.parent.postMessage({ type: 'lmsbox-rm-goto', index }, PARENT);
}

function render() {
    if (!user) {
        stateLine('Melde dich an, um deine Rückmeldungen zu sehen. ', link('Anmelden', () => showLoginDialog({ closable: true })));
        return;
    }
    const errors = [...cache.values()].map((c) => c.error).filter(Boolean);
    if (errors.some((e) => e.code === 'forbidden')) {
        stateLine(`Rückmeldungen gibt es nur für Lernenden-Konten (angemeldet: ${user.email || 'unbekannt'}). `, link('Abmelden', logout));
        return;
    }

    const counts = emptyCounts();
    const sections = [];      // [{ title, questions: [...] }] in page order
    let current = null;
    let failed = 0;
    for (const item of ITEMS) {
        const c = cache.get(item.assignmentId);
        if (!c) continue;
        if (c.error) { failed += 1; continue; }
        const { sub, questions } = formativQuestions(c.assignment, item.subId);
        if (!questions.length) continue;
        const title = item.section || sub?.titel || item.subId;
        if (!current || current.title !== title) { current = { title, questions: [] }; sections.push(current); }
        for (const q of questions) {
            const attempts = attemptsOf(c.status.slots?.[`${item.subId}::${q.id}`]);
            addQuestion(counts, attempts);
            current.questions.push({ item, question: q, attempts, max: c.status.max || 1 });
        }
    }

    root.replaceChildren();
    if (!sections.length) {
        stateLine(failed ? 'Die Rückmeldungen sind gerade nicht verfügbar. Versuche es später nochmals.'
            : 'Auf dieser Seite gibt es keine Aufträge mit Rückmeldung.');
        return;
    }

    const summary = el('section', 'rm-summary');
    summary.appendChild(el('h2', null, 'Deine Spur auf dieser Seite'));
    summary.appendChild(renderCounts(counts));
    summary.appendChild(el('p', 'rm-legend',
        MARK_ORDER.map((k) => `${MARKS[k].icon}${MARKS[k].up ? '↑' : ''} ${MARKS[k].text}`).join(' · ')
        + ' — pro Kriterium, keine Note.'));
    root.appendChild(summary);

    for (const s of sections) {
        const sec = el('section', 'rm-section');
        sec.appendChild(el('h3', null, s.title));
        for (const { item, question, attempts, max } of s.questions) {
            const box = el('div', 'rm-q');
            const head = el('div', 'rm-q-head');
            head.appendChild(el('span', 'rm-q-text', plain(question.text)));
            const marks = criterionMarks(attempts);
            if (marks.length) head.appendChild(renderMarks(marks));
            if (PARENT) {
                const b = el('button', 'rm-goto', 'Zur Frage');
                b.type = 'button';
                b.addEventListener('click', () => goto(item.index));
                head.appendChild(b);
            }
            box.appendChild(head);
            if (attempts.length) {
                const panel = el('div', 'formativ-panel');
                renderAttempts(panel, attempts, { max, foot: false });
                box.appendChild(panel);
            } else {
                box.appendChild(el('p', 'rm-none', 'Noch keine Rückmeldung.'));
            }
            sec.appendChild(box);
        }
        root.appendChild(sec);
    }
    if (failed) root.appendChild(el('p', 'rm-state', 'Ein Teil der Rückmeldungen konnte nicht geladen werden.'));
    root.appendChild(el('p', 'rm-foot', 'Die Rückmeldungen sind Hinweise zum Weiterarbeiten, keine Note. Sie beziehen sich auf deinen Text zum Zeitpunkt der Anfrage.'));
}

async function loadAll() {
    cache.clear();
    if (!user) { render(); return; }
    stateLine('Rückmeldungen werden geladen …');
    await Promise.all([...new Set(ITEMS.map((i) => i.assignmentId))].map(load));
    render();
}

// A box on the same page got new feedback: reload that assignment.
try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.addEventListener('message', async (event) => {
        const d = event.data;
        if (!user || !d || d.type !== 'formativ-neu' || typeof d.assignmentId !== 'string') return;
        if (!ITEMS.some((i) => i.assignmentId === d.assignmentId)) return;
        await load(d.assignmentId);
        render();
    });
} catch { /* no BroadcastChannel: the panel updates when it is opened again */ }

if (!ITEMS.length) {
    stateLine('Auf dieser Seite gibt es keine Aufträge mit Rückmeldung.');
} else {
    onAuthChange((u) => {
        closeLoginDialog();     // also when a sibling iframe did the login
        user = u;
        loadAll();
    });
}
