//
// ────────────────────────────────────────────────────────────────
//   :::::: F I L E :   j s / s t o r a g e . j s ::::::
// ────────────────────────────────────────────────────────────────
// This is a helper library to make IndexedDB easy to use.
//

const DB_NAME = 'LMS_AssignmentsDB';
const STORE_NAME = 'user_data';
const DB_VERSION = 1;

let db;

/**
 * Initializes the IndexedDB database.
 * It also requests persistent storage for better data durability.
 * @returns {Promise<IDBDatabase>} A promise that resolves with the database instance.
 */
function initDB() {
    return new Promise((resolve, reject) => {
        // Request persistent storage. This is a best-effort attempt.
        // The browser may grant it without prompting, or it may ignore it.
        // But it significantly increases the chance of data surviving.
        if (navigator.storage && navigator.storage.persist) {
            navigator.storage.persist().then(persisted => {
                if (persisted) {
                    console.log("Storage is persistent and will not be automatically cleared.");
                } else {
                    console.warn("Storage is NOT persistent. Data may be cleared by the browser under storage pressure.");
                }
            });
        }

        if (db) {
            return resolve(db);
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = (event) => {
            console.error("IndexedDB error:", event.target.error);
            reject("Error opening database.");
        };

        request.onsuccess = (event) => {
            db = event.target.result;
            resolve(db);
        };

        // This event only runs if the database version changes.
        // It's where we define the schema.
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}

/**
 * Saves a key-value pair to the database.
 * @param {string} key The key for the data.
 * @param {any} value The value to store.
 * @returns {Promise<void>}
 */
export async function set(key, value) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.put({ key, value });

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
            console.error("Error writing to IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves a value from the database by its key.
 * @param {string} key The key of the data to retrieve.
 * @returns {Promise<any|null>} The stored value, or null if not found.
 */
export async function get(key) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
            resolve(request.result ? request.result.value : null);
        };
        request.onerror = (event) => {
            console.error("Error reading from IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Removes a key-value pair from the database.
 * @param {string} key The key to remove.
 * @returns {Promise<void>}
 */
export async function remove(key) {
    const database = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(key);

        request.onsuccess = () => resolve();
        request.onerror = (event) => {
            console.error("Error deleting from IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}

/**
 * Retrieves all key-value pairs from the database.
 * Needed for the printer and submission modules.
 * @returns {Promise<Array<{key: string, value: any}>>}
 */
export async function getAll() {
    const database = await initDB();
    return new Promise((resolve, reject) => {
        const transaction = database.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => resolve(request.result);
        request.onerror = (event) => {
            console.error("Error getting all from IndexedDB:", event.target.error);
            reject(event.target.error);
        };
    });
}