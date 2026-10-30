// One drawing API, two back ends: a 2D canvas for the screen and an SVG
// string for vector export, so what you export is what you see.

const FONT = 'Calibri, Carlito, "Segoe UI", system-ui, sans-serif';
const measureCtx = (() => {
  const c = document.createElement('canvas');
  return c.getContext('2d');
})();

export function textWidth(s, size = 12, weight = 400) {
  measureCtx.font = `${weight} ${size}px ${FONT}`;
  return measureCtx.measureText(String(s)).width;
}

// Outline of a marker shape around (x, y); null means a circle.
export function markerPoints(shape, x, y, r) {
  const t = r * 0.3;
  switch (shape) {
    case 'square': return [[x - r * 0.85, y - r * 0.85], [x + r * 0.85, y - r * 0.85], [x + r * 0.85, y + r * 0.85], [x - r * 0.85, y + r * 0.85]];
    case 'diamond': return [[x, y - r * 1.1], [x + r * 1.1, y], [x, y + r * 1.1], [x - r * 1.1, y]];
    case 'triangle': return [[x, y - r * 1.1], [x + r, y + r * 0.75], [x - r, y + r * 0.75]];
    case 'triangleDown': return [[x, y + r * 1.1], [x + r, y - r * 0.75], [x - r, y - r * 0.75]];
    case 'plus': return [[x - t, y - r], [x + t, y - r], [x + t, y - t], [x + r, y - t], [x + r, y + t], [x + t, y + t], [x + t, y + r], [x - t, y + r], [x - t, y + t], [x - r, y + t], [x - r, y - t], [x - t, y - t]];
    case 'cross': {
      const pts = markerPoints('plus', 0, 0, r * 1.05);
      const c = Math.SQRT1_2;
      return pts.map(([a, b]) => [x + (a - b) * c, y + (a + b) * c]);
    }
    default: return null;
  }
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const r2 = (v) => Math.round(v * 100) / 100;

export class CanvasPainter {
  constructor(ctx, dpr = 1) {
    this.ctx = ctx;
    this.dpr = dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  clear(w, h, fill = null) {
    const c = this.ctx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, c.canvas.width, c.canvas.height);
    c.restore();
    if (fill) this.rect(0, 0, w, h, { fill });
  }

  clip(x, y, w, h) {
    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(x, y, w, h);
    this.ctx.clip();
  }

  unclip() {
    this.ctx.restore();
  }

  style(o) {
    const c = this.ctx;
    c.globalAlpha = o.alpha ?? 1;
    if (o.stroke) {
      c.strokeStyle = o.stroke;
      c.lineWidth = o.width ?? 1;
      c.setLineDash(o.dash || []);
    }
    if (o.fill) c.fillStyle = o.fill;
  }

  line(x1, y1, x2, y2, o = {}) {
    const c = this.ctx;
    this.style({ stroke: '#000', ...o });
    c.beginPath();
    c.moveTo(x1, y1);
    c.lineTo(x2, y2);
    c.stroke();
    c.globalAlpha = 1;
  }

  rect(x, y, w, h, o = {}) {
    const c = this.ctx;
    this.style(o);
    if (o.fill) c.fillRect(x, y, w, h);
    if (o.stroke) c.strokeRect(x, y, w, h);
    c.globalAlpha = 1;
  }

  polyline(xs, ys, n, o = {}) {
    if (n < 1) return;
    const c = this.ctx;
    this.style({ stroke: '#000', ...o });
    c.lineJoin = 'round';
    c.beginPath();
    let pen = false;
    for (let i = 0; i < n; i += 1) {
      const x = xs[i];
      const y = ys[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        pen = false;
        continue;
      }
      if (pen) c.lineTo(x, y);
      else c.moveTo(x, y);
      pen = true;
    }
    c.stroke();
    c.globalAlpha = 1;
  }

  polygon(pts, o = {}) {
    const c = this.ctx;
    this.style(o);
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    if (o.fill) c.fill();
    if (o.stroke) c.stroke();
    c.globalAlpha = 1;
  }

  circle(x, y, r, o = {}) {
    const c = this.ctx;
    this.style(o);
    c.beginPath();
    c.arc(x, y, r, 0, Math.PI * 2);
    if (o.fill) c.fill();
    if (o.stroke) c.stroke();
    c.globalAlpha = 1;
  }

  marker(x, y, r, shape, o = {}) {
    const pts = markerPoints(shape, x, y, r);
    if (pts) this.polygon(pts, o);
    else this.circle(x, y, r, o);
  }

  text(s, x, y, o = {}) {
    const c = this.ctx;
    c.save();
    c.globalAlpha = o.alpha ?? 1;
    c.font = `${o.weight || 400} ${o.size || 12}px ${FONT}`;
    c.fillStyle = o.color || '#30353c';
    c.textAlign = o.align || 'left';
    c.textBaseline = o.baseline || 'alphabetic';
    c.translate(x, y);
    if (o.rotate) c.rotate((o.rotate * Math.PI) / 180);
    c.fillText(String(s), 0, 0);
    c.restore();
  }

  image(src, x, y, w, h, smooth = false) {
    const c = this.ctx;
    c.save();
    c.imageSmoothingEnabled = smooth;
    c.drawImage(src, x, y, w, h);
    c.restore();
  }
}

export class SvgPainter {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.parts = [];
    this.clips = 0;
    this.open = [];
  }

  attrs(o) {
    let a = '';
    a += o.fill ? ` fill="${o.fill}"` : ' fill="none"';
    if (o.stroke) a += ` stroke="${o.stroke}" stroke-width="${o.width ?? 1}"${o.dash?.length ? ` stroke-dasharray="${o.dash.join(' ')}"` : ''}`;
    if (o.alpha != null && o.alpha !== 1) a += ` opacity="${r2(o.alpha)}"`;
    return a;
  }

  clear(w, h, fill = null) {
    if (fill) this.rect(0, 0, w, h, { fill });
  }

  clip(x, y, w, h) {
    const id = `c${this.clips++}`;
    this.parts.push(`<clipPath id="${id}"><rect x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}"/></clipPath><g clip-path="url(#${id})">`);
  }

  unclip() {
    this.parts.push('</g>');
  }

  line(x1, y1, x2, y2, o = {}) {
    this.parts.push(`<line x1="${r2(x1)}" y1="${r2(y1)}" x2="${r2(x2)}" y2="${r2(y2)}"${this.attrs({ stroke: '#000', ...o, fill: null })}/>`);
  }

  rect(x, y, w, h, o = {}) {
    this.parts.push(`<rect x="${r2(x)}" y="${r2(y)}" width="${r2(Math.max(0, w))}" height="${r2(Math.max(0, h))}"${this.attrs(o)}/>`);
  }

  polyline(xs, ys, n, o = {}) {
    let d = '';
    let pen = false;
    for (let i = 0; i < n; i += 1) {
      if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${r2(xs[i])} ${r2(ys[i])}`;
      pen = true;
    }
    if (d) this.parts.push(`<path d="${d}" stroke-linejoin="round"${this.attrs({ stroke: '#000', ...o, fill: null })}/>`);
  }

  polygon(pts, o = {}) {
    this.parts.push(`<polygon points="${pts.map(([x, y]) => `${r2(x)},${r2(y)}`).join(' ')}"${this.attrs(o)}/>`);
  }

  circle(x, y, r, o = {}) {
    this.parts.push(`<circle cx="${r2(x)}" cy="${r2(y)}" r="${r2(r)}"${this.attrs(o)}/>`);
  }

  marker(x, y, r, shape, o = {}) {
    const pts = markerPoints(shape, x, y, r);
    if (pts) this.polygon(pts, o);
    else this.circle(x, y, r, o);
  }

  text(s, x, y, o = {}) {
    const anchor = { center: 'middle', right: 'end', end: 'end' }[o.align] || 'start';
    const base = { middle: 'central', top: 'hanging', bottom: 'text-after-edge' }[o.baseline] || 'auto';
    const rot = o.rotate ? ` transform="rotate(${o.rotate} ${r2(x)} ${r2(y)})"` : '';
    this.parts.push(`<text x="${r2(x)}" y="${r2(y)}" font-family='${FONT}' font-size="${o.size || 12}" font-weight="${o.weight || 400}" fill="${o.color || '#30353c'}" text-anchor="${anchor}" dominant-baseline="${base}"${o.alpha != null ? ` opacity="${o.alpha}"` : ''}${rot}>${esc(s)}</text>`);
  }

  image(src, x, y, w, h, smooth = false) {
    const href = typeof src === 'string' ? src : src.toDataURL('image/png');
    this.parts.push(`<image x="${r2(x)}" y="${r2(y)}" width="${r2(w)}" height="${r2(h)}" href="${href}" preserveAspectRatio="none"${smooth ? '' : ' style="image-rendering:pixelated"'}/>`);
  }

  toString() {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${this.w}" height="${this.h}" viewBox="0 0 ${this.w} ${this.h}">${this.parts.join('')}</svg>`;
  }
}
