import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { appendTable, joinTable, tableOf } from '../src/sheets/combine.js';

const require = createRequire(import.meta.url);
const formats = require('../main/formats/index.js');

const people = tableOf([['Id', 'Name', 'Team'], ['007', 'Ann', 'A'], [2, 'Bo', 'B'], [3, 'Cy', null]]);
const scores = tableOf([['id', 'Score', 'Team'], ['007', 90, 'A'], [2, 75, 'B'], [2, 80, 'B'], [9, 60, 'C']]);

test('tableOf names blank and repeated headers', () => {
  const t = tableOf([['A', '', 'A'], [1, 2]]);
  assert.deepEqual(t.header, ['A', 'Column 2', 'A (2)']);
  assert.deepEqual(t.rows, [[1, 2, null]]);
});

test('Add rows matches columns by name and adds the rest', () => {
  const res = appendTable(people, scores, { source: { name: 'From', base: 'People', add: 'Scores' } });
  assert.deepEqual(res.header, ['Id', 'Name', 'Team', 'Score', 'From']);
  assert.equal(res.rows.length, 7);
  assert.deepEqual(res.rows[0], ['007', 'Ann', 'A', null, 'People']);
  assert.deepEqual(res.rows[3], ['007', null, 'A', 90, 'Scores']);
});

test('Add rows follows a mapping and leaves out skipped columns', () => {
  const res = appendTable(people, scores, { mapping: [{ from: 'id', to: 'Id' }, { from: 'Score', to: '' }, { from: 'Team', to: null }] });
  assert.deepEqual(res.header, ['Id', 'Name', 'Team', 'Team (2)']);
  assert.deepEqual(res.rows[6], [9, null, null, 'C']);
});

test('Add columns joins on keys as text, keeping row order for a left join', () => {
  const res = joinTable(people, scores, { keys: [{ base: 'Id', add: 'id' }], how: 'left', include: ['Score'] });
  assert.deepEqual(res.header, ['Id', 'Name', 'Team', 'Score']);
  assert.deepEqual(res.rows.map((r) => r[3]), [90, 75, 80, null]);
  assert.deepEqual(res.from, [0, 1, 1, 2]);
});

test('Inner, right and full joins', () => {
  const keys = [{ base: 'Id', add: 'id' }];
  assert.equal(joinTable(people, scores, { keys, how: 'inner' }).rows.length, 3);
  const right = joinTable(people, scores, { keys, how: 'right' });
  assert.deepEqual(right.rows.at(-1), [9, null, null, 60, 'C']);
  assert.deepEqual(right.header, ['Id', 'Name', 'Team', 'Score', 'Team (2)']);
  assert.equal(joinTable(people, scores, { keys, how: 'full' }).rows.length, 5);
  assert.throws(() => joinTable(people, scores, { keys: [] }));
});

test('readTable reads a tab-separated file into a sheet', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'combine-'));
  const file = path.join(dir, 'more.tsv');
  await fs.writeFile(file, 'Id\tScore\n1\t5\n');
  const got = await formats.readTable(file);
  assert.equal(got.name, 'more.tsv');
  assert.deepEqual(got.data.sheets[0].cells.B2, { v: '5' });
  await assert.rejects(formats.readTable(path.join(dir, 'x.docx')));
});
