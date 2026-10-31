// Read: Work's PDF reader and editor. Pages are drawn by pdf.js; highlights,
// comments, drawings, shapes, text boxes and signatures are kept as Read's
// own annotations and written into the PDF on save (see pdf-edit.js).

import '../shared/ui.css';
import './pdf.css';
import { createShell, escapeHtml, h, toast, dialog } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { closePopup, popup } from '../shared/ribbon.js';
import { Reader, CSS_PER_PT } from './viewer.js';
import { AnnotLayer, DRAW_TOOLS } from './annots.js';
import { Finder } from './find.js';
import { PDFDocument, blankPage, buildPdf, deletePages, extractPages, insertPdf, movePage, openForEditing, rotatePages } from './pdf-edit.js';
import { MARKUPS, TYPE_LABELS, bounds, newId } from './annot-data.js';
import { createSignature } from './sign.js';
import { paperInfo } from './paper.js';
import { toPlot, toPresent, toWrite } from './convert.js';

const COLORS = ['#ffd400', '#7ee081', '#6cc7f5', '#ff8fb1', '#ffa94d', '#c19bff', '#d1242f', '#1f6feb', '#1a7f37', '#111111'];
const MAX_UNDO = 40;

let editDoc = null; // pdf-lib document without the annotations Read edits
let viewBytes = null; // what pdf.js shows (the same pages)
let annots = [];
let editable = false;
let locked = '';
let tool = 'select';
let pendingImage = null;
let author = '';
let selectedAnnot = null;
const undoStack = [];
const redoStack = [];
const style = {
  highlight: { color: '#ffd400', opacity: 0.45 },
  underline: { color: '#1f6feb' },
  strike: { color: '#d1242f' },
  ink: { color: '#d1242f', width: 2, opacity: 1 },
  shape: { color: '#d1242f', width: 2, fill: null, opacity: 1 },
  text: { color: '#111111', size: 12 },
  note: { color: '#ffd400' },
};
const styleFor = (t) => (MARKUPS.includes(t) ? style[t] : t === 'ink' ? style.ink : t === 'text' ? style.text : t === 'note' ? style.note : style.shape);

// --- Layout ---------------------------------------------------------------

const frame = h('div', 'rd-frame');
const side = h('aside', 'rd-side');
const sideTabs = h('div', 'rd-side-tabs');
const sideBody = h('div', 'rd-side-body');
side.append(sideTabs, sideBody);
const mainCol = h('div', 'rd-main');
const viewHost = h('div', 'rd-view');
mainCol.append(viewHost);
frame.append(side, mainCol);
const empty = h('div', 'rd-empty', `${icon('appRead', 56)}<h2>Open a PDF to read, mark up and sign it</h2><button class="btn primary">${icon('open', 16)} Open a PDF…</button>`);
empty.querySelector('button').onclick = () => window.office.openDialog('pdf');

const reader = new Reader(viewHost, {
  onPage: (n) => {
    pageInput.value = n;
    thumbs.mark(n);
  },
  onPageReady: (p) => layer.attach(p),
  onDrawn: (p) => finder.matches.length && finder.paintPage(p),
  onScale: (s) => {
    zoomLabel.textContent = `${Math.round(s * 100)}%`;
    placeBars();
  },
});

const layer = new AnnotLayer(reader, {
  annots: () => annots,
  commit: (fn) => commit(fn),
  tool: () => tool,
  style: (t) => styleFor(t || tool),
  author: () => author,
  pending: () => pendingImage,
  setTool: (t) => setTool(t),
  onSelect: (a) => {
    selectedAnnot = a;
    placeBars();
    comments.mark(a?.id);
  },
  onEditNote: (a, fresh) => editNote(a, fresh),
});

const finder = new Finder(reader, mainCol);

// --- Annotations, undo ----------------------------------------------------

function snapshot() {
  undoStack.push({ annots, viewBytes });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
}

function changed() {
  shell.markDirty();
  layer.renderAll();
  comments.render();
  placeBars();
  shell.refresh();
}

function commit(fn) {
  if (!editable) {
    toast(locked || 'This PDF can’t be changed.', 'error');
    layer.renderAll();
    return;
  }
  snapshot();
  annots = fn(annots);
  if (selectedAnnot && !annots.some((a) => a.id === selectedAnnot.id)) layer.select(null);
  else if (selectedAnnot) selectedAnnot = annots.find((a) => a.id === selectedAnnot.id);
  changed();
}

async function restore(from, to) {
  const st = from.pop();
  if (!st) return;
  to.push({ annots, viewBytes });
  const pagesChanged = st.viewBytes !== viewBytes;
  annots = st.annots;
  if (pagesChanged) {
    viewBytes = st.viewBytes;
    editDoc = await PDFDocument.load(viewBytes, { updateMetadata: false });
    await reload(true);
  }
  layer.select(null);
  changed();
}

const undo = () => restore(undoStack, redoStack);
const redo = () => restore(redoStack, undoStack);

function update(id, patch) {
  commit((list) => list.map((a) => (a.id === id ? { ...a, ...patch, modified: new Date().toISOString() } : a)));
}

function removeAnnot(id) {
  commit((list) => list.filter((a) => a.id !== id));
}

// --- Tools ----------------------------------------------------------------

const TOOL_HINTS = {
  select: 'Select text, or click a comment to change it',
  hand: 'Drag to move around the page',
  highlight: 'Select text to highlight it',
  underline: 'Select text to underline it',
  strike: 'Select text to strike it out',
  ink: 'Draw on the page. Strokes close together join into one drawing',
  rect: 'Drag to draw a rectangle (Shift for a square)',
  ellipse: 'Drag to draw an oval (Shift for a circle)',
  line: 'Drag to draw a line',
  arrow: 'Drag to draw an arrow',
  note: 'Click where the sticky note goes',
  text: 'Click or drag where the text goes',
  place: 'Click where it goes',
  eraser: 'Click a comment or drawing to remove it',
};

function setTool(t) {
  tool = t;
  if (t !== 'place') pendingImage = null;
  viewHost.dataset.tool = t;
  layer.setActive(DRAW_TOOLS.includes(t), t === 'eraser' ? 'not-allowed' : t === 'place' ? 'copy' : t === 'note' ? 'cell' : 'crosshair');
  toolHint.textContent = TOOL_HINTS[t] || '';
  if (t !== 'select') layer.select(null);
  // A selection made before picking a markup tool gets marked straight away.
  if (MARKUPS.includes(t) && editable) layer.markSelection(t);
  shell.refresh();
}

const toolBtn = (id, label, ic, title) => ({ type: 'big', icon: ic, label, title: title || TOOL_HINTS[id], active: () => tool === id, enabled: () => !!reader.doc, run: () => setTool(tool === id && id !== 'select' ? 'select' : id) });

function pickColor(kind, anchor) {
  const box = h('div', 'rd-swatches');
  for (const c of COLORS) {
    const b = h('button', `rd-swatch${styleFor(kind).color === c ? ' on' : ''}`);
    b.style.background = c;
    b.title = c;
    b.onclick = () => {
      closePopup();
      styleFor(kind).color = c;
      if (selectedAnnot && styleFor(selectedAnnot.type) === styleFor(kind)) update(selectedAnnot.id, { color: c });
      shell.refresh();
    };
    box.append(b);
  }
  const custom = h('label', 'rb-color-custom', 'More colors… <input type="color">');
  custom.querySelector('input').onchange = (e) => {
    closePopup();
    styleFor(kind).color = e.target.value;
  };
  box.append(custom);
  popup(anchor, box);
}

const widthOptions = [0.5, 1, 2, 3, 4, 6, 8].map((w) => ({ value: String(w), label: `${w} pt` }));

// --- Signatures, stamps and fill-in --------------------------------------

function placeImage(img) {
  pendingImage = img;
  setTool('place');
  toast('Click on the page where it goes');
}

async function signatureMenu(kind) {
  const saved = ((await window.office.pdf.signatures()) || []).filter((s) => s.kind === kind);
  const items = saved.map((s) => ({ html: `<img class="rd-sig-thumb" src="${s.src}" alt="">`, label: 'Saved', run: () => placeImage({ ...s, width: kind === 'initials' ? 60 : 150 }) }));
  if (items.length) items.push('-');
  items.push({ label: kind === 'initials' ? 'Add initials…' : 'Add signature…', icon: 'plus', run: () => newSignature(kind) });
  if (saved.length) items.push({ label: 'Clear saved', icon: 'trash', run: () => clearSignatures(kind) });
  return items;
}

async function newSignature(kind) {
  const s = await createSignature(kind, author);
  if (s) placeImage({ ...s, width: kind === 'initials' ? 60 : 150 });
}

async function clearSignatures(kind) {
  const list = (await window.office.pdf.signatures()) || [];
  await window.office.pdf.setSignatures(list.filter((s) => s.kind !== kind));
  toast(kind === 'initials' ? 'Saved initials removed' : 'Saved signatures removed');
}

function menuButton(label, ic, items, title) {
  return {
    type: 'big', icon: ic, label: `${label} ▾`, title, enabled: () => !!reader.doc,
    run: async (e, b) => {
      const list = h('div', 'rb-menu');
      for (const mi of await items()) {
        if (mi === '-') {
          list.append(h('div', 'rb-menu-sep'));
          continue;
        }
        const m = h('button', 'rb-menu-item', mi.html || `${mi.icon ? icon(mi.icon, 16) : '<span class="ico"></span>'}<span>${escapeHtml(mi.label)}</span>`);
        m.onclick = () => {
          closePopup();
          mi.run();
        };
        list.append(m);
      }
      popup(b, list);
    },
  };
}

// A check, cross or dot drawn as pen strokes, so it saves with any font.
function placeMark(kind) {
  const shapes = {
    check: [[0, 5, 3.5, 1.5, 10, 9]],
    cross: [[0, 0, 9, 9], [0, 9, 9, 0]],
    dot: [[4.5, 4.5]],
  };
  pendingImage = null;
  const once = (e) => {
    const p = reader.pageAt(e.clientX, e.clientY);
    viewHost.removeEventListener('pointerdown', once, true);
    setTool('select');
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const [vx, vy] = reader.clientToView(p, e.clientX, e.clientY);
    const paths = shapes[kind].map((path) => path.map((v, i) => v + (i % 2 ? vy - 5 : vx - 5))).map((path) => {
      const out = [];
      for (let i = 0; i + 1 < path.length; i += 2) out.push(...reader.toUser(p, path[i], path[i + 1]));
      return out;
    });
    commit((list) => [...list, { id: newId(), type: 'ink', page: p.index, paths, width: kind === 'dot' ? 5 : 1.6, color: style.text.color, opacity: 1, author, modified: new Date().toISOString(), note: '' }]);
  };
  setTool('place');
  pendingImage = { mark: kind };
  viewHost.addEventListener('pointerdown', once, true);
}

function addDate() {
  const d = new Date().toLocaleDateString();
  const once = (e) => {
    const p = reader.pageAt(e.clientX, e.clientY);
    viewHost.removeEventListener('pointerdown', once, true);
    setTool('select');
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    const [vx, vy] = reader.clientToView(p, e.clientX, e.clientY);
    const size = style.text.size;
    const vr = [vx, vy - size * 0.8, vx + Math.max(60, d.length * size * 0.6), vy + size * 0.8];
    commit((list) => [...list, { id: newId(), type: 'text', page: p.index, rot: p.page.rotate, rect: reader.userRect(p, vr), text: d, size, color: style.text.color, opacity: 1, author, modified: new Date().toISOString(), note: '' }]);
  };
  setTool('place');
  pendingImage = { date: true };
  viewHost.addEventListener('pointerdown', once, true);
  toast('Click where the date goes');
}

function insertPicture() {
  const input = h('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg';
  input.onchange = async () => {
    const file = input.files[0];
    if (!file) return;
    const src = await new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.readAsDataURL(file);
    });
    const img = new Image();
    img.src = src;
    await img.decode();
    placeImage({ src, w: img.naturalWidth, h: img.naturalHeight, width: 200, kind: 'picture' });
  };
  input.click();
}

// --- Pages ----------------------------------------------------------------

function parseRange(text, max) {
  const out = new Set();
  for (const part of String(text || '').split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) return null;
    const a = +m[1];
    const b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) if (i >= 1 && i <= max) out.add(i - 1);
  }
  return [...out].sort((x, y) => x - y);
}

async function askPages(title, ok, value) {
  const got = await dialog({ title, fields: [{ name: 'pages', label: `Pages (for example 1-3, 5) of ${reader.pageCount}`, value: value || String(reader.currentPage()) }], ok });
  if (!got) return null;
  const list = parseRange(got.pages, reader.pageCount);
  if (!list?.length) {
    toast('Type page numbers like 1-3, 5', 'error');
    return null;
  }
  return list;
}

async function pageOp(fn, mapAnnots, keepPlace = true) {
  if (!editable) {
    toast(locked || 'This PDF can’t be changed.', 'error');
    return;
  }
  snapshot();
  try {
    await fn(editDoc);
    viewBytes = await editDoc.save();
  } catch (err) {
    undoStack.pop();
    toast(`That didn’t work: ${err.message || err}`, 'error');
    editDoc = await PDFDocument.load(viewBytes, { updateMetadata: false });
    return;
  }
  if (mapAnnots) annots = mapAnnots(annots);
  layer.select(null);
  await reload(keepPlace);
  changed();
}

async function rotate(by, all = false) {
  const idx = all ? [...Array(reader.pageCount).keys()] : [reader.currentPage() - 1];
  await pageOp((d) => rotatePages(d, idx, by));
}

async function removePages() {
  if (reader.pageCount < 2) return toast('A PDF needs at least one page', 'error');
  const list = await askPages('Delete pages', 'Delete');
  if (!list) return;
  if (list.length >= reader.pageCount) return toast('A PDF needs at least one page', 'error');
  const gone = new Set(list);
  const shift = (i) => i - list.filter((x) => x < i).length;
  await pageOp((d) => deletePages(d, list), (l) => l.filter((a) => !gone.has(a.page)).map((a) => ({ ...a, page: shift(a.page) })));
}

async function moveCurrent(by) {
  const from = reader.currentPage() - 1;
  const to = from + by;
  if (to < 0 || to >= reader.pageCount) return;
  await pageOp((d) => movePage(d, from, to), (l) => l.map((a) => ({ ...a, page: a.page === from ? to : a.page === to ? from : a.page })));
  reader.scrollToPage(to + 1);
}

async function insertFromFile(atEnd = false) {
  const picked = await window.office.pdf.pick({ multi: true });
  if (picked?.error) return toast(picked.error, 'error');
  if (!picked?.length) return;
  let at = atEnd ? reader.pageCount : reader.currentPage();
  let added = 0;
  await pageOp(async (d) => {
    for (const f of picked) {
      const n = await insertPdf(d, f.bytes, at);
      at += n;
      added += n;
    }
  }, (l) => l.map((a) => (a.page >= (atEnd ? Infinity : reader.currentPage()) ? { ...a, page: a.page + added } : a)));
  toast(`Added ${added} page${added === 1 ? '' : 's'}`);
}

async function insertBlank() {
  const at = reader.currentPage();
  await pageOp((d) => blankPage(d, at), (l) => l.map((a) => (a.page >= at ? { ...a, page: a.page + 1 } : a)));
  reader.scrollToPage(at + 1);
}

async function extract() {
  const list = await askPages('Extract pages to a new PDF', 'Extract');
  if (!list) return;
  const bytes = await extractPages(viewBytes, annots, list);
  const res = await window.office.pdf.save({ bytes, copy: true, suggestedName: `${baseName()} (pages ${list.map((i) => i + 1).join(', ').slice(0, 40)}).pdf` });
  if (res?.error) toast(res.error, 'error');
  else if (res) toast(`Saved ${res.name}`);
}

// --- Saving, printing, exporting -----------------------------------------

const baseName = () => shell.state.name.replace(/\.pdf$/i, '');

async function savePdf({ saveAs = false, copy = false } = {}) {
  if (!reader.doc) return false;
  if (!editable && !copy) {
    toast(locked || 'This PDF can’t be changed.', 'error');
    return false;
  }
  try {
    const bytes = editable ? await buildPdf(viewBytes, annots) : viewBytes;
    const res = await window.office.pdf.save({ bytes, saveAs, copy, suggestedName: copy ? `${baseName()} copy.pdf` : shell.state.name });
    if (!res) return false;
    if (res.error) {
      toast(res.error, 'error');
      return false;
    }
    if (!copy) {
      shell.state.path = res.path;
      shell.state.name = res.name;
      shell.markClean();
    }
    toast(`Saved ${res.name}`);
    return true;
  } catch (err) {
    toast(`Couldn’t save: ${err.message || err}`, 'error');
    return false;
  }
}

// Prints what the saved file would look like, comments included.
async function printPdf() {
  if (!reader.doc) return;
  toast('Getting pages ready to print…');
  const bytes = editable ? await buildPdf(viewBytes, annots) : viewBytes;
  const tmp = new Reader(h('div'));
  await tmp.load(bytes);
  const box = h('div', 'rd-print');
  for (let i = 0; i < tmp.pageCount; i++) {
    const c = await tmp.render(i, 150 / 72);
    const img = h('img');
    img.src = c.toDataURL('image/jpeg', 0.92);
    box.append(img);
  }
  tmp.clear();
  document.body.append(box);
  document.body.classList.add('rd-printing');
  await new Promise((r) => setTimeout(r, 100));
  await window.office.print();
  setTimeout(() => {
    box.remove();
    document.body.classList.remove('rd-printing');
  }, 800);
}

async function exportPageImage() {
  const n = reader.currentPage();
  const canvas = await reader.render(n - 1, 200 / 72);
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  const res = await window.office.data.saveBytes({ name: `${baseName()} page ${n}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }], data: new Uint8Array(await blob.arrayBuffer()) });
  if (res?.name) toast(`Saved ${res.name}`);
}

async function exportText() {
  const parts = [];
  for (let i = 0; i < reader.pageCount; i++) parts.push((await reader.text(i)).str);
  const res = await window.office.data.saveBytes({ name: `${baseName()}.txt`, filters: [{ name: 'Text', extensions: ['txt'] }], data: parts.join('\n\f\n') });
  if (res?.name) toast(`Saved ${res.name}`);
}

async function convert(kind) {
  if (!reader.doc) return;
  const name = shell.state.name;
  const progress = (i, n) => {
    toolHint.textContent = `Converting page ${i} of ${n}…`;
  };
  try {
    if (kind === 'write') await toWrite(reader, name, { onProgress: progress });
    if (kind === 'notes') await toWrite(reader, name, { notes: true, onProgress: progress });
    if (kind === 'plot') await toPlot(reader, name, { onProgress: progress });
    if (kind === 'present') {
      // Slides show the pages as they would print, comments and signatures included.
      const pictures = new Reader(h('div'));
      await pictures.load(editable ? await buildPdf(viewBytes, annots) : viewBytes);
      try {
        await toPresent(reader, name, { onProgress: progress, pictures });
      } finally {
        pictures.clear();
      }
    }
  } catch (err) {
    toast(`Couldn’t convert: ${err.message || err}`, 'error');
  } finally {
    toolHint.textContent = TOOL_HINTS[tool] || '';
  }
}

async function cite() {
  if (!reader.doc) return;
  const paper = await paperInfo(reader, { fileName: shell.state.name, filePath: shell.state.path });
  const { openCiteDialog } = await import('../shared/cite.js');
  await openCiteDialog(paper);
}

// --- Side panel: pages, bookmarks, comments ------------------------------

const thumbs = {
  list: h('div', 'rd-thumbs'),
  observer: null,
  build() {
    this.list.innerHTML = '';
    this.observer?.disconnect();
    this.observer = new IntersectionObserver((entries) => {
      for (const e of entries) if (e.isIntersecting) this.draw(e.target);
    }, { root: sideBody, rootMargin: '400px 0px' });
    for (const p of reader.pages) {
      const t = h('button', 'rd-thumb', `<div class="rd-thumb-page"></div><span>${p.num}</span>`);
      t.dataset.page = p.num;
      const box = t.firstChild;
      const w = 120;
      box.style.width = `${w}px`;
      box.style.height = `${Math.round((w * p.hgt) / p.w)}px`;
      t.onclick = () => reader.scrollToPage(p.num);
      this.list.append(t);
      this.observer.observe(t);
    }
    this.mark(reader.currentPage());
  },
  async draw(t) {
    if (t.dataset.drawn) return;
    t.dataset.drawn = '1';
    const i = +t.dataset.page - 1;
    const p = reader.pages[i];
    if (!p) return;
    try {
      const c = await reader.render(i, (120 * (window.devicePixelRatio || 1)) / p.w);
      t.firstChild.append(c);
    } catch {
      delete t.dataset.drawn;
    }
  },
  mark(n) {
    for (const t of this.list.children) t.classList.toggle('on', +t.dataset.page === n);
    const on = this.list.querySelector('.on');
    if (on && sidePanel === 'pages' && !side.classList.contains('closed')) {
      const r = on.getBoundingClientRect();
      const b = sideBody.getBoundingClientRect();
      if (r.top < b.top || r.bottom > b.bottom) on.scrollIntoView({ block: 'nearest' });
    }
  },
};

const outline = {
  box: h('div', 'rd-outline'),
  async build() {
    this.box.innerHTML = '';
    const items = await reader.doc.getOutline().catch(() => null);
    if (!items?.length) {
      this.box.append(h('div', 'rd-side-empty', 'This PDF has no bookmarks.'));
      return;
    }
    const walk = (list, host, depth) => {
      for (const it of list) {
        const row = h('div', 'rd-ol-row');
        row.style.paddingLeft = `${6 + depth * 14}px`;
        const kids = it.items?.length;
        const tw = h('button', `rd-ol-twist${kids ? '' : ' none'}`, kids ? '▸' : '');
        const label = h('button', 'rd-ol-label', escapeHtml(it.title || 'Untitled'));
        label.title = it.title || '';
        row.append(tw, label);
        host.append(row);
        let sub = null;
        if (kids) {
          sub = h('div', 'rd-ol-kids');
          sub.hidden = depth > 0;
          tw.textContent = sub.hidden ? '▸' : '▾';
          walk(it.items, sub, depth + 1);
          host.append(sub);
          tw.onclick = () => {
            sub.hidden = !sub.hidden;
            tw.textContent = sub.hidden ? '▸' : '▾';
          };
        }
        label.onclick = async () => {
          if (it.url) return window.office.openExternal(it.url);
          const d = await reader.destination(it.dest);
          if (d) reader.scrollToPage(d.page, d.y);
        };
      }
    };
    walk(items, this.box, 0);
  },
};

const comments = {
  box: h('div', 'rd-comments'),
  render() {
    this.box.innerHTML = '';
    if (!annots.length) {
      this.box.append(h('div', 'rd-side-empty', 'No comments yet. Highlight text, add a sticky note or draw on a page and it shows up here.'));
      return;
    }
    const sorted = [...annots].sort((a, b) => a.page - b.page || bounds(b)[3] - bounds(a)[3]);
    let page = -1;
    for (const a of sorted) {
      if (a.page !== page) {
        page = a.page;
        this.box.append(h('div', 'rd-cm-page', `Page ${page + 1}`));
      }
      const quote = a.quote || (a.type === 'text' ? a.text : '');
      const row = h('button', 'rd-cm', `<i style="background:${escapeHtml(a.color)}"></i><div><b>${escapeHtml(TYPE_LABELS[a.type] || a.type)}</b>${a.author ? `<small>${escapeHtml(a.author)}${a.modified ? ` · ${escapeHtml(new Date(a.modified).toLocaleDateString())}` : ''}</small>` : ''}${quote ? `<q>${escapeHtml(quote.slice(0, 160))}</q>` : ''}${a.note ? `<p>${escapeHtml(a.note.slice(0, 300))}</p>` : ''}</div>`);
      row.dataset.id = a.id;
      row.onclick = () => {
        const p = reader.pages[a.page];
        if (!p) return;
        reader.reveal(p, reader.viewRect(p, bounds(a)));
        setTool('select');
        layer.select(a.id);
      };
      row.ondblclick = () => editNote(a);
      this.box.append(row);
    }
    this.mark(selectedAnnot?.id);
  },
  mark(id) {
    for (const r of this.box.querySelectorAll('.rd-cm')) r.classList.toggle('on', r.dataset.id === id);
  },
};

let sidePanel = 'pages';
const PANELS = { pages: ['Pages', 'pages', thumbs.list], outline: ['Bookmarks', 'outline', outline.box], comments: ['Comments', 'comment', comments.box] };
for (const [id, [label, ic]] of Object.entries(PANELS)) {
  const b = h('button', '', `${icon(ic, 16)}<span>${label}</span>`);
  b.dataset.panel = id;
  b.onclick = () => showPanel(id);
  sideTabs.append(b);
}

function showPanel(id, toggle = false) {
  if (toggle && sidePanel === id && !side.classList.contains('closed')) {
    side.classList.add('closed');
  } else {
    side.classList.remove('closed');
    sidePanel = id;
    sideBody.replaceChildren(PANELS[id][2]);
    if (id === 'pages') thumbs.mark(reader.currentPage());
  }
  for (const b of sideTabs.children) b.classList.toggle('on', b.dataset.panel === sidePanel);
  if (typeof reader.zoom === 'string') setTimeout(() => reader.layout(), 0);
  shell.refresh();
}

// --- Floating bars: text selection and the selected comment ---------------

const selBar = h('div', 'rd-float rd-selbar');
const annotBar = h('div', 'rd-float rd-annotbar');
document.body.append(selBar, annotBar);

function bar(host, buttons) {
  host.innerHTML = '';
  for (const b of buttons) {
    if (b === '-') {
      host.append(h('span', 'rd-float-sep'));
      continue;
    }
    const el = h('button', `rd-fb${b.cls ? ` ${b.cls}` : ''}`, b.html || `${icon(b.icon, 16)}${b.label ? `<span>${b.label}</span>` : ''}`);
    el.title = b.title || b.label || '';
    el.onmousedown = (e) => e.preventDefault();
    el.onclick = (e) => b.run(e, el);
    host.append(el);
  }
}

function selectionText() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.anchorNode || !viewHost.contains(sel.anchorNode)) return '';
  return sel.toString().trim();
}

function showSelBar() {
  const sel = window.getSelection();
  const textValue = selectionText();
  if (!textValue || tool !== 'select') {
    selBar.classList.remove('show');
    return;
  }
  const rects = [...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 0);
  const r = rects.at(-1) || sel.getRangeAt(0).getBoundingClientRect();
  bar(selBar, [
    { html: `<span class="rd-dot" style="background:${style.highlight.color}"></span>${icon('highlight', 16)}`, title: 'Highlight', run: () => layer.markSelection('highlight') },
    { icon: 'underline', title: 'Underline', run: () => layer.markSelection('underline') },
    { icon: 'strike', title: 'Strikethrough', run: () => layer.markSelection('strike') },
    { icon: 'comment', title: 'Highlight and add a comment', run: () => layer.markSelection('highlight') && selectedAnnot && editNote(selectedAnnot, true) },
    '-',
    { icon: 'copy', title: 'Copy', run: () => navigator.clipboard.writeText(textValue).then(() => toast('Copied')) },
    { icon: 'find', title: 'Find this in the PDF', run: () => finder.open(textValue) },
    { icon: 'cite', title: 'Cite this paper', run: () => cite() },
    { icon: 'sparkle', label: 'Ask', title: 'Ask Claude about the selection', cls: 'ai', run: () => {
      shell.claude.show();
      shell.claude.ask(`Explain this passage from the PDF:\n\n"${textValue.slice(0, 4000)}"`);
    } },
  ]);
  selBar.classList.add('show');
  const w = selBar.offsetWidth;
  selBar.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w / 2))}px`;
  selBar.style.top = `${Math.min(window.innerHeight - 48, r.bottom + 8)}px`;
}

function placeBars() {
  const a = selectedAnnot;
  const p = a && reader.pages[a.page];
  if (!a || !p || !p.el.isConnected) {
    annotBar.classList.remove('show');
    return;
  }
  const [x0, y0, x1] = reader.viewRect(p, bounds(a));
  const pr = p.el.getBoundingClientRect();
  const k = pr.width / p.w;
  const vr = viewHost.getBoundingClientRect();
  const top = pr.top + y0 * k - 46;
  const items = [];
  if (a.type !== 'image') {
    for (const c of COLORS.slice(0, 7)) items.push({ html: `<span class="rd-dot${a.color === c ? ' on' : ''}" style="background:${c}"></span>`, title: c, run: () => update(a.id, { color: c }) });
    items.push('-');
  }
  if (['ink', 'rect', 'ellipse', 'line', 'arrow'].includes(a.type)) {
    items.push({ html: `<span class="rd-fb-text">${a.width || 1} pt</span>`, title: 'Line thickness', run: (e, el) => {
      const list = h('div', 'rb-menu');
      for (const o of widthOptions) {
        const m = h('button', 'rb-menu-item', `<span class="ico"></span><span>${o.label}</span>`);
        m.onclick = () => {
          closePopup();
          update(a.id, { width: +o.value });
        };
        list.append(m);
      }
      popup(el, list);
    } });
  }
  if (a.type === 'text') {
    items.push({ icon: 'zoomOut', title: 'Smaller text', run: () => update(a.id, { size: Math.max(6, (a.size || 12) - 2) }) });
    items.push({ icon: 'zoomIn', title: 'Bigger text', run: () => update(a.id, { size: Math.min(72, (a.size || 12) + 2) }) });
  }
  if (a.type !== 'note') items.push({ icon: 'comment', title: a.note ? 'Edit comment' : 'Add a comment', run: () => editNote(a) });
  else items.push({ icon: 'comment', title: 'Open note', run: () => editNote(a) });
  items.push({ icon: 'trash', title: 'Delete (Del)', run: () => removeAnnot(a.id) });
  bar(annotBar, items);
  annotBar.classList.add('show');
  const w = annotBar.offsetWidth;
  annotBar.style.left = `${Math.max(vr.left + 6, Math.min(vr.right - w - 6, pr.left + ((x0 + x1) / 2) * k - w / 2))}px`;
  annotBar.style.top = `${Math.max(vr.top + 6, Math.min(vr.bottom - 44, top))}px`;
}

// Comment card for a sticky note, or the comment on any annotation.
let notePop = null;
function editNote(a, fresh = false) {
  notePop?.close();
  const p = reader.pages[a.page];
  if (!p) return;
  const card = h('div', 'rd-note-pop');
  card.innerHTML = `<div class="rd-note-head"><i style="background:${escapeHtml(a.color)}"></i><b>${escapeHtml(a.author || author || 'Comment')}</b><small>${a.modified ? escapeHtml(new Date(a.modified).toLocaleString()) : ''}</small></div>
    <textarea placeholder="${a.type === 'note' ? 'Write a note…' : 'Add a comment…'}"></textarea>
    <div class="rd-note-actions"><button class="btn" data-del>${icon('trash', 14)} Delete</button><button class="btn primary" data-done>Done</button></div>`;
  const ta = card.querySelector('textarea');
  ta.value = a.note || '';
  document.body.append(card);
  const [x0, y0, x1] = reader.viewRect(p, bounds(a));
  const pr = p.el.getBoundingClientRect();
  const k = pr.width / p.w;
  card.style.left = `${Math.max(8, Math.min(window.innerWidth - 300, pr.left + x1 * k + 8))}px`;
  card.style.top = `${Math.max(48, Math.min(window.innerHeight - 220, pr.top + y0 * k))}px`;
  if (x1 * k + pr.left + 300 > window.innerWidth) card.style.left = `${Math.max(8, pr.left + x0 * k - 300)}px`;
  ta.focus();
  const close = (save = true) => {
    if (!card.isConnected) return;
    card.remove();
    notePop = null;
    const v = ta.value.trim();
    if (save && v !== (a.note || '')) update(a.id, { note: v });
    else if (fresh && a.type === 'note' && !v && save) removeAnnot(a.id);
  };
  card.querySelector('[data-done]').onclick = () => close(true);
  card.querySelector('[data-del]').onclick = () => {
    close(false);
    if (a.type === 'note' || !a.note) removeAnnot(a.id);
    else update(a.id, { note: '' });
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close(true);
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(true);
  });
  notePop = { close };
}

// --- Status bar -------------------------------------------------------------

const pageInput = h('input', 'rd-page-input');
const pageTotal = h('span', '', 'of 0');
const zoomLabel = h('button', 'rd-zoom-label', '100%');
const toolHint = h('span', 'rd-hint', '');

// --- Shell ------------------------------------------------------------------

const zoomItems = () => [
  { label: 'Fit width', icon: 'fitWidth', run: () => reader.setZoom('width') },
  { label: 'Fit page', icon: 'fitPage', run: () => reader.setZoom('page') },
  '-',
  ...[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => ({ label: `${z * 100}%`, run: () => reader.setZoom(z) })),
];

const has = () => !!reader.doc;
const canEdit = () => !!reader.doc && editable;

const tabs = [
  {
    id: 'home',
    label: 'Home',
    groups: [
      { label: 'File', items: [{ type: 'big', icon: 'open', label: 'Open', run: () => window.office.openDialog('pdf') }, { type: 'stack', items: [
        { type: 'small', icon: 'save', label: 'Save', enabled: canEdit, run: () => savePdf() },
        { type: 'small', icon: 'saveAs', label: 'Save a copy', enabled: has, run: () => savePdf({ copy: true }) },
        { type: 'small', icon: 'print', label: 'Print', enabled: has, run: () => printPdf() },
      ] }] },
      { label: 'Tools', items: [toolBtn('select', 'Select', 'pointer'), toolBtn('hand', 'Hand', 'pan')] },
      { label: 'Zoom', items: [
        { type: 'stack', items: [
          { type: 'small', icon: 'zoomIn', label: 'Zoom in', shortcut: 'Ctrl+=', enabled: has, run: () => reader.setZoom(reader.scale * 1.2) },
          { type: 'small', icon: 'zoomOut', label: 'Zoom out', shortcut: 'Ctrl+-', enabled: has, run: () => reader.setZoom(reader.scale / 1.2) },
          { type: 'menu', icon: 'find', label: 'Zoom to', items: zoomItems },
        ] },
        { type: 'big', icon: 'fitWidth', label: 'Fit Width', active: () => reader.zoom === 'width', enabled: has, run: () => reader.setZoom('width') },
        { type: 'big', icon: 'fitPage', label: 'Fit Page', active: () => reader.zoom === 'page', enabled: has, run: () => reader.setZoom('page') },
      ] },
      { label: 'Go to', items: [{ type: 'stack', items: [
        { type: 'small', icon: 'up', label: 'Previous page', enabled: has, run: () => reader.scrollToPage(reader.currentPage() - 1) },
        { type: 'small', icon: 'down', label: 'Next page', enabled: has, run: () => reader.scrollToPage(reader.currentPage() + 1) },
        { type: 'small', icon: 'rotateRight', label: 'Rotate view', enabled: has, run: () => reader.rotateView(90) },
      ] }] },
      { label: 'Find', items: [{ type: 'big', icon: 'find', label: 'Find', shortcut: 'Ctrl+F', enabled: has, run: () => finder.open(selectionText()) }] },
      { label: 'Mark up', items: [
        toolBtn('highlight', 'Highlight', 'highlight'),
        toolBtn('note', 'Sticky Note', 'comment'),
        { type: 'big', icon: 'signature', label: 'Sign', enabled: canEdit, run: () => shell.ribbon.select('sign') },
      ] },
      { label: 'References', items: [{ type: 'big', icon: 'cite', label: 'Cite', title: 'Make a reference for this paper', enabled: has, run: () => cite() }] },
    ],
  },
  {
    id: 'comment',
    label: 'Comment',
    groups: [
      { label: 'Text', items: [
        toolBtn('highlight', 'Highlight', 'highlight'),
        { type: 'stack', items: [
          { type: 'small', icon: 'underline', label: 'Underline', active: () => tool === 'underline', enabled: has, run: () => setTool(tool === 'underline' ? 'select' : 'underline') },
          { type: 'small', icon: 'strike', label: 'Strikethrough', active: () => tool === 'strike', enabled: has, run: () => setTool(tool === 'strike' ? 'select' : 'strike') },
          { type: 'small', icon: 'color', label: 'Highlight colour', run: (e, b) => pickColor('highlight', b) },
        ] },
      ] },
      { label: 'Comments', items: [toolBtn('note', 'Sticky Note', 'comment'), toolBtn('text', 'Text Box', 'textbox'), { type: 'big', icon: 'notes', label: 'All Comments', active: () => sidePanel === 'comments' && !side.classList.contains('closed'), run: () => showPanel('comments', true) }] },
      { label: 'Draw', items: [
        toolBtn('ink', 'Pen', 'pen'),
        toolBtn('eraser', 'Eraser', 'eraser'),
        { type: 'stack', items: [
          { type: 'small', icon: 'color', label: 'Pen colour', run: (e, b) => pickColor('ink', b) },
          { type: 'select', title: 'Pen thickness', width: 70, options: widthOptions, value: () => String(style.ink.width), change: (v) => { style.ink.width = +v; } },
        ] },
      ] },
      { label: 'Shapes', items: [
        { type: 'stack', items: [
          { type: 'small', icon: 'rect', label: 'Rectangle', active: () => tool === 'rect', enabled: has, run: () => setTool(tool === 'rect' ? 'select' : 'rect') },
          { type: 'small', icon: 'ellipse', label: 'Oval', active: () => tool === 'ellipse', enabled: has, run: () => setTool(tool === 'ellipse' ? 'select' : 'ellipse') },
          { type: 'small', icon: 'line', label: 'Line', active: () => tool === 'line', enabled: has, run: () => setTool(tool === 'line' ? 'select' : 'line') },
        ] },
        { type: 'stack', items: [
          { type: 'small', icon: 'arrow', label: 'Arrow', active: () => tool === 'arrow', enabled: has, run: () => setTool(tool === 'arrow' ? 'select' : 'arrow') },
          { type: 'small', icon: 'color', label: 'Shape colour', run: (e, b) => pickColor('rect', b) },
          { type: 'select', title: 'Line thickness', width: 70, options: widthOptions, value: () => String(style.shape.width), change: (v) => { style.shape.width = +v; } },
        ] },
      ] },
    ],
  },
  {
    id: 'sign',
    label: 'Fill & Sign',
    groups: [
      { label: 'Sign', items: [
        menuButton('Signature', 'signature', () => signatureMenu('signature'), 'Add your signature'),
        menuButton('Initials', 'initials', () => signatureMenu('initials'), 'Add your initials'),
      ] },
      { label: 'Fill in', items: [
        toolBtn('text', 'Add Text', 'textbox', 'Click where the text goes'),
        { type: 'stack', items: [
          { type: 'small', icon: 'calendar', label: 'Date', enabled: canEdit, run: () => addDate() },
          { type: 'small', icon: 'check', label: 'Check mark', enabled: canEdit, run: () => placeMark('check') },
          { type: 'small', icon: 'close', label: 'Cross', enabled: canEdit, run: () => placeMark('cross') },
        ] },
        { type: 'stack', items: [
          { type: 'small', icon: 'color', label: 'Text colour', run: (e, b) => pickColor('text', b) },
          { type: 'select', title: 'Text size', width: 70, options: [8, 9, 10, 11, 12, 14, 16, 18, 24, 32].map((v) => ({ value: String(v), label: `${v} pt` })), value: () => String(style.text.size), change: (v) => { style.text.size = +v; } },
          { type: 'small', icon: 'checklist', label: 'Dot', enabled: canEdit, run: () => placeMark('dot') },
        ] },
      ] },
      { label: 'Picture', items: [{ type: 'big', icon: 'image', label: 'Picture or Stamp', enabled: canEdit, run: () => insertPicture() }] },
    ],
  },
  {
    id: 'pages',
    label: 'Organize',
    groups: [
      { label: 'Rotate', items: [
        { type: 'big', icon: 'rotateLeft', label: 'Rotate Left', enabled: canEdit, run: () => rotate(-90) },
        { type: 'big', icon: 'rotateRight', label: 'Rotate Right', enabled: canEdit, run: () => rotate(90) },
        { type: 'stack', items: [
          { type: 'small', icon: 'rotateLeft', label: 'All pages left', enabled: canEdit, run: () => rotate(-90, true) },
          { type: 'small', icon: 'rotateRight', label: 'All pages right', enabled: canEdit, run: () => rotate(90, true) },
        ] },
      ] },
      { label: 'Pages', items: [
        { type: 'big', icon: 'pageDelete', label: 'Delete', enabled: canEdit, run: () => removePages() },
        { type: 'big', icon: 'extract', label: 'Extract', enabled: has, run: () => extract() },
        { type: 'stack', items: [
          { type: 'small', icon: 'up', label: 'Move page up', enabled: canEdit, run: () => moveCurrent(-1) },
          { type: 'small', icon: 'down', label: 'Move page down', enabled: canEdit, run: () => moveCurrent(1) },
          { type: 'small', icon: 'newFile', label: 'Blank page', enabled: canEdit, run: () => insertBlank() },
        ] },
      ] },
      { label: 'Combine', items: [
        { type: 'big', icon: 'pageAdd', label: 'Insert from File', title: 'Insert pages from other PDFs after this page', enabled: canEdit, run: () => insertFromFile() },
        { type: 'big', icon: 'pages', label: 'Combine Files', title: 'Add other PDFs at the end', enabled: canEdit, run: () => insertFromFile(true) },
      ] },
    ],
  },
  {
    id: 'convert',
    label: 'Convert',
    groups: [
      { label: 'Open as', items: [
        { type: 'big', icon: 'appDocs', label: 'Write', title: 'Open the text as a Write document (.docx)', enabled: has, run: () => convert('write') },
        { type: 'big', icon: 'notes', label: 'Notes', title: 'Open the text as notes in Write', enabled: has, run: () => convert('notes') },
        { type: 'big', icon: 'appSheets', label: 'Plot', title: 'Open tables as a Plot workbook (.xlsx)', enabled: has, run: () => convert('plot') },
        { type: 'big', icon: 'appSlides', label: 'Present', title: 'Open each page as a slide in Present (.pptx)', enabled: has, run: () => convert('present') },
      ] },
      { label: 'Export', items: [{ type: 'stack', items: [
        { type: 'small', icon: 'image', label: 'Page as picture', enabled: has, run: () => exportPageImage() },
        { type: 'small', icon: 'file', label: 'Text (.txt)', enabled: has, run: () => exportText() },
        { type: 'small', icon: 'saveAs', label: 'Copy of the PDF', enabled: has, run: () => savePdf({ copy: true }) },
      ] }] },
    ],
  },
  {
    id: 'view',
    label: 'View',
    groups: [
      { label: 'Panels', items: [
        { type: 'big', icon: 'pages', label: 'Pages', active: () => sidePanel === 'pages' && !side.classList.contains('closed'), run: () => showPanel('pages', true) },
        { type: 'big', icon: 'outline', label: 'Bookmarks', active: () => sidePanel === 'outline' && !side.classList.contains('closed'), run: () => showPanel('outline', true) },
        { type: 'big', icon: 'notes', label: 'Comments', active: () => sidePanel === 'comments' && !side.classList.contains('closed'), run: () => showPanel('comments', true) },
      ] },
      { label: 'Page view', items: [
        { type: 'big', icon: 'rotateLeft', label: 'Rotate Left', enabled: has, run: () => reader.rotateView(-90) },
        { type: 'big', icon: 'rotateRight', label: 'Rotate Right', enabled: has, run: () => reader.rotateView(90) },
      ] },
      { label: 'Reading', items: [
        { type: 'big', icon: 'theme', label: 'Night', title: 'Dark pages for reading at night', active: () => viewHost.classList.contains('night'), run: () => { viewHost.classList.toggle('night'); shell.refresh(); } },
        { type: 'big', icon: 'preview', label: 'Hide Comments', active: () => viewHost.classList.contains('no-annots'), run: () => { viewHost.classList.toggle('no-annots'); shell.refresh(); } },
        { type: 'big', icon: 'play', label: 'Read Mode', title: 'Full screen with the ribbon tucked away (Esc to leave)', enabled: has, run: () => readMode(true) },
      ] },
    ],
  },
];

const QUICK = {
  summarize: { label: 'Summarize this PDF', icon: 'summarize', prompt: 'Summarize the PDF in a short paragraph, then list its key points. Mention page numbers where they help.' },
  points: { label: 'Key points and figures', icon: 'checklist', prompt: 'List the key facts, numbers, dates and conclusions in this PDF, each with its page number.' },
  explain: { label: 'Explain in simple words', icon: 'wand', prompt: 'Explain the selected text (or this page if nothing is selected) in plain, simple words.' },
  questions: { label: 'Questions to check understanding', icon: 'help', prompt: 'Write 5 questions, with short answers, that check someone understood this PDF.' },
};

const claudeTab = {
  id: 'claude',
  label: 'Claude',
  special: true,
  groups: [
    { label: 'Understand', items: [
      { type: 'big', icon: 'summarize', label: 'Summarize', enabled: has, run: () => shell.claude.runQuick(QUICK.summarize) },
      { type: 'big', icon: 'checklist', label: 'Key Points', enabled: has, run: () => shell.claude.runQuick(QUICK.points) },
      { type: 'big', icon: 'wand', label: 'Explain', enabled: has, run: () => shell.claude.runQuick(QUICK.explain) },
      { type: 'big', icon: 'help', label: 'Quiz Me', enabled: has, run: () => shell.claude.runQuick(QUICK.questions) },
    ] },
    { label: 'Chat', items: [{ type: 'big', icon: 'chat', label: 'Ask Claude', run: () => shell.claude.toggle() }] },
  ],
};

// Text sent with each question: the selection, the page in view and as much
// of the document as fits.
async function claudeContext() {
  if (!reader.doc) return '';
  const cur = reader.currentPage();
  const parts = [];
  let size = 0;
  const order = [cur - 1, ...[...Array(reader.pageCount).keys()].filter((i) => i !== cur - 1)];
  for (const i of order) {
    const t = (await reader.text(i)).str.trim();
    if (size + t.length > 150000) break;
    parts[i] = `<page n="${i + 1}">\n${t}\n</page>`;
    size += t.length;
  }
  const sel = selectionText();
  return `<pdf name="${escapeHtml(shell.state.name)}" pages="${reader.pageCount}" current_page="${cur}">\n${parts.filter(Boolean).join('\n')}\n</pdf>${sel ? `\n<selection>\n${sel.slice(0, 8000)}\n</selection>` : ''}`;
}

const shell = await createShell({
  app: 'pdf',
  tabs,
  claudeTab,
  defaultExt: 'pdf',
  undo: () => undo(),
  redo: () => redo(),
  customSave: () => savePdf(),
  customSaveAs: () => savePdf({ saveAs: true }),
  getSaveData: () => null,
  exportPdf: () => savePdf({ copy: true }),
  print: () => printPdf(),
  exports: [
    { label: 'Write document', detail: 'The text, with headings and lists, ready to edit.', icon: 'appDocs', run: () => convert('write') },
    { label: 'Plot workbook', detail: 'Tables and text lined up in rows and columns.', icon: 'appSheets', run: () => convert('plot') },
    { label: 'Present deck', detail: 'Each page on its own slide.', icon: 'appSlides', run: () => convert('present') },
    { label: 'Notes', detail: 'The text as notes in Write.', icon: 'notes', run: () => convert('notes') },
    { label: 'Picture of this page', detail: 'A PNG image of the page you are on.', icon: 'image', run: () => exportPageImage() },
    { label: 'Plain text', detail: 'Every page’s text in a .txt file.', icon: 'file', run: () => exportText() },
  ],
  claude: {
    intro: 'Ask me anything about this PDF. I can summarize it, explain a passage, pull out key numbers, or answer questions with page references.',
    placeholder: 'Ask about this PDF…',
    system: [
      'You are Claude, built into Read, a PDF reader. The PDF text is provided page by page, the page in view first, and the user may have selected a passage.',
      'Answer from the PDF and say which page each point comes from. If the PDF does not say, say so.',
      'Be brief and use Markdown.',
    ].join('\n'),
    context: () => claudeContext(),
    quick: [QUICK.summarize, QUICK.points, QUICK.explain, QUICK.questions],
  },
});

shell.workspace.append(frame);
shell.statusLeft.append(h('span', '', 'Page'), pageInput, pageTotal, toolHint);
const zoomOut = h('button', 'rd-ib', icon('zoomOut', 14));
zoomOut.onclick = () => reader.setZoom(reader.scale / 1.2);
const zoomIn = h('button', 'rd-ib', icon('zoomIn', 14));
zoomIn.onclick = () => reader.setZoom(reader.scale * 1.2);
zoomLabel.onclick = () => {
  const list = h('div', 'rb-menu');
  for (const mi of zoomItems()) {
    if (mi === '-') {
      list.append(h('div', 'rb-menu-sep'));
      continue;
    }
    const m = h('button', 'rb-menu-item', `${mi.icon ? icon(mi.icon, 16) : '<span class="ico"></span>'}<span>${mi.label}</span>`);
    m.onclick = () => {
      closePopup();
      mi.run();
    };
    list.append(m);
  }
  popup(zoomLabel, list);
};
zoomLabel.classList.add('rb-dropdown-trigger');
shell.statusRight.append(zoomOut, zoomLabel, zoomIn);
pageInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    reader.scrollToPage(parseInt(pageInput.value, 10) || 1);
    pageInput.blur();
  }
});

function readMode(on) {
  document.body.classList.toggle('rd-read-mode', on);
  window.office.fullscreen(on);
  setTimeout(() => reader.layout(), 300);
}

// --- Loading ----------------------------------------------------------------

async function reload(keepPlace = false) {
  await reader.load(viewBytes, { keepPlace, getPassword });
  pageTotal.textContent = `of ${reader.pageCount}`;
  pageInput.value = reader.currentPage();
  thumbs.build();
  if (finder.matches.length) finder.paint();
}

async function getPassword(wrong) {
  const got = await dialog({ title: wrong ? 'Wrong password, try again' : 'This PDF is locked', body: 'Type the password to open it.', fields: [{ name: 'pw', label: 'Password', type: 'password' }], ok: 'Open' });
  return got ? got.pw : null;
}

async function open() {
  const bytes = await window.office.pdf.read();
  if (!bytes?.length) {
    mainCol.append(empty);
    shell.setTitle();
    return;
  }
  const raw = new Uint8Array(bytes);
  try {
    const r = await openForEditing(raw);
    editDoc = r.doc;
    annots = r.annots;
    viewBytes = r.viewBytes;
    editable = true;
  } catch (err) {
    editDoc = null;
    annots = [];
    viewBytes = raw;
    editable = false;
    locked = /encrypt/i.test(String(err?.message || err))
      ? 'This PDF is protected, so Read can show it but can’t save changes into it yet.'
      : 'Read can show this PDF but can’t save changes into it.';
  }
  try {
    await reader.load(viewBytes, { getPassword });
  } catch (err) {
    mainCol.append(empty);
    empty.querySelector('h2').textContent = /password/i.test(String(err?.name || err)) ? 'This PDF needs its password to open.' : `This PDF couldn’t be opened: ${err.message || err}`;
    return;
  }
  if (!reader.doc) return;
  pageTotal.textContent = `of ${reader.pageCount}`;
  pageInput.value = 1;
  thumbs.build();
  outline.build();
  comments.render();
  showPanel(annots.length ? 'comments' : 'pages');
  if (!editable) toast(locked, 'error');
  // A long, outlined document opens with its bookmarks showing.
  const ol = await reader.doc.getOutline().catch(() => null);
  if (ol?.length && !annots.length && reader.pageCount > 8) showPanel('outline');
  shell.refresh();
}

author = (await window.office.pdf.user()) || '';
setTool('select');
await open();

// --- Events -----------------------------------------------------------------

document.addEventListener('selectionchange', () => {
  clearTimeout(showSelBar.t);
  showSelBar.t = setTimeout(showSelBar, 120);
});
viewHost.addEventListener('mouseup', () => {
  if (MARKUPS.includes(tool) && editable) setTimeout(() => layer.markSelection(tool), 0);
});
viewHost.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('[data-id], .rd-text-edit') && selectedAnnot) layer.select(null);
});
reader.scroller.addEventListener('scroll', () => {
  placeBars();
  if (selBar.classList.contains('show')) showSelBar();
}, { passive: true });
window.addEventListener('resize', () => placeBars());

// Hand tool: drag to scroll.
reader.scroller.addEventListener('pointerdown', (e) => {
  if (tool !== 'hand' || e.button !== 0) return;
  const s = reader.scroller;
  const start = { x: e.clientX, y: e.clientY, l: s.scrollLeft, t: s.scrollTop };
  s.setPointerCapture(e.pointerId);
  s.classList.add('grabbing');
  const move = (ev) => {
    s.scrollLeft = start.l - (ev.clientX - start.x);
    s.scrollTop = start.t - (ev.clientY - start.y);
  };
  const up = () => {
    s.classList.remove('grabbing');
    s.removeEventListener('pointermove', move);
    s.removeEventListener('pointerup', up);
  };
  s.addEventListener('pointermove', move);
  s.addEventListener('pointerup', up);
});

const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');

document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'f') {
    e.preventDefault();
    finder.open(selectionText());
    return;
  }
  if (typing(e)) return;
  if (mod && (k === '=' || k === '+')) {
    e.preventDefault();
    reader.setZoom(reader.scale * 1.2);
  } else if (mod && k === '-') {
    e.preventDefault();
    reader.setZoom(reader.scale / 1.2);
  } else if (mod && k === '0') {
    e.preventDefault();
    reader.setZoom('width');
  } else if (mod && k === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
  } else if (mod && k === 'y') {
    e.preventDefault();
    redo();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedAnnot) {
    e.preventDefault();
    removeAnnot(selectedAnnot.id);
  } else if (e.key === 'Escape') {
    if (document.body.classList.contains('rd-read-mode')) readMode(false);
    notePop?.close();
    if (tool !== 'select') setTool('select');
    else layer.select(null);
  } else if (!mod && (e.key === 'ArrowRight' || e.key === 'PageDown') && reader.zoom === 'page') {
    e.preventDefault();
    reader.scrollToPage(reader.currentPage() + 1);
  } else if (!mod && (e.key === 'ArrowLeft' || e.key === 'PageUp') && reader.zoom === 'page') {
    e.preventDefault();
    reader.scrollToPage(reader.currentPage() - 1);
  } else if (!mod && e.key === 'Home' && e.target === document.body) {
    reader.scrollToPage(1);
  } else if (!mod && e.key === 'End' && e.target === document.body) {
    reader.scrollToPage(reader.pageCount);
  }
});
