'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const JSZip = require('jszip');
const { exportDocx, importDocx } = require('../main/formats/docx');
const { applyCommentMarkers, headingOutline, readCommentsXml } = require('../common/outline');

const cm = (id, text) => ({ type: 'comment', attrs: { id, text, author: 'Amit R', date: '2026-11-04T10:00:00.000Z', resolved: false } });
const doc = { type: 'doc', content: [
  { type: 'tableOfContents' },
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Intro' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Hello ' }, { type: 'text', text: 'world', marks: [cm('a1', 'Check this')] }, { type: 'text', text: ' and more.' }] },
  { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Methods & data' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Across', marks: [cm('b2', 'Two\nlines')] }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'paragraphs', marks: [cm('b2', 'Two\nlines')] }, { type: 'text', text: ' end' }] },
] };

test('headings make an outline', () => {
  assert.deepEqual(headingOutline(doc), [{ index: 0, level: 1, text: 'Intro' }, { index: 1, level: 2, text: 'Methods & data' }]);
});

test('.docx keeps comments as Word comments and the table of contents', async () => {
  const buf = await exportDocx({ json: doc, title: 'T' });
  const zip = await JSZip.loadAsync(buf);
  const comments = readCommentsXml(await zip.file('word/comments.xml').async('string'));
  assert.deepEqual(Object.values(comments).map((c) => c.text), ['Check this', 'Two\nlines']);
  const xml = await zip.file('word/document.xml').async('string');
  assert.equal((xml.match(/<w:commentRangeStart /g) || []).length, 2);
  assert.match(xml, /w:anchor="_Toc_w1"/);
  const back = await importDocx(buf);
  assert.match(back.html, /^<div data-toc=""><\/div>/);
  assert.match(back.html, /<span data-comment-id="w0" data-comment-text="Check this" data-comment-author="Amit R"[^>]*>world<\/span> and more/);
  assert.equal((back.html.match(/data-comment-id="w1"/g) || []).length, 2);
});

test('comment markers stay well formed across paragraphs', () => {
  const c = { 0: { text: 'a', author: 'x', date: '' }, 1: { text: 'b', author: 'y', date: '' } };
  const html = applyCommentMarkers('<p>⟦c0⟧one ⟦c1⟧two⟦/c0⟧ three</p><p>four⟦/c1⟧</p>', c);
  assert.equal((html.match(/<span/g) || []).length, (html.match(/<\/span>/g) || []).length);
  assert.match(html, /<p><span data-comment-id="w1"[^>]*>four<\/span><\/p>$/);
});
