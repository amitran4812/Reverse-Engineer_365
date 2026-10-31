// One visualization on the analysis page: fetches what it draws from the
// data worker, paints axes and marks on canvases (points through WebGL),
// and handles marking, zooming, panning and hover.

import { PointLayer } from './gl.js';
import { CanvasPainter, SvgPainter, darkScreen, onDarkChange, textWidth } from './painter.js';
import { MARK, Scale, formatValue, padRange, paletteColor, ramp, rampCss, ticksFor } from './axes.js';
import { curveFn } from './fit.js';
import { MARKER_SHAPES } from './engine.js';
import { icon } from '../../shared/icons.js';

export const PLOT_TYPES = {
  scatter: { label: 'Scatter', icon: 'chartScatter' },
  line: { label: 'Line', icon: 'chartLine' },
  bar: { label: 'Bar', icon: 'chartBar' },
  histogram: { label: 'Histogram', icon: 'chartHist' },
  box: { label: 'Box', icon: 'chartBox' },
  heatmap: { label: 'Heat map', icon: 'chartHeat' },
  pie: { label: 'Pie', icon: 'chartPie' },
  table: { label: 'Cross table', icon: 'chartTable' },
  waterfall: { label: 'Waterfall', icon: 'chartWaterfall' },
  combo: { label: 'Combination', icon: 'chartCombo' },
  treemap: { label: 'Treemap', icon: 'chartTreemap' },
  parallel: { label: 'Parallel coordinates', icon: 'chartParallel' },
  kpi: { label: 'KPI', icon: 'chartKpi' },
  text: { label: 'Text area', icon: 'textArea' },
};

const FIT_COLORS = ['#b3261e', '#6a1b9a', '#00695c', '#e65100'];
const GRID = '#e8ebef';
const AXIS = '#7d858f';
const AXIS_W = 1.5;
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
    case 'pie': return ys.length ? `${aggLabel(spec.agg)} of ${ys[0]} by ${spec.x || '…'}` : `Rows by ${spec.x || '…'}`;
    case 'waterfall': return ys.length ? `${aggLabel(spec.agg)} of ${ys[0]} by ${spec.x || '…'} (running total)` : `Rows by ${spec.x || '…'} (running total)`;
    case 'combo': return `${ys.join(' and ') || '…'} by ${spec.x || '…'}`;
    case 'treemap': return ys.length ? `${aggLabel(spec.agg)} of ${ys[0]} by ${spec.x || '…'}` : `Rows by ${spec.x || '…'}`;
    case 'kpi': return ys.length ? `${aggLabel(spec.agg)} of ${ys[0]}${spec.x ? ` by ${spec.x}` : ''}` : `Rows${spec.x ? ` by ${spec.x}` : ''}`;
    case 'parallel': return `Parallel coordinates of ${(spec.cols?.length ? spec.cols : ys).join(', ') || '…'}`;
    case 'text': return 'Text';
    case 'table': return `${ys.length ? `${aggLabel(spec.agg)} of ${ys[0]}` : 'Rows'} by ${[spec.x, spec.color].filter(Boolean).join(' and ') || 'all rows'}`;
    default: return `${ys.join(', ') || '…'} vs ${spec.x || '…'}`;
  }
}

export const AGGS = [
  { value: 'count', label: 'Count' }, { value: 'sum', label: 'Sum' }, { value: 'mean', label: 'Average' }, { value: 'median', label: 'Median' },
  { value: 'min', label: 'Min' }, { value: 'max', label: 'Max' }, { value: 'std', label: 'Std. deviation' },
];
const aggLabel = (a) => AGGS.find((x) => x.value === a)?.label || 'Sum';
const AGG_SHORT = { count: 'Count', sum: 'Sum', mean: 'Avg', median: 'Median', min: 'Min', max: 'Max', std: 'StdDev' };
const STRIP = { pie: true, table: true, treemap: true, kpi: true, parallel: true };
const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));
// A manual axis range from the properties, applied over the automatic one.
const ranged = (dom, a) => (a && (num(a.min) != null || num(a.max) != null) ? [num(a.min) ?? dom[0], num(a.max) ?? dom[1]] : dom);
// Cuts text to fit a width, with an ellipsis.
const shorten = (text, w, size) => {
  let t = String(text ?? '');
  if (textWidth(t, size) <= w) return t;
  while (t.length > 1 && textWidth(`${t}…`, size) > w) t = t.slice(0, -1);
  return `${t}…`;
};
const shapeName = (i) => MARKER_SHAPES[((Math.round(i) % MARKER_SHAPES.length) + MARKER_SHAPES.length) % MARKER_SHAPES.length];

export class PlotView {
  constructor(spec, ctx) {
    this.spec = spec;
    this.ctx = ctx;
    this.data = null;
    this.error = null;
    this.token = 0;
    this.tool = 'mark';
    this.el = h('div', ctx.panel ? 'viz viz-panel' : 'viz');
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
    const props = h('button', 'viz-btn', icon('settings', 14));
    props.title = 'Properties (Alt+Enter)';
    props.onclick = () => ctx.properties?.(this);
    tools.append(props);
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
    this.selectors = h('div', 'viz-selectors');
    this.body.append(this.back, this.glCanvas, this.front, this.brush, this.selectors, this.tip, this.msg);
    this.el.append(head, this.body);
    this.el.addEventListener('mousedown', () => ctx.activate?.(this), true);
    this.setTool('mark');
    this.bind();
    this.ro = new ResizeObserver(() => this.onResize());
    this.ro.observe(this.body);
    this.offTheme = onDarkChange(() => this.draw());
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
    for (const v of this.panels || []) v.setTool(t);
    for (const [id, b] of Object.entries(this.toolButtons)) b.classList.toggle('on', id === t);
    this.body.dataset.tool = t;
  }

  updateHead() {
    this.titleEl.textContent = this.spec.title || autoTitle(this.spec);
    const zoomable = ['scatter', 'line', 'histogram'].includes(this.spec.type);
    this.toolButtons.zoom.hidden = !zoomable;
    this.toolButtons.pan.hidden = !zoomable;
    this.toolButtons.mark.hidden = this.spec.type === 'text';
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
    if (this.isTrellis()) return this.fetchTrellis(token);
    if (this.panels) this.clearPanels();
    if (s.type === 'text') return this.showText();
    this.textEl?.remove();
    this.textEl = null;
    if (s.type === 'parallel') {
      if ((s.cols?.length ? s.cols : (s.y || []).map((y) => y.col).filter(Boolean)).length < 2) return this.showMessage('Choose at least two number columns.');
    } else if (!s.x && !['box', 'bar', 'table', 'kpi'].includes(s.type)) return this.showMessage(s.type === 'pie' ? 'Choose a column for the slices.' : 'Choose a column for the X axis.');
    if (['scatter', 'line', 'box', 'heatmap'].includes(s.type) && !s.y?.[0]?.col) return this.showMessage('Choose a column for the Y axis.');
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

  // A text area: notes typed straight onto the page, kept in the spec.
  showText() {
    this.data = { kind: 'text' };
    this.msg.className = 'viz-msg';
    if (!this.textEl) {
      const t = h('div', 'viz-text');
      t.contentEditable = 'true';
      t.spellcheck = true;
      t.dataset.placeholder = 'Type notes about this page…';
      t.textContent = this.spec.text || '';
      t.oninput = () => {
        this.spec.text = t.innerText;
        this.ctx.changed?.(this);
      };
      t.addEventListener('mousedown', (e) => e.stopPropagation());
      t.addEventListener('keydown', (e) => e.stopPropagation());
      this.body.append(t);
      this.textEl = t;
    }
    this.draw();
  }

  // ---------- trellis ----------
  isTrellis() {
    const t = this.spec.trellis;
    if (!t || this.ctx.panel) return false;
    return t.mode === 'grid' ? !!(t.rows || t.cols) : !!t.by;
  }

  // Splits the visualization into panels, one per category, each a
  // small visualization of its own over that category's rows.
  async fetchTrellis(token) {
    const s = this.spec;
    const t = s.trellis;
    let res;
    try {
      res = await this.ctx.client.call('trellis', s);
    } catch (err) {
      if (token === this.token) this.showMessage(err.message || String(err));
      return;
    }
    if (token !== this.token) return;
    if (!res.panels.length) {
      this.clearPanels();
      this.showMessage('No rows to split into panels.');
      return;
    }
    this.msg.className = 'viz-msg';
    this.data = null;
    this.body.classList.add('viz-trellis');
    if (!this.panelBox) {
      this.panelBox = h('div', 'viz-panels');
      this.panelNote = h('div', 'viz-panels-note');
      this.body.append(this.panelBox, this.panelNote);
    }
    const n = res.panels.length;
    const cols = res.mode === 'grid' ? res.cols : Math.max(1, Math.min(n, num(t.columns) || Math.ceil(Math.sqrt(n * 1.4))));
    this.panelBox.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    this.panelBox.style.gridTemplateRows = `repeat(${Math.ceil(n / cols)}, minmax(90px, 1fr))`;
    this.panelNote.textContent = res.hidden ? `${res.hidden.toLocaleString()} more panels are not shown. Raise the panel limit in Properties › Trellis.` : '';
    this.panelNote.hidden = !res.hidden;
    const base = JSON.parse(JSON.stringify({ ...s, fits: [], view: null, trellis: null, title: null }));
    const old = this.panels || [];
    const childCtx = {
      ...this.ctx,
      panel: true,
      noGl: true,
      activate: () => this.ctx.activate?.(this),
      remove: () => this.ctx.remove?.(this),
      rename: () => this.ctx.rename?.(this),
      properties: () => this.ctx.properties?.(this),
      contextMenu: (v, x, y) => this.ctx.contextMenu?.(this, x, y),
      axisMenu: null,
      axisPick: null,
      changed: () => {},
    };
    this.panels = res.panels.map((p, i) => {
      const spec = { ...JSON.parse(JSON.stringify(base)), id: `${s.id}-${i}`, panel: p.panel, title: p.label || '(empty)', sharedAxes: t.shared !== false };
      // One legend is enough: the first panel carries it.
      if (i > 0) spec.legend = { ...(spec.legend || {}), show: false };
      const prev = old[i];
      if (prev && JSON.stringify(prev.spec.panel) === JSON.stringify(p.panel)) {
        spec.view = prev.spec.view;
        prev.spec = spec;
        prev.updateHead();
        return prev;
      }
      prev?.destroy();
      const v = new PlotView(spec, childCtx);
      v.setTool(this.tool);
      return v;
    });
    for (const v of old.slice(n)) v.destroy();
    this.panelBox.replaceChildren(...this.panels.map((v) => v.el));
    for (const v of this.panels) v.fetch();
  }

  clearPanels() {
    for (const v of this.panels || []) v.destroy();
    this.panels = null;
    this.panelBox?.remove();
    this.panelNote?.remove();
    this.panelBox = null;
    this.panelNote = null;
    this.body.classList.remove('viz-trellis');
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
    if (this.ctx.noGl) this.glFailed = true;
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
    if (kind === 'pie') return this.layoutPie(L, data);
    if (kind === 'table') return this.layoutTable(L, data);
    if (kind === 'treemap') return this.layoutTreemap(L, data);
    if (kind === 'kpi') return this.layoutKpi(L, data);
    if (kind === 'parallel') return this.layoutParallel(L, data);
    const top = 12;
    let legend = null;
    let legendW = 0;
    let legendH = 0;
    if (data && s.legend?.show !== false) {
      legend = this.legendItems(data);
      if (legend && s.legend?.position === 'bottom') {
        legend.bottom = this.bottomLegend(legend, W);
        legendH = legend.bottom.h;
      } else {
        if (legend?.type === 'items') legendW = Math.min(200, Math.max(...legend.items.map((it) => textWidth(it.label, 11))) + 30);
        if (legend?.type === 'ramp') legendW = 70;
      }
    }
    const axX = s.axes?.x || {};
    const axY = s.axes?.y || {};
    const axY2 = s.axes?.y2 || {};
    const xType = data?.xType || 'number';
    const continuousX = ['points', 'density', 'lines', 'histogram'].includes(kind) || (kind === 'heatmap' && data.xEdges);
    let xDom = [0, 1];
    let yL = [0, 1];
    let yR = null;
    let xCats = null;
    let yCats = null;
    if (kind === 'points' || kind === 'density' || kind === 'lines') {
      xDom = this.view?.x || ranged(padRange(data.bounds.x, kind === 'lines' ? 0 : 0.03, s.logX), axX);
      yL = this.view?.left || ranged(padRange(data.bounds.left || [0, 1], 0.05, s.logY), axY);
      if (data.bounds.right) yR = this.view?.right || ranged(padRange(data.bounds.right, 0.05, s.logY2), axY2);
    } else if (kind === 'histogram') {
      const e = data.edges;
      xDom = this.view?.x || ranged([e[0], e[e.length - 1]], axX);
      const ng = data.groups ? data.groups.length : 1;
      let hi = 0;
      for (let k = 0; k < e.length - 1; k += 1) {
        let sum = 0;
        for (let g = 0; g < ng; g += 1) sum += data.values[k * ng + g];
        hi = Math.max(hi, sum);
      }
      yL = this.view?.left || ranged([0, hi * 1.06 || 1], axY);
    } else if (kind === 'bars') {
      xCats = data.labels;
      const ng = data.groups ? data.groups.length : 1;
      let lo = 0;
      let hi = 0;
      if (data.waterfall) {
        for (let c = 0; c < xCats.length; c += 1) {
          const a = data.starts[c];
          const b = a + data.values[c];
          lo = Math.min(lo, a, b);
          hi = Math.max(hi, a, b);
        }
      }
      for (const ln of data.lines || []) {
        for (const v of ln.values) {
          if (!Number.isFinite(v)) continue;
          if (ln.axis === 'right') yR = [Math.min(yR?.[0] ?? 0, v), Math.max(yR?.[1] ?? 0, v)];
          else {
            lo = Math.min(lo, v);
            hi = Math.max(hi, v);
          }
        }
      }
      if (yR) yR = ranged([yR[0] * 1.06, yR[1] * 1.06 || 1], axY2);
      for (let c = 0; c < xCats.length && !data.waterfall; c += 1) {
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
      yL = ranged([lo * 1.06, hi * 1.06 || 1], axY);
    } else if (kind === 'box') {
      xCats = data.stats.map((st) => st.label);
      let lo = Infinity;
      let hi = -Infinity;
      for (const st of data.stats) {
        lo = Math.min(lo, st.min);
        hi = Math.max(hi, st.max);
      }
      yL = ranged(padRange(Number.isFinite(lo) ? [lo, hi] : [0, 1], 0.05, s.logY), axY);
    } else if (kind === 'heatmap') {
      if (data.xEdges) xDom = [data.xEdges[0], data.xEdges[data.xEdges.length - 1]];
      else xCats = data.xLabels;
      if (data.yEdges) yL = [data.yEdges[0], data.yEdges[data.yEdges.length - 1]];
      else yCats = data.yLabels;
    }
    // Margins from the widest tick labels.
    const tmpY = new Scale(yL[0], yL[1], 100, 0, s.logY && kind !== 'bars' && kind !== 'histogram');
    const yTicks = yCats ? null : ticksFor(tmpY, kind === 'heatmap' ? data.yType : 'number', 6);
    const leftW = axY.labels === false ? 4 : yCats ? Math.min(160, Math.max(...yCats.map((c) => textWidth(c, 11)))) : Math.max(...(yTicks || []).map((t) => textWidth(t.label, 11)), 20);
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
    plot.h = Math.max(40, H - top - (axX.labels === false ? 26 : 42) - bottomExtra - legendH);
    L.plot = plot;
    L.rotate = rotate;
    L.legend = legend;
    L.legendW = legendW;
    L.legendH = legendH;
    L.xCats = xCats;
    L.yCats = yCats;
    L.xType = continuousX ? (kind === 'heatmap' ? data.xType : xType) : 'category';
    if (xCats) L.xBand = { n: xCats.length, w: plot.w / Math.max(1, xCats.length) };
    else if (axX.reverse && kind !== 'heatmap') L.sx = new Scale(xDom[0], xDom[1], plot.x + plot.w, plot.x, !!s.logX && kind !== 'histogram');
    else L.sx = new Scale(xDom[0], xDom[1], plot.x, plot.x + plot.w, !!s.logX && kind !== 'histogram' && kind !== 'heatmap');
    const yLog = !!s.logY && ['points', 'density', 'lines', 'box'].includes(kind);
    if (yCats) L.yBand = { n: yCats.length, h: plot.h / Math.max(1, yCats.length) };
    else if (axY.reverse && kind !== 'heatmap') L.syL = new Scale(yL[0], yL[1], plot.y, plot.y + plot.h, yLog);
    else L.syL = new Scale(yL[0], yL[1], plot.y + plot.h, plot.y, yLog);
    if (yR) L.syR = axY2.reverse ? new Scale(yR[0], yR[1], plot.y, plot.y + plot.h, !!s.logY2) : new Scale(yR[0], yR[1], plot.y + plot.h, plot.y, !!s.logY2);
    L.yRTicks = yRTicks;
    return L;
  }

  layoutPie(L, data) {
    const legend = this.spec.legend?.show === false ? null : this.legendItems(data);
    const legendW = legend ? Math.min(200, Math.max(...legend.items.map((it) => textWidth(it.label, 11)), textWidth(legend.title || '', 11)) + 30) : 0;
    const w = Math.max(40, L.W - legendW - 24);
    const r = Math.max(10, Math.min(w, L.H - 24) / 2 - 4);
    const values = Array.from(data.values, (v) => (Number.isFinite(v) && v > 0 ? v : 0));
    const total = values.reduce((a, b) => a + b, 0) || 1;
    let a = -Math.PI / 2;
    const slices = values.map((v, i) => {
      const a0 = a;
      a += (v / total) * Math.PI * 2;
      return { i, v, a0, a1: a, share: v / total };
    });
    return { ...L, plot: { x: 12, y: 12, w, h: L.H - 24 }, legend, legendW, pie: { cx: 12 + w / 2, cy: L.H / 2, r, slices, total } };
  }

  layoutTable(L, data) {
    const ng = data.groups ? data.groups.length : 1;
    const f = (v) => (Number.isFinite(v) ? formatValue(v, 'number') : '');
    const rowHeadW = Math.min(220, Math.max(textWidth(this.spec.x || '', 11.5) + 12, ...data.labels.map((l) => textWidth(l, 11.5) + 14), 60));
    const colWs = Array.from({ length: ng }, (_, g) => {
      let w = textWidth(data.groups ? data.groups[g] : this.valueTitle(data), 11.5) + 16;
      for (let c = 0; c < data.labels.length; c += 1) w = Math.max(w, textWidth(f(data.values[c * ng + g]), 11.5) + 16);
      return Math.min(180, Math.max(56, w));
    });
    const rowH = 21;
    const headH = data.groups ? 42 : 22;
    const rows = Math.max(0, Math.floor((L.H - headH - 22) / rowH));
    const top = Math.max(0, Math.min(this.tableTop || 0, data.labels.length - rows));
    this.tableTop = top;
    return { ...L, plot: { x: 0, y: 0, w: L.W, h: L.H }, table: { rowHeadW, colWs, rowH, headH, rows, top, ng, x0: 6, y0: 4 } };
  }

  // Squarified treemap: rectangles with areas in proportion to the values.
  layoutTreemap(L, data) {
    const plot = { x: 4, y: 4, w: Math.max(20, L.W - 8), h: Math.max(20, L.H - 8) };
    const items = Array.from(data.values, (v, i) => ({ i, v: Number.isFinite(v) && v > 0 ? v : 0 })).filter((it) => it.v > 0).sort((a, b) => b.v - a.v);
    const total = items.reduce((a, b) => a + b.v, 0) || 1;
    const scale = (plot.w * plot.h) / total;
    const rects = [];
    let box = { ...plot };
    let k = 0;
    const worst = (row, side) => {
      const sum = row.reduce((a, b) => a + b.v * scale, 0);
      let w = 0;
      for (const r of row) {
        const a = r.v * scale;
        w = Math.max(w, (side * side * a) / (sum * sum), (sum * sum) / (side * side * a));
      }
      return w;
    };
    while (k < items.length) {
      const side = Math.min(box.w, box.h);
      const row = [items[k]];
      k += 1;
      while (k < items.length && worst([...row, items[k]], side) <= worst(row, side)) {
        row.push(items[k]);
        k += 1;
      }
      const sum = row.reduce((a, b) => a + b.v * scale, 0);
      if (box.w >= box.h) {
        const w = sum / box.h;
        let y = box.y;
        for (const r of row) {
          const hh = (r.v * scale) / w;
          rects.push({ i: r.i, x: box.x, y, w, h: hh });
          y += hh;
        }
        box = { x: box.x + w, y: box.y, w: box.w - w, h: box.h };
      } else {
        const hh = sum / box.w;
        let x = box.x;
        for (const r of row) {
          const w = (r.v * scale) / hh;
          rects.push({ i: r.i, x, y: box.y, w, h: hh });
          x += w;
        }
        box = { x: box.x, y: box.y + hh, w: box.w, h: box.h - hh };
      }
    }
    return { ...L, plot, rects, total };
  }

  // KPI tiles: one per category (or one for all rows).
  layoutKpi(L, data) {
    const n = Math.min(data.labels.length, 48);
    const gap = 8;
    // Pick the column count whose tiles come closest to a 2.4:1 shape.
    let cols = 1;
    let best = Infinity;
    for (let c = 1; c <= n; c += 1) {
      const r = Math.ceil(n / c);
      const tw = (L.W - gap * (c + 1)) / c;
      const th = (L.H - gap * (r + 1)) / r;
      if (tw < 90 && c > 1) break;
      const score = Math.abs(Math.log(tw / Math.max(1, Math.min(th, 130)) / 2.4)) + (th < 44 ? 5 : 0);
      if (score < best) {
        best = score;
        cols = c;
      }
    }
    const rows = Math.max(1, Math.ceil(n / cols));
    const w = (L.W - gap * (cols + 1)) / cols;
    const hh = Math.max(36, Math.min(130, (L.H - gap * (rows + 1)) / rows));
    const tiles = Array.from({ length: n }, (_, i) => ({ i, x: gap + (i % cols) * (w + gap), y: gap + Math.floor(i / cols) * (hh + gap), w, h: hh }));
    return { ...L, plot: { x: 0, y: 0, w: L.W, h: L.H }, tiles };
  }

  layoutParallel(L, data) {
    const legend = this.spec.legend?.show === false ? null : this.legendItems(data);
    const legendW = legend ? Math.min(200, Math.max(...legend.items.map((it) => textWidth(it.label, 11)), textWidth(legend.title || '', 11)) + 30) : 0;
    const k = data.cols.length;
    const plot = { x: 40, y: 40, w: Math.max(60, L.W - 80 - legendW), h: Math.max(40, L.H - 40 - 34) };
    const axes = data.cols.map((c, j) => plot.x + (k > 1 ? (plot.w * j) / (k - 1) : plot.w / 2));
    return { ...L, plot, axes, legend, legendW, legendH: 0 };
  }

  valueTitle(data) {
    return data.agg === 'count' ? 'Count' : `${aggLabel(data.agg)}(${data.valueName})`;
  }

  legendItems(data) {
    const s = this.spec;
    if (data.kind === 'pie') return { type: 'items', title: s.x, items: data.labels.slice(0, 40).map((label, i) => ({ label, color: paletteColor(data.cats[i]) })) };
    if (data.kind === 'table') return null;
    if (data.kind === 'heatmap' || data.kind === 'density') return { type: 'ramp', title: data.kind === 'density' ? 'Rows' : data.valueName };
    if (data.colorMode === 'continuous') return { type: 'ramp', title: s.color, range: data.colorRange, colorType: data.colorType };
    if (data.legend?.length) return { type: 'items', title: s.color, items: data.legend.slice(0, 40).map((label, i) => ({ label, color: paletteColor(i) })) };
    if (data.lines?.length) {
      return { type: 'items', items: [{ label: data.valueName, color: data.groups ? '#9aa0a8' : this.fixedColor() || paletteColor(0) }, ...data.lines.map((ln) => ({ label: ln.name + (ln.axis === 'right' ? ' (right)' : ''), color: paletteColor(ln.color) }))] };
    }
    if (data.kind === 'parallel') return data.legend ? { type: 'items', title: s.color, items: data.legend.slice(0, 40).map((label, i) => ({ label, color: paletteColor(i) })) } : null;
    if (data.kind === 'treemap' || data.kind === 'kpi') return null;
    if (data.groups?.length > 1 || (data.groups && s.color)) return { type: 'items', title: s.color, items: data.groups.map((label, i) => ({ label, color: paletteColor(data.groupIds?.[i] ?? i) })) };
    if (data.shapeLegend?.length) return { type: 'items', title: s.marker?.shapeBy, items: data.shapeLegend.map((label, i) => ({ label, color: this.fixedColor() || '#5d6570', shape: shapeName(i) })) };
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
    if (!w || !ht || this.panels) return;
    const dpr = window.devicePixelRatio || 1;
    for (const c of [this.back, this.front]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(ht * dpr)) {
        c.width = Math.round(w * dpr);
        c.height = Math.round(ht * dpr);
      }
    }
    const back = new CanvasPainter(this.back.getContext('2d'), dpr);
    const front = new CanvasPainter(this.front.getContext('2d'), dpr);
    back.dark = front.dark = darkScreen();
    back.clear(w, ht, '#fff');
    front.clear(w, ht);
    back.screen = true;
    front.screen = true;
    if (this.data?.kind === 'text') {
      this.points?.setData([]);
      this.selectors.innerHTML = '';
      this.lastLayout = null;
      return;
    }
    if (!this.data) {
      this.points?.draw({ width: Math.round(w * dpr), height: Math.round(ht * dpr), rect: { x: 0, y: 0, w: 0, h: 0 }, sx: null, sy: {} });
      this.placeSelectors(null, w, ht);
      return;
    }
    const L = this.layout(w, ht - (STRIP[this.spec.type] ? 28 : 0));
    this.lastLayout = L;
    this.placeSelectors(L, w, ht);
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
    const mk = this.spec.marker || {};
    const base = mk.size || this.spec.markerSize || (total < 2000 ? 6 : total < 30000 ? 4.5 : total < 300000 ? 3 : 2);
    const fixed = this.fixedColor();
    return {
      width: Math.round(L.W * dpr),
      height: Math.round(L.H * dpr),
      rect: { x: L.plot.x * dpr, y: L.plot.y * dpr, w: L.plot.w * dpr, h: L.plot.h * dpr },
      sx: dev(L.sx),
      sy: { left: dev(L.syL), right: dev(L.syR || L.syL) },
      size: base * dpr,
      alpha: num(mk.opacity) ?? (total > 300000 ? 0.45 : total > 30000 ? 0.65 : 0.85),
      cmode: this.data.colorMode === 'continuous' ? 1 : fixed && !this.data.colorMode ? 2 : 0,
      color: fixed,
      shape: Math.max(0, MARKER_SHAPES.indexOf(mk.shape || 'circle')),
    };
  }

  paintBack(p, L) {
    const { plot } = L;
    const ax = this.spec.axes || {};
    p.rect(plot.x, plot.y, plot.w, plot.h, { fill: '#fff' });
    if (L.sx && ax.x?.grid !== false) for (const t of ticksFor(L.sx, L.xType, Math.max(2, Math.round(plot.w / 90)))) {
      const x = L.sx.map(t.v);
      if (x >= plot.x - 0.5 && x <= plot.x + plot.w + 0.5) p.line(x, plot.y, x, plot.y + plot.h, { stroke: GRID });
    }
    if (L.syL && ax.y?.grid !== false) for (const t of ticksFor(L.syL, L.kind === 'heatmap' ? this.data.yType : 'number', Math.max(2, Math.round(plot.h / 50)))) {
      const y = L.syL.map(t.v);
      if (y >= plot.y - 0.5 && y <= plot.y + plot.h + 0.5) p.line(plot.x, y, plot.x + plot.w, y, { stroke: GRID });
    }
    if (this.data?.paths?.length && L.sx) {
      p.clip(plot.x, plot.y, plot.w, plot.h);
      this.paintPaths(p, L);
      p.unclip();
    }
  }

  // Line connection: the lines a scatter plot draws between its points.
  paintPaths(p, L) {
    const d = this.data;
    const fixed = this.fixedColor();
    const width = num(this.spec.connect?.width) || 1.8;
    for (const path of d.paths) {
      const sy = path.axis === 'right' ? L.syR : L.syL;
      const xs = new Float64Array(path.n);
      const ys = new Float64Array(path.n);
      for (let k = 0; k < path.n; k += 1) {
        xs[k] = L.sx.map(path.x[k]);
        ys[k] = sy.map(path.y[k]);
      }
      p.polyline(xs, ys, path.n, { stroke: fixed || paletteColor(path.c), width, alpha: 0.8 });
    }
  }

  // Straight reference lines at a value, or at the mean or median.
  paintRefLines(p, L) {
    const d = this.data;
    const { plot } = L;
    for (const r of this.spec.refLines || []) {
      const axis = r.axis || 'y';
      const sc = axis === 'x' ? L.sx : axis === 'y2' ? L.syR : L.syL;
      if (!sc) continue;
      const st = d.refStats?.[axis === 'x' ? 'x' : axis === 'y2' ? 'right' : 'left'];
      const v = r.kind === 'mean' ? st?.mean : r.kind === 'median' ? st?.median : num(r.value);
      if (v == null || !Number.isFinite(v)) continue;
      const at = sc.map(v);
      const color = r.color || '#b3261e';
      const label = r.label || `${r.kind === 'mean' ? 'Mean' : r.kind === 'median' ? 'Median' : ''}${r.kind === 'mean' || r.kind === 'median' ? ' ' : ''}${formatValue(v, axis === 'x' ? (d.xType || 'number') : 'number')}`;
      if (axis === 'x') {
        if (at < plot.x || at > plot.x + plot.w) continue;
        p.line(at, plot.y, at, plot.y + plot.h, { stroke: color, width: 1.8, dash: [5, 4] });
        p.text(label, at + 4, plot.y + 12, { size: 10.5, color });
      } else {
        if (at < plot.y || at > plot.y + plot.h) continue;
        p.line(plot.x, at, plot.x + plot.w, at, { stroke: color, width: 1.8, dash: [5, 4] });
        p.text(label, plot.x + plot.w - 4, at - 4, { size: 10.5, color, align: 'right' });
      }
    }
  }

  // Text next to points: a column's value for marked (or all) points.
  paintPointLabels(p, L) {
    const d = this.data;
    if (!d.labels?.length) return;
    const taken = [];
    for (const lb of d.labels) {
      const sy = lb.axis === 'right' ? L.syR : L.syL;
      const x = L.sx.map(lb.x) + 6;
      const y = sy.map(lb.y) - 5;
      if (x < L.plot.x || x > L.plot.x + L.plot.w || y < L.plot.y || y > L.plot.y + L.plot.h) continue;
      const text = lb.text.length > 30 ? `${lb.text.slice(0, 29)}…` : lb.text;
      const w = textWidth(text, 10.5);
      if (taken.some((t) => x < t.x + t.w && x + w > t.x && Math.abs(y - t.y) < 11)) continue;
      taken.push({ x, y, w });
      p.text(text, x, y, { size: 10.5, color: '#262a30' });
    }
  }

  showValueLabels() {
    const show = this.spec.labels?.show;
    return show === 'all' || show === 'marked';
  }

  paintFront(p, L) {
    const d = this.data;
    const { plot } = L;
    if (d.kind === 'pie') {
      this.paintPie(p, L);
      this.paintLegend(p, L);
      return;
    }
    if (d.kind === 'table') {
      this.paintTable(p, L);
      return;
    }
    if (d.kind === 'treemap') return this.paintTreemap(p, L);
    if (d.kind === 'kpi') return this.paintKpi(p, L);
    if (d.kind === 'parallel') {
      this.paintParallel(p, L);
      this.paintLegend(p, L);
      return;
    }
    p.clip(plot.x, plot.y, plot.w, plot.h);
    if (d.kind === 'density') this.paintDensity(p, L);
    if (d.kind === 'lines') this.paintLines(p, L);
    if (d.kind === 'bars') {
      if (d.waterfall) this.paintWaterfall(p, L);
      else this.paintBars(p, L);
      if (d.lines) this.paintComboLines(p, L);
    }
    if (d.kind === 'histogram') this.paintHistogram(p, L);
    if (d.kind === 'box') this.paintBoxes(p, L);
    if (d.kind === 'heatmap') this.paintHeatmap(p, L);
    this.paintFits(p, L);
    if (L.sx || L.syL) this.paintRefLines(p, L);
    if (d.kind === 'points' && L.sx) this.paintPointLabels(p, L);
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
    p.line(plot.x, plot.y + plot.h + 0.5, plot.x + plot.w, plot.y + plot.h + 0.5, { stroke: AXIS, width: AXIS_W });
    p.line(plot.x - 0.5, plot.y, plot.x - 0.5, plot.y + plot.h, { stroke: AXIS, width: AXIS_W });
    const ax = s.axes || {};
    // X ticks
    if (ax.x?.labels === false) {
      // Tick labels hidden in the axis properties.
    } else if (L.sx) {
      const ticks = ticksFor(L.sx, L.xType, Math.max(2, Math.round(plot.w / 90)));
      for (const t of ticks) {
        const x = L.sx.map(t.v);
        if (x < plot.x - 1 || x > plot.x + plot.w + 1) continue;
        p.line(x, plot.y + plot.h, x, plot.y + plot.h + 4, { stroke: AXIS, width: AXIS_W });
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
    if (ax.y?.labels === false) {
      // Tick labels hidden in the axis properties.
    } else if (L.syL) {
      const ticks = ticksFor(L.syL, d.kind === 'heatmap' ? d.yType : 'number', Math.max(2, Math.round(plot.h / 50)));
      for (const t of ticks) {
        const y = L.syL.map(t.v);
        if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
        p.line(plot.x - 4, y, plot.x, y, { stroke: AXIS, width: AXIS_W });
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
      p.line(x0 + 0.5, plot.y, x0 + 0.5, plot.y + plot.h, { stroke: AXIS, width: AXIS_W });
      for (const t of L.yRTicks || []) {
        const y = L.syR.map(t.v);
        if (y < plot.y - 1 || y > plot.y + plot.h + 1) continue;
        p.line(x0, y, x0 + 4, y, { stroke: AXIS, width: AXIS_W });
        p.text(t.label, x0 + 7, y + 4, { size: 11, color: TEXT });
      }
      const right = (s.y || []).filter((y) => y.axis === 'right').map((y) => y.col).join(', ');
      p.text(right, L.W - L.legendW - (L.legendW ? 8 : 0) - 4, plot.y + plot.h / 2, { size: 11, color: TEXT, weight: 600, align: 'center', rotate: 90 });
    }
    // Axis titles (on screen these are the axis selectors)
    if (p.screen) return;
    const xTitle = ax.x?.title || s.x || '';
    p.text(`${xTitle}${s.logX ? ' (log)' : ''}`, plot.x + plot.w / 2, L.H - 6 - (L.legendH || 0), { size: 11.5, color: TEXT, weight: 600, align: 'center' });
    let yTitle;
    if (d.kind === 'histogram') yTitle = { count: 'Count', percent: 'Percent', density: 'Density' }[d.normalize];
    else if (d.kind === 'bars') yTitle = d.agg === 'count' ? 'Count' : `${aggLabel(d.agg)} of ${d.valueName}`;
    else yTitle = (s.y || []).filter((y) => (y.axis || 'left') === 'left').map((y) => y.col).join(', ');
    if (ax.y?.title) yTitle = ax.y.title;
    p.text(`${yTitle}${s.logY && !['bars', 'histogram'].includes(d.kind) ? ' (log)' : ''}`, 12, plot.y + plot.h / 2, { size: 11.5, color: TEXT, weight: 600, align: 'center', rotate: -90 });
  }

  paintLegend(p, L) {
    const lg = L.legend;
    if (lg?.bottom) return this.paintBottomLegend(p, L);
    if (!lg || !L.legendW) return;
    const x = L.W - L.legendW;
    let y = L.plot.y + 4;
    if (lg.title || p.screen) {
      if (!p.screen) p.text(lg.title, x, y + 9, { size: 11, weight: 600, color: TEXT });
      y += 18;
    }
    if (lg.type === 'items') {
      const max = Math.floor((L.plot.h - 20) / 17);
      for (const it of lg.items.slice(0, max)) {
        if (it.shape) p.marker(x + 5.5, y + 5.5, 4.5, it.shape, { fill: it.color });
        else p.rect(x, y, 11, 11, { fill: it.color });
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

  // Legend items laid out in rows under the plot.
  bottomLegend(lg, W) {
    if (lg.type === 'ramp') return { h: 34, rows: [] };
    const rows = [[]];
    let x = 0;
    for (const it of lg.items.slice(0, 40)) {
      const label = it.label.length > 24 ? `${it.label.slice(0, 23)}…` : it.label;
      const w = textWidth(label, 11) + 26;
      if (x + w > W - 16 && rows[rows.length - 1].length) {
        rows.push([]);
        x = 0;
      }
      rows[rows.length - 1].push({ ...it, label, x });
      x += w;
    }
    const shown = rows.slice(0, 3);
    return { h: shown.length * 16 + 8, rows: shown };
  }

  // One colour for everything when nothing colours the marks.
  fixedColor() {
    const s = this.spec;
    return s.marker?.color && !s.color && (s.y || []).length <= 1 ? s.marker.color : null;
  }

  paintBottomLegend(p, L) {
    const lg = L.legend;
    const y0 = L.H - L.legendH + 2;
    if (lg.type === 'ramp') {
      const w = Math.min(220, L.W - 120);
      const x0 = (L.W - w) / 2;
      for (let i = 0; i < 40; i += 1) p.rect(x0 + (w * i) / 40, y0 + 2, w / 40 + 0.6, 10, { fill: rampCss(i / 39) });
      const [lo, hi] = lg.range || this.valueRange();
      const f = (v) => formatValue(v, lg.colorType || 'number');
      p.text(f(lo), x0 - 6, y0 + 11, { size: 10, color: TEXT, align: 'right' });
      p.text(f(hi), x0 + w + 6, y0 + 11, { size: 10, color: TEXT });
      return;
    }
    lg.bottom.rows.forEach((row, r) => {
      const width = row.length ? row[row.length - 1].x + textWidth(row[row.length - 1].label, 11) + 26 : 0;
      const x0 = Math.max(8, (L.W - width) / 2);
      const y = y0 + r * 16;
      for (const it of row) {
        if (it.shape) p.marker(x0 + it.x + 5.5, y + 5.5, 4.5, it.shape, { fill: it.color });
        else p.rect(x0 + it.x, y, 11, 11, { fill: it.color });
        p.text(it.label, x0 + it.x + 16, y + 9.5, { size: 11, color: TEXT });
      }
    });
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
    return this.fixedColor() || paletteColor(se.color ?? i);
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
      p.polyline(xs, ys, se.n, { stroke: color, width: num(this.spec.lineWidth) || 2.2, alpha: any ? 0.35 : 1 });
      const r = (num(this.spec.marker?.size) || 5.2) / 2;
      if (this.spec.markers && se.n < 3000) for (let k = 0; k < se.n; k += 1) p.marker(xs[k], ys[k], r, this.spec.marker?.shape, { fill: color, alpha: any ? 0.35 : 1 });
    });
    for (const ms of d.markedSeries) {
      const sy = ms.axis === 'right' ? L.syR : L.syL;
      const r = ms.n > 600 ? 1.2 : 2.4;
      for (let k = 0; k < ms.n; k += 1) p.circle(L.sx.map(ms.x[k]), sy.map(ms.y[k]), r, { fill: MARK });
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
    const mk = this.spec.marker || {};
    const fixed = this.fixedColor();
    const base = (num(mk.size) || num(this.spec.markerSize) || 4.8) / 2;
    const alpha = num(mk.opacity) ?? 0.85;
    for (const [si, se] of d.series.entries()) {
      const sy = se.axis === 'right' ? L.syR : L.syL;
      const step = Math.max(1, Math.ceil(se.n / limit));
      for (const pass of [0, 1]) {
        for (let k = 0; k < se.n; k += step) {
          if ((se.m[k] === 1) !== (pass === 1)) continue;
          const x = L.sx.map(se.x[k] + se.xOff);
          const y = sy.map(se.y[k] + se.yOff);
          const fill = d.colorMode === 'continuous' ? (se.c[k] < 0 ? '#bbb' : rampCss(se.c[k])) : fixed || paletteColor(d.colorMode === 'category' ? se.c[k] : si);
          const r = se.z ? base * (0.45 + 2.4 * se.z[k]) : base;
          const shape = se.s ? shapeName(se.s[k]) : mk.shape;
          p.marker(x, y, se.m[k] ? r + 0.8 : r, shape, { fill, stroke: se.m[k] ? MARK : null, width: 1, alpha: any && !se.m[k] ? alpha * 0.3 : alpha });
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
        const color = d.groups ? paletteColor(d.groupIds[g]) : this.fixedColor() || paletteColor(0);
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
        if (this.showValueLabels() && w > 14) p.text(formatValue(v, 'number'), x + w / 2, v >= 0 ? Math.min(ya, yb) - 3 : Math.max(ya, yb) + 11, { size: 10, color: TEXT, align: 'center' });
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
    p.line(L.plot.x, y0, L.plot.x + L.plot.w, y0, { stroke: AXIS, width: AXIS_W });
  }

  paintPie(p, L) {
    const d = this.data;
    const { cx, cy, r, slices } = L.pie;
    const any = !!d.marked;
    const wedge = (a0, a1, rad) => {
      const pts = [[cx, cy]];
      const n = Math.max(2, Math.ceil(((a1 - a0) / (Math.PI * 2)) * 120));
      for (let k = 0; k <= n; k += 1) {
        const a = a0 + ((a1 - a0) * k) / n;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
      return pts;
    };
    for (const sl of slices) {
      if (!sl.v) continue;
      const color = paletteColor(d.cats[sl.i]);
      p.polygon(wedge(sl.a0, sl.a1, r), { fill: color, alpha: any ? 0.32 : 1, stroke: '#fff' });
      const m = any ? d.marked[sl.i] : 0;
      if (m > 0) {
        const a1 = sl.a0 + (sl.a1 - sl.a0) * Math.min(1, m / sl.v);
        p.polygon(wedge(sl.a0, a1, r), { fill: color, stroke: MARK });
      }
    }
    for (const sl of slices) {
      if (sl.share < 0.04) continue;
      const a = (sl.a0 + sl.a1) / 2;
      const label = this.showValueLabels() ? `${d.labels[sl.i].length > 14 ? `${d.labels[sl.i].slice(0, 13)}…` : d.labels[sl.i]} ${Math.round(sl.share * 1000) / 10}%` : `${Math.round(sl.share * 1000) / 10}%`;
      p.text(label, cx + Math.cos(a) * r * 0.66, cy + Math.sin(a) * r * 0.66 + 4, { size: 11, color: '#fff', weight: 600, align: 'center', keep: true });
    }
  }

  paintWaterfall(p, L) {
    const d = this.data;
    const band = L.xBand.w;
    const inner = band * 0.7;
    const any = !!d.marked;
    const up = this.spec.marker?.color || '#2e7d32';
    const n = d.labels.length;
    for (let c = 0; c < n; c += 1) {
      const last = c === n - 1;
      const v = d.values[c];
      const a = last ? 0 : d.starts[c];
      const b = a + v;
      const x = L.plot.x + c * band + (band - inner) / 2;
      const ya = L.syL.map(a);
      const yb = L.syL.map(b);
      const color = last ? '#5d6570' : v >= 0 ? up : '#c62828';
      p.rect(x, Math.min(ya, yb), inner, Math.max(1, Math.abs(yb - ya)), { fill: color, alpha: any && !(d.marked?.[c] > 0) ? 0.35 : 1 });
      if (any && d.marked[c]) p.rect(x, Math.min(ya, yb), inner, Math.max(1, Math.abs(yb - ya)), { stroke: MARK, width: 1.2 });
      if (!last) {
        const nx = L.plot.x + (c + 1) * band + (band - inner) / 2;
        p.line(x + inner, yb, nx, yb, { stroke: '#9aa0a8', width: 1, dash: [3, 2] });
      }
      if ((this.showValueLabels() || inner > 26) && inner > 14) p.text(formatValue(v, 'number'), x + inner / 2, Math.min(ya, yb) - 3, { size: 10, color: TEXT, align: 'center' });
    }
    p.line(L.plot.x, L.syL.map(0), L.plot.x + L.plot.w, L.syL.map(0), { stroke: AXIS, width: AXIS_W });
  }

  paintComboLines(p, L) {
    const d = this.data;
    const band = L.xBand.w;
    const n = d.labels.length;
    for (const ln of d.lines) {
      const sy = ln.axis === 'right' && L.syR ? L.syR : L.syL;
      const xs = Float64Array.from({ length: n }, (_, c) => L.plot.x + (c + 0.5) * band);
      const ys = Float64Array.from({ length: n }, (_, c) => (Number.isFinite(ln.values[c]) ? sy.map(ln.values[c]) : NaN));
      const color = paletteColor(ln.color);
      p.polyline(xs, ys, n, { stroke: color, width: num(this.spec.lineWidth) || 2.2 });
      for (let c = 0; c < n; c += 1) if (Number.isFinite(ys[c])) p.circle(xs[c], ys[c], 3, { fill: color, stroke: '#fff', width: 1 });
    }
  }

  paintTreemap(p, L) {
    const d = this.data;
    const any = !!d.marked;
    for (const r of L.rects) {
      const color = paletteColor(d.cats[r.i]);
      p.rect(r.x, r.y, r.w, r.h, { fill: color, alpha: any && !(d.marked[r.i] > 0) ? 0.35 : 1 });
      p.rect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1), { stroke: any && d.marked[r.i] > 0 ? MARK : '#fff', width: any && d.marked[r.i] > 0 ? 2 : 1.5 });
      if (r.w > 40 && r.h > 18) {
        const label = shorten(d.labels[r.i], r.w - 10, 11);
        p.text(label, r.x + 5, r.y + 14, { size: 11, color: '#fff', weight: 600, keep: true });
        if (r.h > 34) p.text(shorten(`${formatValue(d.values[r.i], 'number')}  (${Math.round((d.values[r.i] / L.total) * 1000) / 10}%)`, r.w - 10, 10), r.x + 5, r.y + 28, { size: 10, color: '#fff', keep: true });
      }
    }
  }

  paintKpi(p, L) {
    const d = this.data;
    const any = !!d.marked;
    const accent = this.fixedColor() || paletteColor(0);
    for (const t of L.tiles) {
      const on = any && d.marked[t.i] > 0;
      p.rect(t.x, t.y, t.w, t.h, { fill: '#f6f8fa' });
      p.rect(t.x, t.y, 4, t.h, { fill: accent });
      p.rect(t.x + 0.5, t.y + 0.5, t.w - 1, t.h - 1, { stroke: on ? MARK : '#e1e4e8', width: on ? 2 : 1 });
      p.text(shorten(d.labels[t.i], t.w - 20, 11.5), t.x + 12, t.y + 18, { size: 11.5, color: '#5d6570' });
      const size = Math.max(14, Math.min(34, t.h * 0.36, t.w / 6));
      p.text(shorten(formatValue(d.values[t.i], 'number'), t.w - 20, size), t.x + 12, t.y + 18 + size + 6, { size, weight: 600, color: '#1f2328' });
      if (t.h > 70) {
        const cnt = d.counts?.[t.i];
        const sub = `${this.valueTitle(d)}${Number.isFinite(cnt) ? ` · ${cnt.toLocaleString()} rows` : ''}${on ? ` · marked ${formatValue(d.marked[t.i], 'number')}` : ''}`;
        p.text(shorten(sub, t.w - 20, 10), t.x + 12, t.y + t.h - 10, { size: 10, color: '#8a9099' });
      }
    }
  }

  paintParallel(p, L) {
    const d = this.data;
    const { plot, axes } = L;
    const k = d.cols.length;
    const xs = Float64Array.from(axes);
    const ys = new Float64Array(k);
    const alpha = Math.max(0.05, Math.min(0.7, 40 / Math.sqrt(d.n || 1)));
    const any = !!d.marked;
    const draw = (markedPass) => {
      for (let r = 0; r < d.n; r += 1) {
        const m = any && d.marked[r];
        if (markedPass !== !!m) continue;
        for (let j = 0; j < k; j += 1) ys[j] = plot.y + plot.h - d.values[r * k + j] * plot.h;
        const color = m ? MARK : d.color ? (d.color[r] >= 0 ? paletteColor(d.color[r]) : '#b0b5bb') : this.fixedColor() || paletteColor(0);
        p.polyline(xs, ys, k, { stroke: color, width: m ? 1.4 : 1, alpha: m ? 0.85 : any ? alpha * 0.4 : alpha });
      }
    };
    draw(false);
    if (any) draw(true);
    d.cols.forEach((c, j) => {
      const x = axes[j];
      p.line(x, plot.y, x, plot.y + plot.h, { stroke: AXIS, width: AXIS_W });
      const [lo, hi] = d.ranges[j];
      const f = (v) => formatValue(v, d.types[j] || 'number');
      p.text(shorten(c, Math.max(50, plot.w / Math.max(1, k - 1) - 8), 11), x, plot.y - 20, { size: 11, weight: 600, color: TEXT, align: 'center' });
      p.text(f(hi), x, plot.y - 6, { size: 10, color: '#8a9099', align: 'center' });
      p.text(f(lo), x + 4, plot.y + plot.h + 12, { size: 10, color: '#8a9099' });
    });
    if (d.n < d.total) p.text(`Showing ${d.n.toLocaleString()} of ${d.total.toLocaleString()} rows`, plot.x + plot.w, plot.y + plot.h + 26, { size: 10, color: '#8a9099', align: 'right' });
  }

  paintTable(p, L) {
    const d = this.data;
    const t = L.table;
    const s = this.spec;
    const f = (v) => (Number.isFinite(v) ? formatValue(v, 'number') : '');
    const x0 = t.x0;
    let y = t.y0;
    const totalW = t.rowHeadW + t.colWs.reduce((a, b) => a + b, 0);
    const head = '#f3f4f6';
    const line = '#e1e4e8';
    p.rect(x0, y, totalW, t.headH, { fill: head });
    if (d.groups) {
      p.text(s.color || '', x0 + t.rowHeadW + 6, y + 15, { size: 11.5, weight: 600, color: TEXT });
      p.line(x0 + t.rowHeadW, y + 21, x0 + totalW, y + 21, { stroke: line });
    }
    p.text(s.x || '', x0 + 6, y + t.headH - 7, { size: 11.5, weight: 600, color: TEXT });
    let cx = x0 + t.rowHeadW;
    t.colWs.forEach((w, g) => {
      const label = d.groups ? d.groups[g] : this.valueTitle(d);
      p.text(label.length > 26 ? `${label.slice(0, 25)}…` : label, cx + w - 6, y + t.headH - 7, { size: 11.5, weight: 600, color: TEXT, align: 'right' });
      p.line(cx + 0.5, y + (d.groups ? 21 : 0), cx + 0.5, y + t.headH, { stroke: line });
      cx += w;
    });
    y += t.headH;
    const shown = Math.min(d.labels.length - t.top, t.rows);
    for (let c = t.top; c < t.top + shown; c += 1) {
      const label = d.labels[c];
      p.rect(x0, y, t.rowHeadW, t.rowH, { fill: '#fafbfc' });
      p.text(label.length > 30 ? `${label.slice(0, 29)}…` : label, x0 + 6, y + 14.5, { size: 11.5, color: TEXT });
      cx = x0 + t.rowHeadW;
      t.colWs.forEach((w, g) => {
        const k = c * t.ng + g;
        const m = d.marked?.[k];
        if (m) {
          p.rect(cx, y, w, t.rowH, { fill: '#e7eaef' });
          p.rect(cx, y + 1, 3, t.rowH - 2, { fill: MARK });
        }
        p.text(f(d.values[k]), cx + w - 6, y + 14.5, { size: 11.5, color: '#1f2328', align: 'right', weight: m ? 600 : 400 });
        p.line(cx + 0.5, y, cx + 0.5, y + t.rowH, { stroke: line });
        cx += w;
      });
      p.line(x0, y + t.rowH + 0.5, x0 + totalW, y + t.rowH + 0.5, { stroke: line });
      y += t.rowH;
    }
    p.rect(x0, t.y0, totalW, y - t.y0, { stroke: '#cfd4da' });
    if (d.labels.length > shown) p.text(`Rows ${(t.top + 1).toLocaleString()}–${(t.top + shown).toLocaleString()} of ${d.labels.length.toLocaleString()}; scroll to see more`, x0 + 4, y + 15, { size: 10.5, color: '#8a9099' });
    if (d.truncated) p.text(`Showing the ${d.labels.length} largest of ${(d.labels.length + d.truncated).toLocaleString()} categories`, x0 + 4, y + 30, { size: 10.5, color: '#8a9099' });
  }

  // Which cross-table cell is under a point: { c, g } with -1 for a header.
  tableCell(L, at) {
    const t = L.table;
    const col = () => {
      let cx = t.x0 + t.rowHeadW;
      if (at.x < cx) return at.x >= t.x0 ? -1 : null;
      for (let g = 0; g < t.ng; g += 1) {
        if (at.x < cx + t.colWs[g]) return g;
        cx += t.colWs[g];
      }
      return null;
    };
    const g = col();
    if (g == null) return null;
    const rel = at.y - t.y0 - t.headH;
    if (rel < 0) return at.y >= t.y0 ? { c: -1, g } : null;
    const c = Math.floor(rel / t.rowH);
    return c < Math.min(this.data.labels.length - t.top, t.rows) ? { c: t.top + c, g } : null;
  }

  pieSlice(L, at) {
    const { cx, cy, r, slices } = L.pie;
    const dx = at.x - cx;
    const dy = at.y - cy;
    if (dx * dx + dy * dy > r * r) return null;
    let a = Math.atan2(dy, dx);
    if (a < -Math.PI / 2) a += Math.PI * 2;
    return slices.find((sl) => sl.v && a >= sl.a0 && a < sl.a1) || null;
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
        p.rect(xa + 0.5, yb, Math.max(1, xb - xa - 1), ya - yb, { fill: d.groups ? paletteColor(d.groupIds[g]) : this.fixedColor() || paletteColor(0), alpha: any ? 0.32 : 1 });
        base += v;
      }
      if (this.showValueLabels() && base && Math.abs(xb - xa) > 16) p.text(formatValue(base, 'number'), (xa + xb) / 2, L.syL.map(base) - 3, { size: 10, color: TEXT, align: 'center' });
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
      p.line(cx, sy.map(st.whiskerLo), cx, sy.map(st.q1), { stroke: opts.stroke || '#555', width: 1.4, alpha: opts.alpha });
      p.line(cx, sy.map(st.q3), cx, sy.map(st.whiskerHi), { stroke: opts.stroke || '#555', width: 1.4, alpha: opts.alpha });
      for (const w of [st.whiskerLo, st.whiskerHi]) p.line(cx - half / 2, sy.map(w), cx + half / 2, sy.map(w), { stroke: opts.stroke || '#555', width: 1.4, alpha: opts.alpha });
      p.rect(cx - half, sy.map(st.q3), width, sy.map(st.q1) - sy.map(st.q3), { fill: color, alpha: (opts.alpha ?? 1) * 0.75 });
      p.rect(cx - half, sy.map(st.q3), width, sy.map(st.q1) - sy.map(st.q3), { stroke: opts.stroke || '#333', width: 1.4, alpha: opts.alpha });
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
      p.polyline(xs, ys, n, { stroke: FIT_COLORS[i % FIT_COLORS.length], width: 2.6 });
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

  // ---------- axis selectors ----------
  selectorSlots() {
    const s = this.spec;
    const ys = (s.y || []).filter((y) => (y.axis || 'left') === 'left').map((y) => y.col).filter(Boolean);
    const value = s.y?.[0]?.col ? `${AGG_SHORT[s.agg || 'sum'] || 'Sum'}(${s.y[0].col})` : 'Count()';
    const colorable = ['scatter', 'line', 'bar', 'histogram'].includes(s.type) && (s.y || []).length <= 1;
    switch (s.type) {
      case 'pie': return { strip: [['x', 'Slices', s.x], ['value', 'Size', value]] };
      case 'table': return { strip: [['x', 'Rows', s.x || '(none)'], ['color', 'Columns', s.color || '(none)'], ['value', 'Cell values', value]] };
      case 'bar': return { x: s.x || '(none)', y: value, yKey: 'value', color: colorable };
      case 'waterfall': return { x: s.x, y: value, yKey: 'value' };
      case 'combo': return { x: s.x, y: (s.y || []).map((y) => y.col).filter(Boolean).join(', '), color: (s.y || []).length <= 1 };
      case 'treemap': return { strip: [['x', 'Rectangles', s.x], ['value', 'Size', value]] };
      case 'kpi': return { strip: [['x', 'Tiles', s.x || '(none)'], ['value', 'Value', value]] };
      case 'parallel': return { strip: [['cols', 'Columns', (s.cols?.length ? s.cols : (s.y || []).map((y) => y.col).filter(Boolean)).join(', ') || 'Choose…'], ['color', 'Color by', s.color || '(none)']] };
      case 'text': return { strip: [] };
      case 'histogram': return { x: s.x, y: null, color: colorable };
      case 'box': return { x: s.x || '(none)', y: ys[0] };
      case 'heatmap': return { x: s.x, y: ys[0] };
      default: return { x: s.x, y: ys.join(', '), color: colorable };
    }
  }

  placeSelectors(L, W, H) {
    const box = this.selectors;
    box.innerHTML = '';
    if (this.ctx.panel) return;
    const slots = this.selectorSlots();
    const pick = (key, label, cls) => {
      const b = h('button', `viz-sel ${cls}`, `<span>${esc(label || 'Choose…')}</span>${icon('chevronDown', 10)}`);
      b.title = 'Click to choose a column';
      b.onmousedown = (e) => e.stopPropagation();
      b.onclick = (e) => {
        e.stopPropagation();
        this.ctx.axisMenu?.(this, key, b);
      };
      this.dropTarget(b, key);
      box.append(b);
      return b;
    };
    if (slots.strip) {
      const strip = h('div', 'viz-strip');
      for (const [key, label, value] of slots.strip) {
        strip.append(h('span', 'viz-strip-label', esc(label)));
        const b = pick(key, value, 'in-strip');
        strip.append(b);
      }
      box.append(strip);
      return;
    }
    const plot = L?.plot || { x: 46, y: 12, w: W - 60, h: H - 54 };
    const xb = pick('x', slots.x, 'x');
    xb.style.left = `${plot.x + plot.w / 2}px`;
    xb.style.top = `${H - 21 - (L?.legendH || 0)}px`;
    if (slots.y !== null && slots.y !== undefined) {
      const yb = pick(slots.yKey || 'y', slots.y, 'y');
      yb.style.left = '2px';
      yb.style.top = `${plot.y + plot.h / 2}px`;
    }
    if (slots.color) {
      const s = this.spec;
      const cb = pick('color', s.color ? s.color : 'Color by', `color${s.color ? '' : ' faint'}`);
      if (L?.legendW) {
        cb.style.left = `${W - L.legendW - 4}px`;
        cb.style.top = `${plot.y}px`;
        cb.style.maxWidth = `${L.legendW + 2}px`;
      } else {
        cb.style.right = '6px';
        cb.style.top = '4px';
      }
    }
  }

  // Columns from the data panel can be dropped straight on a selector.
  dropTarget(el, key) {
    el.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('text/x-column')) {
        e.preventDefault();
        el.classList.add('drop');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop');
      const name = e.dataTransfer.getData('text/x-column');
      if (name) {
        e.preventDefault();
        this.ctx.axisPick?.(this, key, name);
      }
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
    // Right-click opens the menu; dragging with the right button pans.
    this.el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (drag?.button === 2) {
        drag.menuAt = { x: e.clientX, y: e.clientY };
        return;
      }
      if (Date.now() - (this.panEnded || 0) < 250) return;
      this.ctx.activate?.(this);
      this.ctx.contextMenu?.(this, e.clientX, e.clientY);
    });
    body.addEventListener('mousedown', (e) => {
      if (!this.lastLayout || !this.data) return;
      const at = local(e);
      const tool = e.button === 2 || e.button === 1 ? 'pan' : this.tool;
      e.preventDefault();
      this.el.focus({ preventScroll: true });
      drag = { tool, button: e.button, start: at, at, view: this.currentView(), mods: { add: e.ctrlKey || e.metaKey || e.shiftKey, sub: e.altKey } };
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
      if (d.button === 2 && moved) this.panEnded = Date.now();
      if (d.button === 2 && !moved && d.menuAt) this.ctx.contextMenu?.(this, d.menuAt.x, d.menuAt.y);
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
      if (this.data?.kind === 'table') {
        e.preventDefault();
        this.tableTop = (this.tableTop || 0) + Math.sign(e.deltaY) * Math.max(1, Math.round(Math.abs(e.deltaY) / 40));
        this.hideTip();
        this.draw();
        return;
      }
      if (!this.lastLayout || !['points', 'density', 'lines', 'histogram'].includes(this.data?.kind) ) return;
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
    for (const v of this.panels || []) v.resetView();
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
    if (kind === 'pie' || kind === 'treemap' || kind === 'kpi') return;
    const xOnly = d.tool === 'mark' && ['bars', 'histogram', 'box'].includes(kind);
    if (xOnly) {
      y0 = L.plot.y;
      y1 = L.plot.y + L.plot.h;
    }
    if (kind !== 'table') {
      x0 = Math.max(L.plot.x, x0);
      x1 = Math.min(L.plot.x + L.plot.w, x1);
    }
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
      for (let i = Math.max(0, i0); i <= Math.min(n - 1, i1); i += 1) if (ids[i] >= 0) cats.push(ids[i]);
      if (!cats.length) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      sel = { cats };
    } else if (kind === 'treemap' || kind === 'kpi') {
      const hit = (L.rects || L.tiles).find((r) => d.at.x >= r.x && d.at.x <= r.x + r.w && d.at.y >= r.y && d.at.y <= r.y + r.h);
      if (!hit) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      if (kind === 'kpi' && !this.spec.x) return this.ctx.mark?.(this, { cats: [] }, mode);
      sel = { cats: [this.data.cats[hit.i]] };
    } else if (kind === 'parallel') {
      if (!moved) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      const dd = this.data;
      const mid = (xa + xb) / 2;
      let j = 0;
      L.axes.forEach((x, k) => {
        if (Math.abs(x - mid) < Math.abs(L.axes[j] - mid)) j = k;
      });
      const [lo, hi] = dd.ranges[j];
      const at = (py) => lo + ((L.plot.y + L.plot.h - py) / L.plot.h) * (hi - lo);
      sel = { col: dd.cols[j], lo: at(yb), hi: at(ya) };
    } else if (kind === 'pie') {
      const sl = this.pieSlice(L, d.at);
      if (!sl) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      sel = { cats: [this.data.cats[sl.i]] };
    } else if (kind === 'table') {
      const a = this.tableCell(L, d.start);
      const b = this.tableCell(L, d.at);
      if (!a || !b) return mode === 'replace' ? this.ctx.clearMark?.() : undefined;
      const dd = this.data;
      const span = (u, v, n) => (u < 0 || v < 0 ? [...Array(n).keys()] : Array.from({ length: Math.abs(v - u) + 1 }, (_, k) => Math.min(u, v) + k));
      const cs = span(a.c, b.c, dd.labels.length);
      const gs = a.g < 0 || b.g < 0 ? null : span(a.g, b.g, dd.groups ? dd.groups.length : 1);
      sel = { cats: cs.map((c) => dd.cats[c]), groups: gs && dd.groups ? gs.map((g) => dd.groupIds[g]) : undefined };
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
            const pick = (s.tooltip?.cols || []).filter((c) => c in row);
            const entries = pick.length ? pick.map((c) => [c, row[c]]) : Object.entries(row).slice(0, 10);
            this.showTip(at, entries.map(([k, v]) => `<span class="k">${esc(k)}</span> ${esc(v)}`).join('<br>') + (!pick.length && Object.keys(row).length > 10 ? '<br><span class="k">…</span>' : ''));
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
        for (const ln of d.lines || []) rows.push(`${esc(ln.name)}: ${esc(formatValue(ln.values[i], 'number'))}`);
        html = `<b>${esc(d.labels[i])}</b><br>${rows.join('<br>')}`;
      }
    } else if (d.kind === 'treemap' || d.kind === 'kpi') {
      const r = (L.rects || L.tiles).find((q) => at.x >= q.x && at.x <= q.x + q.w && at.y >= q.y && at.y <= q.y + q.h);
      if (r) html = `<b>${esc(d.labels[r.i])}</b><br>${esc(this.valueTitle(d))}: ${esc(formatValue(d.values[r.i], 'number'))}<br>Rows: ${esc((d.counts?.[r.i] ?? 0).toLocaleString())}`;
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
    } else if (d.kind === 'pie') {
      const sl = this.pieSlice(L, at);
      if (sl) html = `<b>${esc(d.labels[sl.i])}</b><br>${esc(formatValue(sl.v, 'number'))} (${Math.round(sl.share * 1000) / 10}%)${d.marked?.[sl.i] ? `<br><span class="k">marked</span> ${esc(formatValue(d.marked[sl.i], 'number'))}` : ''}`;
    } else if (d.kind === 'table') {
      const cell = this.tableCell(L, at);
      if (cell && cell.c >= 0 && cell.g >= 0) {
        const k = cell.c * L.table.ng + cell.g;
        html = `<b>${esc(d.labels[cell.c])}${d.groups ? ` · ${esc(d.groups[cell.g])}` : ''}</b><br>${esc(this.valueTitle(d))}: ${esc(formatValue(d.values[k], 'number'))}<br>Rows: ${Number(d.counts[k] || 0).toLocaleString()}`;
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

  // A trellised plot exports its panels where they sit on screen.
  panelRects() {
    const r0 = this.body.getBoundingClientRect();
    return this.panels.map((v) => {
      const r = v.body.getBoundingClientRect();
      const hr = v.el.getBoundingClientRect();
      return { v, x: r.left - r0.left, y: r.top - r0.top, w: r.width, h: r.height, title: v.spec.title, tx: hr.left - r0.left, ty: hr.top - r0.top };
    });
  }

  toSvg(width, height) {
    const { w, h: ht } = this.size();
    if (this.panels) {
      const sx = (width || w) / (w || 1);
      const sy = (height || ht) / (ht || 1);
      const parts = this.panelRects().map((r) => `<svg x="${r.x * sx}" y="${r.y * sy}" width="${r.w * sx}" height="${r.h * sy}">${r.v.toSvg(r.w * sx, r.h * sy)}</svg><text x="${r.tx * sx + 4}" y="${r.ty * sy + 12}" font-size="11" font-weight="600" fill="#4a5059" font-family="Calibri, sans-serif">${esc(r.title)}</text>`);
      return `<svg xmlns="http://www.w3.org/2000/svg" width="${width || w}" height="${height || ht}" viewBox="0 0 ${width || w} ${height || ht}"><rect width="100%" height="100%" fill="#fff"/>${parts.join('')}</svg>`;
    }
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

  async toPng(scale = 2, width = 0, height = 0) {
    const size = this.size();
    const w = width || size.w;
    const ht = height || size.h;
    if (this.panels) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(ht * scale);
      const c = canvas.getContext('2d');
      c.fillStyle = '#fff';
      c.fillRect(0, 0, canvas.width, canvas.height);
      const kx = w / (size.w || 1);
      const ky = ht / (size.h || 1);
      for (const r of this.panelRects()) {
        const blob = await r.v.toPng(scale, r.w * kx, r.h * ky);
        const img = await createImageBitmap(blob);
        c.drawImage(img, r.x * kx * scale, r.y * ky * scale, r.w * kx * scale, r.h * ky * scale);
        c.font = `600 ${11 * scale}px Calibri, sans-serif`;
        c.fillStyle = '#4a5059';
        c.fillText(r.title, (r.tx * kx + 4) * scale, (r.ty * ky + 12) * scale);
      }
      return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    }
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
    this.clearPanels();
    this.ro.disconnect();
    this.offTheme?.();
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
