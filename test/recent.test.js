'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { mergeRecent, filterRecent, nameOf, placeOf, whenOf, isStale, sortRecent } = require('../common/recent');

test('new files go on top and keep what was known about them', () => {
  let list = [];
  list = mergeRecent(list, { app: 'docs', path: '/a.docx', at: 1 });
  list = mergeRecent(list, { app: 'sheets', path: '/b.xlsx', at: 2, cloud: { provider: 'google', id: 'x', name: 'b.xlsx', label: 'Google Drive' } });
  list = mergeRecent(list, { app: 'docs', path: '/a.docx', at: 3, kind: 'notes' });
  assert.deepEqual(list.map((r) => r.path), ['/a.docx', '/b.xlsx']);
  assert.equal(list[0].kind, 'notes');
  list = mergeRecent(list, { app: 'sheets', path: '/b.xlsx', at: 4, kind: null });
  assert.equal(list[0].cloud.id, 'x', 'reopening keeps the cloud copy');
  list = mergeRecent(list, { app: 'docs', path: '/a.docx', at: 5, kind: null });
  assert.equal('kind' in list[0], false, 'null clears a field');
});

test('pinned files stay on top and never fall off', () => {
  let list = [{ app: 'pdf', path: '/old.pdf', at: 0, pinned: true }];
  for (let i = 1; i <= 5; i++) list = mergeRecent(list, { app: 'docs', path: `/${i}.docx`, at: i }, 3);
  assert.deepEqual(list.map((r) => r.path), ['/old.pdf', '/5.docx', '/4.docx', '/3.docx']);
  assert.equal(sortRecent([{ path: 'a', at: 9 }, { path: 'b', at: 1, pinned: true }])[0].path, 'b');
});

test('filters by app, Write mode and search text', () => {
  const list = [
    { app: 'docs', path: '/w/report.docx', at: 3 },
    { app: 'docs', kind: 'notes', path: '/w/class notes.docx', at: 2 },
    { app: 'docs', kind: 'latex', path: '/tex/paper/main.tex', at: 1 },
    { app: 'sheets', path: 'C:\\cache\\budget.xlsx', at: 4, cloud: { provider: 'google', name: 'Budget.xlsx', label: 'Google Drive', native: 'Google Sheets' } },
  ];
  assert.deepEqual(filterRecent(list, 'docs').map(nameOf), ['report.docx']);
  assert.deepEqual(filterRecent(list, 'notes').map(nameOf), ['class notes.docx']);
  assert.deepEqual(filterRecent(list, 'latex').map(nameOf), ['main.tex']);
  assert.deepEqual(filterRecent(list, 'all', 'budget').map(nameOf), ['Budget.xlsx']);
  assert.deepEqual(filterRecent(list, 'all', 'google').map(nameOf), ['Budget.xlsx']);
  assert.equal(placeOf(list[3]), 'Google Drive · Google Sheets');
  assert.equal(placeOf(list[2]), '/tex/paper');
});

test('a cached cloud copy is stale only when the drive has a newer one', () => {
  assert.equal(isStale('2026-11-04T10:00:00Z', '2026-11-04T10:00:00.000Z'), false);
  assert.equal(isStale('2026-11-04T10:00:00Z', '2026-11-04T11:00:00Z'), true);
  assert.equal(isStale('2026-11-04T10:00:00Z', null), false);
  assert.equal(isStale(null, '2026-11-04T10:00:00Z'), true);
});

test('times read naturally', () => {
  const now = new Date(2026, 10, 4, 15, 0).getTime();
  assert.equal(whenOf(now - 10_000, now), 'Just now');
  assert.equal(whenOf(now - 5 * 60_000, now), '5 min ago');
  assert.equal(whenOf(new Date(2026, 10, 3, 9, 0).getTime(), now), 'Yesterday');
});
