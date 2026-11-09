// Darstellung «Mindmap»: Wurzel in der Mitte, Äste links und rechts (SVG).
// Statt Kästchen ein echter Baum. Die Hauptäste werden nach Textmenge auf die rechte und die
// linke Seite verteilt, jede Tiefe ist eine Spalte, Eltern stehen mittig vor ihren Kindern.
// Passt die Karte nicht lesbar (< MAP.minPt) auf eine Seite, wird sie auf 2, dann 3 Seiten
// verteilt (Hauptäste in Reihenfolge, Wurzel auf jeder Seite). Alles geht als Text ins DOM.

const MAP = { font: 13, lh: 16, padX: 7, padY: 3, gapX: 22, gapY: 5, gapTop: 16, minPt: 7, widths: [80, 100, 120, 150, 190, 240] };
const SVGNS = 'http://www.w3.org/2000/svg';
let measureCtx = null;

function el(tag, className, text) {
    const e = document.createElement(tag);
    if (className) e.className = className;
    if (text != null) e.textContent = text;
    return e;
}

const fmtDate = (d) => (d instanceof Date && !Number.isNaN(d.getTime())
    ? d.toLocaleString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '');

const textLength = (node) => node.text.length + node.children.reduce((n, c) => n + textLength(c), 0);

function textWidth(text, bold, italic) {
    measureCtx ??= document.createElement('canvas').getContext('2d');
    measureCtx.font = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${MAP.font}px "Segoe UI", Arial, Helvetica, sans-serif`;
    return measureCtx.measureText(text).width;
}

function wrapText(text, maxw, bold, italic) {
    const pieces = [];
    for (const word of String(text).split(/\s+/).filter(Boolean)) {
        if (textWidth(word, bold, italic) <= maxw) { pieces.push(word); continue; }
        let chunk = '';
        for (const ch of word) {
            if (chunk && textWidth(chunk + ch, bold, italic) > maxw) { pieces.push(chunk); chunk = ''; }
            chunk += ch;
        }
        if (chunk) pieces.push(chunk);
    }
    const lines = [];
    let cur = '';
    for (const p of pieces) {
        const t = cur ? `${cur} ${p}` : p;
        if (!cur || textWidth(t, bold, italic) <= maxw) cur = t; else { lines.push(cur); cur = p; }
    }
    if (cur) lines.push(cur);
    return lines.length ? lines : [''];
}

function prep(node, depth, maxw) {
    const bold = depth <= 1;
    const own = !!node.own;
    const lines = wrapText(node.text, maxw, bold, own);
    const w = Math.max(...lines.map((l) => textWidth(l, bold, own))) + 2 * MAP.padX;
    return { own, depth, bold, lines, w, h: lines.length * MAP.lh + 2 * MAP.padY, kids: (node.children || []).map((c) => prep(c, depth + 1, maxw)) };
}

/** One side. x = left edge, y = centre, relative to the root centre. */
function layoutSide(tops, dir, rootHalf) {
    const colW = [];
    const widths = (n) => { colW[n.depth - 1] = Math.max(colW[n.depth - 1] || 0, n.w); n.kids.forEach(widths); };
    tops.forEach(widths);
    const off = [rootHalf + MAP.gapX];
    for (let d = 1; d < colW.length; d++) off[d] = off[d - 1] + colW[d - 1] + MAP.gapX;
    const sub = (n) => {
        const total = n.kids.reduce((s, c) => s + sub(c), 0) + MAP.gapY * Math.max(0, n.kids.length - 1);
        n.sub = Math.max(n.h, total);
        n.kidsTotal = total;
        return n.sub;
    };
    const nodes = [];
    const place = (n, top) => {
        n.x = dir > 0 ? off[n.depth - 1] : -off[n.depth - 1] - n.w;
        n.dir = dir;
        nodes.push(n);
        if (!n.kids.length) { n.y = top + n.sub / 2; return; }
        let y = top + (n.sub - n.kidsTotal) / 2;
        for (const c of n.kids) { place(c, y); y += c.sub + MAP.gapY; }
        n.y = (n.kids[0].y + n.kids[n.kids.length - 1].y) / 2;
    };
    tops.forEach(sub);
    let top = 0;
    for (const t of tops) { place(t, top); top += t.sub + MAP.gapTop; }
    return { nodes, height: Math.max(0, top - MAP.gapTop) };
}

function layoutMap(rootText, branches, maxw) {
    const root = prep({ text: rootText, own: false, children: [] }, 0, Math.max(maxw, 200));
    root.w += 14;
    root.h += 8;
    const tops = branches.map((b) => prep(b, 1, maxw));
    const weight = (n) => n.h + n.kids.reduce((s, c) => s + weight(c), 0);
    const total = tops.reduce((s, t) => s + weight(t), 0);
    let acc = 0;
    let cut = tops.length;
    for (let i = 0; i < tops.length; i++) {
        if (acc + weight(tops[i]) / 2 > total / 2) { cut = i; break; }
        acc += weight(tops[i]);
    }
    if (tops.length > 1 && cut === 0) cut = 1;
    const right = layoutSide(tops.slice(0, cut), 1, root.w / 2);
    const left = layoutSide(tops.slice(cut), -1, root.w / 2);
    for (const n of right.nodes) n.y -= right.height / 2;
    for (const n of left.nodes) n.y -= left.height / 2;
    root.x = -root.w / 2;
    root.y = 0;
    root.dir = 0;
    const all = [root, ...right.nodes, ...left.nodes];
    const m = 6;
    const minX = Math.min(...all.map((n) => n.x)) - m;
    const maxX = Math.max(...all.map((n) => n.x + n.w)) + m;
    const minY = Math.min(...all.map((n) => n.y - n.h / 2)) - m;
    const maxY = Math.max(...all.map((n) => n.y + n.h / 2)) + m;
    return { root, tops: all.filter((n) => n.depth === 1), all, vb: [minX, minY, maxX - minX, maxY - minY] };
}

function svgEl(tag, attrs, text) {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
    if (text != null) e.textContent = text;
    return e;
}

function drawMap(svg, L) {
    const [x, y, w, h] = L.vb;
    svg.setAttribute('viewBox', `${x} ${y} ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    const links = svgEl('g', { fill: 'none', stroke: '#555' });
    const boxes = svgEl('g');
    const link = (p, c) => {
        const x1 = c.dir > 0 ? p.x + p.w : p.x;
        const x2 = c.dir > 0 ? c.x : c.x + c.w;
        const xm = (x1 + x2) / 2;
        links.append(svgEl('path', {
            d: `M${x1} ${p.y} C${xm} ${p.y} ${xm} ${c.y} ${x2} ${c.y}`,
            'stroke-width': c.depth === 1 ? 1.6 : 1,
            ...(c.own ? { 'stroke-dasharray': '4 3' } : {}),
        }));
    };
    const walk = (n) => { for (const c of n.kids) { link(n, c); walk(c); } };
    for (const t of L.tops) link(L.root, t);
    for (const t of L.tops) walk(t);
    for (const n of L.all) {
        if (n.depth <= 1) {
            boxes.append(svgEl('rect', {
                x: n.x, y: n.y - n.h / 2, width: n.w, height: n.h, rx: n.depth === 0 ? 10 : 6,
                fill: '#fff', stroke: '#222', 'stroke-width': n.depth === 0 ? 2.2 : 1.2,
                ...(n.own ? { 'stroke-dasharray': '4 3' } : {}),
            }));
        }
        const middle = n.depth <= 1;
        const tx = middle ? n.x + n.w / 2 : (n.dir > 0 ? n.x + MAP.padX : n.x + n.w - MAP.padX);
        const t = svgEl('text', {
            x: tx, 'text-anchor': middle ? 'middle' : (n.dir > 0 ? 'start' : 'end'),
            'font-size': n.depth === 0 ? MAP.font * 1.15 : MAP.font, 'font-weight': n.bold ? 700 : 400,
            ...(n.own ? { 'font-style': 'italic' } : {}), fill: '#000',
        });
        n.lines.forEach((line, i) => t.append(svgEl('tspan', { x: tx, y: n.y - n.h / 2 + MAP.padY + MAP.lh * (i + 0.78) }, line)));
        boxes.append(t);
    }
    svg.append(links, boxes);
}

function mapSheet({ name, classId, unitTitle, updatedAt, part }) {
    const s = el('section', 'sheet mapview');
    const head = el('header', 'sheet-head');
    head.append(el('span', 'who', name), el('span', 'klasse', classId), el('span', 'unit', unitTitle));
    head.append(el('span', 'meta', [part, updatedAt ? `Stand ${fmtDate(updatedAt)}` : ''].filter(Boolean).join(' · ')));
    const map = el('div', 'map');
    const svg = document.createElementNS(SVGNS, 'svg');
    map.append(svg);
    s.append(head, map);
    return { s, map, svg };
}

/** Contiguous runs of the main branches, about equal in text, at most `n` of them. */
function runs(branches, n) {
    if (n <= 1 || branches.length < 2) return [branches];
    const total = branches.reduce((a, b) => a + textLength(b), 0);
    const out = [];
    let cur = [];
    let acc = 0;
    for (let i = 0; i < branches.length; i++) {
        cur.push(branches[i]);
        acc += textLength(branches[i]);
        const left = branches.length - i - 1;
        const runsLeft = n - out.length - 1;
        if (runsLeft > 0 && left >= runsLeft && (acc >= (total / n) * (out.length + 1) || left === runsLeft)) { out.push(cur); cur = []; }
    }
    if (cur.length) out.push(cur);
    return out;
}

/**
 * Appends the sheets of one learner and unit as a real mind map. Returns the number of pages:
 * the fewest (1 to 3) at which the type reaches MAP.minPt, 3 if even that does not.
 */
export function renderLearnerUnitMap(container, { name, classId, unitTitle, updatedAt, tree }) {
    for (let n = 1; n <= 3; n++) {
        const parts = runs(tree.children, n);
        const made = [];
        let minPt = Infinity;
        parts.forEach((branches, i) => {
            // Ein einziger grosser Hauptast: er wird zur Mitte, seine Unteräste verteilen sich links und rechts.
            let rootText = tree.text;
            let shown = branches;
            let part = parts.length > 1 ? `Seite ${i + 1}/${parts.length}` : '';
            if (branches.length === 1 && branches[0].children.length >= 2) {
                rootText = branches[0].text;
                shown = branches[0].children;
                part = [part, tree.text].filter(Boolean).join(' · ');
            }
            const sh = mapSheet({ name, classId, unitTitle, updatedAt, part });
            container.append(sh.s);
            const cw = sh.map.clientWidth || 1000;
            const ch = sh.map.clientHeight || 650;
            let best = null;
            for (const maxw of MAP.widths) {
                const L = layoutMap(rootText, shown, maxw);
                const scale = Math.min(cw / L.vb[2], ch / L.vb[3]);
                if (!best || scale > best.scale) best = { L, scale };
            }
            drawMap(sh.svg, best.L);
            minPt = Math.min(minPt, MAP.font * Math.min(best.scale, 1.6) * 0.75);
            made.push(sh.s);
        });
        if (minPt >= MAP.minPt || n === 3 || parts.length < n) {
            for (const s of made) s.dataset.pt = String(Math.round(minPt * 10) / 10);
            return made.length;
        }
        made.forEach((s) => s.remove());
    }
    return 3;
}
