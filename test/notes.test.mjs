import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { cleanSvg, findLinks, formatBytes, formatDuration, matchCommands, normalizeChart, svgSize } from '../src/docs/notes-data.js';

const require = createRequire(import.meta.url);
const { exportDocx, importDocx, boxLines, boardItems, equations } = require('../main/formats/docx');
const { taskLists } = require('../main/generated');
const { pageText, youtubeId, captionTracks, captionText } = require('../main/links');
const JSZip = require('jszip');

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

test('file sizes and lengths read naturally', () => {
  assert.equal(formatBytes(512), '512 B');
  assert.equal(formatBytes(1536), '1.5 KB');
  assert.equal(formatBytes(482113), '471 KB');
  assert.equal(formatBytes(5 * 1048576), '5 MB');
  assert.equal(formatBytes(-1), '');
  assert.equal(formatDuration(0), '0:00');
  assert.equal(formatDuration(65.4), '1:05');
  assert.equal(formatDuration(3725), '1:02:05');
});

test('YouTube links and captions are read', () => {
  assert.equal(youtubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=10'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://youtu.be/dQw4w9WgXcQ?si=x'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(youtubeId('https://example.com/watch?v=dQw4w9WgXcQ'), null);
  const html = 'var x = {"captions":{"playerCaptionsTracklistRenderer":{"captionTracks":[{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=de","languageCode":"de","name":{"simpleText":"German"}},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en&kind=asr","languageCode":"en","kind":"asr"},{"baseUrl":"https://www.youtube.com/api/timedtext?v=1&lang=en","languageCode":"en"}],"audioTracks":[]}}};';
  const tracks = captionTracks(html);
  assert.ok(tracks.length >= 1);
  assert.match(tracks[0].baseUrl, /lang=en$/, 'English captions written by people come first');
  assert.deepEqual(captionTracks('<html>no captions</html>'), []);
  const json3 = { events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: 'Welcome to' }, { utf8: ' the review.' }] },
    { tStartMs: 2000, dDurationMs: 1000, segs: [{ utf8: '\n' }] },
    { tStartMs: 2100, dDurationMs: 1500, segs: [{ utf8: 'First, budgets.' }] },
    { tStartMs: 9000, dDurationMs: 1500, segs: [{ utf8: 'Next topic: hiring.' }] },
  ] };
  const text = captionText(json3);
  assert.match(text, /Welcome to the review\. First, budgets\./);
  assert.match(text, /\nNext topic: hiring\./, 'a long pause starts a new line');
});

test('notes keep voice notes, attachments and free boxes in Word files', async () => {
  const json = { type: 'doc', content: [
    { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Standup' }] },
    { type: 'noteFile', attrs: { kind: 'audio', name: 'Voice note', type: 'audio/webm', size: 2048, duration: 75, transcript: 'Ship on Friday.', src: 'data:audio/webm;base64,AAAA' } },
    { type: 'noteFile', attrs: { kind: 'file', name: 'Budget.pdf', type: 'application/pdf', size: 482113, src: 'data:application/pdf;base64,JVBERi0xLjQK' } },
    { type: 'noteBoard', attrs: { height: 300, items: [{ id: 'b', x: 300, y: 20, w: 200, html: 'Right box' }, { id: 'a', x: 10, y: 24, w: 200, html: 'Left <b>box</b><br>line two' }, { id: 'c', x: 40, y: 200, w: 200, html: 'Lower' }] } },
  ] };
  const buf = await exportDocx({ json, title: 'Standup', notes: true });
  const zip = await JSZip.loadAsync(buf);
  assert.ok(zip.file('work/notes.json'), 'the editor copy is saved');
  assert.match(await zip.file('[Content_Types].xml').async('string'), /Extension="json"/);
  const body = await zip.file('word/document.xml').async('string');
  assert.match(body, /Voice note 1:15/);
  assert.match(body, /Ship on Friday\./);
  assert.match(body, /Budget\.pdf \(471 KB\)/);
  assert.ok(body.indexOf('Left box') < body.indexOf('Right box') && body.indexOf('Right box') < body.indexOf('Lower'), 'boxes read top to bottom, left to right');

  const back = await importDocx(buf);
  assert.equal(back.notes, true);
  assert.deepEqual(back.json, json, 'reopening gives back the same notes');

  // Edited in Word: the editor copy no longer matches, so the Word text wins.
  zip.file('word/document.xml', body.replace('Ship on Friday.', 'Ship on Monday.'));
  const edited = await importDocx(await zip.generateAsync({ type: 'nodebuffer' }));
  assert.equal(edited.json, undefined);
  assert.match(edited.html, /Ship on Monday\./);

  const doc = await exportDocx({ json, title: 'Doc' });
  assert.equal((await JSZip.loadAsync(doc)).file('work/notes.json'), null, 'documents don\u2019t carry the notes copy');
});

test('box text and equations survive plain formats', () => {
  assert.deepEqual(boxLines('<b>Hi</b> &amp; bye<br>two<div>three</div>'), ['Hi & bye', 'two', 'three']);
  assert.deepEqual(boardItems({ attrs: { items: '[{"x":5,"y":50},{"x":1,"y":2}]' } }).map((i) => i.y), [2, 50]);
  assert.equal(equations('<p><img src="data:x" alt="Equation: E = mc^2"></p>'), '<p><img src="data:x" alt="E = mc^2" title="Equation"></p>');
});
