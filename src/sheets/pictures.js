// Pictures and charts that float over Plot's grid, as spreadsheet files carry
// them: each one is anchored to a cell with an offset, so it moves with its
// cell when columns are resized or rows inserted. Picture data lives in a
// separate media table (keys like "m1") so undo snapshots stay small.

import { h } from '../shared/shell.js';
import { icon } from '../shared/icons.js';
import { closePopup, popup } from '../shared/ribbon.js';

const MAX_INSERT = 480;

export function createPictures({ layer, sheet, cellBox, cellAtPoint, snapshot, zoom, onChange }) {
  const media = {};
  const box = h('div', 'pic-layer');
  layer.append(box);
  let selected = null;
  let drag = null;

  const list = () => sheet().images || [];
  const find = (id) => list().find((p) => p.id === id);

  function render() {
    box.innerHTML = '';
    for (const p of list()) {
      const a = cellBox(p.row, p.col);
      if (!a) continue;
      const el = h('div', `sheet-pic${p.chart ? ' chart' : ''}${p.id === selected ? ' on' : ''}`);
      el.dataset.id = p.id;
      Object.assign(el.style, { left: `${a.x + (p.dx || 0)}px`, top: `${a.y + (p.dy || 0)}px`, width: `${p.w}px`, height: `${p.h}px` });
      const src = media[p.media] || p.url;
      if (src) {
        const img = h('img');
        img.src = src;
        img.alt = p.name || '';
        img.draggable = false;
        el.append(img);
      } else {
        el.classList.add('missing');
        el.textContent = p.name || 'Picture';
      }
      if (p.name) el.title = p.name;
      el.append(h('span', 'pic-handle'));
      box.append(el);
    }
  }

  function select(id) {
    selected = id;
    box.querySelectorAll('.sheet-pic').forEach((n) => n.classList.toggle('on', n.dataset.id === id));
  }

  function remove(id = selected) {
    if (!id || !find(id)) return;
    snapshot();
    sheet().images = list().filter((p) => p.id !== id);
    if (!sheet().images.length) delete sheet().images;
    selected = null;
    render();
    onChange();
  }

  function restack(id, toFront) {
    const p = find(id);
    if (!p) return;
    snapshot();
    const rest = list().filter((q) => q !== p);
    sheet().images = toFront ? [...rest, p] : [p, ...rest];
    render();
    onChange();
  }

  // Re-anchors a picture to whatever cell its top-left corner now sits in.
  function anchorAt(p, x, y) {
    const c = cellAtPoint(Math.max(0, x), Math.max(0, y));
    const a = cellBox(c.row, c.col);
    Object.assign(p, { row: c.row, col: c.col, dx: Math.round(Math.max(0, x) - a.x), dy: Math.round(Math.max(0, y) - a.y) });
  }

  const nextId = () => {
    const used = new Set(list().map((p) => p.id));
    let i = used.size + 1;
    while (used.has(`p${i}`)) i += 1;
    return `p${i}`;
  };
  const addMedia = (src) => {
    const found = Object.entries(media).find(([, v]) => v === src);
    if (found) return found[0];
    let i = Object.keys(media).length + 1;
    while (media[`m${i}`]) i += 1;
    media[`m${i}`] = src;
    return `m${i}`;
  };

  function insert(src, at, name = '') {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, MAX_INSERT / Math.max(img.naturalWidth, img.naturalHeight, 1));
      snapshot();
      const p = { id: nextId(), media: addMedia(src), row: at.row, col: at.col, dx: 0, dy: 0, w: Math.max(8, Math.round(img.naturalWidth * k)), h: Math.max(8, Math.round(img.naturalHeight * k)), ...(name ? { name } : {}) };
      sheet().images = [...list(), p];
      selected = p.id;
      render();
      onChange();
    };
    img.src = src;
  }

  function insertFile(file, at) {
    if (!file || !/^image\//.test(file.type)) return false;
    const reader = new FileReader();
    reader.onload = () => insert(String(reader.result), at, file.name || '');
    reader.readAsDataURL(file);
    return true;
  }

  function pickFile(at) {
    const input = h('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml';
    input.onchange = () => insertFile(input.files?.[0], at);
    input.click();
  }

  function menu(id, x, y) {
    const m = h('div', 'rb-menu');
    const item = (label, ic, run) => {
      const b = h('button', 'rb-menu-item', `${icon(ic, 16)}<span>${label}</span>`);
      b.onclick = () => { closePopup(); run(); };
      m.append(b);
    };
    item('Bring to Front', 'front', () => restack(id, true));
    item('Send to Back', 'backward', () => restack(id, false));
    m.append(h('div', 'rb-menu-sep'));
    item(find(id)?.chart ? 'Delete chart' : 'Delete picture', 'trash', () => remove(id));
    popup({ getBoundingClientRect: () => ({ left: x, right: x, top: y, bottom: y }) }, m);
  }

  box.addEventListener('mousedown', (e) => {
    const el = e.target.closest('.sheet-pic');
    if (!el || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    layer.closest('.grid-scroll')?.focus({ preventScroll: true });
    select(el.dataset.id);
    const p = find(el.dataset.id);
    drag = { p, el, x: e.clientX, y: e.clientY, left: el.offsetLeft, top: el.offsetTop, w: p.w, h: p.h, resize: e.target.classList.contains('pic-handle'), moved: false };
  });

  box.addEventListener('contextmenu', (e) => {
    const el = e.target.closest('.sheet-pic');
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    select(el.dataset.id);
    menu(el.dataset.id, e.clientX, e.clientY);
  });

  window.addEventListener('mousemove', (e) => {
    if (!drag) return;
    const z = zoom() / 100;
    const dx = (e.clientX - drag.x) / z;
    const dy = (e.clientY - drag.y) / z;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
    if (!drag.moved) {
      snapshot();
      drag.moved = true;
    }
    if (drag.resize) {
      // Pictures keep their shape; Shift resizes freely.
      let w = Math.max(12, drag.w + dx);
      let hh = Math.max(12, drag.h + dy);
      if (!e.shiftKey && drag.w && drag.h) {
        const k = Math.max(w / drag.w, hh / drag.h);
        w = Math.max(12, drag.w * k);
        hh = Math.max(12, drag.h * k);
      }
      drag.p.w = Math.round(w);
      drag.p.h = Math.round(hh);
      Object.assign(drag.el.style, { width: `${drag.p.w}px`, height: `${drag.p.h}px` });
    } else {
      drag.el.style.left = `${Math.max(46, drag.left + dx)}px`;
      drag.el.style.top = `${Math.max(22, drag.top + dy)}px`;
    }
  });

  window.addEventListener('mouseup', () => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) return;
    if (!d.resize) anchorAt(d.p, d.el.offsetLeft, d.el.offsetTop);
    render();
    onChange();
  });

  // Keys while a picture is selected; returns true when handled.
  function onKey(e) {
    if (!selected || !find(selected)) return false;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      remove();
      return true;
    }
    if (e.key === 'Escape') {
      select(null);
      return true;
    }
    if (e.key.startsWith('Arrow')) {
      e.preventDefault();
      const p = find(selected);
      const a = cellBox(p.row, p.col);
      const step = e.shiftKey ? 10 : 1;
      snapshot();
      anchorAt(p, a.x + p.dx + (e.key === 'ArrowRight' ? step : e.key === 'ArrowLeft' ? -step : 0), a.y + p.dy + (e.key === 'ArrowDown' ? step : e.key === 'ArrowUp' ? -step : 0));
      render();
      onChange();
      return true;
    }
    select(null);
    return false;
  }

  // PNG, JPEG and GIF go into .xlsx as they are; charts (SVG) and other kinds are drawn to PNG.
  const pngCache = new Map();
  async function savable(key) {
    const src = media[key];
    if (!src || /^data:image\/(png|jpeg|gif);/.test(src)) return src;
    if (pngCache.has(src)) return pngCache.get(src);
    const png = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const scale = /svg/.test(src) ? 2 : 1;
        const w = Math.max(1, Math.round((img.naturalWidth || 300) * scale));
        const hh = Math.max(1, Math.round((img.naturalHeight || 150) * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = hh;
        canvas.getContext('2d').drawImage(img, 0, 0, w, hh);
        resolve(canvas.toDataURL('image/png'));
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
    pngCache.set(src, png);
    return png;
  }

  async function mediaForSave(sheets) {
    const keys = new Set();
    for (const s of sheets) {
      for (const p of s.images || []) if (p.media) keys.add(p.media);
      for (const c of Object.values(s.cells || {})) if (c.img) keys.add(c.img);
    }
    const out = {};
    for (const k of keys) {
      const v = await savable(k);
      if (v) out[k] = v;
    }
    return out;
  }

  return {
    media,
    render,
    select,
    remove,
    insertFile,
    pickFile,
    onKey,
    mediaForSave,
    get selected() { return selected; },
    load(m) {
      for (const k of Object.keys(media)) delete media[k];
      Object.assign(media, m || {});
    },
  };
}
