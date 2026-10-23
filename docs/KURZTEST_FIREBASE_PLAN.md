# Kurztest-Fortschritt in Firebase — Plan

Stand 16.10.2026 · **Nur Plan.** Nichts davon ist umgesetzt, committet oder deployt.

> **Entschieden (Pietro, 16.10.2026): alle Empfehlungen in §7 angenommen**, danach am selben
> Tag: **«go ahead with Firebase»** — umgesetzt, ohne dass O1 (Datenschutz) geklärt ist.
> O1 bleibt offen und gehört vor das Einschalten für alle.
>
> **Umgesetzt 16.10.2026** (nicht committet, nicht deployt):
> - `backend/CONTRACT.md`: `quizDoc`, `unit`, Sammlung `quizProgress`, Regeln, Grenzen,
>   Abschnitt «Self-test bridge», zwei zusätzliche Exporte von `js/auth.js`.
> - `backend/firestore.lmsbox.rules`: `quizOk`, `match /quizProgress`. **Abweichung vom
>   Entwurf §3:** höchstens **20** schwierige Begriffe statt 30 — mit 30 lief ein Update
>   (Firestore wertet create und update aus) ins Limit von 1000 Ausdrücken.
> - Tests: 5 neue Regeltests in `test/rules.test.mjs`; `test/e2e-kurztest.mjs` (10 Schritte,
>   `npm run test:e2e:kurztest`, Teil von `test:all`).
> - `kurztest.html`, `js/kurztest.js`; `js/auth.js` exportiert `showLoginDialog`, `closeLoginDialog`.
> - `vault/publish.js`: Brücken-iframe unter dem Kurztest, Abgleich nach §5, weiter hinter
>   `?test=begriffe`. Die Brücke regelt ihre Höhe selbst (der Block «Auto-Höhe» nimmt erst
>   ab 100px an).
> - **Abweichung von §5:** Hat das Konto schon einen Stand, ersetzt er einen Gast-Durchgang
>   auch lokal (der Gast-Durchgang wird nicht hochgeladen, aber auch nicht separat aufbewahrt).
>
> **Rollout** (Befehle an Pietro, CLAUDE.md): erst der offene Rollout «Gastmodus und
> Lösungen» (dieselbe Regeldatei) → `firebase deploy --only firestore:lmsbox --project
> interactive-media-2a1fc` → Push auf `main` (liefert `kurztest.html` aus) → publish.js in
> Publish hochladen.

## 0. Ausgangslage

Der Kurztest (🃏, `vault/publish.js`, Block «Begriffe: Chips …», Abschnitt «Kurztest am
Seitenende») läuft hinter dem Testschalter `?test=begriffe` auf `lehrmittel.aburossi.ch`.
Pro Seite speichert er in `localStorage` unter `st-quiz:<pathname>`:

```js
{ mode: "vor" | "rueck", last: { known, total, date /* ISO, Uhr des Geräts */ }, hard: [Begriff-Label, …] }
```

Ziel: denselben Fortschritt zusätzlich in Firebase sichern, damit er auf einem anderen Gerät
wieder da ist. Ohne Anmeldung bleibt alles wie heute.

Gezählt am 16.10.2026: 48 Einheiten haben einen «Definitionen»-Callout, **alle 48** binden
mindestens ein LMS-Box-iframe ein; höchstens 14 Begriffe pro Einheit.

## 1. Anmeldeweg — Empfehlung: eigene kleine Brückenseite im LMS Box

### Was geht und was nicht

- publish.js läuft auf `https://lehrmittel.aburossi.ch`, die LMS Box auf
  `https://allgemeinbildung.github.io`. publish.js kommt nicht an die Firebase-Anmeldung
  heran (anderer Ursprung, eigener Speicher). Eine zweite Anmeldung auf der Publish-Seite
  selbst wäre ein eigener Firebase-Client in publish.js — verworfen: SDK-Ballast in jedem
  Seitenaufruf, und die Lernenden müssten sich zweimal anmelden.
- **postMessage an ein LMS-Box-iframe geht.** Die Anmeldung der LMS Box liegt im IndexedDB
  des iframes. Moderne Browser teilen diesen Speicher nach *oberster Seite* auf
  (Storage Partitioning): alle LMS-Box-iframes **auf lehrmittel.aburossi.ch** teilen sich
  eine Anmeldung — wer sich in irgendeinem Auftrag angemeldet hat, ist auch in jedem
  anderen LMS-Box-iframe dieser Site angemeldet. Das ist heute schon so und funktioniert.

### Warum nicht das vorhandene Auftrags-iframe benutzen

Naheliegend wäre, das Ergebnis an eines der Auftrags-iframes zu schicken. Dagegen spricht:

1. **Publish räumt den Sizer beim Scrollen weg.** Wer unten beim Kurztest steht, hat die
   Aufträge weiter oben unter Umständen gar nicht mehr im DOM (dieselbe Ursache, die schon
   den Zurück-Knopf und den Kurztest aus dem Sizer vertrieben hat).
2. Es gibt oft mehrere Auftrags-iframes; welches antwortet, wäre Zufall, und jede
   Änderung an `index.html` (Lernendenansicht) würde den Kurztest mittreffen.
3. Die Lernendenansicht hat schon heikle Speicherlogik (`isInitializing`, `unsynced_…`,
   Abmelde-Koordination). Dort Quiz-Nachrichten einzuhängen, vergrössert die Fläche ohne Not.

### Vorschlag

Eine neue, kleine Seite **`app/kurztest.html`** (+ `js/kurztest.js`), die publish.js im
Kurztest-Kasten (also **ausserhalb** des Sizers, im `st-quiz-wrap`) als niedriges iframe
einsetzt:

```
https://allgemeinbildung.github.io/lms_box/kurztest.html?parent=https%3A%2F%2Flehrmittel.aburossi.ch
```

- Sie zeigt nur eine Zeile: abgemeldet «Fortschritt nur in diesem Browser · **Anmelden, um
  ihn zu sichern**», angemeldet «Gesichert für vorname.nachname». Der Name kommt aus der
  E-Mail-Adresse des Tokens, nicht aus der Klassenliste — keine Roster-Abfrage nötig.
- «Anmelden» öffnet den bestehenden Anmeldedialog aus `js/auth.js` *im iframe*; das iframe
  meldet seine Höhe über `js/embedHeight.js` (`lmsbox-height`), und der vorhandene Block
  «Auto-Höhe für die LMS-Box-Aufträge» in publish.js zieht den Rahmen nach. Dieser Block
  sucht in `document.querySelectorAll("iframe")`, findet also auch ein iframe ausserhalb
  des Sizers — keine Änderung nötig.
- Lädt Firestore **Lite** über `js/firebase.js` (wie die Lernendenseite), nur `getDoc` /
  `setDoc`. Kein `onSnapshot`.
- `loading="lazy"` auf dem iframe: Es lädt erst, wenn der Kurztest in die Nähe kommt.
- Ist die Seite selbst ins Lernportal eingebettet (Block «lehrmittel-height»), ist die
  oberste Seite eine andere — dort gilt eine eigene Anmeldung. Das ist unschädlich
  (gleiches Verhalten wie die Aufträge), gehört aber in die Hilfe.

### Nachrichten (Typen mit Präfix `kurztest-`)

| Richtung | Nachricht | Inhalt |
|---|---|---|
| Brücke → Publish | `kurztest-ready` | `{ signedIn, acct }` |
| Publish → Brücke | `kurztest-load` | `{ unit }` |
| Brücke → Publish | `kurztest-state` | `{ signedIn, acct, unit, record \| null }` — auch ungefragt nach An-/Abmeldung |
| Publish → Brücke | `kurztest-save` | `{ unit, record: { last, hard } }` |
| Brücke → Publish | `kurztest-saved` | `{ unit, ok, code? }` |

`acct` ist ein **Kontokennzeichen, nicht die uid**: die ersten 12 Hex-Zeichen von
SHA-256(uid), in der Brücke mit `crypto.subtle` berechnet. Die Publish-Seite braucht es nur,
um zu erkennen, ob ein lokaler Eintrag zum angemeldeten Konto gehört (§5). Die uid selbst
verlässt das iframe nicht.

### Ursprungsprüfungen, beide Richtungen

**In publish.js** (Empfang):

```js
if (event.origin !== "https://allgemeinbildung.github.io") return;
if (event.source !== bridge.contentWindow) return;       // ← zwingend, siehe unten
if (!data || typeof data.type !== "string" || !data.type.startsWith("kurztest-")) return;
```

Die Quellprüfung ist nicht optional: unter `allgemeinbildung.github.io` liegen auch
`mindmap/`, `podcasts/`, `screenshot/` — alles **derselbe Ursprung**. Die Herkunft allein
sagt nur «irgendein GitHub-Pages-Repo von allgemeinbildung».
Senden: `bridge.contentWindow.postMessage(msg, "https://allgemeinbildung.github.io")`, nie `"*"`.

**In `kurztest.js`** (Empfang):

```js
const ALLOWED = ["https://lehrmittel.aburossi.ch"];          // + Testursprung nur auf localhost
const parentOrigin = new URLSearchParams(location.search).get("parent");
if (!ALLOWED.includes(parentOrigin)) { /* nichts tun, nichts senden */ }
// je Nachricht:
if (event.source !== window.parent || event.origin !== parentOrigin) return;
```

Senden: `window.parent.postMessage(msg, parentOrigin)`. Weil der Browser `targetOrigin`
erzwingt, kommt eine Antwort nie bei einer fremden Seite an, auch wenn jemand die Brücke
mit gefälschtem `?parent=` einbettet. Und eine fremde Seite, die die Brücke einbettet,
bekommt keine Antwort und kann nichts schreiben lassen, weil ihr `event.origin` nicht in
der Liste steht. Ohne diese Liste könnte jede Website den Kurztest-Fortschritt eines
angemeldeten Lernenden lesen oder überschreiben.

Die Brücke schreibt **nur**, was die Regeln erlauben (§3), und prüft die Form vor dem
Schreiben selbst noch einmal (Zahlen, Längen), damit ein Fehler eine Meldung gibt statt
einer stillen Ablehnung.

Offen (O6): ob die Site auch unter `publish.obsidian.md/<slug>` erreichbar ist und dort
ebenfalls sichern soll. Empfehlung: nein, nur die eigene Domain.

## 2. Datenvertrag — Änderungsvorschlag für `app/backend/CONTRACT.md`

**Eine Datei pro Lernender und Einheit**, nach dem Muster von `drafts`, nicht ein Dokument
pro Lernender mit einem Feld je Einheit. Gründe:

- Regeln haben keine Schleifen. In einem Dokument mit einer Map über alle Einheiten lässt
  sich der Inhalt der einzelnen Einträge nicht prüfen, nur ihre Anzahl.
- Zwei Tabs, zwei Einheiten: getrennte Dokumente überschreiben sich nicht gegenseitig.
- Einheiten-Schlüssel enthalten Punkte und Leerzeichen; als Feldname wären sie dieselbe
  Stolperstelle wie die `subId`-Schlüssel (CONTRACT.md: kein `update()` mit Feldpfaden).
- Eine Seite liest genau ein Dokument per `get` — keine Abfrage.

`mode` (Richtung) wird **nicht** synchronisiert: es ist eine Bedienvorliebe pro Gerät, kein
Lernstand (Datensparsamkeit; bleibt in localStorage).

### Diff

```diff
 ## Ids
 ...
 pasteDoc      = `${uid}__${enc(assignmentId)}__${enc(subId)}__${eventId}`   // eventId: [A-Za-z0-9]{8,40}, made by the page
+quizDoc       = `${uid}__${enc(unit)}`
 ...
+`unit` is the Publish page of the unit: `decodeURIComponent(location.pathname.replace(/\+/g, " "))`
+without the leading `/`, at most 300 characters. It is computed in publish.js and is the same
+page that keys `st-quiz:<pathname>` in localStorage. Renaming a note on Publish starts a new
+`unit`; the old document stays and is no longer read.

 ## Collections in `lmsbox`

 | Path | Fields | Student | Teacher |
 |---|---|---|---|
 ...
+| `quizProgress/{quizDoc}` | `uid, unit, last{known, total, date}, hard[], updatedAt` — the self-test («Kurztest») at the end of a unit on lehrmittel.aburossi.ch: result of the last complete run and the terms marked «Nochmals» in it | get/create/update/delete own only | none |

 Rules that must hold:
 ...
+- `quizProgress`: id starts with `request.auth.uid + "__"` **and** `uid` equals `request.auth.uid`;
+  written only by a password sign-in with `@lernende.bbw.ch`, `updatedAt` is the server time,
+  `unit` cannot change on update. A student may delete their own document (reset). No list:
+  the page reads exactly one document by id. No teacher access (see KURZTEST_FIREBASE_PLAN §7).
+- `quizProgress` carries no name and no class. It is written only by `kurztest.html`, which
+  receives the record by postMessage from publish.js on `https://lehrmittel.aburossi.ch` only
+  (origin and source checked both ways, never `"*"`).
+
+Limits the rules enforce on `quizProgress`:
+
+- required and only: `uid, unit, last, hard, updatedAt`; `last` is exactly `{known, total, date}`.
+- `total` int 1…50, `known` int 0…`total`, `date` an ISO time string (device clock), ≤ 40 characters.
+- `hard` a list of at most 30 strings of at most 120 characters, and not longer than `total`.
+  (Real units have at most 14 terms.)
```

Unter «Client» zusätzlich:

```diff
+`kurztest.html` / `js/kurztest.js`: postMessage bridge for the self-test on
+lehrmittel.aburossi.ch. Uses `auth` and `db` from `js/firebase.js` (Firestore Lite), the login
+dialog from `js/auth.js`, and `js/embedHeight.js`. No roster read. Sends the parent an account
+tag (first 12 hex characters of SHA-256(uid)), never the uid.
```

## 3. Regeln — Entwurf für `firestore.lmsbox.rules`

Nutzt die vorhandenen Helfer `signedIn`, `notAnonymous`, `isSchoolAccount`, `idIsOwn`,
`shortString`. Budget: 30 Einträge × rund 3 Ausdrücke ≈ 100 von 1000.

```
    // ---- quizProgress (Kurztest, CONTRACT.md) -------------------------------
    // One document per student and unit. `hard` is checked entry by entry
    // (rules have no loops): at most 30 strings of at most 120 characters.
    function hardOk(h, i) {
      return h.size() <= i || shortString(h[i], 120);
    }
    function hardListOk(h) {
      return h is list && h.size() <= 30
        && hardOk(h, 0)  && hardOk(h, 1)  && hardOk(h, 2)  && hardOk(h, 3)  && hardOk(h, 4)
        && hardOk(h, 5)  && hardOk(h, 6)  && hardOk(h, 7)  && hardOk(h, 8)  && hardOk(h, 9)
        && hardOk(h, 10) && hardOk(h, 11) && hardOk(h, 12) && hardOk(h, 13) && hardOk(h, 14)
        && hardOk(h, 15) && hardOk(h, 16) && hardOk(h, 17) && hardOk(h, 18) && hardOk(h, 19)
        && hardOk(h, 20) && hardOk(h, 21) && hardOk(h, 22) && hardOk(h, 23) && hardOk(h, 24)
        && hardOk(h, 25) && hardOk(h, 26) && hardOk(h, 27) && hardOk(h, 28) && hardOk(h, 29);
    }
    function quizOk(quizId) {
      let d = request.resource.data;
      return idIsOwn(quizId)
        && quizId.size() <= 1500
        && isSchoolAccount()
        && d.keys().hasOnly(['uid', 'unit', 'last', 'hard', 'updatedAt'])
        && d.keys().hasAll(['uid', 'unit', 'last', 'hard', 'updatedAt'])
        && d.uid == request.auth.uid
        && shortString(d.unit, 300) && d.unit.size() > 0
        && d.last is map
        && d.last.keys().hasOnly(['known', 'total', 'date'])
        && d.last.keys().hasAll(['known', 'total', 'date'])
        && d.last.total is int && d.last.total >= 1 && d.last.total <= 50
        && d.last.known is int && d.last.known >= 0 && d.last.known <= d.last.total
        && shortString(d.last.date, 40)
        && d.last.date.matches('^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:.]+Z$')
        && hardListOk(d.hard) && d.hard.size() <= d.last.total
        && d.updatedAt == request.time;
    }

    match /quizProgress/{quizId} {
      // get: a missing own document answers "does not exist", not "denied".
      allow get: if notAnonymous() && idIsOwn(quizId)
        && (resource == null || resource.data.uid == request.auth.uid);
      allow create: if quizOk(quizId);
      allow update: if quizOk(quizId)
        && resource.data.uid == request.auth.uid
        && request.resource.data.unit == resource.data.unit;
      allow delete: if notAnonymous() && idIsOwn(quizId)
        && resource.data.uid == request.auth.uid;
      // No list, no teacher access (CONTRACT.md).
    }
```

Bewusst nicht in den Regeln: dass `quizId` genau `uid + "__" + enc(unit)` ist (Regeln kennen
kein `encodeURIComponent`). Ein abweichendes Paar trifft nur das eigene Dokument; die Seite
liest ohnehin nur das Dokument mit der richtig berechneten Id.

### Emulator-Tests (in `test/rules.test.mjs`, läuft mit `npm run test:rules` / `test:all`)

Mit den vorhandenen Helfern `client(tok(…))`, `alice`, `bob`, `teacher`, `anon`,
`anonSession`, `outsider`, Admin-Handle zum Vorbereiten. Einheit mit Leerzeichen, Punkt,
Umlaut und `+` im Namen, z. B. `ABUlehrmittel/1 Lernen/1.1 Lernen lernen + üben`.

Erlaubt:
1. alice legt `alice__enc(unit)` an (`updatedAt: serverTimestamp()`), liest es, aktualisiert es, löscht es.
2. alice liest ein noch nicht vorhandenes eigenes Dokument → «existiert nicht», nicht «verweigert».
3. `hard: []` und `known == total` (alles gewusst) ist gültig.

Verweigert:
4. bob liest / schreibt / löscht alices Dokument (Id mit `alice__`).
5. alice schreibt unter `bob__…`, oder unter eigener Id mit `uid: bob`.
6. Lehrperson liest alices Dokument; Lehrperson schreibt (keine Lehrerrechte).
7. Anonym, anonyme Sitzung, Nicht-Schulkonto (`outsider`, falsche Domain, Google-Anmeldung).
8. `list` auf die Sammlung, auch mit `where('uid', '==', alice)`.
9. Fremdes Feld (`mode`, `name`, `classId`), fehlendes Feld, `last` mit Zusatzfeld.
10. `total` 0 oder 51, `known > total`, `known` negativ, `total` als String/Fliesskomma.
11. `date` kein ISO-String / länger als 40.
12. `hard` mit 31 Einträgen, ein Eintrag mit 121 Zeichen, ein Eintrag als Zahl oder Map,
    `hard` länger als `total`.
13. `updatedAt` vom Client statt Serverzeit.
14. Update, das `unit` ändert.
15. `unit` leer oder 301 Zeichen.

Dazu ein **E2E-Test** `test/e2e-kurztest.mjs` (Muster `e2e-student.mjs`, Playwright gegen
die Emulatoren): eine lokale Testseite als «Publish», die `kurztest.html` einbettet:
- ohne Anmeldung `kurztest-state` mit `signedIn: false`, kein Schreibversuch;
- nach Anmeldung mit Testkonto: `save` → Dokument in `lmsbox/quizProgress`, `load` liefert es zurück;
- eine Nachricht von einem nicht erlaubten Ursprung (zweite Testseite auf anderem Port) wird
  ignoriert, und die Brücke sendet ihr nichts;
- eine Nachricht vom richtigen Ursprung, aber aus einem anderen Fenster (nicht `parent`) wird ignoriert.

Weil die Brücke im Test auf `localhost` läuft, braucht die Erlaubt-Liste einen Testursprung,
der **nur** gilt, wenn die Brücke selbst auf `localhost`/`127.0.0.1` läuft (wie die
Emulator-Weiche in `js/firebase.js`).

## 4. Datenschutz — offene Frage, nicht entschieden

Was feststeht:
- Kein Name, keine Klasse in `quizProgress`, nur die uid — wie `drafts` (CLAUDE.md
  «Kein Name in lmsbox»). Die Zuordnung zur Person ginge nur über die Klassenliste in `(default)`.
- **Keine Übermittlung an ein Sprachmodell.** Der Kurztest bewertet nichts automatisch; Router
  §4 «Übermittlung ist nicht Ablage» greift hier nicht. Es ist reine **Ablage**, am selben Ort
  (Firestore Zürich, Projekt des Lernportals) wie die Entwürfe.
- Die Daten sind dünn, aber nicht nichts: welche Begriffe jemand nicht wusste und wann er
  geübt hat. Das ist Lernverhalten pro Person.
- In den Unterlagen dieses Repos habe ich **keine schriftliche Einwilligung oder
  Datenschutzinfo für die Ablage in der LMS Box** gefunden. Dokumentiert ist nur die
  Einwilligung, die formativ wegen der Übermittlung braucht (`FIREBASE_MIGRATION_PLAN.md`,
  Router §4).

Für Pietro zu klären (O1):
- Deckt das, was die Lernenden (und die Schule) zur Speicherung ihrer Antworten in der
  LMS Box / im Lernportal wissen oder unterschrieben haben, auch einen **Selbsttest-Verlauf**?
  Wenn es dazu nichts Schriftliches gibt, betrifft das die Entwürfe genauso — dann ist es
  eine Frage der ganzen LMS Box, nicht erst des Kurztests.
- Freiwilligkeit: Der Kurztest funktioniert ohne Anmeldung vollständig. Sichern geschieht
  nur, wenn sich jemand **in der Brückenzeile** anmeldet. Reicht das als Opt-in, oder soll
  die Zeile beim ersten Mal ausdrücklich fragen («Fortschritt in deinem Konto speichern?»)?
- Ohne Lehrerzugriff (Vorschlag §2) dient der Speicher nur der lernenden Person selbst.
  Soll die Lehrperson das je sehen (Klassenübersicht «welche Begriffe sind schwer»), ist das
  ein **anderer Zweck** und gehört in eine Einwilligung — dann besser aggregiert ohne uid.
- Löschfrist: Vorschlag — die Dokumente einer Person werden mit ihrem Konto gelöscht, und
  ein Jahr nach dem letzten `updatedAt` per Skript. Wer das ausführt, ist offen.

## 5. Abgleich localStorage ↔ Firebase — Empfehlung: neuerer Durchgang gewinnt, als Ganzes

`last` und `hard` gehören zusammen: `hard` ist die Liste aus **genau diesem** Durchgang.
Deshalb kein Zusammenführen der Begriffe (Vereinigung würde Begriffe wiederbeleben, die
man auf dem anderen Gerät inzwischen gewusst hat), sondern:

1. **Lokal** bekommt jeder Eintrag ein Feld `acct` (Kontokennzeichen aus §1), wenn die Brücke
   beim Abschluss des Durchgangs «angemeldet» meldete. Ohne Anmeldung: kein `acct`.
2. **Laden:** publish.js zeigt sofort den lokalen Stand (wie heute) und fragt die Brücke.
   Kommt `kurztest-state` mit einem Datensatz:
   - Lokal fehlt, oder lokal gehört zu einem **anderen** `acct` → Firebase gilt; lokal wird
     überschrieben (gemeinsamer Schulrechner: man sieht nicht das Ergebnis der Person davor).
   - Lokal gehört zum selben Konto → der mit dem späteren `last.date` gilt; bei Gleichstand
     Firebase. Ist lokal neuer (offline geübt), wird es hochgeladen.
   - Lokal ohne `acct` (als Gast geübt) → **nicht** ins Konto übernommen, Firebase gilt für
     die Anzeige; der Gast-Eintrag bleibt lokal liegen. Das entspricht der Regel für
     Gast-Antworten im Vertrag («guest text is not taken over into the account»). Siehe O3.
3. **Speichern:** Am Ende eines Durchgangs schreibt publish.js lokal (wie heute) und
   schickt `kurztest-save`. Abgemeldet → nichts. Fehler → kurze Meldung in der Brückenzeile
   («Nicht gesichert — nur in diesem Browser»), kein stilles Scheitern (wie bei Entwürfen).
4. `last.date` ist die Uhr des Geräts. Bei zwei Geräten mit falsch gehender Uhr kann der
   ältere Durchgang gewinnen — für einen Selbsttest hinnehmbar. `updatedAt` (Serverzeit)
   ist nur Protokoll, nicht Vergleichsgrundlage, weil der lokale Eintrag keine Serverzeit kennt.
5. `mode` bleibt lokal.
6. Abmelden in einem LMS-Box-iframe → die Brücke meldet `signedIn: false`; publish.js lässt
   den lokalen Stand stehen, zeigt aber keine Sicherung mehr an.

Nur abgeschlossene Durchgänge werden gespeichert (wie heute lokal). Ein abgebrochener
Durchgang hinterlässt nichts.

## 6. Umsetzung in Schritten (wenn Pietro zustimmt)

1. `CONTRACT.md` ändern (Diff §2) — zuerst, nach CLAUDE.md.
2. Regeln + Regeltests (§3); `npm run test:rules` grün.
3. `kurztest.html` + `js/kurztest.js` + E2E-Test; `npm run test:all` grün.
4. publish.js: Brücken-iframe im `st-quiz-wrap`, Nachrichtenaustausch, Abgleich §5 — weiter
   hinter `?test=begriffe`. publish.js ist ein Vault-Bestandteil, aber nicht in
   `vault/ABUlehrmittel` (sha256-Prüfung in `hko-content/_schutz/` bleibt unberührt).
5. Reihenfolge des Rollouts, damit nie eine Seite gegen fehlende Regeln schreibt:
   **Regeln deployen** (`firebase deploy --only firestore:lmsbox --project interactive-media-2a1fc`,
   Befehl an Pietro) → **Push auf `main`** (liefert `kurztest.html` aus) → publish.js in
   Obsidian Publish hochladen. Umgekehrt: publish.js zuerst zurücknehmen.
   Achtung: Der Rollout «Gastmodus und Lösungen» (16.10.2026) ist noch offen und ändert
   dieselbe Regeldatei — die beiden Deploys nicht vermischen; den Kurztest erst danach.
6. Live prüfen: Chrome, Safari (iPad/iPhone!), Firefox — angemeldet in einem Auftrag,
   dann Kurztest auf einer anderen Einheit derselben Site.

## 7. Offene Fragen an Pietro

| # | Frage | Empfehlung |
|---|---|---|
| O1 | Datenschutz: Deckt die bestehende Grundlage der LMS Box die Ablage des Kurztest-Verlaufs? Gibt es überhaupt eine schriftliche Info/Einwilligung für die Ablage (nicht nur für formativ)? Braucht es ein ausdrückliches Opt-in in der Brückenzeile? Löschfrist? (§4) | Vor dem Einschalten klären. Bis dahin bleibt der Kurztest rein lokal — er ist fertig und braucht Firebase nicht. |
| O2 | Soll die Lehrperson den Verlauf je sehen? | Nein. Falls später gewünscht: neuer Zweck, eigene Einwilligung, besser aggregiert. |
| O3 | Gast-Durchgänge beim Anmelden ins Konto übernehmen? | Nein, wie bei Gast-Antworten (Schulrechner). Alternative: einmalig fragen. |
| O4 | Lernende dürfen ihren Verlauf selbst löschen? | Ja (`delete` eigenes Dokument), z. B. «Verlauf zurücksetzen». |
| O5 | Brückenseite statt Auftrags-iframe? | Ja, eigene `kurztest.html` (§1). |
| O6 | Auch unter `publish.obsidian.md/…` sichern? | Nein, nur `lehrmittel.aburossi.ch`. |
| O7 | Ist «Sichern» den Aufwand wert? Ein Selbsttest mit ≤ 14 Begriffen ist in 2 Minuten neu gemacht; verloren geht nur «Letztes Mal» und die Liste der schwierigen Begriffe. | Ehrlich offen. Der Nutzen ist klein, die Fläche (neue Seite, Regeln, Datenschutzfrage, Safari-Speicherregeln) nicht. Wenn O1 Arbeit macht: erst den lokalen Kurztest für alle einschalten (`AN = true`) und beobachten, ob jemand Geräte wechselt. |

Risiken, die beim Umsetzen zu prüfen sind:
- **Safari** löscht Skriptspeicher von Websites, mit denen man 7 Tage nicht direkt
  interagiert hat; für eingebettete Drittanbieter-iframes ist das noch strenger. Das betrifft
  die Anmeldung in allen LMS-Box-iframes, nicht nur den Kurztest — Firebase wäre gerade hier
  der Gewinn, aber nur, solange die Anmeldung hält. Nicht geprüft.
- Neue Seite im öffentlichen Repo: `kurztest.html` darf nichts enthalten, was nicht schon
  öffentlich ist (Web-Konfiguration ist absichtlich öffentlich, CLAUDE.md).
