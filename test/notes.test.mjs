import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanSvg, findLinks, matchCommands, normalizeChart, svgSize } from '../src/docs/notes-data.js';

const require = createRequire(import.meta.url);
const { exportDocx, importDocx } = require('../main/formats/docx');
const { taskLists } = require('../main/generated');
const { pageText } = require('../main/links');

test('chart specs are tidied before drawing', () => {
  const spec = normalizeChart({
    title: 'Sales', type: 'line', x_label: 'Month', y_label: '$', labels: ['Jan', 'Feb'], x_values: [],
    series: [{ name: 'A', values: [1, '2', 3] }, { name: 'empty', values: ['x'] }],
  });
  assert.equal(spec.type, 'line');
  assert.equal(spec.series.length, 1, 'series with no numbers are dropped');
  assert.deepEqual(spec.series[0].values, [1, 2, 3]);
  assert.deepEqual(spec.labels, ['Jan', 'Feb', '3'], 'labels are padded to the data');
  assert.equal(spec.x, null);
  const fn = normalizeChart({ type: 'line', labels: [], x_values: [0, 1, 2], series: [{ name: 'y', values: [0, 1, 4] }] });
  assert.deepEqual(fn.x, [0, 1, 2], 'numeric x stays numeric');
  assert.equal(normalizeChart({ type: 'bar', x_values: [0, 1], series: [{ values: [1, 2] }] }).x, null, 'bars always use categories');
  assert.equal(normalizeChart({ type: 'pie', series: [{ values: [1] }, { values: [2] }] }).series.length, 1);
  assert.equal(normalizeChart({ series: [] }), null);
  assert.equal(normalizeChart({ type: 'weird', series: [{ values: [1] }] }).type, 'bar');
});

test('AI drawings are stripped to a safe SVG', () => {
  const svg = cleanSvg('Here: <svg viewBox="0 0 400 200" onload="x()"><script>alert(1)</script><image href="https://evil/x.png"/><use href="#a"/><rect width="5" height="5"/></svg> done');
  assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(!/script|onload|evil/.test(svg));
  assert.ok(svg.includes('href="#a"'), 'internal references stay');
  assert.deepEqual(svgSize(svg), { width: 400, height: 200 });
  assert.deepEqual(svgSize('<svg width="30" height="20">'), { width: 30, height: 20 });
  assert.equal(cleanSvg('no picture'), null);
});

test('links are found in notes text', () => {
  assert.deepEqual(findLinks('see https://a.com/x, and (https://b.org/y). again https://a.com/x'), ['https://a.com/x', 'https://b.org/y']);
});

test('the / menu matches labels and keywords', () => {
  const items = [{ label: 'Checklist', keys: ['todo'] }, { label: 'Time stamp', keys: ['now'] }, { label: 'Table' }];
  assert.deepEqual(matchCommands(items, 'to').map((i) => i.label), ['Checklist']);
  assert.deepEqual(matchCommands(items, 'st').map((i) => i.label), ['Time stamp']);
  assert.deepEqual(matchCommands(items, 't').map((i) => i.label), ['Checklist', 'Time stamp', 'Table']);
  assert.equal(matchCommands(items, '').length, 3);
});

test('notes save to .docx with checklists and reopen as notes', async () => {
  const json = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Standup' }] },
    { type: 'taskList', content: [
      { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship beta' }] }] },
      { type: 'taskItem', attrs: { checked: false }, content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Write email' }] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'draft' }] }] }] },
      ] },
    ] },
  ] };
  const notes = await importDocx(await exportDocx({ json, title: 'Standup', notes: true }));
  assert.equal(notes.notes, true);
  assert.match(notes.html, /<ul data-type="taskList"><li data-type="taskItem" data-checked="true"><p>Ship beta<\/p><\/li><li data-type="taskItem" data-checked="false"><p>Write email<\/p><\/li><\/ul>/);
  assert.match(notes.html, /draft/);
  const doc = await importDocx(await exportDocx({ json, title: 'Standup' }));
  assert.equal(doc.notes, false, 'documents stay documents');
});

test('generated notes keep Markdown task lists as checklists', () => {
  const html = taskLists('<ul>\n<li><input checked="" disabled="" type="checkbox"> Done</li>\n<li><input disabled="" type="checkbox"> Todo</li>\n</ul>\n<ul>\n<li>plain</li>\n</ul>');
  assert.match(html, /<ul data-type="taskList">\n<li data-type="taskItem" data-checked="true">Done<\/li>\n<li data-type="taskItem" data-checked="false">Todo<\/li>/);
  assert.match(html, /<ul>\n<li>plain/);
});

test('web pages are reduced to readable text', () => {
  const page = pageText('<html><head><title>Q3 &amp; plans</title><style>p{}</style></head><body><nav>Menu</nav><h1>Plan</h1><p>We grow.</p><script>x()</script><p>Then&nbsp;ship.</p></body></html>');
  assert.equal(page.title, 'Q3 & plans');
  assert.equal(page.text, 'Plan\nWe grow.\nThen ship.');
});

test('checklists keep their boxes when notes go to Present', async () => {
  const { readDocument } = await import('../src/docs/deck.js');
  const doc = readDocument({ type: 'doc', content: [{ type: 'taskList', content: [
    { type: 'taskItem', attrs: { checked: true }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ship' }] }] },
    { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Email' }] }] },
  ] }] });
  assert.deepEqual(doc.blocks, [{ type: 'list', items: [{ text: '☑ Ship', depth: 0 }, { text: '☐ Email', depth: 0 }] }]);
});
