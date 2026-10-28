'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { inlineLineNumbers, sourceColumns } = require('../../src/inline-layout');
const range = (start, end) => ({ start: { line: start }, end: { line: end } });

test('inline block follows the cursor and shifts up at the viewport end', () => {
  assert.deepEqual(inlineLineNumbers(100, 12, [range(10, 29)], 6), [12, 13, 14, 15, 16, 17]);
  assert.deepEqual(inlineLineNumbers(100, 28, [range(10, 29)], 6), [24, 25, 26, 27, 28, 29]);
});

test('short files and short viewports expose only their actual rows', () => {
  assert.deepEqual(inlineLineNumbers(2, 1, [range(0, 1)], 6), [0, 1]);
  assert.deepEqual(inlineLineNumbers(100, 20, [range(20, 22)], 6), [20, 21, 22]);
});

test('scrolling away from the caret anchors at the visible region', () => {
  assert.deepEqual(inlineLineNumbers(100, 2, [range(50, 59)], 6), [50, 51, 52, 53, 54, 55]);
});

test('folded source rows are omitted without losing novel lines', () => {
  assert.deepEqual(inlineLineNumbers(100, 2, [range(0, 2), range(10, 14)], 6), [2, 10, 11, 12, 13, 14]);
});

test('initial empty viewport and single-line mode have bounded layouts', () => {
  assert.deepEqual(inlineLineNumbers(100000, 99999, [], 6), [99994, 99995, 99996, 99997, 99998, 99999]);
  assert.deepEqual(inlineLineNumbers(30, 8, [range(0, 29)], 1), [8]);
});

test('alignment accounts for tab stops rather than raw tab characters', () => {
  assert.equal(sourceColumns('a\tb', 4), 5);
  assert.equal(sourceColumns('\t\tconst x = 1;', 2), 16);
});
