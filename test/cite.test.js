'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const cite = require('../common/cite');

const NATURE = {
  type: 'journal-article',
  title: 'Deep learning',
  author: [{ given: 'Yann', family: 'LeCun' }, { given: 'Yoshua', family: 'Bengio' }, { given: 'Geoffrey', family: 'Hinton' }],
  'container-title': 'Nature',
  volume: '521',
  issue: '7553',
  page: '436-444',
  issued: { 'date-parts': [[2015, 5, 27]] },
  DOI: '10.1038/nature14539',
  URL: 'https://doi.org/10.1038/nature14539',
  publisher: 'Springer Science and Business Media LLC',
};

const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <id>http://arxiv.org/abs/1706.03762v7</id>
    <published>2017-06-12T17:57:34Z</published>
    <title>Attention Is All
      You Need</title>
    <summary>The dominant sequence transduction models…</summary>
    <author><name>Ashish Vaswani</name></author>
    <author><name>Noam Shazeer</name></author>
    <author><name>Aidan N. Gomez</name></author>
  </entry>
</feed>`;

test('identifiers: DOI, arXiv id and ISBN in a paper’s text', () => {
  assert.equal(cite.findIds('Nature 521, 436–444 (2015) doi:10.1038/nature14539.\nReferences\n1. https://doi.org/10.1000/other').doi, '10.1038/nature14539');
  assert.equal(cite.findIds('see https://doi.org/10.1016/S0140-6736(20)30183-5).').doi, '10.1016/S0140-6736(20)30183-5');
  assert.equal(cite.findIds('DOI: 10.1109/CVPR.2016.90, pages').doi, '10.1109/CVPR.2016.90');
  assert.equal(cite.findIds('arXiv:1706.03762v7 [cs.CL] 2 Aug 2023').arxiv, '1706.03762');
  assert.equal(cite.findIds('arXiv:hep-th/9901001').arxiv, 'hep-th/9901001');
  assert.equal(cite.findIds('ISBN 978-0-387-31073-2').isbn, '9780387310732');
  assert.equal(cite.findIds('ISBN 978-0-387-31073-3').isbn, '', 'bad check digit');
  assert.deepEqual(cite.parseQuery(' https://doi.org/10.1038/nature14539 '), { doi: '10.1038/nature14539' });
  assert.deepEqual(cite.parseQuery('https://arxiv.org/abs/1706.03762v2'), { arxiv: '1706.03762' });
  assert.deepEqual(cite.parseQuery('1706.03762'), { arxiv: '1706.03762' });
  assert.deepEqual(cite.parseQuery('0-387-31073-8'), { isbn: '0387310738' });
  assert.deepEqual(cite.parseQuery('attention is all you need'), { query: 'attention is all you need' });
});

test('styles: a journal article in each style', () => {
  const item = cite.normalize(NATURE);
  const text = (s) => cite.format(item, s).text;
  assert.equal(text('apa'), 'LeCun, Y., Bengio, Y., & Hinton, G. (2015). Deep learning. Nature, 521(7553), 436–444. https://doi.org/10.1038/nature14539');
  assert.match(cite.format(item, 'apa').html, /<i>Nature<\/i>, <i>521<\/i>\(7553\)/);
  assert.equal(text('mla'), 'LeCun, Yann, et al. “Deep learning.” Nature, vol. 521, no. 7553, 2015, pp. 436–444, https://doi.org/10.1038/nature14539.');
  assert.equal(text('chicago'), 'LeCun, Yann, Yoshua Bengio, and Geoffrey Hinton. 2015. “Deep learning.” Nature 521 (7553): 436–444. https://doi.org/10.1038/nature14539.');
  assert.equal(text('harvard'), 'LeCun, Y., Bengio, Y. and Hinton, G. (2015) ‘Deep learning’, Nature, 521(7553), pp. 436–444. Available at: https://doi.org/10.1038/nature14539.');
  assert.equal(text('ieee'), 'Y. LeCun, Y. Bengio, and G. Hinton, “Deep learning,” Nature, vol. 521, no. 7553, pp. 436–444, May 2015, doi: 10.1038/nature14539.');
  assert.equal(text('vancouver'), 'LeCun Y, Bengio Y, Hinton G. Deep learning. Nature. 2015;521(7553):436–444. doi:10.1038/nature14539');
  assert.match(text('bibtex'), /^@article\{lecun2015deep,\n {2}title = \{Deep learning\},\n {2}author = \{LeCun, Yann and Bengio, Yoshua and Hinton, Geoffrey\},/);
  assert.match(text('bibtex'), /pages = \{436--444\}/);
  assert.match(text('ris'), /^TY {2}- JOUR\r\nTI {2}- Deep learning\r\nAU {2}- LeCun, Yann/);
  assert.match(text('ris'), /SP {2}- 436\r\nEP {2}- 444/);
  assert.equal(cite.inText(item, 'apa'), '(LeCun et al., 2015)');
  assert.equal(cite.inText(item, 'chicago'), '(LeCun, Bengio, and Hinton 2015)');
  assert.equal(cite.inText(item, 'ieee'), '[1]');
  assert.equal(cite.inText(item, 'bibtex'), '\\cite{lecun2015deep}');
});

test('styles: preprints, books, chapters and missing details', () => {
  const pre = cite.fromArxivAtom(ATOM);
  assert.equal(pre.title, 'Attention Is All You Need');
  assert.equal(pre.arxiv, '1706.03762');
  assert.deepEqual(pre.author[2], { family: 'Gomez', given: 'Aidan N.' });
  assert.equal(cite.format(pre, 'apa').text, 'Vaswani, A., Shazeer, N., & Gomez, A. N. (2017). Attention Is All You Need [Preprint]. arXiv. https://doi.org/10.48550/arXiv.1706.03762');
  assert.equal(cite.format(pre, 'ieee').text, 'A. Vaswani, N. Shazeer, and A. N. Gomez, “Attention Is All You Need,” 2017, arXiv:1706.03762.');
  assert.match(cite.format(pre, 'bibtex').text, /@misc\{vaswani2017attention,[\s\S]*eprint = \{1706\.03762\},\n {2}archivePrefix = \{arXiv\}/);

  const book = cite.normalize({ type: 'book', title: 'Pattern Recognition and Machine Learning', author: [{ given: 'Christopher M.', family: 'Bishop' }], publisher: 'Springer', 'publisher-place': 'New York', issued: { 'date-parts': [[2006]] } });
  assert.equal(cite.format(book, 'apa').text, 'Bishop, C. M. (2006). Pattern Recognition and Machine Learning. Springer.');
  assert.equal(cite.format(book, 'chicago').text, 'Bishop, Christopher M. 2006. Pattern Recognition and Machine Learning. New York: Springer.');
  assert.equal(cite.format(book, 'vancouver').text, 'Bishop CM. Pattern Recognition and Machine Learning. New York: Springer; 2006.');

  const chapter = cite.normalize({ type: 'book-chapter', title: 'Notes', author: [{ given: 'Ada', family: 'Lovelace' }], editor: [{ given: 'John', family: 'Smith' }], 'container-title': ['Big Book'], page: '10-20', publisher: 'MIT Press', issued: { 'date-parts': [[2020]] } });
  assert.equal(cite.format(chapter, 'apa').text, 'Lovelace, A. (2020). Notes. In J. Smith (Ed.), Big Book (pp. 10–20). MIT Press.');

  const bare = cite.normalize({ title: 'Untitled draft of a study' });
  assert.equal(cite.format(bare, 'apa').text, 'Untitled draft of a study. (n.d.).');
  assert.equal(cite.inText(bare, 'apa'), '(“Untitled draft of a study”, n.d.)');
  assert.equal(cite.bibKey(cite.normalize({ title: 'The Ünïcode Thing', author: [{ family: 'Müller', given: 'Jörg' }], issued: { 'date-parts': [[2021]] } })), 'muller2021unicode');
  assert.match(cite.format(cite.normalize({ title: 'Costs & 50% gains_x', author: [{ family: 'Doe', given: 'J' }] }), 'bibtex').text, /title = \{Costs \\& 50\\% gains\\_x\}/);
});

test('file details: PDF document info when nothing is online', () => {
  const item = cite.fromFileInfo({ info: { Title: 'Microsoft Word - final.docx', Author: 'Jane Doe; John Smith', CreationDate: 'D:20190311120000Z' }, fileName: 'my_paper.pdf' });
  assert.equal(item.title, 'my paper');
  assert.deepEqual(item.author, [{ family: 'Doe', given: 'Jane' }, { family: 'Smith', given: 'John' }]);
  assert.deepEqual(item.issued, [2019, 3, 11]);
  assert.equal(cite.guessTitle('Journal of Things 12 (2020)\nReceived 3 May 2020\nA Study of Something Quite Interesting\nJane Doe, John Roe, A B, C D'), 'A Study of Something Quite Interesting');
  assert.ok(cite.titleScore('Attention is all you need', 'Attention Is All You Need') > 0.99);
  assert.ok(cite.titleScore('Attention is all you need', 'Deep residual learning') < 0.2);
});

test('lookup: DOI, arXiv, title search and offline fallback', async (t) => {
  const hits = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url);
    const send = (type, body) => {
      res.writeHead(200, { 'content-type': type });
      res.end(typeof body === 'string' ? body : JSON.stringify(body));
    };
    if (req.url === '/doi/10.1038/nature14539') return send('application/vnd.citationstyles.csl+json', NATURE);
    if (req.url.startsWith('/arxiv/query?id_list=1706.03762')) return send('application/atom+xml', ATOM);
    if (req.url.startsWith('/crossref/works?query.bibliographic=')) {
      return send('application/json', { message: { items: [{ ...NATURE, title: ['Deep learning'], 'container-title': ['Nature'] }, { title: ['Something unrelated entirely'], type: 'journal-article' }] } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  process.env.REA_CITE_MOCK = `http://127.0.0.1:${server.address().port}`;
  delete require.cache[require.resolve('../main/cite')];
  const lookup = require('../main/cite');

  let res = await lookup.lookup({ text: 'LETTER\nDeep learning\nNature 521 (2015) doi:10.1038/nature14539\n' });
  assert.equal(res.match, 'id');
  assert.equal(res.items[0].title, 'Deep learning');
  assert.equal(res.items[0]['container-title'], 'Nature');

  res = await lookup.search('arXiv:1706.03762v7');
  assert.equal(res.match, 'id');
  assert.equal(res.items[0].arxiv, '1706.03762');

  res = await lookup.lookup({ info: { Title: 'Deep learning review paper' }, text: 'no identifiers here' });
  assert.equal(res.match, 'search');
  assert.equal(res.items.length, 1, 'only close title matches are offered');

  res = await lookup.search('deep learning');
  assert.equal(res.items.length, 2, 'a typed search shows every hit');

  res = await lookup.lookup({ doi: '10.9999/missing', info: { Author: 'Jane Doe', Title: 'zz' }, fileName: 'Some Paper.pdf' });
  assert.equal(res.match, 'file');
  assert.equal(res.items[0].title, 'Some Paper');
  assert.match(res.note, /built from the file/);

  process.env.REA_CITE_MOCK = 'http://127.0.0.1:9';
  delete require.cache[require.resolve('../main/cite')];
  res = await require('../main/cite').lookup({ doi: '10.1038/nature14539', fileName: 'deep.pdf' });
  assert.equal(res.match, 'file');
  assert.match(res.note, /offline/);
  delete process.env.REA_CITE_MOCK;
});
