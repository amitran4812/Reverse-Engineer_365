'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Module = require('module');
const text = require('../common/project-text');

// main/projects.js only needs app.getPath('userData') from Electron.
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'work-projects-'));
const resolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  return req === 'electron' ? 'electron-stub' : resolve.call(this, req, ...rest);
};
require.cache['electron-stub'] = { id: 'electron-stub', filename: 'electron-stub', loaded: true, exports: { app: { getPath: () => userData } } };
const projects = require('../main/projects');

test('share gives short texts all they need and splits the rest', () => {
  assert.deepStrictEqual(text.share([10, 1000, 1000], 610), [10, 300, 300]);
  assert.deepStrictEqual(text.share([5, 6], 100), [5, 6]);
  assert.strictEqual(text.share([400, 400, 400, 50], 1000).reduce((a, b) => a + b), 1000);
});

test('kinds and build output', () => {
  assert.strictEqual(text.kindOf('PDF'), 'pdf');
  assert.strictEqual(text.kindOf('tex'), 'latex');
  assert.strictEqual(text.kindOf('py'), 'text');
  assert.strictEqual(text.kindOf('pptx'), 'presentation');
  assert.strictEqual(text.kindOf('zip'), 'other');
  assert.ok(text.isBuildOutput('main.aux') && text.isBuildOutput('main.synctex.gz'));
  assert.ok(!text.isBuildOutput('main.tex'));
});

test('xmlText keeps paragraphs on their own lines', () => {
  assert.strictEqual(text.xmlText('<a:p><a:r><a:t>One &amp; two</a:t></a:r></a:p><a:p><a:t>Three</a:t></a:p>'), 'One & two\nThree');
});

test('a project holds copies, links and folders, and Claude gets all of them', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'work-src-'));
  fs.writeFileSync(path.join(src, 'notes.md'), '# Notes\nThe effect is 42.');
  fs.writeFileSync(path.join(src, 'draft.txt'), 'first draft');
  const tex = path.join(src, 'paper');
  fs.mkdirSync(path.join(tex, 'sections'), { recursive: true });
  fs.writeFileSync(path.join(tex, 'main.tex'), '\\documentclass{article}\\begin{document}\\input{sections/intro}\\end{document}');
  fs.writeFileSync(path.join(tex, 'sections', 'intro.tex'), 'We study things.');
  fs.writeFileSync(path.join(tex, 'main.aux'), 'build output');
  fs.writeFileSync(path.join(tex, 'refs.bib'), '@article{a, title={A}}');
  fs.writeFileSync(path.join(src, 'paper.pdf'), '%PDF-1.4 not really');

  const p = await projects.create({ name: 'Thesis', instructions: 'Chapter 3 review' });
  const copied = await projects.addFiles(p.id, [path.join(src, 'notes.md'), path.join(src, 'paper.pdf')], { copy: true });
  assert.strictEqual(copied.added.length, 2);
  // A file made earlier joins later, as a link.
  const linked = await projects.addFiles(p.id, [path.join(src, 'draft.txt'), tex]);
  assert.deepStrictEqual(linked.added.map((x) => x.type), ['link', 'folder']);
  assert.strictEqual((await projects.addFiles(p.id, [path.join(src, 'draft.txt')])).skipped.length, 1);

  const got = await projects.get(p.id);
  assert.deepStrictEqual(got.files.map((f) => f.rel).sort(), ['draft.txt', 'notes.md', 'paper.pdf', 'paper/main.tex', 'paper/refs.bib', 'paper/sections/intro.tex']);
  const pdf = got.files.find((f) => f.kind === 'pdf');
  assert.strictEqual(pdf.hasText, false);
  await projects.saveText(p.id, pdf.key, 'Abstract: a paper about things.');

  assert.deepStrictEqual((await projects.forPath(path.join(tex, 'sections', 'intro.tex'))).map((x) => x.name), ['Thesis']);
  assert.deepStrictEqual(await projects.forPath(path.join(src, 'elsewhere.txt')), []);

  // Linked files are read fresh.
  fs.writeFileSync(path.join(src, 'draft.txt'), 'second draft');
  const ctx = await projects.context(p.id);
  const all = ctx.blocks.map((b) => b.text || '').join('\n');
  assert.match(all, /<instructions>\nChapter 3 review/);
  assert.match(all, /second draft/);
  assert.match(all, /We study things/);
  assert.match(all, /Abstract: a paper about things/);
  assert.match(all, /The effect is 42/);
  assert.doesNotMatch(all, /build output/);

  const draft = got.items.find((x) => x.type === 'link');
  await projects.removeItem(p.id, draft.id);
  assert.strictEqual((await projects.get(p.id)).files.length, 5);
  assert.ok(fs.existsSync(path.join(src, 'draft.txt')), 'removing a link keeps the original');
  await projects.remove(p.id);
  assert.deepStrictEqual(await projects.list(), []);
});

test('reads Office files as text', async () => {
  const JSZip = require('jszip');
  const zip = new JSZip();
  zip.file('ppt/slides/slide2.xml', '<p:sld><a:p><a:t>Second</a:t></a:p></p:sld>');
  zip.file('ppt/slides/slide1.xml', '<p:sld><a:p><a:t>First</a:t></a:p></p:sld>');
  const out = await projects.extract(await zip.generateAsync({ type: 'nodebuffer' }), 'pptx');
  assert.ok(out.indexOf('First') < out.indexOf('Second'));
  const deck = await projects.extract(Buffer.from(JSON.stringify({ slides: [{ title: 'Hello', image: 'data:image/png;base64,AAAA' }] })), 'reaslides');
  assert.strictEqual(deck, 'Hello');
  assert.strictEqual(await projects.extract(Buffer.from('x'), 'zip'), null);
});

test('a project keeps the reference found for each paper', async () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'work-refs-'));
  const pdf = path.join(src, 'smith.pdf');
  fs.writeFileSync(pdf, '%PDF-1.4 one');
  const p = await projects.create({ name: 'Refs' });
  await projects.addFiles(p.id, [pdf, path.join(src, 'x.txt')].filter(fs.existsSync));
  let list = await projects.papers(p.id);
  assert.strictEqual(list.length, 1);
  assert.strictEqual(list[0].ref, null);
  await projects.saveRef(p.id, pdf, { title: 'A Study', author: [{ family: 'Smith' }] }, { match: 'id' });
  list = await projects.papers(p.id);
  assert.strictEqual(list[0].ref.title, 'A Study');
  assert.strictEqual(list[0].match, 'id');
  // A changed PDF is looked up again, unless the user fixed its details by hand.
  fs.writeFileSync(pdf, '%PDF-1.4 changed and longer');
  assert.strictEqual((await projects.papers(p.id))[0].ref, null);
  await projects.saveRef(p.id, pdf, { title: 'Fixed' }, { edited: true });
  fs.writeFileSync(pdf, '%PDF-1.4 changed again, even longer');
  assert.strictEqual((await projects.papers(p.id))[0].ref.title, 'Fixed');
  await assert.rejects(projects.saveRef(p.id, path.join(src, 'other.pdf'), { title: 'x' }));
});
