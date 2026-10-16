//
//  js/hko/registry.js — Blocktyp → Modul. Statische Imports, nie ein Pfad aus der URL.
//
//  ── Block-Interface (Vertrag backend/HKO.md «Phase P1» §7) — für alle Block-Autoren ──
//
//  Ein Modul js/hko/blocks/<typ>.js exportiert:
//
//    create()                       Fabrik: liefert eine NEUE Instanz. Aller Zustand (Editoren,
//                                   Felder, ctx) lebt in der Instanz, nie modulglobal.
//    printHtml(value, block, unit)  rein, ohne Zustand: escaptes HTML-Fragment der Antwort für die
//                                   Druckansicht (js/hko/print.js). `value` kann null sein. Jeder Wert
//                                   aus der DB oder dem Inhalt geht durch escapeHtml().
//
//  Die Instanz hat:
//
//    render(block, ctx)   baut das DOM in ctx.container (#content-renderer; main.js hat dort
//                         vielleicht schon einen Hinweis eingefügt – nur anhängen, nie leeren).
//                         Bei jeder Eingabe der Person: ctx.changed(). Ist ctx.readonly, ist alles
//                         gesperrt und ctx.changed() wird nie aufgerufen.
//    collect()            der `value` nach Vertrag §4 aus dem EIGENEN DOM (reiner Text, nie HTML).
//    restore(value)       setzt `value` ins DOM, OHNE ctx.changed() (Quill: setText(…, 'silent'),
//                         dann quill.update('silent')). Verträgt Werte einer älteren unitVersion
//                         (zu viele/zu wenige Zeilen, Fragen weg, Felder fehlen, value null).
//                         main.js ruft restore() synchron direkt nach render() auf, im selben Tick.
//    validate()           → { ok, hinweise: string[], zuGross }. zuGross spiegelt die Rules-Grenzen
//                         (Vertrag §4); dann schreibt save.js nicht und zeigt «zu lang».
//                         Hinweise (z. B. min_woerter) blockieren in P1 nichts.
//    setEnabled(bool)     sperrt/entsperrt alle Eingaben (Logout-Koordination, readonly).
//    printHtml(...)       wie oben (darf auf die Modulfunktion zeigen).
//
//  `mitnahme` und `platzhalter` speichern nichts: sie haben kein collect/restore.
//
//  ctx = { uid, classId, variante, unit, block, unitId, blockId, readonly, api, changed(),
//          container, reportPaste(feld, event) }
//    api           js/hko/api.js (getUnit, getClass, getAnswer, listOwnAnswers, saveAnswer, reportPaste)
//    reportPaste   (feld, {kind, chars, excerpt}) → Promise; feld nach Vertrag §5
//                  (`text`, frageId, `r<zeile>c<spalte>` 0-basiert, `befund`, `begruendung`, `verbessere`)
//
//  Hilfen: js/pasteGuard.js guardEditor() für Quill (unverändert), js/hko/plainGuard.js guardPlain()
//  für <textarea>, js/hko/quelle.js renderBezug()/bezugZeilen(), js/hko/channel.js onAnswer()/onWake()
//  (mitnahme), js/hko/util.js el()/escapeHtml(). Texte in Sie-Form, ohne Eszett, ohne Schul-Branding.
//
import * as text from './blocks/text.js';
import * as items from './blocks/items.js';
import * as raster from './blocks/raster.js';
import * as selbst from './blocks/selbst.js';
import * as mitnahme from './blocks/mitnahme.js';
import * as platzhalter from './blocks/platzhalter.js';

/** `speichert`: der Typ hat ein answers-Dokument (Rules: items, text, raster, selbst). */
const BLOCKS = Object.freeze({
    text: { modul: text, speichert: true },
    items: { modul: items, speichert: true },
    raster: { modul: raster, speichert: true },
    selbst: { modul: selbst, speichert: true },
    mitnahme: { modul: mitnahme, speichert: false },
});
const PLATZHALTER = Object.freeze({ modul: platzhalter, speichert: false });

/** Eintrag zum Typ; unbekannte und spätere Typen (upload, link, roleplay, peer, audio) → Platzhalter. */
export function blockEntry(type) {
    return Object.hasOwn(BLOCKS, type) ? BLOCKS[type] : PLATZHALTER;
}
