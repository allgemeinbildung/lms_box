//
//  js/hko/quelle.js — Bezug eines Blocks: Quelle oder Lehrmittel-Seiten (Vertrag §6, «Quellen»).
//
//  Die Box bettet nichts ein (das tut die Vault-Seite). Sie zeigt «Quelle: <titel> (<herausgeber>)»
//  und, wenn gesetzt, sichtbar «Quellenverweis: …». Bei plattform 'srf' ist der Verweis Pflicht;
//  fehlt er, «Quellenverweis fehlt – bitte der Lehrperson melden» und eine Konsolen-Warnung.
//  Ein Link höchstens auf https:, mit target=_blank und rel=noopener. Alles per textContent.
//
//  Benutzt vom raster-Block: `renderBezug(block, unit)` → Element oder null; für den Druck
//  `bezugZeilen(block, unit)` → Textzeilen.
//
export const VERWEIS_FEHLT = 'Quellenverweis fehlt – bitte der Lehrperson melden';
export const QUELLE_FEHLT = 'Quelle fehlt – bitte der Lehrperson melden';

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function httpsUrl(v) {
    const s = str(v);
    if (!s) return null;
    try {
        const u = new URL(s);
        return u.protocol === 'https:' ? u.href : null;
    } catch { return null; }
}

/** «Kapitel 2.7 A, S. 73, 74; Kapitel 1.5 Bewusster Konsum, S. 37» oder ''. */
export function lehrmittelText(seiten) {
    if (!Array.isArray(seiten)) return '';
    const teile = seiten.filter((s) => s && typeof s === 'object').map((s) => {
        let t = `Kapitel ${str(String(s.kapitel ?? ''))}`;
        if (str(s.abschnitt)) t += ` ${str(s.abschnitt)}`;
        const nr = Array.isArray(s.seiten) ? s.seiten.map((n) => String(n)).filter(Boolean) : [];
        if (nr.length) t += `, S. ${nr.join(', ')}`;
        return t;
    });
    return teile.length ? `Grundlage: Lehrmittel ${teile.join('; ')}` : '';
}

/**
 * Was zum Bezug angezeigt wird, als reine Daten:
 * `{ art: 'quelle'|'lehrmittel'|'fehlt', titelZeile, verweis, verweisFehlt, link: {href, text}|null }`
 * oder null, wenn der Block keinen Bezug hat.
 */
export function bezugInfo(block, unit) {
    const ref = str(block?.quelle_ref);
    if (ref) {
        const q = unit?.quellen?.[ref];
        if (!q || typeof q !== 'object') {
            console.warn(`[hko] Quelle «${ref}» fehlt in unit.quellen`);
            return { art: 'fehlt', titelZeile: QUELLE_FEHLT, verweis: '', verweisFehlt: false, link: null };
        }
        const titel = str(q.titel) || ref;
        const herausgeber = str(q.herausgeber);
        const titelZeile = `Quelle: ${titel}${herausgeber ? ` (${herausgeber})` : ''}`;
        const plattform = str(q.plattform);
        const verweis = plattform === 'nanoo' ? '' : str(q.quellenverweis);
        const verweisFehlt = plattform === 'srf' && !verweis;
        if (verweisFehlt) console.warn(`[hko] Quellenverweis fehlt bei SRF-Quelle «${ref}»`);
        const href = httpsUrl(q.url) || httpsUrl(q.embed_url);
        const link = href ? { href, text: str(q.vault_bild) ? 'Zu den Daten' : 'Zur Quelle' } : null;
        return { art: 'quelle', titelZeile, verweis, verweisFehlt, link };
    }
    const lm = lehrmittelText(block?.lehrmittel_seiten);
    if (lm) return { art: 'lehrmittel', titelZeile: lm, verweis: '', verweisFehlt: false, link: null };
    return null;
}

/** Element `.hko-bezug` für den Bezug des Blocks, oder null. */
export function renderBezug(block, unit) {
    const info = bezugInfo(block, unit);
    if (!info) return null;
    const box = document.createElement('div');
    box.className = 'hko-bezug';
    box.dataset.art = info.art;
    const zeile = document.createElement('p');
    zeile.className = 'hko-bezug-titel';
    zeile.textContent = info.titelZeile;
    if (info.link) {
        const a = document.createElement('a');
        a.href = info.link.href;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = info.link.text;
        zeile.append(' · ', a);
    }
    box.appendChild(zeile);
    if (info.verweis || info.verweisFehlt) {
        const v = document.createElement('p');
        v.className = info.verweisFehlt ? 'hko-bezug-verweis hko-warnung' : 'hko-bezug-verweis';
        v.textContent = info.verweisFehlt ? VERWEIS_FEHLT : `Quellenverweis: ${info.verweis}`;
        box.appendChild(v);
    }
    return box;
}

/** Dieselben Angaben als Textzeilen (Druck; dort escaped einsetzen). */
export function bezugZeilen(block, unit) {
    const info = bezugInfo(block, unit);
    if (!info) return [];
    const zeilen = [info.titelZeile];
    if (info.verweis) zeilen.push(`Quellenverweis: ${info.verweis}`);
    else if (info.verweisFehlt) zeilen.push(VERWEIS_FEHLT);
    return zeilen;
}
