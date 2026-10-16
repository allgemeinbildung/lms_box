//
//  dashboard/hko/firestore.js — the FULL Firestore build on the database of the HKO box.
//
//  Same pattern as dashboard/modules/firestore.js: js/firebase.js loads Lite (no streams) for
//  the pages with many iframes; this single dashboard page needs live listeners, so it loads
//  the full build here, on the same Firebase app and with the same emulator switch.
//  The database name comes from js/hko/config.js only (HKO.md, Phase P1, §1).
//  Only dashboard/hko/api.js imports this file.
//
import { app, emulator } from '../../js/firebase.js';
import { HKO } from '../../js/hko/config.js';
import { getFirestore, connectFirestoreEmulator } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

export { collection, query, where, getDocs, onSnapshot } from 'https://www.gstatic.com/firebasejs/12.19.0/firebase-firestore.js';

/** Database `HKO.database` with streaming connections. Read access only is used by the dashboard. */
export const hkoDb = getFirestore(app, HKO.database);

if (emulator) connectFirestoreEmulator(hkoDb, emulator.host, emulator.ports.firestore);
