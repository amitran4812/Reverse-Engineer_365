import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { columnValues, hiddenRows, ruleStyles, shiftRange } from '../src/sheets/grid-rules.js';

const require = createRequire(import.meta.url);
const { exportXlsx, importXlsx } = require('../main/formats/xlsx');

const vals = { B1: 5, B2: 12, B3: 7, B4: 12, B5: 1 };
const of = (ref) => vals[ref];

test('highlight rules mark the matching cells', () => {
  const m = ruleStyles([{ ref: 'B1:B5', kind: 'gt', a: '6', color: '#ffc7ce|#9c0006' }], of);
  assert.deepEqual([...m.keys()].sort(), ['B2', 'B3', 'B4']);
  assert.equal(m.get('B2').bg, '#ffc7ce');
  assert.equal(m.get('B2').color, '#9c0006');
  assert.deepEqual([...ruleStyles([{ ref: 'B1:B5', kind: 'between', a: '5', b: '7' }], of).keys()].sort(), ['B1', 'B3']);
  assert.deepEqual([...ruleStyles([{ ref: 'B1:B5', kind: 'dup' }], of).keys()].sort(), ['B2', 'B4']);
  assert.deepEqual([...ruleStyles([{ ref: 'B1:B5', kind: 'top', a: '2' }], of).keys()].sort(), ['B2', 'B4']);
  assert.deepEqual([...ruleStyles([{ ref: 'B1:B5', kind: 'below' }], of).keys()].sort(), ['B1', 'B3', 'B5']);
  assert.deepEqual([...ruleStyles([{ ref: 'A1:A2', kind: 'text', a: 'ok' }], (r) => ({ A1: 'Looks OK', A2: 'no' })[r]).keys()], ['A1']);
});

test('color scales and data bars spread across the range', () => {
  const s = ruleStyles([{ ref: 'B1:B5', kind: 'scale' }], of);
  assert.equal(s.get('B5').bg, '#f8696b');
  assert.equal(s.get('B2').bg, '#63be7b');
  const b = ruleStyles([{ ref: 'B1:B5', kind: 'bars', color: '#638ec6|' }], of);
  assert.equal(b.get('B2').bar, 1);
  assert.ok(Math.abs(b.get('B1').bar - 5 / 12) < 1e-9);
});

test('filters hide rows whose values are not shown', () => {
  const grid = [['Name', 'City'], ['a', 'Pune'], ['b', 'Delhi'], ['c', 'Pune'], ['d', '']];
  const text = (r, c) => grid[r]?.[c] ?? '';
  const f = { ref: 'A1:B5', hide: { 1: ['Pune'] } };
  assert.deepEqual([...hiddenRows(f, text)], [2, 4]);
  assert.deepEqual(columnValues(f, 1, text), [{ text: 'Pune', count: 2 }, { text: 'Delhi', count: 1 }, { text: '', count: 1 }]);
  assert.equal(hiddenRows({ ref: 'A1:B5', hide: {} }, text).size, 0);
});

test('ranges follow inserted and deleted rows and columns', () => {
  assert.equal(shiftRange('B2:B10', 'row', 0, 2), 'B4:B12');
  assert.equal(shiftRange('B2:B10', 'row', 4, -2), 'B2:B8');
  assert.equal(shiftRange('B2:B3', 'row', 1, -2), null);
  assert.equal(shiftRange('B2:D10', 'col', 2, -1), 'B2:C10');
  assert.equal(shiftRange('B2:D10', 'col', 5, 1), 'B2:D10');
});

test('xlsx keeps frozen panes, the filter range, hidden rows and formatting rules', async () => {
  const cf = [
    { ref: 'B2:B5', kind: 'gt', a: '10', color: '#ffc7ce|#9c0006' },
    { ref: 'B2:B5', kind: 'between', a: '1', b: '5', color: '#c6efce|#006100' },
    { ref: 'A2:A5', kind: 'text', a: 'pune', color: '#ffeb9c|#9c5700' },
    { ref: 'A2:A5', kind: 'dup', color: '#ffc7ce|' },
    { ref: 'B2:B5', kind: 'top', a: '3', color: '|#c00000' },
    { ref: 'B2:B5', kind: 'below', color: '#ddebf7|#1f4e79' },
    { ref: 'C2:C5', kind: 'scale' },
    { ref: 'D2:D5', kind: 'bars', color: '#63be7b|' },
  ];
  const cells = { A1: { v: 'City' }, B1: { v: 'Sales' }, A2: { v: 'Pune' }, B2: { v: '12' }, A3: { v: 'Delhi' }, B3: { v: '3' } };
  const buf = await exportXlsx({ sheets: [{ name: 'S', cells, cols: {}, freeze: { rows: 1, cols: 1 }, filter: { ref: 'A1:B3', hide: { 0: ['Pune'] } }, hiddenRows: [2], cf }] });
  const back = (await importXlsx(buf)).sheets[0];
  assert.deepEqual(back.freeze, { rows: 1, cols: 1 });
  assert.equal(back.filter.ref, 'A1:B3');
  assert.deepEqual(back.cf, cf);
});
