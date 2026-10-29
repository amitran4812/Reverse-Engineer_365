import '../shared/ui.css';
import './slides.css';
import { createShell, escapeHtml, h, toast } from '../shared/shell.js';
import { markdownToHtml, sanitize } from '../shared/claude-pane.js';
import { icon } from '../shared/icons.js';

const W = 960;
const H = 540;

const THEMES = {
  paper: { label: 'Paper', bg: '#ffffff', text: '#2b2f36', title: '#1f2328', accent: '#c2532d', font: 'Calibri' },
  slate: { label: 'Slate', bg: '#f1f3f5', text: '#343a40', title: '#1c64c4', accent: '#1c64c4', font: 'Segoe UI' },
  midnight: { label: 'Midnight', bg: '#15213b', text: '#d9e1f2', title: '#ffffff', accent: '#4cc9f0', font: 'Segoe UI' },
  sunrise: { label: 'Sunrise', bg: '#fff4e6', text: '#4a2c17', title: '#b7410e', accent: '#f08c00', font: 'Georgia' },
  forest: { label: 'Forest', bg: '#1f3d2b', text: '#e2efe6', title: '#ffffff', accent: '#9bd35a', font: 'Trebuchet MS' },
  berry: { label: 'Berry', bg: '#ffffff', text: '#2b2d42', title: '#6a2bb8', accent: '#6a2bb8', font: 'Verdana', band: true },
};

const LAYOUTS = {
  title: { label: 'Title Slide', make: () => [
    text('title', 80, 165, 800, 120, 54, 'center', 'Click to add title'),
    text('subtitle', 140, 295, 680, 70, 24, 'center', 'Click to add subtitle'),
  ] },
  content: { label: 'Title and Content', make: () => [
    text('title', 60, 34, 840, 84, 38, 'left', 'Click to add title'),
    text('body', 60, 132, 840, 370, 22, 'left', 'Click to add text', true),
  ] },
  section: { label: 'Section Header', make: () => [
    text('title', 80, 190, 800, 100, 46, 'left', 'Click to add section title'),
    text('subtitle', 80, 295, 800, 60, 22, 'left', 'Click to add text'),
  ] },
  two: { label: 'Two Content', make: () => [
    text('title', 60, 34, 840, 84, 38, 'left', 'Click to add title'),
    text('body', 60, 132, 410, 370, 20, 'left', 'Click to add text', true),
    text('body', 490, 132, 410, 370, 20, 'left', 'Click to add text', true),
  ] },
  titleOnly: { label: 'Title Only', make: () => [text('title', 60, 34, 840, 84, 38, 'left', 'Click to add title')] },
  blank: { label: 'Blank', make: () => [] },
};

let uid = Date.now();
const nid = () => `e${(uid++).toString(36)}`;

function text(role, x, y, w, h, fontSize, align, placeholder, bullets = false) {
  return { id: nid(), type: 'text', role, x, y, w, h, html: '', placeholder, style: { fontSize, align, bullets } };
}

function newSlide(layout = 'content') {
  return { id: nid(), layout, elements: LAYOUTS[layout].make(), notes: '' };
}

let deck = { theme: 'paper', slides: [newSlide('title')] };
let current = 0;
let selected = null; // element id
let editingId = null;
let undoStack = [];
let redoStack = [];

const theme = () => THEMES[deck.theme] || THEMES.paper;
const slide = () => deck.slides[current];
const selectedEl = () => slide()?.elements.find((e) => e.id === selected) || null;

// ---------- DOM ----------
const root = h('div', 'slides-wrap');
const thumbs = h('div', 'thumbs');
thumbs.tabIndex = 0;
const center = h('div', 'slide-center');
const stageWrap = h('div', 'stage-wrap');
const stage = h('div', 'stage');
stageWrap.append(stage);
const notes = h('textarea', 'notes');
notes.placeholder = 'Click to add speaker notes';
center.append(stageWrap, notes);
root.append(thumbs, center);
const presenter = h('div', 'presenter');
const printDeck = h('div', 'print-deck');

function elementColor(el) {
  if (el.style?.color) return el.style.color;
  return el.role === 'title' ? theme().title : theme().text;
}

function renderSlideInto(container, s, { interactive = false } = {}) {
  container.innerHTML = '';
  const t = theme();
  const surface = h('div', 'slide');
  surface.style.background = s.bg || t.bg;
  surface.style.fontFamily = t.font;
  if (t.band && s.layout !== 'title') surface.append(Object.assign(h('div', 'band'), { style: `background:${t.accent}` }));
  if (s.layout === 'title' || s.layout === 'section') {
    const bar = h('div', 'accent-bar');
    bar.style.background = t.accent;
    bar.style.top = s.layout === 'title' ? '288px' : '290px';
    bar.style.left = s.layout === 'title' ? '430px' : '80px';
    surface.append(bar);
  }
  for (const el of s.elements) {
    const node = h('div', `el el-${el.type}${el.style?.bullets ? ' bullets' : ''}`);
    node.dataset.id = el.id;
    Object.assign(node.style, { left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px` });
    if (el.type === 'text' || el.type === 'shape') {
      const inner = h('div', 'el-text');
      inner.innerHTML = el.html || '';
      if (!el.html && el.placeholder) inner.dataset.ph = el.placeholder;
      Object.assign(inner.style, {
        fontSize: `${el.style?.fontSize || 24}px`,
        color: el.type === 'shape' && !el.style?.color ? '#ffffff' : elementColor(el),
        textAlign: el.style?.align || (el.type === 'shape' ? 'center' : 'left'),
        fontWeight: el.style?.bold || el.role === 'title' ? (el.role === 'title' && !el.style?.bold ? '600' : '700') : '',
        fontStyle: el.style?.italic ? 'italic' : '',
        fontFamily: el.style?.fontFamily || '',
        justifyContent: el.type === 'shape' || el.style?.valign === 'middle' ? 'center' : el.role === 'title' && s.layout !== 'title' ? 'flex-end' : 'flex-start',
      });
      if (el.type === 'shape') {
        node.classList.add(`shape-${el.shape}`);
        node.style.setProperty('--fill', el.style?.fill || t.accent);
        node.style.setProperty('--stroke', el.style?.stroke || 'transparent');
      }
      node.append(inner);
    } else if (el.type === 'image') {
      const img = h('img');
      img.src = el.src;
      img.draggable = false;
      node.append(img);
    }
    if (interactive) {
      if (el.id === selected) node.classList.add('selected');
      if (el.id === selected && el.id !== editingId) {
        for (const d of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
          const hd = h('div', `handle h-${d}`);
          hd.dataset.dir = d;
          node.append(hd);
        }
      }
    }
    surface.append(node);
  }
  container.append(surface);
  return surface;
}

function fitStage() {
  const pad = 32;
  const availW = stageWrap.clientWidth - pad * 2;
  const availH = stageWrap.clientHeight - pad * 2;
  const scale = Math.max(0.1, Math.min(availW / W, availH / H));
  stage.style.setProperty('--scale', scale);
  stage.style.width = `${W * scale}px`;
  stage.style.height = `${H * scale}px`;
  return scale;
}

function renderStage() {
  renderSlideInto(stage, slide(), { interactive: true });
  if (editingId) {
    const inner = stage.querySelector(`[data-id="${editingId}"] .el-text`);
    if (inner) makeEditable(inner, editingId, false);
  }
  fitStage();
}

function renderThumbs() {
  thumbs.innerHTML = '';
  deck.slides.forEach((s, i) => {
    const item = h('div', `thumb${i === current ? ' active' : ''}`);
    item.draggable = true;
    item.dataset.index = i;
    const num = h('span', 'thumb-num', String(i + 1));
    const box = h('div', 'thumb-box');
    renderSlideInto(box, s);
    item.append(num, box);
    item.onclick = () => go(i);
    item.ondragstart = (e) => {
      e.dataTransfer.setData('text/x-slide', String(i));
      item.classList.add('dragging');
    };
    item.ondragend = () => item.classList.remove('dragging');
    item.ondragover = (e) => {
      e.preventDefault();
      item.classList.add('drop');
    };
    item.ondragleave = () => item.classList.remove('drop');
    item.ondrop = (e) => {
      e.preventDefault();
      const from = Number(e.dataTransfer.getData('text/x-slide'));
      if (Number.isNaN(from) || from === i) return;
      snapshot();
      const [moved] = deck.slides.splice(from, 1);
      deck.slides.splice(i, 0, moved);
      current = i;
      renderAll();
    };
    thumbs.append(item);
  });
}

function updateThumb(i = current) {
  const box = thumbs.children[i]?.querySelector('.thumb-box');
  if (box) renderSlideInto(box, deck.slides[i]);
}

function renderAll() {
  renderThumbs();
  renderStage();
  notes.value = slide()?.notes || '';
  updateStatus();
  shell.refresh();
  thumbs.children[current]?.scrollIntoView({ block: 'nearest' });
}

function go(i) {
  finishEditing();
  current = Math.max(0, Math.min(deck.slides.length - 1, i));
  selected = null;
  renderAll();
}

// ---------- undo ----------
function snapshot() {
  undoStack.push(JSON.stringify({ deck, current }));
  if (undoStack.length > 100) undoStack.shift();
  redoStack = [];
  shell.markDirty();
}
function restore(json) {
  const s = JSON.parse(json);
  deck = s.deck;
  current = Math.min(s.current, deck.slides.length - 1);
  selected = null;
  editingId = null;
  renderAll();
  shell.markDirty();
}
function undo() {
  if (editingId) return document.execCommand('undo');
  if (!undoStack.length) return undefined;
  redoStack.push(JSON.stringify({ deck, current }));
  return restore(undoStack.pop());
}
function redo() {
  if (editingId) return document.execCommand('redo');
  if (!redoStack.length) return undefined;
  undoStack.push(JSON.stringify({ deck, current }));
  return restore(redoStack.pop());
}

// ---------- editing text ----------
function makeEditable(inner, id, placeCaret = true) {
  inner.contentEditable = 'true';
  delete inner.dataset.ph;
  if (!inner.innerHTML) inner.innerHTML = '<div><br></div>';
  inner.onblur = () => setTimeout(() => {
    if (editingId === id && !inner.contains(document.activeElement)) finishEditing();
  }, 0);
  inner.oninput = () => {
    const el = slide().elements.find((e) => e.id === id);
    if (el) el.html = cleanHtml(inner.innerHTML);
    shell.markDirty();
  };
  inner.focus();
  if (placeCaret) {
    const range = document.createRange();
    range.selectNodeContents(inner);
    range.collapse(false);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(range);
  }
}

// Keep each line in its own block so bullets and paragraph export line up.
function cleanHtml(html) {
  const box = document.createElement('div');
  box.innerHTML = sanitize(html);
  const blocks = new Set(['DIV', 'P', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3']);
  let pending = null;
  for (const node of [...box.childNodes]) {
    if (node.nodeType === 1 && blocks.has(node.tagName)) {
      pending = null;
      continue;
    }
    if (node.nodeType === 1 && node.tagName === 'BR') {
      if (!pending) box.insertBefore(Object.assign(document.createElement('div'), { innerHTML: '<br>' }), node);
      node.remove();
      pending = null;
      continue;
    }
    if (!pending) {
      pending = document.createElement('div');
      box.insertBefore(pending, node);
    }
    pending.append(node);
  }
  const out = box.innerHTML;
  return box.textContent.trim() || box.querySelector('img') ? out : '';
}

function startEditing(id) {
  const el = slide().elements.find((e) => e.id === id);
  if (!el || el.type === 'image') return;
  snapshot();
  selected = id;
  editingId = id;
  renderStage();
}

function finishEditing() {
  if (!editingId) return;
  const inner = stage.querySelector(`[data-id="${editingId}"] .el-text`);
  const el = slide().elements.find((e) => e.id === editingId);
  if (inner && el) el.html = cleanHtml(inner.innerHTML);
  editingId = null;
  renderStage();
  updateThumb();
}

// ---------- mouse on stage ----------
let drag = null;
stage.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.handle');
  const node = e.target.closest('.el');
  if (node && node.dataset.id === editingId && !handle) return; // let the caret move
  if (!node) {
    finishEditing();
    if (selected) {
      selected = null;
      renderStage();
      shell.refresh();
    }
    return;
  }
  e.preventDefault();
  if (editingId && node.dataset.id !== editingId) finishEditing();
  const id = node.dataset.id;
  const el = slide().elements.find((x) => x.id === id);
  if (selected !== id) {
    selected = id;
    renderStage();
    shell.refresh();
  }
  const scale = Number(getComputedStyle(stage).getPropertyValue('--scale')) || 1;
  drag = { id, dir: handle?.dataset.dir || 'move', x: e.clientX, y: e.clientY, start: { x: el.x, y: el.y, w: el.w, h: el.h }, scale, moved: false };
});

stage.addEventListener('dblclick', (e) => {
  const node = e.target.closest('.el');
  if (node && node.dataset.id !== editingId) startEditing(node.dataset.id);
});

window.addEventListener('mousemove', (e) => {
  if (!drag) return;
  const dx = (e.clientX - drag.x) / drag.scale;
  const dy = (e.clientY - drag.y) / drag.scale;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
  if (!drag.moved) {
    snapshot();
    drag.moved = true;
  }
  const el = slide().elements.find((x) => x.id === drag.id);
  const s = drag.start;
  let { x, y, w, h: hh } = s;
  const d = drag.dir;
  if (d === 'move') {
    x = s.x + dx;
    y = s.y + dy;
    // snap to the slide's centre lines
    const cx = x + w / 2;
    const cy = y + hh / 2;
    if (Math.abs(cx - W / 2) < 6) x = W / 2 - w / 2;
    if (Math.abs(cy - H / 2) < 6) y = H / 2 - hh / 2;
  } else {
    if (d.includes('e')) w = Math.max(20, s.w + dx);
    if (d.includes('s')) hh = Math.max(20, s.h + dy);
    if (d.includes('w')) {
      w = Math.max(20, s.w - dx);
      x = s.x + s.w - w;
    }
    if (d.includes('n')) {
      hh = Math.max(20, s.h - dy);
      y = s.y + s.h - hh;
    }
    if (e.shiftKey && el.type !== 'text') {
      const ratio = s.w / s.h;
      if (d.length === 2) hh = w / ratio;
    }
  }
  Object.assign(el, { x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(hh) });
  const node = stage.querySelector(`[data-id="${el.id}"]`);
  Object.assign(node.style, { left: `${el.x}px`, top: `${el.y}px`, width: `${el.w}px`, height: `${el.h}px` });
});

window.addEventListener('mouseup', () => {
  if (drag?.moved) updateThumb();
  drag = null;
});

window.addEventListener('resize', fitStage);
new ResizeObserver(fitStage).observe(stageWrap);

notes.addEventListener('focus', () => snapshot());
notes.addEventListener('input', () => {
  slide().notes = notes.value;
  shell.markDirty();
});
notes.addEventListener('keydown', (e) => e.stopPropagation());

// ---------- commands ----------
function addSlide(layout = 'content', at = current + 1) {
  finishEditing();
  snapshot();
  deck.slides.splice(at, 0, newSlide(layout));
  current = at;
  selected = null;
  renderAll();
}

function duplicateSlide() {
  finishEditing();
  snapshot();
  const copy = JSON.parse(JSON.stringify(slide()));
  copy.id = nid();
  copy.elements.forEach((e) => {
    e.id = nid();
  });
  deck.slides.splice(current + 1, 0, copy);
  current += 1;
  renderAll();
}

function deleteSlide() {
  finishEditing();
  snapshot();
  deck.slides.splice(current, 1);
  if (!deck.slides.length) deck.slides.push(newSlide('title'));
  current = Math.min(current, deck.slides.length - 1);
  selected = null;
  renderAll();
}

function moveSlide(d) {
  const to = current + d;
  if (to < 0 || to >= deck.slides.length) return;
  snapshot();
  const [s] = deck.slides.splice(current, 1);
  deck.slides.splice(to, 0, s);
  current = to;
  renderAll();
}

function changeLayout(layout) {
  finishEditing();
  snapshot();
  const s = slide();
  const texts = s.elements.filter((e) => e.type === 'text' && e.role && e.html);
  const others = s.elements.filter((e) => !(e.type === 'text' && e.role));
  const fresh = LAYOUTS[layout].make();
  for (const f of fresh) {
    const match = texts.findIndex((t) => t.role === f.role);
    if (match >= 0) {
      f.html = texts[match].html;
      texts.splice(match, 1);
    }
  }
  s.layout = layout;
  s.elements = [...fresh, ...others];
  renderAll();
}

function addElement(el) {
  finishEditing();
  snapshot();
  slide().elements.push(el);
  selected = el.id;
  renderStage();
  updateThumb();
  shell.refresh();
}

function addTextBox() {
  const el = { id: nid(), type: 'text', role: null, x: 330, y: 230, w: 300, h: 70, html: '', placeholder: 'Type here', style: { fontSize: 24, align: 'left' } };
  addElement(el);
  startEditing(el.id);
}

function addShape(shape) {
  addElement({ id: nid(), type: 'shape', shape, x: 380, y: 190, w: 200, h: shape === 'line' ? 4 : 160, html: '', style: { fontSize: 20 } });
}

function addImage() {
  const input = h('input');
  input.type = 'file';
  input.accept = 'image/png,image/jpeg,image/gif';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const ratio = img.width / img.height;
        let w = Math.min(560, img.width);
        let hh = w / ratio;
        if (hh > 420) {
          hh = 420;
          w = hh * ratio;
        }
        addElement({ id: nid(), type: 'image', src: reader.result, x: Math.round((W - w) / 2), y: Math.round((H - hh) / 2), w: Math.round(w), h: Math.round(hh) });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

function deleteSelected() {
  if (!selected) return;
  snapshot();
  slide().elements = slide().elements.filter((e) => e.id !== selected);
  selected = null;
  renderStage();
  updateThumb();
  shell.refresh();
}

function arrange(dir) {
  const el = selectedEl();
  if (!el) return;
  snapshot();
  const list = slide().elements.filter((e) => e !== el);
  if (dir > 0) list.push(el);
  else list.unshift(el);
  slide().elements = list;
  renderStage();
  updateThumb();
}

// Formatting applies to the selection while typing, or to the whole box otherwise.
function format(cmd, styleKey, value) {
  if (editingId) {
    document.execCommand(cmd, false, value);
    const inner = stage.querySelector(`[data-id="${editingId}"] .el-text`);
    const el = slide().elements.find((e) => e.id === editingId);
    if (inner && el) el.html = cleanHtml(inner.innerHTML);
    shell.markDirty();
    return;
  }
  const el = selectedEl();
  if (!el) {
    toast('Select a text box first');
    return;
  }
  snapshot();
  el.style = { ...el.style, [styleKey]: value === undefined ? !el.style?.[styleKey] : value };
  renderStage();
  updateThumb();
  shell.refresh();
}

function setStyle(patch) {
  const el = selectedEl();
  if (!el) {
    toast('Select an object first');
    return;
  }
  snapshot();
  el.style = { ...el.style, ...patch };
  renderStage();
  updateThumb();
  shell.refresh();
}

function setTheme(id) {
  snapshot();
  deck.theme = id;
  renderAll();
}

function setBackground(color) {
  snapshot();
  slide().bg = color;
  renderStage();
  updateThumb();
}

// ---------- presenting ----------
// The bottom bar has a "What to say" button: Claude writes a short script for
// the slide on screen, and it follows along as the slides change.
let presentIndex = 0;
let coachOn = false;
let barTimer = 0;
const scripts = new Map(); // slide key -> { text, done, error }
let scriptRun = null; // { id, key }
const presentBar = h('div', 'present-bar');
const coach = h('div', 'present-coach');
presentBar.addEventListener('click', (e) => e.stopPropagation());
coach.addEventListener('click', (e) => e.stopPropagation());

function presentBtn(iconName, label, run) {
  const b = h('button', 'present-btn', `${icon(iconName, 18)}<span>${esc(label)}</span>`);
  b.title = label;
  b.onclick = run;
  return b;
}

async function present(from = 0) {
  finishEditing();
  // The What to say setting is remembered between shows (File > Options).
  coachOn = Boolean((await window.office.settings.get()).coach);
  presentIndex = from;
  document.body.append(presenter);
  presenter.classList.add('on');
  window.office.fullscreen(true);
  showPresented();
  wakeBar();
}
function presentGo(i) {
  if (i >= deck.slides.length) return endPresent();
  presentIndex = Math.max(0, i);
  showPresented();
}
function showPresented() {
  const s = deck.slides[presentIndex];
  presenter.innerHTML = '';
  const frame = h('div', 'present-frame');
  renderSlideInto(frame, s);
  const room = coachOn ? Math.max(160, window.innerHeight * 0.3) : 0;
  const scale = Math.min(window.innerWidth / W, (window.innerHeight - room) / H);
  frame.style.setProperty('--scale', scale);
  frame.style.width = `${W * scale}px`;
  frame.style.height = `${H * scale}px`;
  presenter.classList.toggle('coach-on', coachOn);
  presentBar.innerHTML = '';
  presentBar.append(
    presentBtn('prevSlide', 'Previous', () => presentGo(presentIndex - 1)),
    h('span', 'present-count', `${presentIndex + 1} / ${deck.slides.length}`),
    presentBtn('nextSlide', 'Next', () => presentGo(presentIndex + 1)),
    h('span', 'present-sep'),
  );
  const coachBtn = presentBtn('sparkle', `What to say: ${coachOn ? 'On' : 'Off'}`, toggleCoach);
  coachBtn.classList.toggle('on', coachOn);
  coachBtn.title = `${coachOn ? 'Turn off' : 'Turn on'} the script of what to say for each slide (S)`;
  presentBar.append(coachBtn, h('span', 'present-sep'), presentBtn('close', 'End show', endPresent));
  presenter.append(frame);
  if (coachOn) presenter.append(coach);
  presenter.append(presentBar);
  if (coachOn) showScript();
}
function endPresent() {
  presenter.classList.remove('on');
  presenter.remove();
  window.office.fullscreen(false);
  cancelScript();
  go(Math.min(presentIndex, deck.slides.length - 1));
}
function wakeBar() {
  presenter.classList.add('show-bar');
  clearTimeout(barTimer);
  barTimer = setTimeout(() => presenter.classList.remove('show-bar'), 2500);
}
presenter.addEventListener('mousemove', wakeBar);
presenter.addEventListener('click', () => presentGo(presentIndex + 1));

function toggleCoach() {
  coachOn = !coachOn;
  window.office.settings.set({ coach: coachOn });
  if (!coachOn) cancelScript();
  showPresented();
}

function slideOutline(s, i) {
  const parts = s.elements.filter((e) => e.type !== 'image').map((e) => `  [${e.role || e.type}] ${plainText(e) || '(empty)'}`);
  if (s.elements.some((e) => e.type === 'image')) parts.push('  [image]');
  return `Slide ${i + 1} (${LAYOUTS[s.layout]?.label || s.layout})\n${parts.join('\n')}${s.notes ? `\n  [notes] ${s.notes}` : ''}`;
}
const slideKey = (i) => `${i}|${slideOutline(deck.slides[i], i)}`;

function cancelScript() {
  if (scriptRun) window.office.claude.cancel(scriptRun.id);
  scriptRun = null;
}

async function showScript() {
  const i = presentIndex;
  const key = slideKey(i);
  const head = h('div', 'coach-head', `${icon('sparkle', 16)}<b>What to say</b><span>Slide ${i + 1} of ${deck.slides.length}</span>`);
  const again = h('button', 'present-btn small', `${icon('replace', 14)}<span>Rewrite</span>`);
  again.onclick = () => {
    scripts.delete(key);
    if (scriptRun?.key === key) cancelScript();
    showScript();
  };
  head.append(again);
  const body = h('div', 'coach-body');
  coach.innerHTML = '';
  coach.append(head, body);
  const paint = () => {
    if (presentIndex !== i || !coachOn) return;
    const st = scripts.get(key);
    if (!st) return;
    if (st.error) body.innerHTML = `<div class="coach-error">${esc(st.error)}</div>`;
    else if (!st.text) body.innerHTML = '<span class="coach-wait">Claude is reading this slide…</span>';
    else body.innerHTML = markdownToHtml(st.text);
  };
  if (scripts.has(key) && !scripts.get(key).error) return paint();
  if (scriptRun && scriptRun.key !== key) cancelScript();
  if (scriptRun?.key === key) return paint();

  const settings = await window.office.settings.get();
  if (!settings.ready) {
    body.innerHTML = `<div class="coach-error">${settings.providerLabel} isn’t connected yet. End the show and add your API key in File &gt; Options.</div>`;
    return;
  }
  const st = { text: '', done: false, error: null };
  scripts.set(key, st);
  paint();
  const id = `script-${Date.now()}-${i}`;
  scriptRun = { id, key };
  const outline = deck.slides.map((s, n) => slideOutline(s, n)).join('\n\n');
  window.office.claude.stream(id, {
    system: [
      'You are Claude, helping someone give a live presentation in Present.',
      'Write what the presenter should say out loud for the slide on screen: natural, spoken sentences in the first person, as if talking to the audience.',
      'Explain what is on the slide rather than reading it word for word, and add a smooth handoff to the next slide when there is one.',
      'If the slide has speaker notes, build on them. Keep it under 120 words. Plain Markdown paragraphs; use bold for the key phrase to stress. No headings, no preamble.',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: `<presentation name="${shell.state.name}" slides="${deck.slides.length}">\n${outline}\n</presentation>\n\nWrite what I should say for slide ${i + 1}.`,
    }],
    maxTokens: 1024,
  }, (evt) => {
    if (evt.type === 'text') {
      st.text += evt.text;
      paint();
      return;
    }
    if (scriptRun?.id === id) scriptRun = null;
    if (evt.type === 'error') st.error = evt.message;
    else if (!st.text) scripts.delete(key);
    st.done = true;
    paint();
  });
}

window.addEventListener('resize', () => {
  if (presenter.classList.contains('on')) showPresented();
});

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (presenter.classList.contains('on')) {
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter', 'n'].includes(e.key)) presentGo(presentIndex + 1);
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace', 'p'].includes(e.key)) presentGo(presentIndex - 1);
    else if (e.key.toLowerCase() === 's') toggleCoach();
    else if (e.key === 'Escape') endPresent();
    e.preventDefault();
    return;
  }
  if (e.key === 'F5') {
    e.preventDefault();
    present(e.shiftKey ? current : 0);
    return;
  }
  if (e.target.closest?.('input, textarea, select, .claude-host, .modal')) return;
  if (editingId) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEditing();
    }
    if (mod && ['z', 'y'].includes(e.key.toLowerCase())) return;
    return;
  }
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
    else if (k === 'y') { e.preventDefault(); redo(); }
    else if (k === 'm') { e.preventDefault(); addSlide(); }
    else if (k === 'd') { e.preventDefault(); if (selected) duplicateElement(); else duplicateSlide(); }
    else if (k === 'b') { e.preventDefault(); format('bold', 'bold'); }
    else if (k === 'i') { e.preventDefault(); format('italic', 'italic'); }
    return;
  }
  const el = selectedEl();
  if (el) {
    const step = e.shiftKey ? 10 : 1;
    const nudge = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (nudge) {
      e.preventDefault();
      snapshot();
      el.x += nudge[0];
      el.y += nudge[1];
      renderStage();
      updateThumb();
      return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      deleteSelected();
      return;
    }
    if (e.key === 'Escape') {
      selected = null;
      renderStage();
      return;
    }
    if (e.key === 'Enter' || e.key === 'F2') {
      e.preventDefault();
      startEditing(el.id);
      return;
    }
    return;
  }
  if (['ArrowDown', 'PageDown', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    go(current + 1);
  } else if (['ArrowUp', 'PageUp', 'ArrowLeft'].includes(e.key)) {
    e.preventDefault();
    go(current - 1);
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && document.activeElement === thumbs) {
    e.preventDefault();
    deleteSlide();
  }
});

function duplicateElement() {
  const el = selectedEl();
  if (!el) return;
  snapshot();
  const copy = { ...JSON.parse(JSON.stringify(el)), id: nid(), x: el.x + 20, y: el.y + 20 };
  slide().elements.push(copy);
  selected = copy.id;
  renderStage();
  updateThumb();
}

// ---------- status ----------
const statText = h('span');
function updateStatus() {
  statText.textContent = `Slide ${current + 1} of ${deck.slides.length}`;
}

// ---------- export helpers ----------
function htmlToParagraphs(html, base) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  const paras = [];
  let cur = null;
  const open = (align) => {
    cur = { align: align || base.align, bullet: base.bullets ? true : undefined, runs: [] };
    paras.push(cur);
  };
  const walk = (node, fmt) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        if (!child.textContent) continue;
        if (!cur) open();
        cur.runs.push({ text: child.textContent, ...fmt });
      } else if (child.nodeType === 1) {
        const tag = child.tagName.toLowerCase();
        if (tag === 'br') {
          open();
          continue;
        }
        const next = { ...fmt };
        if (tag === 'b' || tag === 'strong' || /bold|[6-9]00/.test(child.style.fontWeight)) next.bold = true;
        if (tag === 'i' || tag === 'em' || child.style.fontStyle === 'italic') next.italic = true;
        if (tag === 'u' || /underline/.test(child.style.textDecoration)) next.underline = true;
        if (child.style.color) next.color = child.style.color;
        if (child.getAttribute('color')) next.color = child.getAttribute('color');
        const block = ['div', 'p', 'li', 'h1', 'h2', 'h3'].includes(tag);
        if (block) open(child.style.textAlign || undefined);
        walk(child, next);
        if (block) cur = null;
      }
    }
  };
  walk(div, { bold: base.bold, italic: base.italic });
  return paras.filter((p, i) => p.runs.length || i < paras.length - 1);
}

// Resolve theme colours and flatten text so the main process can write .pptx.
function exportModel() {
  const t = theme();
  return {
    ...JSON.parse(JSON.stringify(deck)),
    themeColors: t,
    slides: deck.slides.map((s) => {
      const els = [];
      if (t.band && s.layout !== 'title') els.push({ type: 'shape', shape: 'rect', x: 0, y: 0, w: 14, h: H, style: { fill: t.accent } });
      if (s.layout === 'title' || s.layout === 'section') els.push({ type: 'shape', shape: 'rect', x: s.layout === 'title' ? 430 : 80, y: s.layout === 'title' ? 288 : 290, w: 100, h: 4, style: { fill: t.accent } });
      for (const el of s.elements) {
        if (el.type === 'text' && !el.html) continue;
        const style = { ...el.style, color: el.type === 'shape' && !el.style?.color ? '#ffffff' : elementColor(el), fill: el.type === 'shape' ? el.style?.fill || t.accent : el.style?.fill, fontFamily: el.style?.fontFamily || t.font };
        if (el.role === 'title' && style.bold === undefined) style.bold = true;
        els.push({ ...el, style, paragraphs: el.type === 'image' ? undefined : htmlToParagraphs(el.html, style) });
      }
      return { ...s, bg: s.bg || t.bg, elements: els };
    }),
  };
}

function plainText(el) {
  const d = document.createElement('div');
  d.innerHTML = (el.html || '').replace(/<(div|p|br|li)[^>]*>/gi, '\n$&');
  return d.textContent.trim();
}

function deckOutline() {
  return deck.slides.map((s, i) => slideOutline(s, i).replace(/\n/, i === current ? ' ← current\n' : '\n')).join('\n\n');
}

const esc = (s) => escapeHtml(s);
const bulletsHtml = (items) => (items || []).filter(Boolean).map((b) => `<div>${esc(b)}</div>`).join('');

function slideFromSpec(spec) {
  const layout = LAYOUTS[spec.layout] ? spec.layout : 'content';
  const s = newSlide(layout);
  const [title, second, third] = s.elements;
  if (title) title.html = esc(spec.title || '');
  if (second) second.html = layout === 'content' || layout === 'two' ? bulletsHtml(spec.bullets) : esc(spec.subtitle || '');
  if (third) third.html = bulletsHtml(spec.right_bullets);
  s.notes = spec.notes || '';
  return s;
}

function applyDeck(spec, mode) {
  finishEditing();
  snapshot();
  const slides = spec.slides.map(slideFromSpec);
  if (mode === 'replace') {
    deck.slides = slides;
    current = 0;
  } else {
    deck.slides.splice(current + 1, 0, ...slides);
    current += 1;
  }
  if (mode === 'replace' && spec.title && /^Presentation\d*$/.test(shell.state.name)) {
    shell.state.name = spec.title.slice(0, 60);
    shell.setTitle();
  }
  selected = null;
  renderAll();
}

const SLIDE_SPEC = {
  type: 'object',
  properties: {
    layout: { type: 'string', enum: ['title', 'content', 'section', 'two'] },
    title: { type: 'string' },
    subtitle: { type: 'string' },
    bullets: { type: 'array', items: { type: 'string' } },
    right_bullets: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['layout', 'title', 'subtitle', 'bullets', 'right_bullets', 'notes'],
  additionalProperties: false,
};
const DECK_SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' }, slides: { type: 'array', items: SLIDE_SPEC } },
  required: ['title', 'slides'],
  additionalProperties: false,
};
const NOTES_SCHEMA = {
  type: 'object',
  properties: { notes: { type: 'array', items: { type: 'string' } } },
  required: ['notes'],
  additionalProperties: false,
};

const QUICK = {
  deck: {
    label: 'Create a presentation', icon: 'wand', input: 'What is the presentation about? Add audience and length if you like…',
    prompt: 'Create a complete presentation. Start with a "title" slide, use "section" slides to separate major parts when it helps, and "content" slides with 3–5 short bullets (under 12 words each) for the rest. Use "two" for comparisons. Leave unused fields empty. Write speaker notes of 2–4 sentences for every slide. Topic:',
    format: DECK_SCHEMA, working: 'Writing your slides', maxTokens: 32000,
    summary: (d) => `**${d.title}** — ${d.slides.length} slides:\n\n${d.slides.map((s, i) => `${i + 1}. ${s.title}`).join('\n')}`,
    actions: (d) => [
      { label: 'Replace presentation', icon: 'replace', run: () => applyDeck(d, 'replace') },
      { label: 'Add after current slide', icon: 'slideNew', run: () => applyDeck(d, 'append') },
    ],
  },
  improve: {
    label: 'Improve this slide', icon: 'wand',
    prompt: 'Rewrite the current slide so it is clearer and more compelling. Keep the same topic. Keep bullets short (under 12 words). Leave unused fields empty and include speaker notes.',
    format: SLIDE_SPEC, working: 'Improving the slide',
    summary: (d) => `**${d.title}**\n\n${[...d.bullets, ...d.right_bullets].map((b) => `- ${b}`).join('\n')}`,
    actions: (d) => [{ label: 'Apply to this slide', icon: 'proofread', run: () => { finishEditing(); snapshot(); const keep = slide().elements.filter((e) => !(e.type === 'text' && e.role)); const s = slideFromSpec(d); s.elements.push(...keep); deck.slides[current] = s; renderAll(); } }],
  },
  notes: {
    label: 'Write speaker notes', icon: 'notes',
    prompt: 'Write speaker notes for every slide: 2–4 natural sentences each that a presenter can say out loud. Return one entry per slide, in order.',
    format: NOTES_SCHEMA, working: 'Writing notes',
    summary: (d) => `Speaker notes for ${d.notes.length} slides are ready.`,
    actions: (d) => [{ label: 'Add notes to slides', icon: 'notes', run: () => { snapshot(); d.notes.forEach((n, i) => { if (deck.slides[i]) deck.slides[i].notes = n; }); renderAll(); } }],
  },
  next: {
    label: 'Suggest the next slide', icon: 'slideNew',
    prompt: 'Suggest the single most useful slide to add after the current one, given the flow of the presentation. Leave unused fields empty.',
    format: SLIDE_SPEC, working: 'Thinking about the flow',
    summary: (d) => `**${d.title}**\n\n${[...d.bullets, ...d.right_bullets].map((b) => `- ${b}`).join('\n')}`,
    actions: (d) => [{ label: 'Insert slide', icon: 'slideNew', run: () => applyDeck({ slides: [d] }, 'append') }],
  },
};

// ---------- ribbon ----------
const layoutItems = () => Object.entries(LAYOUTS).map(([id, l]) => ({ label: l.label, icon: 'layout', run: () => addSlide(id) }));
const elStyle = (k) => () => !!selectedEl()?.style?.[k];
const elAlign = (a) => () => (selectedEl()?.style?.align || 'left') === a && !!selectedEl();

const homeTab = {
  id: 'home',
  label: 'Home',
  groups: [
    { label: 'Clipboard', items: [
      { type: 'big', icon: 'paste', label: 'Paste', run: () => document.execCommand('paste') || toast('Use Ctrl+V to paste') },
      { type: 'stack', items: [
        { type: 'small', icon: 'copy', label: 'Duplicate', run: () => (selected ? duplicateElement() : duplicateSlide()) },
        { type: 'small', icon: 'trash', label: 'Delete', run: () => (selected ? deleteSelected() : deleteSlide()) },
      ] },
    ] },
    { label: 'Slides', items: [
      { type: 'big', icon: 'slideNew', label: 'New Slide', shortcut: 'Ctrl+M', run: () => addSlide('content') },
      { type: 'stack', items: [
        { type: 'menu', icon: 'layout', label: 'Layout', items: () => Object.entries(LAYOUTS).map(([id, l]) => ({ label: l.label, icon: 'layout', run: () => changeLayout(id) })) },
        { type: 'small', icon: 'duplicate', label: 'Duplicate slide', run: duplicateSlide },
        { type: 'small', icon: 'trash', label: 'Delete slide', run: deleteSlide },
      ] },
    ] },
    { label: 'Font', items: [
      { type: 'row', items: [
        { type: 'select', title: 'Font size', width: 60, options: [12, 14, 16, 18, 20, 24, 28, 32, 36, 40, 44, 54, 66, 80, 96].map((n) => ({ value: String(n), label: String(n) })), value: () => String(selectedEl()?.style?.fontSize || ''), change: (v) => setStyle({ fontSize: Number(v) }) },
      ] },
      { type: 'row', items: [
        { type: 'text', text: 'B', style: 'font-weight:700', title: 'Bold', shortcut: 'Ctrl+B', run: () => format('bold', 'bold'), active: elStyle('bold') },
        { type: 'text', text: 'I', style: 'font-style:italic', title: 'Italic', shortcut: 'Ctrl+I', run: () => format('italic', 'italic'), active: elStyle('italic') },
        { type: 'text', text: 'U', style: 'text-decoration:underline', title: 'Underline', run: () => format('underline', 'underline') },
        { type: 'color', icon: 'color', title: 'Font color', initial: '#c0392b', allowNone: true, pick: (c) => (editingId ? format('foreColor', 'color', c || theme().text) : setStyle({ color: c })) },
      ] },
    ] },
    { label: 'Paragraph', items: [
      { type: 'row', items: [
        { type: 'icon', icon: 'bullets', title: 'Bullets', run: () => setStyle({ bullets: !selectedEl()?.style?.bullets }), active: elStyle('bullets') },
      ] },
      { type: 'row', items: [
        { type: 'icon', icon: 'alignLeft', title: 'Align left', run: () => setStyle({ align: 'left' }), active: elAlign('left') },
        { type: 'icon', icon: 'alignCenter', title: 'Center', run: () => setStyle({ align: 'center' }), active: elAlign('center') },
        { type: 'icon', icon: 'alignRight', title: 'Align right', run: () => setStyle({ align: 'right' }), active: elAlign('right') },
      ] },
    ] },
    { label: 'Drawing', items: [
      { type: 'menu', big: true, icon: 'shape', label: 'Shapes', items: [
        { label: 'Rectangle', icon: 'rect', run: () => addShape('rect') },
        { label: 'Rounded rectangle', icon: 'rect', run: () => addShape('roundRect') },
        { label: 'Oval', icon: 'ellipse', run: () => addShape('ellipse') },
        { label: 'Triangle', icon: 'triangle', run: () => addShape('triangle') },
        { label: 'Arrow', icon: 'arrow', run: () => addShape('arrow') },
      ] },
      { type: 'stack', items: [
        { type: 'color', icon: 'fill', title: 'Shape fill', initial: '#1c64c4', allowNone: true, pick: (c) => setStyle({ fill: c }) },
        { type: 'small', icon: 'front', label: 'Bring to front', run: () => arrange(1) },
        { type: 'small', icon: 'backward', label: 'Send to back', run: () => arrange(-1) },
      ] },
    ] },
    { label: 'Claude', items: [{ type: 'big', icon: 'sparkle', label: 'Ask Claude', title: 'Open Claude (Ctrl+J)', run: () => shell.claude.toggle() }] },
  ],
};

const insertTab = {
  id: 'insert',
  label: 'Insert',
  groups: [
    { label: 'Slides', items: [{ type: 'menu', big: true, icon: 'slideNew', label: 'New Slide', items: layoutItems }] },
    { label: 'Images', items: [{ type: 'big', icon: 'image', label: 'Pictures', run: addImage }] },
    { label: 'Illustrations', items: [
      { type: 'big', icon: 'rect', label: 'Rectangle', run: () => addShape('rect') },
      { type: 'big', icon: 'ellipse', label: 'Oval', run: () => addShape('ellipse') },
      { type: 'big', icon: 'arrow', label: 'Arrow', run: () => addShape('arrow') },
    ] },
    { label: 'Text', items: [{ type: 'big', icon: 'textbox', label: 'Text Box', run: addTextBox }] },
  ],
};

const designTab = {
  id: 'design',
  label: 'Design',
  groups: [
    { label: 'Themes', items: [{ type: 'gallery', items: Object.entries(THEMES).map(([id, t]) => ({
      label: t.label,
      html: `<span class="theme-tile" style="background:${t.bg};color:${t.title};font-family:${t.font}"><b>Aa</b><i style="background:${t.accent}"></i></span><small>${t.label}</small>`,
      run: () => setTheme(id),
      active: () => deck.theme === id,
    })) }] },
    { label: 'Customize', items: [
      { type: 'color', icon: 'background', title: 'Slide background', initial: '#fff4e6', allowNone: true, pick: (c) => setBackground(c) },
    ] },
    { label: 'Designer', items: [{ type: 'big', icon: 'wand', label: 'Improve Slide', run: () => shell.claude.runQuick(QUICK.improve) }] },
  ],
};

const showTab = {
  id: 'show',
  label: 'Slide Show',
  groups: [
    { label: 'Start Slide Show', items: [
      { type: 'big', icon: 'play', label: 'From Beginning', shortcut: 'F5', run: () => present(0) },
      { type: 'big', icon: 'playCurrent', label: 'From Current Slide', shortcut: 'Shift+F5', run: () => present(current) },
    ] },
    { label: 'Notes', items: [{ type: 'big', icon: 'notes', label: 'Write Speaker Notes', run: () => shell.claude.runQuick(QUICK.notes) }] },
    { label: 'Presenter', items: [{ type: 'big', icon: 'sparkle', label: 'What to say On/Off', run: async () => {
      const on = !(await window.office.settings.get()).coach;
      await window.office.settings.set({ coach: on });
      shell.toast(on ? 'What to say is on: each slide gets a script at the bottom during the show' : 'What to say is off');
    } }] },
  ],
};

const viewTab = {
  id: 'view',
  label: 'View',
  groups: [
    { label: 'Show', items: [
      { type: 'big', icon: 'notes', label: 'Notes', run: () => root.classList.toggle('hide-notes'), active: () => !root.classList.contains('hide-notes') },
    ] },
    { label: 'Arrange', items: [
      { type: 'big', icon: 'up', label: 'Move Slide Up', run: () => moveSlide(-1) },
      { type: 'big', icon: 'down', label: 'Move Slide Down', run: () => moveSlide(1) },
    ] },
  ],
};

const claudeTab = {
  id: 'claude',
  label: 'Claude',
  special: true,
  groups: [
    { label: 'Create', items: [
      { type: 'big', icon: 'wand', label: 'Create Presentation', run: () => shell.claude.runQuick(QUICK.deck) },
      { type: 'big', icon: 'slideNew', label: 'Suggest Next Slide', run: () => shell.claude.runQuick(QUICK.next) },
    ] },
    { label: 'Refine', items: [
      { type: 'big', icon: 'wand', label: 'Improve Slide', run: () => shell.claude.runQuick(QUICK.improve) },
      { type: 'big', icon: 'notes', label: 'Speaker Notes', run: () => shell.claude.runQuick(QUICK.notes) },
    ] },
    { label: 'Chat', items: [{ type: 'big', icon: 'chat', label: 'Open Claude', run: () => shell.claude.toggle() }] },
  ],
};

const shell = await createShell({
  app: 'slides',
  defaultExt: 'reaslides',
  tabs: [homeTab, insertTab, designTab, showTab, viewTab],
  claudeTab,
  undo,
  redo,
  getSaveData: () => {
    finishEditing();
    return { format: 'rea-slides', version: 1, theme: deck.theme, slides: deck.slides, export: exportModel() };
  },
  exports: [{ label: 'PowerPoint presentation (.pptx)', detail: 'Opens in PowerPoint, Keynote and Google Slides.', icon: 'play', ext: 'pptx' }],
  pdfOptions: () => ({ pageSize: { width: 10, height: 5.625 } }),
  beforePrint: () => {
    finishEditing();
    printDeck.innerHTML = '';
    for (const s of deck.slides) {
      const page = h('div', 'print-page');
      renderSlideInto(page, s);
      printDeck.append(page);
    }
    document.body.append(printDeck);
  },
  afterPrint: () => printDeck.remove(),
  claude: {
    intro: 'I can write a whole presentation from a topic, improve a slide, suggest what comes next, or write speaker notes.',
    placeholder: 'Ask Claude about this presentation…',
    system: [
      'You are Claude, built into Present, a presentation app. The deck outline is provided, with the current slide marked.',
      'Slides should be concise: short titles, a few short bullets, and the detail in speaker notes.',
      'When answering free-form questions, be brief and use Markdown.',
    ].join('\n'),
    context: () => `<presentation name="${shell.state.name}" theme="${theme().label}" slides="${deck.slides.length}">\n${deckOutline()}\n</presentation>`,
    quick: [QUICK.deck, QUICK.improve, QUICK.next, QUICK.notes],
    actions: (t) => [{ label: 'Add as speaker notes', icon: 'notes', run: () => { snapshot(); slide().notes = (slide().notes ? `${slide().notes}\n\n` : '') + t; notes.value = slide().notes; } }],
  },
});

shell.workspace.append(root);
shell.statusLeft.append(statText);
const notesBtn = h('button', 'status-btn', 'Notes');
notesBtn.onclick = () => root.classList.toggle('hide-notes');
const playBtn = h('button', 'status-btn', 'Slide Show');
playBtn.onclick = () => present(current);
shell.statusRight.append(notesBtn, playBtn);

if (shell.info.file?.data?.deckSpec) {
  // Made by Claude in the Claude app.
  const d = shell.info.file.data;
  deck = { theme: THEMES[d.theme] ? d.theme : 'paper', slides: d.deckSpec.slides.map(slideFromSpec) };
  if (!deck.slides.length) deck.slides.push(newSlide('title'));
} else if (shell.info.file?.data?.slides) {
  const d = shell.info.file.data;
  deck = { theme: THEMES[d.theme] ? d.theme : 'paper', slides: d.slides.map((s) => ({ ...s, elements: (s.elements || []).filter((e) => !(e.type === 'shape' && !e.id)) })) };
  if (!deck.slides.length) deck.slides.push(newSlide('title'));
}
renderAll();
if (shell.info.file?.generated) shell.markDirty();
