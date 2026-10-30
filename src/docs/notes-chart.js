// Draws a notes chart with Plot's own painter, scales and colours, and turns
// it into a PNG so it saves into .docx like any other picture.

import { SvgPainter, textWidth } from '../sheets/analysis/painter.js';
import { Scale, numberTicks, padRange, paletteColor } from '../sheets/analysis/axes.js';

const W = 720;
const H = 420;
const INK = '#30353c';
const GRID = '#e6e9ee';
const AXIS = '#9aa1ab';

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
    p.rect(x, top - 9, 10, 10, { fill: paletteColor(i) });
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
    p.polygon(pts, { fill: paletteColor(i), stroke: '#fff', width: 1.5 });
    a = b;
  });
  let y = top + 24;
  const lx = cx + r + 40;
  spec.labels.forEach((label, i) => {
    if (!vals[i] || y > H - 16) return;
    p.rect(lx, y - 10, 12, 12, { fill: paletteColor(i) });
    p.text(`${label}  ${Math.round((vals[i] / total) * 1000) / 10}%`, lx + 20, y, { size: 13, color: INK });
    y += 24;
  });
}

// The chart as an SVG string.
export function chartSvg(spec) {
  const p = new SvgPainter(W, H);
  p.clear(W, H, '#ffffff');
  const top = spec.title ? 52 : 24;
  if (spec.title) p.text(spec.title, W / 2, 30, { size: 17, weight: 600, align: 'center', color: '#1f2328' });
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
    p.text(t.label, left - 6, y, { size: 12, align: 'right', baseline: 'middle', color: '#5b6270' });
  }
  p.line(left, bottom, right, bottom, { stroke: AXIS });
  if (spec.yLabel) p.text(spec.yLabel, 16, (plotTop + bottom) / 2, { size: 12, align: 'center', rotate: -90, color: '#5b6270' });
  if (spec.xLabel) p.text(spec.xLabel, (left + right) / 2, H - 14, { size: 12, align: 'center', color: '#5b6270' });

  const n = spec.labels.length;
  // Where each point sits along x: a numeric scale, or evenly spaced categories.
  let xAt;
  if (spec.x) {
    const [x0, x1] = extent(spec.x);
    const xs = new Scale(x0, x1, left, right);
    xAt = (i) => xs.map(spec.x[i]);
    for (const t of numberTicks(x0, x1, 8).filter((t) => t.v >= x0 && t.v <= x1)) {
      p.line(xs.map(t.v), bottom, xs.map(t.v), bottom + 4, { stroke: AXIS });
      p.text(t.label, xs.map(t.v), bottom + 16, { size: 12, align: 'center', color: '#5b6270' });
    }
  } else {
    const band = (right - left) / Math.max(1, n);
    xAt = (i) => left + band * (i + 0.5);
    const every = Math.max(1, Math.ceil((n * 64) / (right - left)));
    spec.labels.forEach((l, i) => {
      if (i % every) return;
      const label = textWidth(l, 12) > band * every - 4 ? `${l.slice(0, Math.max(3, Math.floor((band * every) / 8)))}…` : l;
      p.text(label, xAt(i), bottom + 16, { size: 12, align: 'center', color: '#5b6270' });
    });
  }

  const base = ys.map(Math.max(y0, Math.min(y1, 0)));
  spec.series.forEach((s, k) => {
    const color = paletteColor(k);
    if (bar) {
      const band = (right - left) / Math.max(1, n);
      const groupW = band * 0.74;
      const w = groupW / spec.series.length;
      s.values.forEach((v, i) => {
        if (!Number.isFinite(v)) return;
        const x = xAt(i) - groupW / 2 + k * w;
        const y = ys.map(v);
        p.rect(x + 0.5, Math.min(y, base), Math.max(1, w - 1), Math.abs(base - y), { fill: color });
      });
      return;
    }
    const px = s.values.map((_, i) => xAt(i));
    const py = s.values.map((v) => (Number.isFinite(v) ? ys.map(v) : NaN));
    if (spec.type === 'scatter') {
      px.forEach((x, i) => Number.isFinite(py[i]) && p.circle(x, py[i], 4, { fill: color, alpha: 0.85 }));
      return;
    }
    if (spec.type === 'area') {
      const pts = px.map((x, i) => [x, Number.isFinite(py[i]) ? py[i] : base]);
      p.polygon([[px[0], base], ...pts, [px[px.length - 1], base]], { fill: color, alpha: 0.18 });
    }
    p.polyline(px, py, px.length, { stroke: color, width: 2.4 });
    if (n <= 24) px.forEach((x, i) => Number.isFinite(py[i]) && p.circle(x, py[i], 3.2, { fill: color }));
  });
  return p.toString();
}

// Any SVG as a PNG data URL at the given scale (2x keeps text crisp).
export function svgToPng(svg, width, height, scale = 2) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = Math.round(width * scale);
      c.height = Math.round(height * scale);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('The picture could not be drawn.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

export async function chartPng(spec) {
  return { src: await svgToPng(chartSvg(spec), W, H), width: W, height: H };
}
