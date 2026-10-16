# hko-box – Bericht Phase P1 (16.10.2026)

Branch `hko` im Worktree `D:\OS\dev\obs-allgemeinbildung\app-hko\` (Repo `allgemeinbildung/lms_box`). Nur lokal committet, **kein Push, kein Deploy, nichts in der Cloud angelegt.** Grundlage: `HKO-P1-PLAN.md` (Entscheide P1-E1 bis E6 übernommen), Rahmen `hko-content/_plan/BOX-P1_PROMPT.md` §1a. Verbindlicher Vertrag: `HKO.md`, Abschnitt «Phase P1 — Vertrag».

## 1. Erledigt (M1–M4, lokal)

| Meilenstein | Commit | Inhalt |
|---|---|---|
| M1 | `add6084` | Vertrag P1 in `HKO.md`; Rules `answers`, `pasteEvents`, `classes` mit Budget-Spike; Indexe; Fixture `test/fixtures/hko-build/`; `scripts/hko-upload.mjs` + `scripts/lib/hko-validate.mjs` + `hko-target.mjs` |
| M1/M2 | `da0e97b` | `js/firebase.js` `namedDb()` und `js/auth.js` `registerSaver()` additiv (test:all vor/nach grün); `hko.html`, `css/hko.css`, `js/hko/` (Registry, Speichern, Variante, KI-Regel, Quelle, Paste-Hinweis), Block `text`, Platzhalter, KN-Hinweis; LP-Ansicht `dashboard/hko.html` + `dashboard/hko/` mit CSV |
| M2 | `2d139d9` | Blöcke `items`, `raster`, `selbst`, `mitnahme`, Druckansicht |
| M3 | `c9692ab` | e2e Lernendenseite vollständig (18 Schritte), Review mitnahme/Druck, Doku (`HKO.md` nachgeführt, Umzug, Befehle; `HKO-P1-ANLEITUNG-LP.md`) |
| M4 | (dieser Commit) | echter Build `lj1-konsum-budget` im Emulator hochgeladen und im Browser durchgespielt; dieser Bericht |

**Spike Ausdrucks-Budget:** voller Raster 8 × 6 à 500 Zeichen + Befund 3 000 und 12 Items à 3 000 passen (gemessen im Emulator). Die naive Fassung scheiterte bei 11 Items bzw. 4 Rasterzeilen; die Rules prüfen deshalb eine Rasterzeile per `join`/`split` mit einem Regex. Reserve klein (≈ 14 Items, ≈ 10 Zeilen). Rückfallgrenzen nicht nötig.

**M4-Beleg (Screenshots):** `…/side-session-notes/local_2cf48d36-…/box-p1-belege/` – Text gespeichert («In der Cloud gespeichert», Emulator), Raster mit SRF-Quellenverweis, Mitnahme der Antwort an Lea + 4J-Hinweis für eine 3J-Person, KN-Hinweis. Host-Seite mit sechs iframes der echten Einheit, Konsole ohne Fehler.

## 2. Tests (Schlusslauf 16.10.2026, nacheinander)

- `npm run test:all`: grün – Rules 31/31, Functions 61/61, e2e-student 15, e2e-dashboard 16 Schritte.
- `npm run test:hko`: grün – Rules 33/33, Upload + CSV 39/39, Upload-Emulator 2/2, e2e-hko-student 18 Schritte, e2e-hko-dashboard 12 Schritte.
- e2e-hko-student zusätzlich dreimal hintereinander grün. Frühere Ausfälle kamen vom Test (Tastaturfokus in cross-site-iframes), nicht von der App; Helfer `clickFocus()`.
- `hko-upload.mjs` Trockenlauf gegen den echten Build: 36 Dokumente, 0 Fehler, 3 Warnungen (die drei `kn: true`-Blöcke).
- Geschützte Dateien ab Merge-Basis unverändert: `firestore.lmsbox.rules`, `js/renderer.js`, `index.html`, `dashboard/liveview.html`, `js/storage.js`, `js/embedHeight.js`. Kein Schlüssel im Diff; «ß» nur in der Eszett-Prüfung selbst.

## 3. Abweichungen vom Plan und vom Build-Format

Alle stehen im Vertrag (`HKO.md` §9). Kurz:
- **V1** Raster-Antwort `value.zeilen` statt `zellen` (wie `schema/README.md` Designentscheid 9).
- **V2** `namedDb(databaseId)` statt `hkoDb()`; DB-Name nur in `js/hko/config.js`.
- **V3** Der Build liefert KN-Blöcke (`kn-3j-faelle`, `kn-4j-faelle`, `kn-4j-besprechung`). Die Box zeigt einen Hinweis und speichert nichts (Plan A14); die Rules-Sperre ist trotzdem getestet.
- **V4/V5/V6** `beispielzeilen[{c}]`; Raster mit `lehrmittel_seiten` statt `quelle_ref`; `unit.quellen` mit `quellenverweis`/`lizenz`/`vault_bild` – die Box bettet nichts ein, zeigt Quelle und Quellenverweis (bei SRF Pflicht), bei `vault_bild` nur den Link «Zu den Daten».
- **V7/V8** `classes`: LP darf anlegen und ändern, nicht löschen; `solutions` bleiben auch für LP zu.
- Rules-Feinheiten: Rasterzelle mit U+0001 wird abgelehnt; `classId` darf leer sein; `frageId` wird nicht gegen die Fragen des Blocks geprüft.
- Upload: Einheit ohne Lösung ist nur eine Warnung (P1 hat kein KI-Feedback); ab P2 auf Fehler stellen.

## 4. Befehle für Pietro

Ausführlich in `HKO.md` §11. In dieser Reihenfolge:

1. **`hko` auf den neuen `main` nachziehen.** Seit P1-Start kam `a6331df` «Gastmodus ohne Anmeldung» auf `main` (ändert `js/auth.js`, `renderer.js`, `storage.js`, `app.js`, lmsbox-Rules). In `js/auth.js` ist ein Konflikt mit `registerSaver` zu erwarten. Danach `npm run test:all` und `npm run test:hko` (nacheinander, gleiche Ports).
2. DB anlegen (falls noch nicht) und Rules/Indexe nur für hko:
   ```bash
   firebase firestore:databases:create hkobox --location europe-west6 --delete-protection ENABLED --project interactive-media-2a1fc
   firebase deploy --only firestore:hkobox --project interactive-media-2a1fc
   ```
3. `classes` live anlegen: `4PR26b` → `{variante: '3J', lehrjahr: 1, aktiv: true}`, `4PM26d` → `{variante: '4J', lehrjahr: 1, aktiv: true}`, dazu je eine Testklasse für die Testkonten.
4. Inhalte hochladen (aus `app-hko/backend/`, Standard-Build `../../hko-content/build`):
   ```bash
   node scripts/hko-upload.mjs
   node scripts/hko-upload.mjs --live --key D:\OS\CoSch-sandbox\.secrets\firebase-admin.json --yes
   ```
5. Merge `hko` → `main` und Push = Frontend-Deploy (Pietro entscheidet). `hko.html` ist danach öffentlich, aber nirgends verlinkt.
6. Testseite im Vault (ausserhalb von `ABUlehrmittel/`, sha256-Schutz): iframes auf `https://allgemeinbildung.github.io/lms_box/hko.html?unit=lj1-konsum-budget&block=<blockId>`, Live-Test AP11 mit Testkonten (Schul-PC Chrome, iPhone Safari, Firefox, Android). LP-Ansicht: `https://allgemeinbildung.github.io/lms_box/dashboard/hko.html`.

## 5. Offen

1. **Composite-Index** für `answers`/`pasteEvents` mit `uid in […]` + `unitId ==` (LP-Ansicht) und `uid ==` + `unitId ==` (Druck) steht in `firestore.hko.indexes.json`; der Emulator prüft Indexe nicht. Beim Live-Test auf eine Index-Fehlermeldung achten.
2. **Druck im Publish-iframe** braucht `allow-popups` in der Sandbox des Einbettungs-iframes, sonst erscheint nur der Hinweis. Live prüfen.
3. **Login-Dialog duzt** (geteilter Code, P1-E6), Blöcke siezen.
4. **Selbstregistrierung und anonyme Anmeldung** im Projekt weiterhin offen (Plan R2), nur in der Firebase-Konsole zu schliessen.
5. Nicht live geprüft: Safari, Firefox, Android, echte Daten, Höhe auf Obsidian Publish.
6. O1 (LLM), O2 (Einwilligung), O3 (Aufbewahrung) und die Storage-Frage blockieren P2. Startprompt: `hko-content/_plan/BOX-P2_PROMPT.md`.
