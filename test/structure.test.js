'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeStructure } = require('../server/structure');

test('chemins et types, sans valeurs', () => {
  const out = describeStructure({ a: { b: 1, c: 'texte secret', d: [true, false], e: null }, f: [] });
  assert.deepEqual(out, ['$: object', 'a.b: number', 'a.c: string', 'a.d: array', 'a.d[]: boolean', 'a.e: null', 'a: object', 'f: array']);
  assert.ok(!out.join('').includes('secret'));
});

test('tableau d\'objets : structure fusionnée, éléments dédoublonnés', () => {
  const out = describeStructure({ l: [{ x: 1 }, { x: 2, y: 'u' }] });
  assert.deepEqual(out, ['$: object', 'l: array', 'l[].x: number', 'l[].y: string', 'l[]: object']);
});

test('les noms de clés douteux sont neutralisés (URL, caractères spéciaux, longueur)', () => {
  const out = describeStructure({ 'https://x.example/a?sig=1': 1, ['k'.repeat(100)]: 2 });
  assert.deepEqual(out, ['$: object', '<autre>: number']);
  assert.ok(!out.join('').includes('https'));
  assert.ok(!out.join('').includes('sig'));
});

test('profondeur et nombre de chemins bornés', () => {
  let deep = { v: 1 }; for (let i = 0; i < 50; i++) deep = { n: deep };
  assert.ok(describeStructure(deep).length <= 12);
  const wide = {}; for (let i = 0; i < 1000; i++) wide['k' + i] = i;
  assert.ok(describeStructure(wide, { maxPaths: 50 }).length <= 50);
});

test('valeurs primitives et null à la racine', () => {
  assert.deepEqual(describeStructure('abc'), ['$: string']);
  assert.deepEqual(describeStructure(null), ['$: null']);
});
