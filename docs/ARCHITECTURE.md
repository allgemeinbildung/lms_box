# LMS Box — System Architecture & Replication Guide

> **Purpose:** This document explains how the full LMS stack works and provides a step-by-step guide to replicate it for a new content area (new subject, new class, new institution).

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture Diagram](#2-architecture-diagram)
3. [Component Breakdown](#3-component-breakdown)
   - [A. Student View (`index.html`)](#a-student-view-indexhtml)
   - [B. Google Cloud Function (`assignmentHandler`)](#b-google-cloud-function-assignmenthandler)
   - [C. Google Cloud Storage (GCS Bucket)](#c-google-cloud-storage-gcs-bucket)
   - [D. Teacher Live View (`dashboard/liveview.html`)](#d-teacher-live-view-dashboardliveviewhtml)
   - [E. Local Evaluator Server (`evaluator/`)](#e-local-evaluator-server-evaluator)
4. [Data Flows (End-to-End)](#4-data-flows-end-to-end)
   - [Flow 1: Student submits answers](#flow-1-student-submits-answers)
   - [Flow 2: Teacher assesses a student](#flow-2-teacher-assesses-a-student)
   - [Flow 3: Teacher releases feedback to student](#flow-3-teacher-releases-feedback-to-student)
   - [Flow 4: Student sees their feedback](#flow-4-student-sees-their-feedback)
5. [Key Data Schemas](#5-key-data-schemas)
   - [Assignment JSON](#assignment-json)
   - [Student Keys JSON](#student-keys-json)
   - [Draft (student answer) payload](#draft-student-answer-payload)
   - [Feedback payload (GCS)](#feedback-payload-gcs)
6. [Replication Guide — New Instance from Zero](#6-replication-guide--new-instance-from-zero)
7. [Configuration Reference](#7-configuration-reference)
8. [File Map](#8-file-map)

---

## 1. System Overview

This is a **dual-interface LMS** built for vocational education (Berufsschule). It has two surfaces:

| Surface | User | URL pattern |
|---|---|---|
| Student assignment | Student (Lernende) | `index.html?assignmentId=X&subId=Y&mode=live` |
| Teacher live monitor | Teacher (Lehrperson) | `dashboard/liveview.html` |

The full loop:

1. **Student** writes answers in a Quill rich-text editor → auto-saved as a draft to Google Cloud Storage (GCS) via a Cloud Function.
2. **Teacher** opens the live view → sees all students' answers in real time (pulled from GCS).
3. **Teacher** triggers LLM assessment for a student → a local Python/Flask server calls the Gemini API → returns scored feedback.
4. **Teacher** selects which feedback components to release (Kurzbericht, Ausführlicher Bericht, Punkte, Lösungsschlüssel) → publishes to GCS via Cloud Function.
5. **Student** reloads their assignment page → sees the published feedback inline below each question.

**Infrastructure stack:**

| Layer | Technology |
|---|---|
| Frontend hosting | Static files (any web server or GitHub Pages) |
| Backend API | Google Cloud Functions (Node.js 20) |
| Storage | Google Cloud Storage (GCS bucket) |
| LLM assessment | Gemini API (via local Python server) |
| Local assessment server | Python 3 / Flask (runs on teacher's machine) |
| Assignment authoring | JSON files in a local/synced folder |

> **Note on "Firebase":** This system uses **Google Cloud Platform (GCP)** only — specifically Cloud Functions and Cloud Storage. There is no Firebase Firestore, Firebase Auth, or Firebase Realtime Database involved.

---

## 2. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        STUDENT BROWSER                              │
│  index.html?assignmentId=X&subId=Y                                  │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  js/app.js → js/renderer.js (Quill editors per question)    │    │
│  │  Auto-save draft (2s debounce) ──────────────────────────┐  │    │
│  │  Load draft on page open ────────────────────────────────┤  │    │
│  │  Load released feedback on page open ────────────────────┤  │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTPS POST
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              GOOGLE CLOUD FUNCTION: assignmentHandler               │
│  europe-west6  /  Node.js 20  /  HTTP trigger (unauthenticated)     │
│                                                                     │
│  Actions (POST body { action, ... }):                               │
│  ├─ authenticateStudent   → validates student key                   │
│  ├─ saveDraft             → writes GCS: drafts/{key}/{assId}.json   │
│  ├─ getDraft              → reads  GCS: drafts/{key}/{assId}.json   │
│  ├─ listDrafts            → lists all drafts (teacher only)         │
│  ├─ saveFeedback          → writes GCS: feedback/{key}/{assId}.json │
│  ├─ getFeedback           → reads feedback if released (student)    │
│  ├─ getFeedbackStatus     → reads release state (teacher only)      │
│  ├─ listSubmissions       → lists final submissions (teacher only)  │
│  ├─ getSubmission         → reads a final submission (teacher only) │
│  ├─ submit                → writes GCS: submissions/...            │
│  └─ verifySolutionKey     → checks if a Musterlösung key is valid   │
│                                                                     │
│  GET ?assignmentId=X → reads GCS: assignments/{assId}.json         │
└───────────────────────────┬─────────────────────────────────────────┘
                            │ GCS SDK
                            ▼
┌─────────────────────────────────────────────────────────────────────┐
│           GOOGLE CLOUD STORAGE BUCKET: allgemeinbildung-lms-data-X  │
│                                                                     │
│  assignments/                                                       │
│    {assignmentId}.json          ← published assignment + solution   │
│                                                                     │
│  drafts/                                                            │
│    {studentKey}/                                                    │
│      {assignmentId}.json        ← live student answers (draft)     │
│                                                                     │
│  feedback/                                                          │
│    {studentKey}/                                                    │
│      {assignmentId}.json        ← released LLM feedback            │
│                                                                     │
│  submissions/                                                       │
│    {org}/{identifier}/                                              │
│      submission-{timestamp}.json ← final submitted answers         │
│                                                                     │
│  student_keys.json              ← live student auth keys           │
│  student_keys_TEST.json         ← test student auth keys           │
│  submission_metadata.json       ← change tracking for submissions  │
└─────────────────────────────────────────────────────────────────────┘
                            ▲
                            │ HTTPS POST (teacher browser)
┌─────────────────────────────────────────────────────────────────────┐
│                     TEACHER BROWSER                                 │
│  dashboard/liveview.html                                            │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │  Select class + assignment → load all student cards         │    │
│  │  ⚡ Feedback button → calls localhost:5000/assess ──────┐   │    │
│  │  Freigeben panel → publishes to GCS via Cloud Function  │   │    │
│  │  Analyse-Export → CSV download                          │   │    │
│  │  🖨️ Print → formatted PDF per student                   │   │    │
│  └─────────────────────────────────────────────────────────────┘    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP POST (localhost only)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│       LOCAL EVALUATOR SERVER  (evaluator/live_server.py)            │
│       Runs on teacher's machine: http://localhost:5000               │
│                                                                     │
│  POST /assess                                                       │
│    → loads solution JSON from local disk                            │
│    → builds prompt → calls Gemini API                               │
│    → saves result to local disk (with history)                      │
│    → returns { history: [...], results: [...] }                     │
│                                                                     │
│  POST /get_feedback                                                 │
│    → reads local disk for existing feedback                         │
│                                                                     │
│  POST /get_master_assignment                                        │
│    → reads local solution JSON for teacher view (model answers)     │
│                                                                     │
│  Local feedback store:                                              │
│    D:\..\.vaults\peteRed\02 Area\U+\_liveview\                      │
│      {Class}\{AssignmentId}\{StudentName}.json                      │
│                                                                     │
│  Solution files:                                                    │
│    D:\...\lms_json\{assignmentTitle}.json                           │
└─────────────────────────────────────────────────────────────────────┘
                           │ HTTPS
                           ▼
                  ┌─────────────────┐
                  │   GEMINI API    │
                  │ gemini-flash-   │
                  │ lite-latest     │
                  └─────────────────┘
```

---

## 3. Component Breakdown

### A. Student View (`index.html`)

**Entry point:** `index.html?assignmentId=X&subId=Y&mode=live`

| URL param | Description |
|---|---|
| `assignmentId` | Matches `assignmentTitle` in the assignment JSON (e.g. `1.4 Der Lehrvertrag`) |
| `subId` | Key of the sub-assignment within `subAssignments` (e.g. `A. Grundlagen und Abschluss`) |
| `mode` | `live` (real submission) or `test` (uses test key file) |

**Authentication flow (`js/auth.js`):**
- On load, checks `localStorage` for a saved key (persists across tabs and sessions).
- If none, shows a login dialog. If another iframe on the same page authenticates first, its `localStorage.setItem` fires a `storage` event that dismisses all other iframes' dialogs automatically — the student only needs to enter their key once.
- Calls `authenticateStudent` on the Cloud Function to validate.
- Returns `{ key, studentInfo: { klasse, name, email } }`.

> **Multi-iframe note:** When multiple `index.html` iframes are embedded on a single parent page (same `assignmentId`, different `subId`), all iframes share `localStorage` (same origin). The first iframe to authenticate stores the key; all others detect it via the `storage` event and skip their dialog.

**Answer saving:**
- Each question gets a Quill rich-text editor (`js/renderer.js`).
- On any change (`source='user'` only, **and** only after editor initialization is complete), saves to **IndexedDB** immediately.
- After 2 seconds of inactivity, pushes a full draft to GCS via `saveDraft`. The draft contains **all** sub-assignments for the `assignmentId` (gathered from IndexedDB), not just the visible one.
- On load, fetches the saved draft from GCS, syncs all sub-assignments into IndexedDB (`syncDraftToStorage`), then pre-fills the editors.

> **`isInitializing` guard:** Setting `quill.root.innerHTML` to load saved content triggers Quill's internal MutationObserver with `source='user'`, which would otherwise fire `gatherAndSaveDraft` on every page load. An `isInitializing` flag blocks all saves until `initializeEditor()` completes.

**Feedback display (`js/studentFeedback.js`):**
- After the assignment renders, calls `getFeedback` on the Cloud Function.
- If `released: true`, injects a colored feedback block directly below each Quill editor.
- Respects `releaseSettings`: only shows the components the teacher enabled (Punkte, Kurzbericht, Ausführlicher Bericht, Lösungsschlüssel).
- If no feedback is released → zero DOM changes (backwards compatible).

---

### B. Google Cloud Function (`assignmentHandler`)

**File:** `google_cloud/index.js`
**Deploy:** run `google_cloud/updatebat.bat`
**Region:** `europe-west6` (Zurich)
**Runtime:** Node.js 20
**Auth:** Unauthenticated HTTP trigger

Authentication is handled **inside** the function:
- **Student calls** require `studentKey` in the POST body. The function validates it against `student_keys.json` (or `_TEST`) in GCS.
- **Teacher calls** require `teacherKey` (hardcoded constant `TEACHER_KEY`).

Key constants to change when replicating:
```js
const BUCKET_NAME = 'allgemeinbildung-lms-data-142';  // ← your bucket
const TEACHER_KEY = 'lehrer2025';                      // ← change this
const TEACHER_SOLUTION_KEY = 'lehrer-master-2025';     // ← for Musterlösung unlock
```

---

### C. Google Cloud Storage (GCS Bucket)

**Bucket:** `allgemeinbildung-lms-data-142`

| Path | Content | Written by | Read by |
|---|---|---|---|
| `assignments/{id}.json` | Assignment + solutions | Manual upload | Cloud Function (GET), teacher view |
| `student_keys.json` | Live student auth keys | Manual | Cloud Function |
| `student_keys_TEST.json` | Test student auth keys | Manual | Cloud Function |
| `drafts/{studentKey}/{assignmentId}.json` | Student's working answers | Cloud Function (saveDraft) | Cloud Function (getDraft), teacher view |
| `feedback/{studentKey}/{assignmentId}.json` | Released LLM feedback | Cloud Function (saveFeedback) | Cloud Function (getFeedback, getFeedbackStatus) |
| `submissions/{org}/{identifier}/submission-{ts}.json` | Final submitted answers | Cloud Function (submit) | Cloud Function (getSubmission) |
| `submission_metadata.json` | Change tracking | Cloud Function | Cloud Function |

---

### D. Teacher Live View (`dashboard/liveview.html`)

**Authentication:** Asks for `teacherKey` on load, stores in `sessionStorage`.

**Main workflow:**
1. Select **Klasse** → fetches `listDrafts` → populates student list.
2. Select **Aufgabe** (assignment) → renders a card per student showing their answers.
3. Each card shows: progress badge (answered/total), word count, last save time.
4. **⚡ Feedback** button → calls `localhost:5000/assess` → displays scored feedback inline.
   - If the student has updated answers since the last feedback, only the **changed questions** are sent to the LLM (selective re-assessment).
   - An orange **"N neu"** badge on the card header indicates how many answers changed. Changed questions are highlighted with an orange left border inside the card.
5. **Freigeben panel** appears after assessment:
   - Checkboxes: Kurzbericht / Ausführlich / Punkte / Lösungsschlüssel
   - **🔓 Freigeben** → saves to GCS via `saveFeedback` (released: true)
   - **🔒 Zurückziehen** → same call with (released: false)
   - Checkboxes auto-save while feedback is already released.
6. **🔄 Aktualisierte** → auto-selects only students whose answers changed since last feedback.
7. **⚡ Auswahl bewerten** → bulk assess selected students; sends only changed questions per student if changes were detected.
8. **📊 Analyse-Export** → CSV with scores per student per question.
9. **🖨️ Drucken** → print-formatted class overview.

**Module structure (`dashboard/modules/`):**

| File | Responsibility |
|---|---|
| `api.js` | All network calls (Cloud Function + localhost:5000) |
| `renderer.js` | Builds student card grid, fetches drafts + feedback; detects changed answers after feedback load |
| `assessment.js` | Triggers LLM assessment, handles bulk mode; filters studentData to changed questions only |
| `feedback.js` | Renders feedback in cards, shows Freigeben panel |
| `printer.js` | Print dialog and PDF generation |
| `exporter.js` | CSV analysis export |
| `auth.js` | Teacher login overlay |
| `state.js` | Shared mutable state (teacherKey, draftsMap) |
| `utils.js` | Markdown parser, `normalizeAnswer()`, `detectUpdatedAnswers()` |

---

### E. Local Evaluator Server (`evaluator/`)

**Location:** `D:\OneDrive - bbw.ch\.work\lms_box\evaluator\`
**Start:** run `start_live_server.bat` → starts Flask on `http://localhost:5000`
**Requires:** `GEMINI_API_KEY` in a `.env` file in the evaluator folder.

**Two modes of operation:**

| Mode | Entry point | Use case |
|---|---|---|
| **Live (via browser)** | `live_server.py` | Teacher clicks ⚡ Feedback in liveview |
| **Batch (CLI)** | `main.py` | Process an entire class folder of JSON submissions at once |

**`live_server.py` endpoints:**

| Endpoint | Input | Action |
|---|---|---|
| `POST /assess` | `{ className, assignmentId, studentName, studentData }` | Calls Gemini, saves result locally with history, returns full payload |
| `POST /get_feedback` | `{ className, assignmentId, studentName }` | Returns saved local feedback JSON |
| `POST /get_master_assignment` | `{ assignmentId }` | Returns the solution JSON for teacher view (model answers) |

**Local feedback storage path:**
```
D:\..\.vaults\peteRed\02 Area\U+\_liveview\
  {ClassName}\
    {AssignmentId}\
      {StudentName}.json      ← contains history of assessments
```
> Change `CLASS_FOLDER` in `live_server.py` to move this.

**LLM prompt logic (`evaluator.py`):**
- Sends `question_text`, `student_answer_text`, and `solution_text` per question.
- Gemini returns `correctness_score` (0–3) + `completeness_score` (0–3) + two feedback strings.
- The `solution_keys` array (from assignment JSON) is appended to `detailed_feedback` as `(Lösung: 1234)`. This can be hidden from students via the Lösungsschlüssel checkbox.

---

## 4. Data Flows (End-to-End)

### Flow 1: Student submits answers

```
Student opens index.html?assignmentId=X&subId=Y
  → js/auth.js: prompt for key → POST assignmentHandler { action: 'authenticateStudent' }
  → Cloud Function validates key against student_keys.json in GCS
  → GET assignmentHandler?assignmentId=X → loads assignment JSON
  → POST assignmentHandler { action: 'getDraft' } → loads saved answers
  → js/renderer.js renders Quill editors, pre-fills with saved answers

Student types...
  → IndexedDB saves immediately
  → After 2s: POST assignmentHandler { action: 'saveDraft', payload: {...} }
  → Cloud Function writes: drafts/{studentKey}/{assignmentId}.json
```

### Flow 2: Teacher assesses a student

```
Teacher opens liveview.html → enters teacherKey
  → POST assignmentHandler { action: 'listDrafts' }
  → For each student: POST assignmentHandler { action: 'getDraft', draftPath: '...' }
  → Student cards rendered with answers

Teacher clicks ⚡ Feedback on a student card
  → If prior feedback exists AND answers have changed since last assessment:
       filterStudentDataToChanges() strips unchanged questions from studentData
  → POST localhost:5000/assess { className, assignmentId, studentName, studentData }
       (studentData contains only changed questions, or all if no prior feedback)
  → live_server.py reads solution file from lms_json/
  → AssignmentEvaluator builds prompt (question + student answer + solution)
  → Gemini API returns JSON assessment array
  → live_server.py appends to local history file, returns full payload
  → feedback.js renders scores + feedback inline in the student card
  → showPublishPanel() appears with Freigeben controls
  → "N neu" badge and orange question highlights are cleared from the card
```

### Flow 3: Teacher releases feedback to student

```
Teacher adjusts checkboxes (Kurzbericht / Ausführlich / Punkte / Lösungsschlüssel)
Teacher clicks 🔓 Freigeben
  → POST assignmentHandler {
       action: 'saveFeedback',
       teacherKey: '...',
       targetStudentKey: '...',
       assignmentId: '...',
       feedbackData: { results: [...], date_str: '...' },
       releaseSettings: { kurzbericht: true, ausfuehrlich: true, punkte: true, loesung: false },
       released: true
     }
  → Cloud Function writes: feedback/{studentKey}/{assignmentId}.json

Teacher changes a checkbox (while already released):
  → Same call fires automatically (auto-save)

Teacher clicks 🔒 Zurückziehen:
  → Same call with released: false
  → Student immediately loses access on next page load
```

### Flow 4: Student sees their feedback

```
Student reloads index.html?assignmentId=X&subId=Y
  → After renderSubAssignment() completes...
  → js/studentFeedback.js: POST assignmentHandler {
       action: 'getFeedback', studentKey: '...', assignmentId: '...'
     }
  → Cloud Function reads feedback/{studentKey}/{assignmentId}.json
  → If released: false → returns { found: false } → zero UI changes
  → If released: true → filters fields by releaseSettings:
       - Strips (Lösung: ...) if loesung: false
       - Omits score if punkte: false
       - Omits concise_feedback if kurzbericht: false
       - Omits detailed_feedback if ausfuehrlich: false
  → Returns filtered results
  → studentFeedback.js injects feedback block below each Quill editor
     (matched by quill-editor-{sanitizedSubId}-{sanitizedQuestionId} ID)
```

---

## 5. Key Data Schemas

### Assignment JSON

Stored in GCS: `assignments/{assignmentId}.json`
Source files: `lms_json/{assignmentTitle}.json`

```json
{
  "assignmentTitle": "1.4 Der Lehrvertrag",
  "solution_keys": ["1284"],
  "subAssignments": {
    "A. Grundlagen und Abschluss": {
      "type": "quill",
      "questions": [
        {
          "id": "q1",
          "text": "Wer sind die **Vertragsparteien** eines Lehrvertrags...?"
        }
      ],
      "solution": {
        "page": "28",
        "solutions": [
          {
            "id": "q1",
            "answer": "<p>Die Vertragsparteien sind...</p>"
          }
        ]
      }
    }
  }
}
```

**Rules:**
- `assignmentTitle` must match the URL `assignmentId` parameter exactly.
- `solution_keys` are the codes students enter to unlock Musterlösung.
- Each `subAssignment` key becomes the `subId` URL parameter.
- `question.id` values must be unique within a sub-assignment.
- Question IDs appear in feedback as `{subId}_{question.id}` (e.g. `A. Grundlagen und Abschluss_q1`).

### Student Keys JSON

`student_keys.json` (in GCS bucket root):

```json
{
  "unique-student-key-abc123": {
    "klasse": "PK25A",
    "name": "Muster Maria",
    "email": "maria.muster@lernende.bbw.ch",
    "legacyIdentifier": null
  }
}
```

- Key is the student's login credential (password). Make it unique and hard to guess.
- `legacyIdentifier` is used for backwards compatibility with the old submission folder structure. Set to `null` for new students.
- `student_keys_TEST.json` has the same structure, used when `mode=test` in the URL.

### Draft (student answer) payload

Written to `drafts/{studentKey}/{assignmentId}.json`:

```json
{
  "assignments": {
    "1.4 Der Lehrvertrag": {
      "A. Grundlagen und Abschluss": {
        "title": "A. Grundlagen und Abschluss",
        "type": "quill",
        "questions": [{ "id": "q1", "text": "..." }],
        "answers": [
          { "questionId": "q1", "answer": "<p>Der Berufsbildner und...</p>" }
        ]
      }
    }
  },
  "createdAt": "2026-03-04T16:08:00.000Z"
}
```

### Feedback payload (GCS)

Written to `feedback/{studentKey}/{assignmentId}.json`:

```json
{
  "results": [
    {
      "question_id": "A. Grundlagen und Abschluss_q1",
      "question_text": "Wer sind die Vertragsparteien...?",
      "score": 2,
      "concise_feedback": "❗ Regelung für Minderjährige fehlt.",
      "detailed_feedback": "Sie haben die Vertragsparteien korrekt genannt..."
    }
  ],
  "date_str": "04.03.2026 17:08",
  "released": true,
  "releaseSettings": {
    "kurzbericht": true,
    "ausfuehrlich": true,
    "punkte": true,
    "loesung": false
  },
  "publishedAt": "2026-03-04T17:08:42.000Z"
}
```

---

## 6. Replication Guide — New Instance from Zero

### Step 1: Google Cloud Project

1. Go to [console.cloud.google.com](https://console.cloud.google.com) → create a new project (or reuse existing).
2. Enable **Cloud Functions API** and **Cloud Storage API**.
3. Create a **GCS bucket** (e.g. `my-new-lms-data`). Set to private. Region: `europe-west6` or closest.

### Step 2: Upload static assets to GCS

Upload to the bucket root:
- `student_keys.json` — your student roster (see schema above)
- `student_keys_TEST.json` — a test version with dummy students

### Step 3: Create assignment JSON files

For each chapter/unit, create a JSON file following the [Assignment JSON schema](#assignment-json):
- File name = `assignmentTitle` value (e.g. `1.1 Schule und Betrieb.json`)
- Include questions, model solutions, and `solution_keys`
- Upload to GCS: `assignments/1.1 Schule und Betrieb.json`

> **Tip:** The `subAssignment` key becomes the `subId` in student URLs. Keep it human-readable — it's also shown to students.

### Step 4: Deploy the Cloud Function

1. Clone/copy the `google_cloud/` folder.
2. Edit `index.js`:
   - Change `BUCKET_NAME` to your new bucket name
   - Change `TEACHER_KEY` to a new secure password
   - Change `TEACHER_SOLUTION_KEY` to a new secure password
3. Edit `updatebat.bat`:
   - Change `--project=` to your GCP project ID
   - Change `--region=` if needed
4. Run `updatebat.bat` from the `google_cloud/` folder.
5. Copy the deployed function URL → update `js/config.js`:
   ```js
   export const SCRIPT_URL = 'https://YOUR-REGION-YOUR-PROJECT.cloudfunctions.net/assignmentHandler';
   ```

### Step 5: Set up the local evaluator

1. Copy the `evaluator/` folder to the teacher's machine.
2. Install dependencies:
   ```bash
   pip install flask flask-cors python-dotenv google-generativeai pandas openpyxl xlsxwriter markdown
   ```
3. Create `.env` in the evaluator folder:
   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   ```
4. Edit `config.py`:
   - Set `SOLUTION_FOLDER` to the local path where your assignment JSON files are stored (same files uploaded to GCS)
5. Edit `live_server.py`:
   - Set `CLASS_FOLDER` to a local path where local feedback history will be stored
6. Run: `start_live_server.bat` (or `python live_server.py`)

> The evaluator server must be running on the teacher's machine during live assessment sessions. Students never connect to it.

### Step 6: Deploy the frontend

The `lms_box/` folder is pure static HTML/JS — no build step required.

- Host on any static server: GitHub Pages, a school web server, or even locally via VS Code Live Server.
- Students access: `https://yourhost/index.html?assignmentId=1.1 Schule und Betrieb&subId=A. Die drei Lernorte und ihre Aufgaben&mode=live`
- Teacher accesses: `https://yourhost/dashboard/liveview.html`

> **URL encoding:** Spaces in `assignmentId` and `subId` are automatically encoded by the browser. The Cloud Function decodes them.

### Step 7: Generate student keys and share URLs

1. For each student, generate a unique key string (e.g. `pk25a-maria-muster-3920481`).
2. Add to `student_keys.json` with their class, name, and email.
3. Upload the updated `student_keys.json` to GCS.
4. Share the assignment URL with each student — the URL does **not** contain the key. Students enter it on first load.

> **Security note:** The key is the only authentication. Do not make keys guessable. Do not publish `student_keys.json` publicly.

### Step 8: Teacher login

Share the `TEACHER_KEY` value (from `index.js`) with the teacher. They enter it once in the live view login screen — it's stored in `sessionStorage` (browser tab lifetime only).

---

## 7. Configuration Reference

### `google_cloud/index.js` — Cloud Function

| Constant | Default | Description |
|---|---|---|
| `BUCKET_NAME` | `allgemeinbildung-lms-data-142` | GCS bucket name |
| `TEACHER_KEY` | `lehrer2025` | Teacher password for live view |
| `TEACHER_SOLUTION_KEY` | `lehrer-master-2025` | Unlocks all Musterlösungen without student code |
| `ASSIGNMENTS_FOLDER` | `assignments` | GCS prefix for assignment files |
| `DRAFTS_FOLDER` | `drafts` | GCS prefix for student drafts |
| `FEEDBACK_FOLDER` | `feedback` | GCS prefix for released feedback |
| `SUBMISSIONS_FOLDER` | `submissions` | GCS prefix for final submissions |
| `STUDENT_KEYS_FILE_LIVE` | `student_keys.json` | Auth keys file for live mode |
| `STUDENT_KEYS_FILE_TEST` | `student_keys_TEST.json` | Auth keys file for test mode |

### `evaluator/config.py` — Local evaluator

| Variable | Default | Description |
|---|---|---|
| `SOLUTION_FOLDER` | `D:\...\lms_json` | Path to assignment JSON files |
| `MODEL_CHOICE` | `gemini-flash-lite-latest` | Gemini model |
| `MODEL_TEMPERATURE` | `0.4` | LLM temperature (0 = deterministic) |
| `MAX_CONCURRENT_WORKERS` | `5` | Parallel students in batch mode |

### `evaluator/live_server.py`

| Variable | Default | Description |
|---|---|---|
| `CLASS_FOLDER` | `D:\...\liveview` | Root folder for local feedback history |

### `js/config.js` — Frontend

| Variable | Description |
|---|---|
| `SCRIPT_URL` | Full URL of the deployed Cloud Function |

---

## 8. File Map

```
lms_box/                          ← frontend root (static)
├── index.html                    ← student assignment view
├── css/
│   └── styles.css
├── js/
│   ├── app.js                    ← student entry point
│   ├── auth.js                   ← student authentication
│   ├── renderer.js               ← Quill editor rendering + draft save
│   ├── studentFeedback.js        ← fetches + renders released feedback
│   ├── submission.js             ← final answer submission
│   ├── printer.js                ← student PDF print
│   ├── storage.js                ← IndexedDB wrapper
│   └── config.js                 ← SCRIPT_URL (not in git)
└── dashboard/
    ├── liveview.html             ← teacher live monitor
    ├── teacher.css
    ├── liveview.js               ← teacher app entry point
    └── modules/
        ├── api.js                ← all network calls
        ├── renderer.js           ← student card grid
        ├── assessment.js         ← LLM assessment trigger + bulk mode
        ├── feedback.js           ← feedback display + Freigeben panel
        ├── printer.js            ← print dialog + PDF generation
        ├── exporter.js           ← CSV analysis export
        ├── auth.js               ← teacher login overlay
        ├── state.js              ← shared state
        └── utils.js              ← markdown parser, helpers

google_cloud/                     ← Cloud Function source (deploy separately)
├── index.js                      ← assignmentHandler function
├── package.json
├── student_keys.json             ← live keys (NOT in git if public)
├── student_keys_TEST.json        ← test keys
└── updatebat.bat                 ← deploy script

evaluator/  (D:\...\evaluator\)   ← local Python server (teacher machine only)
├── live_server.py                ← Flask server (localhost:5000)
├── main.py                       ← batch assessment CLI
├── evaluator.py                  ← Gemini API + prompt logic
├── reporting.py                  ← Excel + HTML report generation
├── config.py                     ← paths + model settings
├── utils.py                      ← file helpers
├── start_live_server.bat         ← start the Flask server
└── .env                          ← GEMINI_API_KEY (never commit)

lms_json/   (D:\...\lms_json\)    ← assignment source files (also upload to GCS)
├── 1.1 Schule und Betrieb.json
├── 1.2 Grundlagen der BWL.json
└── ...
```

---

*Generated: 2026-03-04 — Reflects the state of the system after the student feedback release feature was added.*
*Updated: 2026-03-17 — Added selective re-assessment: changed-answer detection, "Aktualisierte" selection button, per-question filtering before LLM calls.*
*Updated: 2026-03-17 — Fixed multi-iframe data loss: `isInitializing` guard in renderer.js prevents Quill MutationObserver from triggering cloud saves on page load; `storage` event listener in auth.js ensures single login dialog across all same-page iframes.*
