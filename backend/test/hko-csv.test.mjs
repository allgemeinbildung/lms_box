// Unit test of dashboard/hko/csv.js (pure module, no browser).
// Run: node --test test/hko-csv.test.mjs   (from backend/)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField, buildCsv, answerText, shortStatus, guard, CSV_HEADER, pasteLine, formatTime } from '../../dashboard/hko/csv.js';

test('csvField: quoting for ; " and line breaks', () => {
    assert.equal(csvField('einfach'), 'einfach');
    assert.equal(csvField('a;b'), '"a;b"');
    assert.equal(csvField('sie sagte "ja"'), '"sie sagte ""ja"""');
    assert.equal(csvField('zwei\nZeilen'), '"zwei\nZeilen"');
    assert.equal(csvField('a,b'), 'a,b', 'a comma is no separator');
    assert.equal(csvField(null), '');
    assert.equal(csvField(7), '7');
});

test('csvField: formula protection with a leading apostrophe', () => {
    for (const c of ['=', '+', '-', '@']) assert.equal(csvField(`${c}1+1`), `'${c}1+1`, c);
    assert.equal(guard('normal=gleich'), 'normal=gleich', 'only a leading character counts');
    assert.equal(csvField('=HYPERLINK("x";"y")'), '"\'=HYPERLINK(""x"";""y"")"', 'guard first, then quotes');
});

test('buildCsv: BOM, header, CRLF', () => {
    const csv = buildCsv([['Test Lernende', 'k', '3J', 'b', 'text', '2 Wörter', 'hallo welt', '']]);
    assert.equal(csv.charCodeAt(0), 0xFEFF);
    const lines = csv.slice(1).split('\r\n');
    assert.equal(lines[0], 'Name;Klasse;Variante;Block;Typ;Stand;Antwort;Paste-Hinweise');
    assert.equal(lines[0].split(';').length, CSV_HEADER.length);
    assert.equal(lines[1], 'Test Lernende;k;3J;b;text;2 Wörter;hallo welt;');
    assert.equal(lines[2], '');
});

test('answerText: parts joined by " | ", odd shapes survive', () => {
    assert.equal(answerText('text', { text: 'Ein Satz.' }), 'Ein Satz.');
    assert.equal(answerText('items', { antworten: [{ frageId: 'a-1', text: 'x' }, { frageId: 'a-2', text: 'y' }] }), 'a-1: x | a-2: y');
    assert.equal(answerText('raster', { zeilen: [{ c: ['1', '2'] }, { c: ['', ''] }, { c: ['3', '4'] }], befund: 'gut' }), 'Zeile 1: 1 / 2 | Zeile 3: 3 / 4 | Befund: gut');
    assert.equal(answerText('selbst', { stufen: { k1: 2, k2: 3 }, begruendung: 'weil', verbessere: 'mehr' }), 'k1: 2 | k2: 3 | Begründung: weil | Verbessere: mehr');
    assert.equal(answerText('text', null), '');
    assert.equal(answerText('text', { text: { evil: 1 } }), '');
    assert.equal(answerText('raster', { zeilen: 'x', befund: 5 }), '');
    assert.equal(answerText('items', { antworten: 'x' }), '');
    assert.equal(answerText('unbekannt', { text: 'a' }), '');
});

test('shortStatus', () => {
    assert.equal(shortStatus(null, {}), '–');
    assert.equal(shortStatus({ type: 'text', value: { text: '' }, status: 'entwurf' }, {}), 'angefangen');
    assert.equal(shortStatus({ type: 'text', value: { text: 'eins zwei  drei' }, status: 'entwurf' }, {}), '3 Wörter');
    assert.equal(shortStatus({ type: 'text', value: { text: 'eins' }, status: 'abgegeben' }, {}), '1 Wort, abgegeben');
    assert.equal(shortStatus({ type: 'items', value: { antworten: [{ frageId: 'a', text: 'x' }, { frageId: 'b', text: ' ' }] } }, { fragen: [1, 2, 3] }), '1/3 beantwortet');
    assert.equal(shortStatus({ type: 'raster', value: { zeilen: [{ c: ['a', '', 'b'] }], befund: 'x' } }, { zeilen: 4, spalten: ['a', 'b', 'c'] }), '2/12 Zellen + Befund');
    assert.equal(shortStatus({ type: 'selbst', value: { stufen: { a: 1, b: 9 } } }, { kriterien: ['a', 'b'] }), '1/2 Kriterien');
    assert.equal(shortStatus({ type: 'text', value: 'kaputt' }, {}), 'angefangen');
});

test('pasteLine and formatTime', () => {
    assert.equal(pasteLine({ kind: 'paste', feld: 'text', chars: 120, excerpt: 'abc' }), 'Einfügen in text, 120 Zeichen: «abc»');
    assert.equal(formatTime(new Date(2026, 9, 16, 8, 5)), '16.10.2026 08:05');
    assert.equal(formatTime(undefined), '');
});
