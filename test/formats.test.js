'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { exportDocx, importDocx } = require('../main/formats/docx');
const { exportXlsx, importXlsx, importCsv, exportCsv } = require('../main/formats/xlsx');
const { exportPptx } = require('../main/formats/pptx');
const { openFile, saveFile, appForFile } = require('../main/formats');
const cellref = require('../common/cellref');

const PNG_1x1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const docJson = {
  type: 'doc',
  content: [
    { type: 'heading', attrs: { level: 1, textAlign: 'center' }, content: [{ type: 'text', text: 'Quarterly plan' }] },
    { type: 'paragraph', content: [
      { type: 'text', text: 'Bold ', marks: [{ type: 'bold' }] },
      { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#c0392b', fontSize: '14pt' } }] },
      { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
    ] },
    { type: 'bulletList', content: [
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
    ] },
    { type: 'orderedList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Step one' }] }] }] },
    { type: 'table', content: [
      { type: 'tableRow', content: [
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Name' }] }] },
        { type: 'tableHeader', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Qty' }] }] },
      ] },
      { type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Apples' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
      ] },
    ] },
    { type: 'image', attrs: { src: PNG_1x1 } },
    { type: 'pageBreak' },
    { type: 'paragraph', content: [{ type: 'text', text: 'After the break' }] },
  ],
};

test('docx export produces a document that imports back with the same content', async () => {
  const buf = await exportDocx({ json: docJson, title: 'Plan', page: { margins: 'narrow' } });
  assert.ok(buf.length > 1000);
  const xml = await (await JSZip.loadAsync(buf)).file('word/document.xml').async('string');
  assert.match(xml, /Quarterly plan/);
  assert.match(xml, /w:color w:val="C0392B"/);
  assert.match(xml, /w:sz w:val="28"/); // 14pt
  assert.match(xml, /w:br w:type="page"/);
  const { html } = await importDocx(buf);
  assert.match(html, /<h1>Quarterly plan<\/h1>/);
  assert.match(html, /<strong>Bold/);
  assert.match(html, /<a href="https:\/\/example.com">/);
  assert.match(html, /<li>First<\/li>/);
  assert.match(html, /<table>/);
  assert.match(html, /<img src="data:image\/png;base64,/);
});

const book = {
  sheets: [
    {
      name: 'Budget',
      cols: { A: 140 },
      cells: {
        A1: { v: 'Item', s: { b: true, bg: '#fff3bf' } },
        B1: { v: 'Cost', s: { b: true, align: 'right' } },
        A2: { v: 'Rent' },
        B2: { v: '1200', s: { fmt: 'currency' } },
        A3: { v: 'Food' },
        B3: { v: '450.5', s: { fmt: 'currency' } },
        B4: { v: '=SUM(B2:B3)', r: 1650.5, s: { fmt: 'currency', color: '#c0392b' } },
        C2: { v: 'needs, "quotes"' },
      },
    },
    { name: 'Notes', cells: { A1: { v: 'hello' } }, cols: {} },
  ],
};

test('xlsx round trip keeps values, formulas, styles and sheets', async () => {
  const buf = await exportXlsx(book);
  const back = await importXlsx(buf);
  assert.deepEqual(back.sheets.map((s) => s.name), ['Budget', 'Notes']);
  const c = back.sheets[0].cells;
  assert.equal(c.A1.v, 'Item');
  assert.equal(c.A1.s.b, true);
  assert.equal(c.A1.s.bg.toLowerCase(), '#fff3bf');
  assert.equal(c.B2.v, '1200');
  assert.equal(c.B2.s.fmt, 'currency');
  assert.equal(c.B4.v, '=SUM(B2:B3)');
  assert.equal(c.B4.s.color.toLowerCase(), '#c0392b');
  assert.equal(c.C2.v, 'needs, "quotes"');
  assert.equal(back.sheets[0].cols.A, 140);
  assert.equal(back.sheets[1].cells.A1.v, 'hello');
});

test('csv export uses computed values and quotes where needed; import parses it back', () => {
  const csv = exportCsv(book, 0);
  assert.equal(csv.split('\r\n')[3], ',1650.5,');
  assert.match(csv, /"needs, ""quotes"""/);
  const back = importCsv(csv);
  assert.equal(back.sheets[0].cells.C2.v, 'needs, "quotes"');
  assert.equal(back.sheets[0].cells.B4.v, '1650.5');
});

test('pptx export writes one slide per model slide with text and notes', async () => {
  const buf = await exportPptx({
    title: 'Deck',
    slides: [
      { bg: '#15213b', notes: 'Say hello', elements: [
        { type: 'text', x: 80, y: 160, w: 800, h: 120, style: { fontSize: 54, color: '#ffffff', align: 'center' }, paragraphs: [{ runs: [{ text: 'Hello', bold: true }] }] },
        { type: 'shape', shape: 'ellipse', x: 10, y: 10, w: 50, h: 50, style: { fill: '#4cc9f0' } },
        { type: 'image', x: 0, y: 0, w: 10, h: 10, src: PNG_1x1 },
        { type: 'table', x: 500, y: 300, w: 300, h: 60, rows: [['Year', 'Sales'], ['2021', '42']], style: { fontSize: 14, fill: '#c2532d', color: '#2b2f36' } },
      ] },
      { elements: [{ type: 'text', x: 60, y: 130, w: 840, h: 370, style: { fontSize: 22, bullets: true }, paragraphs: [{ bullet: true, runs: [{ text: 'One' }] }, { bullet: true, runs: [{ text: 'Two' }] }] }] },
    ],
  });
  const zip = await JSZip.loadAsync(buf);
  const slides = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f));
  assert.equal(slides.length, 2);
  const s1 = await zip.file('ppt/slides/slide1.xml').async('string');
  assert.match(s1, /Hello/);
  assert.match(s1, /15213B/);
  assert.match(s1, /<a:tbl>/);
  assert.match(s1, /Sales/);
  assert.match(s1, /C2532D/);
  const s2 = await zip.file('ppt/slides/slide2.xml').async('string');
  assert.match(s2, /One/);
  assert.match(s2, /buChar/);
  const notes = Object.keys(zip.files).filter((f) => /notesSlide\d+\.xml$/.test(f));
  assert.ok(notes.length >= 1);
});

test('openFile / saveFile route by extension', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rea-office-'));
  assert.equal(appForFile('a.DOCX'), 'docs');
  assert.equal(appForFile('a.csv'), 'sheets');
  assert.equal(appForFile('a.reaslides'), 'slides');
  assert.equal(appForFile('a.pdf'), null);

  const md = path.join(dir, 'notes.md');
  fs.writeFileSync(md, '# Title\n\n- a\n- b\n');
  const opened = await openFile(md);
  assert.equal(opened.app, 'docs');
  assert.match(opened.data.html, /<h1>Title<\/h1>/);

  const deck = path.join(dir, 'talk.reaslides');
  await saveFile('slides', deck, { theme: 'midnight', slides: [{ id: 's', elements: [] }], export: { slides: [] } });
  const reopened = await openFile(deck);
  assert.equal(reopened.data.theme, 'midnight');
  assert.equal(reopened.data.export, undefined);

  const html = path.join(dir, 'page.html');
  await saveFile('docs', html, { html: '<p>Hi &amp; bye</p>' });
  assert.match((await openFile(html)).data.html, /Hi &amp; bye/);
});

test('cell reference helpers', () => {
  assert.equal(cellref.colName(0), 'A');
  assert.equal(cellref.colName(27), 'AB');
  assert.equal(cellref.colIndex('AB'), 27);
  assert.deepEqual(cellref.parseRef('$C$10'), { col: 2, row: 9 });
  assert.equal(cellref.shiftFormula('=SUM(A1:B2)+$C$3+LOG10(A2)+"A1"+Sheet2!A1', 1, 1), '=SUM(B2:C3)+$C$3+LOG10(B3)+"A1"+Sheet2!A1');
  assert.equal(cellref.mapRefs('=A1+A2', (p) => (p.row === 1 ? null : p)), '=A1+#REF!');
  assert.deepEqual(cellref.parseCsv('a,"b,c"\n"d""e",f\n'), [['a', 'b,c'], ['d"e', 'f']]);
});

test('imports PowerPoint, OpenDocument and legacy Excel files', async () => {
  const fx = (f) => path.join(__dirname, 'fixtures', f);
  for (const f of ['deck.pptx', 'deck.odp']) {
    const r = await openFile(fx(f));
    assert.equal(r.app, 'slides');
    assert.equal(r.path, null);
    const [first, second, third] = r.data.deckSpec.slides;
    assert.deepEqual([first.layout, first.title, first.subtitle, first.notes], ['title', 'Launch plan', 'Q3 review', 'Welcome everyone.']);
    assert.deepEqual([second.layout, second.bullets, second.notes], ['content', ['Grow revenue', 'Hire two engineers'], 'Focus on revenue first.']);
    assert.deepEqual([third.layout, third.bullets, third.right_bullets], ['two', ['Slow'], ['Fast']]);
  }
  const odt = await openFile(fx('notes.odt'));
  assert.equal(odt.app, 'docs');
  assert.match(odt.data.html, /<h1>Report<\/h1><p>Hello world.<\/p><ul><li><p>First<\/p><\/li><\/ul><table>/);
  for (const f of ['budget.xls', 'budget.ods']) {
    const r = await openFile(fx(f));
    assert.equal(r.app, 'sheets');
    const c = r.data.sheets[0].cells;
    assert.equal(r.data.sheets[0].name, 'Budget');
    assert.deepEqual([c.A2.v, c.B2.v, c.B4.v], ['Rent', '1200', '=SUM(B2:B3)']);
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-'));
  const ods = (await openFile(fx('budget.ods'))).data;
  await saveFile('sheets', path.join(dir, 'copy.ods'), ods);
  const back = await openFile(path.join(dir, 'copy.ods'));
  assert.equal(back.path, path.join(dir, 'copy.ods'));
  assert.deepEqual(back.data.sheets[0].cells, ods.sheets[0].cells);
  fs.writeFileSync(path.join(dir, 'New.xlsx'), '');
  const blank = await openFile(path.join(dir, 'New.xlsx'));
  assert.equal(blank.path, path.join(dir, 'New.xlsx'));
  assert.deepEqual(blank.data.sheets[0].cells, {});
});
