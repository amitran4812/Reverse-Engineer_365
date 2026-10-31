'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { toFileInfo } = require('../main/generated');
const attachments = require('../main/attachments');
const { exportXlsx } = require('../main/formats/xlsx');

test('a spreadsheet from Claude becomes a bold header row and formula cells', async () => {
  const info = await toFileInfo({ kind: 'spreadsheet', title: 'Budget: 2026', sheets: [{ name: 'Plan', columns: ['Item', 'Cost'], rows: [['Rent', '1500'], ['Total', '=SUM(B2:B2)']] }] });
  assert.equal(info.app, 'sheets');
  assert.equal(info.name, 'Budget 2026');
  const s = info.data.sheets[0];
  assert.deepEqual(s.cells.A1, { v: 'Item', s: { b: true, bg: '#e8f3ec' } });
  assert.equal(s.cells.B3.v, '=SUM(B2:B2)');
  assert.equal(info.generated, true);
});

test('documents become HTML and presentations carry the deck spec', async () => {
  const doc = await toFileInfo({ kind: 'document', title: 'Memo', markdown: '# Hi\n\n- one' });
  assert.equal(doc.app, 'docs');
  assert.match(doc.data.html, /<h1>Hi<\/h1>/);
  const deck = await toFileInfo({ kind: 'presentation', title: 'Deck', theme: 'forest', slides: [{ layout: 'title', title: 'A', subtitle: '', bullets: [], right_bullets: [], notes: '' }] });
  assert.equal(deck.app, 'slides');
  assert.equal(deck.data.theme, 'forest');
  assert.equal(deck.data.deckSpec.slides.length, 1);
  await assert.rejects(toFileInfo({ kind: 'answer', title: 'x' }));
});

test('attachments: PDFs go as documents, spreadsheets and text as text, unknown types are refused', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-att-'));
  fs.writeFileSync(path.join(dir, 'a.pdf'), '%PDF-1.4 test');
  fs.writeFileSync(path.join(dir, 'b.csv'), 'x,y\n1,2\n');
  fs.writeFileSync(path.join(dir, 'c.xlsx'), await exportXlsx({ sheets: [{ name: 'S', cells: { A1: { v: 'Qty' }, A2: { v: '3' }, A3: { v: '=A2*2' } } }] }));
  fs.writeFileSync(path.join(dir, 'd.exe'), 'nope');
  const got = await attachments.loadAll(['a.pdf', 'b.csv', 'c.xlsx', 'd.exe'].map((f) => path.join(dir, f)));
  assert.deepEqual(got.map((g) => g.kind || 'error'), ['pdf', 'text', 'spreadsheet', 'error']);
  const blocks = attachments.blocks(got.slice(0, 3).map((g) => g.id));
  assert.equal(blocks[0].type, 'document');
  assert.equal(blocks[0].source.media_type, 'application/pdf');
  assert.match(blocks[1].text, /<attachment name="b.csv">\nx,y/);
  assert.match(blocks[2].text, /Sheet "S"[\s\S]*=A2\*2/);
});

test('a slide made in Plot opens as a new presentation in Present', async () => {
  const info = await toFileInfo({ kind: 'deck', title: 'Sales', theme: 'midnight', slides: [{ id: 's1', layout: 'blank', elements: [
    { id: 'a', type: 'text', role: 'title', x: 36, y: 18, w: 888, h: 56, html: 'Sales' },
    { id: 'b', type: 'image', x: 36, y: 100, w: 400, h: 300, src: 'data:image/png;base64,AA' },
    { id: 'c', type: 'table', x: 500, y: 100, w: 300, h: 80, rows: [['Year'], ['2021']] },
    { type: 'image', src: 'x' },
    { id: 'd', type: 'script' },
  ] }] });
  assert.equal(info.app, 'slides');
  assert.equal(info.generated, true);
  assert.equal(info.data.theme, 'midnight');
  assert.deepEqual(info.data.slides[0].elements.map((e) => e.id), ['a', 'b', 'c']);
});

test('a slide sent with an uploaded template carries the template along', async () => {
  const themeData = { id: 'u0123456789ab', custom: true, label: 'Company', bg: '#ffffff', text: '#222222', title: '#111111', accent: '#c00000', font: 'Arial', decor: [] };
  const info = await toFileInfo({ kind: 'deck', title: 'Sales', theme: themeData.id, themeData, slides: [] });
  assert.equal(info.data.theme, themeData.id);
  assert.equal(info.data.themeData.label, 'Company');
  const missing = await toFileInfo({ kind: 'deck', title: 'Sales', theme: 'u999999999999', slides: [] });
  assert.equal(missing.data.theme, 'paper');
  assert.equal(missing.data.themeData, undefined);
});
