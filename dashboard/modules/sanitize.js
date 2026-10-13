//
//  dashboard/modules/sanitize.js — the only way student-written HTML reaches the dashboard.
//
//  A draft is written by the student's own browser and can be written with the SDK directly;
//  the security rules check type and length only. So nothing in a draft is markup we trust.
//  The same holds for roster fields, formativ texts and what the evaluator sends back.
//
//    escapeHtml(value)            plain value -> text for an HTML template (content or attribute)
//    safeMarkdown(text)           escaped text with **bold** / *italic* as <b> / <i>, nothing else
//    sanitizeAnswerFragment(html) Quill answer HTML -> DocumentFragment (for the live page)
//    sanitizeAnswerHtml(html)     Quill answer HTML -> HTML string (for the print window)
//
//  The answer sanitiser is an allow-list: the input is parsed into a <template> of an inert
//  document (no scripts run, nothing is fetched), and a NEW tree is built from it that contains only the
//  elements and attributes listed below. Nothing of the parsed tree is ever inserted itself.
//
//  The student page (js/renderer.js) runs Quill with `toolbar: false, formats: []`, i.e. plain
//  paragraphs. Older drafts and the solutions in content/ also carry bold, italic and lists.
//  Allowed is therefore the text formatting Quill 1.3.6 can produce, without media:
//
//    elements    p br strong b em i u s strike sub sup ol ul li h1-h6 blockquote pre code span a
//    attributes  class  — only Quill's own ql-indent-1…8, ql-align-center|right|justify,
//                         ql-direction-rtl, ql-size-small|large|huge, ql-font-serif|monospace,
//                         ql-syntax
//                href   — on <a> only, absolute http:, https:, mailto: or tel: (what Quill's link
//                         format accepts); such a link always gets rel="noopener noreferrer"
//                         and target="_blank". Any other href: the link is unwrapped to its text.
//    dropped with everything inside: script style iframe frame frameset object embed applet svg
//                math form template noscript and every other element that is not text formatting
//                (img, video, audio, input, button, link, meta, base, …)
//    unwrapped (children kept, element itself gone): unknown harmless containers (div, font, …)
//    never kept: style, id, name, on*, src, srcset, data-*, any other attribute; comments.
//

const ALLOWED = new Set([
    'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'sub', 'sup',
    'ol', 'ul', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'pre', 'code', 'span', 'a',
]);

/** Elements whose children are kept although the element itself is not: layout wrappers without behaviour. */
const UNWRAP = new Set([
    'div', 'font', 'center', 'small', 'big', 'mark', 'ins', 'del', 'cite', 'q', 'abbr', 'kbd', 'samp', 'var',
    'tt', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'address', 'dl', 'dt', 'dd',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'td', 'th', 'caption', 'label',
]);

const CLASS_OK = /^ql-(?:indent-[1-8]|align-(?:center|right|justify)|direction-rtl|size-(?:small|large|huge)|font-(?:serif|monospace)|syntax)$/;
const HREF_OK = /^(?:https?:\/\/|mailto:|tel:)[^\s\u0000-\u001f]*$/i;
const HTML_NS = 'http://www.w3.org/1999/xhtml';
const MAX_DEPTH = 100;

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

/** Text for an HTML template, safe as element content and inside a quoted attribute. */
export const escapeHtml = (value) =>
    (value === undefined || value === null ? '' : String(value)).replace(/[&<>"'`]/g, (c) => ESCAPES[c]);

/** `**bold**` and `*italic*` on escaped text. The result contains no markup but <b> and <i>. */
export const safeMarkdown = (text) => escapeHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.*?)\*/g, '<i>$1</i>');

function cleanInto(source, target, doc, depth) {
    for (const node of Array.from(source.childNodes)) {
        if (node.nodeType === 3) {                       // text
            target.appendChild(doc.createTextNode(node.nodeValue));
            continue;
        }
        if (node.nodeType !== 1) continue;               // comments, processing instructions
        if (node.namespaceURI !== HTML_NS) continue;     // svg, math and whatever sits inside them
        const tag = node.localName;
        if (depth >= MAX_DEPTH) {                        // absurd nesting: keep the words only
            if (ALLOWED.has(tag) || UNWRAP.has(tag)) target.appendChild(doc.createTextNode(node.textContent));
            continue;
        }
        if (UNWRAP.has(tag)) { cleanInto(node, target, doc, depth + 1); continue; }
        if (!ALLOWED.has(tag)) continue;                 // dropped with its content

        if (tag === 'a') {
            const href = String(node.getAttribute('href') || '').trim();
            if (!HREF_OK.test(href)) { cleanInto(node, target, doc, depth + 1); continue; }
            const a = doc.createElement('a');
            a.setAttribute('href', href);
            a.setAttribute('rel', 'noopener noreferrer');
            a.setAttribute('target', '_blank');
            cleanInto(node, a, doc, depth + 1);
            target.appendChild(a);
            continue;
        }

        const el = doc.createElement(tag);
        const classes = String(node.getAttribute('class') || '').split(/\s+/).filter((c) => CLASS_OK.test(c));
        if (classes.length) el.setAttribute('class', classes.join(' '));
        if (tag !== 'br') cleanInto(node, el, doc, depth + 1);
        target.appendChild(el);
    }
}

/** The cleaned tree in a container that belongs to an inert document. */
function cleanContainer(html) {
    const inert = document.implementation.createHTMLDocument('');
    // A <template> of a document without browsing context: parsed, never run, nothing fetched.
    // Its content is a DocumentFragment, which (unlike a Document or a <form>) has no named
    // properties a hostile `name=` attribute could put in the way of the walk below.
    const template = inert.createElement('template');
    template.innerHTML = html === undefined || html === null ? '' : String(html);
    const box = inert.createElement('div');
    cleanInto(template.content, box, inert, 0);
    return box;
}

/** Quill answer HTML as a DocumentFragment of the page: `element.replaceChildren(fragment)`. */
export function sanitizeAnswerFragment(html) {
    const box = cleanContainer(html);
    const fragment = document.createDocumentFragment();
    for (const child of Array.from(box.childNodes)) fragment.appendChild(document.importNode(child, true));
    return fragment;
}

/** Quill answer HTML as an HTML string that contains only the allow-listed elements and attributes. */
export function sanitizeAnswerHtml(html) {
    return cleanContainer(html).innerHTML;
}
