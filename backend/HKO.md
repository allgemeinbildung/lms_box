# HKO-Parallelsystem — Backend (Phase P0)

Neben dem Altsystem `lmsbox` (Vertrag: `CONTRACT.md`) entsteht im selben Firebase-Projekt
`interactive-media-2a1fc` das HKO-Parallelsystem: eigene benannte Datenbank **`hko`**
(`europe-west6`), eigene Rules, später eigene Functions-Codebase `hko`.
Grundlage: `hko-content/_input/HKO_PARALLELSYSTEM_HANDOFF_v1.md` (§5, §11, §12, §13 C2) und
`ANTWORTEN_HKO_PARALLELSYSTEM_v1.md` (D1, D2). Öffentliche URL der Box später:
`https://allgemeinbildung.github.io/lms_box/hko.html` (`app/` ist der Repo-Stamm).

Stand 15.10.2026: Die Datenbank `hko` existiert noch nicht. Der Standard-Bucket
`interactive-media-2a1fc.firebasestorage.app` liegt in `EUROPE-WEST6`, Blaze ist aktiv (C1).

## Dateien

| Datei | Zweck |
|---|---|
| `firestore.hko.rules` | Rules nur für die DB `hko` |
| `firestore.hko.indexes.json` | Indexe der DB `hko` (noch leer) |
| `firebase.json` | zweiter `firestore`-Eintrag `database: "hko"`; `lmsbox` bleibt an erster Stelle und unverändert |
| `firebase.hko-test.json` | Emulator-Konfiguration nur mit `hko`, eigene Ports |
| `test/hko-rules.test.mjs` | Rules-Tests, `npm run test:hko` |
| `test/fixtures/unit-lj1-konsum-budget.json` | fiktive Einheit für die Lesetests |
| `scripts/seed-hko.mjs` | fiktive Testdaten (`classes`, Roster, Konten) für die Emulatoren |

## Rules-Isolation und Tests

### Wie die Firebase CLI `--only firestore:<db>` auflöst

Geprüft im Quelltext von firebase-tools 15.10.0 (`lib/firestore/fsConfig.js`,
`lib/deploy/firestore/prepare.js`, `release.js`), nichts deployt:

- Ist `firestore` in `firebase.json` ein **Array**, wählt `--only firestore:<x>` genau die
  Einträge, deren `database` (oder `target`) `<x>` heisst. Nur für diese werden Rules
  kompiliert und pro Datenbank freigegeben (`rulesDeploy.release(…, databaseId)`), ebenso
  die Indexe. Ein unbekanntes `<x>` bricht mit «Could not find configurations» ab.
- `--only firestore:hko` fasst also `lmsbox` nicht an, und `--only firestore:lmsbox` nicht `hko`.
- **`--only firestore` (ohne Ziel) und ein nackter `firebase deploy` deployen alle Einträge**,
  also `lmsbox` **und** `hko` zusammen. Die `(default)`-DB des Lernportals erreichen sie nicht,
  weil sie in `firebase.json` nicht vorkommt — sie wird nie eingetragen.
- `--only firestore:rules` bzw. `firestore:indexes` wählt bei einem Array **keine** Datenbank
  aus und deployt nichts. Nicht verwenden.
- Stolperstelle: Der Deploy legt eine fehlende Datenbank selbst an, prüft dafür aber immer nur
  den **ersten** Array-Eintrag (`lmsbox`). Ein `--only firestore:hko`, bevor `hko` existiert,
  legt `hko` also nicht an, sondern scheitert. Deshalb wird `hko` vorher von Hand angelegt
  (unten), mit Löschschutz — den setzt der automatische Weg ohnehin nicht.

Regel daher, wie bei `lmsbox`: **immer mit Ziel deployen, nie nackt, nie `--only firestore`.**
Ein Deploy der hko-Rules kann `lmsbox` nur überschreiben, wenn jemand dieses Ziel weglässt.

### Wie man hko-Rules testet

Der Firestore-Emulator kennt **ein** Ruleset für alle Datenbanken. Er nimmt es aus
`firebase.json`, aber nur, wenn genau **ein** Firestore-Eintrag ausgewählt ist
(`lib/emulator/controller.js`). Bei zwei Einträgen meldet er «does not support multiple
databases yet» und **erlaubt dann alles** — ohne Fehler.

Folgen und Lösung:

1. **`firebase.hko-test.json`** enthält nur den `hko`-Eintrag, lädt also `firestore.hko.rules`,
   und hat eigene Ports (Auth 9230, Firestore 8320/ws 9191, UI 4140, Hub 4450, Logging 4550).
   So kollidiert `test:hko` nie mit einem lmsbox-Lauf (9190/8280/… und 9210/8300/…).
   `test/hko-rules.test.mjs` bricht ab, wenn es nicht am Port 8320 läuft.
2. **lmsbox-Läufe bleiben bei den lmsbox-Rules:** Seit `firebase.json` zwei Datenbanken nennt,
   würde jedes `--only …,firestore` beide wählen und die Rules abschalten (geprüft: `rules.test.mjs`
   mit beiden Datenbanken 24 von 31 Tests rot). `scripts/emu.mjs` ersetzt deshalb — nur ohne
   `--config` — `firestore` in `--only` durch `firestore:lmsbox`; fehlt `--only`, setzt es die
   in `firebase.json` eingetragenen Emulatoren mit `firestore:lmsbox`. Die lmsbox-Skripte und
   -Tests sind unverändert und laufen genau gegen die Rules, die sie immer hatten. Läufe mit
   `--config` (fn-test, hko-test) gehen unverändert durch.
   Ein nacktes `firebase emulators:*` aus diesem Ordner hätte jetzt also **keine** Rules —
   ein Grund mehr, nur `scripts/emu.mjs` zu benutzen.
3. **Lesender `students`-Eintrag (nur Emulator), entschieden: ja.** hko-Code liest
   `students/{uid}` aus `(default)`. Im Emulator gilt dafür dasselbe hko-Ruleset; ohne Eintrag
   könnte keine hko-Seite und kein e2e-Test gegen `firebase.hko-test.json` den Roster lesen.
   Er ist wie in lmsbox nur lesend (eigenes Dokument oder LP) und getestet. In Produktion gibt
   es in `hko` keine Collection `students`; der echte Roster ist durch die Lernportal-Rules auf
   `(default)` geschützt. Die hko-Rules selbst können den Roster nicht lesen (andere DB) —
   deshalb führt `classes/{classId}` in `hko` die Variante (C5).
4. Kein Emulator-Test beweist etwas über die Rules von `(default)`, und keiner etwas über das
   Zusammenspiel von `lmsbox` und `hko` in Produktion — nur, dass jede Datei für sich das Richtige tut.

`test:all` bleibt das lmsbox-Gate und enthält `test:hko` **nicht**: so beweist ein grünes
`test:all` weiterhin genau, dass das Altsystem unverändert funktioniert, und ein hko-Fehler blockiert
keine Arbeit am Altsystem. Vor jedem Merge von `hko` nach `main` laufen beide.

### Inhalt der Rules in P0

| Collection | Lesen | Schreiben |
|---|---|---|
| `units/{unitId}`, `items/{slug}` | Schulkonto (`isSchoolAccount()`: Passwort-Anmeldung, `@lernende.bbw.ch`), LP (`role == 'teacher'`) | niemand (nur Admin-Skript) |
| `classes/{classId}` | Schulkonto, LP | niemand |
| `solutions`, `itemSolutions` | **niemand** | niemand |
| `answers`, `feedback`, `feedbackLP`, `feedbackReleased`, `peerAssignments`, `usage`, `pasteEvents`, `knGrades`, alles Übrige | niemand | niemand |
| `students/{uid}` (nur Emulator) | eigenes Dokument, LP | niemand |

Entscheide:

- **`solutions`/`itemSolutions` auch für LP zu.** Der Handoff erlaubt «LP und Functions». In P0
  braucht kein Client sie, Functions lesen mit dem Admin SDK an den Rules vorbei. Die
  Lehrer-Claim haben auch die Lehrpersonen des Lernportals; geöffnet wird erst mit der
  LP-Ansicht (P1), zusammen mit einem Test. Das ist eine Zeile, additiv.
- **`classes` lesbar.** Die Dokumente enthalten nur `variante, lehrjahr, aktiv`, keine
  Personendaten; die Box braucht sie in P1 als Erstes, und `seed-hko.mjs` schreibt sie schon.
  Schreiben für LP kommt erst mit der LP-Ansicht.

Die Tests (`npm run test:hko`) zeigen: unangemeldet, anonym, fremde Domain und Nicht-Passwort-Anbieter
lesen `units`/`items`/`classes` nicht (get und list); Schulkonto und LP lesen sie; niemand — auch LP
und Schulkonto nicht — schreibt irgendwo (create, set, update, delete in allen Collections aus §5.1);
Schulkonto und alle anderen lesen `solutions`/`itemSolutions` nicht (get und list); eine unbekannte
Collection ist zu.

Testdaten für die hko-Emulatoren:

```bash
npm run emu -- emulators:exec --config firebase.hko-test.json --project interactive-media-2a1fc --only auth,firestore "node scripts/seed-hko.mjs"
```

## Deploy-Ziele

Nichts davon ist ausgeführt. Befehle für Pietro, aus `app-hko/backend/`, immer mit Ziel:

```bash
# 1. Datenbank anlegen (einmalig), mit Löschschutz
gcloud firestore databases create --database=hko --location=europe-west6 --type=firestore-native --delete-protection --project=interactive-media-2a1fc
#    gleichwertig:
firebase firestore:databases:create hko --location europe-west6 --delete-protection ENABLED --project interactive-media-2a1fc

# 2. Rules und (leere) Indexe nur für hko
firebase deploy --only firestore:hko --project interactive-media-2a1fc

# Kontrolle danach (Ort, Löschschutz)
firebase firestore:databases:get hko --project interactive-media-2a1fc
```

Bestehende Befehle bleiben gültig: `--only firestore:lmsbox`, `--only functions:lmsbox`.

### Functions-Codebase `hko`: erst in P1

Geprüft: Die CLI akzeptiert eine leere Codebase (Ordner mit `package.json`, Node 22, und einer
`index.js` ohne Exporte) — der Emulator meldet «Loaded functions definitions», ein Deploy
hätte keine Endpunkte, lädt nichts hoch und löscht nichts (geprüft im Emulator und im Quelltext
`deploy/functions/prepare.js`). Trotzdem kommt der Eintrag erst in P1:

- Der Functions-Emulator lädt **alle** Codebases aus `firebase.json`, ein Filter
  `functions:<codebase>` wirkt dort nicht. Ein Eintrag `hko` liefe also in jedem lmsbox-Lauf mit
  (`test:e2e:dashboard`, `npm run emulators`) und verlängert den Start, dessen Timeout schon heute
  stört. Ohne installiertes `firebase-functions` im neuen Ordner meldet er zudem «Failed to load
  function definition» — derselbe Text wie der bekannte Timeout-Fehler, also irreführend.
- Ein leerer Deploy-Ziel-Eintrag schützt nichts, was `--only functions:lmsbox` nicht schon schützt.

In P1 dann: Ordner `functions-hko/` (Node 22, `firebase-functions` wie in `functions/`), Eintrag
`{ "source": "functions-hko", "codebase": "hko", "runtime": "nodejs22", "ignore": [...] }` als
**zweiter** Eintrag in `functions`, Region `europe-west6`, Namen `hko*`. Deploy nur
`firebase deploy --only functions:hko --project interactive-media-2a1fc`. Ein Deploy einer
Codebase berührt keine Functions anderer Codebases (auch nicht die des Lernportals); neue
Callables brauchen `allUsers` als Invoker (siehe `CLAUDE.md`). Dann prüfen, ob lmsbox-Läufe mit
Functions eine Config ohne `hko`-Codebase brauchen (wie `firebase.fn-test.json`).

### Storage `hko`: noch nicht eingetragen (C1)

Später als Array mit Bucket und eigener Rules-Datei, Ablage nur unter dem Präfix `hko/`:

```json
"storage": [
  { "target": "hko", "rules": "storage.hko.rules" }
]
```

dazu einmalig `firebase target:apply storage hko interactive-media-2a1fc.firebasestorage.app`
(schreibt `.firebaserc`), Deploy `firebase deploy --only storage:hko --project interactive-media-2a1fc`.
Rules: schreiben nur `hko/uploads/{uid}/…` für `isSchoolAccount()` mit eigener uid, Grösse
z. B. ≤ 10 MB, `image/*` und `application/pdf`; LP liest (Antwort D4).

> **Warnung:** Storage-Rules gelten **pro Bucket**, nicht pro Präfix. Ein Deploy von
> `storage.hko.rules` auf den Standard-Bucket **ersetzt die Rules des ganzen Buckets**, den sich
> HKO mit dem Lernportal teilt — nicht nur die für `hko/**`. Die heutigen Rules dieses Buckets
> sind nicht bekannt. Vor dem ersten Storage-Deploy: aktuelle Rules aus der Konsole sichern und
> in `storage.hko.rules` übernehmen, oder einen **eigenen Bucket** in `europe-west6` nur für HKO
> anlegen (sauberer, entscheidet Pietro).

---

# Phase P1 — Vertrag (verbindlich ab 16.10.2026)

Grundlage: `HKO-P1-PLAN.md` mit den Entscheiden P1-E1 bis P1-E6 (alle Empfehlungen
übernommen) und dem Rahmen aus `hko-content/_plan/BOX-P1_PROMPT.md` §1a. Wer am Code etwas
braucht, das dieser Abschnitt nicht erlaubt, ändert zuerst diesen Abschnitt. Wo er vom Plan
abweicht, gilt er; die Abweichungen stehen in §9.

## 1. Eine Stelle pro Projektwert (Regel für den Umzug)

Die hko-box ist ein persönlicher Prototyp für den hep-Verlag und zieht später in ein eigenes
Firebase-Projekt um. Deshalb steht jeder projektgebundene Wert an **genau einer** Stelle pro Laufzeit:

| Wert | Browser | Backend (Node) | Rules |
|---|---|---|---|
| Projekt-ID, Web-Konfiguration | `js/config.js` (unverändert, geteilt mit lms_box) | `scripts/lib/hko-target.mjs` `PROJECT_ID` | – |
| Datenbankname `hko` | `js/hko/config.js` `HKO.database` | `scripts/lib/hko-target.mjs` `DATABASE_ID` | – (Deploy-Ziel in `firebase.json`) |
| Basis-URL `https://allgemeinbildung.github.io/lms_box/` | `js/hko/config.js` `HKO.baseUrl` | `scripts/lib/hko-target.mjs` `BASE_URL` | – |
| Domain der Schulkonten `lernende.bbw.ch` | `js/hko/config.js` `HKO.schoolDomain` | `scripts/lib/hko-target.mjs` `SCHOOL_DOMAIN` (Seed, Tests) | `isSchoolAccount()` in `firestore.hko.rules`, sonst nirgends |

Texte für Lernende tragen **kein BBW-Branding** (kein «BBW», kein Schullogo). Der geteilte
Login-Dialog in `js/auth.js` bleibt, wie er ist (P1-E6). Der Abschnitt «Umzug in ein eigenes
Projekt» weiter unten listet, was beim Umzug zu ändern ist.

## 2. Ids und URL

- Lernende: `<baseUrl>hko.html?unit=<unitId>&block=<blockId>`; LP: `<baseUrl>dashboard/hko.html`.
- `unitId`, `blockId`: `^[a-z0-9-]{1,80}$`; `frageId`, `kritId`: `^[a-z0-9-]{1,100}$`.
- `answers/{uid}__{unitId}__{blockId}`; `pasteEvents/{uid}__{unitId}__{blockId}__{eventId}`,
  `eventId` `^[A-Za-z0-9]{8,40}$`.

## 3. Collections der DB `hko`

| Pfad | Inhalt | Lernende (Schulkonto) | LP (`role == 'teacher'`) |
|---|---|---|---|
| `units/{unitId}` | `build/units/<id>.json` 1:1 + `updatedAt` | lesen | lesen |
| `items/{slug}` | `build/items/<slug>.json` + `updatedAt` | lesen | lesen |
| `solutions/{unitId}`, `itemSolutions/{slug}` | Lösungen | nichts | **nichts in P1** |
| `classes/{classId}` | `{variante: '3J'/'4J'/'2J', lehrjahr: int 1–4, aktiv: bool}` | lesen | lesen, schreiben (genau diese Keys) |
| `answers/{answerId}` | §4 | eigene lesen/anlegen/ändern, kein Delete | lesen |
| `pasteEvents/{eventId}` | §5 | nur anlegen | lesen |
| `students/{uid}` | nur Emulator, lesend | eigenes | alle |

Alles Übrige ist zu (`feedback`, `usage`, `knGrades` … ab P2). Schreiben von `units`, `items`,
`solutions`, `itemSolutions` nur über das Admin-SDK (`scripts/hko-upload.mjs`).

## 4. `answers`

Felder genau: `uid, classId, unitId, blockId, unitVersion, variante, type, value, status, kn, updatedAt`.

- `classId` = Roster-`classId` der Person (String ≤ 100), `unitVersion` = `unit.version` (int ≥ 1),
  `variante` ∈ `3J|4J|2J`, `status` in P1 immer `'entwurf'` (Rules erlauben auch `'abgegeben'`),
  `kn` = `block.kn`, `updatedAt` = `serverTimestamp()`.
- Geschrieben wird immer das ganze Dokument per `setDoc` (kein Merge, kein `updateDoc`).
- Rules prüfen per `get()` auf `units/{unitId}`, dass der Block existiert, `type` und `kn` passen,
  `blk.type ∈ {items, text, raster, selbst}` und `nur_variante` zur `variante` passt.
- Update: `uid, unitId, blockId, type, kn` unveränderlich; KN-Sperre: ist das gespeicherte
  Dokument `kn == true && status == 'abgegeben'`, ist jedes Update verboten. Kein Delete.

`value` je Typ (gespeichert wird **reiner Text**, nie HTML):

| `type` | `value` | Grenzen (Rules und `validate().zuGross`) |
|---|---|---|
| `text` | `{ text }` | Keys nur `text`, ≤ 20 000 Zeichen |
| `items` | `{ antworten: [{ frageId, text }] }` | ≤ 12 Einträge, Keys genau `frageId, text`, `frageId` ≤ 100, `text` ≤ 3 000 |
| `raster` | `{ zeilen: [{ c: [string] }], befund }` | ≤ 8 Zeilen, je ≤ 6 Zellen à ≤ 500; `befund` String ≤ 3 000 (auch leer) |
| `selbst` | `{ stufen: { <kritId>: int 0–3 }, begruendung, verbessere }` | `stufen`-Keys ⊆ `blk.kriterien`, ≤ 6; `begruendung`, `verbessere` je String ≤ 1 500 |

`mitnahme.quellen[].feld` ist ein Pfad in `value`: `text`, `befund`, `zeilen`, `antworten.<frageId>`,
`stufen`, `begruendung`, `verbessere`. Ohne `feld`: die ganze Antwort, typgerecht als Text.

Keine leeren Erstdokumente: ein Block, in dem die Person nichts eingegeben hat, schreibt nichts.

## 5. `pasteEvents`

Felder genau `uid, unitId, blockId, feld, kind, chars, excerpt, at`; `feld` String 1–100 (`text`, eine
`frageId`, `r<zeile>c<spalte>` mit 0-basiertem Index, `befund`, `begruendung`, `verbessere`);
`kind ∈ paste|drop|bulk|fast`; `chars` int 0–20 000; `excerpt` ≤ 300; `at = serverTimestamp()`.
Nur `create`, nur Schulkonto mit eigener uid in Id und Daten. Kein `get()` auf `units`.

## 6. Was die Box aus `units/{unitId}` liest (Build-Format, `hko-content/schema/README.md`)

Einheit: `unitId, version, titel, varianten{3J,4J,…}, kriterien{}, quellen{}, lernaufgaben{}, blocks{}, reihenfolge[]`.
Block, gemeinsam: `type, titel, auftrag, k, nur_variante, kn, kriterien[], indikatoren{}, ki_regel{stufe, text}`.
`phase`, `lernaufgabe`, `feedback` sind nur Information; die Box stützt sich nicht darauf (`feedback` in P1 ignoriert).

| Typ | Box P1 |
|---|---|
| `items` | `fragen[{id, k, text}]` (aufgelöst), je Frage ein Quill-Feld |
| `text` | Quill-Feld; `genre`, `konventionen[]`, `min_woerter`, `max_woerter` als Hinweis (blockiert nichts), Wortzähler |
| `raster` | `spalten[]` (letzte «→ Begriff»), `zeilen` (int), `beispielzeilen[{c}]?` (grau, nicht editierbar), `befund` (bool) → Textfeld Befund. Bezug: `quelle_ref` → `unit.quellen[ref]` **oder** `lehrmittel_seiten[{kapitel, abschnitt?, seiten[]}]`. Handy (< 600 px): Zeilen als Karten |
| `selbst` | je Kriterium aus `blk.kriterien` die Stufen `3…0` aus `unit.kriterien[k].stufen` (Radio), dazu `indikatoren[k]` falls vorhanden; Texte «Begründung» und «Das verbessere ich»; `bezug_block` als Hinweis «Bezieht sich auf: <titel>» |
| `mitnahme` | `quellen[{unitId, blockId, feld?, label}]` → eigene Antworten, nur Text |
| `upload`, `link`, `roleplay`, `peer`, `audio`, unbekannt | neutraler Platzhalter «Dieser Auftragstyp ist in der Box noch nicht verfügbar.» |
| **jeder Block mit `kn: true`** | **Hinweis statt Eingabe** (KN findet in P1 ausserhalb der Box statt, Plan A14): «Dieser Teil ist der Kompetenznachweis. Er findet nicht hier statt; Ihre Lehrperson gibt Ihnen die Unterlagen.» Nichts speicherbar. Die Rules-Sperre für `kn: true` ist trotzdem vorbereitet und getestet |

**Quellen** (`unit.quellen[ref]`: `typ, titel, herausgeber, datum?, plattform, embed_url, url?, quellenverweis, lizenz, vault_bild`):
Die Box bettet **nichts** ein (das tut die Vault-Seite). Sie zeigt über dem Raster «Quelle: <titel> (<herausgeber>)»
und, wenn `quellenverweis` gesetzt ist, sichtbar «Quellenverweis: <quellenverweis>». Bei `plattform: 'srf'` ist der
Verweis Pflicht; fehlt er, zeigt die Box «Quellenverweis fehlt – bitte der Lehrperson melden» und warnt in der
Konsole. Bei `plattform: 'nanoo'` kein Verweis. `url` (sonst `embed_url`; bei gesetztem `vault_bild` mit Text
«Zu den Daten») höchstens als Link (`target=_blank`, `rel=noopener`), nur `https:`. Alles per `textContent`.
**Lehrmittel**: «Grundlage: Lehrmittel Kapitel 2.7 A, S. 73, 74; Kapitel 1.5 Bewusster Konsum, S. 37».

**KI-Regel**: Kasten über jedem Block mit Stufe (`verboten | eingeschraenkt | erlaubt | gegenstand`, angezeigt
als «KI nicht erlaubt», «KI eingeschränkt», «KI erlaubt», «KI ist Gegenstand») und `text`. Fehlt sie: «KI-Regel fehlt –
bitte der Lehrperson melden».

## 7. Client (Browser)

- **Konfiguration:** `js/hko/config.js` exportiert `HKO = { database, baseUrl, schoolDomain }` (§1).
- **DB-Zugriff:** `js/firebase.js` exportiert zusätzlich `namedDb(databaseId)` (Firestore **Lite**, beim ersten Aufruf
  erzeugt und pro Id gecacht, verbindet im Emulator-Modus mit demselben Port wie `db`). Nur `js/hko/api.js` ruft es auf, mit
  `HKO.database`. lms_box-Seiten erzeugen nie eine dritte Instanz.
- **Logout-Koordination:** `js/auth.js` exportiert zusätzlich `registerSaver({ flush, hasUnsaved, hasUnsynced, suspend, resume, close })`;
  die bestehenden Aufrufstellen berücksichtigen registrierte Saver zusätzlich. Ohne registrierten Saver ist das
  Verhalten identisch. `js/hko/save.js` registriert sich.
- **Cache:** `js/storage.js` unverändert (DB `LMS_AssignmentsDB`), Schlüssel `unsynced_hko_<unitId>_<blockId>` =
  `{ rev, state: 'local'|'error'|'too_large', value }`. `hasUnsyncedWork()` von lms_box findet sie über das Präfix `unsynced_`.
- **DOM-Vertrag `hko.html`:** `#assignment-container` > `#assignment-header` (`#main-title`, `#sub-title`), `#hko-ki-regel`,
  `#content-renderer`, `#action-container` (`#print-answers`, `#save-status`). Klasse `embedded` auf `<html>` wie `index.html`.
  Der Container hängt nicht an `100vh`.
- **Block-Modul** (`js/hko/blocks/<typ>.js`, statisch in `js/hko/registry.js` registriert):
  `render(block, ctx)`, `collect()`, `restore(value)` (ohne `ctx.changed()`, verträgt ältere Werte), `validate()` →
  `{ok, hinweise[], zuGross}`, `setEnabled(bool)`, `printHtml(value, block, unit)` (escaped). `mitnahme` braucht kein `collect/restore`.
  `ctx = { uid, classId, variante, unit, block, unitId, blockId, readonly, api, changed(), container, reportPaste(feld, event) }`.
  Ein Modul hält seinen Zustand pro `render()`-Aufruf (Fabrik `create()` → Instanz), nie modulglobal.
- **Speichern:** Debounce 2 s, ein Schreibvorgang gleichzeitig, Revisionslogik und `isInitializing` wie `js/renderer.js`
  (nachgebaut, nicht importiert); immer aus dem eigenen DOM. Status `#save-status`: `saving | local | cloud | error | too_large`, Sie-Form.
- **Live-Mitnahme:** `BroadcastChannel('hko-answers')`, Nachricht `{ v: 1, uid, unitId, blockId, value, rev }` nach jeder lokalen
  Änderung; Empfänger prüfen `uid`. Bei `visibilitychange`/`focus` neu vom Server lesen.
- **Variante:** Roster `students/{uid}.classId` → `classes/{classId}`; Fälle und Texte nach Plan §2.4. Formativ, im Client fälschbar (P1-E3).
- **Druck:** `listOwnAnswers(unitId)` (`where uid ==`, `where unitId ==`) → Popup mit allen Blöcken der eigenen Variante.
- Alle Werte aus der DB gehen per `textContent` oder escaped ins DOM, nie als HTML.

## 8. Tests und Emulatoren

| Skript | Config | Ports | Projekt |
|---|---|---|---|
| `test:hko:rules` | `firebase.hko-test.json` | Auth 9230, Firestore 8320 | `demo-hko` |
| `test:hko:upload` | – (`node --test`, ohne Emulator) | – | – |
| `test:e2e:hko`, `test:e2e:hko-dashboard` | `firebase.hko-e2e.json` (nur `hko`-Rules, **lmsbox-Ports** 9190/8280, weil `js/firebase.js` fest dorthin verbindet) | 9190/8280 | `interactive-media-2a1fc` |
| `test:hko` | Kette der vier | | |

`firebase.hko-e2e.json` belegt dieselben Ports wie `test:all`: **nie gleichzeitig laufen lassen**.

## 9. Abweichungen vom Plan P1

| # | Plan | Vertrag | Grund |
|---|---|---|---|
| V1 | `raster.value.zellen` | `raster.value.zeilen` | so dokumentiert im Build-Format (`schema/README.md` Designentscheid 9); ein Name für Box, Inhalt und später hkoFormativ |
| V2 | `hkoDb()` in `js/firebase.js` | `namedDb(databaseId)`, Name aus `js/hko/config.js` | Regel «eine Stelle pro Projektwert» (§1) |
| V3 | `kn: true`-Blöcke nicht vorgesehen | Build liefert `kn-3j-faelle`, `kn-4j-faelle`, `kn-4j-besprechung`; Box zeigt einen Hinweis, speichert nichts | Plan A14: KN in P1 ausserhalb der Box |
| V4 | `beispielzeile` (eine Zeile) | `beispielzeilen[{c}]` | Build-Format |
| V5 | `raster.quelle_ref` immer | `quelle_ref` **oder** `lehrmittel_seiten` | Build-Format (z. B. `a-raster-text-4j`) |
| V6 | – | Quellen-Map `unit.quellen` mit `quellenverweis`, `lizenz`, `vault_bild`; Box zeigt Verweis, bettet nicht ein | Rahmen §1a, quelle 1.2.0 |
