//
//  js/hko/channel.js — BroadcastChannel('hko-answers') (Vertrag §7, Plan §2.7).
//
//  save.js sendet nach jeder LOKALEN Änderung { v: 1, uid, unitId, blockId, value, rev },
//  also schon vor dem Server. Empfänger (mitnahme) sehen nur Nachrichten der eigenen uid:
//  ein anderer Tab mit einem anderen Konto auf derselben Site blendet nichts ein.
//  Der Kanal ist nach Top-Level-Site partitioniert: er reicht über alle iframes aller
//  Seiten derselben Host-Site in diesem Browser, nicht weiter.
//
const NAME = 'hko-answers';
let channel = null;
const listeners = new Set();

function open() {
    if (channel || typeof BroadcastChannel !== 'function') return channel;
    channel = new BroadcastChannel(NAME);
    channel.onmessage = ({ data }) => {
        if (!data || typeof data !== 'object' || data.v !== 1) return;
        for (const fn of listeners) {
            try { fn(data); } catch (error) { console.error('hko-answers:', error); }
        }
    };
    return channel;
}

/** Meldet eine lokale Änderung an alle anderen Frames. */
export function sendAnswer({ uid, unitId, blockId, value, rev }) {
    const c = open();
    if (!c) return;
    try { c.postMessage({ v: 1, uid, unitId, blockId, value, rev }); } catch (error) { console.error('hko-answers:', error); }
}

/**
 * Ruft `fn({ unitId, blockId, value, rev })` für jede Änderung der Person `uid` in einem
 * anderen Frame auf. Gibt die Abmeldefunktion zurück.
 */
export function onAnswer(uid, fn) {
    open();
    const listener = (m) => {
        if (m.uid !== uid || typeof m.unitId !== 'string' || typeof m.blockId !== 'string') return;
        fn({ unitId: m.unitId, blockId: m.blockId, value: m.value, rev: m.rev });
    };
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Ruft `fn()` auf, wenn die Seite wieder sichtbar wird oder den Fokus bekommt: ein iframe
 * verpasst Nachrichten, solange es nicht geladen war, und liest dann neu vom Server.
 * Gibt die Abmeldefunktion zurück.
 */
export function onWake(fn) {
    let last = 0;
    const run = () => {
        if (document.visibilityState === 'hidden') return;
        const now = Date.now();
        if (now - last < 500) return;   // visibilitychange und focus kommen oft zusammen
        last = now;
        fn();
    };
    document.addEventListener('visibilitychange', run);
    window.addEventListener('focus', run);
    return () => {
        document.removeEventListener('visibilitychange', run);
        window.removeEventListener('focus', run);
    };
}
