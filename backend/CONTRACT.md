# Backend contract — LMS Box on Firebase

Binding for every module in this repo. Plan and rationale: `../docs/FIREBASE_MIGRATION_PLAN.md`.
If the code needs something this file does not allow, change this file first, not the code alone.

## Project

| | |
|---|---|
| Firebase project | `interactive-media-2a1fc` (shared with the Lernportal `allgemeinbildung.web.app`; that app lives in another repo and is **not** changed from here — one exception: the bridge page `/lmsbox-sso` for «Single sign-on» below) |
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
quizDoc       = `${uid}__${enc(unit)}`
mapDoc        = `${uid}__${enc(mapId)}`
```

`assignmentId` is the file name in `content/` without `.json`. `subId` is the key in `subAssignments`, typos included — the vault iframes refer to both verbatim.

`unit` is the Publish page of a unit on lehrmittel.aburossi.ch: `decodeURIComponent(location.pathname.replace(/\+/g, " "))` without the leading `/`, 1–300 characters. publish.js computes it; it is the same page that keys `st-quiz:<pathname>` in localStorage. Renaming a note on Publish starts a new `unit`; the old document stays and is no longer read.

Sub-assignment keys contain dots (`"A. Grundsätze …"`). Documents holding them are written as whole maps with `set()`. No `update()` with string field paths on such keys.

## Collections in `lmsbox`

| Path | Fields | Student | Teacher |
|---|---|---|---|
| `assignments/{assignmentDoc}` | the content JSON unchanged, plus `assignmentId` — with solutions and rubrics | none | read, write |
| `publicAssignments/{assignmentDoc}` | the public copy of the same assignment (see «Public copy») | get, also without sign-in | read |
| `drafts/{draftDoc}` | `uid, classId, assignmentId, subId, title, type, questions[], answers[{questionId, answer}], updatedAt` | read/create/update own only | read all |
| `feedback/{pairDoc}` | `uid, assignmentId`, the evaluator result (`results[]`, `date_str`, …), `released`, `releaseSettings{kurzbericht, ausfuehrlich, punkte, loesung}`, `publishedAt` | none | read, write |
| `feedbackReleased/{pairDoc}` | `uid, assignmentId, results[], date_str, releaseSettings` — already filtered | read own | read, write, delete |
| `formativUsage/{pairDoc}` | `uid, assignmentId, slots` — `slots` is a map keyed `"<subId>::<questionId>"` (`formativ.slotKey`); an entry is `{state, at}` while pending, and when done also `textHash, rubrik_version, request_id, prompt_version, duration_ms, pseudonym, names_masked, gesendet, result{zustand, kriterien[]}`. Written by the function with a precondition `update()` that replaces `slots` whole | none | read |
| `quizProgress/{quizDoc}` | `uid, unit, last{known, total, date}, hard[], updatedAt` — the self-test («Kurztest») at the end of a unit on lehrmittel.aburossi.ch: result of the last complete run (`date` an ISO string from the device clock) and the terms marked «Nochmals» in that run | get/create/update/delete own only | none |
| `mindmapDrafts/{mapDoc}` | `uid, mapId, nodes, updatedAt` — the student's own branches on a mindmap of `allgemeinbildung.github.io/mindmap` (see «Mindmap editor») | get/create/update own only | none |
| `pasteEvents/{pasteDoc}` | `uid, assignmentId, subId, questionId, kind, chars, excerpt, at` — `kind` one of `paste` (a paste got past the block), `drop` (text dragged in), `bulk` (one change inserted ≥ 40 characters), `fast` (≥ 60 characters in under 3 s, faster than typing); `chars` the number of characters inserted; `excerpt` the first 300 of them | create own only | read |

Rules that must hold:

- A student can never read or write another student's `drafts`, and never reads `feedback` or `formativUsage` directly.
- `drafts`: the document id must start with `request.auth.uid + "__"` **and** `uid` in the data must equal `request.auth.uid`. No delete for students.
- `drafts` documents carry no name. Name and class for the dashboard come from the roster join on `uid`.
- `formativUsage` is written only by the function (Admin SDK).
- `pasteEvents`: students create, never read, update or delete — not even their own, so a student cannot erase an entry. Same id and `uid` checks and the same school-account and server-time (`at`) conditions as `drafts`. An entry is a hint for the teacher, not proof: the page decides what it reports, and a student who blocks the request reports nothing.
- `drafts` can be written only by a password sign-in with an address ending in `@lernende.bbw.ch` (or a single-sign-on session made by `boxSsoToken`, see «Single sign-on»), and `updatedAt` must be the server time. Anonymous sessions read nothing. This raises the bar; it does not prove roster membership (rules cannot read the roster in `(default)`). That is why the dashboard looks drafts up by the uids on the class roster and never by the `classId` a draft carries, and why it renders every draft field as text or through `dashboard/modules/sanitize.js`.
- `quizProgress`: the document id must start with `request.auth.uid + "__"` **and** `uid` must equal `request.auth.uid`; written only by a password sign-in with `@lernende.bbw.ch`, `updatedAt` is the server time, `unit` cannot change on update. A student may delete their own document. No `list`: the page reads exactly one document by id. No teacher access — the self-test serves the learner only; a teacher view would be another purpose and needs its own consent (`../docs/KURZTEST_FIREBASE_PLAN.md`).
- `quizProgress` carries no name and no class, and the direction of the test (`mode`) is not stored: it stays in the browser.
- `mindmapDrafts`: the document id must start with `request.auth.uid + "__"` **and** `uid` must equal `request.auth.uid`; written only by a password sign-in with `@lernende.bbw.ch`, `updatedAt` is the server time, `mapId` cannot change on update. No `list`, no delete (an empty map is saved as an empty `add` list). No teacher access for now: a teacher view is a decision of its own (like `quizProgress`).
- `publicAssignments` is written only by `scripts/upload-assignments.mjs` (Admin SDK), in the same batch as `assignments`. Anyone may `get` a document; nobody may `list` the collection or write to it.
- Everything not listed is denied.

## Public copy and guest mode

The student page reads the assignment from `publicAssignments`, signed in or not. The copy is a **whitelist** of the content JSON, made by `scripts/public-assignment.mjs` and nothing else:

```
{ assignmentId, assignmentTitle, formativ?: boolean,
  subAssignments: { [subId]: { type, titel?, formativ?: boolean, questions: [{ id, text, formativ?: boolean }] } } }
```

No `solution`, no `solution_keys`, no rubric, nothing that is not listed. A `formativ` that is an object in the content becomes `true` (the page only needs to know whether to show the button; the rubric stays in `assignments` for the function). A field added to the content later stays private until it is added here.

Without sign-in the page runs as a **guest**:

- The assignment is shown at once; the login dialog opens only when the visitor asks for it, and can be closed again.
- Answers are kept in this browser only, in a separate IndexedDB database `LMS_GuestDB` (never in `LMS_AssignmentsDB`, which belongs to the signed-in account and is emptied on logout or account change). A login neither reads nor clears it. Guest answers are never written to Firestore and never sent anywhere.
- No formativ, no released feedback, no paste hints — guests make no request but the assignment `get`.
- After a sign-in the page reloads and shows that account's drafts; guest text is not taken over into the account.

Limits the rules enforce on `drafts` (security rules have no loops and a 1000-expression budget, so these are fixed small numbers):

- required: `uid, classId, assignmentId, subId, answers, updatedAt`; optional: `title, type, questions`. `assignmentId` and `subId` cannot change on update.
- at most 6 `answers` and 6 `questions` (content has at most 2 per sub-assignment); a question is `{id, text}` only.
- all `answer` strings together at most 200 000 characters. The page must show the student an error when a save is refused, not fail silently.

Limits the rules enforce on `quizProgress`:

- required and only: `uid, unit, last, hard, updatedAt`; `last` is exactly `{known, total, date}`.
- `total` int 1…50, `known` int 0…`total`, `date` an ISO time string (`YYYY-MM-DDT…Z`), at most 40 characters.
- `hard` a list of at most 20 strings of at most 120 characters each, and not longer than `total` (real units have at most 14 terms).

Limits the rules enforce on `mindmapDrafts`:

- required and only: `uid, mapId, nodes, updatedAt`; `mapId` 1–300 characters, `nodes` a string of at most 20 000 characters.
- The rules cannot parse `nodes`; the page treats what it reads as untrusted (see «Mindmap editor»).

`assignments` carries the solutions and rubrics: only a teacher reads it (until 16.10.2026 every non-anonymous sign-in could, self-registered accounts included). Students and guests read `publicAssignments`; the formativ function reads `assignments` with the Admin SDK.

Rolled out 16.10.2026 (live upload → page → rules); the temporary fallback to `assignments` in `js/api.js` is removed.

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

Additive for the self-test: `js/auth.js` also exports `showLoginDialog({ closable })` and `closeLoginDialog()`, used by `js/kurztest.js` only.

## Single sign-on from the Lernportal (`js/sso.js`, callable `boxSsoToken`)

A browser keeps a Firebase session per origin (and, in an iframe, per host page), so a student who is signed in at `bbw.aburossi.ch` is a guest here. Since 23.10.2026 «Mit dem Lernportal anmelden» (banner and login dialog) takes the Lernportal login over, without typing the password again:

1. `js/sso.js` opens a window (`window.open`, from the click) on `https://bbw.aburossi.ch/lmsbox-sso?origin=<own origin>&state=<32 hex>`.
2. That page (**in the Lernportal repo**: `CoSch-sandbox/apps/lms-firebase/src/pages/lmsbox-sso.astro`) checks the Lernportal login; without one it shows a username/password form. Then it calls `boxSsoToken` and posts `{ type: 'lmsbox-sso', state, token }` (or `{ …, state, error: 'forbidden' | 'unavailable' }`) to `window.opener`, only to `origin`, and closes itself.
3. `js/sso.js` accepts the message only if `event.origin` is the Lernportal's origin, `event.source` is the window it opened, and `state` matches; then `signInWithCustomToken`. The auth state changes, `authenticate()` reloads the page as for any sign-in.

- `origin` is checked by the Lernportal page against `https://allgemeinbildung.github.io` (plus `http://localhost:*` / `http://127.0.0.1:*` while the page itself runs locally); the token goes nowhere else. `?portal=` on a local `js/sso.js` names a local stand-in for tests; on the real host it is ignored.
- `boxSsoToken` (no input, output `{ token }`): the caller must be on the roster (`caller()`), signed in with the password provider and an address ending `@lernende.bbw.ch`; teachers and everybody else get `permission-denied`. It returns `createCustomToken(uid, { lmsboxSso: true })` — the same uid as at the Lernportal, so drafts, feedback and the roster join are unchanged. No name, no address leaves it.
- The session's provider is `custom`. `isSchoolAccount()` (both rules files) therefore accepts **either** the password sign-in with the school address **or** `sign_in_provider == 'custom'` with `token.lmsboxSso == true`. Only this function can sign such a token. The client reads `user.email` as before; Auth fills it from the account.
- The function needs the right to sign tokens: its runtime service account must hold `roles/iam.serviceAccountTokenCreator` on itself (once, `gcloud iam service-accounts add-iam-policy-binding`). A new callable also needs `allUsers` as invoker (see CLAUDE.md, «Stolperstellen»). Without either, the window reports `unavailable` and the dialog points to the password form, which stays.
- A popup needs a click: it cannot run silently on page load. A blocked window is reported (`blocked`); a window the student closes says nothing.
- Test: `npm run test:e2e:sso` (stand-in portal on a second origin, real function and rules in the emulators); the real Lernportal page is not run there.

## Self-test bridge (`kurztest.html`, `js/kurztest.js`)

publish.js on `https://lehrmittel.aburossi.ch` embeds `kurztest.html?parent=<its origin>` below the self-test of a unit. The page shows one line (signed out: offer to sign in; signed in: for whom it saves; a failed save says so). It reuses the login of the LMS Box (the iframes of one host site share it) and writes `quizProgress` with Firestore Lite. No roster read.

Messages (`postMessage`, type prefix `kurztest-`):

| Direction | Type | Data |
|---|---|---|
| bridge → page | `kurztest-ready` | `{ signedIn, acct }` |
| page → bridge | `kurztest-load` | `{ unit }` |
| bridge → page | `kurztest-state` | `{ signedIn, acct, unit, record: { last, hard } \| null }` — again after every sign-in or sign-out |
| page → bridge | `kurztest-save` | `{ unit, record: { last, hard } }` |
| bridge → page | `kurztest-saved` | `{ unit, ok, code? }` |

- `signedIn` is true only for a password sign-in with `@lernende.bbw.ch` (what the rules let write). `acct` is the first 12 hex characters of SHA-256(uid), or null; the uid itself never leaves the bridge.
- The bridge accepts `?parent=` only from its list (`https://lehrmittel.aburossi.ch`; any `http://localhost:*` / `http://127.0.0.1:*` origin only while the bridge itself runs on a local host). It handles a message only if `event.source === window.parent` and `event.origin` is that parent, and it posts only to that origin, never to `"*"`.
- publish.js handles a message only if `event.origin === "https://allgemeinbildung.github.io"` **and** `event.source` is its own bridge iframe: other repos on that origin (mindmap, podcasts …) share it.
- Merge in publish.js: a run done while signed in carries `acct` in localStorage. Same account: the run with the later `last.date` wins as a whole (`last` and `hard` together, no union), a newer local run is uploaded. Another account or a guest run: the account's record replaces it; a guest run is never uploaded (like guest answers).

## Progress message (`js/progress.js`)

The student page tells its host page how much was written, so that publish.js («Lernansicht») can tick a section off. `{ type: 'lmsbox-progress', assignmentId, subId, lengths: number[], acct: string | null }`, sent once after the editors are built and again 600 ms after each change.

- `lengths` has one entry per question: the length of the trimmed plain text. Never the text itself, no name, no uid. `acct` is the first 12 hex characters of SHA-256(uid) for a signed-in student, null for a guest (same tag as the self-test bridge), so publish.js drops ticks that belong to another account on a shared computer.
- The page posts only to the host page's own origin (`location.ancestorOrigins[0]`, else the referrer's origin, else `?parent=`), and only if it is `https://lehrmittel.aburossi.ch` or a local `http://localhost:*` / `http://127.0.0.1:*` origin while the page itself runs locally. Never `"*"`. Without such a host page nothing is sent.
- publish.js handles the message only if `event.origin` is `https://allgemeinbildung.github.io` **and** `event.source` is one of the section's own `lms_box` iframes. A section counts as written when every question has at least `MIN_CHARS` (15) characters.
- The height message (`lmsbox-height`, `js/embedHeight.js`) is older and still posts to `"*"`; it carries a number only.

## Mindmap editor (`js/mindmap.js`)

The mindmaps embedded in the vault come from another repo on the same origin: `allgemeinbildung.github.io/mindmap/index.html?mindmap=<mapId>` (`github.com/allgemeinbildung/mindmap`). That page draws `maps/<mapId>.json` (the teacher's skeleton) and, behind a ✏️ button, lets a signed-in student add own branches with the keyboard. It imports `../lms_box/js/mindmap.js` (same origin, so it shares the LMS Box login on the same host page) and never the Firebase SDK directly.

`js/mindmap.js` exports `onAccount(cb)` (`cb({ canSave, email })`, again after every sign-in or sign-out), `loadMap(mapId)` (the parsed `nodes` or null), `saveMap(mapId, data)`, `showLogin()` and `logout()`.

`mapId` is the `mindmap` query parameter verbatim (a step file such as `4.3 Gesundheit und Sucht_2`), or, in unit mode, the `unit` parameter. `nodes` is JSON:

```
{ v: 1, add: [ { at: [text of root, …, text of the teacher node], nodes: [ { t, c: [ … ] } ] } ] }
```

Only the student's branches are stored, each list hung under the teacher node whose path of texts is `at`. Teacher nodes cannot be edited or removed, and a student's nodes come after the teacher's children. A branch whose `at` no longer exists (the skeleton changed) is shown under the root. Client limits: at most 200 own nodes, 120 characters each, depth 6. What is read is checked again before it is drawn: anything that does not fit the shape is dropped, and the text goes into the diagram quoted, never as Mermaid syntax.

**Guests** (nobody signed in, since 21.10.2026): the editor works the same, but the map is kept in this browser only, in `localStorage` under `lmsbox-mindmap-gast:<mapId>` of the mindmap origin (partitioned by the host site). It is never written to Firestore and never sent anywhere, and after a sign-in the page reloads and shows the account's map; the guest map is not taken over (as with guest answers). Frames only take over broadcasts from the same kind of session (`who`: the account's address, or null for a guest). A signed-in account that is not a school account still cannot edit.

Before ✏️ opens the editor, the page reads the document again. After each save it sends the map to the other frames of the same map (`BroadcastChannel('lmsbox-mindmap')`, browser-local), which take it over unless they hold unsaved changes themselves. A save writes the whole map, so this keeps an old copy from overwriting newer branches.

**Unit mode** (`?unit=<id>&skel=<a|b|…>&mode=pad|preview|button&parent=<origin>`), set by publish.js on lehrmittel.aburossi.ch: one map per unit for the whole page. `unit` is the Publish page, defined as `unit` under «Ids» (the same id the self-test uses). The skeleton is the first map in `skel` that exists, cut to the root and its main branches. `pad` is the notepad in a side panel (editor always open), `preview` a read-only picture of the student's map in place of a step map, `button` only a button there (no account, no read). In use since 21.10.2026 (publish.js, all pages under `ABUlehrmittel/`, not the HKO pages): `pad` and, in the callouts, a button «Meine Mindmap öffnen» that publish.js puts into the callout title itself; the step frame is hidden and set to `about:blank`. `preview` and the page's own `button` mode stay available (`?mm=preview` in publish.js). The page posts `{ type: 'mindmap-open' | 'mindmap-close', unit }` to its parent, only to `https://lehrmittel.aburossi.ch` (or a local origin while it runs locally), never to `"*"`; publish.js handles them only from the origin of the mindmap page and from its own frames. Saved maps of the step files stay where they are and are not merged into the unit map.

On `localhost` / `127.0.0.1` it connects to the **emulators** by default. Live data from a local page needs the explicit query parameter `?live=1`. Reason: a local click-through must never write into production.

SDK from `https://www.gstatic.com/firebasejs/<pinned version>/…` as ES modules. No build step, no bundler.

`js/firebase.js` loads **Firestore Lite** (no streaming connections, no `onSnapshot`, no offline queue). Reason: several iframes of the student page on one host page, each with two databases, exhaust the browser's per-host connection limit with the full build, and a frame then waits a minute for its drafts. Do not switch it back without re-running `npm run test:e2e:student`. The teacher dashboard is a single page and may load the full Firestore build in its own module for live listeners.
