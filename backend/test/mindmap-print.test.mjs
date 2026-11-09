// Unit tests of the pure part of dashboard/modules/mindmapPrint.js (no DOM, no Firebase).
// Run: node --test test/mindmap-print.test.mjs   (part of npm run test:e2e:mindmaps)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    LIMITS, unitFromInput, noteOf, skeletonNames, cutSkeleton, parseNodes, fallbackSkeleton, buildTree,
} from '../../dashboard/modules/mindmapPrint.js';

const UNIT = 'ABUlehrmittel/08 Konsum und Wirtschaft/8.1 Kaufvertragsarten Teil 2';
const SKEL = { text: 'Kaufvertragsarten Teil 2', children: [{ text: 'Leasing', children: [] }, { text: 'Miet-Kauf-Vertrag', children: [] }] };

test('unit ids: as typed, from a Publish address, refused when empty or too long', () => {
    assert.equal(unitFromInput(UNIT), UNIT);
    assert.equal(unitFromInput(`/${UNIT}/`), UNIT);
    assert.equal(unitFromInput('https://lehrmittel.aburossi.ch/ABUlehrmittel/08+Konsum+und+Wirtschaft/8.1+Kaufvertragsarten+Teil+2'), UNIT);
    assert.equal(unitFromInput('https://lehrmittel.aburossi.ch/ABUlehrmittel/08%20Konsum%20und%20Wirtschaft/8.1%20Kaufvertragsarten%20Teil%202#teil=1-2'), UNIT);
    assert.equal(unitFromInput('  '), null);
    assert.equal(unitFromInput('x'.repeat(301)), null);
    assert.equal(noteOf(UNIT), '8.1 Kaufvertragsarten Teil 2');
    assert.deepEqual(skeletonNames(UNIT), ['8.1 Kaufvertragsarten Teil 2_1', '8.1 Kaufvertragsarten Teil 2_1_1', '8.1 Kaufvertragsarten Teil 2']);
});

test('skeleton is cut to root and main branches; malformed is null', () => {
    const cut = cutSkeleton({ text: 'R', children: [{ text: 'A', children: [{ text: 'tief' }] }, { nope: 1 }, null] });
    assert.deepEqual(cut, { text: 'R', children: [{ text: 'A', children: [] }] });
    assert.equal(cutSkeleton(null), null);
    assert.equal(cutSkeleton({ children: [] }), null);
});

test('nodes: only { v: 1, add: [] } is accepted', () => {
    assert.deepEqual(parseNodes('{"v":1,"add":[]}'), { v: 1, add: [] });
    for (const bad of ['', 'kein json', '{"v":2,"add":[]}', '{"v":1,"add":{}}', '[]', null, 42]) assert.equal(parseNodes(bad), null, String(bad));
});

test('branches hang under their teacher node, unknown paths under the root, limits as the mindmap page', () => {
    const data = {
        v: 1, add: [
            { at: ['Kaufvertragsarten Teil 2', 'Leasing'], nodes: [{ t: '  Rate   pro Monat ', c: [{ t: 'Restwert', c: [] }] }, { t: '   ' }, { t: 5 }] },
            { at: ['Kaufvertragsarten Teil 2', 'Gibt es nicht mehr'], nodes: [{ t: 'Verirrt', c: [] }] },
            { at: 'kaputt', nodes: [{ t: 'Auch unter die Wurzel' }] },
            null,
        ],
    };
    const { tree, own } = buildTree(SKEL, data);
    assert.equal(own, 4);
    const leasing = tree.children.find((c) => c.text === 'Leasing');
    assert.equal(leasing.own, false);
    assert.equal(leasing.children[0].text, 'Rate pro Monat');
    assert.equal(leasing.children[0].children[0].text, 'Restwert');
    assert.deepEqual(tree.children.filter((c) => c.own).map((c) => c.text), ['Verirrt', 'Auch unter die Wurzel']);

    const long = { v: 1, add: [{ at: ['Kaufvertragsarten Teil 2'], nodes: Array.from({ length: 250 }, (_, i) => ({ t: `${i} ${'x'.repeat(200)}` })) }] };
    const big = buildTree(SKEL, long);
    assert.equal(big.own, LIMITS.nodes);
    assert.equal(big.tree.children.filter((c) => c.own)[0].text.length, LIMITS.text);

    let deep = { t: 'Ebene 7' };
    for (let i = 6; i >= 1; i--) deep = { t: `Ebene ${i}`, c: [deep] };
    const d = buildTree(SKEL, { v: 1, add: [{ at: ['Kaufvertragsarten Teil 2', 'Leasing'], nodes: [deep] }] });
    assert.equal(d.own, LIMITS.depth, 'depth 6, the seventh level is dropped');

    assert.equal(buildTree(SKEL, null).own, 0);
    assert.equal(buildTree(SKEL, { v: 1, add: [] }).own, 0);
});

test('fallback skeleton when no map file exists', () => {
    const datas = [
        { v: 1, add: [{ at: ['Schulden', 'Betreibung'], nodes: [] }, { at: ['Schulden', 'Budget'], nodes: [] }] },
        null,
        { v: 1, add: [{ at: ['Schulden', 'Betreibung'], nodes: [] }, { at: ['Anderes', 'X'], nodes: [] }] },
    ];
    assert.deepEqual(fallbackSkeleton('A/B/8.2 Schulden und Betreibung', datas),
        { text: 'Schulden', children: [{ text: 'Betreibung', children: [] }, { text: 'Budget', children: [] }] });
    assert.deepEqual(fallbackSkeleton('A/B/8.2 Schulden und Betreibung', [null]), { text: 'Schulden und Betreibung', children: [] });
});
