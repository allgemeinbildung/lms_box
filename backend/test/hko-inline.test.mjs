// Fett/kursiv in Aufträgen und Fragen (js/hko/util.js inlineHtml), wie im Altsystem js/renderer.js.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inlineHtml } from '../../js/hko/util.js';

const faelle = [
    ['Nennen Sie **drei Arten**, die auf Seite 46 stehen.', 'Nennen Sie <strong>drei Arten</strong>, die auf Seite 46 stehen.'],
    ['*kursiv* und _auch_', '<em>kursiv</em> und <em>auch</em>'],
    ['**Brutto**- und **Netto**lohn', '<strong>Brutto</strong>- und <strong>Netto</strong>lohn'],
    ['Datei a_b_c bleibt', 'Datei a_b_c bleibt'],
    ['2 * 3 * 4 bleibt', '2 * 3 * 4 bleibt'],
    ['** leer **', '** leer **'],
    ['ohne Marken', 'ohne Marken'],
];

for (const [ein, aus] of faelle) {
    test(`inline: ${ein}`, () => assert.equal(inlineHtml(ein), aus));
}

test('inline: HTML aus den Daten bleibt Text', () => {
    assert.equal(inlineHtml('<img src=x onerror=alert(1)> **fett**'), '&lt;img src=x onerror=alert(1)&gt; <strong>fett</strong>');
    assert.equal(inlineHtml('**<b>x</b>**'), '<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
});
