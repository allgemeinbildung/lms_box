# LMS Box → Firebase-only: Migration Plan

Stand: 2026-10-13 · Status: **Phases 1–4 built and passing on the local emulators (uncommitted, branch `firebase`). Database `lmsbox` exists in europe-west6, empty. Nothing deployed. Phase 0 was replaced by a local third-party-iframe test. Phase 5 not started.** · Supersedes `V2_MIGRATION_PLAN.md` (Cloud Run / multi-school are dropped).

## Goal

The student page stays on GitHub Pages with the same layout and the same iframe URLs. Everything behind it moves into the Firebase project of the Lernportal (`interactive-media-2a1fc`):

- Login = Lernportal account (`vorname.nachname` + password). No student keys, no second registration.
- Answers, feedback and formativ usage live in Firestore. The bucket `allgemeinbildung-lms-data-142` and the Cloud Function `assignmentHandler` (project `keen-surfer-465508-f2`) are shut down.
- Clean start: no old drafts are migrated.

Unchanged: vault iframes, `content/*.json` format, Quill editor, local Gemini evaluator on `localhost:5000`, liveview layout.

## Decisions needed before building

| # | Question | Recommendation |
|---|---|---|
| D1 | **Where does the data live?** The default Firestore database of the project is in `nam5` (USA). Today's bucket and function are in Zurich. | Create a second, named database `box` in `europe-west6`. Same project, same login. It also removes every name collision with the Lernportal collections. |
| D2 | Where are rules and functions versioned? `functions/` is unversioned today. | Move them into this repo under `backend/` (rules are not secret; secrets go into function config). Deploy from here with its own `firebase.json` and a functions codebase `box`, so the Lernportal repo is not touched. |
| D3 | Solutions are sent to the browser and unlocked by a code checked in the browser (as today, but today even without login). | Keep for now, behind login. Tightening is a separate job. |
| D4 | Old `dashboard/teacher.html`. | Delete. |
| D5 | First login / forgotten password. | Link to `allgemeinbildung.web.app/login`; do not rebuild it here. |

> **Decided 2026-10-13:** D1–D5 as recommended. The database is named **`lmsbox`**, not `box` — Firestore database ids need at least four characters. Wherever this plan says `box` as a database or codebase name, read `lmsbox`. The binding spec is `../backend/CONTRACT.md`.

## Data model (database `lmsbox`)

| Collection / doc id | Content | Student | Teacher |
|---|---|---|---|
| `assignments/{assignmentId}` | today's JSON, unchanged (largest is 22 KB) | read when signed in | read, write |
| `drafts/{uid}__{assignmentId}__{subId}` | `uid, classId, assignmentId, subId, title, type, questions, answers[], updatedAt` | own only | read all |
| `feedback/{uid}__{assignmentId}` | full Gemini result + `released`, `releaseSettings` | none | read, write |
| `feedbackReleased/{uid}__{assignmentId}` | the filtered copy the student may see | read own | write |
| `formativUsage/{uid}__{assignmentId}` | slots, sent text, results | none (via function) | read |

Notes:
- One draft document **per sub-assignment** instead of one per assignment: no overwrite workaround, and no 1 MiB limit problem from one long assignment.
- Document ids are built with `encodeURIComponent` on `assignmentId`/`subId` (spaces, dots, `‒`, umlauts).
- Sub-assignment keys contain dots (`"A. Grundsätze …"`). Write whole maps with `set()`; never address them with dotted `update()` paths.
- Name and class are **not** copied: the dashboard joins `drafts.uid` with `students/{uid}` in the default database. `classId` on the draft is only a query filter.
- The release filter (`punkte / kurzbericht / ausfuehrlich / loesung`) moves from the Cloud Function into the dashboard, which writes `feedbackReleased`. Security rules cannot hide single fields.

## Phases

Each phase ends with a check that must pass before the next one starts.

### Phase 0 — Spike (½ day)
1. Create database `box` (D1); minimal rules.
2. One throw-away page on GitHub Pages: sign in with a test account, write and read one document.
3. Open it inside an Obsidian Publish page with **three** iframes.

Check: login works from `allgemeinbildung.github.io` inside the Publish iframe; the other two iframes pick up the login without their own dialog; reload keeps the session. Also confirms the web API key has no referrer restriction that blocks GitHub Pages. If the iframes do not share the login, stop and rethink before Phase 2.

### Phase 1 — Backend foundation (1 day)
1. `backend/firestore.box.rules` for the table above; rules tests against the emulator (student A cannot read B; student cannot read `feedback`; non-teacher cannot write `assignments`).
2. `backend/scripts/upload-assignments.mjs`: `content/*.json` → `assignments`. Skips OneDrive conflict copies (`-LYOBBW291`, ` - Kopie`). Replaces `content/sync*.bat`.
3. Consistency check script: every `assignmentId`/`subId` used by a vault iframe exists in `content/`.

Check: rules tests green; 65 assignments uploaded; iframe check lists zero missing ids (or a list to fix).

### Phase 2 — Student page (1 day)
1. `js/firebase.js` (new): init, SDK from CDN with pinned version. Web config goes into `js/config.js`.
2. `js/auth.js`: username + password dialog, links from D5, hint when `mustSetPassword` is set, small logout link.
3. `js/api.js`: same exported function names, Firestore inside. `mode` and `studentKey` parameters disappear; callers are adjusted (`app.js`, `renderer.js`, `printer.js`, `studentFeedback.js`, `formativ.js`).
4. `renderer.js`: save only the visible sub-assignment. Keep the `isInitializing` guard.
5. IndexedDB cache: clear it on logout and when a different uid signs in (today it is shared by everyone on the same browser).
6. Remove `submission.js`, the `submit` action and `legacyIdentifier` after confirming nothing calls them.
7. Local development against the Firebase emulator (replaces `dev-server.mjs` and `mode=test`).

Check, with a test account in the real project: type → reload → text is back; second browser shows the same text; second account sees nothing of the first; an oversized paste shows an error instead of failing silently.

### Phase 3 — Liveview dashboard (1½ days)
1. `dashboard/modules/auth.js`: Firebase login, access only with claim `role: teacher`.
2. `dashboard/modules/api.js`: roster from `students`, drafts by `classId` as live listener, feedback read/write, release writes `feedbackReleased`. Return the shapes the renderer already expects so `renderer.js`, `feedback.js`, `bulkFreigabe.js`, `exporter.js` change as little as possible.
3. `dashboard/modules/formativ.js`: read `formativUsage` directly.
4. Evaluator: no code change expected; verify the folder layout under `.secrets/liveview/` still gets class and name.
5. Delete `teacher.html`, `teacher.js` (D4). `teacher.css` stays: `liveview.html` uses it.

Check: test class end to end — student writes, appears live, Gemini assessment runs, feedback is released with two different release settings, student page shows exactly the released parts.

### Phase 4 — formativ (1 day)
1. `backend/functions`: callable functions `boxFormativ` and `boxFormativStatus` in `europe-west6`, codebase `box`.
2. Reuse `formativ.js`; add a `firestoreStore` next to `gcsStore` (same read/write-with-precondition contract). Pseudonym is derived from the uid; own-name masking uses the name from the token.
3. `FORMATIV_URL`, `FORMATIV_ORIGIN`, `FORMATIV_PSEUDONYM_SECRET` as function secrets.
4. Extend `test/formativ.test.js` to run against both stores.

Check: unit tests green; one field gets feedback exactly once; second request is refused; teacher sees the entry. 49 of 65 assignments have `formativ: true`, so this must be done **before** cutover.

Standing condition, unchanged by this migration: formativ sends student text to a model, so live use needs the written consent described in the OS router §4.

### Phase 5 — Cutover and cleanup (½ day)
1. Merge the branch to `main` (GitHub Pages deploys). From this moment the old keys no longer work.
2. Smoke test on the live vault with a real class account.
3. Tell the classes: login is the Lernportal login.
4. Update `CLAUDE.md` (root) and `ARCHITECTURE.md`.
5. After one quiet week: delete Cloud Function and bucket. The snapshot `.secrets/cloud-snapshot-2026-09-28/` stays as the archive. **Deletion is done by Pietro, not by a script.**

## Order and effort

Phases 0 → 1 → 2 → 3 → 4 → 5, about 5½ days. Work happens on a branch `firebase`; `main` and the current system stay untouched until Phase 5.

## Risks

| Risk | Caught in |
|---|---|
| Browser storage partitioning breaks shared login across iframes | Phase 0 |
| API key or auth settings reject the GitHub Pages origin | Phase 0 |
| Pasted images push a draft over 1 MiB | Phase 2 check |
| Dotted sub-assignment keys corrupt a document through a dotted update path | Phase 1 rules/tests, Phase 2 |
| Deploying from this repo overwrites Lernportal rules or functions | D2: separate database target and codebase; always deploy with `--only` |
| Student changes `classId` on their own draft | harmless: the dashboard joins by uid; note only |
