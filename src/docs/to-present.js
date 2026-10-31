// Send to Present: turns the document (or the selected part) into a new
// presentation. With an AI connected it plans the slides from the text,
// pictures and equations, as many as the document needs unless the author
// asks for a number; without one, each heading becomes a slide. Write's
// LaTeX mode uses the same dialog through presentDialog.

import './to-present.css';
import { dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { allThemes, themePicker } from '../shared/themes.js';
import { DECK_SCHEMA, DECK_SYSTEM, buildDeck, cleanDeck, deckPrompt, isEmpty, plainDeck, readDocument } from './deck.js';

const MAX_SIDE = 1600; // pictures larger than this are scaled down for the deck
const AI_SIDE = 1024; // and to this for the AI to look at
const MAX_SLIDES = 300;
const last = { theme: 'slate', ai: true, notes: true, extra: '', count: '' };

function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function scaled(img, src, side) {
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  if (k === 1 && /^data:image\/(png|jpeg|gif|webp);/.test(src)) return src;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return /^data:image\/jpeg/.test(src) ? c.toDataURL('image/jpeg', 0.88) : c.toDataURL('image/png');
}

// Sizes the document's pictures and keeps smaller copies for the deck and the AI.
export async function preparePictures(doc) {
  for (const im of doc.images) {
    const img = await loadImage(im.src);
    if (!img) continue;
    im.w = img.naturalWidth;
    im.h = img.naturalHeight;
    try {
      im.forAi = scaled(img, im.src, AI_SIDE);
      im.src = scaled(img, im.src, MAX_SIDE);
    } catch {}
  }
}

let math = null;
// The TeX engine is a bundle of its own, loaded on first use.
function loadMath() {
  const url = './mathjax.js';
  math ||= import(url).catch((err) => {
    math = null;
    throw err;
  });
  return math;
}

function svgPng(svg, width, height, scale = 3) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('The equation could not be drawn.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

// Draws the equations the slides show, in the template's text colour. An
// equation MathJax can't read keeps its picture, or shows its TeX.
async function drawEquations(doc, slides, color) {
  const used = [...new Set(slides.map((s) => s.equation).filter(Boolean))].map((n) => doc.equations[n - 1]).filter(Boolean);
  if (!used.length) return;
  const mj = await loadMath().catch(() => null);
  for (const eq of used) {
    for (const tex of mj && eq.tex ? [`${doc.macros || ''}${eq.tex}`, eq.tex] : []) {
      try {
        const r = mj.texToSvg(tex, { fontSize: 20 });
        eq.src = await svgPng(r.svg.replaceAll('currentColor', color), r.width, r.height);
        eq.w = r.width;
        eq.h = r.height;
        break;
      } catch {}
    }
    if (eq.w || !eq.src) continue;
    const img = await loadImage(eq.src);
    if (img) {
      eq.w = img.naturalWidth / 3;
      eq.h = img.naturalHeight / 3;
    } else eq.src = '';
  }
}

function progress(label) {
  const back = h('div', 'modal-back');
  const box = h('div', 'modal wp-progress', `<div class="modal-title">${escapeHtml(label)}</div><div class="wp-bar"><i></i></div><p class="muted" data-count>Reading your document…</p>`);
  const actions = h('div', 'modal-actions');
  const stop = h('button', 'btn', 'Stop');
  stop.type = 'button';
  actions.append(stop);
  box.append(actions);
  back.append(box);
  document.body.append(back);
  const count = box.querySelector('[data-count]');
  return {
    onStop: (fn) => { stop.onclick = fn; },
    update: (n, slides) => { count.textContent = slides > 1 ? `Writing slide ${slides.toLocaleString()}…` : `Writing the slides… ${n.toLocaleString()} characters`; },
    close: () => back.remove(),
  };
}

function askAi(doc, opts, providerLabel) {
  return new Promise(async (resolve, reject) => {
    const id = `deck${Date.now()}`;
    const bar = progress(`Making slides with ${providerLabel}`);
    let text = '';
    let stopped = false;
    bar.onStop(() => {
      stopped = true;
      window.office.claude.cancel(id);
    });
    const pics = doc.images.filter((im) => im.forAi).map((im, i) => ({ src: im.forAi, name: im.alt || `Picture ${i + 1}` }));
    const att = pics.length && pics.length === doc.images.length ? await window.office.claude.attachImages(pics) : null;
    window.office.claude.stream(id, {
      system: DECK_SYSTEM,
      messages: [{ role: 'user', content: deckPrompt(doc, opts), attachments: att ? [att] : [] }],
      format: DECK_SCHEMA,
      maxTokens: 64000,
    }, (evt) => {
      if (evt.type === 'text') {
        text += evt.text;
        bar.update(text.length, (text.match(/"layout"\s*:/g) || []).length);
        return;
      }
      bar.close();
      if (evt.type === 'error') return reject(new Error(evt.message));
      if (stopped || !text) return resolve(null);
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error(`${providerLabel}’s answer was cut off. Try asking for fewer slides, or send part of the document.`));
      }
    });
  });
}

export function sendToPresent({ editor, name, showAi }) {
  const sel = editor.state.selection;
  const part = sel.empty ? null : readDocument({ type: 'doc', content: sel.content().content.toJSON() });
  return presentDialog({ name, whole: readDocument(editor.getJSON()), part, showAi });
}

// The Send to Present dialog for a document read into blocks (readDocument,
// or readLatex for a LaTeX project). prepare(doc) loads its pictures.
export async function presentDialog({ name, whole, part, showAi, prepare = preparePictures }) {
  if (isEmpty(whole)) {
    toast('Write something first. Headings, paragraphs, lists, pictures, tables and equations all become slides.', 'error');
    return;
  }
  const settings = await window.office.settings.get();
  const base = name.replace(/\.(docx?|odt|rtf|txt|md|html?|tex)$/i, '');

  const body = h('div', 'wp-present');
  const titleInput = h('input');
  titleInput.value = base;
  const titleRow = h('label', 'modal-field');
  titleRow.append(h('span', '', 'Presentation name'), titleInput);
  body.append(titleRow);

  let onlySel = null;
  if (part && !isEmpty(part)) {
    onlySel = h('input');
    onlySel.type = 'checkbox';
    onlySel.checked = true;
    const l = h('label', 'wp-check');
    l.append(onlySel, h('span', '', 'Only the selected part of the document'));
    body.append(l);
  }
  const summary = h('p', 'muted wp-found');
  const count = () => {
    const d = onlySel?.checked ? part : whole;
    const n = (k) => d.blocks.filter((b) => b.type === k).length;
    const bits = [[n('heading'), 'heading'], [d.images.length, 'picture'], [d.tables.length, 'table'], [d.equations?.length || 0, 'equation']].filter(([v]) => v).map(([v, w]) => `${v} ${w}${v === 1 ? '' : 's'}`);
    summary.textContent = bits.length ? `Found ${bits.join(', ')}. Pictures and tables go on slides of their own or beside the text.` : 'No headings found, so the text is split over several slides.';
  };
  if (onlySel) onlySel.onchange = count;
  count();
  body.append(summary);

  body.append(h('b', 'wp-label', 'Template'));
  const themes = themePicker(last.theme);
  body.append(themes);

  body.append(h('b', 'wp-label', 'How to make the slides'));
  const how = h('div', 'wp-how');
  const choice = (value, title, detail, disabled) => {
    const l = h('label', `wp-choice${disabled ? ' off' : ''}`);
    const r = h('input');
    r.type = 'radio';
    r.name = 'wp-how';
    r.value = value;
    r.disabled = disabled;
    l.append(r, h('span', '', `<b>${escapeHtml(title)}</b><small>${detail}</small>`));
    how.append(l);
    return r;
  };
  const aiRadio = choice('ai', `Design with ${settings.providerLabel}`, settings.ready
    ? 'Picks the layouts, writes short bullets and speaker notes, and places your pictures, tables and equations. Makes as many slides as the document needs.'
    : `Connect ${escapeHtml(settings.providerLabel)} or another AI in the AI pane first. <a href="#" data-connect>Open the AI pane</a>`, !settings.ready);
  const plainRadio = choice('plain', 'Simple, without AI', 'One slide per heading. Paragraphs and lists become bullets, and long sections continue on the next slide.', false);
  (settings.ready && last.ai ? aiRadio : plainRadio).checked = true;
  body.append(how);
  how.querySelector('[data-connect]')?.addEventListener('click', (e) => {
    e.preventDefault();
    body.closest('.modal-back')?.querySelector('.modal-actions .btn:not(.primary)')?.click();
    showAi();
  });

  const aiOpts = h('div', 'wp-ai');
  const countInput = h('input');
  countInput.type = 'number';
  countInput.min = '1';
  countInput.max = String(MAX_SLIDES);
  countInput.placeholder = 'Any';
  countInput.value = last.count;
  const countRow = h('label', 'wp-count');
  countRow.append(h('span', '', 'Number of slides'), countInput, h('small', '', 'Leave empty and the AI uses as many as it needs.'));
  const extra = h('textarea');
  extra.rows = 2;
  extra.placeholder = 'Anything to add? For example: for a 10-minute class talk, keep it simple.';
  extra.value = last.extra;
  const notesBox = h('input');
  notesBox.type = 'checkbox';
  notesBox.checked = last.notes;
  const notesRow = h('label', 'wp-check');
  notesRow.append(notesBox, h('span', '', 'Write speaker notes'));
  aiOpts.append(countRow, extra, notesRow);
  body.append(aiOpts);
  const sync = () => { aiOpts.hidden = !aiRadio.checked; };
  how.addEventListener('change', sync);
  sync();

  const ok = await dialog({ title: 'Send to Present', body, wide: true, ok: 'Make presentation' });
  if (!ok) return;
  const useAi = aiRadio.checked;
  const slideCount = Math.min(MAX_SLIDES, Math.max(0, Math.round(Number(countInput.value) || 0)));
  Object.assign(last, { theme: themes.read(), ai: useAi, notes: notesBox.checked, extra: extra.value, count: slideCount ? String(slideCount) : '' });
  const doc = structuredClone(onlySel?.checked ? part : whole);
  const title = titleInput.value.trim() || base;
  await prepare(doc);

  let spec = null;
  if (useAi) {
    try {
      const answer = await askAi(doc, { name: title, extra: extra.value, notes: notesBox.checked, count: slideCount }, settings.providerLabel);
      if (!answer) return;
      spec = cleanDeck(answer, doc, { notes: notesBox.checked, count: slideCount });
    } catch (err) {
      const again = await dialog({ title: 'Send to Present', body: `<p>${escapeHtml(err.message || String(err))}</p><p>Make simple slides without AI instead?</p>`, ok: 'Make simple slides' });
      if (!again) return;
    }
  }
  if (!spec) spec = plainDeck(doc, title);
  await drawEquations(doc, spec.slides, allThemes()[last.theme]?.text || '#1f2328');
  const slides = buildDeck(spec, doc);
  // An untitled document's deck takes the title the slides were given.
  const deckName = title === base && /^(Document|Untitled)\d*$/.test(base) ? spec.title || base : title;
  const res = await window.office.newWith({ kind: 'deck', title: deckName, theme: last.theme, slides });
  if (res?.error) toast(res.error, 'error');
  else toast(`Opened ${slides.length} slide${slides.length === 1 ? '' : 's'} in Present. Save as .pptx from File › Save As.`);
}
