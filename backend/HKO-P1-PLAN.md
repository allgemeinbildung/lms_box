# hko-box – Plan Phase P1 (Gerüst + Pilot-Einheit)

**Stand:** 15.10.2026 · **Status:** Plan, nichts davon ist gebaut · **Branch:** `hko` (Worktree `app-hko/`)
**Grundlage:** Handoff v1 (`hko-content/_input/HKO_PARALLELSYSTEM_HANDOFF_v1.md`), Antworten C/D (`ANTWORTEN_HKO_PARALLELSYSTEM_v1.md`), `hko-content/_plan/NAECHSTE-PHASE_PROMPT.md` §3/§4, Code im Worktree, Befunde P0 (C1, C3, C5, C6).

**Schreibweise in diesem Plan**

- **Repo-Pfad** = relativ zur Wurzel des Repos `lms_box`. Diese Wurzel ist lokal `app/` (Checkout `main`) bzw. `app-hko/` (Worktree `hko`). Der Handoff schreibt `app/hko.html`; gemeint ist die Datei `hko.html` in der Repo-Wurzel.
- **Öffentliche URL** = GitHub Pages, **ohne** `/app/`:
  - Lernende: `https://allgemeinbildung.github.io/lms_box/hko.html?unit=<unitId>&block=<blockId>`
  - LP-Ansicht: `https://allgemeinbildung.github.io/lms_box/dashboard/hko.html`
  - (geprüft in P0: `/lms_box/index.html` 200, `/lms_box/app/index.html` 404)
- **Achtung:** `NAECHSTE-PHASE_PROMPT.md` §4.2 schreibt dem Generator `…/lms_box/app/hko.html` vor. Das ist falsch und muss die Inhalts-Session korrigieren (siehe §7, A1).

---

## 0. Entscheide, die Pietro vor dem Bau treffen sollte

| # | Frage | Empfehlung |
|---|---|---|
| P1-E1 | Editor für `text` und `items` | **Quill 1.3.6 vom CDN, wie lms_box**, gespeichert wird reiner Text (§2.9) |
| P1-E2 | Lokaler Cache: eigene IndexedDB `HKO_AnswersDB` (Handoff §5.3) oder dieselbe DB mit Präfix (Handoff §6.1)? | **Dieselbe DB `LMS_AssignmentsDB` über `storage.js`, Schlüssel mit Präfix** – sonst leert ein Logout oder Kontowechsel den HKO-Cache nicht (§2.6) |
| P1-E3 | Variante ist vom Client fälschbar (Befund C5) | **Als formativ akzeptieren und dokumentieren.** Die LP-Ansicht rechnet die Variante selbst aus dem Roster und zeigt Abweichungen. Serverseitige Prüfung erst, wenn ein Block bewertet wird (P3, Callable) |
| P1-E4 | Fragen der `items`-Blöcke: im Einheiten-Dokument mitliefern oder aus `items/{slug}` nachladen? | **Mitliefern** (Generator löst auf). Ein Dokument pro iframe, keine Zusatzlesungen (§7) |
| P1-E5 | Klasse nicht in `classes` erfasst | Einheit **lesbar, nichts speicherbar**, Hinweis an die Person, Liste in der LP-Ansicht |
| P1-E6 | Anrede im Login-Dialog | Der geteilte Dialog in `js/auth.js` duzt («Melde dich …»). HKO-Blöcke siezen. **Für P1 so lassen** (keine Änderung an geteiltem Code ohne Not); später additiver Text-Parameter |

---

## 1. Umfang

### In P1

- Einstieg `hko.html` + `js/hko/` (Registry, Speichern, Variante, Druck, Paste-Hinweis, KI-Regel-Anzeige).
- Blöcke `items`, `text`, `raster`, `selbst`, `mitnahme`. Unbekannte Typen (`upload`, `link`, `roleplay`, `peer`, `audio`) zeigen einen neutralen Platzhalter.
- Additive Änderungen an `js/firebase.js` und `js/auth.js` (§2.10), nur nach grünem `npm run test:all`.
- Rules `firestore.hko.rules` für `answers`, `pasteEvents`, `classes`, `units`, `solutions`, `items`, `itemSolutions` + Emulator-Tests (aufbauend auf P0).
- `backend/scripts/hko-upload.mjs` (Dry-Run Standard) + Unit-Tests.
- LP-Ansicht `dashboard/hko.html`, **nur lesen**, mit CSV-Export.
- Test-Fixture (fiktiv) und e2e-Tests für Lernendenseite und LP-Ansicht.
- Vertrag: `backend/HKO.md` (aus P0) wird um Ids, Felder und Client-Regeln von P1 erweitert, **bevor** Code dazu entsteht. `backend/CONTRACT.md` bekommt im Abschnitt «Client» einen additiven Satz zu `hkoDb()`.
- Pilot `lj1-konsum-budget` live auf einer nicht verlinkten Seite in einer 3J-Klasse (4PR26b) und einer 4J-Klasse (4PM26d).

### Nicht in P1

- KI-Feedback jeder Art. Das Adapter-Gerüst (`backend/functions-hko/` mit `llm.js`, Interface `bewerten(request) → response` nach Handoff §7.2, ohne Anbieter) **wandert nach P2**: `HKO.md` (P0) zeigt, dass der Functions-Emulator jede Codebase aus `firebase.json` lädt und damit jeden lmsbox-Lauf verlängert. Ohne Callable in P1 bringt der Eintrag nur Kosten. Wer das Gerüst früher will, legt `llm.js` als reines Node-Modul mit Unit-Test an, **ohne** `firebase.json`-Eintrag.
- Blöcke `upload`, `link`, `roleplay`, `peer`, `audio`; Storage-Rules (P2, siehe Risiko R9).
- KN-Modus mit Abgabe, `kn_fenster`, `knGrades`. Die Rules-Sperre für `kn: true` wird in P1 **vorbereitet und getestet** (billig), die Box zeigt aber keinen Abgabe-Knopf.
- LP-Rückmeldung (`feedbackLP`, `feedbackReleased`), Pflege von `classes` in der Oberfläche.
- Items-Import aus dem Altsystem (P3).
- Eine LP-Vorschau der Lernendenseite (als LP angemeldet zeigt die Box «kein Lernenden-Konto», wie lms_box). Vorschau für Pietro über ein Testkonto.

---

## 2. Architektur Frontend

### 2.1 Dateien (Repo-Pfade)

```
hko.html                          Einstieg; DOM wie index.html (§2.2)
css/hko.css                       eigenes Stylesheet; css/styles.css wird nur gelesen, nicht geändert
js/hko/main.js                    Ablauf: URL → authenticate() → Variante → Unit → Block rendern
js/hko/api.js                     einziger Ort, der DB `hko` anspricht (getUnit, getClass, getAnswer, listOwnAnswers, saveAnswer, reportPaste)
js/hko/registry.js                Typ → Modul (statische Imports, keine dynamischen Pfade aus der URL)
js/hko/save.js                    Debounce, Revisionslogik, unsynced-Marke, Status-Anzeige (Muster renderer.js, eigener Code)
js/hko/variante.js                Variante aus Roster + classes
js/hko/channel.js                 BroadcastChannel('hko-answers')
js/hko/kiRegel.js                 Anzeige der KI-Regel
js/hko/plainGuard.js              Paste-Hinweis für <textarea> (Quill-Felder nutzen js/pasteGuard.js unverändert)
js/hko/print.js                   Druckansicht über window.open + print()
js/hko/blocks/items.js
js/hko/blocks/text.js
js/hko/blocks/raster.js
js/hko/blocks/selbst.js
js/hko/blocks/mitnahme.js
js/hko/blocks/platzhalter.js      unbekannte oder spätere Typen
```

Unverändert wiederverwendet: `js/config.js`, `js/storage.js`, `js/embedHeight.js`, `js/pasteGuard.js`, `js/api.js` (nur `signIn`, `getStudent`, `onAuthChange` über `auth.js`). Additiv geändert: `js/firebase.js`, `js/auth.js` (§2.10). **Nicht berührt:** `index.html`, `js/renderer.js`, `js/app.js`, `js/printer.js`, `js/formativ.js`, alles in `dashboard/modules/` ausser lesendem Import.

### 2.2 `hko.html` – DOM-Vertrag

`js/auth.js` und `js/embedHeight.js` greifen auf feste Ids zu. Damit beide ohne Änderung laufen, hat `hko.html` dasselbe Gerüst wie `index.html`:

```html
<div id="assignment-container">          <!-- embedHeight misst diesen Container; ohne ihn bricht es still ab (Befund C6) -->
  <header id="assignment-header"><h2 id="main-title"></h2><h3 id="sub-title"></h3></header>
  <div id="hko-ki-regel"></div>
  <main id="content-renderer"></main>    <!-- auth.js ersetzt den Inhalt durch Hinweise -->
  <div id="action-container"><button id="print-answers">PDF</button><span id="save-status" role="status" aria-live="polite"></span></div>
</div>
```

- Der Container wird **nicht** an `100vh` gekoppelt (sonst misst `scrollHeight` die Rahmenhöhe statt des Inhalts).
- Gleiche Klasse `embedded` auf `<html>` vor dem ersten Paint wie `index.html`.
- Quill-CSS und -Skript vom gleichen CDN wie `index.html`; `js/hko/main.js` als `type="module"`.

### 2.3 Ablauf `main.js`

1. `initEmbedHeight()` (Höhenprotokoll `{type:'lmsbox-height'}` unverändert; `publish.js` prüft nur Origin, Typ und `contentWindow`, Befund C6).
2. URL lesen: `unit`, `block`. Beide müssen `^[a-z0-9-]{1,80}$` erfüllen, sonst Fehlertext (immer `textContent`, nie HTML).
3. `authenticate()` aus `js/auth.js` → `{ uid, student }`.
4. Parallel: `getUnit(unit)` und `variante.ermitteln(student)`.
5. Block suchen (`unit.blocks[block]`), Modul aus der Registry, `render(block, ctx)`.
6. Speichern initialisieren (`save.js`), KI-Regel anzeigen, Druckknopf verdrahten.

`ctx` (Handoff §6.1, ergänzt):

```js
ctx = {
  uid, classId, variante,            // variante: '3J' | '4J' | '2J' | null (Klasse unbekannt)
  unit, block, unitId, blockId,
  readonly,                          // true: falsche Variante, Klasse unbekannt, KN abgegeben
  api,                               // { getAnswer(unitId, blockId), reportPaste(feld, event) }
  changed(),                         // vom Block bei jeder Eingabe der Person aufgerufen
  container,                         // #content-renderer
}
```

Block-Modul (alle gleich):

| Funktion | Pflicht | Zweck |
|---|---|---|
| `render(block, ctx)` | ja | baut das DOM, ruft bei Eingaben `ctx.changed()` |
| `collect()` | ja (ausser `mitnahme`) | liefert `value` nach §6.2 aus dem eigenen DOM |
| `restore(value)` | ja (ausser `mitnahme`) | setzt `value` ins DOM **ohne** `ctx.changed()`; verträgt Werte aus einer älteren `unitVersion` (zu viele/zu wenige Zeilen, Fragen weg) |
| `validate()` | ja | `{ ok, hinweise[], zuGross }`; `zuGross` spiegelt die Rules-Grenzen, damit die Seite «zu lang» zeigt, bevor die Rules ablehnen. Hinweise (z. B. `min_woerter`) blockieren in P1 nichts |
| `setEnabled(bool)` | ja | für Logout-Koordination (§2.10) |
| `printHtml(value)` | ja | escaped HTML-Fragment für die Druckansicht |

### 2.4 Variante

```
students/{uid}.classId  (Roster, DB (default), Lite, vom auth.js-Ablauf schon gelesen)
  → classes/{classId}   (DB hko)  → { variante, lehrjahr, aktiv }
```

| Fall | Verhalten | gespeichert? |
|---|---|---|
| Variante passt, Block ohne `nur_variante` oder mit passender | normal | ja |
| Block `nur_variante` ≠ Variante | «Dieser Auftrag gilt für die 3-jährige Lehre.» bzw. 4-jährige | nein, kein Dokument |
| Einheit kennt die Variante nicht (z. B. 2J, `unit.varianten` ohne `2J`) | «Diese Einheit ist für Ihre Lehre nicht vorgesehen.» | nein |
| `classes/{classId}` fehlt | Einheit lesbar, Hinweis «Ihre Klasse ist für diese Einheiten noch nicht erfasst. Melden Sie das Ihrer Lehrperson.» | nein |
| `aktiv: false` | wie «fehlt», anderer Text | nein |
| Roster hat mehrere `classIds` mit verschiedenen Varianten | erste Klasse (`classId`) gilt; Konsole-Warnung; LP-Ansicht markiert die Person | ja |
| `classes` nicht lesbar (Netz) | Fehlertext mit «Seite neu laden», wie `showAccountError` | nein |

Die Variante ist **nicht serverseitig gesichert** (Befund C5: Rules von `hko` können `(default)` nicht lesen). Die Rules prüfen nur, dass `variante` einer der drei Werte ist und zu `nur_variante` passt. Wer sein `answers`-Dokument mit einer falschen Variante schreibt, schadet nur der eigenen formativen Arbeit. Die LP-Ansicht berechnet die Variante selbst und markiert Abweichungen (§5).

### 2.5 Speichern (`save.js`, `js/hko/api.js`)

- Dokument `answers/{uid}__{unitId}__{blockId}` (Handoff §5.3). Da alle Ids `[a-z0-9-]` sind, ist `enc()` die Identität; `__` kommt in Ids nicht vor.
- Felder genau: `uid, classId, unitId, blockId, unitVersion, variante, type, value, status, kn, updatedAt` (`serverTimestamp()`). `status` in P1 immer `entwurf`.
- **Ganzes Dokument per `setDoc`**, nie `updateDoc` (wie lms_box).
- **Debounce 2 s**, Warteschlange: immer nur ein Schreibvorgang gleichzeitig.
- **Revisionslogik** wie `renderer.js` (Code nachgebaut, nicht importiert, weil `renderer.js` modulglobalen Zustand für lms_box hält):
  - Jede Eingabe: `rev = <zeit>-<zufall>`, im selben `storage.atomic()` die Marke `unsynced_hko_<unitId>_<blockId>` = `{ rev, state: 'local', value }` schreiben.
  - Nach erfolgreichem `setDoc` die Marke nur löschen, wenn `marke.rev === gespeicherte rev`; bei Fehler `state: 'error' | 'too_large'` in die Marke.
  - Beim Laden: gültige Marke gewinnt über den Server, wird angezeigt und sofort nochmals gespeichert.
  - Gespeichert wird **immer aus dem eigenen DOM** (`collect()`), nie aus dem Cache.
  - `isInitializing`: `restore()` läuft, bevor Eingabe-Listener aktiv werden; erst nach `setTimeout(0)` zählt eine Änderung als Eingabe. Bei Quill zusätzlich `quill.update('silent')` wie `renderer.js` Z. 317–320.
- Statusanzeige `#save-status` mit denselben Zuständen und Texten wie lms_box (`saving | local | cloud | error | too_large`), aber in Sie-Form («Ihre Antwort ist zu lang …»).
- **Keine leeren Erstdokumente:** Ein Block, in dem die Person nichts eingegeben hat, schreibt nichts (lms_box-Test (k) «never writes an empty draft» gilt sinngemäss).

### 2.6 Lokaler Cache – Empfehlung P1-E2

Handoff §5.3 nennt eine eigene IndexedDB `HKO_AnswersDB`, §6.1 sagt «`storage.js` mit eigenem Key-Präfix». Das widerspricht sich. Empfehlung: **`storage.js` unverändert, also dieselbe DB `LMS_AssignmentsDB`, nur mit Präfix.**

| | eigene `HKO_AnswersDB` | gleiche DB, Präfix (Empfehlung) |
|---|---|---|
| Logout leert den Cache | nein – `auth.js` ruft nur `storage.clear()` der lms_box-DB | ja, ohne Änderung |
| Kontowechsel am Schul-PC (`prepareCache`) | HKO-Text der vorigen Person bliebe liegen | wird geleert |
| Änderung an `storage.js` | Fabrik `createStore(name)` nötig + Hook in `auth.js` | keine |
| Logout aus einem lms_box-iframe auf einer gemischten Seite warnt vor ungespeichertem HKO-Text | nein | ja, weil `hasUnsyncedWork()` nach `unsynced_`-Präfix sucht |
| Konflikt mit lms_box-Schlüsseln | keiner | keiner: `printer.js` liest nur `title_`, `modular-…`-Präfixe; `unsynced_hko_…` kollidiert nicht mit `unsynced_<assignmentId>_sub_…`, weil kein lms_box-`assignmentId` mit `hko_` beginnt (prüft `hko-upload` nicht, aber `check-vault-ids` zeigt keine solche Id) |

Gespeichert wird im Cache **nur die Marke**. Die Druckansicht liest frisch vom Server (§2.8), eine Druckkopie im Cache ist nicht nötig.

### 2.7 `mitnahme` und `BroadcastChannel('hko-answers')`

- `mitnahme.quellen: [{unitId, blockId, feld?, label}]`. Beim Rendern je Quelle ein `getDoc(answers/{uid}__{unitId}__{blockId})` (eigenes Dokument, auch aus anderen Einheiten). Keine Annahme über Geschwister-iframes (Lazy Rendering, A9.5).
- `feld` ist ein Pfad in `value` (Absprache §7): `text`, `befund`, `zellen`, `antworten.<frageId>`, `stufen`, `begruendung`, `verbessere`. Ohne `feld`: ganze Antwort, typgerecht formatiert.
- Anzeige nur als Text (`textContent`, Zeilenumbrüche per CSS `white-space: pre-wrap`). Leer: «Noch nichts geschrieben.»
- Live: `save.js` sendet nach jeder **lokalen** Änderung (nicht erst nach dem Server) `{ v: 1, uid, unitId, blockId, value, rev }` auf `hko-answers`. Empfänger prüfen `uid === ctx.uid` (ein anderer Tab mit anderem Konto auf derselben Site darf nichts einblenden) und aktualisieren. Zusätzlich bei `visibilitychange`/`focus` neu vom Server lesen, weil ein iframe Nachrichten verpasst, solange es noch nicht geladen war.
- Der Kanal ist partitioniert (Top-Level-Site), wirkt also über alle iframes aller Seiten von `lehrmittel.aburossi.ch` im selben Browser – das ist der gewünschte Umfang.
- Bei `kn: true`-Quellen zeigt `mitnahme` nichts an (Handoff §6.3), in P1 nur als Regel im Code und Test.

### 2.8 KI-Regel, Paste-Hinweis, Druck

- **KI-Regel:** `block.ki_regel` (Pflicht laut §10 R7) über dem Block, als Kasten mit Stufe (Symbol + Wort) und Text. Fehlt sie, zeigt die Box «KI-Regel fehlt – bitte der Lehrperson melden» und schreibt eine Konsole-Warnung (der Check der Inhalts-Session soll das ohnehin verhindern).
- **Paste-Hinweis:** Quill-Felder (`text`, `items`) über `guardEditor()` aus `js/pasteGuard.js` **unverändert** (die Datei importiert nichts und ist Quill-, nicht lms_box-gebunden). `<textarea>`-Felder (`raster`, `selbst`) über `js/hko/plainGuard.js` mit den Arten `paste`, `drop`, `bulk` (gleiche Schwellen, `BULK_CHARS` importiert). Ziel `hko/pasteEvents`, nie eine Sanktion, Meldetext wie lms_box in Sie-Form.
- **Druck:** Knopf «PDF» → `listOwnAnswers(unitId)` (`where uid == uid`, `where unitId == unitId`) + Unit → HTML mit allen Blöcken der eigenen Variante (`printHtml`) → `window.open('')`, `document.write`, `print()`. Kein Download-Knopf (Sandbox ohne `allow-downloads`). Name aus `student.name` zur Laufzeit. Bei Popup-Sperre ein Hinweis im Block, kein `alert()`.

### 2.9 Editor für `text` (und `items`) – Empfehlung P1-E1: Quill

Quill 1.3.6 vom selben CDN, `toolbar: false, formats: []`, wie `renderer.js`. Die Quill-Dateien des Altsystems werden nicht angefasst; `js/hko/blocks/text.js` legt eigene Instanzen an.

Begründung:
1. `js/pasteGuard.js` arbeitet auf Quill-Deltas und lässt sich so **unverändert** wiederverwenden; die Hinweise in `hko/pasteEvents` und `lmsbox/pasteEvents` bedeuten dann dasselbe.
2. Die heiklen Fälle (Initialisierung löst `text-change` mit `source='user'` aus, Wiederherstellen ohne Speichern) sind in lms_box gelöst und getestet; derselbe Ablauf lässt sich übernehmen.
3. Gleiches Schreibgefühl wie im Altsystem für Lernende, die beides nutzen.

Gespeichert wird **reiner Text** (`quill.getText()` ohne abschliessenden Zeilenumbruch), wiederhergestellt mit `quill.setText(value, 'silent')`. Folgen: Rules zählen echte Zeichen, die LP-Ansicht braucht keinen HTML-Sanitizer, `hkoFormativ` bekommt später sauberen Text.

`raster`-Zellen, `befund` und `selbst`-Texte sind kurz und zahlreich (bis 48 Zellen): dort `<textarea>` mit automatischer Höhe, nicht Quill.

Gegenargument `<textarea>` überall: leichter, kein CDN. Verworfen, weil dann ein zweiter Paste-Wächter für lange Texte nötig wäre und das in lms_box gemessene Verhalten verloren ginge.

### 2.10 Geteilte Module – additive Änderungen

Reihenfolge: (1) `npm run test:all` auf dem Stand des Branches grün dokumentieren, (2) Änderung, (3) `npm run test:all` grün, (4) erst dann HKO-Code darauf bauen. Jede Änderung in einem eigenen Commit.

**`js/firebase.js` – zweite benannte DB mit Firestore Lite.** Firestore Lite unterstützt `getFirestore(app, databaseId)`; mehrere Lite-Instanzen auf derselben App (je eine pro DB) sind erlaubt, so wie heute schon `db` (`lmsbox`) und `rosterDb` (`(default)`). Damit lms_box-Seiten **gar keine** dritte Instanz anlegen, wird `hko` erst beim ersten Aufruf erzeugt:

```js
// additiv, unter den bestehenden Exporten
let hkoInstance = null;
/** Database `hko` (HKO parallel system), Lite. Created on first use, so lms_box pages never open it. */
export function hkoDb() {
    if (!hkoInstance) {
        hkoInstance = getFirestore(app, 'hko');
        if (useEmulators) connectFirestoreEmulator(hkoInstance, host, EMULATOR_PORTS.firestore);
    }
    return hkoInstance;
}
```

- Getter statt Konstante `hkoDb`: `db`, `rosterDb`, die Emulator-Verbindung und die Konsolenmeldungen bleiben Zeichen für Zeichen gleich. `connectFirestoreEmulator` muss vor dem ersten Zugriff laufen – das garantiert der Getter.
- Falls weitere Lite-Funktionen nötig sind (z. B. `limit`), werden sie in die bestehende Re-Export-Zeile **angehängt**, nichts entfernt.
- Kein neuer Import des vollen Firestore-Builds in `js/`. Die LP-Ansicht lädt den vollen Build in einem eigenen Modul (§5), wie `dashboard/modules/firestore.js`.
- CONTRACT.md «Client»: ein Satz «exportiert zusätzlich `hkoDb()` (DB `hko`, Lite, lazy); Vertrag in `HKO.md`».

**`js/auth.js` – Logout-Koordination für HKO-Frames.** `auth.js` importiert `flushPendingSave`, `hasUnsavedEdits`, `suspendSaving`, `resumeSaving`, `closeSaving` fest aus `renderer.js`. In einem HKO-iframe sind diese Funktionen leer: ein Logout würde den noch wartenden HKO-Debounce nicht schreiben, und ein Geschwister-Logout bekäme «nichts ungespeichert» zurück. Additiver Hook:

```js
// additiv: weitere Speicher-Stellen (js/hko/save.js) melden sich an
const savers = [];
export function registerSaver(s) { savers.push(s); }   // { flush, hasUnsaved, suspend, resume, close }
```

Die fünf bestehenden Aufrufstellen rufen zusätzlich `savers.forEach(...)` bzw. verknüpfen mit `||`. Ohne Anmeldung (jede lms_box-Seite) ist das Verhalten identisch. `renderer.js` bleibt unberührt; der Import aus `renderer.js` bleibt (in `hko.html` sind dessen Funktionen schlicht leer, `Quill` wird beim Import nicht gebraucht).

Nebenwirkung, bewusst akzeptiert: `hko.html` lädt über `auth.js` → `api.js` auch die Lite-Instanz von `lmsbox` (ohne Abfragen, ohne Verbindung) und `renderer.js`. Das kostet etwas Parse-Zeit, aber keine Netzverbindung.

**Unverändert:** `js/storage.js` (P1-E2), `js/embedHeight.js` (DOM-Vertrag §2.2), `js/api.js`, `js/pasteGuard.js`.

---

## 3. Rules P1 (`firestore.hko.rules`)

P0 legt die Datei mit «alles zu ausser `units`/`items` lesen» und `test/hko-rules.test.mjs` an. P1 erweitert beides. Muster und Hilfsfunktionen (`signedIn`, `isTeacher`, `notAnonymous`, `isSchoolAccount`, `shortString`) wie `firestore.lmsbox.rules`, als Kopie (Rules-Dateien können nichts importieren).

### 3.1 Übersicht

| Pfad | Lernende | LP | Bemerkung |
|---|---|---|---|
| `units/{unitId}` | lesen, wenn `isSchoolAccount()` | lesen | schreiben nur Admin-SDK |
| `solutions/{unitId}`, `itemSolutions/{slug}` | nichts | **in P1 weiter zu** | schreiben nur Admin-SDK. Die LP-Ansicht P1 zeigt keine Lösungen; den Lehrer-Claim haben auch LP des Lernportals (`HKO.md`). Öffnen erst mit P2 (Rückmeldung), mit Test |
| `items/{slug}` | lesen, wenn `isSchoolAccount()` | lesen | |
| `classes/{classId}` | lesen, wenn `isSchoolAccount()` | lesen, schreiben (Handoff §5.1) | Felder `variante ∈ {3J,4J,2J}`, `lehrjahr` int 1–4, `aktiv` bool, feste Keys. In P1 schreibt sie nur das Admin-Skript |
| `answers/{answerId}` | eigene lesen, anlegen, ändern (§3.2) | lesen | **kein Delete**, LP schreibt in P1 nicht |
| `pasteEvents/{eventId}` | nur anlegen | lesen | wie lms_box |
| `students/{uid}` | **nur Emulator**, lesend (eigenes Dokument oder LP) | | nötig, weil der Emulator ein Ruleset für alle DBs nutzt; in `hko` gibt es die Collection live nicht |
| alles andere | zu | zu | `feedback`, `usage`, `knGrades` … erst ab P2 |

### 3.2 `answers`

```
allow get:    if isTeacher() || (notAnonymous() && idIsOwn(answerId)
                 && (resource == null || resource.data.uid == request.auth.uid));
allow list:   if isTeacher() || (notAnonymous() && resource.data.uid == request.auth.uid);
allow create: if answerOk(answerId);
allow update: if answerOk(answerId)
                 && resource.data.uid == request.auth.uid
                 && unveraendert(['uid','unitId','blockId','type','kn'])
                 && !(resource.data.kn == true && resource.data.status == 'abgegeben');   // KN-Sperre, vorbereitet
allow delete: if false;
```

`answerOk(answerId)` – in dieser Reihenfolge, billige Prüfungen zuerst (`&&` bricht ab, bevor `get()` läuft):

1. `isSchoolAccount()`.
2. Keys: `hasAll` und `hasOnly` auf `uid, classId, unitId, blockId, unitVersion, variante, type, value, status, kn, updatedAt`.
3. `d.uid == request.auth.uid` und **exakte** Id: `answerId == d.uid + '__' + d.unitId + '__' + d.blockId` (strenger als `idIsOwn`).
4. `d.unitId`, `d.blockId` passen `^[a-z0-9-]{1,80}$`; `d.classId` String ≤ 100; `d.unitVersion` int ≥ 1; `d.variante in ['3J','4J','2J']`; `d.status in ['entwurf','abgegeben']`; `d.kn is bool`; `d.updatedAt == request.time`.
5. Ein `get()`: `let blk = get(/databases/$(database)/documents/units/$(d.unitId)).data.blocks[d.blockId];` – fehlt Einheit oder Block, ist der Ausdruck ein Fehler = Ablehnung. Damit kann niemand Antworten zu erfundenen Blöcken schreiben.
6. `d.type == blk.type`, `blk.type in ['items','text','raster','selbst']` (nicht `mitnahme`, nicht spätere Typen), `d.kn == blk.get('kn', false)`.
7. `blk.get('nur_variante', null) == null || d.variante == blk.nur_variante` (formale Stimmigkeit, kein Beweis, siehe §2.4).
8. `valueOk(d.type, d.value, blk)` als verschachtelter Ternär-Ausdruck (`t == 'text' ? textOk(v) : t == 'items' ? itemsOk(v) : …`), damit nur der passende Zweig zählt.

Typ-Grenzen (Handoff §6.2, mit Ergänzungen in *kursiv*):

| Typ | `value` | Prüfung |
|---|---|---|
| `text` | `{ text }` | Keys nur `text`; String ≤ 20 000 |
| `items` | `{ antworten: [{frageId, text}] }` | Liste ≤ 12; je Eintrag Keys genau `frageId, text`, `frageId` ≤ 100, `text` ≤ 3 000; ausgerollt über 12 Indizes |
| `raster` | *`{ zellen: [{c: [string]}], befund }`* | ≤ 8 Zeilen, je ≤ 6 Zellen ≤ 500; *`befund` ≤ 3 000*. **Abweichung:** Handoff `string[][]` – Firestore speichert keine Liste direkt in einer Liste, deshalb eine Zeile als Map `{c: [...]}` |
| `selbst` | `{ stufen: {kritId: 0–3}, begruendung, verbessere }` | `stufen.keys().hasOnly(blk.kriterien)`, ≤ 6 Einträge, Werte int 0–3 (über `stufen.values()` ausgerollt); `begruendung` ≤ 1 500; *`verbessere` ≤ 1 500* |

**Ausdrucks-Budget:** Rules haben keine Schleifen und höchstens 1 000 ausgewertete Ausdrücke pro Anfrage; lms_box hat erlebt, dass 12 Einträge nicht passten (Kommentar in `firestore.lmsbox.rules`). Das Raster (48 Zellen) und `items` (12 Antworten) sind die Grenzfälle. **Erste Aufgabe im Arbeitspaket Rules** ist ein Spike mit vollem Raster und 12 Items im Emulator (er erzwingt das Budget). Rückfallebene, falls es nicht passt: Raster ≤ 6 × 5 bzw. Items ≤ 8 pro Block; dann meldet die Box das der Inhalts-Session als Schemagrenze.

### 3.3 `pasteEvents`

- Id `{uid}__{unitId}__{blockId}__{eventId}`, `eventId` `[A-Za-z0-9]{8,40}`.
- Felder genau `uid, unitId, blockId, feld, kind, chars, excerpt, at`; `feld` ≤ 100 (`text`, `frageId`, `r2c3`, `befund`, `begruendung` …); `kind in ['paste','drop','bulk','fast']`; `chars` int 0–20 000; `excerpt` ≤ 300; `at == request.time`; `isSchoolAccount()`; nur `create`.
- Kein `get()` auf `units` (Kosten, und ein Hinweis zu einem erfundenen Block schadet nicht; die LP-Ansicht zeigt nur Hinweise zu bekannten Blöcken).

### 3.4 Kosten der `get()`-Aufrufe

Ein `get()` in Rules wird als **ein Dokument-Lesevorgang** verrechnet, unabhängig von der Grösse des Einheiten-Dokuments. Pro Speichern also 1 Schreiben + 1 Lesen.

Schätzung pro Lektion und Klasse: 25 Lernende × höchstens ~150 Speicherungen (Debounce 2 s, also eine pro Tipp-Pause) ≈ 3 750 Schreib- + 3 750 Lesevorgänge, dazu pro iframe-Aufruf 3 Lesungen (Roster, `classes`, `units`) + 1 (eigene Antwort): bei 9 iframes ≈ 900. Bei Firestore-Preisen in der Grössenordnung von Zehntelrappen pro 1 000 Vorgängen sind das **wenige Rappen pro Lektion**. Ob das Gratiskontingent für eine benannte DB gilt, ist für diese Grösse unerheblich. Wenn je nötig: Debounce für `raster` auf 4 s.

### 3.5 Testfälle (`test/hko-rules.test.mjs`, eigene Test-Config aus P0)

Lesen
1. Schulkonto liest `units`, `items`, `classes`; anonym und Fremd-Domain (`@gmail.com`, Passwort) lesen nichts davon.
2. Niemand liest `solutions`, `itemSolutions` (P0-Test bleibt); niemand schreibt sie.
3. Eigene Antwort `get`/`list` (mit `where uid ==`) ja; fremde nein; `list` ohne `uid`-Filter nein; LP liest alle.

Anlegen/Ändern `answers` – je ein Fall, der klappt, und einer, der scheitert:

4. Gültige Antwort je Typ `items`, `text`, `raster`, `selbst`.
5. Fremde uid in den Daten; Id einer anderen Person; Id passt nicht zu `unitId`/`blockId`.
6. Zusätzlicher oder fehlender Key; `updatedAt` vom Client.
7. Block existiert nicht; Einheit existiert nicht; Block vom Typ `mitnahme`; Typ `upload`.
8. `type` ≠ Block-Typ; `kn` ≠ Block-`kn`.
9. `nur_variante: '4J'` mit `variante: '3J'`; ungültige Variante `'5J'`.
10. Grenzen genau auf und eins über: Text 20 000/20 001; 12/13 Items; Item-Text 3 000/3 001; Raster 8 × 6 / 9 Zeilen / 7 Zellen / Zelle 501; Raster als `string[][]` (wird schon vom SDK abgelehnt – Test dokumentiert das); `selbst` mit Kriterium, das der Block nicht hat; Stufe 4; Stufe `'2'` als String.
11. Volles Raster und 12 Items **bleiben im Ausdrucks-Budget** (Spike, §3.2).
12. Update ändert `unitId`, `blockId`, `type` oder `kn` → abgelehnt.
13. KN-Sperre: Fixture-Block `kn: true`, Status `abgegeben` gespeichert → jedes weitere Update abgelehnt; bei `kn: false` darf `abgegeben` → `entwurf` zurück.
14. Delete durch Person und LP → abgelehnt.
15. LP schreibt `answers` → abgelehnt (P1).
16. Anonym, Passwort-Konto mit Fremd-Domain, Schulkonto mit Grossbuchstaben in der Adresse (Auth liefert klein) – nur das Schulkonto schreibt.

`pasteEvents`, `classes`
17. Gültiges Ereignis; fremde uid; falsches `kind`; `excerpt` 301; Lesen/Ändern/Löschen durch die Person → abgelehnt.
18. `classes`: Schulkonto schreibt nicht; LP schreibt gültig; ungültige Variante oder Zusatz-Key → abgelehnt.

Isolation
19. `npm run test:all` (lms_box) bleibt grün; `git diff main -- backend/firestore.lmsbox.rules` leer.

---

## 4. Upload `backend/scripts/hko-upload.mjs`

Aufbau wie `upload-assignments.mjs`; Prüflogik in `backend/scripts/lib/hko-validate.mjs` (reine Funktionen, testbar ohne Firebase).

| | |
|---|---|
| Quelle | `--build <dir>`, Standard `<repo>/../hko-content/build` (gilt für `app/` und `app-hko/`, beide liegen neben `hko-content/`). Liest `units/*.json`, `solutions/*.json`; `items/*.json` und `itemSolutions/*.json`, sobald es sie gibt |
| Modi | genau einer: `--dry-run` (Standard, braucht kein `node_modules`), `--emulator` (verlangt `FIRESTORE_EMULATOR_HOST`, Projekt der HKO-Test-Config), `--live --key <pfad> --yes` |
| Ziel | **nur DB `hko`**, Projekt `interactive-media-2a1fc`. Die DB-Id ist eine Konstante, kein Parameter |
| Schlüssel | Pfad wird mit `realpathSync` aufgelöst; liegt er im Repo → Abbruch (Code von `upload-assignments.mjs` übernehmen). `project_id` im Schlüssel muss stimmen. `--live` mit gesetztem `FIRESTORE_EMULATOR_HOST` → Abbruch |
| Schreiben | ganze Dokumente per `batch.set()` (kein Merge), Batches à 400. `updatedAt = FieldValue.serverTimestamp()` setzt das Skript, nicht der Build |
| Löschen | nie. Dokumente in der DB ohne Build-Datei werden nur aufgelistet («verwaist») |

Prüfungen (jede Verletzung = Fehler, Exit ≠ 0; vor `--live` muss alles grün sein):

1. Dateiname ohne `.json` = `unitId` im Dokument; `^[a-z0-9-]{1,80}$`; jede `blockId` ebenso; jede `frageId` in `items` `^[a-z0-9-]{1,100}$`.
2. **Keine Lösungsfelder in `units`:** rekursive Suche nach den Schlüsseln `loesungen`, `erwartungshorizont`, `mehrdeutigkeit`, `musterloesung`, `loesung`, `solution`, `kalibrierung`, `systemanweisung`. Treffer = Fehler mit Pfad. Ebenso in `items`.
3. Zu jedem `solutions/<id>.json` gibt es `units/<id>.json`, und umgekehrt (fehlende Lösung nur Warnung, solange kein Block `feedback.aktiv` hat).
4. Pflichtfelder, die die Box braucht (Liste §7.1), vorhanden und vom richtigen Typ; `blocks` ist eine **Map**, nicht eine Liste oder nach Phasen verschachtelt.
5. Blocktypen bekannt; Typen ausserhalb P1 → Warnung «Box zeigt Platzhalter».
6. Grenzen aus §3.2, die der Inhalt bestimmt: `raster.zeilen ≤ 8`, `spalten ≤ 6`, `items`-Fragen pro Block ≤ 12, `selbst.kriterien ≤ 6` und jedes Kriterium existiert in `unit.kriterien`.
7. `mitnahme.quellen` zeigen auf existierende Blöcke (in diesem Build oder, mit `--live`, in der DB).
8. Kein Eszett in Texten (Warnung; der Check der Inhalts-Session ist massgebend).
9. Dokumentgrösse < 1 MiB minus Marge.
10. Nur `--live`: bestehende `version` wird gelesen; kleinere Version → Abbruch ohne `--force-version`. Gleiche Version mit anderem Inhalt → Warnung «Version nicht erhöht».

Ausgabe wie `upload-assignments.mjs` (Modus, Quelle, je Dokument eine Zeile, Zusammenfassung).

Unit-Tests `test/hko-upload.test.mjs` (`node --test`, ohne Emulator, gegen Fixture-Ordner unter `test/fixtures/hko-build/`): gültiger Build grün; `loesungen` in einer Unit; `erwartungshorizont` tief verschachtelt; Dateiname ≠ `unitId`; Id mit Grossbuchstaben/Leerzeichen; Raster 9 Zeilen; `selbst` mit unbekanntem Kriterium; `mitnahme` ins Leere; Schlüssel im Repo (temporäre Datei unter `backend/`); `--live` ohne `--yes`; `--live` mit Emulator-Variable. Dazu ein Emulator-Test im `test:hko`-Lauf: `--emulator` schreibt, zweiter Lauf ist idempotent.

Später (nicht P1): `hko-classes.mjs` nach gleichem Muster für `classes`, falls P0 die Live-Klassen nicht schon anlegt.

---

## 5. LP-Ansicht `dashboard/hko.html` (nur lesen)

Dateien: `dashboard/hko.html`, `dashboard/hko/main.js`, `dashboard/hko/api.js` (einziger Datenzugriff), `dashboard/hko/firestore.js` (voller Build auf DB `hko`, `onSnapshot`), `dashboard/hko/grid.js`, `dashboard/hko/detail.js`, `dashboard/hko/csv.js`.

Wiederverwendet **ohne Änderung**:
- `dashboard/modules/auth.js` (`initAuth`, Login mit Claim `role == 'teacher'`); `hko.html` hat dafür dieselben Ids (`login-overlay`, `login-username`, `login-password`, `login-btn`, `login-status`, `logout-btn`). Er zieht `dashboard/modules/api.js` mit (dessen `lmsbox`-Instanz bleibt ungenutzt).
- `dashboard/modules/sanitize.js` (`escapeHtml`); Antworten sind reiner Text, also immer `escapeHtml` bzw. `textContent`, nie `sanitizeAnswerHtml`.
- `dashboard/teacher.css`.

Nicht wiederverwendbar, deshalb nachgebaut: Roster-Laden (`loadRoster` ist in `dashboard/modules/api.js` nicht exportiert; ~25 Zeilen kopieren, inkl. Namens-Entdopplung per Benutzername) und der CSV-Export (`exporter.js` hängt an `lmsbox`-Aufträgen und am Evaluator).

Ablauf:
1. Login (LP). Roster aus `(default)` (Lite), `classes` und Liste der `units` aus `hko`.
2. Auswahl Klasse × Einheit. Klassen ohne `classes`-Dokument erscheinen mit «nicht erfasst» (Liste für Handoff §6.1).
3. Antworten **über die uids der Klassenliste**, nie über `classId` im Dokument: `answers where uid in [≤30] and unitId == …`, je 30 uids ein Listener (wie `watchClass`). Gleich für `pasteEvents`.
4. Raster Person × Block. Spalten = Blöcke in Seitenreihenfolge, gefiltert nach Variante der Klasse (Blöcke mit anderem `nur_variante` ausgeblendet, `mitnahme` nie). Zelle: Kurzstand («–», «angefangen», Wortzahl bzw. ausgefüllte Zellen, Zeitpunkt), Paste-Symbol mit Anzahl.
5. Detail (Klick): `text` als Text mit Umbrüchen; `items` Frage → Antwort; `raster` als Tabelle mit Kopfzeile aus `spalten`; `selbst` Stufen je Kriterium (Name + Stufentext) und beide Texte; Paste-Hinweise mit Art, Zeichen, Auszug.
6. Variante: aus Roster → `classes` berechnet. Weicht `answers.variante` davon ab, Markierung «Variante im Dokument: 4J» (P1-E3).
7. Antworten von uids ausserhalb der Klassenliste erscheinen nie (sie werden gar nicht abgefragt).
8. **CSV** (`;`, UTF-8 mit BOM für Excel): eine Zeile pro Person × Block: `Name;Klasse;Variante;Block;Typ;Stand;Antwort;Paste-Hinweise`. Mehrteilige Antworten als Text mit ` | ` zwischen Teilen. Schutz: Felder mit `;`, `"` oder Zeilenumbruch in Anführungszeichen; Werte, die mit `= + - @` beginnen, bekommen ein führendes `'` (Formel-Injektion). Die Datei trägt Namen: nur lokal speichern (Router §4), nie in ein Repo oder Artifact.

Kein Evaluator, keine Freigabe, kein Drucken der Klasse in P1.

---

## 6. Tests

| Skript (in `backend/package.json`) | Inhalt | Config |
|---|---|---|
| `test:hko:rules` | §3.5 | HKO-Test-Config aus P0 (`firebase.hko-test.json`, nur `firestore.hko.rules`) |
| `test:hko:upload` | §4, ohne Emulator | – |
| `test:e2e:hko` | Lernendenseite | `firebase.hko-e2e.json` (siehe unten), `auth,firestore` |
| `test:e2e:hko-dashboard` | LP-Ansicht | `firebase.hko-e2e.json`, `auth,firestore` |
| `test:hko` | heute (P0): nur Rules, `--config firebase.hko-test.json --project demo-hko --only firestore`. P1: wird zur Kette der vier Skripte oben | |
| `test:all` | **unverändert** (lms_box) | `firebase.json` |

Merge-Bedingung `hko → main`: `npm run test:all && npm run test:hko` grün. Alle Läufe über `scripts/emu.mjs` (es schreibt seit P0 `firestore` ohne `--config` zu `firestore:lmsbox` um; HKO-Läufe geben immer eine eigene `--config` mit: Rules-Tests `firebase.hko-test.json` mit Ports 9230/8320). Die e2e-Läufe brauchen `--project interactive-media-2a1fc` (die Seite nimmt die projectId aus `js/config.js`), die Rules-Tests bleiben bei `demo-hko`. Die Ports der HKO-Test-Config muss `js/firebase.js` kennen: die Seite verbindet fest auf 9190/8280. **Problem und Entscheid in AP3:** entweder e2e-HKO gegen die Ports von `firebase.json` mit einer zweiten Config `firebase.hko-e2e.json` (nur `hko`-Rules, lmsbox-Ports, darf dann nicht parallel zu lmsbox laufen) oder ein additiver Port-Override in `js/firebase.js` (`?emu=hko`) – Empfehlung: die zweite Config, kein Eingriff in geteilten Code.

### 6.1 Fixture (fiktiv, im öffentlichen Repo)

Solange `hko-content/build/` nicht existiert (Stand 15.10.2026: `schema/` leer, `build/` fehlt), arbeitet die Box gegen eine eigene Fixture. P0 hat schon `test/fixtures/unit-lj1-konsum-budget.json` (eine Einheit, ein `text`-Block, `ki_regel` als String `"Test"`) für die Lesetests angelegt; sie bleibt, wie sie ist. Für P1 kommt ein eigener Ordner im Build-Format dazu (`ki_regel` als `{stufe, text}`):

```
backend/test/fixtures/hko-build/units/lj1-test-box.json        alle P1-Typen, erfundene Texte
backend/test/fixtures/hko-build/solutions/lj1-test-box.json    erfundene Erwartungshorizonte (nur, um Upload und Rules zu prüfen)
backend/test/fixtures/hko-build/units/lj1-test-andere.json     zweite Einheit, Ziel einer einheitsübergreifenden mitnahme
backend/test/fixtures/hko-build-kaputt/…                       je eine absichtlich falsche Datei pro Upload-Prüfung
```

`lj1-test-box` enthält: `varianten` 3J und 4J; Kriterien 2 × SuK, 2 × Ges; Blöcke `begriffe-a` (`items`, 3 Fragen), `begriffe-voll` (`items`, 12 Fragen), `raster-quelle` (`raster`, 4 × 3 mit Beispielzeile), `raster-voll` (8 × 6), `raster-3j` (`nur_variante: 3J`), `raster-4j` (`nur_variante: 4J`), `entscheid` (`text`, `min_woerter` 80), `selbst-entscheid` (`selbst`, `bezug_block: entscheid`), `rueckblick` (`mitnahme` auf `entscheid.text`, `raster-quelle.befund` und `lj1-test-andere/notiz`), `kn-fall` (`text`, `kn: true`, nur für Rules-Tests), `spaeter` (`upload`, Platzhalter). Keine Lehrmittel-Texte, keine echten Namen, kein Eszett.

`scripts/seed-hko.mjs` (P0) bleibt für `classes` und Konten zuständig; die e2e-Tests laden die Fixture zusätzlich über `hko-upload.mjs --emulator --build test/fixtures/hko-build`. Ergänzung im Seed: eine Person ohne `classes`-Eintrag und eine mit zwei `classIds` verschiedener Varianten.

### 6.2 e2e Lernendenseite (`test/e2e-hko-student.mjs`)

Muster `e2e-student.mjs`: eigener statischer Server (Positivliste erweitert um `hko.html`, `css/hko.css`, `js/hko/**`), Host-Seite auf `localhost`, iframes auf `127.0.0.1` (cross-site), Chrome **mit** `ThirdPartyStoragePartitioning`, jede Anfrage ausser Emulator und den zwei CDNs bricht den Lauf ab.

- (a) Host mit 4 HKO-iframes verschiedener Blöcke: ein Login für alle; derselbe Link als eigener Tab zeigt den Login (Beweis, dass Partitionierung aktiv ist).
- (b) `text` tippen, Reload mit geleerter IndexedDB → Text kommt vom Server; Dokument hat genau die Felder aus §2.5.
- (c) Schreiben blockiert → Status «nicht gespeichert», Reload zeigt den lokalen Text, nach Freigabe landet er auf dem Server.
- (d) Ein spät geladenes Geschwister-iframe mit älterem Stand verändert nicht, was das tippende iframe speichert (`isInitializing`, Revisionslogik).
- (e) 3J-Person: `raster-3j` speicherbar, `raster-4j` zeigt den Hinweis und erzeugt **kein** Dokument; 4J-Person umgekehrt.
- (f) Klasse nicht erfasst → Hinweis, Eingaben gesperrt, kein Dokument; 2J-Person → «nicht vorgesehen»; zwei Varianten → erste gilt.
- (g) `mitnahme`: in iframe 1 `entscheid` tippen → iframe 2 (`rueckblick`) zeigt den Text ohne Reload (BroadcastChannel); ein iframe, das erst danach geladen wird, liest den Stand vom Server; einheitsübergreifende Quelle; eine zweite Person im anderen Tab sieht nichts davon.
- (h) Grenzen: Text über 20 000 Zeichen → Status «zu lang», Server unverändert; 12 Items und volles Raster speichern.
- (i) Logout in einem HKO-iframe schreibt den wartenden Debounce zuerst (Hook §2.10), leert den Cache; gemischte Seite mit **einem lms_box-iframe und einem HKO-iframe**: Logout im lms_box-iframe fragt bei ungespeichertem HKO-Text nach. (Unter dem einen HKO-Ruleset des Emulators kann das lms_box-iframe seinen Auftrag nicht laden und zeigt einen Fehler; Anmeldung, Name und Abmelden-Link erscheinen trotzdem, und nur um den Logout geht es hier.)
- (j) Zweite Person im selben Browser sieht nichts von der ersten (Cache geleert, keine Marke übrig).
- (k) Paste-Hinweis: Einfügen in Quill und in eine Rasterzelle erzeugt je ein `hko/pasteEvents`-Dokument; normales Tippen nichts.
- (l) KI-Regel sichtbar über jedem Block; Platzhalter für `upload`; unbekannte `unit` in der URL mit `<img onerror>` erscheint als Text.
- (m) Höhenprotokoll: die Host-Seite empfängt `{type:'lmsbox-height'}` mit wachsender Höhe beim Tippen.
- (n) Druck: Popup mit allen Blöcken der eigenen Variante, Name sichtbar, Antworten escaped.
- (o) **Last:** Host mit 10 HKO-iframes gegen den Emulator (HTTP/1.1, schlechtester Fall für das Verbindungslimit): alle zeigen ihren Block in < 10 s, jedes speichert.
- (p) Rückwärts: `e2e-student.mjs` läuft unverändert grün (Teil von `test:all`).

### 6.3 e2e LP-Ansicht (`test/e2e-hko-dashboard.mjs`)

- Nicht-LP-Konto → «kein Zugang», abgemeldet.
- LP wählt `test-3j-a` × `lj1-test-box` → Raster zeigt die Antworten aus dem Seed, Spalte `raster-4j` fehlt, `mitnahme` fehlt.
- Neue Antwort einer Person erscheint live (Listener).
- Antwort mit `<script>`/`<img onerror>` im Text erscheint als Text; kein Skript läuft.
- Antwort eines Kontos, das nicht in der Klassenliste steht (aber `classId` der Klasse im Dokument trägt), erscheint nicht.
- Variante im Dokument ≠ berechnete → Markierung.
- Klasse ohne `classes` → «nicht erfasst».
- CSV: Trenner `;`, BOM, Anführungszeichen bei `;`/Umbruch, `'` vor `=`; Download-Ereignis abgefangen und Inhalt geprüft.

---

## 7. Abhängigkeit vom Build-Format der Inhalts-Session

**Stand 15.10.2026:** `hko-content/schema/` ist leer, `hko-content/build/` gibt es nicht, `units/` und `items/` enthalten nur `README.md`. Vorhanden: `katalog.json`, `nrlp/`. Die Box plant deshalb gegen die **Annahme** unten und die Fixture §6.1.

### 7.1 Was die Box aus `build/units/<id>.json` braucht

Einheit:
- `unitId` (= Dateiname), `version` (int), `titel`, `lehrjahr`
- `varianten`: Map `{ "3J": { kompetenzen[], modi[] }, "4J": {…} }` (Handoff §5.2) – die Box braucht nur die Schlüssel; Rest Anzeige/Druck
- `kriterien`: Map `{ key: { name, dimension: 'SuK'|'Ges', stufen: {"3","2","1","0"} } }` – für `selbst`
- `blocks`: **flache Map** `{ blockId: Block }`, Reihenfolge über ein Feld `reihenfolge` (int) oder eine Liste `block_reihenfolge[]` (Druck, LP-Spalten; Map-Reihenfolge ist in Firestore nicht garantiert)
- optional `situation_kurz` (P2)

Block, gemeinsam: `type`, `titel`, `auftrag`, `k`, `nur_variante` (`null|'3J'|'4J'`), `kriterien[]`, `indikatoren` (Map), `ki_regel: { stufe, text }`, `kn` (bool), `feedback` (P1 ignoriert).

Je Typ:
- `items`: **`fragen: [{ id, k, text }]` aufgelöst** (P1-E4), zusätzlich `items: [{slug, …}]` als Herkunft erlaubt
- `text`: `genre`, `konventionen[]`, `min_woerter`, `max_woerter`
- `raster`: `quelle_ref`, `spalten[]`, `zeilen` (int), `beispielzeile?` (string[] = eine Zeile), `befund` (bool); optional aufgelöst `quelle: { titel, herausgeber, verortung }` für die Anzeige
- `selbst`: `kriterien[]`, `bezug_block?`
- `mitnahme`: `quellen: [{ unitId, blockId, feld?, label }]`

`build/solutions/<id>.json`: wird von der Box in P1 nicht gelesen, nur hochgeladen (nur LP lesbar). Erwartet: `{ unitId, blocks: { blockId: { erwartungshorizont, mehrdeutigkeit, … } } }`.

### 7.2 Abweichungen und Absprache-Punkte (Handoff §5.2/§6.2 ↔ Schritt B)

| # | Punkt | Wer | Vorschlag |
|---|---|---|---|
| A1 | iframe-URL im Generator (`NAECHSTE-PHASE_PROMPT.md` §4.2) enthält `/app/` | Inhalt | **`https://allgemeinbildung.github.io/lms_box/hko.html?unit=…&block=…`** |
| A2 | Quelle liegt in `hko-content/` (eigenes lokales Repo, `build/` ignoriert), nicht in `app/hko-content/` (Handoff §4.4) | – | so lassen; `hko-upload.mjs` liest `../hko-content/build`, der Build ist reproduzierbar |
| A3 | `raster.value.zellen` als `string[][]` nicht speicherbar | Box | `[{c: [...]}]`; betrifft nur `answers`, nicht den Build |
| A4 | Schritt B führt Felder pro Variante flach (`sk_3J`, `modi_3J`, `kompetenzen_3J`, `methode_kn_3J` …), Handoff §5.2 verschachtelt (`varianten.3J`) | Inhalt | Build schreibt **§5.2-Form** (`varianten{}`); flache Felder dürfen zusätzlich bleiben |
| A5 | Phasenstruktur (`herausforderung`, `kompetenzaufbau.bausteine[].items-Block`, `rezeption[]`, `wissensanwendung` …) | Inhalt | für die Seite ja; im Build **zusätzlich** alle Blöcke flach unter `blocks` mit Id. Die Box liest nie Phasen |
| A6 | Items-Fragen inline vs. Collection `items` | Inhalt | inline im Block (P1-E4); `items/<slug>` wird trotzdem gebaut und hochgeladen (für P3) |
| A7 | Varianten-Indikatoren (Entscheid 5) – Form offen | Inhalt | `indikatoren: { kritId: "…" }` oder `indikatoren: { kritId: { "3J": "…", "4J": "…" } }`; die Box kann beides, Absprache auf eine Form |
| A8 | `ki_regel.stufe` – Werte offen | Inhalt | feste Liste, z. B. `verboten | eingeschraenkt | erlaubt` |
| A9 | `mitnahme.feld` – Bedeutung offen | gemeinsam | Pfadliste §2.7 |
| A10 | Blockreihenfolge | Inhalt | `reihenfolge` je Block oder `block_reihenfolge[]` |
| A11 | `updatedAt` in `units` | – | setzt das Upload-Skript, nicht der Build |
| A12 | Varianten-Blöcke auf der Seite | Inhalt | in **eingeklappte** Callouts (`> [!info]- Nur 4-jährige Lehre`), dann lädt Publish das iframe erst beim Aufklappen (weniger iframes, §9 R4) |
| A13 | Kalibrierung (`loesungen.kalibrierung[6]`) | – | gehört nach `solutions`, nie nach `units`; prüft `hko-upload` (§4 Nr. 2) |
| A14 | KN des Piloten (Mini Cases, 3J mit Video, 4J mit Fallbesprechung live) | Pietro | in P1 **ausserhalb der Box** (Papier/OLAT); ein Block `kn: true` erst ab P3 |

### 7.3 Wenn das Format abweicht

- Die Box liest **nur** `units.blocks` in der Form §7.1. Jede Anpassung an ein abweichendes Build-Format geschieht in einer Funktion `normalize()` in `scripts/lib/hko-validate.mjs` (Upload), nie im Browser-Code.
- Das Upload-Skript bricht bei fehlenden Pflichtfeldern ab und nennt Pfad und erwartete Form; es schreibt nichts Halbes.
- Änderungen am Schema sind nur additiv (Handoff §1 Prinzip 2). Eine Umbenennung meldet die Inhalts-Session Pietro; die Box zieht `normalize()` nach.
- Ab dem Tag, an dem `build/` existiert: ein Test in `test:hko:upload` läuft zusätzlich gegen den echten Build (`--build ../../hko-content/build`, Dry-Run), sofern vorhanden.

---

## 8. Arbeitspakete und Meilensteine

Aufwand in Agent-Arbeitstagen (AT), ohne Wartezeit auf Pietro. Kalender mit Herbst-/Winterferien; Puffer ausdrücklich.

| AP | Inhalt | Agent | AT | hängt ab von | Ziel-KW |
|---|---|---|---|---|---|
| AP0 | Vertrag: `HKO.md` um P1 erweitern (Ids, Felder, Client-Regeln, DOM-Vertrag), CONTRACT.md-Satz | Opus (Entwurf), Pietro (Review) | 0.5 | P0 | 43 |
| AP1 | Geteilte Module additiv (`firebase.js` `hkoDb()`, `auth.js` `registerSaver`) mit `test:all` vorher/nachher | Opus | 1 | AP0 | 43–44 |
| AP2 | Rules + Spike Ausdrucks-Budget + `hko-rules.test.mjs` | Opus | 2 | AP0 | 44 |
| AP3 | Fixture §6.1 + Seed-Ergänzungen + `firebase.hko-e2e.json` (§6) | Sonnet | 0.5 | AP0 | 44 |
| AP4 | `hko.html`, `main.js`, `api.js`, `registry.js`, `save.js`, `variante.js`, `channel.js`, `kiRegel.js`, Platzhalter-Block, `text`-Block als Referenz | Opus | 3 | AP1, AP3 | 45–46 |
| AP5 | `hko-upload.mjs` + `lib/hko-validate.mjs` + Unit-Tests | Opus | 1.5 | AP3 | 45 |
| AP6 | Blöcke `items`, `raster` (inkl. Handy-Ansicht: Zeilen als Karten), `selbst`, `mitnahme`, `plainGuard.js`, `print.js` nach dem Muster aus AP4 | Sonnet (Opus-Review von `mitnahme` und `print.js`) | 3 | AP4 | 47–48 |
| AP7 | `e2e-hko-student.mjs` (§6.2) | Opus schreibt die Partitionierungs-, Logout- und Lastfälle; Sonnet die übrigen und führt aus | 2.5 | AP6 | 48–49 |
| AP8 | LP-Ansicht + `e2e-hko-dashboard.mjs` | Sonnet (Opus-Review Sanitizing/CSV) | 3 | AP4 | 49–50 |
| AP9 | Doku (`HKO.md` nachführen, Kurzanleitung LP-Ansicht), Commit-Bereinigung | Sonnet | 0.5 | AP8 | 51 |
| – | **Puffer Winterferien** | | | | 52–1 |
| AP10 | Integration mit echtem Build `lj1-konsum-budget` (sobald Schritt C freigegeben), Abweichungen in `normalize()`, Emulator-Durchlauf mit echter Seite aus dem Vault (lokal, `?unit=lj1-konsum-budget`) | Opus | 1.5 | Schritt C | 2–3 |
| AP11 | Live-Test mit Testkonten (siehe unten) | Pietro + Sonnet (Checkliste) | 1 | AP10 | 4 |
| AP12 | Pilot-Freischaltung 4PR26b (3J) und 4PM26d (4J), nicht verlinkte Seite | Pietro | – | AP11 | 5 |
| – | **Puffer** bis Ende Februar 2027 | | | | 6–9 |

Summe ≈ 20 AT Agentenarbeit.

**Meilensteine**

- **M1 (Ende KW 44, 6.11.2026):** Vertrag, geteilte Module, Rules grün; `test:all` unverändert grün.
- **M2 (Ende KW 48, 4.12.2026):** alle P1-Blöcke laufen gegen die Fixture im Emulator; Upload-Skript fertig.
- **M3 (Ende KW 51, 18.12.2026):** e2e Lernendenseite und LP-Ansicht grün; Branch `hko` merge-bereit (ohne Merge).
- **M4 (Ende KW 3, 22.1.2027):** echter Build der Pilot-Einheit hochgeladen in den Emulator, Seite lokal durchgespielt. **Abhängig von Schritt C** – das ist der kritische Pfad, nicht der Code.
- **M5 (Ende KW 5, 5.2.2027):** Live in je einer 3J- und 4J-Klasse auf einer nicht verlinkten Seite. Puffer bis 26.2.2027.

**Deploy-Schritte durch Pietro** (Agenten geben die Befehle, führen sie nicht aus):

1. Nach M3: `firebase deploy --only firestore:hko --project interactive-media-2a1fc` (Rules + Indexe; DB `hko` hat P0 angelegt). Index `answers (uid, unitId)` und `pasteEvents (uid, unitId)` in `firestore.hko.indexes.json` – lms_box brauchte für `drafts (uid, assignmentId)` auch einen; der Emulator prüft Indexe nicht.
2. `classes` für 4PR26b → 3J, 4PM26d → 4J und eine Testklasse live anlegen (P0-Skript oder Konsole).
3. `node scripts/hko-upload.mjs` (Dry-Run prüfen), dann `node scripts/hko-upload.mjs --live --key D:\OS\CoSch-sandbox\.secrets\firebase-admin.json --yes`.
4. Merge `hko → main` und Push = Frontend-Deploy. `hko.html` ist danach öffentlich erreichbar, aber nirgends verlinkt.
5. Live-Test (AP11) mit zwei Testkonten im Lernportal, je eines in einer 3J- und einer 4J-Testklasse: Login über mehrere iframes, Speichern, Variante, `mitnahme`, Druck, Höhe auf Publish, LP-Ansicht, CSV. Chrome auf Schul-PC, Safari auf iPhone, Firefox, Android-Chrome.
6. Generierte Seite `vault/HKO/LJ1/HKO lj1-konsum-budget – …md` von Hand publizieren; `HKO/` bleibt in der Sidebar **ausgeblendet**, bis der Pilot läuft.

---

## 9. Risiken und offene Fragen

| # | Risiko / Frage | Einschätzung | Massnahme |
|---|---|---|---|
| R1 | **Safari und Firefox ungetestet** (gilt schon für lms_box). ITP, Partitionierung, BroadcastChannel und Web Locks verhalten sich anders | hoch | AP11 auf echten Geräten; Fallback ohne Web Locks existiert in `auth.js` (Wartezeit 1.5 s) |
| R2 | **Selbstregistrierung und anonyme Anmeldung** im Projekt aktiv. Wer sich mit einer `@lernende.bbw.ch`-Adresse registriert, besteht `isSchoolAccount()` | mittel | Schreiben kann so jemand nur eigene `answers`; Lösungen sind LP-only; die LP-Ansicht fragt nur Roster-uids ab. Schliessen nur in der Firebase-Konsole (betrifft das Lernportal) – Pietros Entscheid, unverändert offen |
| R3 | **Variante aus dem Roster** fälschbar im Dokument; `classId` im Roster nur von der LP schreibbar | niedrig (formativ) | P1-E3; serverseitig erst mit KN (P3) per Callable |
| R4 | **Viele iframes pro Seite.** Pilot nach Schema: 2–4 `items` (Bausteine) + 1–2 `raster` (Rezeption, je Variante) + 1 `text` + 1 `selbst` + 1 `mitnahme` ≈ **6–9 HKO-iframes**, mit Varianten-Duplikaten bis ~11; dazu Mindmap, 2 Podcasts, 1–2 SRF/nanoo ≈ 15 iframes | mittel | Firestore Lite hält **keine** Dauerverbindungen; live spricht der Browser HTTP/2 mit `firestore.googleapis.com` (gebündelt), das Sechser-Limit trifft vor allem den Emulator (HTTP/1.1) – deshalb Lasttest (o) dort als schlechtester Fall. Lazy Rendering der Callouts verteilt die Last; Varianten-Blöcke in eingeklappte Callouts (A12). Grenze offen ist eher **Speicher/Parse-Zeit auf Handys** (jedes iframe lädt SDK + Quill). Messen in AP11; Rückfallebene: `?block=a,b` (mehrere Blöcke pro iframe), die Registry ist so angelegt, dass das später ohne Schemaänderung geht |
| R5 | Ausdrucks-Budget der Rules (Raster 48 Zellen, 12 Items) | mittel | Spike zuerst (§3.2), Rückfallgrenzen |
| R6 | **Composite-Index** für `uid in […] + unitId ==` und `uid == + unitId ==` | mittel | Index-Datei in AP2; im Emulator nicht prüfbar → AP11 |
| R7 | Änderung an `auth.js` könnte lms_box-Logout stören | niedrig | additiv, ohne Anmeldung identisch; `test:all` vorher/nachher, Schritte (k), (m) von `e2e-student` |
| R8 | Push auf `main` deployt beide Apps | mittel | HKO nur in eigenen Pfaden; Merge erst nach `test:all && test:hko`; Pietro mergt |
| R9 | **Storage-Rules gelten pro Bucket für das ganze Projekt** (Bucket liegt in europe-west6, Befund C1). Ein `storage:hko`-Deploy überschreibt die Bucket-Rules des Lernportals | hoch, aber erst P2 | vor P2 klären: bestehende Storage-Rules des Lernportals einlesen und zusammenführen, oder zweiten Bucket nur für `hko/` |
| R10 | Build-Format kommt spät oder anders (Schritt C erst nach Pietros Freigabe) | mittel | Fixture, `normalize()` im Upload, Absprache-Liste §7.2 früh an die Inhalts-Session |
| R11 | Quill 1.3.6 ist alt und vom CDN abhängig (lms_box ebenso) | niedrig | gleiche Abhängigkeit wie heute; bei CDN-Ausfall fallen beide Systeme gleich aus |
| R12 | Gemischte Anrede (Login duzt, Blöcke siezen) | niedrig | P1-E6 |
| R13 | `units`-Dokument wird von jedem iframe einzeln gelesen (bis ~100 KB × 9) | niedrig | in P1 akzeptiert; später Cache nach `version` in IndexedDB |
| R14 | Podcast-Episoden brauchen `caps` (mind. `[]`) und `chapters` mit ≥ 1 `shot` (Befund C3) | – | betrifft die Inhalts-Session, nicht die Box; hier nur vermerkt |
| R15 | Personen mit mehreren `classIds` verschiedener Varianten | niedrig | erste Klasse gilt, LP-Ansicht markiert |

**Offene Fragen an Pietro**

1. P1-E1 bis P1-E6 (§0).
2. Gilt für den Pilot eine Testklasse zusätzlich zu 4PR26b/4PM26d (für AP11), und wer legt die zwei Testkonten im Lernportal an?
3. Soll die LP-Ansicht in P1 schon einen Link «Seite als Lernende/r ansehen» mit Testkonto-Hinweis bekommen, oder reicht die Vorschau über das Testkonto?
4. Ist der Februar-Termin (M5) auch dann gewünscht, wenn Schritt C erst im Januar freigegeben wird? Sonst rückt M4/M5 entsprechend.
