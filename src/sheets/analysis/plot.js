// One visualization on the analysis page: fetches what it draws from the
// data worker, paints axes and marks on canvases (points through WebGL),
// and handles marking, zooming, panning and hover.

import { PointLayer } from './gl.js';
import { CanvasPainter, SvgPainter, textWidth } from './painter.js';
import { MARK, Scale, formatValue, padRange, paletteColor, ramp, rampCss, ticksFor } from './axes.js';
import { curveFn } from './fit.js';
import { icon } from '../../shared/icons.js';

export const PLOT_TYPES = {
  scatter: { label: 'Scatter', icon: 'chartScatter' },
  line: { label: 'Line', icon: 'chartLine' },
  bar: { label: 'Bar', icon: 'chartBar' },
  histogram: { label: 'Histogram', icon: 'chartHist' },
  box: { label: 'Box', icon: 'chartBox' },
  heatmap: { label: 'Heat map', icon: 'chartHeat' },
};

const FIT_COLORS = ['#b3261e', '#6a1b9a', '#00695c', '#e65100'];
const GRID = '#e8ebef';
const AXIS = '#9aa1ab';
const TEXT = '#4a5059';
const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function autoTitle(spec) {
  const ys = (spec.y || []).map((s) => s.col).filter(Boolean);
  switch (spec.type) {
    case 'histogram': return `Distribution of ${spec.x || '…'}`;
    case 'bar': return ys.length ? `${aggLabel(spec.agg)} of ${ys[0]} by ${spec.x || 'all rows'}` : `Rows by ${spec.x || '…'}`;
    case 'box': return `${ys[0] || '…'}${spec.x ? ` by ${spec.x}` : ''}`;
    case 'heatmap': return `${ys[0] || '…'} vs ${spec.x || '…'}${spec.z ? ` (${aggLabel(spec.agg || 'mean')} of ${spec.z})` : ''}`;
    default: return `${ys.join(', ') || '…'} vs ${spec.x || '…'}`;
  }
}

export const AGGS = [
  { value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'mean', label: 'Average' }, { value: 'median', label: 'Median' },
  { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' }, { value: 'std', label: 'Std. deviation' },
];
const aggLabel = (a) => AGGS.find((x) => x.value === a)?.label || 'Sum';

export class PlotView {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.data = null;
    this.error = null;
    this.token = 0;
    this.tool = 'mark';
    this.el = h('div', 'viz');
    this.el.tabIndex = 0;
    const head = h('div', 'viz-head');
    this.titleEl = h('span', 'viz-title');
    this.titleEl.title = 'Double-click to rename';
    this.titleEl.ondblclick = () => ctx.rename?.(this);
    const tools = h('div', 'viz-tools');
    this.toolButtons = {};
    for (const [id, ic, tip] of [['mark', 'pointer', 'Mark data (drag a box; Ctrl adds, Alt removes)'], ['zoom', 'zoomIn', 'Zoom to a box'], ['pan', 'pan', 'Pan (or drag with the right button)']]) {
      const b = h('button', 'viz-btn', icon(ic, 14));
      b.title = tip;
      b.onclick = () => this.setTool(id);
      this.toolButtons[id] = b;
      tools.append(b);
    }
    const reset = h('button', 'viz-btn', icon('fitView', 14));
    reset.title = 'Show all data (double-click the plot)';
    reset.onclick = () => this.resetView();
    const close = h('button', 'viz-btn', icon('close', 14));
    close.title = 'Remove this plot';
    close.onclick = () => ctx.remove?.(this);
    tools.append(reset, close);
    head.append(h('span', 'viz-type', icon(PLOT_TYPES[spec.type]?.icon || 'chartScatter', 14)), this.titleEl, tools);
    this.body = h('div', 'viz-body');
    this.back = h('canvas', 'viz-canvas');
    this.glCanvas = h('canvas', 'viz-canvas');
    this.front = h('canvas', 'viz-canvas');
    this.brush = h('div', 'viz-brush');
    this.tip = h('div', 'viz-tip');
    this.msg = h('div', 'viz-msg');
    this.body.append(this.back, this.glCanvas, this.front, this.brush, this.tip, this.msg);
    this.el.append(head, this.body);
    this.el.addEventListener('mousedown', () => ctx.activate?.(this), true);
    this.setTool('mark');
    this.bind();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.body);
    this.updateHead();
  }

  get view() {
    return this.spec.view || null;
  }

  set view(v) {
    this.spec.view = v;
  }

  setTool(t) {
    this.tool = t;
    for (const [id, b] of Object.entries(this.toolButtons)) b.classList.toggle('on', id === t);
    this.body.dataset.tool = t;
  }

  updateHead() {
    this.titleEl.textContent = this.spec.title || autoTitle(this.spec);
    const zoomable = ['scatter', 'line', 'histogram'].includes(this.spec.type);
    this.toolButtons.zoom.hidden = !zoomable;
    this.toolButtons.pan.hidden = !zoomable;
  }

  setSpec(spec) {
    this.spec = spec;
    this.updateHead();
    this.fetch();
  }

  size() {
    return { w: this.body.clientWidth, h: this.body.clientHeight };
  }

  // Asks the worker for what this plot needs; stale answers are dropped.
  async fetch() {
    const token = ++this.token;
    const s = this.spec;
    if (!s.x && s.type !== 'box' && s.type !== 'bar') return this.showMessage('Choose a column for the X axis in Plot properties.');
    if (['scatter', 'line', 'box', 'heatmap'].includes(s.type) && !s.y?.[0]?.col) return this.showMessage('Choose a column for the Y axis in Plot properties.');
    const { w, h: ht } = this.size();
    const L = this.layoutGuess();
    try {
      clearTimeout(this.slow);
      this.slow = setTimeout(() => this.msg.classList.add('busy'), 250);
      const viewArg = s.type === 'line' || s.type === 'scatter' ? this.dataView() : null;
      const data = await this.ctx.client.call('plotData', s, viewArg, { w: L ? L.plot.w : w * 0.8, h: L ? L.plot.h : ht * 0.8 });
      if (token !== this.token) return;
      this.data = data;
      this.error = null;
      this.msg.className = 'viz-msg';
      if (data.kind === 'points') {
        this.ensureGl();
        this.points?.setData(data.series);
      } else this.points?.setData([]);
      this.draw();
    } catch (err) {
      if (token !== this.token) return;
      this.showMessage(err.message || String(err));
    } finally {
      clearTimeout(this.slow);
      this.msg.classList.remove('busy');
    }
  }

  showMessage(text) {
    this.data = null;
    this.error = text;
    this.points?.setData([]);
    this.msg.textContent = text;
    this.msg.className = 'viz-msg show';
    this.draw();
  }

  ensureGl() {
    if (this.points || this.glFailed) return;
    try {
      this.points = new PointLayer(this.glCanvas);
    } catch {
      this.glFailed = true;
    }
  }

  // The x/y window the worker should reduce lines or density for.
  dataView() {
    const v = this.view;
    if (!v) return null;
    return { x0: v.x[0], x1: v.x[1], left: v.left, right: v.right };
  }

  layoutGuess() {
    return this.lastLayout || null;
  }

  // ---------- layout ----------
  layout(W, H, data = this.data) {
    const s = this.spec;
    const kind = data?.kind;
    const L = { W, H, kind };
    const top = 12;
    let legend = null;
    let legendW = 0;
    if (data) {
      legend = this.legendItems(data);
      if (legend?.type === 'items') legendW = Math.min(200, Math.max(...legend.items.map((it) => textWidth(it.label, 11))) + 30);
      if (legend?.type === 'ramp') legendW = 70;
    }
    const xType = data?.xType || 'number';
    const continuousX = ['points', 'density', 'lines', 'histogram'].includes(kind) || (kind === 'heatmap' && data.xEdges);
    let xDom = [0, 1];
    let yL = [0, 1];
    let yR = null;
    let xCats = null;
    let yCats = null;
    if (kind === 'points' || kind === 'density' || kind === 'lines') {
      xDom = this.view?.x || padRange(data.bounds.x, kind === 'lines' ? 0 : 0.03, s.logX);
      yL = this.view?.left || padRange(data.bounds.left || [0, 1], 0.05, s.logY);
      if (data.bounds.right) yR = this.view?.right || padRange(data.bounds.right, 0.05, s.logY2);
    } else if (kind === 'histogram') {
      const e = data.edges;
      xDom = this.view?.x || [e[0], e[e.length - 1]];
      const ng = data.groups ? data.groups.length : 1;
      let hi = 0;
      for (let k = 0; k < e.length - 1; k += 1) {
        let sum = 0;
        for (let g = 0; g < ng; g += 1) sum += data.values[k * ng + g];
        hi = Math.max(hi, sum);
      }
      yL = this.view?.left || [0, hi * 1.06 || 1];
    } else if (kind === 'bars') {
      xCats = data.labels;
      const ng = data.groups ? data.groups.length : 1;
      let lo = 0;
      let hi = 0;
      for (let c = 0; c < xCats.length; c += 1) {
        let pos = 0;
        let neg = 0;
        for (let g = 0; g < ng; g += 1) {
          const v = data.values[c * ng + g] || 0;
          if (s.stacked) {
            if (v > 0) pos += v;
            else neg += v;
          } else {
            pos = Math.max(pos, v);
            neg = Math.min(neg, v);
          }
        }
        hi = Math.max(hi, pos);
        lo = Math.min(lo, neg);
      }
      yL = [lo * 1.06, hi * 1.06 || 1];
    } else if (kind === 'box') {
      xCats = data.stats.map((st) => st.label);
      let lo = Infinity;
      let hi = -Infinity;
      for (const st of data.stats) {
        lo = Math.min(lo, st.min);
        hi = Math.max(hi, st.max);
      }
      yL = padRange(Number.isFinite(lo) ? [lo, hi] : [0, 1], 0.05, s.logY);
    } else if (kind === 'heatmap') {
      if (data.xEdges) xDom = [data.xEdges[0], data.xEdges[data.xEdges.length - 1]];
      else xCats = data.xLabels;
      if (data.yEdges) yL = [data.yEdges[0], data.yEdges[data.yEdges.length - 1]];
      else yCats = data.yLabels;
    }
    // Margins from the widest tick labels.
    const tmpY = new Scale(yL[0], yL[1], 100, 0, s.logY && kind !== 'bars' && kind !== 'histogram');
    const yTicks = yCats ? null : ticksFor(tmpY, kind === 'heatmap' ? data.yType : 'number', 6);
    const leftW = yCats ? Math.min(160, Math.max(...yCats.map((c) => textWidth(c, 11)))) : Math.max(...(yTicks || []).map((t) => textWidth(t.label, 11)), 20);
    let rightW = 0;
    let yRTicks = null;
    if (yR) {
      yRTicks = ticksFor(new Scale(yR[0], yR[1], 100, 0, s.logY2), 'number', 6);
      rightW = Math.max(...yRTicks.map((t) => textWidth(t.label, 11)), 20) + 24;
    }
    let rotate = 0;
    let bottomExtra = 0;
    if (xCats) {
      const widest = Math.max(...xCats.map((c) => textWidth(c, 11)), 10);
      const plotW = W - leftW - 40 - rightW - legendW;
      if ((widest + 8) * xCats.length > plotW) {
        rotate = -40;
        bottomExtra = Math.min(110, widest * 0.66);
      }
    }
    const plot = { x: leftW + 30, y: top, w: 0, h: 0 };
    plot.w = Math.max(40, W - plot.x - Math.max(12, rightW) - legendW - (legendW ? 8 : 0));
    plot.h = Math.max(40, H - top - 42 - bottomExtra);
    L.plot = plot;
    L.rotate = rotate;
    L.legend = legend;
    L.legendW = legendW;
    L.xCats = xCats;
    L.yCats = yCats;
    L.xType = continuousX ? (kind === 'heatmap' ? data.xType : xType) : 'category';
    if (xCats) L.xBand = { n: xCats.length, w: plot.w / Math.max(1, xCats.length) };
    else L.sx = new Scale(xDom[0], xDom[1], plot.x, plot.x + plot.w, !!s.logX && kind !== 'histogram' && kind !== 'heatmap');
    if (yCats) L.yBand = { n: yCats.length, h: plot.h / Math.max(1, yCats.length) };
    else L.syL = new Scale(yL[0], yL[1], plot.y + plot.h, plot.y, !!s.logY && ['points', 'density', 'lines', 'box'].includes(kind));
    if (yR) L.syR = new Scale(yR[0], yR[1], plot.y + plot.h, plot.y, !!s.logY2);
    L.yRTicks = yRTicks;
    return L;
  }

  legendItems(data) {
    const s = this.spec;
    if (data.kind === 'heatmap' || data.kind === 'density') return { type: 'ramp', title: data.kind === 'density' ? 'Rows' : data.valueName };
    if (data.colorMode === 'continuous') return { type: 'ramp', title: s.color, range: data.colorRange, colorType: data.colorType };
    if (data.legend?.length) return { type: 'items', title: s.color, items: data.legend.slice(0, 40).map((label, i) => ({ label, color: paletteColor(i) })) };
    if (data.groups?.length > 1 || (data.groups && s.color)) return { type: 'items', title: s.color, items: data.groups.map((label, i) => ({ label, color: paletteColor(data.groupIds?.[i] ?? i) })) };
    if ((data.kind === 'points' || data.kind === 'lines') && data.series.length > 1) {
      const seen = new Map();
      for (const se of data.series) if (!seen.has(se.name)) seen.set(se.name, paletteColor(data.kind === 'points' ? data.series.indexOf(se) : se.color));
      return { type: 'items', items: [...seen].map(([label, color]) => ({ label: label + ((s.y || []).find((y) => y.col === label)?.axis === 'right' ? ' (right)' : ''), color })) };
    }
    return null;
  }

  // ---------- drawing ----------
  onResize() {
    const { w, h: ht } = this.size();
    if (!w || !ht) return;
    this.draw();
    clearTimeout(this.resizeTimer);
    if (this.data && (this.data.kind === 'lines' || this.data.kind === 'density')) {
      this.resizeTimer = setTimeout(() => this.fetch(), 200);
    }
  }

  draw() {
    const { w, h: ht } = this.size();
    if (!w || !ht) return;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.back, this.front]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(ht * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(ht * dpr);
      }
    }
    const back = new CanvasPainter(this.back.getContext('2d'), dpr);
    const front = new CanvasPainter(this.front.getContext('2d'), dpr);
    back.clear(w, ht, '#fff');
    front.clear(w, ht);
    if (!this.data) {
      this.points?.draw({ width: Math.round(w * dpr), height: Math.round(ht * dpr), rect: { x: 0, y: 0, w: 0, h: 0 }, sx: null, sy: {} });
      return;
    }
    const L = this.layout(w, ht);
    this.lastLayout = L;
    this.paintBack(back, L);
    if (this.data.kind === 'points') {
      if (this.points) this.points.draw(this.glFrame(L, dpr));
      else this.paintPointsVector(front, L, 30000);
    }
    this.paintFront(front, L);
  }

  glFrame(L, dpr) {
    const dev = (sc) => sc && new Scale(sc.d0, sc.d1, sc.r0 * dpr, sc.r1 * dpr, sc.log);
    const total = this.data.series.reduce((a, s) => a + s.n, 0);
    const base = this.spec.markerSize || (total < 2000 ? 6 : total < 30000 ? 4.5 : total < 300000 ? 3 : 2);
    return {
      width: Math.round(L.W * dpr),
      height: Math.round(L.H * dpr),
      rect: { x: L.plot.x * dpr, y: L.plot.y * dpr, w: L.plot.w * dpr, h: L.plot.h * dpr },
      sx: dev(L.sx),
      sy: { left: dev(L.syL), right: dev(L.syR || L.syL) },
      size: base * dpr,
      alpha: total > 300000 ? 0.45 : total > 30000 ? 0.65 : 0.85,
      cmode: this.data.colorMode === 'continuous' ? 1 : 0,
    };
  }

  paintBack(p, L) {
    const { plot } = L;
    p.rect(plot.x, plot.y, plot.w, plot.h, { fill: '#fff' });
    if (L.sx) for (const t of ticksFor(L.sx, L.xType, Math.max(2, Math.round(plot.w / 90)))) {
      const x = L.sx.map(t.v);
      if (x >= plot.x - 0.5 && x <= plot.x + plot.w + 0.5) p.line(x, plot.y, x, plot.y + plot.h, { stroke: GRID });
    }
    if (L.syL) for (const t of ticksFor(L.syL, L.kind === 'heatmap' ? this.data.yType : 'number', Math.max(2, Math.round(plot.h / 50)))) {
      const y = L.syL.map(t.v);
      if (y >= plot.y - 0.5 && y <= plot.y + plot.h + 0.5) p.line(plot.x, y, plot.x + plot.w, y, { stroke: GRID });
    }
  }

  paintFront(p, L) {
    const d = this.data;
    const { plot } = L;
    p.clip(plot.x, plot.y, plot.w, plot.h);
    if (d.kind === 'density') this.paintDensity(p, L);
    if (d.kind === 'lines') this.paintLines(p, L);
    if (d.kind === 'bars') this.paintBars(p, L);
    if (d.kind === 'histogram') this.paintHistogram(p, L);
    if (d.kind === 'box') this.paintBoxes(p, L);
    if (d.kind === 'heatmap') this.paintHeatmap(p, L);
    this.paintFits(p, L);
    p.unclip();
    this.paintAxes(p, L);
    this.paintLegend(p, L);
    this.paintFitLabels(p, L);
    if (d.sampled || d.truncated) {
      const note = d.sampled ? `Showing an even sample of ${(1_500_000).toLocaleString()} of ${d.total.toLocaleString()} points` : `Showing the ${d.labels.length} largest of ${(d.labels.length + d.truncated).toLocaleString()} categories`;
      p.text(note, plot.x + plot.w, plot.y + plot.h - 6, { size: 10, color: '#8a9099', align: 'right' });
    }
  }

  paintAxes(p, L) {
    const { plot } = L;
    const s = this.spec;
    const d = this.data;
    p.line(plot.x, plot.y + plot.h + 0.5, plot.x + plot.w, plot.y + plot.h + 0.5, { stroke: AXIS });
    p.line(plot.x - 0.5, plot.y, plot.x - 0.5, plot.y + plot.h, { stroke: AXIS });
    // X ticks
    if (L.sx) {
      const ticks = ticksFor(L.sx, L.xType, Math.max(2, Math.round(plot.w / 90)));
      for (const t of ticks) {
        const x = L.sx.map(t.v);
        if (x < plot.x - 1 || x > plot.x + plot.w + 1) continue;
        p.line(x, plot.y + plot.h, x, plot.y + plot.h + 4, { stroke: AXIS });
        p.text(t.label, x, plot.y + plot.h + 16, { size: 11, color: TEXT, align: 'center' });
      }
    } else if (L.xCats) {
      const every = L.rotate ? Math.max(1, Math.ceil(L.xCats.length / (plot.w / 14))) : 1;
      L.xCats.forEach((c, i) => {
        if (i % every) return;
        const x = plot.x + (i + 0.5) * L.xBand.w;
        const label = c.length > 28 ? `${c.slice(0, 27)}…` : c;
        if (L.rotate) p.text(label, x + 3, plot.y + plot.h + 12, { size: 11, color: TEXT, align: 'right', rotate: L.rotate });
        else p.text(label, x, plot.y + plot.h + 16, { size: 11, color: TEXT, align: 'center' });
      });
    }
    // Y ticks
    if (L.syL) {
      const ticks = ticksFor(L.syL, d.kind === 'heatmap' ? d.yType : 'number', Math.max(2, Math.round(plot.h / 50)));
      for (const t of ticks) {
        const y = L.syL.map(t.v);
        if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
        p.line(plot.x - 4, y, plot.x, y, { stroke: AXIS });
        p.text(t.label, plot.x - 7, y + 4, { size: 11, color: TEXT, align: 'right' });
      }
    } else if (L.yCats) {
      const every = Math.max(1, Math.ceil(L.yCats.length / (plot.h / 13)));
      L.yCats.forEach((c, i) => {
        if (i % every) return;
        p.text(c.length > 24 ? `${c.slice(0, 23)}…` : c, plot.x - 6, plot.y + plot.h - (i + 0.5) * L.yBand.h + 4, { size: 11, color: TEXT, align: 'right' });
      });
    }
    if (L.syR) {
      const x0 = plot.x + plot.w;
      p.line(x0 + 0.5, plot.y, x0 + 0.5, plot.y + plot.h, { stroke: AXIS });
      for (const t of L.yRTicks || []) {
        const y = L.syR.map(t.v);
        if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
        p.line(x0, y, x0 + 4, y, { stroke: AXIS });
        p.text(t.label, x0 + 7, y + 4, { size: 11, color: TEXT });
      }
      const right = (s.y || []).filter((y) => y.axis === 'right').map((y) => y.col).join(', ');
      p.text(right, L.W - L.legendW - (L.legendW ? 8 : 0) - 4, plot.y + plot.h / 2, { size: 11, color: TEXT, weight: 600, align: 'center', rotate: 90 });
    }
    // Axis titles
    const xTitle = d.kind === 'box' || d.kind === 'bars' ? s.x || '' : s.x || '';
    p.text(`${xTitle}${s.logX ? ' (log)' : ''}`, plot.x + plot.w / 2, L.H - 6, { size: 11.5, color: TEXT, weight: 600, align: 'center' });
    let yTitle;
    if (d.kind === 'histogram') yTitle = { count: 'Count', percent: 'Percent', density: 'Density' }[d.normalize];
    else if (d.kind === 'bars') yTitle = d.agg === 'count' ? 'Count' : `${aggLabel(d.agg)} of ${d.valueName}`;
    else yTitle = (s.y || []).filter((y) => (y.axis || 'left') === 'left').map((y) => y.col).join(', ');
    p.text(`${yTitle}${s.logY && !['bars', 'histogram'].includes(d.kind) ? ' (log)' : ''}`, 12, plot.y + plot.h / 2, { size: 11.5, color: TEXT, weight: 600, align: 'center', rotate: -90 });
  }

  paintLegend(p, L) {
    const lg = L.legend;
    if (!lg || !L.legendW) return;
    const x = L.W - L.legendW;
    let y = L.plot.y + 4;
    if (lg.title) {
      p.text(lg.title, x, y + 9, { size: 11, weight: 600, color: TEXT });
      y += 18;
    }
    if (lg.type === 'items') {
      const max = Math.floor((L.plot.h - 20) / 17);
      for (const it of lg.items.slice(0, max)) {
        p.rect(x, y, 11, 11, { fill: it.color });
        const label = it.label.length > 24 ? `${it.label.slice(0, 23)}…` : it.label;
        p.text(label, x + 16, y + 9.5, { size: 11, color: TEXT });
        y += 17;
      }
      if (lg.items.length > max) p.text(`+${lg.items.length - max} more`, x, y + 9, { size: 10, color: '#8a9099' });
      return;
    }
    const hgt = Math.min(160, L.plot.h - 30);
    const steps = 32;
    for (let i = 0; i < steps; i += 1) p.rect(x, y + (hgt * i) / steps, 14, hgt / steps + 0.6, { fill: rampCss(1 - i / (steps - 1)) });
    const [lo, hi] = lg.range || this.valueRange();
    const f = (v) => formatValue(v, lg.colorType || 'number');
    p.text(f(hi), x + 18, y + 9, { size: 10, color: TEXT });
    p.text(f(lo), x + 18, y + hgt, { size: 10, color: TEXT });
    if (this.data.kind === 'density') p.text('(log scale)', x, y + hgt + 14, { size: 10, color: '#8a9099' });
  }

  valueRange() {
    const d = this.data;
    if (d.kind === 'density') {
      let hi = 0;
      for (const c of d.counts) if (c > hi) hi = c;
      return [0, hi];
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of d.values) {
      if (Number.isNaN(v)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo <= hi ? [lo, hi] : [0, 1];
  }

  seriesColor(se, i) {
    return paletteColor(se.color ?? i);
  }

  paintLines(p, L) {
    const d = this.data;
    const any = d.markedSeries.length > 0;
    d.series.forEach((se, i) => {
      const sy = se.axis === 'right' ? L.syR : L.syL;
      const xs = new Float64Array(se.n);
      const ys = new Float64Array(se.n);
      for (let k = 0; k < se.n; k += 1) {
        xs[k] = L.sx.map(se.x[k]);
        ys[k] = sy.map(se.y[k]);
      }
      const color = this.seriesColor(se, i);
      p.polyline(xs, ys, se.n, { stroke: color, width: this.spec.lineWidth || 1.6, alpha: any ? 0.35 : 1 });
      if (this.spec.markers && se.n < 3000) for (let k = 0; k < se.n; k += 1) p.circle(xs[k], ys[k], 2.6, { fill: color, alpha: any ? 0.35 : 1 });
    });
    for (const ms of d.markedSeries) {
      const sy = ms.axis === 'right' ? L.syR : L.syL;
      for (let k = 0; k < ms.n; k += 1) p.circle(L.sx.map(ms.x[k]), sy.map(ms.y[k]), 2.4, { fill: MARK });
    }
  }

  paintDensity(p, L) {
    const d = this.data;
    let hi = 0;
    for (const c of d.counts) if (c > hi) hi = c;
    const img = document.createElement('canvas');
    img.width = d.w;
    img.height = d.h;
    const ctx = img.getContext('2d');
    const px = ctx.createImageData(d.w, d.h);
    const lmax = Math.log1p(hi) || 1;
    const anyMarked = d.marked.some((v) => v > 0);
    for (let i = 0; i < d.counts.length; i += 1) {
      const c = d.counts[i];
      if (!c) continue;
      let rgb = ramp(0.12 + 0.88 * (Math.log1p(c) / lmax));
      let a = 255;
      if (anyMarked) {
        if (d.marked[i]) rgb = [20, 23, 28];
        else a = 70;
      }
      px.data.set([rgb[0], rgb[1], rgb[2], a], i * 4);
    }
    ctx.putImageData(px, 0, 0);
    const v = d.view;
    const sy = v.axis === 'right' ? L.syR : L.syL;
    const x0 = L.sx.map(v.x0);
    const x1 = L.sx.map(v.x1);
    const y0 = sy.map(v.y1);
    const y1 = sy.map(v.y0);
    p.image(img, x0, y0, x1 - x0, y1 - y0);
  }

  paintPointsVector(p, L, limit) {
    const d = this.data;
    const any = d.series.some((s) => s.m.some((v) => v));
    for (const [si, se] of d.series.entries()) {
      const sy = se.axis === 'right' ? L.syR : L.syL;
      const step = Math.max(1, Math.ceil(se.n / limit));
      for (const pass of [0, 1]) {
        for (let k = 0; k < se.n; k += step) {
          if ((se.m[k] === 1) !== (pass === 1)) continue;
          const x = L.sx.map(se.x[k] + se.xOff);
          const y = sy.map(se.y[k] + se.yOff);
          const fill = d.colorMode === 'continuous' ? (se.c[k] < 0 ? '#bbb' : rampCss(se.c[k])) : paletteColor(d.colorMode === 'category' ? se.c[k] : si);
          p.circle(x, y, se.m[k] ? 3.2 : 2.4, { fill, stroke: se.m[k] ? MARK : null, width: 1, alpha: any && !se.m[k] ? 0.25 : 0.85 });
        }
      }
    }
  }

  paintBars(p, L) {
    const d = this.data;
    const s = this.spec;
    const ng = d.groups ? d.groups.length : 1;
    const any = !!d.marked;
    const band = L.xBand.w;
    const inner = band * 0.78;
    const y0 = L.syL.map(0);
    for (let c = 0; c < d.labels.length; c += 1) {
      let pos = 0;
      let neg = 0;
      for (let g = 0; g < ng; g += 1) {
        const v = d.values[c * ng + g];
        if (!Number.isFinite(v)) continue;
        const color = paletteColor(d.groups ? d.groupIds[g] : 0);
        let x;
        let w;
        let base;
        if (s.stacked && ng > 1) {
          x = L.plot.x + c * band + (band - inner) / 2;
          w = inner;
          base = v >= 0 ? pos : neg;
          if (v >= 0) pos += v;
          else neg += v;
        } else {
          w = inner / ng;
          x = L.plot.x + c * band + (band - inner) / 2 + g * w;
          base = 0;
        }
        const ya = L.syL.map(base);
        const yb = L.syL.map(base + v);
        p.rect(x + 0.5, Math.min(ya, yb), Math.max(1, w - 1), Math.abs(yb - ya), { fill: color, alpha: any ? 0.32 : 1 });
        if (any) {
          const m = d.marked[c * ng + g];
          if (Number.isFinite(m) && m) {
            const ym = L.syL.map(base + m);
            p.rect(x + 0.5, Math.min(ya, ym), Math.max(1, w - 1), Math.abs(ym - ya), { fill: color });
            p.rect(x + 0.5, Math.min(ya, ym), Math.max(1, w - 1), Math.abs(ym - ya), { stroke: MARK, width: 1.2 });
          }
        }
      }
    }
    p.line(L.plot.x, y0, L.plot.x + L.plot.w, y0, { stroke: AXIS });
  }

  paintHistogram(p, L) {
    const d = this.data;
    const e = d.edges;
    const ng = d.groups ? d.groups.length : 1;
    const any = !!d.marked;
    for (let k = 0; k < e.length - 1; k += 1) {
      const xa = L.sx.map(e[k]);
      const xb = L.sx.map(e[k + 1]);
      let base = 0;
      for (let g = 0; g < ng; g += 1) {
        const v = d.values[k * ng + g];
        if (!v) continue;
        const ya = L.syL.map(base);
        const yb = L.syL.map(base + v);
        p.rect(xa + 0.5, yb, Math.max(1, xb - xa - 1), ya - yb, { fill: paletteColor(d.groups ? d.groupIds[g] : 0), alpha: any ? 0.32 : 1 });
        base += v;
      }
      if (any && d.marked[k]) {
        const ya = L.syL.map(0);
        const yb = L.syL.map(d.marked[k]);
        p.rect(xa + 0.5, yb, Math.max(1, xb - xa - 1), ya - yb, { fill: paletteColor(0) });
        p.rect(xa + 0.5, yb, Math.max(1, xb - xa - 1), ya - yb, { stroke: MARK, width: 1.2 });
      }
    }
  }

  paintBoxes(p, L) {
    const d = this.data;
    const band = L.xBand.w;
    const any = !!d.marked;
    const drawBox = (st, i, width, opts) => {
      const cx = L.plot.x + (i + 0.5) * band;
      const sy = L.syL;
      const half = width / 2;
      const color = paletteColor(opts.color);
      p.line(cx, sy.map(st.whiskerLo), cx, sy.map(st.q1), { stroke: opts.stroke || '#555', alpha: opts.alpha });
      p.line(cx, sy.map(st.q3), cx, sy.map(st.whiskerHi), { stroke: opts.stroke || '#555', alpha: opts.alpha });
      for (const w of [st.whiskerLo, st.whiskerHi]) p.line(cx - half / 2, sy.map(w), cx + half / 2, sy.map(w), { stroke: opts.stroke || '#555', alpha: opts.alpha });
      p.rect(cx - half, sy.map(st.q3), width, sy.map(st.q1) - sy.map(st.q3), { fill: color, alpha: (opts.alpha ?? 1) * 0.75 });
      p.rect(cx - half, sy.map(st.q3), width, sy.map(st.q1) - sy.map(st.q3), { stroke: opts.stroke || '#333', alpha: opts.alpha });
      p.line(cx - half, sy.map(st.median), cx + half, sy.map(st.median), { stroke: '#111', width: 2, alpha: opts.alpha });
      const my = sy.map(st.mean);
      p.polygon([[cx, my - 4], [cx + 4, my], [cx, my + 4], [cx - 4, my]], { fill: '#fff', stroke: '#111', alpha: opts.alpha });
      if (opts.outliers) for (const o of st.outliers) p.circle(cx, sy.map(o), 2.2, { stroke: '#555', alpha: opts.alpha });
    };
    d.stats.forEach((st) => {
      const i = d.stats.indexOf(st);
      drawBox(st, i, Math.min(60, band * 0.55), { color: this.spec.color ? i : 0, alpha: any ? 0.35 : 1, outliers: true });
    });
    if (any) for (const st of d.marked) {
      const i = d.stats.findIndex((x) => x.cat === st.cat);
      if (i >= 0) drawBox(st, i, Math.min(30, band * 0.28), { color: this.spec.color ? i : 0, stroke: MARK, outliers: false });
    }
  }

  paintHeatmap(p, L) {
    const d = this.data;
    const [lo, hi] = this.valueRange();
    const span = hi - lo || 1;
    for (let b = 0; b < d.ny; b += 1) {
      for (let a = 0; a < d.nx; a += 1) {
        const v = d.values[b * d.nx + a];
        if (Number.isNaN(v)) continue;
        let x0;
        let x1;
        let y0;
        let y1;
        if (d.xEdges) {
          x0 = L.sx.map(d.xEdges[a]);
          x1 = L.sx.map(d.xEdges[a + 1]);
        } else {
          x0 = L.plot.x + a * L.xBand.w;
          x1 = x0 + L.xBand.w;
        }
        if (d.yEdges) {
          y0 = L.syL.map(d.yEdges[b + 1]);
          y1 = L.syL.map(d.yEdges[b]);
        } else {
          y1 = L.plot.y + L.plot.h - b * L.yBand.h;
          y0 = y1 - L.yBand.h;
        }
        p.rect(x0, y0, x1 - x0 + 0.4, y1 - y0 + 0.4, { fill: rampCss((v - lo) / span) });
      }
    }
  }

  paintFits(p, L) {
    const fits = (this.spec.fits || []).filter((f) => f.result);
    if (!fits.length || !L.sx) return;
    fits.forEach((f, i) => {
      const fn = curveFn(f.result);
      const sy = (this.spec.y?.[f.series || 0]?.axis === 'right' ? L.syR : L.syL) || L.syL;
      const n = 400;
      const xs = new Float64Array(n);
      const ys = new Float64Array(n);
      const a = L.sx.d0;
      const b = L.sx.d1;
      for (let k = 0; k < n; k += 1) {
        const v = L.sx.log ? 10 ** (Math.log10(a) + ((Math.log10(b) - Math.log10(a)) * k) / (n - 1)) : a + ((b - a) * k) / (n - 1);
        const yv = fn(v);
        xs[k] = L.sx.map(v);
        ys[k] = Number.isFinite(yv) ? Math.max(-1e6, Math.min(1e6, sy.map(yv))) : NaN;
      }
      p.polyline(xs, ys, n, { stroke: FIT_COLORS[i % FIT_COLORS.length], width: 2.2 });
    });
  }

  paintFitLabels(p, L) {
    const fits = (this.spec.fits || []).filter((f) => f.result);
    if (!fits.length) return;
    const lines = fits.map((f) => `${f.result.label || (f.result.model === 'linear' ? 'Linear' : `Polynomial (degree ${f.result.degree})`)}: ${fitText(f.result)}`);
    const w = Math.min(L.plot.w - 16, Math.max(...lines.map((l) => textWidth(l, 11))) + 18);
    const x = L.plot.x + 8;
    const y = L.plot.y + 8;
    p.rect(x, y, w, lines.length * 16 + 8, { fill: '#ffffff', alpha: 0.92 });
    p.rect(x, y, w, lines.length * 16 + 8, { stroke: '#d5d9df' });
    lines.forEach((l, i) => {
      p.rect(x + 6, y + 9 + i * 16, 8, 3, { fill: FIT_COLORS[i % FIT_COLORS.length] });
      p.text(l, x + 18, y + 15 + i * 16, { size: 11, color: '#262a30' });
    });
  }

  // ---------- interaction ----------
  bind() {
    const body = this.body;
    let drag = null;
    const local = (e) => {
      const r = body.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    body.addEventListener('contextmenu', (e) => e.preventDefault());
    body.addEventListener('mousedown', (e) => {
      if (!this.lastLayout || !this.data) return;
      const at = local(e);
      const tool = e.button === 2 || e.button === 1 ? 'pan' : this.tool;
      e.preventDefault();
      this.el.focus({ preventScroll: true });
      drag = { tool, start: at, at, view: this.currentView(), mods: { add: e.ctrlKey || e.metaKey || e.shiftKey, sub: e.altKey } };
      this.hideTip();
    });
    window.addEventListener('mousemove', (e) => {
      if (!drag) return;
      const at = local(e);
      drag.at = at;
      if (drag.tool === 'pan') this.panTo(drag);
      else this.showBrush(drag);
    });
    window.addEventListener('mouseup', () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      this.brush.style.display = 'none';
      const moved = Math.abs(d.at.x - d.start.x) + Math.abs(d.at.y - d.start.y) > 4;
      if (d.tool === 'pan') {
        if (moved) this.commitView();
        return;
      }
      if (d.tool === 'zoom') {
        if (moved) this.zoomBox(d);
        return;
      }
      this.markFrom(d, moved);
    });
    body.addEventListener('mousemove', (e) => {
      if (drag) return;
      cancelAnimationFrame(this.hoverRaf);
      const at = local(e);
      this.hoverRaf = requestAnimationFrame(() => this.hover(at));
    });
    body.addEventListener('mouseleave', () => this.hideTip());
    body.addEventListener('wheel', (e) => {
      if (!this.lastLayout || !['points', 'density', 'lines', 'histogram'].includes(this.data?.kind)) return;
      e.preventDefault();
      const at = local(e);
      const f = Math.exp(Math.sign(e.deltaY) * Math.min(0.5, Math.abs(e.deltaY) / 400));
      const yToo = this.data.kind === 'points' || this.data.kind === 'density' ? !e.shiftKey : e.ctrlKey;
      this.zoomAt(at, f, !(e.ctrlKey && this.data.kind === 'lines'), yToo);
    }, { passive: false });
    body.addEventListener('dblclick', () => this.resetView());
    this.el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.ctx.clearMark?.();
    });
  }

  currentView() {
    const L = this.lastLayout;
    if (!L?.sx) return null;
    return { x: [L.sx.d0, L.sx.d1], left: L.syL ? [L.syL.d0, L.syL.d1] : null, right: L.syR ? [L.syR.d0, L.syR.d1] : null };
  }

  invert(sc, px) {
    return sc.invert(px);
  }

  panTo(d) {
    const L = this.lastLayout;
    if (!d.view || !L.sx) return;
    const shift = (sc, dom, delta) => {
      if (!dom) return null;
      const s2 = new Scale(dom[0], dom[1], sc.r0, sc.r1, sc.log);
      return [s2.invert(s2.r0 - delta), s2.invert(s2.r1 - delta)];
    };
    const dx = d.at.x - d.start.x;
    const dy = d.at.y - d.start.y;
    const yPan = this.data.kind !== 'histogram';
    this.view = {
      x: shift(L.sx, d.view.x, dx),
      left: yPan ? shift(L.syL, d.view.left, dy) : d.view.left,
      right: yPan && L.syR ? shift(L.syR, d.view.right, dy) : d.view.right,
    };
    this.draw();
    this.scheduleViewFetch();
  }

  zoomAt(at, f, xToo, yToo) {
    const L = this.lastLayout;
    const v = this.currentView();
    if (!v) return;
    const zoom = (sc, dom, px) => {
      const s2 = new Scale(dom[0], dom[1], sc.r0, sc.r1, sc.log);
      const c = s2.tf(s2.invert(px));
      const a = s2.tf(dom[0]);
      const b = s2.tf(dom[1]);
      const back = (t) => (sc.log ? 10 ** t : t);
      return [back(c + (a - c) * f), back(c + (b - c) * f)];
    };
    this.view = {
      x: xToo ? zoom(L.sx, v.x, at.x) : v.x,
      left: yToo && v.left && this.data.kind !== 'histogram' ? zoom(L.syL, v.left, at.y) : v.left,
      right: yToo && v.right ? zoom(L.syR, v.right, at.y) : v.right,
    };
    this.draw();
    this.scheduleViewFetch();
  }

  zoomBox(d) {
    const L = this.lastLayout;
    const v = this.currentView();
    if (!v) return;
    const xa = Math.min(d.start.x, d.at.x);
    const xb = Math.max(d.start.x, d.at.x);
    const ya = Math.min(d.start.y, d.at.y);
    const yb = Math.max(d.start.y, d.at.y);
    const thin = Math.abs(yb - ya) < 6;
    this.view = {
      x: [L.sx.invert(xa), L.sx.invert(xb)],
      left: thin || this.data.kind === 'histogram' ? v.left : [L.syL.invert(yb), L.syL.invert(ya)],
      right: thin || !L.syR ? v.right : [L.syR.invert(yb), L.syR.invert(ya)],
    };
    this.commitView();
  }

  commitView() {
    this.draw();
    this.scheduleViewFetch(0);
    this.ctx.changed?.(this);
  }

  scheduleViewFetch(ms = 60) {
    if (!this.data || !['lines', 'density'].includes(this.data.kind)) return;
    clearTimeout(this.viewTimer);
    this.viewTimer = setTimeout(() => this.fetch(), ms);
  }

  resetView() {
    this.view = null;
    this.draw();
    if (this.data && ['lines', 'density'].includes(this.data.kind)) this.fetch();
    this.ctx.changed?.(this);
  }

  showBrush(d) {
    const L = this.lastLayout;
    const kind = this.data.kind;
    let x0 = Math.min(d.start.x, d.at.x);
    let x1 = Math.max(d.start.x, d.at.x);
    let y0 = Math.min(d.start.y, d.at.y);
    let y1 = Math.max(d.start.y, d.at.y);
    const xOnly = d.tool === 'mark' && ['bars', 'histogram', 'box'].includes(kind);
    if (xOnly) {
      y0 = L.plot.y;
      y1 = L.plot.y + L.plot.h;
    }
    x0 = Math.max(L.plot.x, x0);
    x1 = Math.min(L.plot.x + L.plot.w, x1);
    Object.assign(this.brush.style, { display: 'block', left: `${x0}px`, top: `${y0}px`, width: `${Math.max(0, x1 - x0)}px`, height: `${Math.max(0, y1 - y0)}px` });
    this.brush.classList.toggle('zoom', d.tool === 'zoom');
  }

  // Turns a drag (or click) into a marking request for the worker.
  async markFrom(d, moved) {
    const L = this.lastLayout;
    const kind = this.data?.kind;
    if (!kind) return;
    const mode = d.mods.sub ? 'subtract' : d.mods.add ? 'add' : 'replace';
    const xa = Math.min(d.start.x, d.at.x);
    const xb = Math.max(d.start.x, d.at.x);
    const ya = Math.min(d.start.y, d.at.y);
    const yb = Math.max(d.start.y, d.at.y);
    let sel = null;
    if (kind === 'points' || kind === 'lines' || kind === 'density') {
      if (!moved) {
        const near = this.nearestLocal(d.at);
        if (near) return this.ctx.markRows?.([near.row], mode === 'replace' ? 'replace' : mode === 'subtract' ? 'subtract' : 'toggle');
        if (mode === 'replace') return this.ctx.clearMark?.();
        return undefined;
      }
      const axis = L.syR && d.start.x > L.plot.x + L.plot.w * 0.5 && this.spec.y.some((y) => y.axis === 'right') && this.spec.y.every((y) => y.axis === 'right') ? 'right' : 'left';
      const sy = axis === 'right' ? L.syR : L.syL;
      const xs = [L.sx.invert(xa), L.sx.invert(xb)].sort((a, b) => a - b);
      const ys = [sy.invert(yb), sy.invert(ya)].sort((a, b) => a - b);
      sel = { x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1], axis };
      if (this.spec.y.some((y) => (y.axis || 'left') !== axis)) {
        // Mixed axes: mark by x range only so both series count.
        if (L.syR) sel = { x0: xs[0], x1: xs[1], y0: NaN, y1: NaN, axis };
      }
    } else if (kind === 'histogram') {
      const e = this.data.edges;
      const lo = L.sx.invert(moved ? xa : d.at.x);
      const hi = L.sx.invert(moved ? xb : d.at.x);
      let k0 = e.findIndex((v, k) => k < e.length - 1 && e[k + 1] > lo);
      let k1 = e.findIndex((v, k) => k < e.length - 1 && e[k + 1] >= hi);
      if (k0 < 0 || (k1 < 0 && hi > e[e.length - 1] && lo > e[e.length - 1])) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      if (k1 < 0) k1 = e.length - 2;
      k0 = Math.max(0, k0);
      sel = { x0: e[k0], x1: e[k1 + 1] };
    } else if (kind === 'bars' || kind === 'box') {
      const n = L.xBand.n;
      const i0 = Math.floor((xa - L.plot.x) / L.xBand.w);
      const i1 = Math.floor((xb - L.plot.x) / L.xBand.w);
      if (!moved && (i0 < 0 || i0 >= n || d.at.y < L.plot.y || d.at.y > L.plot.y + L.plot.h)) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      const ids = kind === 'bars' ? this.data.cats : this.data.stats.map((s) => s.cat);
      const cats = [];
      for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i += 1) cats.push(ids[i]);
      if (!cats.length) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      sel = { cats };
    } else if (kind === 'heatmap') {
      const dd = this.data;
      const cellX = (px) => (dd.xEdges ? dd.xEdges.findIndex((v, k) => k < dd.nx && dd.xEdges[k + 1] > L.sx.invert(px)) : Math.floor((px - L.plot.x) / L.xBand.w));
      const cellY = (py) => (dd.yEdges ? dd.yEdges.findIndex((v, k) => k < dd.ny && dd.yEdges[k + 1] > L.syL.invert(py)) : Math.floor((L.plot.y + L.plot.h - py) / L.yBand.h));
      const ax = [cellX(moved ? xa : d.at.x), cellX(moved ? xb : d.at.x)];
      const ay = [cellY(moved ? yb : d.at.y), cellY(moved ? ya : d.at.y)];
      const range = (a, b, n) => {
        const lo = a < 0 ? 0 : a;
        const hi = b < 0 ? n - 1 : b;
        return Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k);
      };
      sel = { xcats: range(ax[0], ax[1], dd.nx), ycats: range(ay[0], ay[1], dd.ny) };
    }
    if (sel) await this.ctx.mark?.(this, sel, mode);
    return undefined;
  }

  nearestLocal(at) {
    const L = this.lastLayout;
    const d = this.data;
    if (!L || !d) return null;
    let best = null;
    let bestD = 7 * 7;
    if (d.kind === 'points') {
      d.series.forEach((se, si) => {
        const sy = se.axis === 'right' ? L.syR : L.syL;
        const step = se.n > 400000 ? 2 : 1;
        for (let k = 0; k < se.n; k += step) {
          const dx = L.sx.map(se.x[k] + se.xOff) - at.x;
          if (dx > 7 || dx < -7) continue;
          const dy = sy.map(se.y[k] + se.yOff) - at.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestD) {
            bestD = dist;
            best = { row: se.rows[k], x: se.x[k] + se.xOff, y: se.y[k] + se.yOff, series: se.name, si };
          }
        }
      });
    } else if (d.kind === 'lines') {
      d.series.forEach((se) => {
        const sy = se.axis === 'right' ? L.syR : L.syL;
        for (let k = 0; k < se.n; k += 1) {
          const dx = L.sx.map(se.x[k]) - at.x;
          const dy = sy.map(se.y[k]) - at.y;
          const dist = dx * dx + dy * dy;
          if (dist < bestD) {
            bestD = dist;
            best = { x: se.x[k], y: se.y[k], series: se.name };
          }
        }
      });
    }
    return best;
  }

  async hover(at) {
    const L = this.lastLayout;
    const d = this.data;
    if (!L || !d) return;
    const { plot } = L;
    if (at.x < plot.x || at.x > plot.x + plot.w || at.y < plot.y || at.y > plot.y + plot.h) return this.hideTip();
    const s = this.spec;
    const xT = d.xType || 'number';
    let html = null;
    if (d.kind === 'points' || d.kind === 'lines') {
      const near = this.nearestLocal(at);
      if (near) {
        html = `<b>${esc(near.series)}</b>: ${esc(formatValue(near.y, 'number'))}<br>${esc(s.x)}: ${esc(formatValue(near.x, xT))}`;
        if (near.row != null) {
          const token = (this.tipToken = (this.tipToken || 0) + 1);
          this.showTip(at, html);
          const row = await this.ctx.client.call('row', near.row).catch(() => null);
          if (row && token === this.tipToken) {
            const entries = Object.entries(row).slice(0, 10);
            this.showTip(at, entries.map(([k, v]) => `<span class="k">${esc(k)}</span> ${esc(v)}`).join('<br>') + (Object.keys(row).length > 10 ? '<br><span class="k">…</span>' : ''));
          }
          return undefined;
        }
      } else {
        const sy = L.syL;
        html = `${esc(s.x)}: ${esc(formatValue(L.sx.invert(at.x), xT))}<br>${esc(formatValue(sy.invert(at.y), 'number'))}`;
        this.showTip(at, html, true);
        return undefined;
      }
    } else if (d.kind === 'density') {
      const v = d.view;
      const sy = v.axis === 'right' ? L.syR : L.syL;
      const x0 = L.sx.map(v.x0);
      const x1 = L.sx.map(v.x1);
      const y0 = sy.map(v.y1);
      const y1 = sy.map(v.y0);
      const a = Math.floor(((at.x - x0) / (x1 - x0)) * d.w);
      const b = Math.floor(((at.y - y0) / (y1 - y0)) * d.h);
      const c = a >= 0 && b >= 0 && a < d.w && b < d.h ? d.counts[b * d.w + a] : 0;
      html = `${esc(s.x)}: ${esc(formatValue(L.sx.invert(at.x), xT))}<br>${esc(s.y[0].col)}: ${esc(formatValue(sy.invert(at.y), 'number'))}<br>Rows here: ${c.toLocaleString()}`;
    } else if (d.kind === 'bars') {
      const i = Math.floor((at.x - plot.x) / L.xBand.w);
      if (i >= 0 && i < d.labels.length) {
        const ng = d.groups ? d.groups.length : 1;
        const rows = Array.from({ length: ng }, (_, g) => {
          const v = d.values[i * ng + g];
          const m = d.marked?.[i * ng + g];
          return `${d.groups ? `${esc(d.groups[g])}: ` : ''}${esc(formatValue(v, 'number'))}${m ? ` <span class="k">(marked ${esc(formatValue(m, 'number'))})</span>` : ''}`;
        });
        html = `<b>${esc(d.labels[i])}</b><br>${rows.join('<br>')}`;
      }
    } else if (d.kind === 'histogram') {
      const v = L.sx.invert(at.x);
      const k = d.edges.findIndex((e, j) => j < d.edges.length - 1 && d.edges[j + 1] > v && e <= v);
      if (k >= 0) {
        const ng = d.groups ? d.groups.length : 1;
        let sum = 0;
        for (let g = 0; g < ng; g += 1) sum += d.values[k * ng + g];
        html = `<b>${esc(formatValue(d.edges[k], xT))} – ${esc(formatValue(d.edges[k + 1], xT))}</b><br>${esc(formatValue(sum, 'number'))}${d.marked?.[k] ? `<br><span class="k">marked</span> ${esc(formatValue(d.marked[k], 'number'))}` : ''}`;
      }
    } else if (d.kind === 'box') {
      const i = Math.floor((at.x - plot.x) / L.xBand.w);
      const st = d.stats[i];
      if (st) {
        const f = (v) => esc(formatValue(v, 'number'));
        html = `<b>${esc(st.label)}</b><br>n ${st.n.toLocaleString()}<br>max ${f(st.max)}<br>Q3 ${f(st.q3)}<br>median ${f(st.median)}<br>mean ${f(st.mean)}<br>Q1 ${f(st.q1)}<br>min ${f(st.min)}${st.outlierCount ? `<br>${st.outlierCount.toLocaleString()} outliers` : ''}`;
      }
    } else if (d.kind === 'heatmap') {
      const a = d.xEdges ? d.xEdges.findIndex((e, k) => k < d.nx && d.xEdges[k + 1] > L.sx.invert(at.x)) : Math.floor((at.x - plot.x) / L.xBand.w);
      const b = d.yEdges ? d.yEdges.findIndex((e, k) => k < d.ny && d.yEdges[k + 1] > L.syL.invert(at.y)) : Math.floor((plot.y + plot.h - at.y) / L.yBand.h);
      if (a >= 0 && b >= 0 && a < d.nx && b < d.ny) {
        const v = d.values[b * d.nx + a];
        html = `${esc(s.x)}: ${esc(d.xLabels[a])}<br>${esc(s.y[0].col)}: ${esc(d.yLabels[b])}<br><b>${esc(d.agg === 'count' ? 'Rows' : `${aggLabel(d.agg)} of ${d.valueName}`)}: ${Number.isNaN(v) ? '—' : esc(formatValue(v, 'number'))}</b>`;
      }
    }
    if (html) this.showTip(at, html);
    else this.hideTip();
    return undefined;
  }

  showTip(at, html, faint = false) {
    this.tip.innerHTML = html;
    this.tip.classList.toggle('faint', faint);
    this.tip.style.display = 'block';
    const W = this.body.clientWidth;
    const tw = this.tip.offsetWidth;
    const th = this.tip.offsetHeight;
    this.tip.style.left = `${at.x + 14 + tw > W ? at.x - tw - 10 : at.x + 14}px`;
    this.tip.style.top = `${Math.max(4, Math.min(this.body.clientHeight - th - 4, at.y - th / 2))}px`;
  }

  hideTip() {
    this.tip.style.display = 'none';
  }

  // ---------- export ----------
  renderPointsImage(L, scale) {
    const canvas = document.createElement('canvas');
    const layer = new PointLayer(canvas);
    layer.setData(this.data.series);
    layer.draw(this.glFrame(L, scale));
    return { canvas, layer };
  }

  toSvg(width, height) {
    const { w, h: ht } = this.size();
    const W = width || w;
    const H = height || ht;
    const L = this.layout(W, H);
    const p = new SvgPainter(W, H);
    p.clear(W, H, '#fff');
    p.text(this.spec.title || autoTitle(this.spec), L.plot.x, 0, { size: 0.01, color: '#fff' });
    if (!this.data) return p.toString();
    this.paintBack(p, L);
    if (this.data.kind === 'points') {
      const total = this.data.series.reduce((a, s) => a + s.n, 0);
      if (total <= 20000 || this.glFailed) {
        p.clip(L.plot.x, L.plot.y, L.plot.w, L.plot.h);
        this.paintPointsVector(p, L, 20000);
        p.unclip();
      } else {
        const { canvas, layer } = this.renderPointsImage(L, 2);
        p.image(canvas.toDataURL('image/png'), 0, 0, W, H, true);
        layer.dispose();
      }
    }
    this.paintFront(p, L);
    return p.toString();
  }

  toPng(scale = 2) {
    const { w, h: ht } = this.size();
    const L = this.layout(w, ht);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(ht * scale);
    const p = new CanvasPainter(canvas.getContext('2d'), scale);
    p.clear(w, ht, '#fff');
    if (this.data) {
      this.paintBack(p, L);
      if (this.data.kind === 'points') {
        if (this.glFailed) this.paintPointsVector(p, L, 200000);
        else {
          const img = this.renderPointsImage(L, scale);
          p.image(img.canvas, 0, 0, w, ht, true);
          img.layer.dispose();
        }
      }
      this.paintFront(p, L);
    }
    return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  }

  destroy() {
    this.ro.disconnect();
    this.points?.dispose();
    this.token += 1;
    this.el.remove();
  }
}

export function fitText(r) {
  const f = (v) => (Number.isFinite(v) ? String(Number(v.toPrecision(4))) : '—');
  if (r.model === 'linear' || r.model === 'poly') return `${r.equation.replace(/(-?\d+\.\d{5,})/g, (m) => f(Number(m)))}   R² = ${f(r.r2)}`;
  return `${r.paramNames.map((n, i) => `${n} = ${f(r.coef[i])}`).join(', ')}   R² = ${f(r.r2)}`;
}
