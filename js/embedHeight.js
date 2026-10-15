// Meldet dem umgebenden Fenster (Obsidian Publish), wie hoch die Seite sein
// müsste, damit nichts innen scrollt: { type: 'lmsbox-height', height }.
// publish.js im Vault setzt damit die Höhe des iframes. Ohne Empfänger bleibt
// alles wie bisher: fester Rahmen, #assignment-container scrollt innen.
//
// Gemessen wird der Inhalt (scrollHeight), nicht der Rahmen — sonst würde der
// Rahmen nie kleiner. Offene Dialoge (Anmeldung, Abmelden) liegen fixiert über
// der Seite und zählen mit, damit sie nicht abgeschnitten werden.

const MESSAGE_TYPE = 'lmsbox-height';

export function initEmbedHeight() {
    if (window.parent === window) return;

    const container = document.getElementById('assignment-container');
    if (!container) return;

    let lastHeight = 0;
    let scheduled = false;

    function measure() {
        const style = getComputedStyle(container);
        let height = container.scrollHeight
            + parseFloat(style.marginTop) + parseFloat(style.marginBottom);

        for (const child of document.body.children) {
            if (child === container || getComputedStyle(child).position !== 'fixed') continue;
            const box = child.firstElementChild;
            if (!box) continue;
            const pad = getComputedStyle(child);
            height = Math.max(height, box.scrollHeight
                + parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom) + 20);
        }
        return Math.ceil(height) + 4;
    }

    function report() {
        scheduled = false;
        const height = measure();
        if (Math.abs(height - lastHeight) < 2) return;
        lastHeight = height;
        window.parent.postMessage({ type: MESSAGE_TYPE, height }, '*');
    }

    function schedule() {
        if (scheduled) return;
        scheduled = true;
        setTimeout(report, 50);
    }

    new ResizeObserver(schedule).observe(container);
    new MutationObserver(schedule).observe(document.body, {
        childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'open', 'style', 'hidden']
    });
    window.addEventListener('resize', schedule);
    window.addEventListener('load', schedule);
    document.addEventListener('toggle', schedule, true); // <details> Musterlösung
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === MESSAGE_TYPE + '-request') {
            lastHeight = 0;
            schedule();
        }
    });

    schedule();
}
