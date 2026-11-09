// Draws a notes chart with Plot's own painter, scales and colours, and turns
// it into a PNG so it saves into .docx like any other picture.

import { SvgPainter, textWidth } from '../sheets/analysis/painter.js';
import { Scale, numberTicks, padRange, paletteColor } from '../sheets/analysis/axes.js';

const CW = 720;
const CH = 420;
// The light look notes use; slides pass their template's colours instead.
const LIGHT = { bg: '#ffffff', title: '#1f2328', ink: '#30353c', muted: '#5b6270', grid: '#e6e9ee', axis: '#9aa1ab', colors: null };
let W = CW;
let H = CH;
let INK = LIGHT.ink;
let GRID = LIGHT.grid;
let AXIS = LIGHT.axis;
let MUTED = LIGHT.muted;
let color = paletteColor;

// #rrggbb a fraction t of the way from a to b.
export function mix(a, b, t) {
  const c = (x) => [1, 3, 5].map((i) => parseInt(String(x).slice(i, i + 2), 16));
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const [x, y] = [c(a), c(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}

// A chart look from a slide template: its text and background, and its accent first.
export function themeLook(t) {
  if (!t?.text || !t?.bg) return LIGHT;
  const accent = /^#[0-9a-f]{6}$/i.test(t.accent || '') ? t.accent : null;
  return { bg: null, title: t.title || t.text, ink: t.text, muted: mix(t.text, t.bg, 0.25), grid: mix(t.text, t.bg, 0.85), axis: mix(t.text, t.bg, 0.55), colors: accent ? [accent] : null };
}

const finite = (a) => a.filter(Number.isFinite);

function extent(values, zero = false) {
  const v = finite(values);
  let lo = Math.min(...v);
  let hi = Math.max(...v);
  if (zero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }
  return padRange([lo, hi], zero ? 0.06 : 0.05);
}

function legend(p, series, top, right) {
  if (series.length < 2) return;
  let x = right;
  for (let i = series.length - 1; i >= 0; i -= 1) {
    const w = textWidth(series[i].name, 12) + 22;
    x -= w;
    p.rect(x, top - 9, 10, 10, { fill: color(i) });
    p.text(series[i].name, x + 15, top, { size: 12, color: INK });
  }
}

function pie(p, spec, top) {
  const s = spec.series[0];
  const vals = s.values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0) || 1;
  const r = Math.min(H - top - 30, W * 0.5) / 2;
  const cx = 40 + r;
  const cy = top + 10 + r;
  let a = -Math.PI / 2;
  vals.forEach((v, i) => {
    if (!v) return;
    const b = a + (v / total) * Math.PI * 2;
    const pts = [[cx, cy]];
    for (let k = 0; k <= 48; k += 1) {
      const t = a + ((b - a) * k) / 48;
      pts.push([cx + r * Math.cos(t), cy + r * Math.sin(t)]);
    }
    p.polygon(pts, { fill: color(i), stroke: PIE_EDGE, width: 1.5 });
    a = b;
  });
  let y = top + 24;
  const lx = cx + r + 40;
  spec.labels.forEach((label, i) => {
    if (!vals[i] || y > H - 16) return;
    p.rect(lx, y - 10, 12, 12, { fill: color(i) });
    p.text(`${label}  ${Math.round((vals[i] / total) * 1000) / 10}%`, lx + 20, y, { size: 13, color: INK });
    y += 24;
  });
}

let PIE_EDGE = '#fff';

// The chart as an SVG string, at size (720 x 420 unless given) in a look
// (light unless given; a look with no bg is transparent).
export function chartSvg(spec, { w = CW, h = CH, look = LIGHT } = {}) {
  [W, H, INK, GRID, AXIS, MUTED] = [w, h, look.ink, look.grid, look.axis, look.muted];
  PIE_EDGE = look.bg || '#ffffff';
  color = look.colors?.length ? (i) => (i < look.colors.length ? look.colors[i] : paletteColor(i - look.colors.length)) : paletteColor;
  const p = new SvgPainter(W, H);
  if (look.bg) p.clear(W, H, look.bg);
  const top = spec.title ? 52 : 24;
  if (spec.title) p.text(spec.title, W / 2, 30, { size: 17, weight: 600, align: 'center', color: look.title });
  if (spec.type === 'pie') {
    pie(p, spec, top);
    return p.toString();
  }
  const all = spec.series.flatMap((s) => s.values);
  const bar = spec.type === 'bar';
  const [y0, y1] = extent(all, bar || spec.type === 'area');
  const ticks = numberTicks(y0, y1, 6).filter((t) => t.v >= y0 && t.v <= y1);
  const left = 18 + (spec.yLabel ? 18 : 0) + Math.max(...ticks.map((t) => textWidth(t.label, 12)), 10);
  const right = W - 20;
  const bottom = H - (spec.xLabel ? 54 : 34);
  const plotTop = top + (spec.series.length > 1 ? 22 : 6);
  legend(p, spec.series, top + 6, right);
  const ys = new Scale(y0, y1, bottom, plotTop);
  for (const t of ticks) {
    const y = ys.map(t.v);
    p.line(left, y, right, y, { stroke: GRID });
    p.text(t.label, left - 6, y, { size: 12, align: 'right', baseline: 'middle', color: MUTED });
  }
  p.line(left, bottom, right, bottom, { stroke: AXIS });
  if (spec.yLabel) p.text(spec.yLabel, 16, (plotTop + bottom) / 2, { size: 12, align: 'center', rotate: -90, color: MUTED });
  if (spec.xLabel) p.text(spec.xLabel, (left + right) / 2, H - 14, { size: 12, align: 'center', color: MUTED });

  const n = spec.labels.length;
  // Where each point sits along x: a numeric scale, or evenly spaced categories.
  let xAt;
  if (spec.x) {
    const [x0, x1] = extent(spec.x);
    const xs = new Scale(x0, x1, left, right);
    xAt = (i) => xs.map(spec.x[i]);
    for (const t of numberTicks(x0, x1, 8).filter((t) => t.v >= x0 && t.v <= x1)) {
      p.line(xs.map(t.v), bottom, xs.map(t.v), bottom + 4, { stroke: AXIS });
      p.text(t.label, xs.map(t.v), bottom + 16, { size: 12, align: 'center', color: MUTED });
    }
  } else {
    const band = (right - left) / Math.max(1, n);
    xAt = (i) => left + band * (i + 0.5);
    const every = Math.max(1, Math.ceil((n * 64) / (right - left)));
    spec.labels.forEach((l, i) => {
      if (i % every) return;
      const label = textWidth(l, 12) > band * every - 4 ? `${l.slice(0, Math.max(3, Math.floor((band * every) / 8)))}…` : l;
      p.text(label, xAt(i), bottom + 16, { size: 12, align: 'center', color: MUTED });
    });
  }

  const base = ys.map(Math.max(y0, Math.min(y1, 0)));
  spec.series.forEach((s, k) => {
    const c = color(k);
    if (bar) {
      const band = (right - left) / Math.max(1, n);
      const groupW = band * 0.74;
      const w = groupW / spec.series.length;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = xAt(i) - groupW / 2 + k * w;
        const y = ys.map(v);
        p.rect(x + 0.5, Math.min(y, base), Math.max(1, w - 1), Math.abs(base - y), { fill: c });
      });
      return;
    }
    const px = s.values.map((_, i) => xAt(i));
    const py = s.values.map((v) => (Number.isFinite(v) ? ys.map(v) : NaN));
    if (spec.type === 'scatter') {
      px.forEach((x, i) => Number.isFinite(py[i]) && p.circle(x, py[i], 4, { fill: c, alpha: 0.85 }));
      return;
    }
    if (spec.type === 'area') {
      const pts = px.map((x, i) => [x, Number.isFinite(py[i]) ? py[i] : base]);
      p.polygon([[px[0], base], ...pts, [px[px.length - 1], base]], { fill: c, alpha: 0.18 });
    }
    p.polyline(px, py, px.length, { stroke: c, width: 2.4 });
    if (n <= 24) px.forEach((x, i) => Number.isFinite(py[i]) && p.circle(x, py[i], 3.2, { fill: c }));
  });
  return p.toString();
}

// Any SVG as a PNG data URL at the given scale (2x keeps text crisp).
export function svgToPng(svg, width, height, scale = 2, bg = '#ffffff') {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      const ctx = c.getContext('2d');
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, c.width, c.height);
      }
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('The picture could not be drawn.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function chartPng(spec) {
  return { src: await svgToPng(chartSvg(spec), CW, CH), width: CW, height: CH };
}

// A chart for a slide, drawn in the template's colours on a clear background.
export async function slideChartPng(spec, w, h, theme) {
  const look = themeLook(theme);
  return { src: await svgToPng(chartSvg(spec, { w, h, look }), w, h, 2, look.bg), w, h };
}
