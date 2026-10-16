# HKO P1 — Kurzanleitung LP-Ansicht

Stand 16.10.2026. Die LP-Ansicht ist **nur lesend**. Vertrag: `HKO.md`, Abschnitt «Phase P1 — Vertrag».

## 1. Öffnen und anmelden

- Adresse: `https://allgemeinbildung.github.io/lms_box/dashboard/hko.html` (lokal siehe Teil 3).
- Anmeldung mit dem **Lehrpersonen-Konto** (Benutzername oder E-Mail und Passwort). Ein Konto ohne Lehrpersonen-Claim bekommt
  «Kein Zugang» und wird wieder abgemeldet. Die Anmeldung ist mit der Live-Ansicht der Lernboxen geteilt (eine pro Browser).
- Lernendenseite zum Gegenprüfen: `…/hko.html?unit=<unitId>&block=<blockId>`, in einem **privaten Fenster** mit einem Lernenden-Konto
  (als Lehrperson angemeldet zeigt sie «kein Lernenden-Konto»).

## 2. Lesen

1. **Klasse** wählen (Liste aus dem Roster des Lernportals; hinter der Klasse stehen Variante und Lehrjahr aus `classes`).
   «nicht erfasst» heisst: kein `classes`-Dokument. Dann ist die Variante unbekannt, und die Ansicht zeigt alle Blöcke ohne Mitnahme
   und Kompetenznachweis.
2. **Einheit** wählen (Liste aus `units`). Das Raster lädt und aktualisiert sich live.
3. **Raster:** Zeilen = Personen, Spalten = Blöcke der Variante der Klasse (ohne `mitnahme` und ohne Kompetenznachweis-Blöcke).
   Jede Zelle zeigt:
   - **Kurzstand:** «–» = noch nichts gespeichert; sonst z. B. «42 Wörter», «3/5 beantwortet», «8/12 Zellen + Befund»,
     «2/3 Kriterien», «angefangen»; «, abgegeben» wenn der Status so steht;
   - die Zeit des letzten Speicherns;
   - **Paste-Symbol** «⧉ n»: n Hinweise, dass Text eingefügt statt getippt wurde (Einfügen, Ablegen, grosser Zuwachs, sehr schnell).
     Ein Hinweis ist ein Indiz, kein Beweis;
   - **Variantenmarkierung** «Variante im Dokument: …», wenn die Variante im Dokument von der Variante der Klasse abweicht. Das
     Dokument stammt aus dem Browser der Person; massgebend ist die Klasse.
4. **Detail:** Zelle anklicken. Rechts erscheint die Antwort je Typ (Text, Fragen, Raster mit Befund, Selbsteinschätzung), Version der
   Einheit (Hinweis, wenn sie von der aktuellen abweicht) und alle Paste-Hinweise mit Zeit, Feld, Zeichenzahl und Auszug.

## 3. CSV

- Schaltfläche **CSV exportieren** (nach Klasse und Einheit): eine Zeile pro Person und Block mit Name, Klasse, Variante, Block, Typ,
  Stand, Antwort, Paste-Hinweisen.
- **Die Datei trägt Namen.** Nur lokal speichern; nie in ein Repo, nie in einen Artifact, nicht weitergeben (Router §4).

## 4. Was P1 nicht kann

- Keine Lösungen und keine Musterlösungen (`solutions` sind für alle zu).
- Keine Rückmeldung an Lernende, kein KI-Feedback (offen: O1 Sprachmodell, O2 Einwilligung, O3 Aufbewahrung).
- Keine Abgabe und keine Kompetenznachweise (KN) in der Box: der KN findet ausserhalb statt; die Box zeigt dort nur einen Hinweis.
- Keine Noten, kein Freigeben, kein Löschen. Klassen legt man in der Konsole oder per Skript an.

## 5. Lokal ansehen (gegen Emulatoren, ohne Cloud)

Alles aus `app-hko/backend/`, nur über `scripts/emu.mjs` (die npm-Skripte tun das). `firebase.hko-e2e.json` belegt dieselben Ports
wie `test:all` (Auth 9190, Firestore 8280): nicht gleichzeitig mit einem lmsbox-Lauf. Eine lokale Seite spricht **immer** die
Emulatoren an, nie echte Daten (die gibt es nur mit `?live=1`).

Terminal 1 — Emulatoren starten und laufen lassen:

```bash
npm run emu -- emulators:start --config firebase.hko-e2e.json --project interactive-media-2a1fc --only auth,firestore
```

Terminal 2 — Seed (fiktive Konten und `classes`) und Upload des Test-Builds (PowerShell):

```powershell
$env:FIRESTORE_EMULATOR_HOST='127.0.0.1:8280'; $env:FIREBASE_AUTH_EMULATOR_HOST='127.0.0.1:9190'
node scripts/seed-hko.mjs
node scripts/hko-upload.mjs --emulator --build test/fixtures/hko-build
```

Passwörter und Konten: stehen im Kopf und in der Ausgabe von `scripts/seed-hko.mjs` (Benutzer wie `test.3j@lernende.bbw.ch`, Lehrperson
`test.lehrperson@…`); hier bewusst nicht wiederholt. Die Testeinheiten heissen `lj1-test-box` und `lj1-test-andere`.

Webserver für die Seiten: `preview_start obs-app-hko` (Port 5192, Verzeichnis `app-hko`). Dann:

- Lernendenseite: `http://127.0.0.1:5192/hko.html?unit=lj1-test-box&block=entscheid` (weitere Blöcke: `begriffe-a`, `raster-quelle`,
  `raster-3j`, `raster-4j`, `selbst-entscheid`, `rueckblick`, `kn-fall`, `spaeter`; mit einem Lernenden-Konto, privates Fenster).
- LP-Ansicht: `http://127.0.0.1:5192/dashboard/hko.html` (mit dem Lehrpersonen-Konto aus dem Seed).

Abschluss: Terminal 1 mit Ctrl+C beenden. Die Tests selbst: `npm run test:hko` (Kette, siehe `HKO.md` §8).
