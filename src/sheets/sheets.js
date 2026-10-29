import '../shared/ui.css';
import './sheets.css';
import cellref from '../../common/cellref.js';
import { computeBook, format, isError } from './engine.js';
import { createShell, dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { codeBlock } from '../shared/claude-pane.js';
import { icon } from '../shared/icons.js';

const { colName, mapRefs, parseRef, rangeName, rect, refName, shiftFormula } = cellref;

const DEFAULT_W = 88;
const ROW_H = 22;
const MIN_ROWS = 200;
const MIN_COLS = 26;

let book = { sheets: [{ name: 'Sheet1', cells: {}, cols: {} }], active: 0 };
let values = {};
let sel = { a: { row: 0, col: 0 }, f: { row: 0, col: 0 } };
let editing = null; // { row, col, original }
let zoom = 100;
let undoStack = [];
let redoStack = [];
let clip = null;

const sheet = () => book.sheets[book.active];
const cellAt = (r, c) => sheet().cells[refName(r, c)];
const selRect = () => rect(sel.a, sel.f);
const valueAt = (r, c) => values[sheet().name]?.get(refName(r, c));

// ---------- DOM ----------
const wrap = h('div', 'sheet-wrap');
const fbar = h('div', 'formula-bar');
const nameBox = h('input', 'name-box');
nameBox.spellcheck = false;
const fxLabel = h('span', 'fx', '<i>fx</i>');
const fInput = h('input', 'f-input');
fInput.spellcheck = false;
fbar.append(nameBox, fxLabel, fInput);
const scroller = h('div', 'grid-scroll');
const table = h('table', 'grid');
const colgroup = h('colgroup');
const thead = h('thead');
const tbody = h('tbody');
table.append(colgroup, thead, tbody);
const overlay = h('div', 'sel-overlay');
const activeBox = h('div', 'sel-active');
const fillHandle = h('div', 'fill-handle');
const editor = h('input', 'cell-editor');
editor.spellcheck = false;
const layer = h('div', 'grid-layer');
layer.append(table, overlay, activeBox, fillHandle, editor);
scroller.append(layer);
const tabsBar = h('div', 'sheet-tabs');
wrap.append(fbar, scroller, tabsBar);

let rows = MIN_ROWS;
let cols = MIN_COLS;

function colWidth(c) {
  return sheet().cols?.[colName(c)] || DEFAULT_W;
}

function extent() {
  let mr = 0;
  let mc = 0;
  for (const ref of Object.keys(sheet().cells)) {
    const p = parseRef(ref);
    if (!p) continue;
    mr = Math.max(mr, p.row);
    mc = Math.max(mc, p.col);
  }
  return { rows: mr, cols: mc };
}

function buildGrid() {
  const e = extent();
  rows = Math.max(MIN_ROWS, e.rows + 50);
  cols = Math.max(MIN_COLS, e.cols + 5);
  colgroup.innerHTML = '';
  const rh = h('col');
  rh.style.width = '46px';
  colgroup.append(rh);
  for (let c = 0; c < cols; c += 1) {
    const col = h('col');
    col.style.width = `${colWidth(c)}px`;
    colgroup.append(col);
  }
  let head = '<tr><th class="corner"></th>';
  for (let c = 0; c < cols; c += 1) head += `<th class="ch" data-c="${c}">${colName(c)}<span class="col-resize" data-c="${c}"></span></th>`;
  thead.innerHTML = `${head}</tr>`;
  const parts = [];
  for (let r = 0; r < rows; r += 1) {
    let tr = `<tr><th class="rh" data-r="${r}">${r + 1}</th>`;
    for (let c = 0; c < cols; c += 1) tr += `<td data-r="${r}" data-c="${c}"></td>`;
    parts.push(`${tr}</tr>`);
  }
  tbody.innerHTML = parts.join('');
  table.style.width = `${46 + Array.from({ length: cols }, (_, c) => colWidth(c)).reduce((a, b) => a + b, 0)}px`;
  renderAll();
}

function td(r, c) {
  return tbody.rows[r]?.cells[c + 1];
}

function renderCell(r, c) {
  const cell = td(r, c);
  if (!cell) return;
  const data = cellAt(r, c);
  const v = valueAt(r, c);
  const s = data?.s || {};
  let fmt = s;
  if (!s.fmt && typeof v === 'number' && /^=.*\b(TODAY|DATE|EDATE|EOMONTH)\(/i.test(data?.v || '')) fmt = { ...s, fmt: 'date' };
  cell.textContent = data ? format(v, fmt) : '';
  const st = cell.style;
  st.fontWeight = s.b ? '700' : '';
  st.fontStyle = s.i ? 'italic' : '';
  st.textDecoration = s.u ? 'underline' : '';
  st.color = s.color || '';
  st.background = s.bg || '';
  const err = isError(v);
  st.textAlign = s.align || (err || typeof v === 'boolean' ? 'center' : typeof v === 'number' ? 'right' : 'left');
  cell.classList.toggle('wrap', !!s.wrap);
  cell.classList.toggle('bordered', !!s.border);
  cell.classList.toggle('err', err);
}

function renderAll() {
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) renderCell(r, c);
  drawSelection();
}

// Recalculate and repaint cells whose content might have changed.
function refreshCells(prevRefs = []) {
  values = computeBook(book);
  const refs = new Set([...Object.keys(sheet().cells), ...prevRefs]);
  for (const ref of refs) {
    const p = parseRef(ref);
    if (p) renderCell(p.row, p.col);
  }
  drawSelection();
  updateStatus();
  if (live && !live.applying) liveSoon(700);
}

// ---------- selection ----------
function cellBox(r, c) {
  const cell = td(r, c);
  return cell ? { x: cell.offsetLeft, y: cell.offsetTop, w: cell.offsetWidth, h: cell.offsetHeight } : null;
}

function drawSelection() {
  const s = selRect();
  const a = cellBox(s.r0, s.c0);
  const b = cellBox(Math.min(s.r1, rows - 1), Math.min(s.c1, cols - 1));
  if (!a || !b) return;
  Object.assign(overlay.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x + b.w - a.x}px`, height: `${b.y + b.h - a.y}px` });
  const act = cellBox(sel.a.row, sel.a.col);
  Object.assign(activeBox.style, { left: `${act.x}px`, top: `${act.y}px`, width: `${act.w}px`, height: `${act.h}px` });
  Object.assign(fillHandle.style, { left: `${b.x + b.w - 4}px`, top: `${b.y + b.h - 4}px` });
  overlay.classList.toggle('multi', s.r0 !== s.r1 || s.c0 !== s.c1);
  thead.querySelectorAll('.ch.on').forEach((n) => n.classList.remove('on'));
  tbody.querySelectorAll('.rh.on').forEach((n) => n.classList.remove('on'));
  for (let c = s.c0; c <= Math.min(s.c1, cols - 1); c += 1) thead.querySelector(`.ch[data-c="${c}"]`)?.classList.add('on');
  for (let r = s.r0; r <= Math.min(s.r1, rows - 1); r += 1) tbody.rows[r]?.cells[0].classList.add('on');
  nameBox.value = rangeName(s);
  if (!editing) fInput.value = cellAt(sel.a.row, sel.a.col)?.v ?? '';
  updateStatus();
  shell?.refresh();
}

function select(a, f = a, { scroll = true } = {}) {
  sel = { a: clamp(a), f: clamp(f) };
  drawSelection();
  if (scroll) scrollIntoView(sel.f);
}

function clamp(p) {
  return { row: Math.max(0, Math.min(rows - 1, p.row)), col: Math.max(0, Math.min(cols - 1, p.col)) };
}

function scrollIntoView(p) {
  const b = cellBox(p.row, p.col);
  if (!b) return;
  const z = zoom / 100;
  const left = b.x * z;
  const top = b.y * z;
  const headW = 46 * z;
  const headH = ROW_H * z;
  if (left - headW < scroller.scrollLeft) scroller.scrollLeft = left - headW;
  else if (left + b.w * z > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + b.w * z - scroller.clientWidth;
  if (top - headH < scroller.scrollTop) scroller.scrollTop = top - headH;
  else if (top + b.h * z > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + b.h * z - scroller.clientHeight;
}

// ---------- mutation helpers ----------
function snapshot() {
  undoStack.push(JSON.stringify(book));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  shell.markDirty();
}

function restore(json) {
  const prevRefs = Object.keys(sheet().cells);
  const prevCols = JSON.stringify(sheet().cols);
  book = JSON.parse(json);
  book.active = Math.min(book.active, book.sheets.length - 1);
  if (JSON.stringify(sheet().cols) !== prevCols || extent().rows >= rows || extent().cols >= cols) buildGrid();
  renderTabs();
  refreshCells(prevRefs);
  shell.markDirty();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(book));
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(book));
  restore(redoStack.pop());
}

function setRaw(r, c, v) {
  const ref = refName(r, c);
  const cells = sheet().cells;
  if (v === '' || v == null) {
    if (cells[ref]?.s && Object.keys(cells[ref].s).length) cells[ref].v = '';
    else delete cells[ref];
  } else {
    cells[ref] = { ...(cells[ref] || {}), v: String(v) };
  }
}

// Grow the grid when data gets close to its edge.
function ensureGrid() {
  const e = extent();
  if (e.rows >= rows - 5 || e.cols >= cols - 2) buildGrid();
}

function eachSelected(fn) {
  const s = selRect();
  for (let r = s.r0; r <= s.r1; r += 1) for (let c = s.c0; c <= s.c1; c += 1) fn(r, c);
}

function styleSelection(patch) {
  snapshot();
  eachSelected((r, c) => {
    const ref = refName(r, c);
    const cell = sheet().cells[ref] || { v: '' };
    const s = { ...(cell.s || {}) };
    for (const [k, v] of Object.entries(typeof patch === 'function' ? patch(s) : patch)) {
      if (v == null || v === false) delete s[k];
      else s[k] = v;
    }
    cell.s = s;
    if (!cell.v && !Object.keys(s).length) delete sheet().cells[ref];
    else sheet().cells[ref] = cell;
    renderCell(r, c);
  });
  drawSelection();
}

function toggleStyle(key) {
  const on = !cellAt(sel.a.row, sel.a.col)?.s?.[key];
  styleSelection({ [key]: on });
}

function clearSelection(what = 'contents') {
  snapshot();
  const prev = Object.keys(sheet().cells);
  eachSelected((r, c) => {
    const ref = refName(r, c);
    const cell = sheet().cells[ref];
    if (!cell) return;
    if (what === 'all') delete sheet().cells[ref];
    else if (what === 'formats') {
      delete cell.s;
      if (!cell.v) delete sheet().cells[ref];
    } else if (cell.s && Object.keys(cell.s).length) cell.v = '';
    else delete sheet().cells[ref];
  });
  refreshCells(prev);
}

// ---------- editing ----------
function startEdit(initial = null) {
  const { row, col } = sel.a;
  const b = cellBox(row, col);
  editing = { row, col, original: cellAt(row, col)?.v ?? '' };
  editor.value = initial ?? editing.original;
  fInput.value = editor.value;
  Object.assign(editor.style, { display: 'block', left: `${b.x}px`, top: `${b.y}px`, minWidth: `${b.w}px`, height: `${b.h}px` });
  const s = cellAt(row, col)?.s || {};
  editor.style.fontWeight = s.b ? '700' : '';
  editor.style.fontStyle = s.i ? 'italic' : '';
  editor.focus();
  editor.setSelectionRange(editor.value.length, editor.value.length);
}

function commitEdit(move = null) {
  if (!editing) return;
  const { row, col, original } = editing;
  const v = editor.value;
  editing = null;
  editor.style.display = 'none';
  if (v !== original) {
    snapshot();
    let value = v;
    if (/^=/.test(value)) value = value.replace(/^=\s*/, '=');
    setRaw(row, col, value);
    ensureGrid();
    refreshCells();
  }
  if (move) select({ row: row + move[0], col: col + move[1] });
  else drawSelection();
  scroller.focus({ preventScroll: true });
}

function cancelEdit() {
  if (!editing) return;
  editing = null;
  editor.style.display = 'none';
  drawSelection();
  scroller.focus({ preventScroll: true });
}

// When the formula being typed ends with an operator, clicking a cell inserts its reference.
function wantsRef() {
  if (!editing) return false;
  const v = editor.value;
  return v.startsWith('=') && /[=+\-*/^(,:<>&]$/.test(v.trimEnd());
}

editor.addEventListener('input', () => {
  fInput.value = editor.value;
});
editor.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit(e.shiftKey ? [-1, 0] : [1, 0]);
  } else if (e.key === 'Tab') {
    e.preventDefault();
    commitEdit(e.shiftKey ? [0, -1] : [0, 1]);
  } else if (e.key === 'Escape') {
    cancelEdit();
  } else if (['ArrowUp', 'ArrowDown'].includes(e.key) && !editor.value.startsWith('=')) {
    e.preventDefault();
    commitEdit(e.key === 'ArrowUp' ? [-1, 0] : [1, 0]);
  }
  e.stopPropagation();
});
editor.addEventListener('blur', () => {
  setTimeout(() => {
    if (editing && document.activeElement !== fInput && document.activeElement !== editor) commitEdit();
  }, 0);
});

fInput.addEventListener('focus', () => {
  if (!editing) {
    startEdit();
    fInput.focus();
  }
});
fInput.addEventListener('input', () => {
  editor.value = fInput.value;
});
fInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    commitEdit([1, 0]);
  } else if (e.key === 'Escape') {
    cancelEdit();
  }
  e.stopPropagation();
});
nameBox.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key !== 'Enter') return;
  const [a, b] = nameBox.value.toUpperCase().split(':');
  const pa = parseRef(a);
  const pb = b ? parseRef(b) : pa;
  if (pa && pb) select(pa, pb);
  scroller.focus();
});

// ---------- mouse ----------
let dragging = null;
function cellFromEvent(e) {
  const t = e.target.closest('td');
  return t ? { row: Number(t.dataset.r), col: Number(t.dataset.c) } : null;
}

layer.addEventListener('mousedown', (e) => {
  if (e.target === editor) return;
  if (e.target === fillHandle) {
    e.preventDefault();
    dragging = { mode: 'fill', from: selRect(), to: selRect() };
    return;
  }
  const resize = e.target.closest('.col-resize');
  if (resize) {
    e.preventDefault();
    const c = Number(resize.dataset.c);
    dragging = { mode: 'resize', c, x: e.clientX, w: colWidth(c) };
    return;
  }
  const ch = e.target.closest('.ch');
  if (ch) {
    e.preventDefault();
    const c = Number(ch.dataset.c);
    if (e.shiftKey) select({ row: 0, col: sel.a.col }, { row: rows - 1, col: c }, { scroll: false });
    else select({ row: 0, col: c }, { row: rows - 1, col: c }, { scroll: false });
    dragging = { mode: 'cols', c };
    return;
  }
  const rh = e.target.closest('.rh');
  if (rh) {
    e.preventDefault();
    const r = Number(rh.dataset.r);
    select({ row: r, col: 0 }, { row: r, col: cols - 1 }, { scroll: false });
    dragging = { mode: 'rows', r };
    return;
  }
  if (e.target.closest('.corner')) {
    select({ row: 0, col: 0 }, { row: rows - 1, col: cols - 1 }, { scroll: false });
    return;
  }
  const p = cellFromEvent(e);
  if (!p) return;
  if (wantsRef()) {
    e.preventDefault();
    editor.value += refName(p.row, p.col);
    fInput.value = editor.value;
    dragging = { mode: 'ref', start: p, base: editor.value.length - refName(p.row, p.col).length };
    return;
  }
  if (editing) commitEdit();
  e.preventDefault();
  scroller.focus({ preventScroll: true });
  if (e.shiftKey) select(sel.a, p, { scroll: false });
  else select(p, p, { scroll: false });
  dragging = { mode: 'cells' };
});

layer.addEventListener('dblclick', (e) => {
  const p = cellFromEvent(e);
  if (p) startEdit();
});

window.addEventListener('mousemove', (e) => {
  if (!dragging) return;
  if (dragging.mode === 'resize') {
    const w = Math.max(24, dragging.w + (e.clientX - dragging.x) / (zoom / 100));
    sheet().cols = { ...(sheet().cols || {}), [colName(dragging.c)]: Math.round(w) };
    colgroup.children[dragging.c + 1].style.width = `${Math.round(w)}px`;
    table.style.width = `${46 + Array.from({ length: cols }, (_, c) => colWidth(c)).reduce((a, b) => a + b, 0)}px`;
    drawSelection();
    return;
  }
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const t = el?.closest?.('td, th');
  if (!t || !layer.contains(t)) return;
  if (dragging.mode === 'cols' && t.dataset.c) select({ row: 0, col: dragging.c }, { row: rows - 1, col: Number(t.dataset.c) }, { scroll: false });
  if (dragging.mode === 'rows' && t.dataset.r) select({ row: dragging.r, col: 0 }, { row: Number(t.dataset.r), col: cols - 1 }, { scroll: false });
  if (!t.dataset.r || !t.dataset.c) return;
  const p = { row: Number(t.dataset.r), col: Number(t.dataset.c) };
  if (dragging.mode === 'cells') select(sel.a, p, { scroll: false });
  if (dragging.mode === 'ref') {
    editor.value = editor.value.slice(0, dragging.base) + rangeName(rect(dragging.start, p));
    fInput.value = editor.value;
  }
  if (dragging.mode === 'fill') {
    const f = dragging.from;
    const down = p.row - f.r1;
    const right = p.col - f.c1;
    dragging.to = down >= right ? { ...f, r1: Math.max(f.r1, p.row) } : { ...f, c1: Math.max(f.c1, p.col) };
    const a = cellBox(dragging.to.r0, dragging.to.c0);
    const b = cellBox(dragging.to.r1, dragging.to.c1);
    Object.assign(overlay.style, { left: `${a.x}px`, top: `${a.y}px`, width: `${b.x + b.w - a.x}px`, height: `${b.y + b.h - a.y}px` });
    overlay.classList.add('filling');
  }
});

window.addEventListener('mouseup', () => {
  if (!dragging) return;
  const d = dragging;
  dragging = null;
  if (d.mode === 'resize') shell.markDirty();
  if (d.mode === 'ref') editor.focus();
  if (d.mode === 'fill') {
    overlay.classList.remove('filling');
    fill(d.from, d.to);
  }
});

// Fill handle: numbers with a step continue the series, everything else repeats
// (formulas shift their relative references).
function fill(from, to) {
  if (to.r1 === from.r1 && to.c1 === from.c1) {
    drawSelection();
    return;
  }
  snapshot();
  const vertical = to.r1 > from.r1;
  const len = vertical ? from.r1 - from.r0 + 1 : from.c1 - from.c0 + 1;
  const lanes = vertical ? [from.c0, from.c1] : [from.r0, from.r1];
  for (let lane = lanes[0]; lane <= lanes[1]; lane += 1) {
    const src = [];
    for (let i = 0; i < len; i += 1) {
      const r = vertical ? from.r0 + i : lane;
      const c = vertical ? lane : from.c0 + i;
      src.push({ r, c, cell: cellAt(r, c) });
    }
    const nums = src.map((s) => (s.cell && !String(s.cell.v).startsWith('=') && s.cell.v !== '' && !Number.isNaN(Number(s.cell.v)) ? Number(s.cell.v) : null));
    const series = nums.every((n) => n != null) && len >= 2;
    const step = series ? (nums[len - 1] - nums[0]) / (len - 1) : 0;
    const end = vertical ? to.r1 : to.c1;
    const start = vertical ? from.r1 + 1 : from.c1 + 1;
    for (let k = start, i = 0; k <= end; k += 1, i += 1) {
      const s = src[i % len];
      const r = vertical ? k : lane;
      const c = vertical ? lane : k;
      const ref = refName(r, c);
      if (!s.cell) {
        delete sheet().cells[ref];
        continue;
      }
      let v = s.cell.v;
      if (series) v = String(Number((nums[len - 1] + step * (i + 1)).toPrecision(12)));
      else v = shiftFormula(v, r - s.r, c - s.c);
      sheet().cells[ref] = { v, ...(s.cell.s ? { s: { ...s.cell.s } } : {}) };
    }
  }
  sel = { a: { row: to.r0, col: to.c0 }, f: { row: to.r1, col: to.c1 } };
  ensureGrid();
  refreshCells();
}

// ---------- keyboard ----------
scroller.tabIndex = 0;
scroller.addEventListener('keydown', (e) => {
  if (editing) return;
  const mod = e.ctrlKey || e.metaKey;
  const move = (dr, dc) => {
    e.preventDefault();
    if (mod) {
      const target = jump(sel.f, dr, dc);
      if (e.shiftKey) select(sel.a, target);
      else select(target);
    } else if (e.shiftKey) {
      select(sel.a, { row: sel.f.row + dr, col: sel.f.col + dc });
    } else {
      select({ row: sel.a.row + dr, col: sel.a.col + dc });
    }
  };
  switch (e.key) {
    case 'ArrowUp': return move(-1, 0);
    case 'ArrowDown': return move(1, 0);
    case 'ArrowLeft': return move(0, -1);
    case 'ArrowRight': return move(0, 1);
    case 'Enter': e.preventDefault(); return select({ row: sel.a.row + (e.shiftKey ? -1 : 1), col: sel.a.col });
    case 'Tab': e.preventDefault(); return select({ row: sel.a.row, col: sel.a.col + (e.shiftKey ? -1 : 1) });
    case 'Home': e.preventDefault(); return select(mod ? { row: 0, col: 0 } : { row: sel.a.row, col: 0 });
    case 'PageDown': e.preventDefault(); return select({ row: sel.a.row + 20, col: sel.a.col });
    case 'PageUp': e.preventDefault(); return select({ row: sel.a.row - 20, col: sel.a.col });
    case 'Delete':
    case 'Backspace': e.preventDefault(); return clearSelection();
    case 'F2': e.preventDefault(); return startEdit();
    case 'Escape': if (clip) { clip = null; overlay.classList.remove('marching'); } return undefined;
    default: break;
  }
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo(); }
    if (k === 'y') { e.preventDefault(); return redo(); }
    if (k === 'b') { e.preventDefault(); return toggleStyle('b'); }
    if (k === 'i') { e.preventDefault(); return toggleStyle('i'); }
    if (k === 'u') { e.preventDefault(); return toggleStyle('u'); }
    if (k === 'a') { e.preventDefault(); return select({ row: 0, col: 0 }, { row: rows - 1, col: cols - 1 }, { scroll: false }); }
    return undefined;
  }
  if (e.key.length === 1 && !e.altKey) {
    e.preventDefault();
    startEdit(e.key);
  }
  return undefined;
});

// Ctrl+Arrow: jump to the edge of the current data region.
function jump(p, dr, dc) {
  const has = (r, c) => {
    const v = cellAt(r, c)?.v;
    return v != null && v !== '';
  };
  let { row, col } = p;
  const inside = (r, c) => r >= 0 && c >= 0 && r < rows && c < cols;
  const startFilled = has(row, col) && inside(row + dr, col + dc) && has(row + dr, col + dc);
  if (startFilled) {
    while (inside(row + dr, col + dc) && has(row + dr, col + dc)) {
      row += dr;
      col += dc;
    }
  } else {
    row += dr;
    col += dc;
    while (inside(row, col) && !has(row, col)) {
      row += dr;
      col += dc;
    }
    if (!inside(row, col)) {
      row = Math.max(0, Math.min(rows - 1, row));
      col = Math.max(0, Math.min(cols - 1, col));
    }
  }
  return { row, col };
}

// ---------- clipboard ----------
function selectionMatrix(useDisplay) {
  const s = selRect();
  const out = [];
  for (let r = s.r0; r <= s.r1; r += 1) {
    const row = [];
    for (let c = s.c0; c <= s.c1; c += 1) {
      const cell = cellAt(r, c);
      row.push(useDisplay ? (cell ? format(valueAt(r, c), cell.s) : '') : cell ? { ...cell } : null);
    }
    out.push(row);
  }
  return out;
}

function trimmedSelection() {
  const s = selRect();
  const e = extent();
  return { ...s, r1: Math.min(s.r1, e.rows), c1: Math.min(s.c1, e.cols) };
}

document.addEventListener('copy', (e) => onCopy(e, false));
document.addEventListener('cut', (e) => onCopy(e, true));
function onCopy(e, cut) {
  if (editing || document.activeElement !== scroller) return;
  e.preventDefault();
  sel = { a: sel.a, f: { row: trimmedSelection().r1, col: trimmedSelection().c1 } };
  const text = selectionMatrix(true).map((r) => r.join('\t')).join('\n');
  e.clipboardData.setData('text/plain', text);
  clip = { text, cells: selectionMatrix(false), origin: { ...selRect() }, cut, sheet: book.active };
  overlay.classList.add('marching');
}

document.addEventListener('paste', (e) => {
  if (editing || document.activeElement !== scroller) return;
  e.preventDefault();
  const text = e.clipboardData.getData('text/plain');
  if (!text && !clip) return;
  snapshot();
  const prev = Object.keys(sheet().cells);
  const at = selRect();
  if (clip && text === clip.text) {
    clip.cells.forEach((row, i) => row.forEach((cell, j) => {
      const r = at.r0 + i;
      const c = at.c0 + j;
      const ref = refName(r, c);
      if (!cell) delete sheet().cells[ref];
      else sheet().cells[ref] = { ...cell, v: clip.cut ? cell.v : shiftFormula(cell.v, r - (clip.origin.r0 + i), c - (clip.origin.c0 + j)) };
    }));
    if (clip.cut) {
      const src = book.sheets[clip.sheet];
      for (let r = clip.origin.r0; r <= clip.origin.r1; r += 1) {
        for (let c = clip.origin.c0; c <= clip.origin.c1; c += 1) {
          const inside = r >= at.r0 && r < at.r0 + clip.cells.length && c >= at.c0 && c < at.c0 + clip.cells[0].length;
          if (!inside || src !== sheet()) delete src.cells[refName(r, c)];
        }
      }
      clip = null;
      overlay.classList.remove('marching');
    }
    sel = { a: { row: at.r0, col: at.c0 }, f: { row: at.r0 + (clip?.cells.length || 1) - 1, col: at.c0 + (clip?.cells[0].length || 1) - 1 } };
  } else {
    const matrix = text.replace(/\r/g, '').replace(/\n$/, '').split('\n').map((l) => l.split('\t'));
    matrix.forEach((row, i) => row.forEach((v, j) => setRaw(at.r0 + i, at.c0 + j, v)));
    sel = { a: { row: at.r0, col: at.c0 }, f: { row: at.r0 + matrix.length - 1, col: at.c0 + Math.max(...matrix.map((r) => r.length)) - 1 } };
  }
  ensureGrid();
  refreshCells(prev);
});

// ---------- rows / columns ----------
function shiftCells(axis, at, delta) {
  // axis 'row' or 'col'; delta +1 insert before `at`, -1 delete `at`.
  for (const s of book.sheets) {
    const next = {};
    for (const [ref, cell] of Object.entries(s.cells)) {
      const p = parseRef(ref);
      if (!p) continue;
      const k = p[axis];
      if (delta < 0 && k === at && s === sheet()) continue;
      const moved = s === sheet() && k >= at + (delta < 0 ? 1 : 0) ? { ...p, [axis]: k + delta } : p;
      const v = s === sheet() ? mapRefs(cell.v, (q) => {
        const qk = q[axis];
        if (delta < 0 && qk === at) return null;
        return qk >= at + (delta < 0 ? 1 : 0) ? { ...q, [axis]: qk + delta } : q;
      }) : cell.v;
      next[refName(moved.row, moved.col)] = { ...cell, v };
    }
    s.cells = next;
  }
  if (axis === 'col') {
    const widths = {};
    for (const [name, w] of Object.entries(sheet().cols || {})) {
      const c = parseRef(`${name}1`).col;
      if (delta < 0 && c === at) continue;
      widths[colName(c >= at + (delta < 0 ? 1 : 0) ? c + delta : c)] = w;
    }
    sheet().cols = widths;
  }
}

function insertRow() {
  snapshot();
  const s = selRect();
  for (let i = 0; i <= s.r1 - s.r0; i += 1) shiftCells('row', s.r0, 1);
  buildGrid();
  refreshCells();
}
function deleteRow() {
  snapshot();
  const s = selRect();
  for (let i = 0; i <= Math.min(s.r1, extent().rows) - s.r0; i += 1) shiftCells('row', s.r0, -1);
  buildGrid();
  refreshCells();
}
function insertCol() {
  snapshot();
  const s = selRect();
  for (let i = 0; i <= s.c1 - s.c0; i += 1) shiftCells('col', s.c0, 1);
  buildGrid();
  refreshCells();
}
function deleteCol() {
  snapshot();
  const s = selRect();
  for (let i = 0; i <= Math.min(s.c1, extent().cols) - s.c0; i += 1) shiftCells('col', s.c0, -1);
  buildGrid();
  refreshCells();
}

// ---------- commands ----------
function autoSum(fn = 'SUM') {
  const s = selRect();
  snapshot();
  if (s.r0 === s.r1 && s.c0 === s.c1) {
    const { row, col } = sel.a;
    let r = row - 1;
    while (r >= 0 && typeof valueAt(r, col) === 'number') r -= 1;
    let range;
    if (r < row - 1) range = `${refName(r + 1, col)}:${refName(row - 1, col)}`;
    else {
      let c = col - 1;
      while (c >= 0 && typeof valueAt(row, c) === 'number') c -= 1;
      range = c < col - 1 ? `${refName(row, c + 1)}:${refName(row, col - 1)}` : '';
    }
    setRaw(row, col, `=${fn}(${range})`);
    refreshCells();
    if (!range) startEdit(`=${fn}(`);
    return;
  }
  const below = s.r1 + 1;
  for (let c = s.c0; c <= s.c1; c += 1) setRaw(below, c, `=${fn}(${refName(s.r0, c)}:${refName(s.r1, c)})`);
  ensureGrid();
  refreshCells();
}

function sortSelection(dir) {
  const s = trimmedSelection();
  if (s.r0 === s.r1) {
    toast('Select the rows to sort first');
    return;
  }
  snapshot();
  const key = sel.a.col;
  const rowsData = [];
  for (let r = s.r0; r <= s.r1; r += 1) {
    const row = [];
    for (let c = s.c0; c <= s.c1; c += 1) row.push(cellAt(r, c) || null);
    rowsData.push({ row, k: valueAt(r, key) });
  }
  rowsData.sort((x, y) => {
    const a = x.k;
    const b = y.k;
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    if (typeof a === 'number' && typeof b === 'number') return (a - b) * dir;
    return String(a).localeCompare(String(b), undefined, { numeric: true }) * dir;
  });
  const prev = Object.keys(sheet().cells);
  rowsData.forEach((rd, i) => rd.row.forEach((cell, j) => {
    const ref = refName(s.r0 + i, s.c0 + j);
    if (cell) sheet().cells[ref] = cell;
    else delete sheet().cells[ref];
  }));
  refreshCells(prev);
}

function changeDecimals(d) {
  styleSelection((s) => {
    const v = valueAt(sel.a.row, sel.a.col);
    const current = s.dec ?? (s.fmt === 'number' || s.fmt === 'currency' ? 2 : s.fmt === 'percent' ? 0 : typeof v === 'number' && !Number.isInteger(v) ? Math.min(6, (String(v).split('.')[1] || '').length) : 0);
    return { dec: Math.max(0, Math.min(10, current + d)) };
  });
}

async function insertFunction(name) {
  const s = selRect();
  const multi = s.r0 !== s.r1 || s.c0 !== s.c1;
  if (multi) {
    autoSum(name);
    return;
  }
  startEdit(`=${name}(`);
}

// ---------- sheets ----------
function renderTabs() {
  tabsBar.innerHTML = '';
  book.sheets.forEach((s, i) => {
    const t = h('button', `sheet-tab${i === book.active ? ' active' : ''}`, escapeHtml(s.name));
    t.onclick = () => switchSheet(i);
    t.ondblclick = () => renameSheet(i);
    t.oncontextmenu = async (e) => {
      e.preventDefault();
      const v = await dialog({ title: `Sheet “${s.name}”`, fields: [{ name: 'action', label: 'Action', type: 'select', options: [{ value: 'rename', label: 'Rename' }, { value: 'delete', label: 'Delete' }, { value: 'dup', label: 'Duplicate' }] }], ok: 'Go' });
      if (v?.action === 'rename') renameSheet(i);
      if (v?.action === 'delete') deleteSheet(i);
      if (v?.action === 'dup') {
        snapshot();
        const copy = JSON.parse(JSON.stringify(s));
        delete copy.gid;
        copy.name = uniqueName(`${s.name} (2)`);
        book.sheets.splice(i + 1, 0, copy);
        switchSheet(i + 1);
      }
    };
    tabsBar.append(t);
  });
  const add = h('button', 'sheet-add', '+');
  add.title = 'New sheet';
  add.onclick = () => {
    snapshot();
    book.sheets.push({ name: uniqueName(`Sheet${book.sheets.length + 1}`), cells: {}, cols: {} });
    switchSheet(book.sheets.length - 1);
  };
  tabsBar.append(add);
}

function uniqueName(base) {
  let name = base;
  let n = 2;
  while (book.sheets.some((s) => s.name.toLowerCase() === name.toLowerCase())) name = `${base.replace(/\s*\(\d+\)$/, '')} (${n++})`;
  return name;
}

async function renameSheet(i) {
  const v = await dialog({ title: 'Rename sheet', fields: [{ name: 'name', label: 'Name', value: book.sheets[i].name }], ok: 'Rename' });
  const name = v?.name?.trim();
  if (!name || name === book.sheets[i].name) return;
  if (book.sheets.some((s, j) => j !== i && s.name.toLowerCase() === name.toLowerCase())) {
    toast('A sheet with that name already exists', 'error');
    return;
  }
  snapshot();
  book.sheets[i].name = name;
  renderTabs();
  refreshCells();
}

function deleteSheet(i) {
  if (book.sheets.length === 1) {
    toast('A workbook needs at least one sheet');
    return;
  }
  snapshot();
  book.sheets.splice(i, 1);
  switchSheet(Math.max(0, i - 1));
}

function switchSheet(i) {
  if (editing) commitEdit();
  book.active = i;
  sel = { a: { row: 0, col: 0 }, f: { row: 0, col: 0 } };
  buildGrid();
  renderTabs();
  refreshCells();
  scroller.scrollTo(0, 0);
}

function setZoom(z) {
  zoom = Math.max(40, Math.min(250, Math.round(z)));
  layer.style.zoom = zoom / 100;
  zoomRange.value = zoom;
  zoomLabel.textContent = `${zoom}%`;
}

// ---------- status bar ----------
const statText = h('span');
function updateStatus() {
  const s = selRect();
  if (s.r0 === s.r1 && s.c0 === s.c1) {
    statText.textContent = 'Ready';
    return;
  }
  let sum = 0;
  let count = 0;
  let nums = 0;
  const e = extent();
  for (let r = s.r0; r <= Math.min(s.r1, e.rows); r += 1) {
    for (let c = s.c0; c <= Math.min(s.c1, e.cols); c += 1) {
      const v = valueAt(r, c);
      if (v == null || v === '') continue;
      count += 1;
      if (typeof v === 'number') {
        sum += v;
        nums += 1;
      }
    }
  }
  const fmt = (n) => Number(n.toPrecision(10)).toLocaleString();
  statText.textContent = nums ? `Average: ${fmt(sum / nums)}    Count: ${count}    Sum: ${fmt(sum)}` : `Count: ${count}`;
}

// ---------- Claude helpers ----------
function sheetAsTable(maxRows = 300, maxCols = 40) {
  const e = extent();
  const r1 = Math.min(e.rows, maxRows - 1);
  const c1 = Math.min(e.cols, maxCols - 1);
  if (!Object.keys(sheet().cells).length) return '(empty sheet)';
  const lines = [`| | ${Array.from({ length: c1 + 1 }, (_, c) => colName(c)).join(' | ')} |`];
  for (let r = 0; r <= r1; r += 1) {
    const row = [];
    for (let c = 0; c <= c1; c += 1) {
      const cell = cellAt(r, c);
      if (!cell?.v) row.push('');
      else if (String(cell.v).startsWith('=')) row.push(`${cell.v} → ${format(valueAt(r, c), cell.s)}`);
      else row.push(format(valueAt(r, c), cell.s));
    }
    lines.push(`| ${r + 1} | ${row.map((v) => v.replace(/\|/g, '\\|')).join(' | ')} |`);
  }
  if (e.rows > r1 || e.cols > c1) lines.push(`(truncated; the sheet has ${e.rows + 1} rows and ${e.cols + 1} columns)`);
  return lines.join('\n');
}

function parseMarkdownTable(text) {
  const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|'));
  if (lines.length < 2) return null;
  return lines
    .filter((l) => !/^\|\s*:?-{2,}/.test(l))
    .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim().replace(/\\\|/g, '|').replace(/^\*\*(.*)\*\*$/, '$1')));
}

function writeMatrix(matrix, { headerBold = false } = {}) {
  snapshot();
  const prev = Object.keys(sheet().cells);
  const { row, col } = sel.a;
  matrix.forEach((r, i) => r.forEach((v, j) => {
    setRaw(row + i, col + j, v);
    if (headerBold && i === 0 && v) sheet().cells[refName(row + i, col + j)].s = { ...(sheet().cells[refName(row + i, col + j)].s || {}), b: true };
  }));
  ensureGrid();
  sel = { a: { row, col }, f: { row: row + matrix.length - 1, col: col + Math.max(...matrix.map((r) => r.length)) - 1 } };
  refreshCells(prev);
  scroller.focus({ preventScroll: true });
}

function insertFormula(f) {
  const formula = f.trim().startsWith('=') ? f.trim() : `=${f.trim()}`;
  snapshot();
  setRaw(sel.a.row, sel.a.col, formula.split('\n')[0]);
  refreshCells();
}

function formulaActions(text) {
  const actions = [];
  const code = codeBlock(text, ['excel', 'formula', '']) || codeBlock(text);
  const f = code?.split('\n').find((l) => l.trim().startsWith('='));
  if (f) actions.push({ label: `Insert formula in ${refName(sel.a.row, sel.a.col)}`, icon: 'fx', run: () => insertFormula(f) });
  const table = parseMarkdownTable(text);
  if (table) actions.push({ label: `Insert table at ${refName(sel.a.row, sel.a.col)}`, icon: 'table', run: () => writeMatrix(table, { headerBold: true }) });
  return actions;
}

const TABLE_SCHEMA = {
  type: 'object',
  properties: {
    summary: { type: 'string', description: 'One sentence describing what was produced.' },
    columns: { type: 'array', items: { type: 'string' } },
    rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
  },
  required: ['summary', 'columns', 'rows'],
  additionalProperties: false,
};

const QUICK = {
  formula: { label: 'Write a formula', icon: 'fx', prompt: 'Write a spreadsheet formula for the active cell. Explain it in one or two sentences, then give the formula alone in a ```excel code block.', input: 'Describe what the formula should calculate…', actions: formulaActions },
  analyze: { label: 'Analyze this data', icon: 'summarize', prompt: 'Analyze the data in this sheet (focus on the selection if one is given). Describe the key patterns, totals, trends and anything unusual in a few short bullet points. Suggest one or two useful formulas or charts.', actions: formulaActions },
  table: { label: 'Generate a table', icon: 'table', prompt: 'Create a table of data for the spreadsheet. Cell values may be numbers, text, or formulas starting with "=" that use A1 references relative to where the table will be placed (the header row goes in the active cell’s row).', input: 'What should the table contain?', format: TABLE_SCHEMA, working: 'Building the table', summary: (d) => `${d.summary}\n\n${d.rows.length} rows × ${d.columns.length} columns.`, actions: (d) => [{ label: `Insert at ${refName(sel.a.row, sel.a.col)}`, icon: 'table', run: () => writeMatrix([d.columns, ...d.rows], { headerBold: true }) }] },
  clean: { label: 'Clean up the selection', icon: 'wand', prompt: 'Clean up the selected cells: fix inconsistent capitalisation, spelling, spacing, date and number formats. Keep the same number of rows and columns and the same order. Put the cleaned header row (if the first selected row is a header) in "columns" and the rest in "rows"; if there is no header, leave "columns" empty.', format: TABLE_SCHEMA, working: 'Cleaning up', summary: (d) => d.summary, actions: (d) => [{ label: 'Replace selection', icon: 'replace', run: () => { const s = selRect(); sel = { a: { row: s.r0, col: s.c0 }, f: sel.f }; writeMatrix(d.columns.length ? [d.columns, ...d.rows] : d.rows); } }] },
  explain: { label: 'Explain the active cell’s formula', icon: 'help', prompt: 'Explain what the formula in the active cell does, step by step, in plain language. If it has a problem, suggest a fix in a ```excel code block.', actions: formulaActions },
};

// ---------- ribbon ----------
const active = (key) => () => !!cellAt(sel.a.row, sel.a.col)?.s?.[key];
const alignIs = (a) => () => cellAt(sel.a.row, sel.a.col)?.s?.align === a;
const FMTS = [
  { value: 'general', label: 'General' },
  { value: 'number', label: 'Number' },
  { value: 'integer', label: 'Whole number' },
  { value: 'currency', label: 'Currency' },
  { value: 'percent', label: 'Percentage' },
  { value: 'date', label: 'Date' },
];
const FUNCS = ['SUM', 'AVERAGE', 'COUNT', 'MAX', 'MIN', 'IF', 'VLOOKUP', 'XLOOKUP', 'SUMIF', 'COUNTIF', 'ROUND', 'CONCAT', 'TODAY', 'IFERROR', 'PMT'];

const homeTab = {
  id: 'home',
  label: 'Home',
  groups: [
    { label: 'Clipboard', items: [
      { type: 'big', icon: 'paste', label: 'Paste', run: () => { scroller.focus(); document.execCommand('paste') || toast('Use Ctrl+V to paste'); } },
      { type: 'stack', items: [
        { type: 'small', icon: 'cut', label: 'Cut', run: () => { scroller.focus(); document.execCommand('cut'); } },
        { type: 'small', icon: 'copy', label: 'Copy', run: () => { scroller.focus(); document.execCommand('copy'); } },
      ] },
    ] },
    { label: 'Font', items: [
      { type: 'row', items: [
        { type: 'text', text: 'B', style: 'font-weight:700', title: 'Bold', shortcut: 'Ctrl+B', run: () => toggleStyle('b'), active: active('b') },
        { type: 'text', text: 'I', style: 'font-style:italic', title: 'Italic', shortcut: 'Ctrl+I', run: () => toggleStyle('i'), active: active('i') },
        { type: 'text', text: 'U', style: 'text-decoration:underline', title: 'Underline', shortcut: 'Ctrl+U', run: () => toggleStyle('u'), active: active('u') },
        { type: 'icon', icon: 'grid', title: 'Borders', run: () => toggleStyle('border'), active: active('border') },
      ] },
      { type: 'row', items: [
        { type: 'color', icon: 'fill', title: 'Fill color', initial: '#fff3bf', allowNone: true, pick: (c) => styleSelection({ bg: c }) },
        { type: 'color', icon: 'color', title: 'Font color', initial: '#c0392b', allowNone: true, pick: (c) => styleSelection({ color: c }) },
      ] },
    ] },
    { label: 'Alignment', items: [
      { type: 'row', items: [
        { type: 'icon', icon: 'alignLeft', title: 'Align left', run: () => styleSelection({ align: alignIs('left')() ? null : 'left' }), active: alignIs('left') },
        { type: 'icon', icon: 'alignCenter', title: 'Center', run: () => styleSelection({ align: alignIs('center')() ? null : 'center' }), active: alignIs('center') },
        { type: 'icon', icon: 'alignRight', title: 'Align right', run: () => styleSelection({ align: alignIs('right')() ? null : 'right' }), active: alignIs('right') },
      ] },
      { type: 'row', items: [{ type: 'small', icon: 'wrap', label: 'Wrap text', run: () => toggleStyle('wrap'), active: active('wrap') }] },
    ] },
    { label: 'Number', items: [
      { type: 'row', items: [
        { type: 'select', title: 'Number format', width: 120, options: FMTS, value: () => cellAt(sel.a.row, sel.a.col)?.s?.fmt || 'general', change: (v) => styleSelection({ fmt: v === 'general' ? null : v, dec: null }) },
      ] },
      { type: 'row', items: [
        { type: 'icon', icon: 'currency', title: 'Currency', run: () => styleSelection({ fmt: 'currency', dec: null }) },
        { type: 'icon', icon: 'percent', title: 'Percent', run: () => styleSelection({ fmt: 'percent', dec: null }) },
        { type: 'icon', icon: 'decimalUp', title: 'Increase decimals', run: () => changeDecimals(1) },
        { type: 'icon', icon: 'decimalDown', title: 'Decrease decimals', run: () => changeDecimals(-1) },
      ] },
    ] },
    { label: 'Cells', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'insertRow', label: 'Insert rows', run: insertRow },
        { type: 'small', icon: 'insertCol', label: 'Insert columns', run: insertCol },
      ] },
      { type: 'stack', items: [
        { type: 'small', icon: 'deleteRow', label: 'Delete rows', run: deleteRow },
        { type: 'small', icon: 'deleteCol', label: 'Delete columns', run: deleteCol },
      ] },
    ] },
    { label: 'Editing', items: [
      { type: 'stack', items: [
        { type: 'small', icon: 'sum', label: 'AutoSum', run: () => autoSum('SUM') },
        { type: 'small', icon: 'sortAsc', label: 'Sort A to Z', run: () => sortSelection(1) },
        { type: 'small', icon: 'sortDesc', label: 'Sort Z to A', run: () => sortSelection(-1) },
      ] },
      { type: 'menu', icon: 'clear', label: 'Clear', items: [
        { label: 'Clear contents', run: () => clearSelection('contents') },
        { label: 'Clear formats', run: () => clearSelection('formats') },
        { label: 'Clear all', run: () => clearSelection('all') },
      ] },
    ] },
    { label: 'Claude', items: [{ type: 'big', icon: 'sparkle', label: 'Ask Claude', title: 'Open Claude (Ctrl+J)', run: () => shell.claude.toggle() }] },
  ],
};

const insertTab = {
  id: 'insert',
  label: 'Insert',
  groups: [
    { label: 'Cells', items: [
      { type: 'big', icon: 'insertRow', label: 'Rows', run: insertRow },
      { type: 'big', icon: 'insertCol', label: 'Columns', run: insertCol },
    ] },
    { label: 'Sheets', items: [{ type: 'big', icon: 'newFile', label: 'New Sheet', run: () => tabsBar.querySelector('.sheet-add').click() }] },
    { label: 'Tables', items: [{ type: 'big', icon: 'table', label: 'Table with Claude', run: () => shell.claude.runQuick(QUICK.table) }] },
  ],
};

const formulasTab = {
  id: 'formulas',
  label: 'Formulas',
  groups: [
    { label: 'Function Library', items: [
      { type: 'big', icon: 'fx', label: 'Insert Function', run: () => startEdit('=') },
      { type: 'big', icon: 'sum', label: 'AutoSum', run: () => autoSum('SUM') },
      { type: 'menu', big: true, icon: 'fx', label: 'Functions', items: FUNCS.map((f) => ({ label: f, run: () => insertFunction(f) })) },
    ] },
    { label: 'Claude', items: [
      { type: 'big', icon: 'wand', label: 'Write Formula', run: () => shell.claude.runQuick(QUICK.formula) },
      { type: 'big', icon: 'help', label: 'Explain Formula', run: () => shell.claude.runQuick(QUICK.explain) },
    ] },
  ],
};

const dataTab = {
  id: 'data',
  label: 'Data',
  groups: [
    { label: 'Sort', items: [
      { type: 'big', icon: 'sortAsc', label: 'Sort A to Z', run: () => sortSelection(1) },
      { type: 'big', icon: 'sortDesc', label: 'Sort Z to A', run: () => sortSelection(-1) },
    ] },
    { label: 'Data Tools', items: [{ type: 'big', icon: 'wand', label: 'Clean Up with Claude', run: () => shell.claude.runQuick(QUICK.clean) }] },
  ],
};

const viewTab = {
  id: 'view',
  label: 'View',
  groups: [
    { label: 'Show', items: [{ type: 'big', icon: 'grid', label: 'Gridlines', run: () => wrap.classList.toggle('no-grid'), active: () => !wrap.classList.contains('no-grid') }] },
    { label: 'Zoom', items: [
      { type: 'big', icon: 'zoomIn', label: 'Zoom In', run: () => setZoom(zoom + 10) },
      { type: 'big', icon: 'zoomOut', label: 'Zoom Out', run: () => setZoom(zoom - 10) },
      { type: 'big', icon: 'find', label: '100%', run: () => setZoom(100) },
    ] },
  ],
};

const claudeTab = {
  id: 'claude',
  label: 'Claude',
  special: true,
  groups: [
    { label: 'Formulas', items: [
      { type: 'big', icon: 'fx', label: 'Write Formula', run: () => shell.claude.runQuick(QUICK.formula) },
      { type: 'big', icon: 'help', label: 'Explain Formula', run: () => shell.claude.runQuick(QUICK.explain) },
    ] },
    { label: 'Data', items: [
      { type: 'big', icon: 'summarize', label: 'Analyze', run: () => shell.claude.runQuick(QUICK.analyze) },
      { type: 'big', icon: 'table', label: 'Generate Table', run: () => shell.claude.runQuick(QUICK.table) },
      { type: 'big', icon: 'wand', label: 'Clean Up', run: () => shell.claude.runQuick(QUICK.clean) },
    ] },
    { label: 'Chat', items: [{ type: 'big', icon: 'chat', label: 'Open Claude', run: () => shell.claude.toggle() }] },
  ],
};

const shell = await createShell({
  app: 'sheets',
  defaultExt: 'xlsx',
  tabs: [homeTab, insertTab, formulasTab, dataTab, viewTab],
  claudeTab,
  undo,
  redo,
  getSaveData: () => {
    if (editing) commitEdit();
    const out = JSON.parse(JSON.stringify(book));
    for (const s of out.sheets) {
      const vals = values[s.name];
      for (const [ref, cell] of Object.entries(s.cells)) {
        const v = vals?.get(ref);
        if (String(cell.v).startsWith('=')) cell.r = v == null ? '' : typeof v === 'object' ? format(v) : v;
      }
    }
    return out;
  },
  customSave: () => liveSave(),
  exports: [{ label: 'CSV (current sheet)', detail: 'Values of the current sheet, comma-separated.', icon: 'grid', ext: 'csv' }],
  pdfOptions: () => ({ landscape: true }),
  claude: {
    intro: 'I can write formulas, analyze your data, build tables and tidy up messy cells. Select a range first to focus on it.',
    placeholder: 'Ask Claude about this sheet…',
    system: [
      'You are Claude, built into Rea Sheets, a spreadsheet app. The current sheet is given as a Markdown table with column letters and row numbers; formula cells are shown as "=FORMULA → result".',
      'Formulas use Excel syntax and A1 references. Supported functions include SUM, AVERAGE, COUNT, COUNTA, COUNTIF(S), SUMIF(S), AVERAGEIF(S), MINIFS, MAXIFS, MIN, MAX, MEDIAN, STDEV, LARGE, SMALL, RANK, IF, IFS, SWITCH, CHOOSE, IFERROR, AND, OR, NOT, VLOOKUP, HLOOKUP, XLOOKUP, INDEX, MATCH, ROUND, ROUNDUP, ROUNDDOWN, ABS, SQRT, POWER, MOD, INT, CONCAT, CONCATENATE, TEXTJOIN, TEXT, VALUE, LEFT, RIGHT, MID, LEN, TRIM, UPPER, LOWER, PROPER, SUBSTITUTE, TODAY, NOW, DATE, YEAR, MONTH, DAY, PMT, FV, PV, NPV.',
      'When you give a formula the user can insert, put the formula alone in a ```excel code block. When you give tabular data, use a Markdown table. Be concise.',
    ].join('\n'),
    context: () => {
      const s = selRect();
      const multi = s.r0 !== s.r1 || s.c0 !== s.c1;
      const sels = multi ? `\n<selection range="${rangeName(trimmedSelection())}">\n${selectionMatrix(true).slice(0, 200).map((r) => r.join('\t')).join('\n')}\n</selection>` : '';
      const ac = cellAt(sel.a.row, sel.a.col);
      return `<workbook name="${shell.state.name}" sheets="${book.sheets.map((x) => x.name).join(', ')}">\n<sheet name="${sheet().name}">\n${sheetAsTable()}\n</sheet>\n</workbook>\n<active_cell ref="${refName(sel.a.row, sel.a.col)}">${ac?.v ?? ''}</active_cell>${sels}`;
    },
    quick: [QUICK.formula, QUICK.analyze, QUICK.table, QUICK.clean],
    actions: formulaActions,
  },
});

// ---------- live Google Sheets ----------
// A Google Sheet opened from Drive stays connected: local edits (yours or
// Claude's) are written through the Sheets API within a second, and changes
// made elsewhere are pulled every few seconds. Values and formulas sync;
// formatting comes from the copy opened at the start.
let live = null;
const POLL_MS = 4000;

const liveBadge = h('span', 'live-badge', `${icon('live', 14)}<span>Connecting to Google Sheets…</span>`);
function liveState(state, text) {
  liveBadge.className = `live-badge ${state}`;
  liveBadge.querySelector('span').textContent = text;
  liveBadge.title = state === 'off' ? text : 'Edits sync with Google Sheets while this workbook is open.';
}

const cellsOf = (s) => Object.fromEntries(Object.entries(s.cells).filter(([, c]) => c.v !== '' && c.v != null).map(([ref, c]) => [ref, String(c.v)]));

function setCellValue(s, ref, v) {
  if (v === '' || v == null) {
    if (s.cells[ref]?.s && Object.keys(s.cells[ref].s).length) s.cells[ref].v = '';
    else delete s.cells[ref];
  } else s.cells[ref] = { ...(s.cells[ref] || {}), v };
}

async function liveCall(op, args) {
  const r = await window.office.cloud.sheet(shell.state.path, op, args);
  if (r?.error) throw new Error(r.error);
  return r;
}

async function liveStart() {
  live = { base: new Map(), busy: false, again: false, timer: 0, applying: false, failures: 0 };
  liveState('busy', 'Connecting to Google Sheets…');
  try {
    const remote = await liveCall('read');
    live.applying = true;
    // Match local tabs to remote ones by position (the export keeps the order), then take remote values as the truth.
    remote.forEach((r, i) => {
      let local = book.sheets[i];
      if (!local) {
        local = { name: r.title, cells: {}, cols: {} };
        book.sheets.push(local);
      }
      local.gid = r.gid;
      local.name = r.title;
      const lc = cellsOf(local);
      for (const ref of new Set([...Object.keys(lc), ...Object.keys(r.cells)])) if ((lc[ref] ?? '') !== (r.cells[ref] ?? '')) setCellValue(local, ref, r.cells[ref] ?? '');
      live.base.set(r.gid, { title: r.title, cells: { ...r.cells } });
    });
    book.sheets.splice(remote.length);
    book.active = Math.min(book.active, book.sheets.length - 1);
    afterRemote();
    shell.markClean();
    liveState('on', 'Live with Google Sheets');
  } catch (err) {
    liveState('off', `Not syncing: ${err.message}`);
  } finally {
    if (live) live.applying = false;
  }
  // Poll while the window is visible; slow down when it's hidden.
  let tick = 0;
  setInterval(() => {
    tick += 1;
    if (document.visibilityState === 'visible' || tick % 4 === 0) liveSync();
  }, POLL_MS);
}

function afterRemote() {
  buildGrid();
  renderTabs();
  refreshCells();
}

function liveSoon(ms) {
  clearTimeout(live.timer);
  live.timer = setTimeout(liveSync, ms);
}

// Pull remote changes, merge them, then push local ones. Local edits win a conflict.
async function liveSync() {
  if (!live || editing) return;
  if (live.busy) {
    live.again = true;
    return;
  }
  live.busy = true;
  try {
    await livePull();
    const pushed = await livePush();
    live.failures = 0;
    if (pushed) liveState('on', 'Saved to Google Sheets');
    else if (!liveBadge.classList.contains('on')) liveState('on', 'Live with Google Sheets');
    if (!livePending()) shell.markClean();
  } catch (err) {
    live.failures += 1;
    liveState('off', `Not syncing: ${err.message}`);
  } finally {
    live.busy = false;
    if (live.again) {
      live.again = false;
      liveSoon(200);
    }
  }
}

async function livePull() {
  const remote = await liveCall('read');
  const seen = new Set();
  let changed = false;
  live.applying = true;
  try {
    for (const r of remote) {
      seen.add(r.gid);
      const b = live.base.get(r.gid);
      let local = book.sheets.find((x) => x.gid === r.gid);
      if (!b) {
        // A tab added elsewhere.
        if (!local) {
          local = { name: r.title, cells: {}, cols: {}, gid: r.gid };
          for (const [ref, v] of Object.entries(r.cells)) setCellValue(local, ref, v);
          book.sheets.push(local);
          changed = true;
        }
      } else if (local) {
        if (r.title !== b.title && local.name === b.title) {
          local.name = r.title;
          changed = true;
        }
        const lc = cellsOf(local);
        for (const ref of new Set([...Object.keys(r.cells), ...Object.keys(b.cells)])) {
          const rv = r.cells[ref] ?? '';
          const bv = b.cells[ref] ?? '';
          if (rv !== bv && (lc[ref] ?? '') === bv) {
            setCellValue(local, ref, rv);
            changed = true;
          }
        }
      }
      live.base.set(r.gid, { title: r.title, cells: { ...r.cells } });
    }
    // Tabs deleted elsewhere.
    for (const gid of [...live.base.keys()]) {
      if (seen.has(gid)) continue;
      live.base.delete(gid);
      const i = book.sheets.findIndex((x) => x.gid === gid);
      if (i >= 0 && book.sheets.length > 1) {
        book.sheets.splice(i, 1);
        book.active = Math.min(book.active, book.sheets.length - 1);
        changed = true;
      }
    }
    if (changed) afterRemote();
  } finally {
    live.applying = false;
  }
}

function liveDiff() {
  const ops = [];
  const adds = [];
  const owned = new Set();
  for (const s of book.sheets) {
    if (s.gid == null || !live.base.has(s.gid) || owned.has(s.gid)) {
      ops.push({ add: s.name });
      adds.push(s);
      continue;
    }
    owned.add(s.gid);
    if (live.base.get(s.gid).title !== s.name) ops.push({ rename: s.gid, title: s.name });
  }
  for (const gid of live.base.keys()) if (!owned.has(gid)) ops.push({ remove: gid });
  return { ops, adds };
}

function cellChanges() {
  const out = [];
  for (const s of book.sheets) {
    const b = live.base.get(s.gid);
    if (!b) continue;
    const lc = cellsOf(s);
    for (const ref of new Set([...Object.keys(lc), ...Object.keys(b.cells)])) {
      const v = lc[ref] ?? '';
      if (v !== (b.cells[ref] ?? '')) out.push({ gid: s.gid, title: s.name, ref, v });
    }
  }
  return out;
}

function livePending() {
  return liveDiff().ops.length > 0 || cellChanges().length > 0;
}

async function livePush() {
  const { ops, adds } = liveDiff();
  let pushed = false;
  if (ops.length) {
    liveState('busy', 'Saving to Google Sheets…');
    const ids = await liveCall('structure', ops);
    let n = 0;
    ops.forEach((o, i) => {
      if (o.add != null) {
        const s = adds[n++];
        s.gid = ids[i];
        live.base.set(s.gid, { title: s.name, cells: {} });
      } else if (o.rename != null) live.base.get(o.rename).title = o.title;
      else live.base.delete(o.remove);
    });
    pushed = true;
  }
  const changes = cellChanges();
  if (changes.length) {
    liveState('busy', 'Saving to Google Sheets…');
    await liveCall('write', changes.map(({ title, ref, v }) => ({ title, ref, v })));
    for (const c of changes) {
      const b = live.base.get(c.gid);
      if (c.v === '') delete b.cells[c.ref];
      else b.cells[c.ref] = c.v;
    }
    pushed = true;
  }
  return pushed;
}

// Ctrl+S on a live sheet: push now instead of uploading a file.
async function liveSave() {
  if (!live) return false;
  if (editing) commitEdit();
  await liveSync();
  if (liveBadge.classList.contains('off')) toast(liveBadge.title, 'error');
  else toast('All changes are saved to Google Sheets');
  return true;
}

shell.workspace.append(wrap);
const zoomBox = h('div', 'zoom', '<button title="Zoom out">−</button><input type="range" min="40" max="250"><button title="Zoom in">+</button><span></span>');
const zoomRange = zoomBox.querySelector('input');
const zoomLabel = zoomBox.querySelector('span');
zoomRange.oninput = () => setZoom(Number(zoomRange.value));
zoomBox.querySelectorAll('button')[0].onclick = () => setZoom(zoom - 10);
zoomBox.querySelectorAll('button')[1].onclick = () => setZoom(zoom + 10);
shell.statusLeft.append(statText);
shell.statusRight.append(zoomBox);

if (shell.info.file?.data?.sheets) {
  book = { ...shell.info.file.data, active: 0 };
  for (const s of book.sheets) {
    s.cells ||= {};
    s.cols ||= {};
  }
}
buildGrid();
renderTabs();
refreshCells();
setZoom(100);
scroller.focus();
if (shell.info.file?.generated) shell.markDirty();
if (shell.info.file?.cloud?.live) {
  shell.statusRight.prepend(liveBadge);
  liveStart();
}
