import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { blankPage, buildPdf, openForEditing, paperOps } from '../src/pdf/pdf-edit.js';
import { addStroke, eraseInk } from '../src/pdf/annot-data.js';
import { erasePath, pathDistance, pointerPressure, pressureRuns, pressureScale, thinStroke } from '../src/shared/ink-stroke.js';

test('pen pressure sets the width, in a few runs', () => {
  assert.equal(pressureScale(0.5), 1);
  const path = [0, 0, 10, 0, 20, 0, 30, 0, 40, 0];
  assert.deepEqual(pressureRuns(path, null, 2), [{ w: 2, pts: path }]);
  const light = pressureRuns(path, [0.1, 0.1, 0.1, 0.1, 0.1], 2);
  assert.equal(light.length, 1);
  assert.ok(light[0].w < 2);
  const ramp = pressureRuns(path, [0, 0.25, 0.5, 0.75, 1], 2);
  assert.ok(ramp.length > 1);
  assert.ok(ramp.at(-1).w > ramp[0].w);
  // Runs join end to start, so the line has no gaps.
  for (let i = 1; i < ramp.length; i++) assert.deepEqual(ramp[i].pts.slice(0, 2), ramp[i - 1].pts.slice(-2));
  assert.equal(pointerPressure({ pointerType: 'mouse', pressure: 0.5 }), 0.5);
  assert.equal(pointerPressure({ pointerType: 'pen', pressure: 0.9 }), 0.9);
  assert.equal(pointerPressure({ pointerType: 'pen', pressure: 0 }), 0.5);
});

test('thinning keeps pressure in step with points', () => {
  const t = thinStroke([0, 0, 0.1, 0, 5, 0, 5.1, 0, 10, 0], [0.1, 0.2, 0.3, 0.4, 0.5], 1);
  assert.deepEqual(t.path, [0, 0, 5, 0, 10, 0]);
  assert.deepEqual(t.pressure, [0.1, 0.3, 0.5]);
});

test('the eraser rubs out part of a stroke or the whole stroke', () => {
  const line = [0, 0, 100, 0];
  assert.equal(pathDistance(line, 50, 10), 10);
  assert.equal(erasePath(line, null, 50, 20, 5), null);
  const pieces = erasePath(line, null, 50, 0, 5);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].path.at(-2) <= 45.01 && pieces[1].path[0] >= 54.99);
  const a = { id: 'x', type: 'ink', page: 0, paths: [line, [0, 50, 100, 50]], pressure: [[0.2, 0.8], null], width: 2 };
  assert.equal(eraseInk(a, 50, 200, 4, 'part'), a);
  const part = eraseInk(a, 50, 0, 4, 'part');
  assert.equal(part.paths.length, 3);
  assert.equal(part.pressure.length, 3);
  assert.ok(part.pressure[0].every((v) => v >= 0.2 && v <= 0.8));
  const whole = eraseInk(a, 50, 0, 4, 'stroke');
  assert.deepEqual(whole.paths, [[0, 50, 100, 50]]);
  assert.equal(whole.pressure, undefined);
  assert.equal(eraseInk(whole, 10, 50, 4, 'stroke'), null);
  const more = addStroke({ paths: [line] }, [1, 1, 2, 2], [0.5, 0.6]);
  assert.deepEqual(more.pressure, [null, [0.5, 0.6]]);
  assert.equal(addStroke({ paths: [line] }, [1, 1], null).pressure, undefined);
});

test('pressure and highlighter ink survive a save and reopen', async () => {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  const ink = [
    { id: 'p1', type: 'ink', page: 0, color: '#1f2328', opacity: 1, width: 2, paths: [[100, 100, 150, 120, 200, 100], [10, 10, 20, 20]], pressure: [[0.2, 0.6, 1], null] },
    { id: 'm1', type: 'ink', page: 0, color: '#ffd400', opacity: 0.4, width: 12, paths: [[100, 300, 300, 300]], marker: true },
  ];
  const { annots } = await openForEditing(await buildPdf(await d.save(), ink));
  const by = Object.fromEntries(annots.map((a) => [a.id, a]));
  assert.deepEqual(by.p1.pressure, [[0.2, 0.6, 1], null]);
  assert.equal(by.p1.marker, undefined);
  assert.equal(by.m1.marker, true);
  assert.equal(by.m1.pressure, undefined);
  assert.equal(by.m1.opacity, 0.4);
});

test('lined, grid and dotted pages can be added between pages', async () => {
  const d = await PDFDocument.create();
  d.addPage([595, 842]);
  d.addPage([595, 842]);
  await blankPage(d, 1, 'lined');
  await blankPage(d, 0, 'grid');
  await blankPage(d, 4, 'dots');
  assert.equal(d.getPageCount(), 5);
  assert.deepEqual(d.getPage(2).getSize(), { width: 595, height: 842 });
  assert.equal(paperOps('blank', 595, 842).length, 0);
  assert.ok(paperOps('lined', 595, 842).length > 40);
  const back = await PDFDocument.load(await d.save());
  assert.equal(back.getPageCount(), 5);
  // A page shown turned gives a new page the same shape on screen.
  const t = await PDFDocument.create();
  t.addPage([595, 842]).setRotation({ type: 'degrees', angle: 90 });
  await blankPage(t, 1, 'blank');
  assert.deepEqual(t.getPage(1).getSize(), { width: 842, height: 595 });
});
