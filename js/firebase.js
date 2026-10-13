// The only module that imports the Firebase SDK. Contract: backend/CONTRACT.md, "Client".
//
// On localhost / 127.0.0.1 everything goes to the EMULATORS (ports: backend/firebase.json).
// Live data from a local page needs ?live=1 in the address - a local click-through must
// never write into production.
//
// Firestore is loaded as the LITE build: plain request/response, no streaming channel.
// Measured 2026-10-13 (backend/test/e2e-student.mjs): with the full build every Firestore
// instance keeps a long-lived Listen connection open; three iframes x two databases used up
// the browser's six connections per host (HTTP/1.1, as the emulator and some proxies speak)
// and the third iframe waited 60 s for its drafts. The student page only reads and writes
// single documents, so it needs no stream. Lite has no onSnapshot and no offline queue:
// a write that cannot reach the server fails, and the page shows that.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-app.js';
import { getAuth, connectAuthEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js';
import { getFunctions, connectFunctionsEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';

// The SDK functions the other modules need, passed through so that this file stays the
// only one that names the SDK URLs (and the only place to change the pinned version).
export { signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js';
export { doc, getDoc, setDoc, collection, query, where, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore-lite.js';
export { httpsCallable } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-functions.js';
import { firebaseConfig } from './config.js';

const EMULATOR_PORTS = { auth: 9190, firestore: 8280, functions: 5101 };

const host = window.location.hostname;
const isLocal = host === 'localhost' || host === '127.0.0.1';
const wantsLive = new URLSearchParams(window.location.search).get('live') === '1';
const useEmulators = isLocal && !wantsLive;

// `app` and `emulator` are exported for dashboard/modules/firestore.js only: the teacher
// dashboard loads the full Firestore build there (live listeners) on this same app.
export const app = initializeApp(firebaseConfig);
export const emulator = useEmulators ? { host, ports: EMULATOR_PORTS } : null;

export const auth = getAuth(app);
export const db = getFirestore(app, 'lmsbox');
export const rosterDb = getFirestore(app);
export const functions = getFunctions(app, 'europe-west6');

if (useEmulators) {
    connectAuthEmulator(auth, `http://${host}:${EMULATOR_PORTS.auth}`, { disableWarnings: true });
    connectFirestoreEmulator(db, host, EMULATOR_PORTS.firestore);
    connectFirestoreEmulator(rosterDb, host, EMULATOR_PORTS.firestore);
    connectFunctionsEmulator(functions, host, EMULATOR_PORTS.functions);
    console.info('[firebase] emulators (auth, firestore, functions). Live data: add ?live=1');
} else if (isLocal) {
    console.warn('[firebase] ?live=1 - this local page reads and writes PRODUCTION data.');
}
