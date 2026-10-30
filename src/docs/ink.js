// Drawing pad for notes: draw or write with a mouse, finger or stylus.
// Pen pressure thins and thickens the line; the highlighter is wide and see-
// through; the eraser removes whole strokes it touches. "Insert" crops to
// what was drawn and hands back a PNG.

import { escapeHtml, h } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const COLORS = ['#1f2328', '#2a6fdb', '#d13b3b', '#19a979', '#e8a317', '#8c62c9'];
const SIZES = [{ label: 'Fine', w: 2 }, { label: 'Medium', w: 4 }, { label: 'Bold', w: 8 }];
const PAD_W = 1000;
const PAD_H = 560;

function drawStroke(ctx, s) {
  const pts = s.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalAlpha = s.tool === 'marker' ? 0.35 : 1;
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineCap = s.tool === 'marker' ? 'square' : 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1) {
    ctx.beginPath();
    ctx.arc(pts[0].x, pts[0].y, (s.width * (pts[0].p || 0.5)) / 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  // Each segment gets its own width so pen pressure shows; quadratic curves
  // through midpoints keep it smooth.
  for (let i = 1; i < pts.length; i += 1) {
    const a = pts[i - 1];
    const b = pts[i];
    const c = pts[i + 1] || b;
    ctx.lineWidth = s.tool === 'marker' ? s.width : Math.max(0.6, s.width * (0.35 + 1.3 * ((a.p + b.p) / 2)));
    ctx.beginPath();
    const m0 = i === 1 ? a : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const m1 = { x: (b.x + c.x) / 2, y: (b.y + c.y) / 2 };
    ctx.moveTo(m0.x, m0.y);
    ctx.quadraticCurveTo(b.x, b.y, m1.x, m1.y);
    ctx.stroke();
  }
  ctx.restore();
}

function hits(s, x, y, r) {
  const pad = r + s.width;
  return s.points.some((p) => (p.x - x) ** 2 + (p.y - y) ** 2 <= pad * pad);
}

// Opens the pad. base: an existing picture to draw over (data URL).
// Resolves to { src, width, height } or null when cancelled.
export function drawingPad({ base = null, title = 'Drawing' } = {}) {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal wide ink-modal');
    box.append(h('div', 'modal-title', escapeHtml(title)));
    const bar = h('div', 'ink-bar');
    const stage = h('div', 'ink-stage');
    const canvas = h('canvas', 'ink-canvas');
    canvas.width = PAD_W * 2;
    canvas.height = PAD_H * 2;
    stage.append(canvas);
    const ctx = canvas.getContext('2d');
    ctx.scale(2, 2);
    const strokes = [];
    const undone = [];
    let baseImg = null;
    const tool = { kind: 'pen', color: COLORS[0], width: SIZES[1].w };

    const redraw = () => {
      ctx.clearRect(0, 0, PAD_W, PAD_H);
      if (baseImg) ctx.drawImage(baseImg, baseImg.dx, baseImg.dy, baseImg.dw, baseImg.dh);
      for (const s of strokes) drawStroke(ctx, s);
    };
    if (base) {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, (PAD_W - 40) / (img.naturalWidth / 2), (PAD_H - 40) / (img.naturalHeight / 2));
        img.dw = (img.naturalWidth / 2) * k;
        img.dh = (img.naturalHeight / 2) * k;
        img.dx = (PAD_W - img.dw) / 2;
        img.dy = (PAD_H - img.dh) / 2;
        baseImg = img;
        redraw();
      };
      img.src = base;
    }

    const btn = (html, titleText, run, cls = '') => {
      const b = h('button', `ink-btn ${cls}`, html);
      b.type = 'button';
      b.title = titleText;
      b.onclick = run;
      bar.append(b);
      return b;
    };
    const toolBtns = {};
    const pick = (kind) => {
      tool.kind = kind;
      for (const [k, b] of Object.entries(toolBtns)) b.classList.toggle('on', k === kind);
      canvas.style.cursor = kind === 'eraser' ? 'cell' : 'crosshair';
    };
    toolBtns.pen = btn(`${icon('pen', 18)}<span>Pen</span>`, 'Pen', () => pick('pen'));
    toolBtns.marker = btn(`${icon('highlight', 18)}<span>Highlighter</span>`, 'Highlighter', () => pick('marker'));
    toolBtns.eraser = btn(`${icon('eraser', 18)}<span>Eraser</span>`, 'Eraser: touch a stroke to remove it', () => pick('eraser'));
    bar.append(h('span', 'ink-sep'));
    const swatches = COLORS.map((c) => {
      const b = btn('', c, () => {
        tool.color = c;
        for (const s of swatches) s.classList.toggle('on', s === b);
        if (tool.kind === 'eraser') pick('pen');
      }, 'ink-swatch');
      b.style.setProperty('--c', c);
      return b;
    });
    swatches[0].classList.add('on');
    bar.append(h('span', 'ink-sep'));
    const sizeBtns = SIZES.map((s, i) => {
      const b = btn(`<i style="width:${4 + s.w * 1.5}px;height:${4 + s.w * 1.5}px"></i>`, s.label, () => {
        tool.width = s.w;
        for (const x of sizeBtns) x.classList.toggle('on', x === b);
      }, 'ink-size');
      if (i === 1) b.classList.add('on');
      return b;
    });
    bar.append(h('span', 'ink-sep'));
    btn(icon('undo', 18), 'Undo (Ctrl+Z)', () => {
      if (strokes.length) undone.push(strokes.pop());
      redraw();
    });
    btn(icon('redo', 18), 'Redo (Ctrl+Y)', () => {
      if (undone.length) strokes.push(undone.pop());
      redraw();
    });
    btn(icon('trash', 18), 'Clear the page', () => {
      strokes.length = 0;
      undone.length = 0;
      baseImg = null;
      redraw();
    });
    pick('pen');

    let live = null;
    const at = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * PAD_W, y: ((e.clientY - r.top) / r.height) * PAD_H, p: e.pointerType === 'pen' || (e.pressure > 0 && e.pressure !== 0.5) ? e.pressure : 0.5 };
    };
    const erase = (pt) => {
      const before = strokes.length;
      for (let i = strokes.length - 1; i >= 0; i -= 1) if (hits(strokes[i], pt.x, pt.y, 8)) strokes.splice(i, 1);
      if (strokes.length !== before) redraw();
    };
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      // The back of a stylus (or its eraser button) erases.
      const kind = e.buttons & 32 ? 'eraser' : tool.kind;
      const pt = at(e);
      if (kind === 'eraser') {
        live = { erasing: true };
        erase(pt);
        return;
      }
      live = { tool: kind, color: tool.color, width: kind === 'marker' ? tool.width * 3.5 : tool.width, points: [pt] };
      strokes.push(live);
      undone.length = 0;
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!live) return;
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      if (live.erasing) {
        for (const ev of events) erase(at(ev));
        return;
      }
      for (const ev of events) live.points.push(at(ev));
      redraw();
    });
    const end = () => {
      live = null;
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);

    const done = (v) => {
      back.remove();
      resolve(v);
    };
    // Crop to what was drawn, with a margin, and export at 2x.
    const finish = () => {
      if (!strokes.length && !baseImg) return done(null);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const s of strokes) {
        for (const p of s.points) {
          x0 = Math.min(x0, p.x - s.width);
          y0 = Math.min(y0, p.y - s.width);
          x1 = Math.max(x1, p.x + s.width);
          y1 = Math.max(y1, p.y + s.width);
        }
      }
      if (baseImg) {
        x0 = Math.min(x0, baseImg.dx);
        y0 = Math.min(y0, baseImg.dy);
        x1 = Math.max(x1, baseImg.dx + baseImg.dw);
        y1 = Math.max(y1, baseImg.dy + baseImg.dh);
      }
      const m = 12;
      x0 = Math.max(0, Math.floor(x0 - m));
      y0 = Math.max(0, Math.floor(y0 - m));
      x1 = Math.min(PAD_W, Math.ceil(x1 + m));
      y1 = Math.min(PAD_H, Math.ceil(y1 + m));
      const out = document.createElement('canvas');
      out.width = (x1 - x0) * 2;
      out.height = (y1 - y0) * 2;
      const o = out.getContext('2d');
      o.fillStyle = '#ffffff';
      o.fillRect(0, 0, out.width, out.height);
      o.drawImage(canvas, x0 * 2, y0 * 2, out.width, out.height, 0, 0, out.width, out.height);
      done({ src: out.toDataURL('image/png'), width: x1 - x0, height: y1 - y0 });
    };

    const actions = h('div', 'modal-actions');
    const ok = h('button', 'btn primary', 'Insert');
    ok.type = 'button';
    ok.onclick = finish;
    const cancel = h('button', 'btn', 'Cancel');
    cancel.type = 'button';
    cancel.onclick = () => done(null);
    actions.append(h('span', 'ink-hint', 'Use a mouse, finger or stylus. Pen pressure changes the line.'), ok, cancel);
    box.append(bar, stage, actions);
    back.append(box);
    document.body.append(back);
    back.tabIndex = -1;
    back.focus();
    back.addEventListener('keydown', (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === 'Escape') done(null);
      else if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (strokes.length) undone.push(strokes.pop());
        redraw();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        if (undone.length) strokes.push(undone.pop());
        redraw();
      }
      e.stopPropagation();
    });
  });
}
