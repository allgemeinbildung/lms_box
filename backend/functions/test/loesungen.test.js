// node --test test/loesungen.test.js   (no emulator)
const test = require('node:test');
const assert = require('node:assert/strict');
const { freigegeben } = require('../loesungen');

const DOC = {
    loesungFreigabe: [{ klassen: ['4pk25a'], ab: '2026-11-13T17:00:00+01:00' }],
    subAssignments: {
        'A. Teil': { questions: [{ id: 'q1', text: 'F1', loesung: 'Antwort' }, { id: 'q2', text: 'F2' }] },
        'B. Teil': { questions: [{ id: 'q1', text: 'F3', loesung: '   ' }] },
    },
};
const VOR = new Date('2026-11-13T16:59:59+01:00');
const AB = new Date('2026-11-13T17:00:00+01:00');

test('vor der Zeit nichts, auch nicht für die richtige Klasse', () => {
    assert.deepEqual(freigegeben({ classId: '4pk25a' }, DOC, VOR), { frei: false });
});
test('ab der Zeit für die richtige Klasse: nur Fragen mit Lösungstext', () => {
    const r = freigegeben({ classId: '4pk25a' }, DOC, AB);
    assert.equal(r.frei, true);
    assert.deepEqual(r.loesungen, { 'A. Teil': { q1: 'Antwort' } });
});
test('Gross-/Kleinschreibung und classIds', () => {
    assert.equal(freigegeben({ classIds: ['4PK25A '] }, DOC, AB).frei, true);
});
test('andere Klasse, keine Klasse, kein Dokument', () => {
    assert.equal(freigegeben({ classId: '4pg24c' }, DOC, AB).frei, false);
    assert.equal(freigegeben({}, DOC, AB).frei, false);
    assert.equal(freigegeben({ classId: '4pk25a' }, null, AB).frei, false);
    assert.equal(freigegeben(null, DOC, AB).frei, false);
});
test('ohne Freigabe im Auftrag bleiben Lösungen verschlossen', () => {
    const { loesungFreigabe, ...ohne } = DOC;
    assert.equal(freigegeben({ classId: '4pk25a' }, ohne, AB).frei, false);
});
test('ungültiges oder fehlendes Datum gibt nichts frei', () => {
    for (const ab of ['bald', null, undefined]) {
        const d = { ...DOC, loesungFreigabe: [{ klassen: ['4pk25a'], ab }] };
        assert.equal(freigegeben({ classId: '4pk25a' }, d, AB).frei, false);
    }
});
test('Freigabe ohne einen Lösungstext gibt frei:false', () => {
    const d = { loesungFreigabe: DOC.loesungFreigabe, subAssignments: { A: { questions: [{ id: 'q1' }] } } };
    assert.equal(freigegeben({ classId: '4pk25a' }, d, AB).frei, false);
});
