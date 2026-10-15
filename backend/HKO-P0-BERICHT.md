# hko-box – Bericht Phase P0 (15.10.2026)

Branch `hko` im Worktree `D:\OS\dev\obs-allgemeinbildung\app-hko\` (Repo `allgemeinbildung/lms_box`). Nur lokal committet, **kein Push, kein Deploy, nichts in der Cloud angelegt.** Spezifikation: `hko-content/_input/HKO_PARALLELSYSTEM_HANDOFF_v1.md` §12 P0.

## 1. Erledigt

| # | Aufgabe | Ergebnis |
|---|---|---|
| 1 | C2 Rules-Isolation | `backend/HKO.md` (Rules-Isolation und Tests, Deploy-Ziele, Functions, Storage) |
| 2 | `firebase.json` additiv | zweiter Firestore-Eintrag `hko` (europe-west6). `functions:hko` erst in P1/P2, `storage:hko` noch nicht (Begründung unten) |
| 3 | Leere Rules + Tests | `firestore.hko.rules`, `firestore.hko.indexes.json`, `firebase.hko-test.json`, `test/hko-rules.test.mjs`, npm-Skript `test:hko` |
| 4–8 | C1, C3, C4, C5, C6 | Befunde in §3 |
| 9 | Seed | `scripts/seed-hko.mjs` (fiktive Klassen `test-3j-a`, `test-4j-a`, `test-2j-a`, `test-3j-inaktiv` + Testkonten) |
| 10 | Plan P1 | `backend/HKO-P1-PLAN.md` |

**Dateien:**
- Neu: `HKO.md`, `HKO-P0-BERICHT.md`, `HKO-P1-PLAN.md`, `firebase.hko-test.json`, `firestore.hko.rules`, `firestore.hko.indexes.json`, `scripts/seed-hko.mjs`, `test/hko-rules.test.mjs`, `test/fixtures/unit-lj1-konsum-budget.json` (alle unter `backend/`).
- Geändert: `backend/firebase.json`, `backend/package.json` (`test:hko`), `backend/scripts/emu.mjs` (nur ein Block dazu).
- Unverändert (`git diff main` leer): `firestore.lmsbox.rules`, `functions/`, `index.html`, `dashboard/`, `js/`.

## 2. Tests

- `npm run test:all`: grün, vor (Baseline) und nach den Änderungen. Das sind `test:rules` 31/31, `test:functions` 61/61, e2e-student 15 Schritte und e2e-dashboard 16 Schritte.
- `npm run test:hko`: grün, 9/9.
- **Fund, der lmsbox gebrochen hätte:** Stehen zwei Firestore-Einträge in `firebase.json`, lädt der Emulator **keine** Rules und erlaubt alles («does not support multiple databases yet»). Gegenprobe: 24 von 31 lmsbox-Rules-Tests waren rot. `scripts/emu.mjs` setzt deshalb ohne `--config` immer `firestore:lmsbox`. Ein nacktes `firebase emulators:*` aus `backend/` läuft jetzt ohne Rules; das war auch vorher verboten (CLAUDE.md).

## 3. Befunde C1–C6

**C1 Bucket, Region, Blaze**
- `gs://interactive-media-2a1fc.firebasestorage.app` existiert. Er liegt in **EUROPE-WEST6** (regional), uniform access ist aus, Soft Delete steht auf 7 Tage.
- `appspot.com` gibt es nicht.
- Blaze ist aktiv (`billingEnabled: True`).
- Die DB `hko` gibt es noch nicht. Vorhanden sind `lmsbox` (europe-west6) und `(default)` (nam5).
- **Aber:** Storage-Rules gelten **pro Bucket**. Ein `storage`-Deploy ersetzt die Rules des ganzen Buckets, den sich HKO mit dem Lernportal teilt. Die heutigen Rules sind nicht bekannt. Deshalb steht `storage:hko` noch nicht in `firebase.json`.
- Empfehlung für P2: einen **eigenen Bucket** in europe-west6 nur für hko, oder die bestehenden Rules zuerst lesen und mitpflegen.

**C2 Rules-Isolation**
- Ist `firestore` ein Array, wählt `--only firestore:hko` genau den Eintrag `database: "hko"`. `lmsbox` bleibt dann unberührt (Quelltext firebase-tools 15.10.0).
- Gefährlich sind `--only firestore` ohne Ziel und ein nacktes `firebase deploy`: beide deployen lmsbox **und** hko.
- `(default)` (Lernportal) ist nie erreichbar, weil es nicht in `firebase.json` steht.
- Getestet wird mit `firebase.hko-test.json`: nur DB `hko`, eigene Ports (Firestore 8320, Auth 9230, Hub 4450).

**C3 Podcast-Player:** Es braucht **keine Änderung.**
- `audio` wird unverändert in `<audio src>` gesetzt. Absolute URLs (z. B. auf `podcasts-hko-audio`) funktionieren, und es braucht kein CORS, weil kein WebAudio und kein fetch im Spiel sind.
- **Pflicht** sind `caps` (mindestens `[]`), `chapters` mit mindestens einem Shot und `duration` passend zur mp3. Optional ist `terms`.
- `?ep=<id>` lädt `episodes/<id>.json` ohne Whitelist, also gehen auch `hko-<unitId>` und `-abschluss`.
- Das Repo `podcasts` ist ohne .git 1,7 GB gross, also schon über 1 GB. Ein eigenes Audio-Repo ist richtig.

**C4 nanoo.tv:** Das kann nur Pietro mit einem Testkonto prüfen. Die Checkliste steht in §5. Im aktiven Vault gibt es keine nanoo-Einbettung; das Muster aus dem Archiv ist `https://www.nanoo.tv/link/n/<id>`.

**C5 Roster `classId`:** Das Feld ist zuverlässig.
- `classId` ist die ABU-Heimklasse.
- Nur die Lehrperson setzt sie, über Callables mit der festen Liste `CANONICAL_CLASS_IDS`. Lernende können sie nicht ändern (Lernportal-Rules).
- Die Ids tragen das Eintrittsjahr und bleiben über die Lehrzeit stabil, solange niemand umsetzt.
- Ob 3J oder 4J, ist aus der Id **nicht** ablesbar. Deshalb gehört die Variante nach `hko/classes/{classId}.variante`.
- Grenze: hko-Rules können `(default)` nicht lesen. Eine Variante, die der Client in `answers` schreibt, ist deshalb fälschbar. Plan: als formativ akzeptieren und in der LP-Ansicht gegenprüfen (P1-E3).
- LJ1-Klassen 2026/27: **4PR26b (3J), 4PM26d (4J).**

**C6 Höhenanpassung:** `publish.js` braucht **keine Änderung.**
- Es prüft nur Origin, Nachrichtentyp `lmsbox-height` und `contentWindow`, keinen Pfad.
- Bedingung: `hko.html` braucht ein Element `#assignment-container`, sonst sendet `embedHeight.js` still nichts. Der Plan P1 übernimmt deshalb den DOM-Vertrag von `index.html`.
- **Korrektur der URL:** `app/` ist der Repo-Stamm. Öffentlich liegt die Box unter `https://allgemeinbildung.github.io/lms_box/hko.html`, **nicht** unter `…/lms_box/app/hko.html` (geprüft: `/lms_box/index.html` 200, `/lms_box/app/index.html` 404). Handoff §1, BOX-P0 und NAECHSTE-PHASE §4.2 nennen den falschen Pfad. Die Inhalts-Session ist informiert.
- Testplan siehe §5.

## 4. Befehle für Pietro

Alles aus `D:\OS\dev\obs-allgemeinbildung\app-hko\backend\`, erst nach Durchsicht des Branches `hko`:

```bash
# 1. Datenbank hko anlegen (einmalig, mit Löschschutz)
gcloud firestore databases create --database=hko --location=europe-west6 --type=firestore-native --delete-protection --project=interactive-media-2a1fc

# 2. Leere Rules und Indexe NUR für hko deployen
firebase deploy --only firestore:hko --project interactive-media-2a1fc

# 3. Kontrolle
firebase firestore:databases:get hko --project interactive-media-2a1fc
```

- Die DB muss vor Schritt 2 existieren; der Deploy legt sie nicht an.
- Nie `--only firestore` ohne `:hko` und nie ein nacktes `firebase deploy`.
- Der Deploy von Schritt 2 geht auch vom Branch `hko` aus, ohne Merge, weil er nur Firestore betrifft und nicht GitHub Pages.
- **Bucket:** jetzt nichts. Für P2 entscheiden: eigener Bucket (`gcloud storage buckets create gs://<name> --location=europe-west6 --uniform-bucket-level-access --project=interactive-media-2a1fc`, danach in der Firebase-Konsole unter Storage verknüpfen) oder die bestehenden Rules des Standard-Buckets erst in der Konsole ansehen.
- **Functions `hko`:** jetzt nichts. Die Codebase wird erst angelegt, wenn es eine Function gibt.

## 5. Testpläne für Pietro

**C6 (nach P1, wenn `hko.html` auf `main` ist):**
1. Eine nicht verlinkte Testnotiz mit eigenem `permalink` anlegen, **ausserhalb** von `ABUlehrmittel/`, z. B. unter `HKO/`, mit Rücksicht auf den sha256-Schutz.
2. Darin zwei bis drei `hko.html`-iframes und ein bestehendes lms_box-iframe als Referenz.
3. Prüfen, dass die Höhe wächst und schrumpft (Antwort tippen, auf- und zuklappen), dass jedes iframe seine eigene Höhe hat und dass ein iframe in einem zugeklappten Callout nach dem Öffnen stimmt.
4. Mobil bei 375 px und auf iOS-Safari prüfen.
5. Danach die Testnotiz wieder unpublishen.

**C4 nanoo.tv:** zwei nanoo-Einbettungen in einer nicht verlinkten Testnotiz, mit einem **Lernenden-Testkonto** (nicht dem eigenen nanoo-Konto):

| # | Fall | Erwartet |
|---|---|---|
| 1 | privates Fenster, Schulnetz, nie bei nanoo angemeldet | spielt ohne Login |
| 2 | Schul-PC, Schulnetz | spielt |
| 3 | Handy im Mobilnetz (WLAN aus) | spielt? Trennt die Frage nach IP-Bindung oder Schullizenz |
| 4 | Heim-WLAN, Privatgerät | spielt? |
| 5 | Safari iOS (privat und normal) | spielt? |
| 6 | Drittanbieter-Cookies blockiert | spielt? |
| 7 | Vollbild, Steuerung | funktioniert |
| 8 | Konsole im iframe | keine Sandbox-, CSP- oder X-Frame-Fehler |

Spielen alle Fälle 1–6 ohne Login: `login_noetig: false` in der Quellenkarte. Sonst `true`, mit Bedingung, und als Ausweg eine SRF-Quelle, einen Link im neuen Tab oder ein Transkript.

## 6. Offene Fragen

1. **Build-Format.** `hko-content/schema/` und `build/` gibt es noch nicht. Die Wünsche der Box (Plan P1 §7.2: A3 kein `string[][]` in Firestore, A4 `varianten{}` nach §5.2, A5 flache `blocks{}`, A6 aufgelöste Item-Fragen, A10 Blockreihenfolge) sind an die Inhalts-Session gemeldet. Pietro entscheidet.
2. **Entscheide P1-E1 bis P1-E6** (Plan P1 §0): Editor Quill, gemeinsame IndexedDB, Variante als formativ akzeptieren, Items inline, Klasse fehlt → nur lesen, Duzen im Login-Dialog.
3. **Storage für P2:** eigener Bucket oder gemeinsame Rules?
4. **Testklassen für P1 live:** 4PR26b und 4PM26d? Testkonten?
5. Weiterhin offen und für P2 blockierend: O1 LLM-Anbieter, O2 Einwilligung, O3 Aufbewahrung.
