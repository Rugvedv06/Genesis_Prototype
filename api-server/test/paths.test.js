// Phase 0 exit gate: npm test must run. Unit tests for lib/paths.js (everyone depends on it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPath, setPath, deletePath, leafPaths } from '../src/lib/paths.js';

test('getPath retrieves nested values by dotted path', () => {
  const obj = { a: { b: { c: 1 } }, d: 2 };
  assert.strictEqual(getPath(obj, 'a.b.c'), 1);
  assert.strictEqual(getPath(obj, 'd'), 2);
  assert.strictEqual(getPath(obj, ''), obj);
  assert.strictEqual(getPath(obj, 'a.missing'), undefined);
  assert.strictEqual(getPath(obj, 'a.b.c.d'), undefined);
});

test('setPath creates intermediate objects and sets leaves', () => {
  const obj = {};
  setPath(obj, 'a.b.c', 1);
  assert.deepStrictEqual(obj, { a: { b: { c: 1 } } });
  setPath(obj, 'a.b', 'overwritten');
  assert.deepStrictEqual(obj, { a: { b: 'overwritten' } });
});

test('deletePath removes leaves and reports missing paths', () => {
  const obj = { a: { b: 1, c: 2 } };
  assert.strictEqual(deletePath(obj, 'a.b'), true);
  assert.deepStrictEqual(obj, { a: { c: 2 } });
  assert.strictEqual(deletePath(obj, 'a.b'), false);
  assert.strictEqual(deletePath(obj, 'missing.x'), false);
});

test('leafPaths returns dotted paths of every leaf', () => {
  const obj = { a: 1, b: { c: 2, d: { e: 3 } } };
  assert.deepStrictEqual(leafPaths(obj).sort(), ['a', 'b.c', 'b.d.e']);
  assert.deepStrictEqual(leafPaths({}), []);
});
