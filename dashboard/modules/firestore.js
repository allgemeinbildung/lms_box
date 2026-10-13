//
//  dashboard/modules/firestore.js — the FULL Firestore build for the teacher dashboard.
//
//  js/firebase.js loads Firestore Lite (no streams) for the student page. The dashboard
//  is a single page and needs live listeners, so it loads the full build here, on the
//  same Firebase app and with the same emulator switch (backend/CONTRACT.md, "Client").
//  Only dashboard/modules/api.js imports this file.
//
import { app, emulator } from '../../js/firebase.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export {
    doc, getDoc, getDocs, collection, query, where, onSnapshot, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

/** Database `lmsbox` with streaming connections. Handles of this build and of Lite do not mix. */
export const liveDb = getFirestore(app, 'lmsbox');

if (emulator) connectFirestoreEmulator(liveDb, emulator.host, emulator.ports.firestore);
