// Projektgebundene Werte der hko-box im Browser (backend/HKO.md, «Phase P1 — Vertrag» §1).
// Jeder Wert steht hier und an keiner anderen Stelle im Browser-Code.
// Umzug in ein eigenes Projekt: hier ändern. (Node: backend/scripts/lib/hko-target.mjs,
// Rules: isSchoolAccount() in backend/firestore.hko.rules, Web-Konfiguration: js/config.js)
export const HKO = Object.freeze({
    database: 'hko',
    baseUrl: 'https://allgemeinbildung.github.io/lms_box/',
    schoolDomain: 'lernende.bbw.ch',
});
