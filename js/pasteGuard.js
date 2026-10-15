//
//  js/pasteGuard.js — blocks pasting and dropping into an answer editor, and
//  notices when text arrives anyway (browser extensions can switch the block
//  off or "type" the clipboard). Each finding goes to `pasteEvents` through
//  api.reportPaste; the teacher sees it in the Liveview. CONTRACT.md, pasteEvents.
//
//  What counts (kind):
//    paste  the browser inserted a paste: the block did not run
//    drop   text dragged into the editor got past the block
//    bulk   one change inserted BULK_CHARS or more characters
//    fast   FAST_CHARS or more in FAST_WINDOW_MS — faster than anyone types
//  Not counted: text the student deleted in this editor before (undo, moving own
//  text), text already in the editor, and a held-down key (few distinct characters).
//  A finding is a hint, not proof: dictation can insert a whole sentence at once.
//

export const BULK_CHARS = 40;
export const FAST_CHARS = 60;
export const FAST_WINDOW_MS = 3000;
const BURST_QUIET_MS = 1500;     // a fast burst is reported once it has stopped
const NATIVE_INPUT_MS = 1000;    // how long a beforeinput paste/drop marks the next change
const MAX_REPORTS = 30;          // per editor and page load
const MAX_DELETED = 20000;       // characters of deleted text kept for the undo check

const BLOCKED_MESSAGE = 'Einfügen ist deaktiviert, um die Kreativität und das kritische Denken zu fördern.';
const NOTICED_MESSAGE = 'Eingefügter Text erkannt. Deine Lehrperson sieht diesen Hinweis.';

/** Text deleted and inserted by one Quill change; `oldText` is the editor text before it. */
export function diffText(delta, oldText) {
    let index = 0;
    let inserted = '';
    let deleted = '';
    for (const op of delta.ops || []) {
        if (typeof op.retain === 'number') index += op.retain;
        else if (typeof op.delete === 'number') {
            deleted += oldText.slice(index, index + op.delete);
            index += op.delete;
        } else if (typeof op.insert === 'string') inserted += op.insert;
    }
    return { inserted, deleted };
}

const normalize = (text) => text.replace(/\s+/g, ' ').trim();
const distinctChars = (text) => new Set(text.replace(/\s/g, '')).size;

/**
 * @param {object} quill
 * @param {{ isActive: () => boolean,
 *           report: (event: {kind: string, chars: number, excerpt: string}) => Promise<void>,
 *           showMessage: (message: string) => void }} options
 *   isActive: false while the page fills the editor itself.
 */
export function guardEditor(quill, { isActive, report, showMessage }) {
    let nativeKind = null;       // 'paste' | 'drop' from beforeinput, until nativeUntil
    let nativeUntil = 0;
    let deletedText = '';
    let recent = [];             // [{at, text}] small inserts inside the fast window
    let burst = null;            // {text, timer} while a fast burst goes on
    let reports = 0;

    const send = (kind, text) => {
        if (reports >= MAX_REPORTS) return;
        reports += 1;
        showMessage(NOTICED_MESSAGE);
        const event = { kind, chars: text.length, excerpt: text.slice(0, 300) };
        report(event).catch(() => {
            // One retry; offline or a refused write is not worth more.
            setTimeout(() => report(event).catch(() => {}), 5000);
        });
    };

    // Typed by the student before: undo, or own text moved around.
    const isOwnText = (text, oldText) => {
        const n = normalize(text);
        return n.length > 0 && (normalize(deletedText).includes(n) || normalize(oldText).includes(n));
    };

    quill.root.addEventListener('paste', (e) => {
        e.preventDefault();
        showMessage(BLOCKED_MESSAGE);
    });
    quill.root.addEventListener('drop', (e) => {
        e.preventDefault();
        showMessage(BLOCKED_MESSAGE);
    });
    // Only reached when the blocks above did not run: the browser is about to insert.
    quill.root.addEventListener('beforeinput', (e) => {
        if (e.inputType === 'insertFromPaste' || e.inputType === 'insertFromPasteAsQuotation') nativeKind = 'paste';
        else if (e.inputType === 'insertFromDrop') nativeKind = 'drop';
        else return;
        nativeUntil = Date.now() + NATIVE_INPUT_MS;
    });

    const endBurst = () => {
        const text = burst.text;
        burst = null;
        if (distinctChars(text) > 3) send('fast', text);
    };

    quill.on('text-change', (delta, oldDelta, source) => {
        if (source !== 'user' || !isActive()) return;
        const oldText = (oldDelta.ops || []).map((op) => (typeof op.insert === 'string' ? op.insert : '')).join('');
        const { inserted, deleted } = diffText(delta, oldText);
        if (deleted) deletedText = (deletedText + '\n' + deleted).slice(-MAX_DELETED);
        if (!inserted) return;

        const now = Date.now();
        const native = now < nativeUntil ? nativeKind : null;
        nativeKind = null;
        nativeUntil = 0;

        if (native || inserted.length >= BULK_CHARS) {
            if (!isOwnText(inserted, oldText)) send(native || 'bulk', inserted);
            return;
        }

        if (burst) {
            burst.text += inserted;
            clearTimeout(burst.timer);
            burst.timer = setTimeout(endBurst, BURST_QUIET_MS);
            return;
        }
        recent.push({ at: now, text: inserted });
        recent = recent.filter((r) => now - r.at <= FAST_WINDOW_MS);
        const windowText = recent.map((r) => r.text).join('');
        if (windowText.length >= FAST_CHARS && distinctChars(windowText) > 3 && !isOwnText(windowText, oldText)) {
            recent = [];
            burst = { text: windowText, timer: setTimeout(endBurst, BURST_QUIET_MS) };
        }
    });
}
