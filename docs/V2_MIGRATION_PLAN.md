# LMS Box V2 — Migration Plan

> **Builds on:** [`ARCHITECTURE.md`](./ARCHITECTURE.md) — read that first.
>
> **Purpose:** This document is the development plan to migrate LMS Box from its current single-school prototype to a multi-school, multi-layout platform for the next school year. It defines the target architecture, what changes and what stays, how the 5 structural improvements map to concrete work, and the phased migration path.

---

## Table of Contents

1. [V2 Goals and Non-Goals](#1-v2-goals-and-non-goals)
2. [What Does Not Change](#2-what-does-not-change)
3. [The 5 Structural Changes](#3-the-5-structural-changes)
   - [Change 1 — Firebase Authentication replaces student keys](#change-1--firebase-authentication-replaces-student-keys)
   - [Change 2 — Firestore replaces flat GCS files](#change-2--firestore-replaces-flat-gcs-files)
   - [Change 3 — Cloud Run / Express replaces the monolithic Cloud Function](#change-3--cloud-run--express-replaces-the-monolithic-cloud-function)
   - [Change 4 — Centralized frontend API client](#change-4--centralized-frontend-api-client)
   - [Change 5 — Canonical assignment schema](#change-5--canonical-assignment-schema)
4. [Multi-School Data Model](#4-multi-school-data-model)
5. [Multi-Layout Frontend Architecture](#5-multi-layout-frontend-architecture)
6. [V2 Architecture Diagram](#6-v2-architecture-diagram)
7. [V2 File Map (Target State)](#7-v2-file-map-target-state)
8. [Migration Phases](#8-migration-phases)
9. [What V2 Enables Next (Backlog)](#9-what-v2-enables-next-backlog)

---

## 1. V2 Goals and Non-Goals

### Goals

| Goal | Rationale |
|---|---|
| One backend serving all 3 schools | Avoid maintaining 3 separate Cloud Functions and buckets |
| Proper student identity (login, not shared key) | Required for multi-teacher, analytics, and iterative workflows |
| Queryable data store | Required for reporting, cross-assignment analytics, multi-teacher management |
| Multiple layout types per assignment | Notebook-style, branching, and future layouts alongside the existing Quill form |
| Solo-developer maintainability | Clean module boundaries, no repeated logic, easy to onboard a new subject area |
| Iterative student workflow | Students can re-submit after feedback; self-paced progression is possible |

### Non-Goals for V2

| Out of scope | Reason |
|---|---|
| New layout implementations | V2 defines the *structure*; individual layouts are built on top afterward |
| Mobile-native app | Static HTML/JS is sufficient for the classroom use case |
| Real-time collaboration | Not required; auto-save polling is adequate |
| Replacing the local evaluator server | The Flask/Gemini loop works well; V2 wraps it more cleanly, not replaces it |
| Migrating existing student draft data | V1 data stays in GCS; only new-year classes start in V2 |

---

## 2. What Does Not Change

The following parts of V1 are **kept as-is** in V2. Do not refactor them unless explicitly planned.

| Component | What stays the same |
|---|---|
| **Quill.js editors** | The student answer input mechanism is unchanged |
| **Assignment JSON structure** | The format is stabilized (see Change 5 for schema formalization) |
| **Local evaluator server** | `evaluator/live_server.py`, `evaluator.py`, Gemini prompt logic — core unchanged; `POST /update_feedback` added for manual teacher corrections |
| **Teacher live view UX** | The student card grid, ⚡ Feedback button, Freigeben panel — same UI; inline editing controls (✔️ OK, ↩️ Undo, ✏️) added per feedback slot |
| **Feedback release logic** | The 4-checkbox release model (Kurzbericht/Ausführlich/Punkte/Lösungsschlüssel) is kept |
| **Auto-save draft behavior** | IndexedDB + 2s debounce + GCS write is preserved |
| **Print and export** | PDF print, CSV export — unchanged |
| **GCS for assignment files** | `assignments/{id}.json` stays in GCS (read-heavy, infrequently updated) |
| **Static frontend hosting** | No build step, no framework; plain HTML/JS modules |

---

## 3. The 5 Structural Changes

---

### Change 1 — Firebase Authentication replaces student keys

#### V1 problem

Students log in with a shared string from `student_keys.json` stored in GCS. There is no concept of a verified identity. The teacher key is a hardcoded constant. Both are stored in `sessionStorage` (browser tab only).

This blocks:
- Multi-school (no way to know which school a user belongs to without a real identity)
- Multi-teacher (no way to scope a teacher's access to their own classes)
- Iterative workflows (no reliable way to track a specific student across sessions without a verified UID)

#### V2 solution: Firebase Authentication

Firebase Auth is the identity layer. It runs on the same GCP project as the Cloud Function and Firestore — no new vendor.

**Student login:**
- Email + password (school-issued credentials per student per school)
- Or: Google SSO if schools use Google Workspace (most vocational schools in CH do)
- Auth UID (`uid`) is the single identity anchor used everywhere (Firestore docs, draft paths, feedback paths)

**Teacher login:**
- Same Firebase Auth; teachers are distinguished by a Firestore `users/{uid}` document with `role: 'teacher'` and a `schoolIds: [...]` array
- Replaces the hardcoded `TEACHER_KEY` constant

**Impact on existing flows:**

| V1 flow | V2 equivalent |
|---|---|
| Student enters key string | Student signs in with email/password via Firebase Auth SDK |
| `POST authenticateStudent { studentKey }` | Firebase ID token sent in `Authorization: Bearer` header on every request |
| `TEACHER_KEY` check in Cloud Function | Middleware verifies token + checks Firestore role |
| `localStorage` key (shared across same-origin iframes) | Firebase Auth SDK manages token and session natively — no per-iframe dialog |

> **V1 known issue this resolves:** In V1, when multiple `index.html` iframes are embedded on the same parent page (same `assignmentId`, different `subId`), all iframes check `localStorage` simultaneously on load before any of them has stored a key. This caused every iframe to show its own login dialog. A `storage` event listener was added as a V1 hotfix so that when one iframe authenticates, the others auto-dismiss their dialogs. Firebase Auth in V2 eliminates this entirely — the SDK's auth state is shared across all same-origin contexts natively.

**Files affected:**
- `js/auth.js` — replaced with Firebase Auth SDK calls
- `google_cloud/index.js` (→ V2: `backend/middleware/auth.js`) — hardcoded key check replaced by `admin.auth().verifyIdToken(token)`
- `dashboard/modules/auth.js` — same replacement
- `js/config.js` — add Firebase config object alongside `SCRIPT_URL`

**New dependency:**
```
firebase (JS SDK v10+) — loaded as ES module
firebase-admin (Node.js) — for backend token verification
```

> **School isolation:** Each school has a separate Firebase Auth **tenant** (using Firebase Identity Platform multi-tenancy), OR a simpler approach: a `schoolId` claim added to the token via a Cloud Function–triggered custom claim on user creation. The simpler approach is recommended for solo maintenance.

---

### Change 2 — Firestore replaces flat GCS files

#### V1 problem

Student drafts, feedback, and submissions are stored as flat JSON blobs in GCS:
```
drafts/{studentKey}/{assignmentId}.json
feedback/{studentKey}/{assignmentId}.json
submissions/{org}/{identifier}/submission-{ts}.json
```

This means:
- No way to query "all students in class X who submitted assignment Y"
- No cross-student analytics without reading every file
- No multi-teacher scoping without restructuring the folder paths
- History (versioning) is handled by a nested `history` array inside the JSON — not scalable

#### V2 solution: Firestore as primary data store

Firestore is the right fit: it is native to GCP, free-tier generous, supports real-time listeners (for future use), and has a natural document hierarchy that maps to the school/teacher/class/student/assignment structure.

**GCS still stores:** Assignment JSON files (`assignments/`) — these are read-heavy, structured, and infrequently updated. No change there.

**Firestore stores:** All dynamic, per-user, per-assignment data.

**V2 Firestore collection structure:**

```
/schools/{schoolId}/
  name: "BBW Zürich"
  domain: "bbw.ch"

/users/{uid}/
  name: "Maria Muster"
  email: "maria@bbw.ch"
  role: "student" | "teacher"
  schoolId: "bbw"
  klasse: "PK25A"               ← for students only
  managedClassIds: [...]         ← for teachers only

/assignments/{assignmentId}/    ← mirrors GCS, cached here for queries
  title: "1.4 Der Lehrvertrag"
  schoolId: "bbw"               ← which school this belongs to
  subAssignments: { ... }       ← full assignment JSON

/drafts/{uid}_{assignmentId}/   ← one doc per student per assignment
  uid: "abc123"
  assignmentId: "1.4 Der Lehrvertrag"
  schoolId: "bbw"
  updatedAt: Timestamp
  subAssignments: { ... }       ← answers keyed by subId

/feedback/{uid}_{assignmentId}/
  uid: "abc123"
  assignmentId: "..."
  released: true
  releaseSettings: { ... }
  publishedAt: Timestamp
  history: [                    ← array of assessment snapshots
    { results: [...], date_str: "...", assessedAt: Timestamp }
  ]

/submissions/{uid}_{assignmentId}_{timestamp}/
  uid: "abc123"
  assignmentId: "..."
  submittedAt: Timestamp
  answers: { ... }
```

**Impact on existing flows:**

| V1 action | V2 Firestore equivalent |
|---|---|
| `saveDraft` → write GCS blob | `db.doc('drafts/{uid}_{assId}').set(data, { merge: true })` |
| `getDraft` → read GCS blob | `db.doc('drafts/{uid}_{assId}').get()` |
| `listDrafts` → list GCS folder | `db.collection('drafts').where('schoolId','==','bbw').where('klasse','==','PK25A').get()` |
| `saveFeedback` → write GCS blob | `db.doc('feedback/{uid}_{assId}').set(...)` |
| `getFeedback` → read GCS blob | `db.doc('feedback/{uid}_{assId}').get()` |
| `student_keys.json` | Replaced entirely by Firestore `/users/` collection |

**Files affected:**
- `google_cloud/index.js` (→ V2 backend routes) — all GCS read/write for drafts/feedback/submissions replaced by Firestore SDK
- `dashboard/modules/api.js` — API call shapes stay the same (frontend is unaware of the storage swap)

---

### Change 3 — Cloud Run / Express replaces the monolithic Cloud Function

#### V1 problem

`google_cloud/index.js` is a single HTTP Cloud Function containing all logic in one `switch(action)` block — approximately 300+ lines and growing. Every new feature appends another case. There is no separation of concerns, no testability, and no way to reuse logic across projects.

#### V2 solution: Express.js on Cloud Run

Cloud Run is GCP's container-based serverless runtime. It supports Express.js directly, scales to zero like Cloud Functions, and costs the same for this workload. The migration is a container wrapper around an Express app.

**V2 backend structure:**

```
backend/
├── index.js                  ← Express app entry point
├── Dockerfile                ← Cloud Run container
├── middleware/
│   ├── auth.js               ← Firebase token verification
│   └── cors.js               ← CORS config
├── routes/
│   ├── assignments.js        ← GET assignment, list assignments
│   ├── drafts.js             ← saveDraft, getDraft, listDrafts
│   ├── feedback.js           ← saveFeedback, getFeedback, getFeedbackStatus
│   ├── submissions.js        ← submit, getSubmission, listSubmissions
│   └── users.js              ← authenticateStudent, user management
├── services/
│   ├── firestore.js          ← Firestore read/write helpers
│   ├── gcs.js                ← GCS read helpers (for assignment files)
│   └── auth.js               ← Firebase Admin SDK setup
└── config.js                 ← env var references (no hardcoded keys)
```

**Routing convention:**

```
POST /api/drafts/save
POST /api/drafts/get
POST /api/drafts/list
POST /api/feedback/save
POST /api/feedback/get
POST /api/feedback/status
POST /api/submissions/submit
GET  /api/assignments/:id
```

> **Backwards compatibility during migration:** The existing `?action=...` pattern can be preserved temporarily via an adapter route in `index.js` that maps old action names to new route handlers. This allows the frontend to be migrated independently.

**Key differences from V1:**

| V1 Cloud Function | V2 Cloud Run / Express |
|---|---|
| Single file, one switch block | Route handlers in separate files |
| Hardcoded `TEACHER_KEY` | Auth via Firebase ID token + Firestore role |
| Deployed via `gcloud functions deploy` | Deployed via `gcloud run deploy` (Docker image) |
| No environment separation | `process.env.NODE_ENV` controls behavior; `.env.production` / `.env.staging` |
| No tests possible | Each route handler is a plain function — unit testable |

**Deploy:**
```bash
# build and deploy
gcloud run deploy lms-backend \
  --source . \
  --region europe-west6 \
  --allow-unauthenticated
```

**Environment variables (replacing hardcoded constants):**

| V1 constant | V2 env variable |
|---|---|
| `BUCKET_NAME` | `GCS_BUCKET_NAME` |
| `TEACHER_KEY` | *(removed — auth handled by Firebase)* |
| `TEACHER_SOLUTION_KEY` | `SOLUTION_UNLOCK_KEY` |
| *(implicit)* | `FIREBASE_PROJECT_ID` |
| *(implicit)* | `GOOGLE_APPLICATION_CREDENTIALS` |

---

### Change 4 — Centralized frontend API client

#### V1 problem

`fetch()` calls are distributed across `js/app.js`, `js/studentFeedback.js`, `dashboard/modules/api.js`, and `dashboard/modules/assessment.js`. Auth headers, base URL, and error handling are inconsistent or absent. When Firebase Auth tokens are added, every fetch site must be updated.

#### V2 solution: One `api/client.js` shared by all surfaces

A single module responsible for:
1. Prepending the base URL (from `config.js`)
2. Attaching the Firebase Auth `Bearer` token to every request
3. Handling non-2xx responses uniformly
4. Providing named, typed functions for every API call

**Location:** `shared/api/client.js` — imported by both the student surface and the teacher dashboard.

**Structure:**

```js
// shared/api/client.js

import { getAuth } from 'firebase/auth';
import { BACKEND_URL } from '../config.js';

const request = async (path, body) => {
    const token = await getAuth().currentUser?.getIdToken();
    const res = await fetch(`${BACKEND_URL}${path}`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    return res.json();
};

export const saveDraft = (assignmentId, data) =>
    request('/api/drafts/save', { assignmentId, data });

export const getDraft = (assignmentId) =>
    request('/api/drafts/get', { assignmentId });

export const getFeedback = (assignmentId) =>
    request('/api/feedback/get', { assignmentId });

export const saveFeedback = (targetUid, assignmentId, feedbackData, releaseSettings, released) =>
    request('/api/feedback/save', { targetUid, assignmentId, feedbackData, releaseSettings, released });

// ... one exported function per API action
```

**Impact:**
- `dashboard/modules/api.js` becomes a thin wrapper that calls `shared/api/client.js`
- `js/app.js`, `js/studentFeedback.js` import from `shared/api/client.js` directly
- Adding auth to every call = one change in one place

---

### Change 5 — Canonical assignment schema

#### V1 problem

The assignment JSON has evolved organically. There are 10+ fallback field names for the same concept (`correct_solution`, `correctSolution`, `parsed_solution`, `parsedSolution`, `model_solution`, `modelSolution`...). The `pickFirstNonEmpty` helper exists to paper over this inconsistency. Every new layout type will add more variants.

#### V2 solution: One schema, validated at load time

**Canonical field names** (snake_case, no aliases):

```json
{
  "assignmentTitle": "string — matches URL assignmentId",
  "schemaVersion": "2",
  "schoolId": "string — which school this belongs to",
  "layoutType": "quill-form | notebook | branching | ...",
  "solution_keys": ["string"],
  "subAssignments": {
    "{subId}": {
      "title": "string",
      "layoutType": "quill-form",
      "questions": [
        {
          "id": "string — unique within subAssignment",
          "text": "string — markdown supported",
          "solution": "string — canonical model answer (single field)"
        }
      ]
    }
  }
}
```

**Rules:**
- `solution` replaces all aliases. The evaluator and renderer must use only `question.solution`.
- `schemaVersion: "2"` allows the Cloud Function and renderer to detect V1 files and apply a one-time migration shim.
- `layoutType` at both the assignment and sub-assignment level is the hook for the multi-layout frontend (see Section 5).
- `schoolId` scopes the assignment to a school — used by Firestore queries.

**Validation:**
- Backend: validate incoming assignment uploads against the schema (JSON Schema or Zod)
- Frontend renderer: if `schemaVersion` is missing → log a warning and apply V1 compatibility shim → renders as before

**Migration of existing files:**
- Write a one-time script (`tools/migrate-schema-v1-to-v2.js`) that reads all `lms_json/*.json` files, normalizes field names, adds `schemaVersion: "2"` and `layoutType: "quill-form"`, and outputs to `lms_json_v2/`
- Upload to GCS after verification

---

## 4. Multi-School Data Model

The V2 system serves 3 schools from one backend. School isolation is enforced at the data layer, not by deploying separate backends.

### Identity scoping

Every Firestore document includes a `schoolId` field. Every authenticated request carries a `schoolId` in the Firebase Auth custom claim (set on user creation).

```
schoolId: "bbw"      ← Berufsschule BBW Zürich
schoolId: "wbz"      ← Weiterbildungszentrum X
schoolId: "kv"       ← KV Schule Y
```

Backend middleware extracts `schoolId` from the token claim and injects it into every Firestore query — students and teachers can only read/write data for their own school.

### Teacher scoping

A teacher belongs to one or more schools. Their Firestore user document contains:

```json
{
  "uid": "...",
  "role": "teacher",
  "schoolIds": ["bbw", "wbz"],
  "managedClassIds": {
    "bbw": ["PK25A", "PK25B"],
    "wbz": ["ABU26"]
  }
}
```

The live view `listDrafts` query is scoped to `schoolId + classId` — a teacher never sees students from another school or a class they don't manage.

### Assignment scoping

Assignments can be:
- `schoolId: "bbw"` — specific to one school
- `schoolId: "*"` — shared across all schools (common content)

This allows you to author a generic assignment once and reuse it, or keep school-specific content isolated.

### Student registration flow

Since students do not self-register (they receive credentials from the teacher):

1. Teacher creates a student record in the V2 admin panel (or a script)
2. A Firebase Auth account is created with email + generated password
3. Custom claim `{ schoolId, klasse }` is set via Cloud Run on user creation
4. Teacher distributes email + password to students (same as the current key distribution)

---

## 5. Multi-Layout Frontend Architecture

### The problem V1 has

`js/renderer.js` is hardcoded to render a single layout: a list of questions, each with a Quill editor. There is no concept of a "layout type." Adding a notebook-style or branching layout would require forking the entire renderer.

### The V2 layout system

Every assignment specifies a `layoutType`. The student entry point (`js/app.js`) reads this and loads the correct layout module. All layout modules share the same underlying services (auth, draft save, feedback display).

```
layouts/
├── quill-form/              ← V1 layout, unchanged
│   ├── renderer.js
│   └── styles.css
├── notebook/                ← future: multi-step, 1-2 quill boxes per step
│   ├── renderer.js
│   └── styles.css
├── branching/               ← future: choice-driven content paths
│   ├── renderer.js
│   └── styles.css
└── _base/                   ← shared layout logic (not a layout itself)
    ├── draftManager.js      ← auto-save, IndexedDB, draft load
    ├── feedbackDisplay.js   ← inject feedback below any question block
    └── submissionHandler.js ← final submit, print
```

### How the loader works

```js
// js/app.js (V2)

import { getAssignment } from '../shared/api/client.js';
import { loadLayout } from './layoutLoader.js';

const assignment = await getAssignment(assignmentId);
const layoutType = assignment.subAssignments[subId]?.layoutType ?? 'quill-form';

const { render } = await loadLayout(layoutType);
render(assignment, subId, studentKey, container);
```

```js
// js/layoutLoader.js

const layouts = {
    'quill-form': () => import('./layouts/quill-form/renderer.js'),
    'notebook':   () => import('./layouts/notebook/renderer.js'),
    'branching':  () => import('./layouts/branching/renderer.js'),
};

export const loadLayout = async (type) => {
    const loader = layouts[type] ?? layouts['quill-form'];
    return loader();
};
```

### What every layout module must implement

Each layout renderer exports a single function:

```js
export const render = (assignment, subId, studentUid, container) => {
    // 1. Build DOM for this layout's question presentation
    // 2. Attach Quill editors (or other input types)
    // 3. Call draftManager.init() to wire up auto-save
    // 4. Call feedbackDisplay.init() to wire up feedback injection
};
```

This contract means:
- The `quill-form` layout from V1 can be extracted as-is with minimal changes
- New layouts are added by creating a new folder — zero changes to the core app

### Shared services (`layouts/_base/`)

| Service | Responsibility | Used by all layouts |
|---|---|---|
| `draftManager.js` | IndexedDB + debounce + `saveDraft` API call | Yes |
| `feedbackDisplay.js` | Fetch released feedback, inject below `.question-block` | Yes |
| `submissionHandler.js` | Final submit, PDF print | Yes |

> **Critical implementation note for `draftManager.js`:** When populating a Quill editor with saved content via `quill.root.innerHTML = answer`, Quill's internal MutationObserver fires `text-change` with `source='user'` — not `'api'` as one might expect. This causes `saveDraft` to be triggered on every page load, not just on user input, and can overwrite the GCS draft with partial data if IndexedDB is not yet fully populated. The V1 fix is an `isInitializing` flag per editor that blocks all saves until `initializeEditor()` completes. **`draftManager.js` must preserve this pattern.** All layout renderers that wire up Quill editors must set `isInitializing = true` before setting `innerHTML` and `= false` only after all async initialization (including `storage.set`) is done.

The `feedbackDisplay.js` injector works on any layout as long as question wrappers use the class `.question-block` and Quill editors use the ID convention `quill-editor-{sanitizedSubId}-{sanitizedQuestionId}`. This convention is documented as a **layout contract** that all renderers must follow.

---

## 6. V2 Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│                         STUDENT BROWSER                                │
│  index.html?assignmentId=X&subId=Y                                     │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  js/app.js                                                       │  │
│  │   ├─ Firebase Auth SDK → sign in / get ID token                 │  │
│  │   ├─ shared/api/client.js → all API calls with Bearer token     │  │
│  │   └─ layoutLoader.js → dynamic import of layout module         │  │
│  │                                                                  │  │
│  │  layouts/quill-form/renderer.js  (or notebook / branching)      │  │
│  │   ├─ Quill editors per question                                 │  │
│  │   ├─ _base/draftManager.js → auto-save                         │  │
│  │   └─ _base/feedbackDisplay.js → inline feedback injection      │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────┬──────────────────────────────────────────┘
                              │ HTTPS + Bearer token
                              ▼
┌────────────────────────────────────────────────────────────────────────┐
│              CLOUD RUN: lms-backend  (Express.js / Node 20)            │
│  europe-west6  /  scales to zero  /  unauthenticated HTTP trigger      │
│                                                                        │
│  middleware/auth.js → Firebase Admin verifyIdToken → extracts          │
│                        uid, schoolId, role from claims                 │
│                                                                        │
│  routes/assignments.js  GET /api/assignments/:id                       │
│  routes/drafts.js       POST /api/drafts/save|get|list                 │
│  routes/feedback.js     POST /api/feedback/save|get|status             │
│  routes/submissions.js  POST /api/submissions/submit|get|list          │
│  routes/users.js        POST /api/users/register|info                  │
└─────────────────┬─────────────────────────────┬───────────────────────┘
                  │ Firestore SDK               │ GCS SDK
                  ▼                             ▼
┌──────────────────────────┐   ┌────────────────────────────────────────┐
│  FIRESTORE               │   │  GCS BUCKET: lms-data-v2               │
│                          │   │                                        │
│  /schools/{id}           │   │  assignments/                          │
│  /users/{uid}            │   │    {assignmentId}.json                 │
│  /drafts/{uid}_{assId}   │   │                                        │
│  /feedback/{uid}_{assId} │   │  (assignment files only — static,      │
│  /submissions/{...}      │   │   infrequently updated)                │
│  /assignments/{id}       │   │                                        │
│    (metadata + cache)    │   └────────────────────────────────────────┘
└──────────────────────────┘
                  ▲
                  │ HTTPS + Bearer token (teacher browser)
┌────────────────────────────────────────────────────────────────────────┐
│                       TEACHER BROWSER                                  │
│  dashboard/liveview.html                                               │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │  Firebase Auth SDK → sign in as teacher                         │  │
│  │  shared/api/client.js → all calls with Bearer token             │  │
│  │  dashboard/modules/renderer.js → student card grid              │  │
│  │  dashboard/modules/assessment.js → ⚡ Feedback → localhost:5000 │  │
│  │  dashboard/modules/feedback.js → Freigeben panel                │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ HTTP POST (localhost only)
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│        LOCAL EVALUATOR SERVER  evaluator/live_server.py                │
│        http://localhost:5000  (unchanged from V1)                      │
│                                                                        │
│  POST /assess → Gemini API → returns scored feedback + history         │
│  POST /get_feedback → reads local feedback history                     │
│  POST /get_master_assignment → returns solution JSON                   │
└────────────────────────────────────────────────────────────────────────┘
                            │ HTTPS
                            ▼
                   ┌─────────────────┐
                   │   GEMINI API    │
                   │ (unchanged)     │
                   └─────────────────┘
```

---

## 7. V2 File Map (Target State)

```
lms_box/                             ← frontend root (static, no build step)
│
├── index.html                       ← student entry point (unchanged shell)
├── css/
│   └── styles.css
│
├── js/
│   ├── app.js                       ← student entry: auth → load layout
│   ├── layoutLoader.js              ← dynamic import by layoutType
│   └── config.js                    ← BACKEND_URL + Firebase config
│
├── layouts/
│   ├── _base/
│   │   ├── draftManager.js          ← auto-save (IndexedDB + API)
│   │   ├── feedbackDisplay.js       ← inject feedback below .question-block
│   │   └── submissionHandler.js     ← final submit + print
│   │
│   ├── quill-form/                  ← V1 layout (extracted, unchanged logic)
│   │   ├── renderer.js
│   │   └── styles.css
│   │
│   ├── notebook/                    ← future layout (scaffold only in V2)
│   │   └── renderer.js
│   │
│   └── branching/                   ← future layout (scaffold only in V2)
│       └── renderer.js
│
├── shared/
│   ├── api/
│   │   └── client.js                ← single API client (all surfaces)
│   └── auth/
│       └── firebase.js              ← Firebase app init + auth helpers
│
└── dashboard/
    ├── liveview.html                ← unchanged shell
    ├── teacher.css
    ├── liveview.js                  ← imports shared/api/client.js
    └── modules/
        ├── api.js                   ← thin wrapper over shared/api/client.js
        ├── renderer.js              ← student card grid (unchanged logic)
        ├── assessment.js            ← LLM trigger (unchanged)
        ├── feedback.js              ← Freigeben panel (unchanged)
        ├── printer.js               ← unchanged
        ├── exporter.js              ← unchanged
        ├── auth.js                  ← replaced by shared/auth/firebase.js
        ├── state.js                 ← reduced (uid replaces teacherKey)
        └── utils.js                 ← unchanged


backend/                             ← Cloud Run source (replaces google_cloud/)
├── index.js                         ← Express app entry
├── Dockerfile
├── package.json
├── .env.example                     ← documents required env vars
├── middleware/
│   ├── auth.js                      ← Firebase Admin verifyIdToken
│   └── cors.js
├── routes/
│   ├── assignments.js
│   ├── drafts.js
│   ├── feedback.js
│   ├── submissions.js
│   └── users.js
├── services/
│   ├── firestore.js
│   ├── gcs.js
│   └── auth.js
└── config.js


tools/                               ← one-time migration utilities
└── migrate-schema-v1-to-v2.js      ← normalizes V1 assignment JSONs


evaluator/                           ← unchanged from V1
├── live_server.py
├── evaluator.py
├── config.py
└── ...


docs/
├── ARCHITECTURE.md                  ← V1 reference (keep for archival)
├── V2_MIGRATION_PLAN.md             ← this document
└── LAYOUT_CONTRACT.md               ← (create when building first new layout)
```

---

## 8. Migration Phases

The migration is designed to be **incrementally deployable** — each phase can run in production while the next is being built. V1 continues to serve students until V2 is fully validated.

---

### Phase 0 — Preparation (before summer break)

**Goal:** Set up the V2 project skeleton without breaking V1.

Tasks:
- [ ] Create a new GCP project (or use existing project, new service account)
- [ ] Enable Firestore (Native mode), Cloud Run, Firebase Authentication in the project
- [ ] Create the new GCS bucket (`lms-data-v2`)
- [ ] Scaffold the `backend/` Express app with one working route (`GET /api/assignments/:id`)
- [ ] Scaffold `shared/api/client.js` (no auth yet — plain fetch wrapper)
- [ ] Create `layouts/` folder; copy V1 renderer logic into `layouts/quill-form/renderer.js`
- [ ] Run `tools/migrate-schema-v1-to-v2.js` on all existing assignment JSONs → verify output
- [ ] Upload migrated assignment JSONs to new GCS bucket

**Deliverable:** V2 backend runs locally with `node index.js`, returns assignment data. V1 frontend still in production.

---

### Phase 1 — Backend: Drafts and Feedback on Firestore

**Goal:** Replace GCS flat-file storage for drafts and feedback with Firestore, behind the same API interface. No frontend changes yet.

Tasks:
- [ ] Implement `routes/drafts.js`: `save`, `get`, `list`
- [ ] Implement `routes/feedback.js`: `save`, `get`, `status`
- [ ] Keep the same request/response shape as V1 (backwards-compatible)
- [ ] Deploy to Cloud Run
- [ ] Test with V1 frontend pointing at new backend URL (swap `SCRIPT_URL` in `config.js`)
- [ ] Verify: teacher sees all students, feedback release works end-to-end

**Deliverable:** V2 backend in production, V1 frontend running against it. Firestore receives all new drafts and feedback data.

---

### Phase 2 — Frontend: Firebase Auth replaces student keys

**Goal:** Students and teachers log in with Firebase Auth. The shared key mechanism is retired.

Tasks:
- [ ] Enable Firebase Authentication (Email/Password provider)
- [ ] Create student accounts in Firebase Auth for each class (script or admin panel)
- [ ] Set `schoolId` + `klasse` custom claims on each student account
- [ ] Create teacher accounts with `role: teacher` custom claim
- [ ] Implement `shared/auth/firebase.js` — wraps Firebase Auth SDK
- [ ] Replace `js/auth.js` with Firebase Auth sign-in flow
- [ ] Replace `dashboard/modules/auth.js` with Firebase Auth sign-in
- [ ] Implement `backend/middleware/auth.js` — `verifyIdToken`
- [ ] Update all routes to extract `uid` and `schoolId` from token (remove `studentKey` from POST body)
- [ ] Update `shared/api/client.js` to attach `Bearer` token

**Deliverable:** Students and teachers log in with email + password. The `student_keys.json` file is retired. All school isolation enforced by Firestore queries scoped to `schoolId`.

---

### Phase 3 — Frontend: Layout system

**Goal:** Extract the V1 renderer into the `quill-form` layout module. Validate the layout contract. Stub out scaffold for two future layouts.

Tasks:
- [ ] Move V1 `js/renderer.js` logic into `layouts/quill-form/renderer.js`
- [ ] Move V1 `js/studentFeedback.js` into `layouts/_base/feedbackDisplay.js`
- [ ] Move V1 draft save logic into `layouts/_base/draftManager.js`
- [ ] Update `js/app.js` to use `layoutLoader.js`
- [ ] Verify: student view works identically to V1 with the new structure
- [ ] Create empty scaffold renderers for `notebook` and `branching` (exports `render` function, throws `Not implemented`)
- [ ] Write `docs/LAYOUT_CONTRACT.md` — documents `.question-block`, Quill ID convention, draft manager API

**Deliverable:** V1 behavior fully preserved in the new layout system. Two future layouts are ready to be developed as independent modules.

---

### Phase 4 — Multi-school rollout

**Goal:** Create accounts and assignment sets for the second and third school.

Tasks:
- [ ] Add `schoolId` values for the two new schools in Firestore `/schools/`
- [ ] Create student and teacher accounts for the new schools
- [ ] Author and upload assignment JSONs for the new syllabuses (using V2 schema)
- [ ] Confirm teacher live view shows only classes from their own school
- [ ] Confirm student view shows only their own feedback

**Deliverable:** All 3 schools live on V2.

---

## 9. What V2 Enables Next (Backlog)

These are not planned for V2 but are now structurally possible once the above phases are complete.

| Feature | Enabled by |
|---|---|
| **Notebook layout** — multi-step assignment with 1-2 editors per step, progress indicator | Phase 3 layout system |
| **Branching layout** — choice-driven content paths | Phase 3 layout system |
| **Student re-submission** — iterative feedback loop | Phase 1 (Firestore history) + Phase 2 (stable uid) |
| **Analytics dashboard** — score trends per class, per assignment | Phase 1 (Firestore queryability) |
| **Teacher assignment authoring UI** — web form to create assignment JSONs | Phase 1 + Phase 5 (schema) |
| **Automated student account provisioning** — CSV upload → bulk Firebase accounts | Phase 2 |
| **Self-paced mode** — unlock next step after reaching score threshold | Phase 3 layout system |
| **LLM evaluator on Cloud** — remove dependency on local server | Decoupled from V2; evaluator can be containerized independently |

---

*Generated: 2026-03-05 — Reflects V1 state as documented in ARCHITECTURE.md and the 5 structural improvements identified for V2.*
*Updated: 2026-03-17 — Added V1 known issue notes: multi-iframe auth dialog race condition (resolved by Firebase Auth in Phase 2) and Quill MutationObserver `isInitializing` guard requirement (must be preserved in `draftManager.js` in Phase 3).*
*Updated: 2026-03-18 — Noted V1 additions to local evaluator (`/update_feedback`) and liveview feedback editing UI. These carry forward unchanged to V2.*
