import test from 'node:test';
import assert from 'node:assert/strict';
import { SLIDE_H, SLIDE_W, buildDeck, cleanDeck, fitImage, isEmpty, outlineText, plainDeck, readDocument } from '../src/docs/deck.js';

const t = (text) => ({ type: 'text', text });
const p = (text) => ({ type: 'paragraph', content: [t(text)] });
const hd = (level, text) => ({ type: 'heading', attrs: { level }, content: [t(text)] });
const ul = (...items) => ({ type: 'bulletList', content: items.map((i) => ({ type: 'listItem', content: Array.isArray(i) ? i : [p(i)] })) });
const img = (alt) => ({ type: 'image', attrs: { src: 'data:image/png;base64,AA', alt } });
const cell = (s) => ({ type: 'tableCell', content: [p(s)] });
const table = (...rows) => ({ type: 'table', content: rows.map((r) => ({ type: 'tableRow', content: r.map(cell) })) });

const sample = { type: 'doc', content: [
  hd(1, 'Solar at home'),
  p('A short guide for families.'),
  hd(2, 'Why solar'),
  p('Panels cut the power bill. They also raise the value of the house. Most pay for themselves in eight years, sometimes sooner when rates go up.'),
  ul('Lower bills', [p('Cleaner air'), ul('Less coal')]),
  img('roof.png'),
  hd(2, 'Costs'),
  table(['Size', 'Price'], ['4 kW', '$9,000'], ['6 kW', '$12,500']),
  { type: 'blockquote', content: [p('The sun sends no bill.')] },
  { type: 'pageBreak' },
  p('Ask your installer about rebates.'),
] };

test('a Write document is read into headings, paragraphs, lists, pictures and tables', () => {
  const doc = readDocument(sample);
  assert.deepEqual(doc.blocks.map((b) => b.type), ['heading', 'para', 'heading', 'para', 'list', 'image', 'heading', 'table', 'quote', 'break', 'para']);
  assert.deepEqual(doc.blocks[4].items, [{ text: 'Lower bills', depth: 0 }, { text: 'Cleaner air', depth: 0 }, { text: 'Less coal', depth: 1 }]);
  assert.equal(doc.images[0].alt, 'roof');
  assert.deepEqual(doc.tables[0][2], ['6 kW', '$12,500']);
  const outline = outlineText(doc);
  assert.match(outline, /^# Solar at home/);
  assert.match(outline, /\n  - Less coal/);
  assert.match(outline, /\[Picture 1: roof\]/);
  assert.match(outline, /\[Table 1: 2 columns, 3 rows\]\n\| Size \| Price \|/);
  assert.ok(isEmpty(readDocument({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'pageBreak' }] })));
});

test('without AI each heading becomes a slide and pictures and tables are placed', () => {
  const doc = readDocument(sample);
  doc.images[0].w = 800;
  doc.images[0].h = 600;
  const spec = plainDeck(doc, 'Doc1');
  assert.deepEqual(spec.slides.map((s) => s.layout), ['title', 'image_bullets', 'table', 'quote', 'bullets']);
  assert.equal(spec.slides[0].title, 'Solar at home');
  assert.equal(spec.slides[0].subtitle, 'A short guide for families.');
  const why = spec.slides[1];
  assert.equal(why.image, 1);
  assert.deepEqual(why.bullets.slice(0, 2), ['Panels cut the power bill.', 'They also raise the value of the house.']);
  assert.match(why.notes, /eight years/);
  assert.equal(why.bullets.length, 6);
  assert.equal(spec.slides[2].title, 'Costs');
  assert.equal(spec.slides[4].title, 'Costs');
  const slides = buildDeck(spec, doc);
  for (const s of slides) for (const el of s.elements) {
    assert.ok(el.x >= 0 && el.y >= 0 && el.x + el.w <= SLIDE_W && el.y + el.h <= SLIDE_H, `${el.type} fits the slide`);
  }
  const pic = slides[1].elements.find((e) => e.type === 'image');
  assert.equal(Math.round((pic.w / pic.h) * 100), 133);
  assert.deepEqual(slides[2].elements.find((e) => e.type === 'table').rows[0], ['Size', 'Price']);
});

test('long sections continue on the next slide and top headings become section slides', () => {
  const doc = readDocument({ type: 'doc', content: [
    hd(1, 'Part one'), hd(2, 'Steps'), ul(...Array.from({ length: 9 }, (_, i) => `Step ${i + 1}`)),
    hd(1, 'Part two'), p('Done.'),
  ] });
  const spec = plainDeck(doc, 'Notes');
  assert.equal(spec.title, 'Part one');
  assert.deepEqual(spec.slides.map((s) => [s.layout, s.title]), [
    ['title', 'Part one'], ['bullets', 'Steps'], ['bullets', 'Steps (continued)'], ['section', 'Part two'], ['bullets', 'Part two'],
  ]);
  assert.deepEqual([spec.slides[1].bullets.length, spec.slides[2].bullets.length], [5, 4]);
});

test('an AI plan is checked: bad layouts and numbers are fixed and unused pictures are kept', () => {
  const doc = readDocument({ type: 'doc', content: [p('Hello'), img('a'), img('b'), table(['x'], ['1'])] });
  const spec = cleanDeck({ title: 'Deck', slides: [
    { layout: 'bullets', title: 'Intro', subtitle: '', bullets: [' One ', ''], right_bullets: [], image: 0, table: 0, notes: 'Say hi' },
    { layout: 'image', title: 'Pic', subtitle: 'caption', bullets: [], right_bullets: [], image: 2, table: 0, notes: '' },
    { layout: 'table', title: 'Nope', subtitle: '', bullets: [], right_bullets: [], image: 0, table: 7, notes: '' },
    { layout: 'spiral', title: 'Odd', subtitle: '', bullets: ['x'], right_bullets: [], image: 3, table: 0, notes: '' },
    { layout: 'section', title: 'Thanks', subtitle: '', bullets: [], right_bullets: [], image: 0, table: 0, notes: '' },
  ] }, doc, { notes: false });
  assert.deepEqual(spec.slides.map((s) => s.layout), ['title', 'bullets', 'image', 'section', 'bullets', 'image', 'table', 'section']);
  assert.deepEqual(spec.slides[1].bullets, ['One']);
  assert.equal(spec.slides[1].notes, '');
  assert.equal(spec.slides[5].image, 1);
  assert.equal(spec.slides[6].table, 1);
  assert.equal(spec.slides[4].image, 0);
});

test('a line of text goes above a table, and long tables run over even slides', () => {
  const rows = [['n'], ...Array.from({ length: 20 }, (_, i) => [String(i)])];
  const doc = readDocument({ type: 'doc', content: [hd(1, 'Data'), hd(2, 'Daily'), p('Counts by day.'), table(...rows)] });
  const spec = plainDeck(doc, 'x');
  assert.deepEqual(spec.slides.map((s) => s.layout), ['title', 'table']);
  assert.deepEqual(spec.slides[1].bullets, ['Counts by day.']);
  const slides = buildDeck(spec, doc);
  assert.deepEqual(slides.slice(1).map((s) => s.elements.find((e) => e.type === 'table').rows.length), [11, 11]);
  assert.ok(slides[1].elements.some((e) => e.role === 'body' && /Counts by day/.test(e.html)));
});

test('pictures keep their shape inside the box they are given', () => {
  assert.deepEqual(fitImage({ w: 2000, h: 1000 }, { x: 0, y: 0, w: 400, h: 400 }), { x: 0, y: 100, w: 400, h: 200 });
  assert.deepEqual(fitImage({ w: 500, h: 1000 }, { x: 10, y: 10, w: 400, h: 200 }), { x: 160, y: 10, w: 100, h: 200 });
});

test('notes cards and free boxes reach the deck as text', () => {
  const doc = readDocument({ type: 'doc', content: [
    { type: 'noteBoard', attrs: { items: [{ x: 300, y: 10, html: 'Second' }, { x: 0, y: 12, html: 'First <b>idea</b>' }, { x: 0, y: 90, html: '' }] } },
    { type: 'noteFile', attrs: { kind: 'audio', transcript: 'Ship on  Friday.' } },
    { type: 'noteFile', attrs: { kind: 'audio' } },
    { type: 'noteFile', attrs: { kind: 'file', name: 'Budget.pdf' } },
  ] });
  assert.deepEqual(doc.blocks, [
    { type: 'list', items: [{ text: 'First idea', depth: 0 }, { text: 'Second', depth: 0 }] },
    { type: 'quote', text: 'Ship on Friday.' },
    { type: 'para', text: 'Attachment: Budget.pdf' },
  ]);
});

test('equation pictures in Write are read as equations with their TeX', () => {
  const eq = { type: 'image', attrs: { src: 'data:image/png;base64,AA', alt: 'E=mc^2', title: 'Equation' } };
  const doc = readDocument({ type: 'doc', content: [hd(1, 'Physics'), hd(2, 'Energy'), p('Mass is energy.'), { type: 'paragraph', content: [eq] }] });
  assert.deepEqual(doc.equations, [{ src: 'data:image/png;base64,AA', tex: 'E=mc^2' }]);
  assert.deepEqual(doc.images, []);
  assert.match(outlineText(doc), /\[Equation 1: E=mc\^2\]/);
  const slides = buildDeck(plainDeck(doc, 'Physics'), { ...doc, equations: [{ ...doc.equations[0], w: 100, h: 20 }] });
  const img = slides.at(-1).elements.find((e) => e.type === 'image');
  assert.equal(img.w, 200);
  assert.ok(img.x + img.w <= SLIDE_W && img.y + img.h <= SLIDE_H);
});
