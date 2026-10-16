# HKO-Parallelsystem — Backend (Phasen P0 und P1)

Neben dem Altsystem `lmsbox` (Vertrag: `CONTRACT.md`) entsteht im selben Firebase-Projekt
`interactive-media-2a1fc` das HKO-Parallelsystem: eigene benannte Datenbank **`hko`**
(`europe-west6`), eigene Rules, später eigene Functions-Codebase `hko`.
Grundlage: `hko-content/_input/HKO_PARALLELSYSTEM_HANDOFF_v1.md` (§5, §11, §12, §13 C2) und
`ANTWORTEN_HKO_PARALLELSYSTEM_v1.md` (D1, D2). Öffentliche URL der Box später:
`https://allgemeinbildung.github.io/lms_box/hko.html` (`app/` ist der Repo-Stamm).

Stand 15.10.2026 (P0), unverändert am 16.10.2026 (P1 gebaut, nichts deployt): Die Datenbank `hkobox` existiert noch nicht. Der Standard-Bucket
`interactive-media-2a1fc.firebasestorage.app` liegt in `EUROPE-WEST6`, Blaze ist aktiv (C1).

## Dateien

| Datei | Zweck |
|---|---|
| `firestore.hko.rules` | Rules nur für die DB `hkobox` |
| `firestore.hko.indexes.json` | Indexe der DB `hkobox` (noch leer) |
| `firebase.json` | zweiter `firestore`-Eintrag `database: "hkobox"`; `lmsbox` bleibt an erster Stelle und unverändert |
| `firebase.hko-test.json` | Emulator-Konfiguration nur mit `hko`, eigene Ports |
| `test/hko-rules.test.mjs` | Rules-Tests, `npm run test:hko` |
| `test/fixtures/unit-lj1-konsum-budget.json` | fiktive Einheit für die Lesetests |
| `scripts/seed-hko.mjs` | fiktive Testdaten (`classes`, Roster, Konten) für die Emulatoren |

P1 (16.10.2026), Pfade ab `app-hko/` bzw. `app/`:

| Datei | Zweck |
|---|---|
| `backend/HKO-P1-PLAN.md` | Plan und Entscheide P1-E1 bis P1-E6 |
| `backend/HKO-P1-ANLEITUNG-LP.md` | Kurzanleitung LP-Ansicht und lokales Ansehen |
| `backend/firebase.hko-e2e.json` | Emulator-Konfiguration nur mit `hko`-Rules, aber auf den lmsbox-Ports 9190/8280 (e2e) |
| `backend/scripts/hko-upload.mjs` | Build → `units`/`items`/`solutions`/`itemSolutions` (Trockenlauf, `--emulator`, `--live`) |
| `backend/scripts/lib/hko-target.mjs` | Projekt-ID, Datenbank, Basis-URL, Schuldomain für Node (eine Stelle) |
| `backend/scripts/lib/hko-validate.mjs` | Prüfung des Builds vor dem Upload |
| `backend/test/hko-upload.test.mjs`, `hko-upload.emu.test.mjs`, `hko-csv.test.mjs` | Tests Upload (ohne und mit Emulator) und CSV |
| `backend/test/e2e-hko-student.mjs`, `e2e-hko-dashboard.mjs` | e2e Lernendenseite und LP-Ansicht |
| `backend/test/fixtures/hko-build/` | fiktiver Build (`lj1-test-box`, `lj1-test-andere`) |
| `hko.html` | Lernendenseite der Box (`?unit=…&block=…`) |
| `js/hko/` | Box: `main`, `api`, `save`, `registry`, `config`, `channel`, `print`, `quelle`, `variante`, `kiRegel`, `plainGuard`, `util`, `blocks/*` |
| `js/firebase.js`, `js/auth.js` | geteilt, nur additiv: `namedDb(id)`, `registerSaver(…)` |
| `dashboard/hko.html`, `dashboard/hko/*.js`, `hko.css` | LP-Ansicht (nur lesend): `main`, `api`, `firestore`, `grid`, `detail`, `csv` |

## Rules-Isolation und Tests

### Wie die Firebase CLI `--only firestore:<db>` auflöst

Geprüft im Quelltext von firebase-tools 15.10.0 (`lib/firestore/fsConfig.js`,
`lib/deploy/firestore/prepare.js`, `release.js`), nichts deployt:

- Ist `firestore` in `firebase.json` ein **Array**, wählt `--only firestore:<x>` genau die
  Einträge, deren `database` (oder `target`) `<x>` heisst. Nur für diese werden Rules
  kompiliert und pro Datenbank freigegeben (`rulesDeploy.release(…, databaseId)`), ebenso
  die Indexe. Ein unbekanntes `<x>` bricht mit «Could not find configurations» ab.
- `--only firestore:hkobox` fasst also `lmsbox` nicht an, und `--only firestore:lmsbox` nicht `hkobox`.
- **`--only firestore` (ohne Ziel) und ein nackter `firebase deploy` deployen alle Einträge**,
  also `lmsbox` **und** `hko` zusammen. Die `(default)`-DB des Lernportals erreichen sie nicht,
  weil sie in `firebase.json` nicht vorkommt — sie wird nie eingetragen.
- `--only firestore:rules` bzw. `firestore:indexes` wählt bei einem Array **keine** Datenbank
  aus und deployt nichts. Nicht verwenden.
- Stolperstelle: Der Deploy legt eine fehlende Datenbank selbst an, prüft dafür aber immer nur
  den **ersten** Array-Eintrag (`lmsbox`). Ein `--only firestore:hkobox`, bevor `hkobox` existiert,
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

`test:all` bleibt das lmsbox-Gate und enthält `test:hko` (jetzt die Kette aus §8) **nicht**: so beweist ein grünes
`test:all` weiterhin genau, dass das Altsystem unverändert funktioniert, und ein hko-Fehler blockiert
keine Arbeit am Altsystem. Vor jedem Merge von `hko` nach `main` laufen beide.

### Inhalt der Rules in P0 (überholt — gilt ab P1: «Phase P1 — Vertrag» §3–§5 und `firestore.hko.rules`)

Nur noch Geschichte: In P1 sind `answers` und `pasteEvents` offen, `classes` ist für LP schreibbar. `solutions`/`itemSolutions` bleiben auch in P1 zu (geöffnet wird erst mit P2, nicht mit der LP-Ansicht).

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

Die Tests (`npm run test:hko:rules`) zeigen: unangemeldet, anonym, fremde Domain und Nicht-Passwort-Anbieter
lesen `units`/`items`/`classes` nicht (get und list); Schulkonto und LP lesen sie; niemand — auch LP
und Schulkonto nicht — schreibt irgendwo (create, set, update, delete in allen Collections aus §5.1);
Schulkonto und alle anderen lesen `solutions`/`itemSolutions` nicht (get und list); eine unbekannte
Collection ist zu.

Testdaten für die hko-Emulatoren (seit P1 zusätzlich Konten, siehe Vertrag §7a):

```bash
npm run emu -- emulators:exec --config firebase.hko-test.json --project interactive-media-2a1fc --only auth,firestore "node scripts/seed-hko.mjs"
```

## Deploy-Ziele

Nichts davon ist ausgeführt. Befehle für Pietro, aus `app-hko/backend/`, immer mit Ziel:

```bash
# 1. Datenbank anlegen (einmalig), mit Löschschutz
gcloud firestore databases create --database=hkobox --location=europe-west6 --type=firestore-native --delete-protection --project=interactive-media-2a1fc
#    gleichwertig:
firebase firestore:databases:create hkobox --location europe-west6 --delete-protection ENABLED --project interactive-media-2a1fc

# 2. Rules und (leere) Indexe nur für hko
firebase deploy --only firestore:hkobox --project interactive-media-2a1fc

# Kontrolle danach (Ort, Löschschutz)
firebase firestore:databases:get hkobox --project interactive-media-2a1fc
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

## 3. Collections der DB `hkobox`

| Pfad | Inhalt | Lernende (Schulkonto) | LP (`role == 'teacher'`) |
|---|---|---|---|
| `units/{unitId}` | `build/units/<id>.json` 1:1 + `updatedAt` | lesen | lesen |
| `items/{slug}` | `build/items/<slug>.json` + `updatedAt` | lesen | lesen |
| `solutions/{unitId}`, `itemSolutions/{slug}` | Lösungen | nichts | **nichts in P1** |
| `classes/{classId}` | `{variante: '3J'/'4J'/'2J', lehrjahr: int 1–4, aktiv: bool}` | lesen | lesen, anlegen/ändern (genau diese Keys, `classId` ≤ 100 Zeichen); **löschen nicht** (stattdessen `aktiv: false`) |
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
`items.collect()` nimmt dazu nur beantwortete Fragen auf (Text nicht leer, in Fragenreihenfolge); ein Block ohne
Eingabe ergibt `{ antworten: [] }` und gilt als leer.

Rules-Details (`firestore.hko.rules`, nachgeführt am 16.10.2026):

| Punkt | Verhalten |
|---|---|
| Ausdrucksbudget | Rules haben höchstens 1000 Ausdrücke pro Anfrage und keine Schleifen; Listen sind Index für Index ausgerollt. Gemessen im Emulator (Tests «11 budget»): volles Raster 8 × 6 × 500 und 12 Fragen × 3000 gehen durch, create und update |
| Raster-Zeile | Zellen werden mit U+0001 verbunden; **eine** Regex (≤ 6 Segmente à ≤ 500) und ein `split` müssen die Liste exakt zurückgeben. Folge: eine Zelle darf **kein U+0001** enthalten, eine Nicht-String-Zelle wird abgelehnt. Eine Zeile ist `{c: [string]}` (Firestore kennt keine Liste in der Liste) |
| `classId` | String ≤ 100 Zeichen; in `answers` und als Dokument-Id in `classes` |
| `solutions`, `itemSolutions` | zu, auch für LP (der Lehrer-Claim ist mit dem Lernportal geteilt); Öffnung frühestens P2, mit Test |
| `students/{uid}` | nur Emulator, lesend (eigenes Dokument oder LP) |

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
  erzeugt und pro Id gecacht, verbindet im Emulator-Modus mit demselben Port wie `db`). `namedDb('lmsbox')` und
  `namedDb('(default)')` geben die **bestehenden** Instanzen `db` bzw. `rosterDb` zurück, nie eine neue. Nur `js/hko/api.js` ruft es auf, mit
  `HKO.database`. lms_box-Seiten erzeugen nie eine dritte Instanz.
- **Logout-Koordination:** `js/auth.js` exportiert zusätzlich `registerSaver({ flush, hasUnsaved, hasUnsynced, suspend, resume, close })`;
  die bestehenden Aufrufstellen berücksichtigen registrierte Saver zusätzlich. Ohne registrierten Saver ist das
  Verhalten identisch. `js/hko/save.js` registriert sich.
- **Kein Gastmodus** (nachgetragen 16.10.2026, Merge von `a6331df`): `authenticate()` löst seit dem
  lms_box-Gastmodus ohne Anmeldung sofort mit `guest: true` auf. `hko.html` zeigt dann **nichts** aus der
  DB und **speichert nichts** (ohne uid sind `units`/`classes` nicht lesbar und `answers` nicht
  schreibbar), entfernt das lms_box-Gastband (dessen Text «bleiben in diesem Browser» gilt hier nicht),
  zeigt den Hinweis `data-reason="gast"` (`#content-renderer` `data-modus="gast"`) und öffnet über das
  additive `requireLogin()` aus `js/auth.js` den Anmeldedialog wie vor dem Gastmodus (nicht schliessbar).
  Nach der Anmeldung lädt `auth.js` die Seite neu. Entscheid Pietro offen: ob HKO später einen lokalen
  Gastmodus wie lms_box bekommt.
- **Cache:** `js/storage.js` unverändert (DB `LMS_AssignmentsDB`), Schlüssel `unsynced_hko_<unitId>_<blockId>` =
  `{ rev, state: 'local'|'error'|'too_large', value }`. `hasUnsyncedWork()` von lms_box findet sie über das Präfix `unsynced_`.
- **DOM-Vertrag `hko.html`:** `#assignment-container` > `#assignment-header` (`#main-title`, `#sub-title`), `#hko-ki-regel`,
  `#content-renderer`, `#action-container` (`#print-answers`, `#save-status`). Klasse `embedded` auf `<html>` wie `index.html`.
  Der Container hängt nicht an `100vh`.
- **Block-Modul** (`js/hko/blocks/<typ>.js`, statisch in `js/hko/registry.js` registriert). Das Modul exportiert
  `create()` (Fabrik, liefert eine neue Instanz) und `printHtml(value, block, unit)` (rein, escaped, `value` kann `null` sein).
  Die Instanz hat `render(block, ctx)`, `collect()`, `restore(value)` (ohne `ctx.changed()`, verträgt ältere Werte; `main.js` ruft es
  synchron nach `render()`), `validate()` → `{ok, hinweise[], zuGross}`, `setEnabled(bool)`. `mitnahme` und `platzhalter` speichern
  nichts und haben kein `collect/restore`. Die Registry: `blockEntry(type) → { modul, speichert }`; `speichert` ist `true` für
  `items|text|raster|selbst`, unbekannte und spätere Typen (`upload`, `link`, `roleplay`, `peer`, `audio`) liefern den Platzhalter.
  `ctx = { uid, classId, variante, unit, block, unitId, blockId, readonly, api, changed(), container, reportPaste(feld, event) }`.
  Ein Modul hält seinen Zustand pro `render()`-Aufruf (Fabrik `create()` → Instanz), nie modulglobal.
- **Speichern:** Debounce 2 s, ein Schreibvorgang gleichzeitig, Revisionslogik und `isInitializing` wie `js/renderer.js`
  (nachgebaut, nicht importiert); immer aus dem eigenen DOM. Status `#save-status`: `saving | local | cloud | error | too_large`, Sie-Form.
- **Live-Mitnahme:** `BroadcastChannel('hko-answers')`, Nachricht `{ v: 1, uid, unitId, blockId, value, rev }` nach jeder lokalen
  Änderung; Empfänger prüfen `uid`. Bei `visibilitychange`/`focus` neu vom Server lesen (ausgelassen, wenn in den letzten 5 s
  ein Broadcast kam). Eine gültige Marke `unsynced_hko_…` im Cache gewinnt über den Server, wie beim Laden des Blocks.
- **Variante:** Roster `students/{uid}.classId` → `classes/{classId}`; Fälle und Texte nach Plan §2.4. Formativ, im Client fälschbar (P1-E3).
- **Druck:** `listOwnAnswers(unitId)` (`where uid ==`, `where unitId ==`) → Popup mit allen Blöcken der eigenen Variante;
  ungespeicherter eigener Text (Marke im Cache, auch aus einem Geschwister-iframe) gewinnt über den Server.
- Alle Werte aus der DB gehen per `textContent` oder escaped ins DOM, nie als HTML.

### 7a. Testkonten im Seed (`scripts/seed-hko.mjs`, nur Emulator, fiktiv)

| Konto (`@lernende.bbw.ch`) | Klasse | Zweck |
|---|---|---|
| `test.3j`, `test.3jb` | `test-3j-a` (3J) | zwei Konten derselben Klasse |
| `test.4j` | `test-4j-a` (4J) | Variante 4J |
| `test.2j` | `test-2j-a` (2J) | Variante 2J |
| `test.inaktiv` | `test-3j-inaktiv` (`aktiv: false`) | inaktive Klasse |
| `test.unbekannt` | `test-unbekannt` (kein `classes`-Dokument) | Klasse nicht erfasst |
| `test.zwei` | `classIds: [test-3j-a, test-4j-a]` | zwei Klassen, die erste zählt |
| `test.lehrperson` | – | Lehrperson (Claim `role=teacher`) |

Das Passwort steht im Skript (`SEED_PASSWORD`, sonst Vorgabe); es gilt nur im Emulator und steht hier nicht.

## 8. Tests und Emulatoren

| Skript | Config | Ports | Projekt |
|---|---|---|---|
| `test:hko:rules` | `firebase.hko-test.json` | Auth 9230, Firestore 8320 | `demo-hko` |
| `test:hko:upload` | – (`node --test`: Upload und CSV, ohne Emulator) | – | – |
| `test:hko:upload:emu` | `firebase.hko-test.json` | 9230 / 8320 | `demo-hko` |
| `test:e2e:hko`, `test:e2e:hko-dashboard` | `firebase.hko-e2e.json` (nur `hko`-Rules, **lmsbox-Ports** 9190/8280, weil `js/firebase.js` fest dorthin verbindet) | 9190/8280 | `interactive-media-2a1fc` |
| `test:hko` | Kette: `test:hko:rules`, `test:hko:upload`, `test:hko:upload:emu`, `test:e2e:hko`, `test:e2e:hko-dashboard` | | |

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
| V7 | P0-Text: Öffnung von `solutions` mit der LP-Ansicht (P1) | `solutions`/`itemSolutions` bleiben in P1 für alle zu | kein P1-Client braucht sie; Öffnung mit P2 |
| V8 | – | `classes`: LP darf anlegen/ändern, nicht löschen | `aktiv: false` statt Löschen |

## 10. Umzug in ein eigenes Projekt

Auslöser: Nach dem Klassentest zieht die hko-box aus `interactive-media-2a1fc` in ein eigenes Firebase-Projekt (hep-Verlag-Prototyp).
Diese Liste ist der Plan; ausgeführt ist nichts.

### 10.1 Was zu ändern ist

| Datei / Ort | Änderung |
|---|---|
| `js/config.js` | neue Web-Konfiguration (`apiKey`, `authDomain`, `projectId`, …). **Geteilt mit lms_box:** im eigenen Projekt braucht die Box eine eigene Kopie oder einen eigenen Build, sonst ändert sich das Altsystem mit |
| `js/hko/config.js` | `database` (im eigenen Projekt reicht `(default)`), `baseUrl` (neue Hosting-Adresse), `schoolDomain` |
| `backend/scripts/lib/hko-target.mjs` | `PROJECT_ID`, `DATABASE_ID`, `BASE_URL`, `SCHOOL_DOMAIN` |
| `isSchoolAccount()` in `firestore.hko.rules` | Schuldomain (einzige Stelle in den Rules); überlegen, ob für Dritte (Verlag, andere Testklassen) statt der Domain eine andere Prüfung nötig ist |
| `backend/firebase.json` | `firestore`-Eintrag: `database` ggf. `(default)`; ohne `lmsbox`-Eintrag; `functions`-Eintrag neu, sobald es Functions gibt |
| `.firebaserc` (existiert bisher nicht) | neue Projekt-ID als Standard anlegen; Deploy-Befehle behalten trotzdem `--project <neu>` |
| `package.json`, `scripts/seed-hko.mjs`, `scripts/hko-upload.mjs` | Emulator-Projekt-Id `interactive-media-2a1fc` (e2e-Skripte, Seed-Vorgabe) auf die neue Id. Die festen Emulator-Ports 9190/8280 in `js/firebase.js` bleiben, solange die Box diese Datei teilt |
| Vault-iframes der Inhalts-Session | Basis-URL `https://allgemeinbildung.github.io/lms_box/hko.html?unit=…&block=…` auf die neue Adresse |
| `dashboard/modules/auth.js` | Die LP-Ansicht verlangt den Claim `role == 'teacher'`. Im neuen Projekt den Claim für die Lehrpersonen neu setzen (Admin-Skript), sonst kommt niemand in die Ansicht |
| Roster `students/{uid}` in `(default)` des Lernportals | **Abhängigkeit:** Die LP-Ansicht (`dashboard/hko/api.js` `loadRoster`) und die Variantenwahl lesen `students/{uid}` (`name`, `classId`, `classIds`). Ein eigenes Projekt hat keinen Roster und muss das neu lösen: eigene Collection pro uid (Rules: eigenes Dokument, LP alle), gefüllt aus der Klassenliste von Schule oder Verlag. Das berührt Router §4 (Lernendendaten) sowie O2 und O3 |

### 10.2 Welche Daten mitziehen

| Daten | Weg |
|---|---|
| `units`, `items`, `solutions`, `itemSolutions` | **neu hochladen** aus dem Build (`hko-upload.mjs --live` mit Schlüssel des neuen Projekts); nicht exportieren |
| `classes` | neu anlegen (kleine Dokumente `{variante, lehrjahr, aktiv}`) |
| `answers`, `pasteEvents` | per Admin-Skript exportieren und importieren. Die Dokument-Ids tragen die `uid` (`<uid>__<unit>__<block>`), und `uid`s hängen am Auth-Projekt: entweder **Konten migrieren** (Auth-Export/-Import mit gleichen `uid`s) oder **Neuanmeldung** mit neuer `uid` und einer Zuordnungstabelle alt → neu, nach der `uid` in Id und Feld umgeschrieben werden. Ohne Zuordnung sind die Antworten unbrauchbar. Antworten sind Lernendendaten: Export nur lokal, nie in ein Repo |
| Roster | wird **nicht** pauschal kopiert; nur die nötige Zuordnung (uid → Name/Klasse), und nur mit Einwilligung (O2/O3). Sonst im neuen Projekt neu aufbauen |

### 10.3 Reihenfolge

1. Neues Projekt anlegen (Region `europe-west6`, Auth-Anbieter Passwort). O1–O3 klären, bevor echte Daten fliessen.
2. Konfiguration ändern (Tabelle 10.1), `test:hko` mit der neuen Emulator-Projekt-Id laufen lassen.
3. Datenbank anlegen (mit Löschschutz), Rules nur für diese Datenbank deployen.
4. Konten und Claims: Lehrpersonen mit `role=teacher`, Lernende per Migration oder Neuanmeldung; Roster-Lösung stellen.
5. Inhalte hochladen (Trockenlauf, dann `--live`), `classes` anlegen.
6. `answers`/`pasteEvents` importieren (nur bei Konten-Migration oder mit Zuordnungstabelle).
7. Vault-iframes auf die neue Basis-URL umstellen, dann die alte `hko`-Datenbank abschalten. Löschen erst nach einer ruhigen Woche und nur auf Pietros Entscheid (Löschschutz vorher aufheben).

## 11. Befehle für Pietro

Nichts davon ist ausgeführt. Aus `app-hko/backend/`, **immer mit Ziel und `--project interactive-media-2a1fc`**, nie ein nacktes
`firebase deploy`, nie `--only firestore`. Vorher `npm run test:all` und `npm run test:hko` grün (nicht gleichzeitig: gleiche Ports).

```bash
# 1. Datenbank anlegen (einmalig, falls noch nicht da; mit Löschschutz)
firebase firestore:databases:create hkobox --location europe-west6 --delete-protection ENABLED --project interactive-media-2a1fc

# 2. Rules und Indexe nur für hko
firebase deploy --only firestore:hkobox --project interactive-media-2a1fc

# 3. Inhalte: zuerst Trockenlauf, dann live (Schlüssel ausserhalb des Repos)
node scripts/hko-upload.mjs --build ../../hko-content/build
node scripts/hko-upload.mjs --live --key <pfad-ausserhalb-des-repos>/firebase-admin.json --yes --build ../../hko-content/build

# Kontrolle der Datenbank
firebase firestore:databases:get hkobox --project interactive-media-2a1fc
```

4. **`classes` live anlegen:** ein Dokument pro Klasse (`{variante, lehrjahr, aktiv}`, Id = `classId` aus dem Roster), in der Konsole oder mit einem kleinen Admin-Skript; die Seed-Klassen `test-*` nicht live anlegen. Ohne `classes`-Dokument zeigt die Box «Klasse nicht erfasst».
5. **Merge/Push nur durch Pietro:** `hko` nach `main` erst nach grünem `test:all` **und** `test:hko`. Der Push auf `main` ist der Deploy des Frontends (GitHub Pages). `git diff main...hko -- backend/firestore.lmsbox.rules` (ab der Merge-Basis) muss leer sein. **Zuerst `hko` auf den neuen `main` nachziehen:** seit P1-Start kam `a6331df` «Gastmodus ohne Anmeldung» dazu (ändert `js/auth.js`, `renderer.js`, `storage.js`, lmsbox-Rules); in `js/auth.js` ist ein Konflikt mit `registerSaver` zu erwarten. Danach beide Testläufe erneut.
6. **Testseite im Vault:** ein iframe auf `https://allgemeinbildung.github.io/lms_box/hko.html?unit=<unitId>&block=<blockId>` in eine eigene Testseite (nicht in die Lernenden-Seiten des Altsystems); mit einem Schul-Testkonto öffnen und eine Eingabe speichern.
7. LP-Ansicht prüfen: `https://allgemeinbildung.github.io/lms_box/dashboard/hko.html`, Anleitung `HKO-P1-ANLEITUNG-LP.md`.
