// Turns a Write document into Present slides. readDocument flattens the
// editor's JSON into blocks (readLatex in tex-deck.js does the same for a
// LaTeX project), then either the AI (outlineText + DECK_SCHEMA)
// or plainDeck plans the slides, and buildDeck lays them out on Present's
// 960 x 540 canvas, with the document's pictures and tables placed on them.

export const SLIDE_W = 960;
export const SLIDE_H = 540;
export const LAYOUTS = ['title', 'section', 'bullets', 'two', 'image_bullets', 'image', 'table', 'equation', 'quote'];
const MAX_BULLETS = 6;
const TABLE_ROWS = 12;

let seq = 0;
const nid = () => `w${Date.now().toString(36)}${(seq++).toString(36)}`;
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const tidy = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function inline(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return ' ';
  return (node.content || []).map(inline).join('');
}

const LISTS = ['bulletList', 'orderedList', 'taskList'];

function listItems(list, depth, out) {
  for (const item of list.content || []) {
    // Checklist items keep their box.
    let box = item.type === 'taskItem' ? (item.attrs?.checked ? '☑ ' : '☐ ') : '';
    for (const part of item.content || []) {
      if (LISTS.includes(part.type)) listItems(part, depth + 1, out);
      else {
        const text = tidy(inline(part));
        if (text) out.push({ text: box + text, depth });
        box = '';
      }
    }
  }
  return out;
}

// The editor's JSON as a flat list of blocks, with pictures, tables and
// equations numbered from 1 in the order they appear.
export function readDocument(json) {
  const blocks = [];
  const images = [];
  const tables = [];
  const equations = [];
  const walk = (nodes) => {
    for (const n of nodes || []) {
      const text = tidy(inline(n));
      if (n.type === 'heading') {
        if (text) blocks.push({ type: 'heading', level: n.attrs?.level || 1, text });
      } else if (n.type === 'paragraph') {
        if (text) blocks.push({ type: 'para', text });
        for (const c of n.content || []) if (c.type === 'image') walk([c]);
      } else if (LISTS.includes(n.type)) {
        const items = listItems(n, 0, []);
        if (items.length) blocks.push({ type: 'list', items });
      } else if (n.type === 'blockquote') {
        const t = (n.content || []).map((c) => tidy(inline(c))).filter(Boolean).join(' ');
        if (t) blocks.push({ type: 'quote', text: t });
      } else if (n.type === 'codeBlock') {
        if (text) blocks.push({ type: 'para', text });
      } else if (n.type === 'image' && n.attrs?.title === 'Equation' && n.attrs?.src) {
        // Equations are pictures whose alt text is their TeX.
        equations.push({ src: n.attrs.src, tex: n.attrs.alt || '' });
        blocks.push({ type: 'math', index: equations.length });
      } else if (n.type === 'image') {
        if (n.attrs?.src) {
          images.push({ src: n.attrs.src, alt: tidy(n.attrs.alt || n.attrs.title || '').replace(/\.(png|jpe?g|gif|webp)$/i, '') });
          blocks.push({ type: 'image', index: images.length });
        }
      } else if (n.type === 'table') {
        const rows = (n.content || []).map((r) => (r.content || []).map((c) => tidy((c.content || []).map(inline).join(' '))));
        const width = Math.max(0, ...rows.map((r) => r.length));
        const full = rows.map((r) => [...r, ...Array(width - r.length).fill('')]).filter((r) => r.some(Boolean));
        if (full.length) {
          tables.push(full);
          blocks.push({ type: 'table', index: tables.length });
        }
      } else if (n.type === 'noteBoard') {
        // Write-anywhere boxes, top to bottom then left to right.
        const boxes = (Array.isArray(n.attrs?.items) ? n.attrs.items : []).slice().sort((a, b) => (Math.abs(a.y - b.y) < 12 ? a.x - b.x : a.y - b.y));
        const items = boxes.map((b) => tidy(String(b.html || '').replace(/<br\s*\/?>|<\/?(div|p|li)\b[^>]*>/gi, ' ').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'))).filter(Boolean);
        if (items.length) blocks.push({ type: 'list', items: items.map((t) => ({ text: t, depth: 0 })) });
      } else if (n.type === 'noteFile') {
        const a = n.attrs || {};
        if (a.kind === 'audio' && a.transcript) blocks.push({ type: 'quote', text: tidy(a.transcript) });
        else if (a.kind !== 'audio' && a.name) blocks.push({ type: 'para', text: `Attachment: ${a.name}` });
      } else if (n.type === 'pageBreak' || n.type === 'horizontalRule') {
        blocks.push({ type: 'break' });
      } else if (n.content) {
        walk(n.content);
      }
    }
  };
  walk(json?.content);
  return { blocks, images, tables, equations };
}

export function isEmpty(doc) {
  return !doc.blocks.some((b) => b.type !== 'break');
}

// The document as Markdown-like text for the AI, with markers for pictures and tables.
export function outlineText(doc) {
  return doc.blocks.map((b) => {
    if (b.type === 'heading') return `${'#'.repeat(clamp(b.level, 1, 6))} ${b.text}`;
    if (b.type === 'para') return b.text;
    if (b.type === 'list') return b.items.map((i) => `${'  '.repeat(i.depth)}- ${i.text}`).join('\n');
    if (b.type === 'quote') return `> ${b.text}`;
    if (b.type === 'image') return `[Picture ${b.index}${doc.images[b.index - 1].alt ? `: ${doc.images[b.index - 1].alt}` : ''}]`;
    if (b.type === 'math') return `[Equation ${b.index}: ${doc.equations[b.index - 1].tex.replace(/\s+/g, ' ').slice(0, 400) || 'picture'}]`;
    if (b.type === 'table') {
      const rows = doc.tables[b.index - 1];
      return `[Table ${b.index}: ${rows[0].length} columns, ${rows.length} rows]\n${rows.slice(0, 8).map((r) => `| ${r.join(' | ')} |`).join('\n')}${rows.length > 8 ? '\n| … |' : ''}`;
    }
    return '---';
  }).join('\n\n');
}

const SLIDE_SPEC = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: LAYOUTS },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    right_bullets: { type: 'array', items: { type: 'string' } },
    image: { type: 'integer' },
    table: { type: 'integer' },
    equation: { type: 'integer' },
    notes: { type: 'string' },
  },
  required: ['layout', 'title', 'subtitle', 'bullets', 'right_bullets', 'image', 'table', 'equation', 'notes'],
  additionalProperties: false,
};
export const DECK_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, slides: { type: 'array', items: SLIDE_SPEC } },
  required: ['title', 'slides'],
  additionalProperties: false,
};

export const DECK_SYSTEM = [
  'You turn documents into clear, good-looking presentations for Present, a slide app.',
  'Work only from the document: keep its facts, names and numbers, and do not invent new ones.',
  'Layouts: "title" opens the deck (title and subtitle). "section" introduces a major part. "bullets" is a title with 3-6 short bullets. "two" compares two things (bullets on the left, right_bullets on the right, subtitle unused). "image_bullets" puts a picture beside 2-5 bullets. "image" shows one picture large, with subtitle as its caption. "table" shows one of the document\'s tables. "equation" shows one of the document\'s equations large, with 0-3 bullets under it saying what it means or what its symbols stand for. "quote" shows one striking sentence (in title) with who said it in subtitle.',
  'Pictures and tables are numbered as in the document ([Picture 1], [Table 1]). Set image or table to that number on the slide that shows it, and to 0 on every other slide. Use every picture and every table once, on the slide where its topic is.',
  'Equations are numbered the same way ([Equation 1]). Give the equations that matter for the story a slide of their own with layout "equation" and equation set to its number; leave out minor steps of a derivation. Set equation to 0 on every other slide. Never write TeX in titles or bullets: say it in words or plain symbols.',
  'Bullets are short phrases, under 12 words, without a final full stop. Put the detail in the speaker notes instead: 2-4 sentences a presenter can say out loud.',
  'Leave fields a layout does not use empty.',
].join('\n');

// How many slides to make: exactly count when the author set one, otherwise
// as many as the document needs, with no upper limit.
export function slideGoal(doc, count = 0) {
  if (count > 0) return `Make exactly ${count} slide${count === 1 ? '' : 's'}, counting the title slide. Merge or split points so the whole document fits in that many.`;
  const size = doc.blocks.filter((b) => b.type !== 'break').length;
  return [
    'There is no limit on the number of slides: use as many as the document needs to cover every section and main point, one idea per slide.',
    size > 150 ? 'It is a long document, so expect a long deck (often 30 slides or more).' : size > 60 ? 'It is a long document, so expect 15-30 slides or more.' : 'Do not pad a short document with filler slides.',
    'If the author asks for a number of slides below, follow that instead.',
  ].join(' ');
}

export function deckPrompt(doc, { name, extra = '', notes = true, count = 0 } = {}) {
  return [
    `Make a presentation from the document "${name}" below. Start with a title slide and give the deck a short title.`,
    slideGoal(doc, count),
    notes ? '' : 'Leave speaker notes empty.',
    extra.trim() ? `The author adds: ${extra.trim()}` : '',
    doc.images.length ? `The pictures are attached in order (Picture 1 first), so you can see what each one shows.` : '',
    `<document>\n${outlineText(doc).slice(0, 400000)}\n</document>`,
  ].filter(Boolean).join('\n\n');
}

const sentences = (text) => (text.match(/[^.!?]+(?:[.!?]+["')\]]*|$)(?=\s|$)/g) || [text]).map(tidy).filter(Boolean);
const chunk = (list, n) => {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out.length ? out : [[]];
};
// Splits into even parts of at most n (one more is fine), so no slide gets a lone leftover.
const balance = (list, n) => (list.length <= n + 1 ? [list] : chunk(list, Math.ceil(list.length / Math.ceil(list.length / n))));
// A picture's alt text is a caption only when it says something more than a file name would.
const caption = (im) => (/\s/.test(im?.alt || '') ? im.alt : '');
const slideOf = (layout, title, fields = {}) => ({ layout, title, subtitle: '', bullets: [], right_bullets: [], image: 0, table: 0, equation: 0, notes: '', ...fields });
const PLAIN_EQUATIONS = 2; // equation slides per section without AI

// Slides without AI: the first heading opens the deck, each heading starts a
// slide, paragraphs and lists become bullets, and pictures and tables get
// slides of their own beside the text they came with. A section's first
// equations get slides of their own too.
export function plainDeck(doc, name) {
  const blocks = doc.blocks.slice();
  let title = name;
  let subtitle = '';
  if (blocks[0]?.type === 'heading') {
    title = blocks.shift().text;
    if (blocks[0]?.type === 'para' && blocks[0].text.length <= 160) subtitle = blocks.shift().text;
  }
  const slides = [slideOf('title', title, { subtitle })];
  const levels = blocks.filter((b) => b.type === 'heading').map((b) => b.level);
  const top = Math.min(...levels);
  const sections = levels.some((l) => l > top);
  let cur = null;
  let lastTitle = title;

  const flush = () => {
    if (!cur) return;
    const t = cur.title || lastTitle;
    const images = cur.images.slice();
    const notes = cur.notes.join('\n\n');
    const tables = cur.tables.slice();
    // A line or two of text goes above the section's table instead of on a slide of its own.
    const withTable = !images.length && tables.length && cur.bullets.length <= 2 && cur.bullets.join(' ').length <= 160;
    if (withTable) {
      slides.push(slideOf('table', t, { table: tables.shift(), bullets: cur.bullets, notes }));
    } else if (cur.bullets.length) {
      const per = images.length ? MAX_BULLETS - 1 : MAX_BULLETS;
      balance(cur.bullets, per).forEach((part, i) => {
        const image = i === 0 && images.length ? images.shift() : 0;
        slides.push(slideOf(image ? 'image_bullets' : 'bullets', i ? `${t} (continued)` : t, { bullets: part, image, notes: i ? '' : notes }));
      });
    }
    for (const image of images) slides.push(slideOf('image', t, { image, subtitle: caption(doc.images[image - 1]) }));
    for (const table of tables) slides.push(slideOf('table', t, { table }));
    for (const equation of cur.equations.slice(0, PLAIN_EQUATIONS)) slides.push(slideOf('equation', t, { equation }));
    if (cur.quote) slides.push(slideOf('quote', cur.quote, { notes: cur.bullets.length ? '' : notes }));
    if (!cur.bullets.length && !cur.quote && !images.length && !cur.tables.length && !cur.equations.length && cur.title) slides.push(slideOf('section', cur.title));
    lastTitle = t;
    cur = null;
  };
  const open = (t = '') => {
    cur = { title: t, bullets: [], images: [], tables: [], equations: [], notes: [], quote: '' };
  };

  for (const b of blocks) {
    if (b.type === 'heading') {
      flush();
      if (sections && b.level === top) {
        slides.push(slideOf('section', b.text));
        lastTitle = b.text;
        continue;
      }
      open(b.text);
      continue;
    }
    if (b.type === 'break') {
      const t = cur?.title;
      flush();
      if (t) lastTitle = t;
      continue;
    }
    if (!cur) open('');
    if (b.type === 'para') {
      cur.bullets.push(...(b.text.length > 110 ? sentences(b.text) : [b.text]));
      if (b.text.length > 110) cur.notes.push(b.text);
    } else if (b.type === 'list') cur.bullets.push(...b.items.map((i) => i.text));
    else if (b.type === 'quote') {
      if (cur.quote) cur.bullets.push(`“${b.text}”`);
      else cur.quote = b.text;
    } else if (b.type === 'image') cur.images.push(b.index);
    else if (b.type === 'table') cur.tables.push(b.index);
    else if (b.type === 'math') cur.equations.push(b.index);
  }
  flush();
  // Slide titles the plain path never shortens can be long; keep them to a line or two.
  return { title, slides: slides.map((s) => (s.layout === 'quote' ? s : { ...s, title: s.title.length > 90 ? `${s.title.slice(0, 87).trimEnd()}…` : s.title })) };
}

// Makes an AI answer safe to lay out: known layouts, valid picture, table and
// equation numbers, and every picture and table used somewhere. With count,
// the deck keeps exactly the slides the author asked for.
export function cleanDeck(spec, doc, { notes = true, count = 0 } = {}) {
  const valid = (n, list) => (Number.isInteger(n) && n >= 1 && n <= list.length ? n : 0);
  const usedImages = new Set();
  const usedTables = new Set();
  let slides = (Array.isArray(spec?.slides) ? spec.slides : []).map((s) => {
    const out = slideOf(LAYOUTS.includes(s?.layout) ? s.layout : 'bullets', tidy(s?.title), {
      subtitle: tidy(s?.subtitle),
      bullets: (Array.isArray(s?.bullets) ? s.bullets : []).map(tidy).filter(Boolean),
      right_bullets: (Array.isArray(s?.right_bullets) ? s.right_bullets : []).map(tidy).filter(Boolean),
      image: valid(s?.image, doc.images),
      table: valid(s?.table, doc.tables),
      equation: valid(s?.equation, doc.equations || []),
      notes: notes ? String(s?.notes || '').trim() : '',
    });
    if ((out.layout === 'image' || out.layout === 'image_bullets') && !out.image) out.layout = 'bullets';
    if (out.layout === 'table' && !out.table) out.layout = 'bullets';
    if (out.layout === 'equation' && !out.equation) out.layout = 'bullets';
    if (out.layout === 'bullets' && !out.bullets.length && !out.subtitle) out.layout = 'section';
    if (out.layout !== 'image' && out.layout !== 'image_bullets') out.image = 0;
    if (out.layout !== 'table') out.table = 0;
    if (out.layout !== 'equation') out.equation = 0;
    if (out.image) usedImages.add(out.image);
    if (out.table) usedTables.add(out.table);
    return out;
  }).filter((s) => s.title || s.subtitle || s.bullets.length || s.right_bullets.length || s.image || s.table || s.equation);
  if (!slides.length || slides[0].layout !== 'title') slides.unshift(slideOf('title', tidy(spec?.title) || 'Presentation'));
  if (count > 0) return { title: tidy(spec?.title) || slides[0].title, slides: slides.slice(0, count) };
  const extra = [
    ...doc.images.map((im, i) => i + 1).filter((n) => !usedImages.has(n)).map((n) => slideOf('image', doc.images[n - 1].alt || `Picture ${n}`, { image: n })),
    ...doc.tables.map((t, i) => i + 1).filter((n) => !usedTables.has(n)).map((n) => slideOf('table', `Table ${n}`, { table: n })),
  ];
  if (extra.length) {
    const end = slides.length > 1 && ['section', 'quote', 'title'].includes(slides.at(-1).layout) ? slides.length - 1 : slides.length;
    slides = [...slides.slice(0, end), ...extra, ...slides.slice(end)];
  }
  return { title: tidy(spec?.title) || slides[0].title, slides };
}

// The largest font size, from max down to min, at which the bullets fit the box.
export function fitBullets(items, w, h, max = 26, min = 14) {
  for (let fs = max; fs > min; fs -= 1) {
    const perLine = Math.max(8, Math.floor((w - fs * 1.2) / (fs * 0.5)));
    const lines = items.reduce((n, t) => n + Math.max(1, Math.ceil(t.length / perLine)), 0);
    if (lines * fs * 1.35 + items.length * fs * 0.35 <= h) return fs;
  }
  return min;
}

function fitTitle(text, w, max, min = 22) {
  for (let fs = max; fs > min; fs -= 2) if (Math.ceil(text.length / Math.floor(w / (fs * 0.52))) <= 2) return fs;
  return min;
}

const text = (role, x, y, w, h, html, style) => ({ id: nid(), type: 'text', role, x, y, w, h, html, placeholder: '', style });
const bulletsEl = (items, x, y, w, h, max) => text('body', x, y, w, h, items.map((b) => `<div>${esc(b)}</div>`).join(''), { fontSize: fitBullets(items, w, h, max), align: 'left', bullets: true });
const headEl = (title) => text('title', 60, 34, 840, 84, esc(title), { fontSize: fitTitle(title, 840, 38), align: 'left' });

// A picture as large as fits the box, keeping its shape, centred in it.
export function fitImage(im, box, top = false) {
  const ratio = im?.w && im?.h ? im.w / im.h : 4 / 3;
  let w = box.w;
  let h = w / ratio;
  if (h > box.h) {
    h = box.h;
    w = h * ratio;
  }
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(top ? box.y : box.y + (box.h - h) / 2), w: Math.round(w), h: Math.round(h) };
}

const imageEl = (im, box, top) => ({ id: nid(), type: 'image', src: im.src, ...fitImage(im, box, top) });

// An equation at up to twice its drawn size, centred in the box.
export function fitEquation(eq, box) {
  const w0 = eq?.w || 300;
  const h0 = eq?.h || 60;
  const k = Math.min(2, box.w / w0, box.h / h0);
  const w = Math.round(w0 * k);
  const h = Math.round(h0 * k);
  return { x: Math.round(box.x + (box.w - w) / 2), y: Math.round(box.y + (box.h - h) / 2), w, h };
}

function tableEl(rows, y = 132, h = 370) {
  const fontSize = clamp(Math.floor(h / (rows.length * 1.9)), 10, 20);
  const height = Math.min(h, Math.ceil(rows.length * fontSize * 1.9));
  return { id: nid(), type: 'table', x: 60, y, w: 840, h: height, header: true, rows, style: { fontSize } };
}

// Present slides for a planned deck. Long tables run over several slides.
export function buildDeck(spec, doc) {
  const out = [];
  const push = (layout, elements, notes) => out.push({ id: nid(), layout, notes: notes || '', elements });
  for (const s of spec.slides) {
    const im = s.image ? doc.images[s.image - 1] : null;
    if (s.layout === 'title') {
      push('title', [
        text('title', 80, 150, 800, 135, esc(s.title), { fontSize: fitTitle(s.title, 800, 54, 30), align: 'center' }),
        text('subtitle', 140, 302, 680, 80, esc(s.subtitle), { fontSize: s.subtitle.length > 70 ? 20 : 24, align: 'center' }),
      ], s.notes);
    } else if (s.layout === 'section') {
      push('section', [
        text('title', 80, 190, 800, 100, esc(s.title), { fontSize: fitTitle(s.title, 800, 46, 28), align: 'left' }),
        text('subtitle', 80, 305, 800, 60, esc(s.subtitle), { fontSize: 22, align: 'left' }),
      ], s.notes);
    } else if (s.layout === 'quote') {
      push('blank', [
        text('body', 110, 110, 740, 250, esc(`“${s.title.replace(/^[“"]|[”"]$/g, '')}”`), { fontSize: fitBullets([s.title], 740, 250, 36, 20), align: 'center', italic: true, valign: 'middle' }),
        text('subtitle', 110, 380, 740, 44, esc(s.subtitle ? `— ${s.subtitle.replace(/^[—-]\s*/, '')}` : ''), { fontSize: 20, align: 'center' }),
      ], s.notes);
    } else if (s.layout === 'two') {
      const fs = Math.min(fitBullets(s.bullets, 410, 370, 24), fitBullets(s.right_bullets, 410, 370, 24));
      push('two', [
        headEl(s.title),
        { ...bulletsEl(s.bullets, 60, 132, 410, 370), style: { fontSize: fs, align: 'left', bullets: true } },
        { ...bulletsEl(s.right_bullets, 490, 132, 410, 370), style: { fontSize: fs, align: 'left', bullets: true } },
      ], s.notes);
    } else if (s.layout === 'image_bullets' && im) {
      const wide = im.w && im.h && im.w / im.h > 1.6;
      push('titleOnly', wide
        ? [headEl(s.title), bulletsEl(s.bullets, 60, 128, 840, 150, 22), imageEl(im, { x: 60, y: 290, w: 840, h: 220 })]
        : [headEl(s.title), bulletsEl(s.bullets, 60, 132, 470, 370, 24), imageEl(im, { x: 556, y: 140, w: 344, h: 362 }, true)], s.notes);
    } else if (s.layout === 'image' && im) {
      const els = [headEl(s.title), imageEl(im, { x: 60, y: 128, w: 840, h: s.subtitle ? 344 : 384 })];
      if (s.subtitle) els.push(text('subtitle', 60, 482, 840, 34, esc(s.subtitle), { fontSize: 16, align: 'center', italic: true }));
      push('titleOnly', els, s.notes);
    } else if (s.layout === 'equation' && doc.equations?.[s.equation - 1]?.src) {
      const eq = doc.equations[s.equation - 1];
      const box = s.bullets.length ? { x: 60, y: 132, w: 840, h: 210 } : { x: 60, y: 132, w: 840, h: 370 };
      const els = [headEl(s.title), { id: nid(), type: 'image', src: eq.src, ...fitEquation(eq, box) }];
      if (s.bullets.length) els.push(bulletsEl(s.bullets.slice(0, 4), 60, 360, 840, 150, 22));
      push('titleOnly', els, s.notes);
    } else if (s.layout === 'table' && s.table) {
      const [head, ...body] = doc.tables[s.table - 1];
      const lead = s.bullets.length ? bulletsEl(s.bullets, 60, 128, 840, 34 * s.bullets.length + 8, 22) : null;
      const top = lead ? lead.y + lead.h + 12 : 132;
      balance(body, TABLE_ROWS).forEach((part, i) => {
        const els = [headEl(i ? `${s.title} (continued)` : s.title)];
        if (lead && !i) els.push(lead);
        els.push(tableEl([head, ...part], i ? 132 : top, i ? 370 : 502 - top));
        push('titleOnly', els, i ? '' : s.notes);
      });
    } else {
      // An equation that could not be drawn shows its TeX instead.
      const tex = s.equation ? doc.equations?.[s.equation - 1]?.tex : '';
      const items = [...(tex ? [tex] : []), ...(s.bullets.length ? s.bullets : s.subtitle ? [s.subtitle] : [])];
      balance(items, 8).forEach((part, i) => {
        push('content', [headEl(i ? `${s.title} (continued)` : s.title), bulletsEl(part, 60, 132, 840, 370, 26)], i ? '' : s.notes);
      });
    }
  }
  return out;
}

// Leaves out pictures that could not be loaded (no src) and renumbers the rest.
export function keepLoadedImages(doc) {
  const map = new Map();
  const images = [];
  doc.images.forEach((im, i) => {
    if (!im.src) return;
    images.push(im);
    map.set(i + 1, images.length);
  });
  doc.blocks = doc.blocks.filter((b) => b.type !== 'image' || map.has(b.index)).map((b) => (b.type === 'image' ? { ...b, index: map.get(b.index) } : b));
  doc.images = images;
  return doc;
}
