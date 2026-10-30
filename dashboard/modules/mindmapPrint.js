//
//  dashboard/modules/mindmapPrint.js — the learners' unit mindmaps as print sheets.
//  Contract: backend/CONTRACT.md, «Mindmap print view» and «Mindmap editor».
//
//  No Firebase here: mindmaps.js fetches, this module checks and draws. Everything read
//  from a draft is untrusted and goes into the DOM as text (textContent), never as HTML.
//

// As in the mindmap page (allgemeinbildung/mindmap, index.html): the same limits.
export const LIMITS = { nodes: 200, text: 120, depth: 6 };
export const MAPS_BASE = 'https://allgemeinbildung.github.io/mindmap/maps/';

// ---- ids -----------------------------------------------------------------------------

/**
 * A unit id (`ABUlehrmittel/…/8.1 …`) from what the teacher typed: the id itself or a
 * Publish address. Same formula as publish.js: decodeURIComponent of the path with `+` as
 * space, without the leading slash. Null when it is not usable.
 */
export function unitFromInput(input) {
    let s = String(input || '').trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) {
        try { s = decodeURIComponent(new URL(s).pathname.replace(/\+/g, ' ')); } catch { return null; }
    }
    s = s.replace(/^\/+/, '').replace(/\/+$/, '');
    return s.length > 0 && s.length <= 300 ? s : null;
}

export const noteOf = (unit) => String(unit).split('/').pop();

/** The skeleton files publish.js names first in `skel`, in its order. */
export const skeletonNames = (unit) => {
    const note = noteOf(unit);
    return [`${note}_1`, `${note}_1_1`, note];
};

// ---- the tree --------------------------------------------------------------------------

/** Root and main branches only, as unit mode cuts it. Null for anything malformed. */
export function cutSkeleton(root) {
    if (!root || typeof root.text !== 'string') return null;
    const kids = Array.isArray(root.children) ? root.children : [];
    return {
        text: root.text,
        children: kids.filter((c) => c && typeof c.text === 'string').map((c) => ({ text: c.text, children: [] })),
    };
}

/** The `{ v, add }` object of a draft, or null. */
export function parseNodes(nodes) {
    if (typeof nodes !== 'string') return null;
    let data;
    try { data = JSON.parse(nodes); } catch { return null; }
    return data && data.v === 1 && Array.isArray(data.add) ? data : null;
}

/** A skeleton when no map file exists: the unit's name and the main branches the learners hung on. */
export function fallbackSkeleton(unit, datas) {
    let rootText = null;
    const branches = [];
    for (const data of datas) {
        for (const entry of data?.add || []) {
            const at = entry && Array.isArray(entry.at) ? entry.at : null;
            if (!at || typeof at[0] !== 'string') continue;
            rootText ??= at[0];
            if (at[0] === rootText && typeof at[1] === 'string' && !branches.includes(at[1])) branches.push(at[1]);
        }
    }
    return { text: rootText ?? noteOf(unit).replace(/^\d+\.\d+\s+/, ''), children: branches.map((text) => ({ text, children: [] })) };
}

// Same checks as cleanOwn() of the mindmap page.
function cleanOwn(list, depth, budget) {
    if (!Array.isArray(list) || depth > LIMITS.depth) return [];
    const out = [];
    for (const item of list) {
        if (budget.left <= 0 || !item || typeof item.t !== 'string') continue;
        const t = item.t.replace(/\s+/g, ' ').trim().slice(0, LIMITS.text);
        if (!t) continue;
        budget.left--;
        out.push({ text: t, own: true, children: cleanOwn(item.c, depth + 1, budget) });
    }
    return out;
}

const teacherTree = (json) => ({
    text: String(json.text ?? ''), own: false, children: (json.children || []).map(teacherTree),
});

function findTeacherNode(tree, path) {
    if (!Array.isArray(path) || path[0] !== tree.text) return null;
    let node = tree;
    for (const text of path.slice(1)) {
        node = node.children.find((c) => !c.own && c.text === text);
        if (!node) return null;
    }
    return node;
}

/**
 * The skeleton with the learner's branches hung in, as the mindmap page merges them.
 * Returns `{ tree, own }` (`own` = number of own nodes kept).
 */
export function buildTree(skeleton, data) {
    const tree = teacherTree(skeleton);
    const budget = { left: LIMITS.nodes };
    if (data && data.v === 1 && Array.isArray(data.add)) {
        for (const entry of data.add) {
            if (!entry || typeof entry !== 'object') continue;
            const anchor = findTeacherNode(tree, entry.at) || tree;   // skeleton changed: under the root
            anchor.children.push(...cleanOwn(entry.nodes, 1, budget));
        }
    }
    return { tree, own: LIMITS.nodes - budget.left };
}

const textLength = (node) => node.text.length + node.children.reduce((n, c) => n + textLength(c), 0);

// ---- drawing ---------------------------------------------------------------------------

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;      // always text, never HTML
    return e;
}

function list(nodes) {
    const ul = el('ul');
    for (const n of nodes) {
        const li = el('li', n.own ? 'own' : 'teacher');
        li.append(el('span', 'txt', n.text));
        if (n.children.length) li.append(list(n.children));
        ul.append(li);
    }
    return ul;
}

function branchBox(node) {
    const box = el('div', node.own ? 'branch own-branch' : 'branch');
    box.append(el('div', 'branch-title', node.text));
    if (node.children.length) box.append(list(node.children));
    return box;
}

const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '');

function sheet({ name, classId, unitTitle, updatedAt, root, branches, part }) {
    const s = el('section', 'sheet');
    const head = el('header', 'sheet-head');
    head.append(el('span', 'who', name), el('span', 'klasse', classId), el('span', 'unit', unitTitle));
    const right = el('span', 'meta', [part, updatedAt ? `Stand ${fmtDate(updatedAt)}` : ''].filter(Boolean).join(' · '));
    head.append(right);
    const map = el('div', 'map');
    map.append(el('div', 'root', root));
    const grid = el('div', 'branches');
    for (const b of branches) grid.append(branchBox(b));
    map.append(grid);
    s.append(head, map);
    return s;
}

// Font sizes (pt) and column counts tried, largest font first. At each size a branch first
// stays in one box in one column; only if that does not fit, long branches flow on into the
// next column (class `flow`): a larger type size counts more than unbroken boxes.
const FONTS = [12, 11, 10.5, 10, 9.5, 9, 8.5, 8, 7.5, 7];
const COLS = [3, 4];

/** Shrinks the sheet's map until it fits. Returns true when it does. `s` must be in the DOM. */
function fit(s) {
    const map = s.querySelector('.map');
    const grid = s.querySelector('.branches');
    for (const pt of FONTS) {
        for (const flow of [false, true]) {
            for (const cols of COLS) {
                s.style.setProperty('--pt', `${pt}pt`);
                s.style.setProperty('--cols', String(cols));
                s.classList.toggle('flow', flow);
                if (map.scrollHeight <= map.clientHeight + 1 && grid.scrollWidth <= grid.clientWidth + 1) {
                    s.dataset.pt = String(pt);
                    return true;
                }
            }
        }
    }
    s.classList.add('overflow');      // shows everything, spills onto a further page
    return false;
}

/** Splits the main branches into two runs of about equal text, order kept. */
function halves(branches) {
    const total = branches.reduce((n, b) => n + textLength(b), 0);
    let acc = 0, cut = 1;
    for (let i = 0; i < branches.length - 1; i++) {
        acc += textLength(branches[i]);
        cut = i + 1;
        if (acc >= total / 2) break;
    }
    return [branches.slice(0, cut), branches.slice(cut)];
}

/**
 * Appends the sheets of one learner and unit to `container` and fits them.
 * Returns the number of pages they take (1, 2, or more when even two do not suffice).
 */
export function renderLearnerUnit(container, { name, classId, unitTitle, updatedAt, tree }) {
    const base = { name, classId, unitTitle, updatedAt, root: tree.text };
    const one = sheet({ ...base, branches: tree.children });
    container.append(one);
    if (fit(one)) return 1;
    one.remove();
    if (tree.children.length < 2) {         // nothing to split: let it spill (counted as more than 2)
        const s = sheet({ ...base, branches: tree.children });
        container.append(s);
        fit(s);
        return 3;
    }
    const [a, b] = halves(tree.children);
    const s1 = sheet({ ...base, branches: a, part: 'Seite 1/2' });
    const s2 = sheet({ ...base, branches: b, part: 'Seite 2/2' });
    container.append(s1, s2);
    const ok1 = fit(s1);
    const ok2 = fit(s2);
    const ok = ok1 && ok2;
    const pt = Math.min(Number(s1.dataset.pt || 7), Number(s2.dataset.pt || 7));
    if (ok && s1.dataset.pt !== s2.dataset.pt) {
        // Same type size on both pages: the larger page shrinks to the smaller size, which still fits.
        for (const s of [s1, s2]) { s.style.setProperty('--pt', `${pt}pt`); s.dataset.pt = String(pt); }
    }
    return ok ? 2 : 3;
}

/** The last page: who has no map, and whose map has no own branch. */
export function renderMissing(container, { classId, unitTitles, missing, empty }) {
    const s = el('section', 'sheet sheet-list');
    s.append(el('h2', null, `${classId} · ${unitTitles.join(' / ')}`));
    const block = (title, rows) => {
        s.append(el('h3', null, `${title} (${rows.length})`));
        if (!rows.length) { s.append(el('p', 'none', '–')); return; }
        const ul = el('ul');
        for (const r of rows) ul.append(el('li', null, r));
        s.append(ul);
    };
    block('Ohne Mindmap', missing);
    block('Mindmap ohne eigene Äste', empty);
    container.append(s);
}
