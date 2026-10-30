// The analysis data engine: one table of typed columns plus the filter and
// marking state, and the aggregations every plot asks for. Plots never get
// the raw table; they get what they draw (points, M4-reduced lines, bins).

import { cellText, formatNumber, isoDate } from './columns.js';
import { evaluateColumn, isDateValue, markDate, parse, references } from './expr.js';
import { fit } from './fit.js';

export const POINT_CAP = 1_500_000;
const FIT_SAMPLE = 500_000;
const MAX_CATEGORIES = 500;
const CONNECT_CAP = 400_000;
export const MARKER_SHAPES = ['circle', 'square', 'diamond', 'triangle', 'triangleDown', 'plus', 'cross'];

// A stable pseudo-random number in [0, 1) for a row, used for jitter.
function hash01(i, seed) {
  let h = Math.imul(i ^ (seed * 0x9e3779b9), 0x85ebca6b) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return h / 4294967296;
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export class Dataset {
  constructor({ name, columns, source = null }) {
    this.name = name;
    this.source = source;
    this.cols = columns.map((c) => ({ ...c }));
    this.n = columns[0]?.data.length || 0;
    this.filters = new Map();
    this.exprFilters = [];
    this.rowset = null;
    this.keys = new Map();
    this.mark = new Uint8Array(this.n);
    this.markCount = 0;
    this.rowCache = new Map();
    this.applyFilters();
  }

  column(name, letter = false) {
    const low = String(name).toLowerCase();
    const hit = this.cols.find((c) => c.name.toLowerCase() === low);
    if (hit || !letter) return hit;
    if (/^[a-z]{1,3}$/i.test(name)) {
      let k = 0;
      for (const ch of name.toUpperCase()) k = k * 26 + (ch.charCodeAt(0) - 64);
      return this.cols[k - 1];
    }
    return undefined;
  }

  need(name) {
    const c = this.column(name);
    if (!c) throw new Error(`No column named "${name}"`);
    return c;
  }

  exprContext() {
    return {
      n: this.n,
      column: (name, letter) => {
        const c = this.column(name, letter);
        if (!c) return undefined;
        if (c.type === 'string') return { codes: c.data, dict: c.dict };
        return c.type === 'date' ? markDate(c.data) : c.data;
      },
    };
  }

  info() {
    return {
      name: this.name,
      rows: this.n,
      filtered: this.index.length,
      marked: this.markCount,
      columns: this.cols.map((c) => ({ name: c.name, type: c.type, expr: c.expr || null })),
    };
  }

  // ---------- calculated columns ----------
  addCalculated(name, expr) {
    name = String(name || '').trim().replace(/[[\]]/g, '');
    if (!name) throw new Error('Give the new column a name');
    const existing = this.column(name);
    if (existing && !existing.expr) throw new Error(`There is already a column named "${existing.name}"`);
    const ast = parse(expr);
    const refs = references(ast);
    if (existing && [...refs.cols].some((r) => r.toLowerCase() === name.toLowerCase())) throw new Error('A column can’t refer to itself');
    const v = evaluateColumn(ast, this.exprContext());
    const col = v instanceof Float64Array
      ? { name, type: isDateValue(v) ? 'date' : 'number', data: v, expr }
      : { name, type: 'string', data: v.codes, dict: v.dict, expr };
    if (existing) this.cols[this.cols.indexOf(existing)] = col;
    else this.cols.push(col);
    this.keys.clear();
    this.applyFilters();
    return col.name;
  }

  removeColumn(name) {
    const c = this.need(name);
    this.cols.splice(this.cols.indexOf(c), 1);
    this.filters.delete(c.name);
    this.keys.clear();
    this.applyFilters();
  }

  // ---------- filtering ----------
  setFilter(name, spec) {
    const c = this.need(name);
    if (!spec) this.filters.delete(c.name);
    else this.filters.set(c.name, spec);
    this.applyFilters();
  }

  setExpressionFilters(list) {
    this.exprFilters = list.filter((s) => String(s).trim()).map((expr) => {
      const v = evaluateColumn(expr, this.exprContext());
      if (!(v instanceof Float64Array)) throw new Error('A filter formula must be true or false for each row');
      const mask = new Uint8Array(this.n);
      for (let i = 0; i < this.n; i += 1) mask[i] = v[i] && !Number.isNaN(v[i]) ? 1 : 0;
      return { expr, mask };
    });
    this.applyFilters();
  }

  // Keep only (or drop) the rows that are marked now.
  setRowset(mode) {
    if (!mode) this.rowset = null;
    else {
      const keep = mode === 'marked' ? 1 : 0;
      const prev = this.rowset;
      const mask = new Uint8Array(this.n);
      for (let i = 0; i < this.n; i += 1) mask[i] = (prev ? prev[i] : 1) && this.mark[i] === keep ? 1 : 0;
      this.rowset = mask;
      if (mode === 'marked' || mode === 'unmarked') this.clearMark();
    }
    this.applyFilters();
  }

  resetFilters() {
    this.filters.clear();
    this.exprFilters = [];
    this.rowset = null;
    this.applyFilters();
  }

  filterState() {
    return {
      columns: Object.fromEntries(this.filters),
      expressions: this.exprFilters.map((f) => f.expr),
      rowset: !!this.rowset,
    };
  }

  applyFilters() {
    const pass = new Uint8Array(this.n).fill(1);
    this.columnMask(this.filters, pass);
    for (const f of this.exprFilters) for (let i = 0; i < this.n; i += 1) pass[i] &= f.mask[i];
    if (this.rowset) for (let i = 0; i < this.n; i += 1) pass[i] &= this.rowset[i];
    let count = 0;
    for (let i = 0; i < this.n; i += 1) count += pass[i];
    const index = new Uint32Array(count);
    for (let i = 0, k = 0; i < this.n; i += 1) if (pass[i]) index[k++] = i;
    this.pass = pass;
    this.index = index;
    this.markedIndex = null;
    this.rowCache.clear();
    // Rows hidden by a filter are no longer marked.
    if (this.markCount) {
      let m = 0;
      for (let i = 0; i < this.n; i += 1) {
        if (this.mark[i] && !pass[i]) this.mark[i] = 0;
        m += this.mark[i];
      }
      this.markCount = m;
    }
  }

  // Clears pass[i] for rows that fail any of the column filters.
  columnMask(filters, pass) {
    for (const [name, spec] of filters) {
      const c = this.column(name);
      if (!c) continue;
      if (c.type === 'string') {
        let allow;
        if (spec.kind === 'values') {
          const set = new Set(spec.values);
          allow = c.dict.map((s) => set.has(s) !== !!spec.exclude);
        } else if (spec.kind === 'text') {
          const t = String(spec.text || '').toLowerCase();
          allow = c.dict.map((s) => s.toLowerCase().includes(t));
        } else continue;
        const missingOk = spec.kind === 'values' ? spec.values.includes('') !== !!spec.exclude : !spec.text;
        const d = c.data;
        for (let i = 0; i < this.n; i += 1) if (pass[i] && !(d[i] < 0 ? missingOk : allow[d[i]])) pass[i] = 0;
      } else if (spec.kind === 'range') {
        const lo = spec.min == null || spec.min === '' ? -Infinity : Number(spec.min);
        const hi = spec.max == null || spec.max === '' ? Infinity : Number(spec.max);
        const missingOk = spec.missing !== false;
        const d = c.data;
        for (let i = 0; i < this.n; i += 1) {
          if (!pass[i]) continue;
          const v = d[i];
          if (Number.isNaN(v) ? !missingOk : v < lo || v > hi) pass[i] = 0;
        }
      } else if (spec.kind === 'values') {
        const set = new Set(spec.values.map(String));
        const d = c.data;
        for (let i = 0; i < this.n; i += 1) if (pass[i] && set.has(cellText(c, i)) === !!spec.exclude) pass[i] = 0;
      }
    }
    return pass;
  }

  // ---------- per-visualization rows ----------
  // The rows one visualization draws: the page filters (or every row when it
  // ignores them), narrowed by its own filters, its limiting formula and,
  // for a trellis panel, the panel's categories.
  plotRows(spec) {
    const own = spec.vizFilters && Object.keys(spec.vizFilters).length;
    const limit = String(spec.limit || '').trim();
    if (!spec.ignoreFilters && !own && !limit && !spec.panel?.length) return this.index;
    const id = JSON.stringify([!!spec.ignoreFilters, spec.vizFilters || null, limit, spec.panel || null]);
    if (this.rowCache.has(id)) return this.rowCache.get(id);
    const pass = spec.ignoreFilters ? new Uint8Array(this.n).fill(1) : Uint8Array.from(this.pass);
    if (own) this.columnMask(new Map(Object.entries(spec.vizFilters).filter(([n]) => this.column(n))), pass);
    if (limit) {
      const v = evaluateColumn(limit, this.exprContext());
      if (!(v instanceof Float64Array)) throw new Error('The limiting formula must be true or false for each row');
      for (let i = 0; i < this.n; i += 1) if (!(v[i] && !Number.isNaN(v[i]))) pass[i] = 0;
    }
    for (const p of spec.panel || []) {
      const k = this.keyFor(p.col).keys;
      for (let i = 0; i < this.n; i += 1) if (k[i] !== p.key) pass[i] = 0;
    }
    let count = 0;
    for (let i = 0; i < this.n; i += 1) count += pass[i];
    const out = new Uint32Array(count);
    for (let i = 0, k = 0; i < this.n; i += 1) if (pass[i]) out[k++] = i;
    if (this.rowCache.size > 64) this.rowCache.clear();
    this.rowCache.set(id, out);
    return out;
  }

  plotMarked(spec) {
    const rows = this.plotRows(spec);
    if (rows === this.index) return this.marked();
    if (!this.markCount) return new Uint32Array(0);
    let k = 0;
    const out = new Uint32Array(rows.length);
    for (const i of rows) if (this.mark[i]) out[k++] = i;
    return out.subarray(0, k);
  }

  // Trellis panels share their axes: bounds come from all the panels' rows.
  boundRows(spec) {
    return spec.panel?.length && spec.sharedAxes !== false ? this.plotRows({ ...spec, panel: null }) : this.plotRows(spec);
  }

  // The panels of a trellised visualization: one per category of the
  // panel column, or a grid of row and column categories.
  trellis(spec) {
    const t = spec.trellis || {};
    const base = this.plotRows({ ...spec, panel: null });
    const max = Math.max(1, Math.min(100, t.max || 24));
    const used = (col) => {
      const k = this.keyFor(col);
      const counts = new Float64Array(k.labels.length);
      for (const i of base) if (k.keys[i] >= 0) counts[k.keys[i]] += 1;
      return k.labels.map((label, key) => ({ label, key, n: counts[key] })).filter((x) => x.n);
    };
    if (t.mode === 'grid' && (t.rows || t.cols)) {
      const rows = t.rows ? used(this.need(t.rows).name) : [null];
      const cols = t.cols ? used(this.need(t.cols).name) : [null];
      const nc = Math.min(cols.length, max);
      const nr = Math.max(1, Math.min(rows.length, Math.floor(max / nc)));
      const panels = [];
      for (const r of rows.slice(0, nr)) {
        for (const c of cols.slice(0, nc)) {
          panels.push({
            panel: [r && { col: t.rows, key: r.key }, c && { col: t.cols, key: c.key }].filter(Boolean),
            label: [r?.label, c?.label].filter((x) => x != null).join(' · '),
          });
        }
      }
      return { mode: 'grid', rows: nr, cols: nc, panels, rowLabels: rows.slice(0, nr).map((r) => r?.label ?? ''), colLabels: cols.slice(0, nc).map((c) => c?.label ?? ''), hidden: rows.length * cols.length - panels.length };
    }
    if (!t.by) return { mode: 'panels', panels: [], hidden: 0 };
    const col = this.need(t.by).name;
    const all = used(col);
    return { mode: 'panels', panels: all.slice(0, max).map((x) => ({ panel: [{ col, key: x.key }], label: x.label })), hidden: Math.max(0, all.length - max) };
  }

  // What the filter panel shows for one column.
  profile(name, bins = 40) {
    const c = this.need(name);
    const spec = this.filters.get(c.name) || null;
    if (c.type === 'string') {
      const all = new Float64Array(c.dict.length);
      const shown = new Float64Array(c.dict.length);
      let missing = 0;
      const d = c.data;
      for (let i = 0; i < this.n; i += 1) {
        if (d[i] < 0) missing += 1;
        else {
          all[d[i]] += 1;
          if (this.pass[i]) shown[d[i]] += 1;
        }
      }
      const order = [...c.dict.keys()].filter((k) => all[k] > 0).sort((a, b) => natural.compare(c.dict[a], c.dict[b]));
      return {
        name: c.name, type: c.type, spec, distinct: order.length, missing,
        values: order.slice(0, 2000).map((k) => ({ value: c.dict[k], count: all[k], shown: shown[k] })),
      };
    }
    const d = c.data;
    let lo = Infinity;
    let hi = -Infinity;
    let missing = 0;
    let sum = 0;
    let cnt = 0;
    for (let i = 0; i < this.n; i += 1) {
      const v = d[i];
      if (Number.isNaN(v)) {
        missing += 1;
        continue;
      }
      if (v < lo) lo = v;
      if (v > hi) hi = v;
      sum += v;
      cnt += 1;
    }
    const all = new Float64Array(bins);
    const shown = new Float64Array(bins);
    const w = (hi - lo) / bins || 1;
    for (let i = 0; i < this.n; i += 1) {
      const v = d[i];
      if (Number.isNaN(v)) continue;
      const b = Math.min(bins - 1, Math.floor((v - lo) / w));
      all[b] += 1;
      if (this.pass[i]) shown[b] += 1;
    }
    return { name: c.name, type: c.type, spec, min: cnt ? lo : null, max: cnt ? hi : null, mean: cnt ? sum / cnt : null, missing, hist: Array.from(all), shown: Array.from(shown) };
  }

  // ---------- marking ----------
  clearMark() {
    this.mark.fill(0);
    this.markCount = 0;
    this.markedIndex = null;
  }

  applyMark(hit, mode = 'replace') {
    const m = this.mark;
    if (mode === 'replace') m.fill(0);
    for (const i of this.index) {
      if (!hit(i)) continue;
      if (mode === 'subtract') m[i] = 0;
      else if (mode === 'toggle') m[i] ^= 1;
      else m[i] = 1;
    }
    let count = 0;
    for (const i of this.index) count += m[i];
    this.markCount = count;
    this.markedIndex = null;
    return count;
  }

  // sel: { x0, x1, y0, y1, axis } in data units; for category axes the
  // numbers are category positions (0, 1, 2, …).
  markPlot(spec, sel, mode) {
    const t = spec.type;
    const rows = this.plotRows(spec);
    if (rows !== this.index) {
      const inPlot = new Uint8Array(this.n);
      for (const i of rows) inPlot[i] = 1;
      const apply = this.applyMark.bind(this);
      return this.markPlotWith(spec, sel, mode, (hit, m) => apply((i) => inPlot[i] === 1 && hit(i), m));
    }
    return this.markPlotWith(spec, sel, mode, (hit, m) => this.applyMark(hit, m));
  }

  markPlotWith(spec, sel, mode, applyMark) {
    const t = spec.type;
    if (t === 'scatter' || t === 'line') {
      const x = this.need(spec.x).data;
      const ys = (spec.y || []).filter((s) => (s.axis || 'left') === (sel.axis || 'left')).map((s) => this.need(s.col).data);
      const yAll = !Number.isFinite(sel.y0) && !Number.isFinite(sel.y1);
      return applyMark((i) => {
        const xv = x[i];
        if (!(xv >= sel.x0 && xv <= sel.x1)) return false;
        if (yAll) return true;
        for (const y of ys) if (y[i] >= sel.y0 && y[i] <= sel.y1) return true;
        return false;
      }, mode);
    }
    if (t === 'histogram') {
      const x = this.need(spec.x).data;
      return applyMark((i) => x[i] >= sel.x0 && x[i] <= sel.x1, mode);
    }
    if (t === 'bar' || t === 'box' || t === 'pie' || t === 'table') {
      const k = spec.x ? this.keyFor(spec.x) : null;
      const g = sel.groups && spec.color && t !== 'pie' ? this.keyFor(spec.color) : null;
      const cats = new Set(sel.cats);
      const groups = g ? new Set(sel.groups) : null;
      return applyMark((i) => (!k || cats.has(k.keys[i])) && (!g || groups.has(g.keys[i])), mode);
    }
    if (t === 'heatmap') {
      const kx = this.keyFor(spec.x, { bins: spec.bins || 40, force: true });
      const ky = this.keyFor(spec.y?.[0]?.col, { bins: spec.bins || 40, force: true });
      const xs = new Set(sel.xcats);
      const ys = new Set(sel.ycats);
      return applyMark((i) => xs.has(kx.keys[i]) && ys.has(ky.keys[i]), mode);
    }
    return this.markCount;
  }

  marked() {
    if (!this.markedIndex) {
      const out = new Uint32Array(this.markCount);
      let k = 0;
      for (const i of this.index) if (this.mark[i]) out[k++] = i;
      this.markedIndex = out.subarray(0, k);
    }
    return this.markedIndex;
  }

  // ---------- grouping ----------
  // Row -> category key for a column. Text uses its dictionary; numbers use
  // their distinct values when there are few, otherwise equal-width bins
  // over the full (unfiltered) range so keys stay stable while filtering.
  keyFor(name, { bins = 0, force = false } = {}) {
    const c = this.need(name);
    const id = `${c.name}|${bins}|${force}`;
    if (this.keys.has(id)) return this.keys.get(id);
    let out;
    if (c.type === 'string') {
      const order = [...c.dict.keys()].sort((a, b) => natural.compare(c.dict[a], c.dict[b]));
      const rank = new Int32Array(c.dict.length);
      order.forEach((k, r) => {
        rank[k] = r;
      });
      const keys = new Int32Array(this.n);
      for (let i = 0; i < this.n; i += 1) keys[i] = c.data[i] < 0 ? -1 : rank[c.data[i]];
      out = { keys, labels: order.map((k) => c.dict[k]) };
    } else {
      const d = c.data;
      let lo = Infinity;
      let hi = -Infinity;
      const distinct = new Map();
      for (let i = 0; i < this.n; i += 1) {
        const v = d[i];
        if (Number.isNaN(v)) continue;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        if (!force && distinct.size <= 60) distinct.set(v, 0);
      }
      const keys = new Int32Array(this.n);
      if (!force && distinct.size <= 60) {
        const vals = [...distinct.keys()].sort((a, b) => a - b);
        vals.forEach((v, k) => distinct.set(v, k));
        for (let i = 0; i < this.n; i += 1) keys[i] = Number.isNaN(d[i]) ? -1 : distinct.get(d[i]);
        out = { keys, labels: vals.map((v) => (c.type === 'date' ? isoDate(v) : formatNumber(v))), values: vals };
      } else {
        const nb = bins || 20;
        const edges = niceEdges(lo, hi, nb);
        const w = edges[1] - edges[0];
        const k0 = edges[0];
        const last = edges.length - 2;
        for (let i = 0; i < this.n; i += 1) keys[i] = Number.isNaN(d[i]) ? -1 : Math.max(0, Math.min(last, Math.floor((d[i] - k0) / w)));
        const f = (v) => (c.type === 'date' ? isoDate(v) : formatNumber(v, 6));
        out = { keys, labels: edges.slice(0, -1).map((e, k) => `${f(e)} – ${f(edges[k + 1])}`), edges };
      }
    }
    this.keys.set(id, out);
    return out;
  }

  // ---------- plot data ----------
  bounds(data, rows) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < rows.length; k += 1) {
      const v = data[rows[k]];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return lo <= hi ? [lo, hi] : [0, 1];
  }

  rowsFor(spec) {
    return spec.markedOnly ? this.marked() : this.index;
  }

  scatter(spec, view, size) {
    const rows = this.plotRows(spec);
    const bRows = this.boundRows(spec);
    const xc = this.need(spec.x);
    const series = (spec.y || []).map((s) => ({ ...s, c: this.need(s.col) }));
    if (!series.length) throw new Error('Choose a column for the Y axis');
    const x = xc.data;
    const xb = this.bounds(x, bRows);
    const out = { kind: 'points', xType: xc.type, bounds: { x: xb }, series: [], transfer: [] };
    for (const s of series) {
      const yb = this.bounds(s.c.data, bRows);
      const ax = s.axis || 'left';
      out.bounds[ax] = out.bounds[ax] ? [Math.min(out.bounds[ax][0], yb[0]), Math.max(out.bounds[ax][1], yb[1])] : yb;
    }
    let total = 0;
    for (const s of series) {
      const y = s.c.data;
      for (const i of rows) if (!Number.isNaN(x[i]) && !Number.isNaN(y[i])) total += 1;
    }
    out.total = total;
    out.refStats = this.refStats(spec, rows);
    if (total > POINT_CAP && series.length === 1) return this.density(spec, view, size, out);
    let color = null;
    if (series.length === 1 && spec.color) {
      const cc = this.need(spec.color);
      if (cc.type === 'string' || this.keyFor(cc.name).labels.length <= 30) {
        const k = this.keyFor(cc.name);
        color = { mode: 'category', keys: k.keys };
        out.legend = k.labels;
      } else {
        const b = this.bounds(cc.data, bRows);
        color = { mode: 'continuous', data: cc.data, lo: b[0], span: b[1] - b[0] || 1 };
        out.colorRange = b;
        out.colorType = cc.type;
      }
      out.colorMode = color.mode;
    }
    const mk = spec.marker || {};
    const sizer = mk.sizeBy ? this.unitScale(mk.sizeBy, bRows) : null;
    let shaper = null;
    if (mk.shapeBy) {
      const k = this.keyFor(this.need(mk.shapeBy).name);
      shaper = k.keys;
      out.shapeLegend = k.labels.slice(0, MARKER_SHAPES.length);
    }
    if (sizer) out.sizeRange = sizer.range;
    const jitter = Math.max(0, Math.min(1, Number(mk.jitter) || 0));
    const jx = jitter * (xb[1] - xb[0] || 1) * 0.04;
    const lab = spec.labels?.col && spec.labels.show && spec.labels.show !== 'none' ? { c: this.column(spec.labels.col), max: Math.max(1, Math.min(2000, spec.labels.max || 200)), all: spec.labels.show === 'all' } : null;
    if (lab?.c) out.labels = [];
    const step = total > POINT_CAP ? total / POINT_CAP : 1;
    for (const [si, s] of series.entries()) {
      const y = s.c.data;
      const yb = out.bounds[s.axis || 'left'];
      const jy = jitter * (yb[1] - yb[0] || 1) * 0.04;
      let n = 0;
      for (const i of rows) if (!Number.isNaN(x[i]) && !Number.isNaN(y[i])) n += 1;
      const keep = Math.min(n, Math.ceil(n / step));
      const px = new Float32Array(keep);
      const py = new Float32Array(keep);
      const pc = new Float32Array(keep);
      const pm = new Uint8Array(keep);
      const pr = new Uint32Array(keep);
      const pz = sizer ? new Float32Array(keep) : null;
      const ps = shaper ? new Float32Array(keep) : null;
      const xOff = xb[0];
      const yOff = yb[0];
      let k = 0;
      let acc = 0;
      for (const i of rows) {
        if (Number.isNaN(x[i]) || Number.isNaN(y[i])) continue;
        acc += 1;
        if (step > 1 && acc < step) continue;
        acc -= step > 1 ? step : 1;
        if (k >= keep) break;
        px[k] = x[i] - xOff + (jitter ? (hash01(i, 1) - 0.5) * 2 * jx : 0);
        py[k] = y[i] - yOff + (jitter ? (hash01(i, 2) - 0.5) * 2 * jy : 0);
        pm[k] = this.mark[i];
        pr[k] = i;
        if (color?.mode === 'category') pc[k] = color.keys[i];
        else if (color?.mode === 'continuous') pc[k] = Number.isNaN(color.data[i]) ? -1 : (color.data[i] - color.lo) / color.span;
        else pc[k] = si;
        if (pz) pz[k] = sizer.at(i);
        if (ps) ps[k] = shaper[i] < 0 ? 0 : shaper[i] % MARKER_SHAPES.length;
        if (lab?.c && out.labels.length < lab.max && (lab.all || this.mark[i])) out.labels.push({ x: px[k] + xOff, y: py[k] + yOff, axis: s.axis || 'left', text: cellText(lab.c, i) });
        k += 1;
      }
      const se = { name: s.c.name, axis: s.axis || 'left', n: k, x: px.subarray(0, k), y: py.subarray(0, k), c: pc.subarray(0, k), m: pm.subarray(0, k), rows: pr.subarray(0, k), xOff, yOff };
      if (pz) se.z = pz.subarray(0, k);
      if (ps) se.s = ps.subarray(0, k);
      out.series.push(se);
      out.transfer.push(px.buffer, py.buffer, pc.buffer, pm.buffer, pr.buffer, ...(pz ? [pz.buffer] : []), ...(ps ? [ps.buffer] : []));
    }
    if (spec.connect?.on) out.paths = this.connectPaths(spec, rows, series, color);
    out.sampled = step > 1;
    return out;
  }

  // Row -> 0..1 for sizing markers by a column (text by category order).
  unitScale(name, rows) {
    const c = this.need(name);
    if (c.type === 'string') {
      const k = this.keyFor(c.name);
      const n = Math.max(1, k.labels.length - 1);
      return { at: (i) => (k.keys[i] < 0 ? 0 : k.keys[i] / n), range: null };
    }
    const [lo, hi] = this.bounds(c.data, rows);
    const span = hi - lo || 1;
    return { at: (i) => (Number.isNaN(c.data[i]) ? 0 : (c.data[i] - lo) / span), range: [lo, hi] };
  }

  // Lines joining a scatter plot's points: one per category of the
  // "connect by" column, in the order of the "sort by" column (X by default).
  connectPaths(spec, rows, series, color) {
    const cn = spec.connect;
    const by = cn.by ? this.keyFor(this.need(cn.by).name) : null;
    const order = cn.order ? this.need(cn.order).data : this.need(spec.x).data;
    const x = this.need(spec.x).data;
    const stride = Math.max(1, Math.ceil(rows.length / CONNECT_CAP));
    const paths = [];
    for (const [si, s] of series.entries()) {
      const y = s.c.data;
      const groups = new Map();
      for (let k = 0; k < rows.length; k += stride) {
        const i = rows[k];
        if (Number.isNaN(x[i]) || Number.isNaN(y[i])) continue;
        const g = by ? by.keys[i] : 0;
        if (g < 0) continue;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(i);
      }
      for (const [g, list] of groups) {
        if (list.length < 2) continue;
        list.sort((a, b) => (order[a] - order[b]) || (a - b));
        const px = new Float64Array(list.length);
        const py = new Float64Array(list.length);
        list.forEach((i, k) => {
          px[k] = x[i];
          py[k] = y[i];
        });
        const c = color?.mode === 'category' ? color.keys[list[0]] : by && !spec.color && series.length === 1 ? g : si;
        paths.push({ axis: s.axis || 'left', c, n: list.length, x: px, y: py });
      }
    }
    return paths;
  }

  // Means and medians the reference lines of a plot ask for.
  refStats(spec, rows) {
    if (!(spec.refLines || []).some((r) => r.kind === 'mean' || r.kind === 'median')) return null;
    const stat = (name) => {
      const c = name && this.column(name);
      if (!c || c.type === 'string') return null;
      const v = [];
      for (const i of rows) if (!Number.isNaN(c.data[i])) v.push(c.data[i]);
      if (!v.length) return null;
      const sorted = Float64Array.from(v).sort();
      let sum = 0;
      for (const a of sorted) sum += a;
      return { mean: sum / sorted.length, median: quantile(sorted, 0.5) };
    };
    const left = (spec.y || []).find((y) => (y.axis || 'left') === 'left');
    const right = (spec.y || []).find((y) => y.axis === 'right');
    return { x: stat(spec.x), left: stat(left?.col), right: stat(right?.col) };
  }

  // Too many points to draw one by one: bin them per pixel instead.
  density(spec, view, size, out) {
    const w = Math.max(16, Math.min(2048, Math.round(size?.w || 600)));
    const h = Math.max(16, Math.min(2048, Math.round(size?.h || 400)));
    const x = this.need(spec.x).data;
    const y = this.need(spec.y[0].col).data;
    const x0 = view?.x0 ?? out.bounds.x[0];
    const x1 = view?.x1 ?? out.bounds.x[1];
    const ax = spec.y[0].axis || 'left';
    const y0 = view?.[ax]?.[0] ?? out.bounds[ax][0];
    const y1 = view?.[ax]?.[1] ?? out.bounds[ax][1];
    const logX = !!spec.logX;
    const logY = !!spec.logY;
    const tx = (v) => (logX ? Math.log10(v) : v);
    const ty = (v) => (logY ? Math.log10(v) : v);
    const sx = w / (tx(x1) - tx(x0) || 1);
    const sy = h / (ty(y1) - ty(y0) || 1);
    const counts = new Float32Array(w * h);
    const marked = new Float32Array(w * h);
    const tx0 = tx(x0);
    const ty0 = ty(y0);
    for (const i of this.plotRows(spec)) {
      const a = Math.floor((tx(x[i]) - tx0) * sx);
      const b = Math.floor((ty(y[i]) - ty0) * sy);
      if (a < 0 || b < 0 || a >= w || b >= h) continue;
      const cell = (h - 1 - b) * w + a;
      counts[cell] += 1;
      if (this.mark[i]) marked[cell] += 1;
    }
    out.kind = 'density';
    out.w = w;
    out.h = h;
    out.view = { x0, x1, y0, y1, axis: ax };
    out.counts = counts;
    out.marked = marked;
    out.transfer = [counts.buffer, marked.buffer];
    return out;
  }

  // Lines reduced per pixel column (min, max, first, last), so a line of
  // ten million points draws the same picture from a few thousand.
  line(spec, view, size) {
    const rows = this.plotRows(spec);
    const bRows = this.boundRows(spec);
    const xc = this.need(spec.x);
    const x = xc.data;
    const series = (spec.y || []).map((s) => ({ ...s, c: this.need(s.col) }));
    if (!series.length) throw new Error('Choose a column for the Y axis');
    const xb = this.bounds(x, bRows);
    const out = { kind: 'lines', xType: xc.type, bounds: { x: xb }, series: [], markedSeries: [], refStats: this.refStats(spec, rows) };
    const x0 = view?.x0 ?? xb[0];
    const x1 = view?.x1 ?? xb[1];
    const width = Math.max(50, Math.min(4000, Math.round(size?.w || 800)));
    let groups = null;
    if (series.length === 1 && spec.color) {
      const k = this.keyFor(spec.color);
      groups = k;
      out.legend = k.labels;
    }
    for (const [si, s] of series.entries()) {
      const y = s.c.data;
      const yb = this.bounds(y, bRows);
      const ax = s.axis || 'left';
      out.bounds[ax] = out.bounds[ax] ? [Math.min(out.bounds[ax][0], yb[0]), Math.max(out.bounds[ax][1], yb[1])] : yb;
      const parts = groups ? groups.labels.map((label, g) => ({ label, g })) : [{ label: s.c.name, g: -1 }];
      for (const part of parts) {
        const pick = part.g < 0 ? null : groups.keys;
        const red = m4(rows, x, y, x0, x1, width, pick ? (i) => pick[i] === part.g : null, !!spec.logX);
        if (!red.n) continue;
        out.series.push({ name: part.g < 0 ? s.c.name : part.label, axis: ax, color: part.g < 0 ? si : part.g, x: red.x, y: red.y, n: red.n });
      }
      if (this.markCount) {
        const red = m4(this.plotMarked(spec), x, y, x0, x1, width, null, !!spec.logX);
        if (red.n) out.markedSeries.push({ axis: ax, x: red.x, y: red.y, n: red.n });
      }
    }
    out.transfer = [...out.series, ...out.markedSeries].flatMap((s) => [s.x.buffer, s.y.buffer]);
    return out;
  }

  aggregate(spec) {
    const rows = this.plotRows(spec);
    const kx = spec.x ? this.keyFor(spec.x) : { keys: null, labels: ['All rows'] };
    const kg = spec.color ? this.keyFor(spec.color) : null;
    const nx = kx.labels.length;
    const ng = kg ? kg.labels.length : 1;
    const ycol = spec.y?.[0]?.col ? this.need(spec.y[0].col) : null;
    const agg = ycol ? spec.agg || 'sum' : 'count';
    if (ycol && ycol.type === 'string' && agg !== 'count' && agg !== 'distinct') throw new Error(`${ycol.name} is text; use Count for it`);
    const y = ycol?.data;
    const cells = nx * ng;
    const run = (list) => {
      const cnt = new Float64Array(cells);
      const sum = new Float64Array(cells);
      const sq = new Float64Array(cells);
      const lo = new Float64Array(cells).fill(Infinity);
      const hi = new Float64Array(cells).fill(-Infinity);
      const all = agg === 'median' ? [] : null;
      for (const i of list) {
        const a = kx.keys ? kx.keys[i] : 0;
        if (a < 0) continue;
        const g = kg ? kg.keys[i] : 0;
        if (g < 0) continue;
        const cell = a * ng + g;
        if (agg === 'count') {
          if (ycol && (ycol.type === 'string' ? y[i] < 0 : Number.isNaN(y[i]))) continue;
          cnt[cell] += 1;
          continue;
        }
        const v = y[i];
        if (Number.isNaN(v)) continue;
        cnt[cell] += 1;
        sum[cell] += v;
        sq[cell] += v * v;
        if (v < lo[cell]) lo[cell] = v;
        if (v > hi[cell]) hi[cell] = v;
        if (all) (all[cell] ||= []).push(v);
      }
      const val = new Float64Array(cells);
      for (let c = 0; c < cells; c += 1) {
        const n = cnt[c];
        if (agg === 'count') val[c] = n;
        else if (!n) val[c] = NaN;
        else if (agg === 'sum') val[c] = sum[c];
        else if (agg === 'mean') val[c] = sum[c] / n;
        else if (agg === 'min') val[c] = lo[c];
        else if (agg === 'max') val[c] = hi[c];
        else if (agg === 'std') val[c] = n > 1 ? Math.sqrt(Math.max(0, (sq[c] - (sum[c] * sum[c]) / n) / (n - 1))) : NaN;
        else if (agg === 'median') val[c] = quantile(Float64Array.from(all[c]).sort(), 0.5);
      }
      return { val, cnt };
    };
    const main = run(rows);
    const markedRun = this.markCount ? run(this.plotMarked(spec)) : null;
    // Drop empty categories and keep the biggest when there are too many.
    let cats = [...Array(nx).keys()].filter((a) => {
      for (let g = 0; g < ng; g += 1) if (main.cnt[a * ng + g]) return true;
      return false;
    });
    const total = (a) => {
      let s = 0;
      for (let g = 0; g < ng; g += 1) s += main.cnt[a * ng + g];
      return s;
    };
    let truncated = 0;
    if (cats.length > MAX_CATEGORIES) {
      truncated = cats.length - MAX_CATEGORIES;
      const keep = new Set([...cats].sort((a, b) => total(b) - total(a)).slice(0, MAX_CATEGORIES));
      cats = cats.filter((a) => keep.has(a));
    }
    if (spec.sort === 'value') {
      const v = (a) => {
        let s = 0;
        for (let g = 0; g < ng; g += 1) s += main.val[a * ng + g] || 0;
        return s;
      };
      cats.sort((a, b) => v(b) - v(a));
    }
    const groupsUsed = [...Array(ng).keys()].filter((g) => cats.some((a) => main.cnt[a * ng + g]));
    const pick = (arr) => Float64Array.from(cats.flatMap((a) => groupsUsed.map((g) => arr[a * ng + g])));
    return {
      kind: 'bars', agg, valueName: ycol?.name || 'Rows', cats, labels: cats.map((a) => kx.labels[a]),
      groups: kg ? groupsUsed.map((g) => kg.labels[g]) : null, groupIds: groupsUsed,
      values: pick(main.val), counts: pick(main.cnt), marked: markedRun ? pick(markedRun.val) : null, truncated,
    };
  }

  histogram(spec) {
    const c = this.need(spec.x);
    if (c.type === 'string') throw new Error(`${c.name} is text; a histogram needs numbers. Try a bar chart.`);
    const x = c.data;
    const rows = this.plotRows(spec);
    const b = this.bounds(x, this.boundRows(spec));
    let n = 0;
    for (const i of rows) if (!Number.isNaN(x[i])) n += 1;
    const bins = spec.bins || Math.max(10, Math.min(100, Math.round(2 * (Math.log2(Math.max(n, 2)) + 1))));
    const edges = niceEdges(b[0], b[1], bins);
    const nb = edges.length - 1;
    const w = edges[1] - edges[0];
    const kg = spec.color ? this.keyFor(spec.color) : null;
    const ng = kg ? kg.labels.length : 1;
    const counts = new Float64Array(nb * ng);
    const marked = new Float64Array(nb);
    for (const i of rows) {
      const v = x[i];
      if (Number.isNaN(v)) continue;
      const k = Math.max(0, Math.min(nb - 1, Math.floor((v - edges[0]) / w)));
      const g = kg ? kg.keys[i] : 0;
      if (g < 0) continue;
      counts[k * ng + g] += 1;
      if (this.mark[i]) marked[k] += 1;
    }
    const used = kg ? [...Array(ng).keys()].filter((g) => {
      for (let k = 0; k < nb; k += 1) if (counts[k * ng + g]) return true;
      return false;
    }) : [0];
    const norm = spec.normalize === 'percent' ? 100 / (n || 1) : spec.normalize === 'density' ? 1 / ((n || 1) * w) : 1;
    const vals = Float64Array.from({ length: nb * used.length }, (_, j) => counts[Math.floor(j / used.length) * ng + used[j % used.length]] * norm);
    return {
      kind: 'histogram', xType: c.type, edges: Array.from(edges), groups: kg ? used.map((g) => kg.labels[g]) : null, groupIds: used,
      values: vals, marked: this.markCount ? marked.map((v) => v * norm) : null, n, normalize: spec.normalize || 'count',
      refStats: this.refStats({ ...spec, y: [] }, rows),
    };
  }

  box(spec) {
    const yc = this.need(spec.y?.[0]?.col);
    if (yc.type === 'string') throw new Error(`${yc.name} is text; a box plot needs numbers`);
    const y = yc.data;
    const kx = spec.x ? this.keyFor(spec.x) : { keys: null, labels: [yc.name] };
    const run = (list) => {
      const nx = kx.labels.length;
      const counts = new Uint32Array(nx);
      for (const i of list) {
        const a = kx.keys ? kx.keys[i] : 0;
        if (a >= 0 && !Number.isNaN(y[i])) counts[a] += 1;
      }
      const start = new Uint32Array(nx + 1);
      for (let a = 0; a < nx; a += 1) start[a + 1] = start[a] + counts[a];
      const vals = new Float64Array(start[nx]);
      const pos = start.slice(0, nx);
      for (const i of list) {
        const a = kx.keys ? kx.keys[i] : 0;
        if (a >= 0 && !Number.isNaN(y[i])) vals[pos[a]++] = y[i];
      }
      const stats = [];
      for (let a = 0; a < nx; a += 1) {
        if (!counts[a]) continue;
        const v = vals.subarray(start[a], start[a + 1]).sort();
        stats.push({ cat: a, label: kx.labels[a], ...boxStats(v) });
      }
      return stats;
    };
    const stats = run(this.plotRows(spec));
    const marked = this.markCount ? run(this.plotMarked(spec)) : null;
    return { kind: 'box', valueName: yc.name, stats, marked };
  }

  heatmap(spec) {
    const xc = this.need(spec.x);
    const yc = this.need(spec.y?.[0]?.col);
    const bins = spec.bins || 40;
    const kx = this.keyFor(xc.name, { bins, force: xc.type !== 'string' });
    const ky = this.keyFor(yc.name, { bins, force: yc.type !== 'string' });
    const zc = spec.z ? this.need(spec.z) : null;
    const agg = zc ? spec.agg || 'mean' : 'count';
    const nx = kx.labels.length;
    const ny = ky.labels.length;
    const cnt = new Float64Array(nx * ny);
    const sum = new Float64Array(nx * ny);
    const lo = new Float64Array(nx * ny).fill(Infinity);
    const hi = new Float64Array(nx * ny).fill(-Infinity);
    const z = zc?.data;
    for (const i of this.plotRows(spec)) {
      const a = kx.keys[i];
      const b = ky.keys[i];
      if (a < 0 || b < 0) continue;
      const cell = b * nx + a;
      if (!zc) {
        cnt[cell] += 1;
        continue;
      }
      const v = z[i];
      if (Number.isNaN(v)) continue;
      cnt[cell] += 1;
      sum[cell] += v;
      if (v < lo[cell]) lo[cell] = v;
      if (v > hi[cell]) hi[cell] = v;
    }
    const values = new Float64Array(nx * ny);
    for (let c = 0; c < values.length; c += 1) {
      if (agg === 'count') values[c] = cnt[c] || NaN;
      else if (!cnt[c]) values[c] = NaN;
      else values[c] = agg === 'sum' ? sum[c] : agg === 'min' ? lo[c] : agg === 'max' ? hi[c] : sum[c] / cnt[c];
    }
    return {
      kind: 'heatmap', nx, ny, xLabels: kx.labels, yLabels: ky.labels, xEdges: kx.edges || null, yEdges: ky.edges || null,
      xType: xc.type, yType: yc.type, values, agg, valueName: zc?.name || 'Rows', transfer: [values.buffer],
    };
  }

  plotData(spec, view, size) {
    switch (spec.type) {
      case 'scatter': return this.scatter(spec, view, size);
      case 'line': return this.line(spec, view, size);
      case 'bar': return this.aggregate(spec);
      case 'pie': return { ...this.aggregate({ ...spec, color: null, sort: spec.sort || 'value' }), kind: 'pie' };
      case 'table': return { ...this.aggregate(spec), kind: 'table' };
      case 'histogram': return this.histogram(spec);
      case 'box': return this.box(spec);
      case 'heatmap': return this.heatmap(spec);
      default: throw new Error(`Unknown plot type ${spec.type}`);
    }
  }

  // ---------- fitting ----------
  fit(spec, fitSpec) {
    const s = spec.y?.[fitSpec.series || 0];
    if (!s) throw new Error('Choose a Y column first');
    const xc = this.need(spec.x);
    const yc = this.need(s.col);
    if (xc.type === 'string' || yc.type === 'string') throw new Error('Curve fitting needs numeric X and Y columns');
    const rows = fitSpec.markedOnly && this.markCount ? this.plotMarked(spec) : this.plotRows(spec);
    const nonlinear = fitSpec.model !== 'linear' && fitSpec.model !== 'poly';
    const step = nonlinear && rows.length > FIT_SAMPLE ? rows.length / FIT_SAMPLE : 1;
    const len = Math.floor(rows.length / step);
    const x = new Float64Array(len);
    const y = new Float64Array(len);
    for (let k = 0; k < len; k += 1) {
      const i = rows[Math.floor(k * step)];
      x[k] = xc.data[i];
      y[k] = yc.data[i];
    }
    const res = fit(x, y, fitSpec);
    res.xName = xc.name;
    res.yName = yc.name;
    res.sampled = step > 1;
    res.markedOnly = !!(fitSpec.markedOnly && this.markCount);
    res.xRange = this.bounds(x, Uint32Array.from({ length: len }, (_, k) => k));
    return res;
  }

  // ---------- rows ----------
  rows(start, count, source = 'filtered', columns = null) {
    const list = source === 'marked' ? this.marked() : this.index;
    const cols = columns ? columns.map((n) => this.need(n)) : this.cols;
    const end = Math.min(list.length, start + count);
    const out = [];
    const ids = [];
    const marked = [];
    for (let k = start; k < end; k += 1) {
      const i = list[k];
      out.push(cols.map((c) => cellText(c, i)));
      ids.push(i);
      marked.push(this.mark[i]);
    }
    return { total: list.length, start, rows: out, ids, marked, columns: cols.map((c) => c.name) };
  }

  // Rows for a slide table: filtered, marked or all rows, narrowed by an
  // optional formula such as [Year] >= 2020 and [Year] <= 2022.
  tableRows({ source = 'filtered', columns = null, where = '', limit = 20 } = {}) {
    const list = source === 'marked' ? this.marked() : source === 'all' ? null : this.index;
    let keep = null;
    if (String(where).trim()) {
      const v = evaluateColumn(where, this.exprContext());
      if (!(v instanceof Float64Array)) throw new Error('The row formula must be true or false for each row');
      keep = v;
    }
    const cols = (columns?.length ? columns : this.cols.map((c) => c.name)).map((n) => this.need(n));
    const rows = [];
    let total = 0;
    const len = list ? list.length : this.n;
    for (let k = 0; k < len; k += 1) {
      const i = list ? list[k] : k;
      if (keep && !(keep[i] && !Number.isNaN(keep[i]))) continue;
      total += 1;
      if (rows.length < limit) rows.push(cols.map((c) => cellText(c, i)));
    }
    return { total, rows, columns: cols.map((c) => c.name) };
  }

  row(i) {
    return Object.fromEntries(this.cols.map((c) => [c.name, cellText(c, i)]));
  }

  // Nearest drawn point to a cursor, in pixels.
  nearest(spec, at) {
    const x = this.need(spec.x).data;
    let best = -1;
    let bestD = (at.radius || 8) ** 2;
    for (const s of spec.y || []) {
      if ((s.axis || 'left') !== at.axis) continue;
      const y = this.need(s.col).data;
      for (const i of this.index) {
        const dx = (x[i] - at.x) * at.kx;
        const dy = (y[i] - at.y) * at.ky;
        const d = dx * dx + dy * dy;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
    }
    return best < 0 ? null : { row: best, values: this.row(best) };
  }

  csv(source, start, count) {
    const esc = (s) => (/[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s);
    const r = this.rows(start, count, source);
    const lines = r.rows.map((row) => row.map(esc).join(','));
    if (start === 0) lines.unshift(r.columns.map(esc).join(','));
    return { text: `${lines.join('\r\n')}\r\n`, total: r.total, next: start + r.rows.length };
  }

  summary() {
    return this.cols.map((c) => {
      if (c.type === 'string') {
        const counts = new Float64Array(c.dict.length);
        let missing = 0;
        for (let i = 0; i < this.n; i += 1) {
          if (c.data[i] < 0) missing += 1;
          else counts[c.data[i]] += 1;
        }
        const order = [...c.dict.keys()].filter((k) => counts[k]).sort((a, b) => counts[b] - counts[a]);
        return { name: c.name, type: c.type, expr: c.expr || null, missing, distinct: order.length, top: order.slice(0, 8).map((k) => [c.dict[k], counts[k]]) };
      }
      let lo = Infinity;
      let hi = -Infinity;
      let sum = 0;
      let n = 0;
      for (let i = 0; i < this.n; i += 1) {
        const v = c.data[i];
        if (Number.isNaN(v)) continue;
        n += 1;
        sum += v;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      const f = (v) => (c.type === 'date' ? isoDate(v) : formatNumber(v, 6));
      return { name: c.name, type: c.type, expr: c.expr || null, missing: this.n - n, min: n ? f(lo) : null, max: n ? f(hi) : null, mean: n && c.type !== 'date' ? f(sum / n) : null };
    });
  }
}

export function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function boxStats(v) {
  const n = v.length;
  const q1 = quantile(v, 0.25);
  const med = quantile(v, 0.5);
  const q3 = quantile(v, 0.75);
  const iqr = q3 - q1;
  const loF = q1 - 1.5 * iqr;
  const hiF = q3 + 1.5 * iqr;
  let wLo = q1;
  let wHi = q3;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    sum += v[i];
    if (v[i] >= loF && v[i] < wLo) wLo = v[i];
    if (v[i] <= hiF && v[i] > wHi) wHi = v[i];
  }
  const outliers = [];
  for (let i = 0; i < n && v[i] < loF; i += 1) outliers.push(v[i]);
  for (let i = n - 1; i >= 0 && v[i] > hiF; i -= 1) outliers.push(v[i]);
  const step = Math.max(1, Math.ceil(outliers.length / 300));
  return { n, min: v[0], max: v[n - 1], q1, median: med, q3, mean: sum / n, whiskerLo: wLo, whiskerHi: wHi, outliers: outliers.filter((_, i) => i % step === 0), outlierCount: outliers.length };
}

export function niceStep(span, count) {
  const raw = span / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const r = raw / mag;
  return (r <= 1 ? 1 : r <= 2 ? 2 : r <= 2.5 ? 2.5 : r <= 5 ? 5 : 10) * mag;
}

export function niceEdges(lo, hi, bins) {
  if (!(hi > lo)) {
    const pad = Math.abs(lo) * 0.05 || 0.5;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep(hi - lo, bins);
  const start = Math.floor(lo / step) * step;
  const count = Math.max(1, Math.ceil((hi - start) / step - 1e-9));
  const edges = new Float64Array(count + 1);
  for (let k = 0; k <= count; k += 1) edges[k] = Number((start + k * step).toPrecision(12));
  if (edges[count] <= hi) {
    const more = new Float64Array(count + 2);
    more.set(edges);
    more[count + 1] = Number((start + (count + 1) * step).toPrecision(12));
    return more;
  }
  return edges;
}

// M4 reduction over the rows whose x lies in [x0, x1].
export function m4(rows, x, y, x0, x1, width, keep = null, logX = false) {
  const tx = logX ? Math.log10 : (v) => v;
  const a0 = tx(x0);
  const span = tx(x1) - a0 || 1;
  let n = 0;
  for (const i of rows) {
    const xv = x[i];
    if (xv >= x0 && xv <= x1 && !Number.isNaN(y[i]) && (!keep || keep(i))) n += 1;
  }
  if (n <= width * 3) {
    const idx = new Uint32Array(n);
    let k = 0;
    for (const i of rows) {
      const xv = x[i];
      if (xv >= x0 && xv <= x1 && !Number.isNaN(y[i]) && (!keep || keep(i))) idx[k++] = i;
    }
    let sorted = true;
    for (let j = 1; j < n; j += 1) if (x[idx[j]] < x[idx[j - 1]]) {
      sorted = false;
      break;
    }
    if (!sorted) idx.sort((p, q) => x[p] - x[q]);
    // Keep one point beyond each edge so the line runs to the frame.
    return pack(withEdges(rows, x, y, x0, x1, keep, Array.from(idx)), x, y);
  }
  const fx = new Int32Array(width).fill(-1);
  const lx = new Int32Array(width).fill(-1);
  const ly = new Int32Array(width).fill(-1);
  const hy = new Int32Array(width).fill(-1);
  for (const i of rows) {
    const xv = x[i];
    if (!(xv >= x0 && xv <= x1)) continue;
    const yv = y[i];
    if (Number.isNaN(yv) || (keep && !keep(i))) continue;
    const b = Math.min(width - 1, Math.floor(((tx(xv) - a0) / span) * width));
    if (!(b >= 0)) continue;
    if (fx[b] < 0) {
      fx[b] = i;
      lx[b] = i;
      ly[b] = i;
      hy[b] = i;
      continue;
    }
    if (xv < x[fx[b]]) fx[b] = i;
    if (xv > x[lx[b]]) lx[b] = i;
    if (yv < y[ly[b]]) ly[b] = i;
    if (yv > y[hy[b]]) hy[b] = i;
  }
  const order = [];
  for (let b = 0; b < width; b += 1) {
    if (fx[b] < 0) continue;
    const pts = [...new Set([fx[b], ly[b], hy[b], lx[b]])].sort((p, q) => x[p] - x[q] || 0);
    order.push(...pts);
  }
  return pack(withEdges(rows, x, y, x0, x1, keep, order), x, y);
}

function withEdges(rows, x, y, x0, x1, keep, order) {
  let before = -1;
  let after = -1;
  for (const i of rows) {
    const xv = x[i];
    if (Number.isNaN(y[i]) || (keep && !keep(i))) continue;
    if (xv < x0 && (before < 0 || xv > x[before])) before = i;
    if (xv > x1 && (after < 0 || xv < x[after])) after = i;
  }
  if (before >= 0) order.unshift(before);
  if (after >= 0) order.push(after);
  return order;
}

function pack(order, x, y) {
  const px = new Float64Array(order.length);
  const py = new Float64Array(order.length);
  order.forEach((i, k) => {
    px[k] = x[i];
    py[k] = y[i];
  });
  return { x: px, y: py, n: order.length };
}
