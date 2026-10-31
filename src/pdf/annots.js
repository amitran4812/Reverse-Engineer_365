// Draws annotations over each page and runs the tools that make and change
// them: pen, shapes, sticky notes, text boxes, placing signatures, and
// selecting, moving and resizing what is already there.

import { h } from '../shared/shell.js';
import { CSS_PER_PT } from './viewer.js';
import { MARKUPS, RECT_TYPES, bounds, mergeLineRects, moveAnnot, newId, normRect, thinPath } from './annot-data.js';

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => {
  const e = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  return e;
};

export const DRAW_TOOLS = ['ink', 'rect', 'ellipse', 'line', 'arrow', 'note', 'text', 'place', 'eraser'];

export class AnnotLayer {
  // ctx: { annots(), commit(fn), tool(), style(), author(), onSelect(a), onEditNote(a), setTool(t), pending() }
  constructor(reader, ctx) {
    this.reader = reader;
    this.ctx = ctx;
    this.selected = null;
  }

  // Called for every page as it is laid out (and again when the view rotates).
  attach(p) {
    p.svg?.remove();
    p.svg = s('svg', { class: 'rd-annots', viewBox: `0 0 ${p.w} ${p.hgt}`, preserveAspectRatio: 'none' });
    p.hits?.remove();
    p.hits = h('div', 'rd-hits');
    p.layers.append(p.hits, p.svg);
    p.svg.addEventListener('pointerdown', (e) => this.down(p, e));
    p.svg.addEventListener('dblclick', (e) => {
      const g = e.target.closest?.('[data-id]');
      const a = g && this.find(g.dataset.id);
      if (a?.type === 'text') this.editText(p, a);
      else if (a) this.ctx.onEditNote(a);
    });
    this.render(p.index);
  }

  find(id) {
    return this.ctx.annots().find((a) => a.id === id);
  }

  setActive(active, cursor) {
    for (const p of this.reader.pages) {
      p.svg?.classList.toggle('active', active);
      if (p.svg) p.svg.style.cursor = cursor || '';
    }
  }

  renderAll() {
    for (const p of this.reader.pages) this.render(p.index);
  }

  render(index) {
    const p = this.reader.pages[index];
    if (!p?.svg) return;
    p.svg.replaceChildren();
    for (const a of this.ctx.annots()) if (a.page === index) p.svg.append(this.shape(p, a));
    const sel = this.selected && this.find(this.selected);
    if (sel?.page === index) p.svg.append(this.selection(p, sel));
  }

  shape(p, a) {
    const R = this.reader;
    const g = s('g', { 'data-id': a.id, class: `an an-${a.type}`, opacity: a.type === 'highlight' ? null : a.opacity ?? 1 });
    const w = a.width || 1;
    const stroke = { stroke: a.color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' };
    const hit = (el) => {
      const c = el.cloneNode();
      c.setAttribute('class', 'hit');
      c.setAttribute('stroke-width', Math.max(8, w + 6));
      c.setAttribute('stroke', 'transparent');
      c.setAttribute('fill', 'none');
      g.append(c);
    };
    switch (a.type) {
      case 'highlight':
      case 'underline':
      case 'strike':
        for (const r of a.rects) {
          if (a.type === 'highlight') {
            const [x0, y0, x1, y1] = R.viewRect(p, r);
            g.append(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: a.color, 'fill-opacity': a.opacity ?? 0.45, class: 'hl' }));
          } else {
            const hgt = r[3] - r[1];
            const y = a.type === 'underline' ? r[1] + hgt * 0.1 : r[1] + hgt * 0.45;
            const [ax, ay] = R.toView(p, r[0], y);
            const [bx, by] = R.toView(p, r[2], y);
            g.append(s('line', { x1: ax, y1: ay, x2: bx, y2: by, stroke: a.color, 'stroke-width': Math.max(0.6, hgt * 0.07) }));
            const [x0, y0, x1, y1] = R.viewRect(p, r);
            g.append(s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'transparent', class: 'hit' }));
          }
        }
        break;
      case 'ink':
        for (const path of a.paths) {
          const pts = [];
          for (let i = 0; i + 1 < path.length; i += 2) pts.push(R.toView(p, path[i], path[i + 1]));
          const el = s('path', { d: pts.length === 1 ? `M${pts[0][0]} ${pts[0][1]}h.01` : `M${pts.map((q) => q.join(' ')).join('L')}`, ...stroke });
          g.append(el);
          hit(el);
        }
        break;
      case 'rect':
      case 'ellipse': {
        const [x0, y0, x1, y1] = R.viewRect(p, a.rect);
        const el = a.type === 'rect'
          ? s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, ...stroke, fill: a.fill || 'none' })
          : s('ellipse', { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2, ...stroke, fill: a.fill || 'none' });
        g.append(el);
        hit(el);
        break;
      }
      case 'line':
      case 'arrow': {
        const [ax, ay] = R.toView(p, a.line[0], a.line[1]);
        const [bx, by] = R.toView(p, a.line[2], a.line[3]);
        const el = s('line', { x1: ax, y1: ay, x2: bx, y2: by, ...stroke });
        g.append(el);
        hit(el);
        if (a.type === 'arrow') {
          const len = Math.max(6, w * 4);
          const ang = Math.atan2(by - ay, bx - ax);
          const pt = (d) => `${bx - len * Math.cos(ang + d)} ${by - len * Math.sin(ang + d)}`;
          g.append(s('path', { d: `M${pt(0.45)}L${bx} ${by}L${pt(-0.45)}`, ...stroke }));
        }
        break;
      }
      case 'note': {
        const [x0, y0] = R.viewRect(p, bounds(a));
        const icon = s('g', { transform: `translate(${x0} ${y0})`, class: 'note-icon' });
        icon.append(
          s('path', { d: 'M2 2h16v12H9l-4 4v-4H2z', fill: a.color, stroke: '#3f3f3f', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }),
          s('path', { d: 'M5 6h10M5 10h7', stroke: '#3f3f3f', 'stroke-width': 0.8 }),
        );
        g.append(icon);
        break;
      }
      case 'text':
      case 'image': {
        // Text and pictures stay upright for the page turn they were placed
        // on; if the page is turned later they turn with it.
        const [x0, y0, x1, y1] = R.viewRect(p, a.rect);
        const turn = (((p.rotation - (a.rot || 0)) % 360) + 360) % 360;
        const side = turn === 90 || turn === 270;
        const w = side ? y1 - y0 : x1 - x0;
        const hh = side ? x1 - x0 : y1 - y0;
        const box = s('g', { transform: `translate(${(x0 + x1) / 2} ${(y0 + y1) / 2}) rotate(${turn}) translate(${-w / 2} ${-hh / 2})` });
        if (a.type === 'text') {
          const fo = s('foreignObject', { x: 0, y: 0, width: Math.max(1, w), height: Math.max(1, hh) });
          const div = document.createElement('div');
          div.className = 'an-textbox';
          div.style.cssText = `font-size:${a.size || 12}px;color:${a.color}`;
          div.textContent = a.text || '';
          fo.append(div);
          box.append(fo);
        } else {
          box.append(s('image', { href: a.src, x: 0, y: 0, width: w, height: hh, preserveAspectRatio: 'none' }));
        }
        g.append(box, s('rect', { x: x0, y: y0, width: x1 - x0, height: y1 - y0, fill: 'transparent', class: 'hit' }));
        break;
      }
      default:
    }
    return g;
  }

  selection(p, a) {
    const [x0, y0, x1, y1] = this.reader.viewRect(p, bounds(a));
    const k = 1 / (this.reader.scale * CSS_PER_PT);
    const g = s('g', { class: 'an-sel' });
    g.append(s('rect', { x: x0 - 3 * k, y: y0 - 3 * k, width: x1 - x0 + 6 * k, height: y1 - y0 + 6 * k, 'stroke-width': 1.2 * k, 'stroke-dasharray': `${4 * k} ${3 * k}` }));
    if (RECT_TYPES.includes(a.type)) {
      const hs = 9 * k;
      g.append(s('rect', { class: 'handle', 'data-handle': 'se', x: x1 + 3 * k - hs / 2, y: y1 + 3 * k - hs / 2, width: hs, height: hs, 'stroke-width': 1.2 * k }));
    }
    return g;
  }

  select(id) {
    const before = this.selected && this.find(this.selected);
    this.selected = id;
    if (before) this.render(before.page);
    const a = id && this.find(id);
    if (a) this.render(a.page);
    this.ctx.onSelect(a || null);
  }

  // --- Pointer tools --------------------------------------------------------

  down(p, e) {
    if (e.button !== 0) return;
    const tool = this.ctx.tool();
    const R = this.reader;
    const start = R.clientToView(p, e.clientX, e.clientY);
    const g = e.target.closest?.('[data-id]');
    const target = g && this.find(g.dataset.id);
    const handle = e.target.dataset?.handle;
    if (tool === 'eraser') {
      if (target) this.ctx.commit((list) => list.filter((a) => a.id !== target.id));
      return;
    }
    if (handle) return this.resize(p, e, this.find(this.selected));
    if (!DRAW_TOOLS.includes(tool)) {
      if (target) this.drag(p, e, target, start);
      return;
    }
    e.preventDefault();
    p.svg.setPointerCapture(e.pointerId);
    const st = this.ctx.style();
    const done = (fn) => {
      const up = (ev) => {
        p.svg.removeEventListener('pointermove', move);
        p.svg.removeEventListener('pointerup', up);
        p.svg.removeEventListener('pointercancel', up);
        fn(R.clientToView(p, ev.clientX, ev.clientY));
      };
      let move = () => {};
      p.svg.addEventListener('pointerup', up);
      p.svg.addEventListener('pointercancel', up);
      return (m) => {
        move = (ev) => m(R.clientToView(p, ev.clientX, ev.clientY), ev);
        p.svg.addEventListener('pointermove', move);
      };
    };
    const base = { page: p.index, color: st.color, opacity: st.opacity ?? 1, author: this.ctx.author(), modified: new Date().toISOString(), note: '' };
    if (tool === 'ink') {
      const pts = [start];
      const path = s('path', { stroke: st.color, 'stroke-width': st.width, fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: st.opacity ?? 1 });
      const redraw = () => path.setAttribute('d', `M${pts.map((q) => q.join(' ')).join('L')}${pts.length === 1 ? 'h.01' : ''}`);
      redraw();
      p.svg.append(path);
      done(() => {
        path.remove();
        const flat = thinPath(pts.flatMap(([vx, vy]) => R.toUser(p, vx, vy)), 0.6);
        // Strokes made one after another join into one drawing.
        const last = this.ctx.annots().at(-1);
        const recent = last?.type === 'ink' && last.page === p.index && last.color === st.color && last.width === st.width && last._at && Date.now() - last._at < 1500;
        this.ctx.commit((list) => (recent
          ? list.map((a) => (a.id === last.id ? { ...a, paths: [...a.paths, flat], _at: Date.now() } : a))
          : [...list, { ...base, id: newId(), type: 'ink', paths: [flat], width: st.width, _at: Date.now() }]));
      })((pt) => {
        pts.push(pt);
        redraw();
      });
      return;
    }
    if (['rect', 'ellipse', 'line', 'arrow', 'text'].includes(tool)) {
      const ghost = tool === 'line' || tool === 'arrow' ? s('line', { stroke: st.color, 'stroke-width': st.width }) : s(tool === 'ellipse' ? 'ellipse' : 'rect', { stroke: tool === 'text' ? '#5b8def' : st.color, 'stroke-width': tool === 'text' ? 1 : st.width, fill: tool === 'text' ? 'rgba(91,141,239,.08)' : 'none', 'stroke-dasharray': tool === 'text' ? '4 3' : null });
      p.svg.append(ghost);
      let end = start;
      const place = (pt, ev) => {
        end = pt;
        if (ev?.shiftKey && tool !== 'text') {
          const d = Math.max(Math.abs(pt[0] - start[0]), Math.abs(pt[1] - start[1]));
          end = tool === 'line' || tool === 'arrow' ? pt : [start[0] + Math.sign(pt[0] - start[0]) * d, start[1] + Math.sign(pt[1] - start[1]) * d];
        }
        const [x0, y0, x1, y1] = normRect([...start, ...end]);
        if (tool === 'line' || tool === 'arrow') Object.entries({ x1: start[0], y1: start[1], x2: end[0], y2: end[1] }).forEach(([k, v]) => ghost.setAttribute(k, v));
        else if (tool === 'ellipse') Object.entries({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, rx: (x1 - x0) / 2, ry: (y1 - y0) / 2 }).forEach(([k, v]) => ghost.setAttribute(k, v));
        else Object.entries({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }).forEach(([k, v]) => ghost.setAttribute(k, v));
      };
      done(() => {
        ghost.remove();
        const small = Math.abs(end[0] - start[0]) < 4 && Math.abs(end[1] - start[1]) < 4;
        if (tool === 'text') {
          const vr = small ? [start[0], start[1], start[0] + 220, start[1] + (st.size || 12) * 1.6 + 6] : normRect([...start, ...end]);
          this.editText(p, { ...base, id: newId(), type: 'text', rect: R.userRect(p, vr), text: '', size: st.size || 12, opacity: 1, rot: p.page.rotate }, true);
          return;
        }
        if (small) return;
        const a = tool === 'line' || tool === 'arrow'
          ? { ...base, id: newId(), type: tool, line: [...R.toUser(p, ...start), ...R.toUser(p, ...end)], width: st.width }
          : { ...base, id: newId(), type: tool, rect: R.userRect(p, normRect([...start, ...end])), width: st.width, fill: st.fill || null };
        this.ctx.commit((list) => [...list, a]);
        this.select(a.id);
      })(place);
      return;
    }
    if (tool === 'note') {
      const [x, y] = R.toUser(p, start[0] - 4, start[1] - 4);
      const a = { ...base, id: newId(), type: 'note', at: [x, y], color: st.noteColor || '#ffd400', opacity: 1 };
      this.ctx.commit((list) => [...list, a]);
      this.ctx.setTool('select');
      this.select(a.id);
      this.ctx.onEditNote(a, true);
      return;
    }
    if (tool === 'place') {
      const img = this.ctx.pending();
      if (!img) return;
      const w = img.width || 160;
      const hh = w * (img.h / img.w || 0.35);
      const vr = [start[0] - w / 2, start[1] - hh / 2, start[0] + w / 2, start[1] + hh / 2];
      const a = { ...base, id: newId(), type: 'image', rect: R.userRect(p, vr), src: img.src, color: '#000000', opacity: 1, kind: img.kind, rot: p.page.rotate };
      this.ctx.commit((list) => [...list, a]);
      this.ctx.setTool('select');
      this.select(a.id);
    }
  }

  drag(p, e, a, start) {
    e.preventDefault();
    this.select(a.id);
    const R = this.reader;
    const svg = p.svg;
    svg.setPointerCapture(e.pointerId);
    const g = [...svg.querySelectorAll('[data-id]')].find((n) => n.dataset.id === a.id);
    const sel = svg.querySelector('.an-sel');
    let dv = [0, 0];
    const move = (ev) => {
      const [x, y] = R.clientToView(p, ev.clientX, ev.clientY);
      dv = [x - start[0], y - start[1]];
      for (const n of [g, sel]) n?.setAttribute('transform', `translate(${dv[0]} ${dv[1]})`);
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      if (Math.hypot(...dv) < 1) return this.render(p.index);
      const [ux0, uy0] = R.toUser(p, ...start);
      const [ux1, uy1] = R.toUser(p, start[0] + dv[0], start[1] + dv[1]);
      this.ctx.commit((list) => list.map((x) => (x.id === a.id ? { ...moveAnnot(x, ux1 - ux0, uy1 - uy0), modified: new Date().toISOString() } : x)));
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  }

  resize(p, e, a) {
    if (!a) return;
    e.preventDefault();
    e.stopPropagation();
    const R = this.reader;
    const svg = p.svg;
    svg.setPointerCapture(e.pointerId);
    const [x0, y0, x1, y1] = R.viewRect(p, a.rect);
    const ratio = (y1 - y0) / Math.max(1, x1 - x0);
    let next = [x0, y0, x1, y1];
    const move = (ev) => {
      const [x, y] = R.clientToView(p, ev.clientX, ev.clientY);
      const nx = Math.max(x0 + 6, x);
      // Pictures keep their shape unless Shift is held.
      const ny = a.type === 'image' && !ev.shiftKey ? y0 + (nx - x0) * ratio : Math.max(y0 + 6, y);
      next = [x0, y0, nx, ny];
      const preview = { ...a, rect: R.userRect(p, next) };
      const old = [...svg.querySelectorAll('[data-id]')].find((n) => n.dataset.id === a.id);
      old?.replaceWith(this.shape(p, preview));
      svg.querySelector('.an-sel')?.replaceWith(this.selection(p, preview));
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      this.ctx.commit((list) => list.map((x) => (x.id === a.id ? { ...x, rect: R.userRect(p, next), modified: new Date().toISOString() } : x)));
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  }

  // Edits a text box in place. fresh: not added yet (added when it has text).
  editText(p, a, fresh = false) {
    const R = this.reader;
    const [x0, y0, x1, y1] = R.viewRect(p, a.rect);
    const box = h('textarea', 'rd-text-edit');
    Object.assign(box.style, {
      left: `${(x0 / p.w) * 100}%`, top: `${(y0 / p.hgt) * 100}%`, width: `${((x1 - x0) / p.w) * 100}%`, minHeight: `${((y1 - y0) / p.hgt) * 100}%`,
      fontSize: `calc(${a.size || 12}px * var(--total-scale-factor))`, color: a.color,
    });
    box.value = a.text || '';
    box.spellcheck = true;
    p.layers.append(box);
    box.focus();
    const g = [...p.svg.querySelectorAll('[data-id]')].find((n) => n.dataset.id === a.id);
    if (g) g.style.visibility = 'hidden';
    requestAnimationFrame(() => box.focus());
    let closed = false;
    const finish = (keep) => {
      if (closed) return;
      closed = true;
      const textValue = box.value.replace(/\s+$/, '');
      // Grow the box to fit what was typed.
      const k = R.scale * CSS_PER_PT;
      const vh = Math.max(y1 - y0, box.scrollHeight / k);
      box.remove();
      if (!keep) return this.render(p.index);
      const rect = R.userRect(p, [x0, y0, x1, y0 + vh]);
      if (fresh) {
        if (textValue) this.ctx.commit((list) => [...list, { ...a, text: textValue, rect }]);
        else this.render(p.index);
      } else if (!textValue) {
        this.ctx.commit((list) => list.filter((x) => x.id !== a.id));
      } else if (textValue !== a.text || vh !== y1 - y0) {
        this.ctx.commit((list) => list.map((x) => (x.id === a.id ? { ...x, text: textValue, rect, modified: new Date().toISOString() } : x)));
      } else {
        this.render(p.index);
      }
    };
    box.addEventListener('blur', () => finish(true));
    box.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Escape') finish(!fresh);
      if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) box.blur();
    });
    box.addEventListener('pointerdown', (ev) => ev.stopPropagation());
  }

  // Highlight, underline or strike out the selected text.
  markSelection(type) {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
    const st = this.ctx.style(type);
    const byPage = new Map();
    for (let r = 0; r < sel.rangeCount; r++) {
      for (const cr of sel.getRangeAt(r).getClientRects()) {
        if (cr.width < 1 || cr.height < 1) continue;
        const p = this.reader.pageAt(cr.left + cr.width / 2, cr.top + cr.height / 2);
        if (!p) continue;
        const [vx0, vy0] = this.reader.clientToView(p, cr.left, cr.top);
        const [vx1, vy1] = this.reader.clientToView(p, cr.right, cr.bottom);
        if (!byPage.has(p.index)) byPage.set(p.index, []);
        byPage.get(p.index).push(this.reader.userRect(p, [vx0, vy0, vx1, vy1]));
      }
    }
    if (!byPage.size) return false;
    const textValue = sel.toString();
    sel.removeAllRanges();
    const made = [...byPage].map(([page, rects]) => ({
      id: newId(), type, page, rects: mergeLineRects(rects), color: st.color, opacity: type === 'highlight' ? st.opacity ?? 0.45 : 1,
      author: this.ctx.author(), modified: new Date().toISOString(), note: '', quote: textValue,
    })).filter((a) => a.rects.length);
    if (!made.length) return false;
    this.ctx.commit((list) => [...list, ...made]);
    this.select(made[0].id);
    return true;
  }
}

export { MARKUPS };
