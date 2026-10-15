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
