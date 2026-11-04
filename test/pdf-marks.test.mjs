import test from 'node:test';
import assert from 'node:assert/strict';
import { marksToMarkdown, textUnder } from '../src/pdf/annot-data.js';

const items = [
  { str: 'The quick brown fox jumps', x: 100, y: 700, w: 250, h: 12, flat: true },
  { str: 'over the lazy dog.', x: 100, y: 685, w: 180, h: 12, flat: true },
  { str: 'Another paragraph here.', x: 100, y: 640, w: 230, h: 12, flat: true },
];

test('highlights pick out just the text they cover', () => {
  assert.equal(textUnder(items, [[200, 698, 350, 712]]), 'brown fox jumps');
  assert.equal(textUnder(items, [[100, 698, 350, 712], [100, 683, 280, 697]]), 'The quick brown fox jumps over the lazy dog.');
  assert.equal(textUnder(items, [[0, 0, 10, 10]]), '');
});

test('highlights and comments become notes page by page', () => {
  const md = marksToMarkdown('Paper', [
    { page: 2, type: 'highlight', text: 'later', note: '' },
    { page: 0, type: 'highlight', text: 'first quote', note: 'Why?' },
    { page: 0, type: 'note', text: '', note: 'Check the method' },
  ]);
  assert.equal(md, '# Notes on Paper\n\n## Page 1\n\n> first quote\n\n- Why?\n\n- **Note:** Check the method\n\n## Page 3\n\n> later');
});
