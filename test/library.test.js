'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const lib = require('../common/library');

const paper = { type: 'article-journal', title: 'Attention Is All You Need', author: [{ family: 'Vaswani', given: 'Ashish' }], issued: [2017], 'container-title': 'NeurIPS', DOI: '10.5555/3295222.3295349' };

test('the library keeps one entry per paper and merges tags', () => {
  let { list } = lib.addItem([], paper, { tags: ['nlp'] });
  ({ list } = lib.addItem(list, { ...paper, DOI: paper.DOI.toUpperCase() }, { tags: 'transformers, nlp' }));
  assert.equal(list.length, 1);
  assert.deepEqual(list[0].tags, ['nlp', 'transformers']);
  ({ list } = lib.addItem(list, { title: 'Deep Residual Learning', issued: [2016], author: [{ family: 'He', given: 'Kaiming' }] }));
  assert.equal(list.length, 2);
  assert.ok(lib.matches(list[1], 'vaswani 2017'));
  assert.ok(!lib.matches(list[1], 'residual'));
  assert.deepEqual(lib.allTags(list), [{ tag: 'nlp', count: 1 }, { tag: 'transformers', count: 1 }]);
});

test('bibliographies sort by author, numbered styles keep their order', () => {
  const items = [paper, { title: 'Deep Residual Learning', issued: [2016], author: [{ family: 'He', given: 'Kaiming' }], type: 'paper-conference', 'container-title': 'CVPR' }];
  const apa = lib.bibliography(items, 'apa').text.split('\n\n');
  assert.match(apa[0], /^He, K\./);
  const ieee = lib.bibliography(items, 'ieee').text.split('\n\n');
  assert.match(ieee[0], /^\[1\] A\. Vaswani/);
  assert.match(lib.bibliography(items, 'bibtex').text, /@article\{vaswani2017attention[\s\S]*@inproceedings\{he2016deep/);
});

test('.bib and .ris files read back into references', () => {
  const bib = `@comment{x}
@article{v17,
  title = {Attention Is {All} You Need},
  author = {Vaswani, Ashish and Noam Shazeer},
  journal = "Advances in Neural Information Processing Systems",
  year = 2017, month = dec,
  pages = {5998--6008},
  doi = {10.5555/3295222.3295349},
  keywords = {nlp, transformers}
}
@book{k, title={The Art of Computer Programming}, author={Knuth, Donald E.}, publisher={Addison-Wesley}, year={1968}}`;
  const items = lib.parseBibtex(bib);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'Attention Is All You Need');
  assert.deepEqual(items[0].author, [{ family: 'Vaswani', given: 'Ashish' }, { family: 'Shazeer', given: 'Noam' }]);
  assert.deepEqual(items[0].issued, [2017, 12]);
  assert.equal(items[0].page, '5998–6008');
  assert.deepEqual(items[0].tags, ['nlp', 'transformers']);
  assert.equal(items[1].type, 'book');
  const ris = 'TY  - JOUR\r\nTI  - A title\r\nAU  - Doe, Jane\r\nPY  - 2020\r\nSP  - 1\r\nEP  - 9\r\nDO  - 10.1000/xyz\r\nKW  - tag1\r\nER  - \r\n';
  const r = lib.parseReferences(ris, 'x.ris');
  assert.deepEqual(r.map((x) => [x.title, x.page, x.DOI, x.tags]), [['A title', '1–9', '10.1000/xyz', ['tag1']]]);
});
