//
//  js/hko/print.js — STUB. Wird durch die Druckansicht ersetzt (Plan §2.8, Vertrag §7 «Druck»).
//
//  Aufruf aus main.js (Knopf #print-answers), diese Signatur bleibt:
//
//    printAnswers({ unit, unitId, variante, studentName, api, blockEntry, notify })
//      unit         units/{unitId} (Reihenfolge: unit.reihenfolge)
//      variante     '3J' | '4J' | '2J' | null — nur Blöcke dieser Variante drucken
//      studentName  Name aus dem Roster, zur Laufzeit (nie gespeichert)
//      api          js/hko/api.js — listOwnAnswers(unitId) liest frisch vom Server
//      blockEntry   js/hko/registry.js blockEntry(type) → { modul: { printHtml }, speichert }
//      notify(msg)  zeigt eine Meldung in der Seite (statt alert(); Popup-Sperre usw.)
//    → Promise<void>; wirft nicht.
//
export async function printAnswers({ notify }) {
    notify('Die Druckansicht ist noch nicht verfügbar.');
}
