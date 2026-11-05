'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const JSZip = require('jszip');
const { exportDocx, importDocx } = require('../main/formats/docx');
const { exportXlsx, importXlsx, importOoxml, importCsv, exportCsv } = require('../main/formats/xlsx');
const { reshape } = require('./fixtures/odd-xlsx');
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
  assert.match(html, /<h1 style="text-align:center">Quarterly plan<\/h1>/);
  assert.match(html, /<span style="color:#c0392b;font-size:14pt">red<\/span>/);
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

test('xlsx with prefixed tags (x:workbook) opens with its styles', async () => {
  const buf = await reshape(await exportXlsx(book), { prefix: true });
  assert.match(await (await JSZip.loadAsync(buf)).file('xl/workbook.xml').async('string'), /<x:workbook/);
  const back = await importXlsx(buf);
  assert.deepEqual(back.sheets.map((s) => s.name), ['Budget', 'Notes']);
  assert.equal(back.sheets[0].cells.A1.v, 'Item');
  assert.equal(back.sheets[0].cells.A1.s.b, true);
  assert.equal(back.sheets[0].cells.B4.v, '=SUM(B2:B3)');
});

test('xlsx with the workbook at another path, or not really xlsx, still opens', async () => {
  const moved = await importOoxml(await reshape(await exportXlsx(book), { bookPath: 'xl/book.xml' }));
  assert.deepEqual(moved.sheets.map((s) => s.name), ['Budget', 'Notes']);
  assert.equal(moved.sheets[0].cells.A1.v, 'Item');
  const html = await importOoxml(Buffer.from('<table><tr><td>a</td><td>1</td></tr></table>'));
  assert.equal(html.sheets[0].cells.B1.v, '1');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odd-xlsx-'));
  fs.writeFileSync(path.join(dir, 'Report.xlsx'), await reshape(await exportXlsx(book), { prefix: true, bookPath: 'xl/book.xml' }));
  const opened = await openFile(path.join(dir, 'Report.xlsx'));
  assert.equal(opened.data.sheets[0].cells.A1.v, 'Item');
});

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

test('xlsx keeps cell fonts and sizes, leaving the default font off', async () => {
  const back = await importXlsx(await exportXlsx({ sheets: [{ name: 'F', cells: { A1: { v: 'a', s: { font: 'Source Sans 3', size: 14 } }, A2: { v: 'b', s: { b: true } } } }] }));
  const c = back.sheets[0].cells;
  assert.equal(c.A1.s.font, 'Source Sans 3');
  assert.equal(c.A1.s.size, 14);
  assert.deepEqual(c.A2.s, { b: true });
});

test('font names become quoted CSS stacks and back', () => {
  const { fontStack, firstFamily, bundled } = require('../common/fonts');
  assert.equal(fontStack('Source Sans 3'), '"Source Sans 3", sans-serif');
  assert.equal(fontStack('JetBrains Mono'), '"JetBrains Mono", monospace');
  assert.equal(fontStack('Garamond'), '"Garamond", serif');
  assert.equal(fontStack('Great Vibes'), '"Great Vibes", cursive');
  assert.equal(firstFamily('"Inter", sans-serif'), 'Inter');
  assert.equal(bundled('inter').family, 'Inter');
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
  assert.equal(appForFile('a.pptx'), 'slides');
  assert.equal(appForFile('a.pdf'), 'pdf');
  assert.equal(appForFile('a.zip'), null);

  const md = path.join(dir, 'notes.md');
  fs.writeFileSync(md, '# Title\n\n- a\n- b\n');
  const opened = await openFile(md);
  assert.equal(opened.app, 'docs');
  assert.match(opened.data.html, /<h1>Title<\/h1>/);

  const deck = path.join(dir, 'talk.pptx');
  await saveFile('slides', deck, { theme: 'midnight', slides: [{ id: 's', elements: [] }], export: { slides: [{ elements: [] }] } });
  const reopened = await openFile(deck);
  assert.equal(reopened.path, deck);
  assert.equal(reopened.data.theme, 'midnight');
  assert.equal(reopened.data.export, undefined);

  // Edited outside Work: the slides no longer match, so the .pptx itself is read.
  const zip = await JSZip.loadAsync(fs.readFileSync(deck));
  zip.file('ppt/slides/slide1.xml', (await zip.file('ppt/slides/slide1.xml').async('string')).replace('</p:spTree>', '<!-- edited --></p:spTree>'));
  const edited = path.join(dir, 'edited.pptx');
  fs.writeFileSync(edited, await zip.generateAsync({ type: 'nodebuffer' }));
  const foreign = await openFile(edited);
  assert.equal(foreign.path, null);
  assert.notEqual(foreign.data.theme, 'midnight');

  // Older versions saved .reaslides: it opens as a copy that saves as .pptx.
  const old = path.join(dir, 'old.reaslides');
  fs.writeFileSync(old, JSON.stringify({ format: 'rea-slides', version: 1, theme: 'slate', slides: [] }));
  const legacy = await openFile(old);
  assert.equal(legacy.app, 'slides');
  assert.equal(legacy.path, null);
  assert.equal(legacy.data.theme, 'slate');
  await assert.rejects(saveFile('slides', old, { slides: [] }));

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
  const odp = await openFile(fx('deck.odp'));
  assert.equal(odp.app, 'slides');
  assert.equal(odp.path, null);
  const words = (s) => s.elements.map((e) => [e.role, (e.html || '').replace(/<\/div>/g, '\n').replace(/<[^>]+>/g, '').trim()]);
  const [first, second, third] = odp.data.slides;
  assert.deepEqual([words(first), first.notes], [[['title', 'Launch plan'], ['subtitle', 'Q3 review']], 'Welcome everyone.']);
  assert.deepEqual([words(second), second.notes], [[['title', 'Goals'], ['body', 'Grow revenue\nHire two engineers']], 'Focus on revenue first.']);
  assert.deepEqual(words(third).slice(1), [['body', 'Slow'], ['body', 'Fast']]);
  const pptx = await openFile(fx('deck.pptx'));
  assert.equal(pptx.app, 'slides');
  assert.equal(pptx.path, null);
  const text = (s) => s.elements.map((e) => (e.html || '').replace(/<[^>]+>/g, '')).filter(Boolean);
  const [p1, p2, p3] = pptx.data.slides;
  assert.deepEqual(text(p1), ['Launch plan', 'Q3 review']);
  assert.deepEqual([p1.notes, p2.notes], ['Welcome everyone.', 'Focus on revenue first.']);
  assert.deepEqual(text(p2), ['Goals', 'Grow revenueHire two engineers']);
  assert.deepEqual(text(p3).slice(-2), ['Slow', 'Fast']);
  const odt = await openFile(fx('notes.odt'));
  assert.equal(odt.app, 'docs');
  assert.match(odt.data.html.replace(/<\/?span[^>]*>/g, ''), /<h1>Report<\/h1><p>Hello world.<\/p><ul><li><p>First<\/p><\/li><\/ul><table>/);
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

test('pptx import keeps the template, fonts, pictures, shapes, tables and charts', async () => {
  const d = (await openFile(path.join(__dirname, 'fixtures', 'styled.pptx'))).data;
  assert.deepEqual(d.size, { w: 960, h: 540 });
  assert.equal(d.slides.length, 5);
  const [title, agenda, shapes, numbers, table] = d.slides;
  assert.match(title.bgCss, /^linear-gradient\(45deg, #0B1F3A 0%, #1E5A9C 100%\)$/);
  assert.ok(title.layers.every((id) => d.layers[id]));
  assert.match(title.elements[0].html, /color:#FFFFFF/);
  assert.match(title.elements[1].html, /Design team · 2026/);
  const body = agenda.elements.find((e) => e.role === 'body');
  assert.equal((body.html.match(/data-bu=/g) || []).length, 6);
  assert.match(body.html, /data-bu="–"/);
  assert.match(body.html, /font-weight:700">Revenue grew 24%/);
  const shape = shapes.elements.find((e) => e.prst === 'chevron');
  assert.match(shape.svg, /fill="#1565C0"/);
  assert.ok(shapes.elements.some((e) => e.type === 'image' && e.src.startsWith('data:image/png')));
  const arrow = shapes.elements.find((e) => e.line);
  assert.match(arrow.svg, /marker-end/);
  assert.match(shapes.elements.find((e) => /Georgia/.test(e.html || '')).html, /font-family:'Georgia', serif;font-size:28px/);
  const charts = numbers.elements.filter((e) => e.chart);
  assert.equal(charts.length, 2);
  assert.match(Buffer.from(charts[0].src.split(',')[1], 'base64').toString(), /Q4/);
  const tbl = table.elements.find((e) => e.type === 'table');
  assert.equal(tbl.cells.length, 4);
  assert.deepEqual(tbl.rows[0], ['Region', 'Q1', 'Q2']);
  assert.equal(table.notes, 'Talk about the table.');
  assert.ok(d.layouts.obj.elements.some((e) => e.role === 'title' && e.placeholder));
  const out = await exportPptx({ ...d, slides: d.slides.map((s) => ({ ...s, elements: s.elements.map((e) => ({ ...e, paragraphs: [{ runs: [{ text: 'x' }] }] })) })) });
  const zip = await JSZip.loadAsync(out);
  assert.equal(zip.file(/ppt\/slides\/slide\d+\.xml/).length, 5);
});

test('reads an uploaded PowerPoint template: colours, fonts, background and master pictures', async () => {
  const { readTemplate } = require('../main/formats/template');
  const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'deck.pptx'));
  const plain = await readTemplate(buf, 'Plain.potx');
  assert.equal(plain.bg, '#ffffff');
  assert.equal(plain.accent, '#4f81bd');
  assert.equal(plain.font, 'Calibri');
  assert.equal(plain.bgImage, null);
  assert.deepEqual(plain.decor, []);

  // Give the master a picture background, a logo and a coloured strip.
  const zip = await JSZip.loadAsync(buf);
  const masterFile = 'ppt/slideMasters/slideMaster1.xml';
  const relsFile = 'ppt/slideMasters/_rels/slideMaster1.xml.rels';
  const png = PNG_1x1.split(',')[1];
  zip.file('ppt/media/bg.png', png, { base64: true });
  zip.file('ppt/media/logo.png', png, { base64: true });
  let rels = await zip.file(relsFile).async('string');
  rels = rels.replace('</Relationships>', '<Relationship Id="rIdBg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bg.png"/><Relationship Id="rIdLogo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/logo.png"/></Relationships>');
  zip.file(relsFile, rels);
  let master = await zip.file(masterFile).async('string');
  master = master
    .replace(/<p:bg>.*?<\/p:bg>/, '<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rIdBg"/><a:stretch><a:fillRect/></a:stretch></a:blipFill><a:effectLst/></p:bgPr></p:bg>')
    .replace('</p:grpSpPr>', '</p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="90" name="Logo"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rIdLogo"/></p:blipFill><p:spPr><a:xfrm><a:off x="8229600" y="0"/><a:ext cx="914400" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/></p:spPr></p:pic><p:sp><p:nvSpPr><p:cNvPr id="91" name="Strip"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="0" y="6400800"/><a:ext cx="9144000" cy="457200"/></a:xfrm><a:prstGeom prst="rect"/><a:solidFill><a:schemeClr val="accent2"/></a:solidFill></p:spPr></p:sp>')
    .replace('<a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mj-lt"/>', '<a:srgbClr val="AA1100"/></a:solidFill><a:latin typeface="+mj-lt"/>');
  zip.file(masterFile, master);
  const t = await readTemplate(await zip.generateAsync({ type: 'nodebuffer' }), 'Company.potx');
  assert.match(t.bgImage, /^data:image\/png;base64,/);
  assert.equal(t.title, '#aa1100');
  assert.equal(t.decor.length, 2);
  const logo = t.decor.find((d) => d.type === 'image');
  assert.deepEqual([logo.x, logo.y, logo.w, logo.h], [864, 0, 96, 36]);
  const strip = t.decor.find((d) => d.type === 'shape');
  assert.equal(strip.fill, '#c0504d');
  assert.equal(strip.y, 504);

  // Exported decks carry the template on their slide master.
  const out = await exportPptx({
    title: 'T',
    themeColors: { bg: t.bg, text: t.text, font: t.font },
    master: { bg: t.bg, bgImage: t.bgImage, decor: t.decor },
    slides: [{ bg: null, elements: [{ type: 'text', x: 60, y: 40, w: 840, h: 80, style: { fontSize: 40 }, paragraphs: [{ runs: [{ text: 'Hello' }] }] }] }],
  });
  const ozip = await JSZip.loadAsync(out);
  const layouts = Object.keys(ozip.files).filter((f) => /slideLayouts\/slideLayout\d+\.xml$/.test(f));
  const layoutXml = (await Promise.all(layouts.map((f) => ozip.file(f).async('string')))).join('');
  assert.match(layoutXml, /<p:bg>.*blip/s);
  assert.ok(Object.keys(ozip.files).filter((f) => f.startsWith('ppt/media/')).length >= 2);
});

// Files made in LibreOffice, Google Slides and other apps open with their pictures and formatting.
const fixture = (f) => path.join(__dirname, 'fixtures', f);
const plain = (html) => (html || '').replace(/<\/div>/g, '\n').replace(/<[^>]+>/g, '').trim();

test('odp opens with its master background, shapes, pictures, charts and tables', async () => {
  const { app, path: saved, data } = await openFile(fixture('lo-styled.odp'));
  assert.equal(app, 'slides');
  assert.equal(saved, null);
  assert.deepEqual(data.size, { w: 960, h: 540 });
  const [s1, s2, s3, s4, s5] = data.slides;
  assert.match(s1.bgCss, /linear-gradient\(45deg, #0B1F3A/);
  assert.match(s1.elements[1].html, /color:#ffc040/);
  assert.match(s2.elements[1].html, /--bc:#c03030[^>]*data-bu="•"/);
  const shapes = s3.elements.filter((e) => e.type === 'shape' && e.svg);
  assert.ok(shapes.length >= 6);
  assert.match(shapes[0].html, /color:#ffffff/);
  assert.equal(s3.elements.filter((e) => e.type === 'image')[0].src.slice(0, 22), 'data:image/png;base64,');
  const charts = s4.elements.filter((e) => e.chart);
  assert.equal(charts.length, 2);
  assert.match(Buffer.from(charts[0].src.split(',')[1], 'base64').toString(), /Q4/);
  const table = s5.elements.find((e) => e.type === 'table');
  assert.deepEqual(table.rows[0], ['Region', 'Q1', 'Q2']);
  assert.match(table.cells[0][0].fill, /#4f81bd/i);
});

test('odp drawn in Impress keeps gradients, rotation, groups and custom shapes', async () => {
  const { data } = await openFile(fixture('impress.odp'));
  const [, s2, s3] = data.slides;
  const box = s2.elements.find((e) => plain(e.html) === 'Gradient box');
  assert.match(box.svg, /linearGradient/);
  assert.equal(s2.elements.find((e) => plain(e.html) === 'Rotated').style.rotate, 330);
  assert.ok(s2.elements.filter((e) => e.type === 'shape').length >= 10);
  assert.ok(s2.elements.some((e) => e.type === 'image'));
  assert.equal(s3.bg, '#FFF3E0');
  assert.ok(data.layouts.obj.elements.some((e) => e.role === 'title'));
});

test('odt, docx and rtf from LibreOffice keep fonts, colours, alignment, lists, tables and pictures', async () => {
  for (const f of ['writer.odt', 'writer.docx', 'writer.rtf']) {
    const { app, data } = await openFile(fixture(f));
    assert.equal(app, 'docs', f);
    const html = data.html;
    assert.match(html, /<strong>(<span[^>]*>)?bold/, f);
    assert.match(html, /<em>(<span[^>]*>)?italic/, f);
    assert.match(html, /<u>(<span[^>]*>)?underlined/, f);
    assert.match(html, /color:#cc0000[^>]*>red/, f);
    assert.match(html, /background-color:#ffff00/, f);
    assert.match(html, /font-family:Arial;font-size:18pt[^>]*>large Arial/, f);
    assert.match(html, /<p style="text-align:center">(<span[^>]*>)?This line is centered/, f);
    assert.match(html, /<p style="text-align:right">/, f);
    assert.match(html, /<h2>(<strong>)?(<span[^>]*>)?Details/, f);
    assert.match(html, /<ol>.*Step one/, f);
    assert.match(html, /<img[^>]*src="data:image\/png;base64,|<img src="data:image\/png;base64,/, f);
    assert.match(html, /<table>.*Region.*North.*South/, f);
  }
});

test('Google Slides style decks keep cropped pictures, picture fills and bullets', async () => {
  const { data } = await openFile(fixture('google-slides.pptx'));
  const s = data.slides[1];
  const pic = s.elements.find((e) => e.type === 'image');
  assert.deepEqual(pic.style.crop, [0.15, 0, 0, 0.1]);
  assert.match(pic.src, /^data:image\/jpeg/);
  assert.match(s.elements.find((e) => e.prst === 'ellipse').svg, /<pattern/);
  assert.match(s.elements.find((e) => e.role === 'body').html, /--bc:#E06666[^>]*data-bu="●"/);
  assert.equal(plain(s.elements.find((e) => e.role === 'title').html), 'Made in Google Slides');
});

test('more file types open in the right app, and Apple files say how to export them', async () => {
  for (const [f, app] of [['a.ppsx', 'slides'], ['a.potx', 'slides'], ['a.pptm', 'slides'], ['a.fodp', 'slides'], ['a.docm', 'docs'], ['a.dotx', 'docs'], ['a.rtf', 'docs'], ['a.fodt', 'docs'], ['a.xlsb', 'sheets'], ['a.numbers', 'sheets'], ['a.fods', 'sheets']]) assert.equal(appForFile(f), app, f);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'work-'));
  fs.copyFileSync(fixture('styled.pptx'), path.join(dir, 'show.ppsx'));
  const show = await openFile(path.join(dir, 'show.ppsx'));
  assert.equal(show.data.slides.length, 5);
  assert.equal(show.path, null);
  fs.writeFileSync(path.join(dir, 'deck.key'), 'PK');
  await assert.rejects(openFile(path.join(dir, 'deck.key')), /Export To > PowerPoint/);
});
