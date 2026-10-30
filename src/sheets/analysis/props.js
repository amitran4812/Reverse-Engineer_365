// The properties panel of one visualization: every setting it has, in
// tabs (data, axes, colour, markers, labels, legend, trellis, line
// connection, reference lines, tooltip). Changes apply as they are made.

import { icon } from '../../shared/icons.js';
import { escapeHtml, h } from '../../shared/shell.js';
import { AGGS, PLOT_TYPES, autoTitle } from './plot.js';
import { MARKER_SHAPES } from './engine.js';

const TYPE_ICON = { number: 'colNumber', string: 'colText', date: 'colDate' };
const SHAPE_LABELS = { circle: 'Circle', square: 'Square', diamond: 'Diamond', triangle: 'Triangle', triangleDown: 'Triangle (down)', plus: 'Plus', cross: 'Cross' };
const XY = ['scatter', 'line'];
const AXES = ['scatter', 'line', 'bar', 'histogram', 'box', 'heatmap', 'waterfall', 'combo'];
const AGGED = ['bar', 'pie', 'table', 'waterfall', 'treemap', 'kpi', 'combo'];

export const PROP_TABS = [
  { id: 'general', label: 'General', icon: 'settings' },
  { id: 'data', label: 'Data', icon: 'filter', when: (s) => s.type !== 'text' },
  { id: 'x', label: 'X axis', icon: 'chartLine', when: (s) => AXES.includes(s.type) },
  { id: 'y', label: 'Y axis', icon: 'up', when: (s) => AXES.includes(s.type) && s.type !== 'histogram' },
  { id: 'color', label: 'Colors', icon: 'theme', when: (s) => s.type !== 'text' },
  { id: 'marker', label: 'Markers', icon: 'chartScatter', when: (s) => XY.includes(s.type) },
  { id: 'labels', label: 'Labels', icon: 'label', when: (s) => ['scatter', 'bar', 'histogram', 'pie', 'waterfall'].includes(s.type) },
  { id: 'legend', label: 'Legend', icon: 'bullets', when: (s) => !['table', 'text', 'kpi', 'treemap'].includes(s.type) },
  { id: 'trellis', label: 'Trellis', icon: 'grid', when: (s) => !['table', 'text'].includes(s.type) },
  { id: 'connect', label: 'Line connection', icon: 'chartMulti', when: (s) => s.type === 'scatter' },
  { id: 'lines', label: 'Lines & curves', icon: 'fitCurve', when: (s) => [...XY, 'histogram', 'bar', 'box'].includes(s.type) },
  { id: 'tooltip', label: 'Tooltip', icon: 'chat', when: (s) => XY.includes(s.type) },
];

const num = (v) => (v === '' || v == null || !Number.isFinite(Number(v)) ? null : Number(v));

function field(label, ...controls) {
  const row = h('label', 'an-field');
  row.append(h('span', '', escapeHtml(label)), ...controls);
  return row;
}

function select(options, value, change) {
  const s = h('select');
  for (const o of options) {
    const opt = h('option', '', escapeHtml(o.label));
    opt.value = o.value;
    s.append(opt);
  }
  s.value = value ?? '';
  s.onchange = () => change(s.value);
  return s;
}

function check(label, value, change) {
  const l = h('label', 'an-check');
  const c = h('input');
  c.type = 'checkbox';
  c.checked = !!value;
  c.onchange = () => change(c.checked);
  l.append(c, document.createTextNode(` ${label}`));
  return l;
}

function input(value, change, { type = 'text', placeholder = '', min, max, step } = {}) {
  const i = h('input');
  if (type !== 'text') i.type = type;
  i.value = value ?? '';
  i.placeholder = placeholder;
  if (min != null) i.min = min;
  if (max != null) i.max = max;
  if (step != null) i.step = step;
  i.onchange = () => change(i.value);
  return i;
}

function slider(value, min, max, step, change, live = null) {
  const wrap = h('div', 'an-slider');
  const r = h('input');
  r.type = 'range';
  r.min = min;
  r.max = max;
  r.step = step;
  r.value = value;
  const out = h('span', '', String(value));
  r.oninput = () => {
    out.textContent = r.value;
    live?.(Number(r.value));
  };
  r.onchange = () => change(Number(r.value));
  wrap.append(r, out);
  return wrap;
}

function group(title) {
  return h('div', 'an-pgroup', `<b>${escapeHtml(title)}</b>`);
}

// api: { active(), info(), client, setProp(fn), setLook(fn), fitMenu(anchor), removeFit(f), duplicate(), remove(), close() }
export function createProps(api) {
  const el = h('aside', 'an-props-drawer');
  const head = h('div', 'an-props-head');
  const nav = h('nav', 'an-props-nav');
  const body = h('div', 'an-props-body');
  const main = h('div', 'an-props-main');
  main.append(nav, body);
  el.append(head, main);
  el.hidden = true;
  let tab = 'general';

  const cols = () => api.info()?.columns || [];
  const colOptions = (filter = () => true, none = null) => {
    const opts = cols().filter(filter).map((c) => ({ value: c.name, label: c.name }));
    return none ? [{ value: '', label: none }, ...opts] : opts;
  };
  const numeric = (c) => c.type !== 'string';

  function open(t = null) {
    if (t) tab = t;
    el.hidden = false;
    render();
  }

  function close() {
    el.hidden = true;
  }

  function render() {
    if (el.hidden) return;
    const v = api.active();
    head.innerHTML = '';
    nav.innerHTML = '';
    body.innerHTML = '';
    const x = h('button', 'btn an-x', icon('close', 12));
    x.title = 'Close properties';
    x.onclick = () => api.close();
    if (!v) {
      head.append(h('b', '', 'Properties'), x);
      body.append(h('div', 'an-meta', 'Select a visualization to see its properties.'));
      return;
    }
    const s = v.spec;
    head.append(h('span', 'an-props-icon', icon(PLOT_TYPES[s.type]?.icon || 'chartScatter', 16)), h('b', '', escapeHtml(s.title || autoTitle(s))), x);
    const tabs = PROP_TABS.filter((t) => !t.when || t.when(s));
    if (!tabs.some((t) => t.id === tab)) tab = 'general';
    for (const t of tabs) {
      const b = h('button', `an-props-tab${t.id === tab ? ' on' : ''}`, `${icon(t.icon, 14)}<span>${escapeHtml(t.label)}</span>`);
      b.onclick = () => {
        tab = t.id;
        render();
      };
      nav.append(b);
    }
    const fill = { general, data, x: axisX, y: axisY, color, marker, labels, legend, trellis, connect, lines, tooltip }[tab];
    fill(s, v);
  }

  // Changes that need new data from the worker, or only a redraw.
  const set = (fn) => {
    api.setProp(fn);
    render();
  };
  const look = (fn) => {
    api.setLook(fn);
    render();
  };

  function general(s) {
    body.append(field('Visualization type', select(Object.entries(PLOT_TYPES).map(([value, t]) => ({ value, label: t.label })), s.type, (t) => api.changeType(t))));
    body.append(field('Title', input(s.title || '', (val) => look((x) => { x.title = val.trim() || null; }), { placeholder: autoTitle(s) })));
    if (AGGED.includes(s.type) && s.y?.[0]?.col) body.append(field('Aggregation', select(AGGS, s.agg || 'sum', (val) => set((x) => { x.agg = val; }))));
    if (s.type === 'bar') {
      body.append(field('Order', select([{ value: 'name', label: 'By category' }, { value: 'value', label: 'By value (largest first)' }], s.sort || 'name', (val) => set((x) => { x.sort = val; }))));
      if (s.color) body.append(check('Stacked bars', s.stacked, (on) => look((x) => { x.stacked = on; })));
    }
    if (s.type === 'histogram' || s.type === 'heatmap') body.append(field('Bins', input(s.bins || '', (val) => set((x) => { x.bins = num(val) > 1 ? Math.min(500, Math.round(num(val))) : null; }), { type: 'number', placeholder: 'Auto', min: 2, max: 500 })));
    if (s.type === 'histogram') body.append(field('Show', select([{ value: 'count', label: 'Count' }, { value: 'percent', label: 'Percent' }, { value: 'density', label: 'Density' }], s.normalize || 'count', (val) => set((x) => { x.normalize = val; }))));
    const actions = h('div', 'an-props-actions');
    const dup = h('button', 'btn', `${icon('duplicate', 14)} Duplicate to a new page`);
    dup.title = 'Ctrl+D';
    dup.onclick = () => api.duplicate();
    const rm = h('button', 'btn', `${icon('trash', 14)} Remove`);
    rm.onclick = () => api.remove();
    actions.append(dup, rm);
    body.append(actions);
  }

  function data(s) {
    body.append(group('Filtering'));
    body.append(field('Rows to use', select([
      { value: 'page', label: 'Filtered rows (filters panel)' },
      { value: 'all', label: 'All rows (ignore filters)' },
    ], s.ignoreFilters ? 'all' : 'page', (val) => set((x) => { x.ignoreFilters = val === 'all'; }))));
    const lim = input(s.limit || '', (val) => set((x) => { x.limit = val.trim() || null; }), { placeholder: 'e.g. [Temp] > 20 and [Site] == "B"' });
    lim.spellcheck = false;
    lim.classList.add('an-mono');
    body.append(field('Limit data using a formula', lim));
    body.append(h('div', 'an-meta', 'Only this visualization uses these limits. Other plots keep the page filters.'));
    body.append(group('Filters for this visualization only'));
    const own = s.vizFilters || {};
    for (const [name, spec] of Object.entries(own)) body.append(vizFilter(name, spec));
    const adder = select(colOptions(() => true, 'Add a filter on…'), '', (name) => {
      if (!name) return;
      const c = cols().find((k) => k.name === name);
      set((x) => {
        x.vizFilters = { ...(x.vizFilters || {}), [name]: c.type === 'string' ? { kind: 'values', values: [], exclude: true } : { kind: 'range', min: null, max: null, missing: true } };
      });
    });
    body.append(adder);
  }

  function vizFilter(name, spec) {
    const c = cols().find((k) => k.name === name);
    const box = h('div', 'an-vfilter');
    const top = h('div', 'an-vfilter-head', `${icon(TYPE_ICON[c?.type] || 'colText', 13)}<span>${escapeHtml(name)}</span>`);
    const rm = h('button', 'btn an-x', icon('close', 12));
    rm.title = 'Remove this filter';
    rm.onclick = () => set((x) => {
      const next = { ...(x.vizFilters || {}) };
      delete next[name];
      x.vizFilters = next;
    });
    top.append(rm);
    box.append(top);
    const put = (next) => set((x) => { x.vizFilters = { ...(x.vizFilters || {}), [name]: next }; });
    if (!c) {
      box.append(h('div', 'an-meta', 'This column is gone.'));
      return box;
    }
    if (c.type === 'string') {
      const list = h('div', 'an-values an-vvalues');
      list.textContent = 'Loading values…';
      api.client.call('profile', name).then((prof) => {
        list.innerHTML = '';
        const all = prof.values.map((x) => x.value);
        if (prof.missing) all.push('');
        const chosen = new Set(spec.exclude ? all.filter((x) => !spec.values.includes(x)) : spec.values);
        const commit = () => put(chosen.size === all.length ? { kind: 'values', values: [], exclude: true } : { kind: 'values', values: [...chosen] });
        for (const value of all.slice(0, 2000)) {
          const row = h('label', 'an-value');
          const b = h('input');
          b.type = 'checkbox';
          b.checked = chosen.has(value);
          b.onchange = () => {
            if (b.checked) chosen.add(value);
            else chosen.delete(value);
            commit();
          };
          row.append(b, h('span', '', escapeHtml(value || '(Empty)')));
          list.append(row);
        }
      }).catch((err) => {
        list.textContent = err.message;
      });
      box.append(list);
    } else {
      const isDate = c.type === 'date';
      const show = (v) => (v == null ? '' : isDate ? new Date(v).toISOString().slice(0, 10) : String(v));
      const read = (t) => (!String(t).trim() ? null : isDate ? (Number.isNaN(Date.parse(t)) ? null : Date.parse(t)) : num(t));
      const row = h('div', 'an-range-inputs');
      const a = input(show(spec.min), (t) => put({ ...spec, min: read(t) }), { placeholder: 'Lowest' });
      const b = input(show(spec.max), (t) => put({ ...spec, max: read(t) }), { placeholder: 'Highest' });
      row.append(a, h('span', '', 'to'), b);
      box.append(row, check('Include empty values', spec.missing !== false, (on) => put({ ...spec, missing: on })));
    }
    return box;
  }

  function axisFields(key, s, { log, logKey } = {}) {
    const a = s.axes?.[key] || {};
    const put = (k, val) => look((x) => {
      x.axes = { ...(x.axes || {}), [key]: { ...(x.axes?.[key] || {}), [k]: val } };
      x.view = null;
    });
    body.append(field('Axis title', input(a.title || '', (val) => put('title', val.trim() || null), { placeholder: 'Column name' })));
    const range = h('div', 'an-range-inputs');
    range.append(input(a.min ?? '', (val) => put('min', num(val)), { placeholder: 'Auto' }), h('span', '', 'to'), input(a.max ?? '', (val) => put('max', num(val)), { placeholder: 'Auto' }));
    body.append(field('Range (min to max)', range));
    const checks = h('div', 'an-checks');
    if (log) checks.append(check('Log scale', s[logKey], (on) => set((x) => { x[logKey] = on; })));
    checks.append(check('Reverse', a.reverse, (on) => put('reverse', on)));
    checks.append(check('Gridlines', a.grid !== false, (on) => put('grid', on)));
    checks.append(check('Tick labels', a.labels !== false, (on) => put('labels', on)));
    body.append(checks);
  }

  function axisX(s) {
    const xOptional = ['bar', 'box', 'table'].includes(s.type);
    body.append(field(s.type === 'bar' || s.type === 'box' ? 'Category column' : 'Column', select(colOptions(s.type === 'histogram' ? numeric : () => true, xOptional ? '(none)' : null), s.x || '', (val) => set((x) => { x.x = val || null; }))));
    axisFields('x', s, { log: XY.includes(s.type), logKey: 'logX' });
  }

  function axisY(s) {
    if (XY.includes(s.type) || s.type === 'combo') {
      const box = h('div', 'an-series');
      s.y.forEach((ys, i) => {
        const row = h('div', 'an-series-row');
        row.append(select(colOptions(numeric), ys.col, (val) => set((x) => { x.y[i].col = val; })));
        const side = h('button', `btn an-axis${ys.axis === 'right' ? ' on' : ''}`, ys.axis === 'right' ? 'Right' : 'Left');
        side.title = 'Which Y axis this series uses';
        side.onclick = () => set((x) => { x.y[i].axis = x.y[i].axis === 'right' ? 'left' : 'right'; });
        row.append(side);
        if (s.y.length > 1) {
          const rm = h('button', 'btn an-x', icon('close', 12));
          rm.onclick = () => set((x) => { x.y.splice(i, 1); });
          row.append(rm);
        }
        box.append(row);
      });
      const add = h('button', 'btn an-wide', `${icon('plus', 12)} Add Y series`);
      add.onclick = () => set((x) => {
        const used = new Set(x.y.map((y) => y.col));
        const next = cols().find((c) => numeric(c) && !used.has(c.name) && c.name !== x.x);
        if (next) x.y.push({ col: next.name, axis: 'left' });
      });
      box.append(add);
      body.append(field('Columns', box));
    } else if (s.type === 'bar' || s.type === 'waterfall') {
      body.append(field('Value', select(colOptions(() => true, '(row count)'), s.y?.[0]?.col || '', (val) => set((x) => {
        x.y = val ? [{ col: val }] : [];
        x.agg = val ? (x.agg && x.agg !== 'count' ? x.agg : 'mean') : 'count';
      }))));
    } else {
      body.append(field('Column', select(colOptions(numeric), s.y?.[0]?.col || '', (val) => set((x) => { x.y = [{ col: val }]; }))));
    }
    axisFields('y', s, { log: [...XY, 'box'].includes(s.type), logKey: 'logY' });
    if ((s.y || []).some((y) => y.axis === 'right')) {
      body.append(group('Right Y axis'));
      axisFields('y2', s, { log: true, logKey: 'logY2' });
    }
  }

  function color(s) {
    const can = ['scatter', 'line', 'bar', 'histogram', 'table'].includes(s.type) && (s.y || []).length <= 1;
    if (can) body.append(field(s.type === 'table' ? 'Columns' : 'Color by', select(colOptions(() => true, '(none)'), s.color || '', (val) => set((x) => { x.color = val || null; }))));
    if (s.type === 'box') body.append(check('Color each box', !!s.color, (on) => set((x) => { x.color = on ? x.x : null; })));
    const mk = s.marker || {};
    if (!s.color && (s.y || []).length <= 1 && ['scatter', 'line', 'bar', 'histogram'].includes(s.type)) {
      const row = h('div', 'an-color-row');
      const pick = h('input');
      pick.type = 'color';
      pick.value = mk.color || '#2a6fdb';
      pick.onchange = () => look((x) => { x.marker = { ...(x.marker || {}), color: pick.value }; });
      const auto = h('button', 'btn an-small', 'Automatic');
      auto.onclick = () => look((x) => { x.marker = { ...(x.marker || {}), color: null }; });
      row.append(pick, auto);
      body.append(field('Fixed color', row));
    }
    if (XY.includes(s.type)) body.append(field('Opacity', slider(num(mk.opacity) ?? 0.85, 0.05, 1, 0.05, (val) => look((x) => { x.marker = { ...(x.marker || {}), opacity: val }; }))));
  }

  function marker(s, v) {
    const mk = s.marker || {};
    const put = (k, val, fetch = false) => (fetch ? set : look)((x) => { x.marker = { ...(x.marker || {}), [k]: val }; });
    if (s.type === 'line') body.append(check('Show markers on the line', s.markers, (on) => look((x) => { x.markers = on; })));
    body.append(field('Shape', select(MARKER_SHAPES.map((m) => ({ value: m, label: SHAPE_LABELS[m] })), mk.shape || 'circle', (val) => put('shape', val))));
    body.append(field('Size', slider(num(mk.size) ?? num(s.markerSize) ?? 5, 1, 24, 0.5, (val) => put('size', val), (val) => {
      s.marker = { ...(s.marker || {}), size: val };
      v.panels ? v.fetch() : v.draw();
    })));
    if (s.type === 'scatter') {
      body.append(field('Size by', select(colOptions(() => true, '(fixed size)'), mk.sizeBy || '', (val) => put('sizeBy', val || null, true))));
      body.append(field('Shape by', select(colOptions(() => true, '(one shape)'), mk.shapeBy || '', (val) => put('shapeBy', val || null, true))));
      body.append(field('Jitter', slider(num(mk.jitter) ?? 0, 0, 1, 0.05, (val) => put('jitter', val, true))));
      body.append(h('div', 'an-meta', 'Jitter spreads points that sit on top of each other.'));
    }
    if (s.type === 'line') body.append(field('Line width', slider(num(s.lineWidth) ?? 2.2, 0.5, 6, 0.1, (val) => look((x) => { x.lineWidth = val; }))));
  }

  function labels(s) {
    const lb = s.labels || {};
    const put = (k, val) => set((x) => { x.labels = { ...(x.labels || {}), [k]: val }; });
    body.append(field('Show labels for', select([{ value: 'none', label: 'None' }, { value: 'marked', label: 'Marked rows' }, { value: 'all', label: 'All rows' }], lb.show || 'none', (val) => put('show', val))));
    if (s.type === 'scatter') {
      body.append(field('Label by', select(colOptions(() => true, '(choose a column)'), lb.col || '', (val) => put('col', val || null))));
      body.append(field('Most labels to show', input(lb.max || 200, (val) => put('max', Math.max(1, Math.min(2000, Math.round(num(val) || 200)))), { type: 'number', min: 1, max: 2000 })));
    } else body.append(h('div', 'an-meta', 'Shows each bar’s or slice’s value on the chart.'));
  }

  function legend(s) {
    const lg = s.legend || {};
    body.append(check('Show the legend', lg.show !== false, (on) => look((x) => { x.legend = { ...(x.legend || {}), show: on }; })));
    body.append(field('Position', select([{ value: 'right', label: 'Right' }, { value: 'bottom', label: 'Bottom' }], lg.position || 'right', (val) => look((x) => { x.legend = { ...(x.legend || {}), position: val }; }))));
  }

  function trellis(s) {
    const t = s.trellis || {};
    const put = (k, val) => set((x) => { x.trellis = { ...(x.trellis || {}), [k]: val }; });
    const mode = !t.mode || (!t.by && !t.rows && !t.cols) ? 'none' : t.mode;
    body.append(h('div', 'an-meta', 'Trellis splits this visualization into one small panel per category, all on the same axes.'));
    body.append(field('Split into', select([{ value: 'none', label: 'One visualization (no trellis)' }, { value: 'panels', label: 'Panels' }, { value: 'grid', label: 'Rows and columns' }], mode, (val) => set((x) => {
      if (val === 'none') x.trellis = null;
      else {
        const first = cols().find((c) => c.type === 'string')?.name || cols()[0]?.name;
        x.trellis = { ...(x.trellis || {}), mode: val };
        if (val === 'panels' && !x.trellis.by) x.trellis.by = first;
        if (val === 'grid' && !x.trellis.rows && !x.trellis.cols) x.trellis.rows = first;
      }
    }))));
    if (mode === 'panels') {
      body.append(field('Panel by', select(colOptions(), t.by || '', (val) => put('by', val))));
      body.append(field('Panels per row', input(t.columns || '', (val) => put('columns', num(val) ? Math.max(1, Math.min(12, Math.round(num(val)))) : null), { type: 'number', placeholder: 'Auto', min: 1, max: 12 })));
    }
    if (mode === 'grid') {
      body.append(field('Rows', select(colOptions(() => true, '(none)'), t.rows || '', (val) => put('rows', val || null))));
      body.append(field('Columns', select(colOptions(() => true, '(none)'), t.cols || '', (val) => put('cols', val || null))));
    }
    if (mode !== 'none') {
      body.append(field('Most panels', input(t.max || 24, (val) => put('max', Math.max(1, Math.min(100, Math.round(num(val) || 24)))), { type: 'number', min: 1, max: 100 })));
      body.append(check('Same axis range in every panel', t.shared !== false, (on) => put('shared', on)));
    }
  }

  function connect(s) {
    const cn = s.connect || {};
    const put = (k, val, fetch = true) => (fetch ? set : look)((x) => { x.connect = { ...(x.connect || {}), [k]: val }; });
    body.append(h('div', 'an-meta', 'Draws lines between the points, one line per category, in the order you choose.'));
    body.append(check('Connect the points with lines', cn.on, (on) => put('on', on)));
    if (cn.on) {
      body.append(field('Connect by', select(colOptions(() => true, '(one line)'), cn.by || '', (val) => put('by', val || null))));
      body.append(field('Order by', select(colOptions(numeric, '(X axis)'), cn.order || '', (val) => put('order', val || null))));
      body.append(field('Line width', slider(num(cn.width) ?? 1.8, 0.5, 6, 0.1, (val) => put('width', val, false))));
    }
  }

  function lines(s, v) {
    body.append(group('Reference lines'));
    const refs = s.refLines || [];
    const axes = [{ value: 'y', label: 'Horizontal (Y)' }, ...(['scatter', 'line', 'histogram'].includes(s.type) ? [{ value: 'x', label: 'Vertical (X)' }] : [])];
    if ((s.y || []).some((y) => y.axis === 'right')) axes.push({ value: 'y2', label: 'Horizontal (right Y)' });
    refs.forEach((r, i) => {
      const box = h('div', 'an-refline');
      const upd = (k, val) => set((x) => { x.refLines = x.refLines.map((q, j) => (j === i ? { ...q, [k]: val } : q)); });
      const kinds = [{ value: 'value', label: 'At a value' }];
      if (XY.includes(s.type) || (s.type === 'histogram' && r.axis === 'x')) kinds.push({ value: 'mean', label: 'Average' }, { value: 'median', label: 'Median' });
      const top = h('div', 'an-series-row');
      top.append(select(axes, r.axis || 'y', (val) => upd('axis', val)), select(kinds, r.kind || 'value', (val) => upd('kind', val)));
      const rm = h('button', 'btn an-x', icon('close', 12));
      rm.onclick = () => set((x) => { x.refLines = x.refLines.filter((_, j) => j !== i); });
      top.append(rm);
      box.append(top);
      const row = h('div', 'an-series-row');
      if ((r.kind || 'value') === 'value') row.append(input(r.value ?? '', (val) => upd('value', num(val)), { placeholder: 'Value' }));
      row.append(input(r.label || '', (val) => upd('label', val.trim() || null), { placeholder: 'Label (optional)' }));
      const pick = h('input');
      pick.type = 'color';
      pick.value = r.color || '#b3261e';
      pick.onchange = () => upd('color', pick.value);
      row.append(pick);
      box.append(row);
      body.append(box);
    });
    const add = h('button', 'btn an-wide', `${icon('plus', 12)} Add a reference line`);
    add.onclick = () => set((x) => { x.refLines = [...(x.refLines || []), { axis: 'y', kind: XY.includes(x.type) ? 'mean' : 'value', value: null }]; });
    body.append(add);
    if (XY.includes(s.type)) {
      body.append(group('Curve fits'));
      for (const f of s.fits || []) {
        const chip = h('div', 'an-fit-chip', `<span>${escapeHtml(f.result?.label || f.model)}${f.model === 'poly' ? ` (${f.degree})` : ''}</span>`);
        const rm = h('button', '', '×');
        rm.onclick = () => {
          api.removeFit(v, f);
          render();
        };
        chip.append(rm);
        body.append(chip);
      }
      const fitBtn = h('button', 'btn an-wide', `${icon('fitCurve', 14)} Fit curve…`);
      fitBtn.onclick = () => api.fitMenu(fitBtn);
      body.append(fitBtn);
    }
  }

  function tooltip(s) {
    body.append(h('div', 'an-meta', 'Columns shown when you point at a marker. None chosen shows the first ten.'));
    const chosen = new Set(s.tooltip?.cols || []);
    const list = h('div', 'an-values an-vvalues');
    for (const c of cols()) {
      const row = h('label', 'an-value');
      const b = h('input');
      b.type = 'checkbox';
      b.checked = chosen.has(c.name);
      b.onchange = () => {
        if (b.checked) chosen.add(c.name);
        else chosen.delete(c.name);
        api.setLook((x) => { x.tooltip = { cols: cols().map((k) => k.name).filter((n) => chosen.has(n)) }; });
      };
      row.append(b, h('span', '', `${icon(TYPE_ICON[c.type], 12)} ${escapeHtml(c.name)}`));
      list.append(row);
    }
    body.append(list);
  }

  return { el, open, close, render, isOpen: () => !el.hidden };
}
