# Backend contract — LMS Box on Firebase

Binding for every module in this repo. Plan and rationale: `../docs/FIREBASE_MIGRATION_PLAN.md`.
If the code needs something this file does not allow, change this file first, not the code alone.

## Project

| | |
|---|---|
| Firebase project | `interactive-media-2a1fc` (shared with the Lernportal `allgemeinbildung.web.app`; that app lives in another repo and is **not** changed from here) |
| Auth | Firebase Auth, email/password. Username `vorname.nachname` → `{username}@lernende.bbw.ch`; input containing `@` is used as is. «Passwort vergessen?» only explains the way: the teacher sends a reset link (Lernportal, «Reset-Link», `generatePasswordResetLink`, no mail) or a start password. Firebase's own reset mails do not reach @lernende.bbw.ch (tested 15.10.2026). The first login (start password → own password) stays in the Lernportal |
| Database for this app | named Firestore database **`lmsbox`**, location `europe-west6` (Zurich) |
| Roster (read only) | `(default)` database, `students/{uid}`: `name, username, bbwEmail, classId, classIds[], mustSetPassword, active` — a student may read their own doc, a teacher all |
| Teacher | custom claim `role == "teacher"` on the ID token |
| Functions | codebase `lmsbox`, region `europe-west6` |

Never deploy without a target: `--only firestore:lmsbox` and `--only functions:lmsbox`. An untargeted deploy from this folder must not be able to touch the Lernportal's rules or functions.

## Ids

```
enc(x)        = encodeURIComponent(x)            // assignmentId and subId contain spaces, dots, umlauts
assignmentDoc = enc(assignmentId)
draftDoc      = `${uid}__${enc(assignmentId)}__${enc(subId)}`
pairDoc       = `${uid}__${enc(assignmentId)}`
pasteDoc      = `${uid}__${enc(assignmentId)}__${enc(subId)}__${eventId}`   // eventId: [A-Za-z0-9]{8,40}, made by the page
```

`assignmentId` is the file name in `content/` without `.json`. `subId` is the key in `subAssignments`, typos included — the vault iframes refer to both verbatim.

Sub-assignment keys contain dots (`"A. Grundsätze …"`). Documents holding them are written as whole maps with `set()`. No `update()` with string field paths on such keys.

## Collections in `lmsbox`

| Path | Fields | Student | Teacher |
|---|---|---|---|
| `assignments/{assignmentDoc}` | the content JSON unchanged, plus `assignmentId` | read when signed in | read, write |
| `drafts/{draftDoc}` | `uid, classId, assignmentId, subId, title, type, questions[], answers[{questionId, answer}], updatedAt` | read/create/update own only | read all |
| `feedback/{pairDoc}` | `uid, assignmentId`, the evaluator result (`results[]`, `date_str`, …), `released`, `releaseSettings{kurzbericht, ausfuehrlich, punkte, loesung}`, `publishedAt` | none | read, write |
| `feedbackReleased/{pairDoc}` | `uid, assignmentId, results[], date_str, releaseSettings` — already filtered | read own | read, write, delete |
| `formativUsage/{pairDoc}` | `uid, assignmentId, slots` — `slots` is a map keyed `"<subId>::<questionId>"` (`formativ.slotKey`); an entry is `{state, at}` while pending, and when done also `textHash, rubrik_version, request_id, prompt_version, duration_ms, pseudonym, names_masked, gesendet, result{zustand, kriterien[]}`. Written by the function with a precondition `update()` that replaces `slots` whole | none | read |
| `pasteEvents/{pasteDoc}` | `uid, assignmentId, subId, questionId, kind, chars, excerpt, at` — `kind` one of `paste` (a paste got past the block), `drop` (text dragged in), `bulk` (one change inserted ≥ 40 characters), `fast` (≥ 60 characters in under 3 s, faster than typing); `chars` the number of characters inserted; `excerpt` the first 300 of them | create own only | read |

Rules that must hold:

- A student can never read or write another student's `drafts`, and never reads `feedback` or `formativUsage` directly.
- `drafts`: the document id must start with `request.auth.uid + "__"` **and** `uid` in the data must equal `request.auth.uid`. No delete for students.
- `drafts` documents carry no name. Name and class for the dashboard come from the roster join on `uid`.
- `formativUsage` is written only by the function (Admin SDK).
- `pasteEvents`: students create, never read, update or delete — not even their own, so a student cannot erase an entry. Same id and `uid` checks and the same school-account and server-time (`at`) conditions as `drafts`. An entry is a hint for the teacher, not proof: the page decides what it reports, and a student who blocks the request reports nothing.
- `drafts` can be written only by a password sign-in with an address ending in `@lernende.bbw.ch`, and `updatedAt` must be the server time. Anonymous sessions read nothing. This raises the bar; it does not prove roster membership (rules cannot read the roster in `(default)`). That is why the dashboard looks drafts up by the uids on the class roster and never by the `classId` a draft carries, and why it renders every draft field as text or through `dashboard/modules/sanitize.js`.
- Everything not listed is denied.

Limits the rules enforce on `drafts` (security rules have no loops and a 1000-expression budget, so these are fixed small numbers):

- required: `uid, classId, assignmentId, subId, answers, updatedAt`; optional: `title, type, questions`. `assignmentId` and `subId` cannot change on update.
- at most 6 `answers` and 6 `questions` (content has at most 2 per sub-assignment); a question is `{id, text}` only.
- all `answer` strings together at most 200 000 characters. The page must show the student an error when a save is refused, not fail silently.

Student queries on `drafts` and `feedbackReleased` must carry `where('uid', '==', uid)`.

Emulator-only exception: the Firestore emulator applies one ruleset to every database. So that the roster read works locally, the `lmsbox` rules contain a read-only `students/{uid}` match (own doc or teacher, no writes). In production that collection does not exist in `lmsbox`; the real roster is protected by the Lernportal's rules on `(default)`.

Release filter (moved from the old Cloud Function into the dashboard, which writes `feedbackReleased`): per result keep `question_id, question_text`; `score` unless `punkte === false`; `concise_feedback` unless `kurzbericht === false`; `detailed_feedback` unless `ausfuehrlich === false`, and with the trailing `(Lösung: …)` removed unless `loesung` is true. Un-releasing deletes the `feedbackReleased` doc.

## Callable functions (`europe-west6`)

| Name | Input | Output |
|---|---|---|
| `boxFormativ` | `{ assignmentId, subId, questionId, text }` | `{ status: 'success', result }` as `formativ.requestFeedback` returns; errors as `HttpsError` with `details: { code, result? }` (code table: comment in `functions/index.js`) |
| `boxFormativStatus` | `{ assignmentId }` | `{ slots }` as `formativ.status` returns today |

Both require a signed-in caller whose `students/{uid}` doc exists in `(default)` and is `active !== false`. The rubric and solution are loaded on the server from `assignments`; the client only names the field and sends the text. The model request carries no name and no uid — only the pseudonym.

## Client (`js/firebase.js`)

One module initialises the app and exports `auth`, `db` (database `lmsbox`), `rosterDb` (`(default)`), `functions`. It also exports `app` and `emulator` (`{host, ports}` or null) for `dashboard/modules/firestore.js`. No other module imports the Firebase SDK URLs directly.

Additive for the HKO parallel system (contract: `HKO.md`, "Phase P1 — Vertrag" §7): `js/firebase.js` also exports `namedDb(databaseId)` (a further named database, Firestore Lite, created on first call and cached per id; only `js/hko/api.js` calls it, lms_box pages never do), and `js/auth.js` exports `registerSaver({ flush, hasUnsaved, hasUnsynced, suspend, resume, close })`, which the logout coordination asks in addition to `renderer.js`; with nothing registered the behaviour is unchanged.

On `localhost` / `127.0.0.1` it connects to the **emulators** by default. Live data from a local page needs the explicit query parameter `?live=1`. Reason: a local click-through must never write into production.

SDK from `https://www.gstatic.com/firebasejs/<pinned version>/…` as ES modules. No build step, no bundler.

`js/firebase.js` loads **Firestore Lite** (no streaming connections, no `onSnapshot`, no offline queue). Reason: several iframes of the student page on one host page, each with two databases, exhaust the browser's per-host connection limit with the full build, and a frame then waits a minute for its drafts. Do not switch it back without re-running `npm run test:e2e:student`. The teacher dashboard is a single page and may load the full Firestore build in its own module for live listeners.
