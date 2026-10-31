import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { buildPdf, deletePages, insertPdf, movePage, openForEditing, rotatePages } from '../src/pdf/pdf-edit.js';
import { findArxiv, findDoi, linesToTable, mergeLineRects, moveAnnot, pagesToMarkdown, quadsToRects, rectsToQuads, rgbToHex, textLines, thinPath } from '../src/pdf/annot-data.js';

async function samplePdf(pages = 1) {
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < pages; i++) d.addPage([612, 792]).drawText(`Page ${i + 1}`, { x: 72, y: 700, size: 14, font: f });
  return d.save();
}

const ANNOTS = [
  { id: 'a1', type: 'highlight', page: 0, color: '#ffd400', opacity: 0.5, rects: [[72, 696, 160, 712]], note: 'nice', author: 'Amit' },
  { id: 'a2', type: 'ink', page: 0, color: '#ff0000', opacity: 1, paths: [[100, 100, 120, 130, 140, 100]], width: 2 },
  { id: 'a3', type: 'rect', page: 0, color: '#0000ff', opacity: 1, rect: [200, 200, 300, 260], width: 2, fill: '#eeeeff' },
  { id: 'a4', type: 'arrow', page: 0, color: '#000000', opacity: 1, line: [300, 300, 400, 350], width: 1.5 },
  { id: 'a5', type: 'note', page: 0, color: '#ffd400', opacity: 1, at: [500, 700], note: 'Sticky ünïcode ✓' },
  { id: 'a6', type: 'text', page: 0, color: '#222222', rect: [72, 500, 300, 560], text: 'A text box that wraps ✓', size: 12 },
  { id: 'a7', type: 'ellipse', page: 0, color: '#00aa00', opacity: 1, rect: [350, 400, 450, 450], width: 1 },
  { id: 'a8', type: 'underline', page: 0, color: '#2f5aa8', opacity: 1, rects: [[72, 650, 200, 664]] },
];

test('annotations survive a save and reopen', async () => {
  const saved = await buildPdf(await samplePdf(), ANNOTS);
  const { annots, viewBytes } = await openForEditing(saved);
  assert.equal(annots.length, ANNOTS.length);
  const by = Object.fromEntries(annots.map((a) => [a.id, a]));
  assert.deepEqual(by.a1.rects, [[72, 696, 160, 712]]);
  assert.equal(by.a1.note, 'nice');
  assert.equal(by.a1.author, 'Amit');
  assert.equal(by.a1.opacity, 0.5);
  assert.deepEqual(by.a2.paths, [[100, 100, 120, 130, 140, 100]]);
  assert.deepEqual(by.a3.rect, [200, 200, 300, 260]);
  assert.equal(by.a3.fill, '#eeeeff');
  assert.equal(by.a4.type, 'arrow');
  assert.equal(by.a5.note, 'Sticky ünïcode ✓');
  assert.deepEqual(by.a5.at, [500, 700]);
  assert.equal(by.a6.text, 'A text box that wraps ✓');
  assert.equal(by.a6.size, 12);
  assert.equal(by.a6.color, '#222222');
  assert.equal(by.a7.type, 'ellipse');
  assert.equal(by.a8.type, 'underline');
  // The reopened page has none of them left, so they aren't drawn twice.
  const again = await openForEditing(viewBytes);
  assert.equal(again.annots.length, 0);
});

test('a PDF without annotations keeps its bytes', async () => {
  const bytes = await samplePdf();
  const r = await openForEditing(bytes);
  assert.equal(r.viewBytes, bytes);
});

test('signatures are drawn into the page', async () => {
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const saved = await buildPdf(await samplePdf(), [{ id: 's', type: 'image', page: 0, rect: [100, 100, 200, 140], src: png }]);
  const { annots } = await openForEditing(saved);
  assert.equal(annots.length, 0);
  const doc = await PDFDocument.load(saved);
  assert.ok(doc.getPage(0).node.Resources().toString().includes('XObject'));
});

test('page tools', async () => {
  const doc = await PDFDocument.load(await samplePdf(3));
  await rotatePages(doc, [0], 90);
  assert.equal(doc.getPage(0).getRotation().angle, 90);
  await movePage(doc, 0, 2);
  assert.equal(doc.getPage(2).getRotation().angle, 90);
  deletePages(doc, [1]);
  assert.equal(doc.getPageCount(), 2);
  assert.equal(await insertPdf(doc, await samplePdf(2), 1), 2);
  assert.equal(doc.getPageCount(), 4);
});

test('selection boxes join into lines', () => {
  const merged = mergeLineRects([[10, 100, 50, 112], [52, 100, 90, 112], [10, 80, 60, 92]]);
  assert.deepEqual(merged, [[10, 100, 90, 112], [10, 80, 60, 92]]);
  assert.deepEqual(quadsToRects(rectsToQuads(merged)), merged);
  assert.deepEqual(moveAnnot({ type: 'note', at: [1, 2] }, 3, 4).at, [4, 6]);
  assert.equal(thinPath([0, 0, 0.1, 0.1, 5, 5]).length, 4);
  assert.equal(rgbToHex([1, 0.5, 0]), '#ff8000');
  assert.equal(rgbToHex([0.5]), '#808080');
});

test('text becomes markdown and tables', () => {
  const items = [
    { str: 'Report title', x: 72, y: 720, w: 150, h: 24 },
    { str: 'First line of text', x: 72, y: 690, w: 100, h: 10 },
    { str: 'continues here.', x: 72, y: 678, w: 90, h: 10 },
    { str: '• A point', x: 72, y: 650, w: 60, h: 10 },
  ];
  const mdText = pagesToMarkdown([textLines(items)]);
  assert.match(mdText, /^# Report title/);
  assert.match(mdText, /First line of text continues here\./);
  assert.match(mdText, /- A point/);
  const grid = linesToTable(textLines([
    { str: 'Name', x: 72, y: 700, w: 30, h: 10 }, { str: 'Score', x: 200, y: 700, w: 30, h: 10 },
    { str: 'Ann', x: 72, y: 686, w: 20, h: 10 }, { str: '91', x: 200, y: 686, w: 12, h: 10 },
    { str: 'Bob', x: 72, y: 672, w: 20, h: 10 }, { str: '78', x: 200, y: 672, w: 12, h: 10 },
  ]));
  assert.deepEqual(grid, [['Name', 'Score'], ['Ann', '91'], ['Bob', '78']]);
});

test('paper ids are found in text', () => {
  assert.equal(findDoi('see https://doi.org/10.1145/3290605.3300233.'), '10.1145/3290605.3300233');
  assert.equal(findArxiv('arXiv:2106.09685v2 [cs.CL]'), '2106.09685v2');
});

test('text boxes on turned pages keep the turn they were placed with', async () => {
  const doc = await PDFDocument.load(await samplePdf());
  await rotatePages(doc, [0], 90);
  const saved = await buildPdf(await doc.save(), [{ id: 't', type: 'text', page: 0, rect: [100, 100, 140, 300], text: 'Upright', size: 12, color: '#000000', rot: 90 }]);
  const { annots } = await openForEditing(saved);
  assert.equal(annots[0].rot, 90);
  assert.equal(annots[0].text, 'Upright');
});
