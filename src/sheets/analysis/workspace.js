// Plot's analysis workspace: pages of linked visualizations over one big
// table, with a tool rail and data panel on the left, filters and fit results
// on the right and the details table underneath. Data lives in a worker.

import { icon } from '../../shared/icons.js';
import { dialog, escapeHtml, h, toast } from '../../shared/shell.js';
import { popup, closePopup } from '../../shared/ribbon.js';
import { DataClient } from './client.js';
import { AGGS, PLOT_TYPES, PlotView, autoTitle, fitText } from './plot.js';
import { MODELS, fitExpression } from './fit.js';
import { FUNCTIONS } from './expr.js';
import { formatValue } from './axes.js';
import { sendToPresent } from './to-present.js';
import { createProps } from './props.js';
import { kbd, menuAt, showShortcuts } from './menus.js';

const TYPE_ICON = { number: 'colNumber', string: 'colText', date: 'colDate' };
const AGGED = ['bar', 'pie', 'table'];
const ROW_H = 22;
const fmtInt = (n) => Number(n || 0).toLocaleString();
let plotSeq = 0;

export function createAnalysis({ getShell, onSheetData, onShow, sendToSheet }) {
  const shell = { refresh: () => getShell()?.refresh(), get claude() { return getShell()?.claude; } };
  const client = new DataClient();
  const st = {
    info: null,
    pages: [{ title: 'Page 1', plots: [] }],
    page: 0,
    get plots() { return this.pages[this.page].plots; },
    set plots(v) { this.pages[this.page].plots = v; },
    steps: [],
    active: null,
    source: null,
    projectPath: null,
    calculated: [],
    table: { open: true, source: 'auto', height: 210 },
    panels: { left: true, right: true },
    undo: null,
  };

  // ---------- DOM ----------
  const root = h('div', 'an-root');
  const main = h('div', 'an-main');
  const rail = h('nav', 'an-rail');
  const left = h('aside', 'an-side an-left');
  const center = h('section', 'an-center');
  const right = h('aside', 'an-side an-right');
  const pagesBar = h('div', 'an-pages');
  const page = h('div', 'an-page');
  const empty = h('div', 'an-empty');
  const loading = h('div', 'an-loading', '<div class="an-load-box"><b></b><div class="an-bar"><i></i></div><span></span></div>');
  center.append(pagesBar, page, empty, loading);
  page.addEventListener('contextmenu', (e) => {
    if (e.target !== page || !st.info) return;
    e.preventDefault();
    pageContextMenu(e.clientX, e.clientY);
  });
  main.append(rail, left, center, right);
  const tableWrap = h('div', 'an-table');
  root.append(main, tableWrap);
  const statusEl = h('span', 'an-status');

  empty.innerHTML = `
    <div class="an-empty-box">
      ${icon('chartScatter', 44)}
      <h2>Analyze and plot large data</h2>
      <p>Open a CSV, TSV, Parquet or Excel file of any size. Data is read in a background worker into columns, so files with tens of millions of rows open without a row limit.</p>
      <div class="an-empty-actions">
        <button class="btn primary" data-act="open">${icon('open', 16)} Open data file…</button>
        <button class="btn" data-act="sheet">${icon('table', 16)} Use this sheet’s data</button>
      </div>
      <p class="muted">Or drop a file here. Then make plots from the Analyze tab, filter on the right, and drag across any plot to mark rows in every plot.</p>
    </div>`;
  empty.querySelector('[data-act="open"]').onclick = () => openData();
  empty.querySelector('[data-act="sheet"]').onclick = () => useSheet();

  root.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files')) {
      e.preventDefault();
      root.classList.add('an-drop');
    }
  });
  root.addEventListener('dragleave', (e) => {
    if (!root.contains(e.relatedTarget)) root.classList.remove('an-drop');
  });
  root.addEventListener('drop', async (e) => {
    root.classList.remove('an-drop');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    const got = await window.office.data.fromFiles(e.dataTransfer.files);
    if (got?.error) return toast(got.error, 'error');
    if (got?.[0]) loadSource(got[0]);
    return undefined;
  });

  // ---------- loading ----------
  function setLoading(text, fraction = null, rows = null) {
    if (text == null) {
      loading.classList.remove('show');
      return;
    }
    loading.classList.add('show');
    loading.querySelector('b').textContent = text;
    loading.querySelector('i').style.width = `${Math.round((fraction ?? 0) * 100)}%`;
    loading.querySelector('.an-bar').classList.toggle('indeterminate', fraction == null);
    loading.querySelector('span').textContent = rows != null ? `${fmtInt(rows)} rows read` : '';
  }

  async function confirmReplace() {
    if (!st.info) return true;
    const ok = await dialog({ title: 'Replace the data?', body: 'This analysis will switch to the new data. Plots are kept where their columns still exist; filters and calculated columns are cleared.', ok: 'Replace' });
    return !!ok;
  }

  async function openData() {
    const picked = await window.office.data.openDialog();
    if (picked?.error) return toast(picked.error, 'error');
    if (picked) await loadSource(picked);
    return undefined;
  }

  async function loadSource(src, { sheet = null, restore = null } = {}) {
    if (!restore && !(await confirmReplace())) return;
    onShow?.();
    let opts = { ext: src.ext };
    if ((src.ext === 'xlsx' || src.ext === 'xlsm') && sheet == null) {
      try {
        setLoading(`Reading ${src.name}…`);
        const sheets = await client.call('sheets', { handle: src.handle, size: src.size, name: src.name });
        if (sheets.length > 1) {
          setLoading(null);
          const pick = await dialog({ title: 'Choose a sheet', fields: [{ name: 'sheet', label: 'Sheet', type: 'select', options: sheets.map((s, i) => ({ value: String(i), label: s.name })) }], ok: 'Open' });
          if (!pick) return;
          sheet = Number(pick.sheet);
        }
      } catch (err) {
        setLoading(null);
        toast(err.message, 'error');
        return;
      }
    }
    if (sheet != null) opts = { ...opts, sheet };
    const started = performance.now();
    setLoading(`Opening ${src.name}…`, 0);
    try {
      const info = await client.callWith({ onProgress: (p) => setLoading(`Opening ${src.name}…`, p.fraction, p.rows) }, 'load', { handle: src.handle, size: src.size, name: src.name }, opts);
      st.source = { kind: 'file', handle: src, path: src.path, name: src.name, ext: src.ext, sheet: opts.sheet ?? null };
      st.steps = [];
      await afterLoad(info, restore);
      const secs = (performance.now() - started) / 1000;
      toast(`Opened ${fmtInt(info.rows)} rows × ${info.columns.length} columns in ${secs < 10 ? secs.toFixed(1) : Math.round(secs)} s`);
    } catch (err) {
      toast(err.message || String(err), 'error');
    } finally {
      setLoading(null);
    }
  }

  async function useSheet() {
    const sheet = onSheetData?.();
    if (!sheet?.matrix?.length) return toast('This sheet is empty. Put a header row and data in it first.', 'error');
    if (!(await confirmReplace())) return undefined;
    onShow?.();
    try {
      const info = await client.call('fromRows', sheet.matrix, sheet.name);
      st.source = { kind: 'sheet', name: sheet.name, rows: sheet.matrix };
      st.steps = [];
      await afterLoad(info);
    } catch (err) {
      toast(err.message, 'error');
    }
    return undefined;
  }

  async function afterLoad(info, restore = null) {
    st.info = info;
    st.calculated = [];
    st.undo = null;
    if (restore) {
      if (restore.steps?.length) await replaySteps(restore.steps, restore.stepHandles || []);
      for (const c of restore.calculated || []) {
        try {
          st.info = (await client.call('addCalculated', c.name, c.expr)).info;
          st.calculated.push(c);
        } catch (err) {
          toast(`Calculated column ${c.name}: ${err.message}`, 'error');
        }
      }
      if (restore.filters) st.info = await client.call('restoreFilters', restore.filters).catch(() => st.info);
      restorePages(restore.pages || [{ title: 'Page 1', plots: restore.plots || [] }], restore.page || 0);
      if (restore.table) Object.assign(st.table, restore.table);
    } else {
      const cols = new Set(info.columns.map((c) => c.name));
      const fits = (v) => [v.spec.x, v.spec.color, ...(v.spec.y || []).map((s) => s.col)].filter(Boolean).every((n) => cols.has(n));
      st.pages.forEach((pg, i) => {
        for (const v of [...pg.plots]) if (!fits(v)) {
          if (i === st.page) removePlot(v, { quiet: true });
          else {
            pg.plots = pg.plots.filter((x) => x !== v);
            v.destroy();
          }
        }
      });
      if (!st.pages.some((pg) => pg.plots.length)) {
        st.pages = [{ title: 'Page 1', plots: [] }];
        st.page = 0;
        defaultPlots();
      }
    }
    if (!restore) {
      openFilters.clear();
      for (const c of st.info.columns.slice(0, 8)) openFilters.add(c.name);
    }
    root.classList.add('has-data');
    renderAll();
    refreshPlots();
  }

  function defaultPlots() {
    const cols = st.info.columns;
    const nums = cols.filter((c) => c.type === 'number');
    const date = cols.find((c) => c.type === 'date');
    const text = cols.find((c) => c.type === 'string');
    if (date && nums.length) addPlot({ type: 'line', x: date.name, y: [{ col: nums[0].name }] }, { quiet: true });
    else if (nums.length >= 2) addPlot({ type: 'scatter', x: nums[0].name, y: [{ col: nums[1].name }], color: text?.name || null }, { quiet: true });
    if (nums.length) addPlot({ type: 'histogram', x: nums[nums.length > 1 ? 1 : 0].name }, { quiet: true });
    else if (text) addPlot({ type: 'bar', x: text.name, y: [], agg: 'count' }, { quiet: true });
  }

  // ---------- plots ----------
  function newSpec(type) {
    const cols = st.info?.columns || [];
    const nums = cols.filter((c) => c.type !== 'string');
    const texts = cols.filter((c) => c.type === 'string');
    const date = cols.find((c) => c.type === 'date');
    const a = st.active?.spec;
    const xNum = a?.x && cols.find((c) => c.name === a.x && c.type !== 'string') ? a.x : (date || nums[0])?.name;
    const yNum = a?.y?.[0]?.col || nums.find((c) => c.name !== xNum)?.name || nums[0]?.name;
    switch (type) {
      case 'scatter': return { type, x: xNum, y: [{ col: yNum }], color: texts[0]?.name || null };
      case 'line': return { type, x: xNum, y: [{ col: yNum }] };
      case 'multi': {
        const ys = nums.filter((c) => c.name !== xNum).slice(0, 2);
        return { type: 'line', x: xNum, y: ys.map((c, i) => ({ col: c.name, axis: i ? 'right' : 'left' })) };
      }
      case 'bar': return texts[0] ? { type, x: texts[0].name, y: yNum ? [{ col: yNum }] : [], agg: yNum ? 'mean' : 'count' } : { type, x: xNum, y: [], agg: 'count' };
      case 'histogram': return { type, x: yNum || xNum, color: null };
      case 'box': return { type, x: texts[0]?.name || null, y: [{ col: yNum }] };
      case 'heatmap': return { type, x: xNum, y: [{ col: yNum }], bins: 40 };
      case 'pie': return { type, x: texts[0]?.name || xNum, y: [], agg: 'count' };
      case 'table': return { type, x: texts[0]?.name || null, color: texts[1]?.name || null, y: yNum ? [{ col: yNum }] : [], agg: yNum ? 'mean' : 'count' };
      default: return { type: 'scatter', x: xNum, y: [{ col: yNum }] };
    }
  }

  function addPlot(spec, { quiet = false } = {}) {
    if (!st.info) {
      toast('Open a data file first');
      return null;
    }
    const s = { id: `p${++plotSeq}`, fits: [], ...JSON.parse(JSON.stringify(spec)) };
    if (typeof s.y === 'string') s.y = [{ col: s.y }];
    s.y ||= [];
    const view = new PlotView(s, viewCtx);
    st.plots.push(view);
    page.append(view.el);
    layoutPage();
    setActive(view);
    if (!quiet) {
      view.fetch();
      renderProps();
    }
    return view;
  }

  function removePlot(view, { quiet = false } = {}) {
    st.plots = st.plots.filter((v) => v !== view);
    view.destroy();
    if (st.active === view) st.active = st.plots[st.plots.length - 1] || null;
    layoutPage();
    if (!quiet) {
      st.active?.el.classList.add('active');
      renderProps();
      renderFits();
    }
  }

  function clearPlots() {
    for (const v of [...st.plots]) removePlot(v, { quiet: true });
  }

  function layoutPage() {
    const n = st.plots.length;
    const colsN = n <= 1 ? 1 : n <= 4 ? 2 : 3;
    page.style.gridTemplateColumns = `repeat(${colsN}, minmax(0, 1fr))`;
    page.style.gridTemplateRows = `repeat(${Math.max(1, Math.ceil(n / colsN))}, minmax(220px, 1fr))`;
  }

  // ---------- pages ----------
  function renderPages() {
    pagesBar.innerHTML = '';
    st.pages.forEach((pg, i) => {
      const tab = h('button', `an-page-tab${i === st.page ? ' on' : ''}`, `<span>${escapeHtml(pg.title)}</span>`);
      tab.title = 'Double-click to rename; right-click for more';
      tab.onclick = () => switchPage(i);
      tab.ondblclick = () => renamePage(i);
      tab.oncontextmenu = (e) => {
        e.preventDefault();
        pageMenu(i, e.clientX, e.clientY);
      };
      pagesBar.append(tab);
    });
    const add = h('button', 'an-page-add', icon('plus', 14));
    add.title = 'New page';
    add.onclick = () => addPage();
    pagesBar.append(add);
  }

  function pageMenu(i, x, y) {
    menuAt(x, y, [
      { label: 'Rename…', icon: 'textbox', run: () => renamePage(i) },
      { label: 'New page', icon: 'slideNew', kbd: kbd('Ctrl+N'), run: () => addPage() },
      { label: 'Duplicate page', icon: 'duplicate', kbd: kbd('Ctrl+Shift+D'), run: () => addPage(st.pages[i], i + 1) },
      '-',
      { label: 'Move left', icon: 'prevSlide', run: () => movePage(i, -1), enabled: i > 0 },
      { label: 'Move right', icon: 'nextSlide', run: () => movePage(i, 1), enabled: i < st.pages.length - 1 },
      '-',
      { label: 'Delete page', icon: 'trash', run: () => deletePage(i), enabled: st.pages.length > 1 },
    ]);
  }

  function showPage(i) {
    for (const v of st.plots) v.el.remove();
    st.page = Math.max(0, Math.min(st.pages.length - 1, i));
    for (const v of st.plots) page.append(v.el);
    layoutPage();
    st.active = null;
    setActive(st.plots[0] || null);
    renderPages();
  }

  function switchPage(i) {
    if (i === st.page) return;
    showPage(i);
    refreshPlots();
  }

  // A new page, at the end or at a position (copies go right after their page).
  function addPage(copyFrom = null, at = null) {
    const n = st.pages.length + 1;
    const where = at == null ? st.pages.length : Math.max(0, Math.min(st.pages.length, at));
    for (const v of st.plots) v.el.remove();
    st.pages.splice(where, 0, { title: copyFrom ? uniqueTitle(`${copyFrom.title} (copy)`) : uniqueTitle(`Page ${n}`), plots: [] });
    st.page = where;
    const specs = copyFrom ? copyFrom.plots.map((v) => ({ ...JSON.parse(JSON.stringify(v.spec)), id: undefined })) : [];
    showPage(where);
    for (const spec of specs) addPlot(spec, { quiet: true });
    refreshPlots();
    renderProps();
  }

  function uniqueTitle(title) {
    const taken = new Set(st.pages.map((pg) => pg.title));
    if (!taken.has(title)) return title;
    for (let k = 2; ; k += 1) if (!taken.has(`${title} ${k}`)) return `${title} ${k}`;
  }

  // Ctrl+D: the selected visualization, copied onto its own new page right
  // after this one, where its type and settings can be changed freely.
  function duplicateViz(v = st.active) {
    if (!v) return toast('Select a visualization first');
    const spec = JSON.parse(JSON.stringify({ ...v.spec, id: undefined, view: v.spec.view }));
    const title = (v.spec.title || autoTitle(v.spec)).slice(0, 40);
    for (const x of st.plots) x.el.remove();
    const at = st.page + 1;
    st.pages.splice(at, 0, { title: uniqueTitle(title), plots: [] });
    showPage(at);
    const copy = addPlot(spec);
    refreshPlots();
    renderPages();
    toast(`Copied to the new page “${st.pages[at].title}”. Change its type or settings in Properties.`);
    if (copy) openProps(copy);
    return copy;
  }

  async function renamePage(i) {
    const got = await dialog({ title: 'Page name', fields: [{ name: 'title', label: 'Name', value: st.pages[i].title }] });
    if (got?.title.trim()) {
      st.pages[i].title = got.title.trim().slice(0, 60);
      renderPages();
    }
  }

  function movePage(i, d) {
    const [pg] = st.pages.splice(i, 1);
    st.pages.splice(i + d, 0, pg);
    if (st.page === i) st.page = i + d;
    else if (st.page === i + d) st.page = i;
    renderPages();
  }

  function deletePage(i) {
    if (st.pages.length < 2) return;
    for (const v of st.pages[i].plots) v.destroy();
    st.pages.splice(i, 1);
    const next = i < st.page ? st.page - 1 : Math.min(st.page, st.pages.length - 1);
    showPage(next);
    refreshPlots();
  }

  function restorePages(pages, current) {
    for (const pg of st.pages) for (const v of pg.plots) v.destroy();
    st.pages = pages.map((pg) => ({ title: pg.title || 'Page', plots: [] }));
    if (!st.pages.length) st.pages = [{ title: 'Page 1', plots: [] }];
    pages.forEach((pg, i) => {
      st.page = i;
      for (const spec of pg.plots || []) addPlot(spec, { quiet: true });
      for (const v of st.plots) v.el.remove();
    });
    st.page = Math.min(current, st.pages.length - 1);
    showPage(st.page);
  }

  function setActive(view) {
    if (st.active === view) return;
    st.active?.el.classList.remove('active');
    st.active = view;
    view?.el.classList.add('active');
    renderProps();
    renderFits();
    props.render();
    shell.refresh?.();
  }

  const viewCtx = {
    client,
    activate: (v) => setActive(v),
    remove: (v) => removePlot(v),
    changed: () => {},
    rename: async (v) => {
      const got = await dialog({ title: 'Plot title', fields: [{ name: 'title', label: 'Title', value: v.spec.title || autoTitle(v.spec) }] });
      if (got) {
        v.spec.title = got.title.trim() || null;
        v.updateHead();
        v.draw();
        renderProps();
      }
    },
    mark: async (v, sel, mode) => {
      st.info = await client.call('markPlot', v.spec, sel, mode);
      afterMark();
    },
    markRows: async (ids, mode) => {
      st.info = await client.call('markRows', ids, mode);
      afterMark();
    },
    clearMark: () => clearMark(),
    properties: (v) => openProps(v),
    contextMenu: (v, x, y) => vizContextMenu(v, x, y),
    axisMenu: (v, key, anchor) => axisMenu(v, key, anchor),
    axisPick: (v, key, name) => axisPick(v, key, name),
  };

  // Applies a column chosen on a plot's axis selector.
  function axisPick(v, key, name, agg = undefined) {
    setActive(v);
    const col = st.info?.columns.find((c) => c.name === name);
    setProp((x) => {
      if (key === 'x') x.x = name || null;
      else if (key === 'color') x.color = name || null;
      else if (key === 'value') {
        x.y = name ? [{ col: name }] : [];
        if (agg) x.agg = agg;
        else if (!name) x.agg = 'count';
        else if (!x.agg || x.agg === 'count') x.agg = col?.type === 'string' ? 'count' : 'mean';
      } else if (key === 'y') {
        const i = x.y.findIndex((y) => (y.axis || 'left') === 'left');
        if (i >= 0) x.y[i] = { ...x.y[i], col: name };
        else x.y.unshift({ col: name });
      }
    });
  }

  function axisMenu(v, key, anchor) {
    const s = v.spec;
    const m = h('div', 'rb-menu an-axis-menu');
    const numericOnly = (key === 'y') || (key === 'x' && s.type === 'histogram');
    const optional = key === 'color' || key === 'value' || (key === 'x' && ['bar', 'box', 'table'].includes(s.type));
    const current = key === 'x' ? s.x : key === 'color' ? s.color : s.y?.[0]?.col;
    if (key === 'value') {
      const aggs = h('div', 'an-agg-row');
      for (const a of AGGS) {
        const b = h('button', `an-agg${(s.y?.[0]?.col ? s.agg : 'count') === a.value ? ' on' : ''}`, escapeHtml(a.label));
        b.onclick = () => {
          closePopup();
          axisPick(v, key, a.value === 'count' && !s.y?.[0]?.col ? null : s.y?.[0]?.col || null, a.value);
        };
        aggs.append(b);
      }
      m.append(aggs);
    }
    const search = h('input', 'an-axis-search');
    search.placeholder = 'Find a column…';
    m.append(search);
    const list = h('div', 'an-axis-list');
    const fill = () => {
      list.innerHTML = '';
      const q = search.value.trim().toLowerCase();
      const opts = [];
      if (optional) opts.push({ name: null, label: key === 'value' ? '(row count)' : '(none)' });
      for (const c of st.info.columns) if ((!numericOnly || c.type !== 'string') && (!q || c.name.toLowerCase().includes(q))) opts.push({ name: c.name, label: c.name, c });
      for (const o of opts) {
        const b = h('button', `rb-menu-item${(o.name || null) === (current || null) ? ' on' : ''}`, `${o.c ? icon(o.c.expr ? 'colCalc' : TYPE_ICON[o.c.type], 14) : icon('close', 14)}<span>${escapeHtml(o.label)}</span>`);
        b.onclick = () => {
          closePopup();
          axisPick(v, key, o.name);
        };
        list.append(b);
      }
    };
    search.oninput = fill;
    fill();
    m.append(list);
    popup(anchor, m);
    setTimeout(() => search.focus(), 0);
  }

  function refreshPlots(except = null) {
    for (const v of st.plots) if (v !== except) v.fetch();
  }

  async function afterMark() {
    refreshPlots();
    if (st.table.source !== 'filtered') tableReset();
    else tableRender();
    renderStatus();
    shell.refresh?.();
  }

  async function clearMark() {
    if (!st.info?.marked) return;
    st.info = await client.call('clearMark');
    afterMark();
  }

  async function afterFilter(info) {
    st.info = info;
    refreshPlots();
    tableReset();
    renderStatus();
    renderFilterCounts();
    shell.refresh?.();
  }

  // ---------- left: data + properties ----------
  function renderLeft() {
    left.innerHTML = '';
    if (!st.info) return;
    const data = h('div', 'an-section');
    data.append(h('div', 'an-section-head', `${icon('database', 15)}<b>${escapeHtml(st.info.name)}</b>`));
    data.append(h('div', 'an-meta', `${fmtInt(st.info.rows)} rows · ${st.info.columns.length} columns`));
    const list = h('div', 'an-cols');
    for (const c of st.info.columns) {
      const row = h('div', 'an-col', `${icon(c.expr ? 'colCalc' : TYPE_ICON[c.type], 14)}<span title="${escapeHtml(c.expr ? `${c.name} = ${c.expr}` : c.name)}">${escapeHtml(c.name)}</span>`);
      row.draggable = true;
      row.ondragstart = (e) => e.dataTransfer.setData('text/x-column', c.name);
      row.onclick = (e) => columnMenu(c, row, e);
      row.oncontextmenu = (e) => {
        e.preventDefault();
        columnMenu(c, row, e);
      };
      list.append(row);
    }
    data.append(list);
    const addCalc = h('button', 'btn an-wide', `${icon('colCalc', 14)} Calculated column…`);
    addCalc.onclick = () => calculatedColumn();
    data.append(addCalc);
    left.append(data);
    propsHost = h('div', 'an-section an-props');
    left.append(propsHost);
    renderProps();
  }
  let propsHost = null;

  function columnMenu(c, anchor) {
    const m = h('div', 'rb-menu');
    const item = (label, ic, run) => {
      const b = h('button', 'rb-menu-item', `${icon(ic, 16)}<span>${label}</span>`);
      b.onclick = () => {
        closePopup();
        run();
      };
      m.append(b);
    };
    if (st.active) {
      item('Use as X axis', 'chartLine', () => setProp((s) => { s.x = c.name; }));
      if (['scatter', 'line'].includes(st.active.spec.type)) item('Add as Y series', 'plus', () => setProp((s) => { s.y.push({ col: c.name }); }));
      else item('Use as Y axis', 'up', () => setProp((s) => { s.y = [{ col: c.name }]; }));
      item('Color by', 'theme', () => setProp((s) => { s.color = c.name; }));
    }
    item(c.type === 'string' ? 'Bar chart of this column' : 'Histogram of this column', c.type === 'string' ? 'chartBar' : 'chartHist', () => addPlot(c.type === 'string' ? { type: 'bar', x: c.name, y: [], agg: 'count' } : { type: 'histogram', x: c.name }));
    item('Show its filter', 'filter', () => openFilter(c.name));
    if (c.expr) {
      item('Edit formula…', 'colCalc', () => calculatedColumn(c));
      item('Delete column', 'trash', async () => {
        try {
          const info = await client.call('removeColumn', c.name);
          st.calculated = st.calculated.filter((x) => x.name !== c.name);
          await afterFilter(info);
          renderLeft();
          renderFilters();
        } catch (err) {
          toast(err.message, 'error');
        }
      });
    }
    popup(anchor, m);
  }

  function colOptions(filter = () => true, none = null) {
    const opts = (st.info?.columns || []).filter(filter).map((c) => ({ value: c.name, label: c.name }));
    return none ? [{ value: '', label: none }, ...opts] : opts;
  }

  function setProp(fn) {
    const v = st.active;
    if (!v) return;
    fn(v.spec);
    v.spec.view = null;
    v.setSpec(v.spec);
    renderProps();
    renderFits();
    props.render();
  }

  // Settings that change only how a visualization looks: no new data.
  function setLook(fn) {
    const v = st.active;
    if (!v) return;
    fn(v.spec);
    v.updateHead();
    if (v.panels) v.fetch();
    else v.draw();
    renderProps();
  }

  function field(label, control) {
    const row = h('label', 'an-field');
    row.append(h('span', '', escapeHtml(label)), control);
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

  // Columns can be dropped on axis pickers.
  function droppable(el, onDrop) {
    el.addEventListener('dragover', (e) => {
      if ([...e.dataTransfer.types].includes('text/x-column')) {
        e.preventDefault();
        el.classList.add('an-dropping');
      }
    });
    el.addEventListener('dragleave', () => el.classList.remove('an-dropping'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('an-dropping');
      const name = e.dataTransfer.getData('text/x-column');
      if (name) {
        e.preventDefault();
        onDrop(name);
      }
    });
    return el;
  }

  function renderProps() {
    if (!propsHost) return;
    propsHost.innerHTML = '';
    const v = st.active;
    const headRow = h('div', 'an-section-head', `${icon('settings', 15)}<b>Plot properties</b>`);
    propsHost.append(headRow);
    if (v) {
      const more = h('button', 'btn an-small', 'All settings…');
      more.title = 'Trellis, markers, line connection, axes, labels, legend and more (Alt+Enter)';
      more.onclick = () => openProps(v);
      headRow.append(more);
    }
    if (!v) {
      propsHost.append(h('div', 'an-meta', 'Add a plot from the Analyze tab.'));
      return;
    }
    const s = v.spec;
    const numeric = (c) => c.type !== 'string';
    const typeSel = select(Object.entries(PLOT_TYPES).map(([value, t]) => ({ value, label: t.label })), s.type, (t) => setProp((x) => {
      x.type = t;
      if (AGGED.includes(t) && !x.agg) x.agg = x.y?.[0]?.col ? 'mean' : 'count';
      if (['bar', 'box', 'heatmap', 'histogram', 'pie', 'table'].includes(t)) x.y = (x.y || []).slice(0, 1);
      if (t === 'histogram') x.y = [];
    }));
    propsHost.append(field('Type', typeSel));
    const title = h('input');
    title.value = s.title || '';
    title.placeholder = autoTitle(s);
    title.onchange = () => {
      s.title = title.value.trim() || null;
      v.updateHead();
      v.draw();
    };
    propsHost.append(field('Title', title));
    const xOptional = ['bar', 'box', 'table'].includes(s.type);
    const xFilter = s.type === 'histogram' ? numeric : () => true;
    const xLabel = { bar: 'Category (X)', box: 'Category (X)', pie: 'Slices', table: 'Rows' }[s.type] || 'X axis';
    propsHost.append(droppable(field(xLabel, select(colOptions(xFilter, xOptional ? '(none)' : null), s.x || '', (val) => setProp((x) => { x.x = val || null; }))), (name) => setProp((x) => { x.x = name; })));
    if (s.type === 'scatter' || s.type === 'line') {
      const box = h('div', 'an-series');
      s.y.forEach((ys, i) => {
        const row = h('div', 'an-series-row');
        row.append(select(colOptions(numeric), ys.col, (val) => setProp((x) => { x.y[i].col = val; })));
        const axis = h('button', `btn an-axis${ys.axis === 'right' ? ' on' : ''}`, ys.axis === 'right' ? 'Right' : 'Left');
        axis.title = 'Which Y axis this series uses';
        axis.onclick = () => setProp((x) => { x.y[i].axis = x.y[i].axis === 'right' ? 'left' : 'right'; });
        row.append(axis);
        if (s.y.length > 1) {
          const rm = h('button', 'btn an-x', icon('close', 12));
          rm.title = 'Remove this series';
          rm.onclick = () => setProp((x) => { x.y.splice(i, 1); });
          row.append(rm);
        }
        box.append(row);
      });
      const add = h('button', 'btn an-wide', `${icon('plus', 12)} Add Y series`);
      add.onclick = () => setProp((x) => {
        const used = new Set(x.y.map((y) => y.col));
        const next = st.info.columns.find((c) => numeric(c) && !used.has(c.name) && c.name !== x.x);
        if (next) x.y.push({ col: next.name, axis: x.y.length ? 'right' : 'left' });
      });
      box.append(add);
      propsHost.append(droppable(field('Y axis', box), (name) => setProp((x) => { x.y.push({ col: name }); })));
    } else if (s.type !== 'histogram') {
      const agged = AGGED.includes(s.type);
      const yFilter = agged ? () => true : numeric;
      propsHost.append(droppable(field(agged ? (s.type === 'bar' ? 'Value (Y)' : 'Value') : 'Y axis', select(colOptions(yFilter, agged ? '(row count)' : null), s.y?.[0]?.col || '', (val) => setProp((x) => {
        x.y = val ? [{ col: val }] : [];
        if (AGGED.includes(x.type) && !val) x.agg = 'count';
        if (AGGED.includes(x.type) && val && x.agg === 'count') x.agg = 'mean';
      }))), (name) => setProp((x) => { x.y = [{ col: name }]; })));
    }
    if (AGGED.includes(s.type) && s.y?.[0]?.col) propsHost.append(field('Aggregation', select(AGGS, s.agg || 'sum', (val) => setProp((x) => { x.agg = val; }))));
    if (s.type === 'heatmap') {
      propsHost.append(field('Color by value', select(colOptions(numeric, '(row count)'), s.z || '', (val) => setProp((x) => { x.z = val || null; if (val && !x.agg) x.agg = 'mean'; }))));
      if (s.z) propsHost.append(field('Aggregation', select(AGGS.filter((a) => a.value !== 'median' && a.value !== 'std'), s.agg || 'mean', (val) => setProp((x) => { x.agg = val; }))));
    }
    if (['scatter', 'line', 'bar', 'histogram', 'table'].includes(s.type) && (s.y || []).length <= 1) {
      propsHost.append(droppable(field(s.type === 'table' ? 'Columns' : 'Color by', select(colOptions(() => true, '(none)'), s.color || '', (val) => setProp((x) => { x.color = val || null; }))), (name) => setProp((x) => { x.color = name; })));
    }
    if (s.type === 'box') propsHost.append(check('Color each box', !!s.color, (on) => setProp((x) => { x.color = on ? x.x : null; })));
    if (s.type === 'histogram' || s.type === 'heatmap') {
      const bins = h('input');
      bins.type = 'number';
      bins.min = 2;
      bins.max = 500;
      bins.placeholder = 'Auto';
      bins.value = s.bins || '';
      bins.onchange = () => setProp((x) => { x.bins = Number(bins.value) > 1 ? Math.min(500, Math.round(Number(bins.value))) : null; });
      propsHost.append(field('Bins', bins));
    }
    if (s.type === 'histogram') propsHost.append(field('Show', select([{ value: 'count', label: 'Count' }, { value: 'percent', label: 'Percent' }, { value: 'density', label: 'Density' }], s.normalize || 'count', (val) => setProp((x) => { x.normalize = val; }))));
    if (s.type === 'bar') {
      propsHost.append(field('Order', select([{ value: 'name', label: 'By category' }, { value: 'value', label: 'By value (largest first)' }], s.sort || 'name', (val) => setProp((x) => { x.sort = val; }))));
      if (s.color) propsHost.append(check('Stacked bars', s.stacked, (on) => setProp((x) => { x.stacked = on; })));
    }
    if (s.type === 'scatter' || s.type === 'line' || s.type === 'box') {
      const scale = h('div', 'an-checks');
      if (s.type !== 'box') scale.append(check('Log X', s.logX, (on) => setProp((x) => { x.logX = on; })));
      scale.append(check('Log Y', s.logY, (on) => setProp((x) => { x.logY = on; })));
      if (s.y.some((y) => y.axis === 'right')) scale.append(check('Log Y (right)', s.logY2, (on) => setProp((x) => { x.logY2 = on; })));
      if (s.type === 'line') scale.append(check('Markers', s.markers, (on) => setProp((x) => { x.markers = on; })));
      propsHost.append(field('Scale', scale));
    }
    if (s.type === 'scatter') {
      const size = h('input');
      size.type = 'range';
      size.min = 1;
      size.max = 12;
      size.step = 0.5;
      size.value = s.markerSize || 4;
      size.oninput = () => {
        s.markerSize = Number(size.value);
        v.draw();
      };
      propsHost.append(field('Marker size', size));
    }
    if (s.type === 'scatter' || s.type === 'line') {
      const fits = h('div', 'an-fit-list');
      for (const f of s.fits || []) {
        const row = h('div', 'an-fit-chip', `<span>${escapeHtml(f.result?.label || MODELS[f.model]?.label || f.model)}${f.model === 'poly' ? ` (${f.degree})` : ''}</span>`);
        const x = h('button', '', '×');
        x.title = 'Remove fit';
        x.onclick = () => {
          s.fits = s.fits.filter((g) => g !== f);
          v.draw();
          renderProps();
          renderFits();
        };
        row.append(x);
        fits.append(row);
      }
      const add = h('button', 'btn an-wide', `${icon('fitCurve', 14)} Fit curve…`);
      add.onclick = () => fitMenu(add);
      fits.append(add);
      propsHost.append(field('Curve fit', fits));
    }
  }

  // ---------- calculated columns ----------
  async function calculatedColumn(existing = null) {
    if (!st.info) return toast('Open a data file first');
    const help = h('div', 'an-calc-help');
    help.innerHTML = `<p class="muted">Write a formula over whole columns. Refer to columns as <code>[Column name]</code> or <code>col(A)</code>. Example: <code>[Voltage] * [Current] / 1000</code> or <code>if([Temp] &gt; 30, "hot", "ok")</code>.</p>`;
    const colsBox = h('div', 'an-calc-cols');
    for (const c of st.info.columns) {
      const b = h('button', 'an-chip', `${icon(TYPE_ICON[c.type], 12)} ${escapeHtml(c.name)}`);
      b.type = 'button';
      b.onclick = () => insertAtCursor(`[${c.name}]`);
      colsBox.append(b);
    }
    const fnBox = h('div', 'an-calc-fns');
    for (const f of FUNCTIONS) {
      const b = h('button', 'an-chip an-fn', escapeHtml(f));
      b.type = 'button';
      b.onclick = () => insertAtCursor(`${f.replace(/\(.*$/, '')}(`);
      fnBox.append(b);
    }
    help.append(h('b', '', 'Columns'), colsBox, h('b', '', 'Functions'), fnBox);
    const insertAtCursor = (text) => {
      const ta = help.closest('.modal')?.querySelector('textarea');
      if (!ta) return;
      const a = ta.selectionStart;
      ta.value = ta.value.slice(0, a) + text + ta.value.slice(ta.selectionEnd);
      ta.focus();
      ta.selectionStart = ta.selectionEnd = a + text.length;
    };
    let name = existing?.name || '';
    let expr = existing?.expr || '';
    for (;;) {
      const got = await dialog({
        title: existing ? `Edit ${existing.name}` : 'Calculated column',
        body: help,
        wide: true,
        fields: [{ name: 'name', label: 'Column name', value: name || `Calc ${st.calculated.length + 1}` }, { name: 'expr', label: 'Formula', type: 'textarea', rows: 3, value: expr }],
        ok: existing ? 'Update' : 'Add column',
      });
      if (!got) return undefined;
      name = got.name.trim();
      expr = got.expr.trim();
      try {
        const res = await client.call('addCalculated', name, expr);
        st.calculated = st.calculated.filter((c) => c.name.toLowerCase() !== res.name.toLowerCase() && c.name !== existing?.name);
        st.calculated.push({ name: res.name, expr });
        await afterFilter(res.info);
        renderLeft();
        renderFilters();
        toast(`Added ${res.name}`);
        return res.name;
      } catch (err) {
        toast(err.message, 'error');
      }
    }
  }

  // ---------- filters ----------
  const openFilters = new Set();
  function renderRight() {
    right.innerHTML = '';
    if (!st.info) return;
    filtersHost = h('div', 'an-section an-filters');
    fitsHost = h('div', 'an-section an-fits');
    right.append(filtersHost, fitsHost);
    renderFilters();
    renderFits();
  }
  let filtersHost = null;
  let fitsHost = null;
  let filterSpecs = {};

  async function renderFilters() {
    if (!filtersHost) return;
    const state = await client.call('filterState').catch(() => ({ columns: {}, expressions: [] }));
    filterSpecs = state.columns;
    filtersHost.innerHTML = '';
    const head = h('div', 'an-section-head', `${icon('filter', 15)}<b>Filters</b>`);
    const reset = h('button', 'btn an-small', 'Reset all');
    reset.onclick = async () => {
      openFilters.clear();
      await afterFilter(await client.call('resetFilters'));
      renderFilters();
    };
    head.append(reset);
    filtersHost.append(head);
    filterCount = h('div', 'an-meta');
    filtersHost.append(filterCount);
    renderFilterCounts();
    const exprBox = h('div', 'an-expr');
    const input = h('input');
    input.placeholder = 'Filter formula, e.g. [Temp] > 20 and [Site] == "B"';
    input.value = state.expressions.join(' and ');
    input.spellcheck = false;
    input.onkeydown = async (e) => {
      if (e.key !== 'Enter') return;
      try {
        await afterFilter(await client.call('setExpressionFilters', input.value.trim() ? [input.value.trim()] : []));
        input.classList.remove('bad');
      } catch (err) {
        input.classList.add('bad');
        toast(err.message, 'error');
      }
    };
    exprBox.append(input);
    filtersHost.append(exprBox);
    if (state.rowset) {
      const note = h('div', 'an-rowset', `${icon('markFilter', 14)} Showing only rows kept from marking`);
      const undo = h('button', 'btn an-small', 'Show all');
      undo.onclick = async () => {
        await afterFilter(await client.call('setRowset', null));
        renderFilters();
      };
      note.append(undo);
      filtersHost.append(note);
    }
    const search = h('input', 'an-filter-search');
    search.placeholder = 'Find a column…';
    filtersHost.append(search);
    const list = h('div', 'an-filter-list');
    for (const c of st.info.columns) {
      const d = h('details', 'an-filter');
      d.dataset.col = c.name;
      if (filterSpecs[c.name]) d.classList.add('on');
      const sum = h('summary', '', `${icon(c.expr ? 'colCalc' : TYPE_ICON[c.type], 13)}<span>${escapeHtml(c.name)}</span>`);
      sum.oncontextmenu = (e) => {
        e.preventDefault();
        filterContextMenu(c.name, e.clientX, e.clientY);
      };
      d.append(sum);
      d.ontoggle = () => {
        if (d.open) {
          openFilters.add(c.name);
          fillFilter(d, c);
        } else openFilters.delete(c.name);
      };
      if (openFilters.has(c.name)) d.open = true;
      list.append(d);
    }
    search.oninput = () => {
      const q = search.value.toLowerCase();
      for (const d of list.children) d.hidden = q && !d.dataset.col.toLowerCase().includes(q);
    };
    filtersHost.append(list);
  }
  let filterCount = null;

  function renderFilterCounts() {
    if (!filterCount || !st.info) return;
    const i = st.info;
    filterCount.textContent = i.filtered === i.rows ? `All ${fmtInt(i.rows)} rows shown` : `${fmtInt(i.filtered)} of ${fmtInt(i.rows)} rows (${((i.filtered / Math.max(1, i.rows)) * 100).toFixed(i.filtered / i.rows < 0.01 ? 2 : 1)}%)`;
    for (const d of filtersHost?.querySelectorAll('details.an-filter[open]') || []) {
      const c = st.info.columns.find((x) => x.name === d.dataset.col);
      if (c && !d.dataset.busy) fillFilter(d, c, true);
    }
  }

  function openFilter(name) {
    st.panels.right = true;
    applyPanels();
    const d = filtersHost?.querySelector(`details[data-col="${CSS.escape(name)}"]`);
    if (d) {
      d.open = true;
      d.scrollIntoView({ block: 'nearest' });
    }
  }

  async function setFilter(name, spec) {
    if (spec) filterSpecs[name] = spec;
    else delete filterSpecs[name];
    filtersHost?.querySelector(`details[data-col="${CSS.escape(name)}"]`)?.classList.toggle('on', !!spec);
    try {
      await afterFilter(await client.call('setFilter', name, spec));
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  async function fillFilter(d, c, countsOnly = false) {
    d.dataset.busy = '1';
    const prof = await client.call('profile', c.name).catch(() => null);
    delete d.dataset.busy;
    if (!prof) return;
    let body = d.querySelector('.an-filter-body');
    if (countsOnly && body) {
      if (prof.type === 'string') {
        for (const row of body.querySelectorAll('[data-v]')) {
          const v = prof.values.find((x) => x.value === row.dataset.v);
          row.querySelector('em').textContent = v ? fmtInt(v.shown) : '0';
          row.classList.toggle('dim', !v?.shown);
        }
      } else drawHist(body.querySelector('.an-hist'), prof);
      return;
    }
    body?.remove();
    body = h('div', 'an-filter-body');
    d.append(body);
    if (prof.type === 'string') return stringFilter(body, c, prof);
    return rangeFilter(body, c, prof);
  }

  function drawHist(el, prof) {
    if (!el) return;
    const max = Math.max(1, ...prof.hist);
    el.innerHTML = prof.hist.map((v, i) => `<i style="height:${(v / max) * 100}%"><b style="height:${v ? (prof.shown[i] / v) * 100 : 0}%"></b></i>`).join('');
  }

  function rangeFilter(body, c, prof) {
    if (prof.min == null) {
      body.append(h('div', 'an-meta', 'No values in this column.'));
      return;
    }
    const spec = filterSpecs[c.name] || {};
    const hist = h('div', 'an-hist');
    drawHist(hist, prof);
    const slider = h('div', 'an-range', '<div class="an-range-fill"></div><span class="an-thumb" data-k="lo"></span><span class="an-thumb" data-k="hi"></span>');
    const isDate = c.type === 'date';
    const toText = (v) => (isDate ? formatValue(v, 'date') : formatValue(v, 'number'));
    const fromText = (t) => {
      if (!t.trim()) return null;
      if (isDate) {
        const ms = Date.parse(t.includes('T') || t.length <= 10 ? t : t.replace(' ', 'T'));
        return Number.isNaN(ms) ? null : ms;
      }
      const n = Number(t);
      return Number.isNaN(n) ? null : n;
    };
    let lo = spec.min ?? prof.min;
    let hi = spec.max ?? prof.max;
    const span = prof.max - prof.min || 1;
    const inputs = h('div', 'an-range-inputs');
    const a = h('input');
    const b = h('input');
    inputs.append(a, h('span', '', 'to'), b);
    const missing = check(`Include empty values (${fmtInt(prof.missing)})`, spec.missing !== false, () => commit());
    const sync = () => {
      const pa = ((lo - prof.min) / span) * 100;
      const pb = ((hi - prof.min) / span) * 100;
      slider.querySelector('[data-k="lo"]').style.left = `${pa}%`;
      slider.querySelector('[data-k="hi"]').style.left = `${pb}%`;
      Object.assign(slider.querySelector('.an-range-fill').style, { left: `${pa}%`, width: `${pb - pa}%` });
      if (document.activeElement !== a) a.value = toText(lo);
      if (document.activeElement !== b) b.value = toText(hi);
    };
    let timer = 0;
    const commit = (delay = 0) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const full = lo <= prof.min && hi >= prof.max;
        const keepMissing = missing.querySelector('input').checked;
        setFilter(c.name, full && keepMissing ? null : { kind: 'range', min: full ? null : lo, max: full ? null : hi, missing: keepMissing });
      }, delay);
    };
    slider.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const r = slider.getBoundingClientRect();
      const valueAt = (x) => prof.min + Math.max(0, Math.min(1, (x - r.left) / r.width)) * span;
      const v0 = valueAt(e.clientX);
      const which = e.target.dataset.k || (Math.abs(v0 - lo) < Math.abs(v0 - hi) ? 'lo' : 'hi');
      const move = (ev) => {
        const v = valueAt(ev.clientX);
        if (which === 'lo') lo = Math.min(v, hi);
        else hi = Math.max(v, lo);
        sync();
        commit(120);
      };
      move(e);
      const up = () => {
        window.removeEventListener('mousemove', move);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', move);
      window.addEventListener('mouseup', up);
    });
    for (const [inp, k] of [[a, 'lo'], [b, 'hi']]) {
      inp.onchange = () => {
        const v = fromText(inp.value);
        if (v == null) return sync();
        if (k === 'lo') lo = Math.min(v, hi);
        else hi = Math.max(v, lo);
        sync();
        commit();
        return undefined;
      };
    }
    const reset = h('button', 'btn an-small', 'Reset');
    reset.onclick = () => {
      lo = prof.min;
      hi = prof.max;
      missing.querySelector('input').checked = true;
      sync();
      commit();
    };
    body.append(hist, slider, inputs);
    if (prof.missing) body.append(missing);
    body.append(reset);
    sync();
  }

  function stringFilter(body, c, prof) {
    const spec = filterSpecs[c.name];
    if (prof.distinct > 2000) {
      const t = h('input');
      t.placeholder = `Contains… (${fmtInt(prof.distinct)} values)`;
      t.value = spec?.kind === 'text' ? spec.text : '';
      t.onchange = () => setFilter(c.name, t.value.trim() ? { kind: 'text', text: t.value.trim() } : null);
      body.append(t);
      return;
    }
    const all = prof.values.map((v) => v.value);
    if (prof.missing) all.push('');
    let chosen = new Set(spec?.kind === 'values' ? (spec.exclude ? all.filter((v) => !spec.values.includes(v)) : spec.values) : all);
    const tools = h('div', 'an-filter-tools');
    const find = h('input');
    find.placeholder = 'Search values…';
    const allBtn = h('button', 'btn an-small', 'All');
    const noneBtn = h('button', 'btn an-small', 'None');
    tools.append(find, allBtn, noneBtn);
    const list = h('div', 'an-values');
    const commit = () => {
      if (chosen.size === all.length) setFilter(c.name, null);
      else if (chosen.size > all.length / 2) setFilter(c.name, { kind: 'values', values: all.filter((v) => !chosen.has(v)), exclude: true });
      else setFilter(c.name, { kind: 'values', values: [...chosen] });
    };
    const rows = [...prof.values.map((v) => ({ value: v.value, label: v.value, shown: v.shown })), ...(prof.missing ? [{ value: '', label: '(Empty)', shown: null }] : [])];
    for (const v of rows) {
      const row = h('label', `an-value${v.shown === 0 ? ' dim' : ''}`);
      row.dataset.v = v.value;
      const box = h('input');
      box.type = 'checkbox';
      box.checked = chosen.has(v.value);
      box.onchange = () => {
        if (box.checked) chosen.add(v.value);
        else chosen.delete(v.value);
        commit();
      };
      row.append(box, h('span', '', escapeHtml(v.label)), h('em', '', v.shown == null ? '' : fmtInt(v.shown)));
      list.append(row);
    }
    find.oninput = () => {
      const q = find.value.toLowerCase();
      for (const r of list.children) r.hidden = q && !r.dataset.v.toLowerCase().includes(q);
    };
    allBtn.onclick = () => {
      chosen = new Set(all);
      list.querySelectorAll('input').forEach((i) => { i.checked = true; });
      commit();
    };
    noneBtn.onclick = () => {
      chosen = new Set();
      list.querySelectorAll('input').forEach((i) => { i.checked = false; });
      commit();
    };
    body.append(tools, list);
  }

  // ---------- curve fitting ----------
  function fitMenu(anchor) {
    const v = st.active;
    if (!v || !['scatter', 'line'].includes(v.spec.type)) return toast('Curve fits go on a scatter or line plot. Select one first.');
    const m = h('div', 'rb-menu');
    for (const [id, model] of Object.entries(MODELS)) {
      const b = h('button', 'rb-menu-item', `${icon('fitCurve', 16)}<span>${escapeHtml(model.label)}${id === 'poly' || id === 'custom' ? '…' : ''}<small>${escapeHtml(model.equation)}</small></span>`);
      b.onclick = () => {
        closePopup();
        addFit(id);
      };
      m.append(b);
    }
    popup(anchor, m);
    return undefined;
  }

  async function addFit(model, extra = {}) {
    const v = st.active;
    if (!v || !['scatter', 'line'].includes(v.spec.type)) return toast('Curve fits go on a scatter or line plot. Select one first.');
    const f = { model, series: 0, ...extra };
    if (v.spec.y.length > 1 && extra.series == null) {
      const got = await dialog({ title: 'Fit which series?', fields: [{ name: 's', label: 'Series', type: 'select', options: v.spec.y.map((y, i) => ({ value: String(i), label: y.col })) }] });
      if (!got) return undefined;
      f.series = Number(got.s);
    }
    if (model === 'poly' && extra.degree == null) {
      const got = await dialog({ title: 'Polynomial fit', fields: [{ name: 'degree', label: 'Degree (2–9)', type: 'number', min: 2, max: 9, value: 2 }] });
      if (!got) return undefined;
      f.degree = Math.max(2, Math.min(9, Number(got.degree) || 2));
    }
    if (model === 'custom' && !extra.equation) {
      const got = await dialog({
        title: 'Custom fit equation',
        body: '<p class="muted">Use <code>x</code> for X and any other names as parameters, for example <code>y = A*exp(-x/t) + y0</code>. Starting values help with harder models.</p>',
        fields: [{ name: 'eq', label: 'Equation', value: 'y = a*exp(-b*x) + c' }, { name: 'init', label: 'Starting values (optional)', placeholder: 'a=1, b=0.5, c=0' }],
        wide: true,
      });
      if (!got?.eq?.trim()) return undefined;
      f.equation = got.eq.trim();
      f.initial = Object.fromEntries(String(got.init || '').split(/[,;]/).map((p) => p.split('=').map((x) => x.trim())).filter(([k, val]) => k && val !== undefined && !Number.isNaN(Number(val))).map(([k, val]) => [k, Number(val)]));
    }
    if (st.info.marked && extra.markedOnly == null) f.markedOnly = !!(await dialog({ title: 'Fit marked rows only?', body: `${fmtInt(st.info.marked)} rows are marked. Fit only those, or every row that passes the filters?`, ok: 'Marked rows', cancel: 'All filtered rows' }));
    try {
      toast('Fitting…');
      f.result = await client.call('fit', v.spec, f);
      v.spec.fits = [...(v.spec.fits || []), f];
      v.draw();
      renderProps();
      renderFits();
      st.panels.right = true;
      applyPanels();
      return f.result;
    } catch (err) {
      toast(err.message, 'error');
      return undefined;
    }
  }

  async function refitAll() {
    for (const v of st.plots) {
      for (const f of v.spec.fits || []) {
        try {
          f.result = await client.call('fit', v.spec, f);
        } catch {
          f.result = null;
        }
      }
      if (v.spec.fits?.length) v.draw();
    }
    renderFits();
  }

  function renderFits() {
    if (!fitsHost) return;
    fitsHost.innerHTML = '';
    const fits = (st.active?.spec.fits || []).filter((f) => f.result);
    fitsHost.hidden = !fits.length;
    if (!fits.length) return;
    const head = h('div', 'an-section-head', `${icon('fitCurve', 15)}<b>Fit results</b>`);
    const refit = h('button', 'btn an-small', 'Refit');
    refit.title = 'Fit again to the rows that pass the filters now';
    refit.onclick = () => refitAll();
    head.append(refit);
    fitsHost.append(head);
    const f6 = (x) => (Number.isFinite(x) ? String(Number(x.toPrecision(6))) : '—');
    const fp = (p) => (!Number.isFinite(p) ? '—' : p < 1e-4 ? '< 0.0001' : p.toFixed(4));
    for (const f of fits) {
      const r = f.result;
      const box = h('div', 'an-fit');
      box.innerHTML = `
        <div class="an-fit-title">${escapeHtml(r.label || (r.model === 'linear' ? 'Linear' : `Polynomial, degree ${r.degree}`))}<small>${escapeHtml(r.yName)} vs ${escapeHtml(r.xName)}${r.markedOnly ? ', marked rows' : ''}${r.sampled ? ', sampled' : ''}</small></div>
        <div class="an-fit-eq">${escapeHtml(r.custom ? `y = ${r.custom.replace(/^\s*y\s*=\s*/i, '')}` : r.equation)}</div>
        <table class="an-fit-table"><thead><tr><th>Parameter</th><th>Value</th><th>Std. error</th><th>t</th><th>p</th><th>95% CI</th></tr></thead><tbody>
        ${r.params.map((p) => `<tr><td>${escapeHtml(p.name)}</td><td>${f6(p.value)}</td><td>${f6(p.se)}</td><td>${f6(p.t)}</td><td>${fp(p.p)}</td><td>${f6(p.lo)} … ${f6(p.hi)}</td></tr>`).join('')}
        </tbody></table>
        <table class="an-fit-stats"><tbody>
          <tr><td>Points (N)</td><td>${fmtInt(r.n)}</td><td>Deg. of freedom</td><td>${fmtInt(r.dof)}</td></tr>
          <tr><td>R²</td><td>${f6(r.r2)}</td><td>Adjusted R²</td><td>${f6(r.adjR2)}</td></tr>
          <tr><td>RMSE</td><td>${f6(r.rmse)}</td><td>Reduced χ²</td><td>${f6(r.redChi2)}</td></tr>
          ${r.f != null ? `<tr><td>F</td><td>${f6(r.f)}</td><td>Prob &gt; F</td><td>${fp(r.fP)}</td></tr>` : ''}
          ${r.pearson != null ? `<tr><td>Pearson r</td><td>${f6(r.pearson)}</td><td></td><td></td></tr>` : ''}
          ${r.iterations != null ? `<tr><td>Iterations</td><td>${r.iterations}</td><td>Converged</td><td>${r.converged ? 'Yes' : 'No'}</td></tr>` : ''}
        </tbody></table>`;
      const actions = h('div', 'an-fit-actions');
      const btn = (label, run) => {
        const b = h('button', 'btn an-small', label);
        b.onclick = run;
        actions.append(b);
      };
      btn('Copy', () => {
        const lines = [`${r.label || r.model}: ${r.yName} vs ${r.xName}`, r.custom || r.equation, ...r.params.map((p) => `${p.name}\t${p.value}\t± ${p.se}\tt=${p.t}\tp=${p.p}`), `N\t${r.n}`, `R²\t${r.r2}`, `Adj. R²\t${r.adjR2}`, `RMSE\t${r.rmse}`];
        navigator.clipboard.writeText(lines.join('\n'));
        toast('Fit report copied');
      });
      btn('Add fitted column', () => addFitColumns(r, false));
      btn('Add residuals', () => addFitColumns(r, true));
      btn('Remove', () => {
        st.active.spec.fits = st.active.spec.fits.filter((g) => g !== f);
        st.active.draw();
        renderProps();
        renderFits();
      });
      box.append(actions);
      fitsHost.append(box);
    }
  }

  async function addFitColumns(r, residuals) {
    const body = fitExpression(r, `[${r.xName}]`);
    const expr = residuals ? `[${r.yName}] - (${body})` : body;
    const name = `${residuals ? 'Residual' : 'Fit'} ${r.yName}`;
    try {
      const res = await client.call('addCalculated', name, expr);
      st.calculated = st.calculated.filter((c) => c.name !== res.name);
      st.calculated.push({ name: res.name, expr });
      await afterFilter(res.info);
      renderLeft();
      renderFilters();
      toast(`Added column ${res.name}`);
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  // ---------- data table ----------
  const tableHead = h('div', 'an-table-head');
  const tableGrid = h('div', 'an-grid');
  const tableScroll = h('div', 'an-grid-scroll');
  const tableSpacer = h('div', 'an-grid-spacer');
  const tableRows = h('div', 'an-grid-rows');
  const tableViewport = h('div', 'an-grid-view');
  tableViewport.append(tableRows);
  tableScroll.append(tableSpacer);
  tableGrid.append(tableViewport, tableScroll);
  const resizer = h('div', 'an-table-resize');
  tableWrap.append(resizer, tableHead, tableGrid);
  let tableTop = 0;
  let tableTotal = 0;
  let tableToken = 0;
  let colWidths = [];
  const MAX_SCROLL = 8_000_000;

  resizer.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const y0 = e.clientY;
    const h0 = st.table.height;
    const move = (ev) => {
      st.table.height = Math.max(90, Math.min(window.innerHeight * 0.7, h0 - (ev.clientY - y0)));
      tableWrap.style.height = `${st.table.height}px`;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      tableRender();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });

  function renderTableHead() {
    tableHead.innerHTML = '';
    if (!st.info) return;
    const title = h('b', '', `${icon('details', 14)} Details`);
    const src = select([{ value: 'auto', label: 'Marked rows, or all when none are marked' }, { value: 'marked', label: 'Marked rows' }, { value: 'filtered', label: 'Rows that pass the filters' }], st.table.source, (v) => {
      st.table.source = v;
      tableReset();
    });
    const exp = h('button', 'btn an-small', `${icon('export', 12)} Export…`);
    exp.onclick = () => exportMenu(exp);
    const close = h('button', 'btn an-small an-x', icon('close', 12));
    close.title = 'Hide the rows';
    close.onclick = () => togglePanel('table');
    tableHead.append(title, src, h('span', 'an-table-count'), h('span', 'an-spacer'), exp, close);
  }

  const tableSource = () => (st.table.source === 'auto' ? (st.info?.marked ? 'marked' : 'filtered') : st.table.source);

  function tableReset() {
    tableTop = 0;
    tableScroll.scrollTop = 0;
    tableRender();
  }

  const visibleRows = () => Math.max(1, Math.floor((tableGrid.clientHeight - ROW_H) / ROW_H));

  async function tableRender() {
    if (!st.info || !st.table.open) return;
    const token = ++tableToken;
    const count = visibleRows() + 1;
    const source = tableSource();
    const res = await client.call('rows', tableTop, count, source).catch(() => null);
    if (!res || token !== tableToken) return;
    tableTotal = res.total;
    tableHead.querySelector('.an-table-count').textContent = `${fmtInt(res.total)} ${source === 'marked' ? 'marked ' : ''}rows`;
    const scrollH = Math.min(MAX_SCROLL, res.total * ROW_H + ROW_H);
    tableSpacer.style.height = `${scrollH}px`;
    if (colWidths.length !== res.columns.length) colWidths = res.columns.map((c, j) => Math.max(70, Math.min(260, Math.max(c.length, ...res.rows.map((r) => String(r[j] ?? '').length)) * 7 + 22)));
    const tpl = `64px ${colWidths.map((w) => `${w}px`).join(' ')}`;
    let html = `<div class="an-row an-hrow" style="grid-template-columns:${tpl}"><span>#</span>${res.columns.map((c) => `<span title="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('')}</div>`;
    res.rows.forEach((r, k) => {
      html += `<div class="an-row${res.marked[k] ? ' marked' : ''}" data-id="${res.ids[k]}" style="grid-template-columns:${tpl}"><span class="n">${fmtInt(res.ids[k] + 1)}</span>${r.map((v) => `<span>${escapeHtml(v)}</span>`).join('')}</div>`;
    });
    if (!res.total) html += `<div class="an-table-empty">${source === 'marked' ? 'No rows are marked. Drag across a plot to mark rows.' : 'No rows pass the filters.'}</div>`;
    tableRows.innerHTML = html;
    tableRows.style.width = `${64 + colWidths.reduce((a, b) => a + b, 0)}px`;
  }

  tableScroll.addEventListener('scroll', () => {
    const max = tableScroll.scrollHeight - tableScroll.clientHeight;
    const rowsMax = Math.max(0, tableTotal - visibleRows());
    tableTop = max > 0 ? Math.round((tableScroll.scrollTop / max) * rowsMax) : 0;
    tableRender();
  });
  tableGrid.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      tableViewport.scrollLeft += e.deltaX;
      return;
    }
    e.preventDefault();
    const rowsMax = Math.max(0, tableTotal - visibleRows());
    tableTop = Math.max(0, Math.min(rowsMax, tableTop + Math.round(e.deltaY / ROW_H) * (e.deltaMode === 1 ? 3 : 1)));
    const max = tableScroll.scrollHeight - tableScroll.clientHeight;
    tableScroll.scrollTop = rowsMax ? (tableTop / rowsMax) * max : 0;
    tableRender();
  }, { passive: false });
  tableRows.addEventListener('click', async (e) => {
    const row = e.target.closest('.an-row[data-id]');
    if (!row) return;
    st.info = await client.call('markRows', [Number(row.dataset.id)], e.ctrlKey || e.metaKey ? 'toggle' : 'replace');
    afterMark();
  });

  // ---------- export ----------
  function exportMenu(anchor) {
    const m = h('div', 'rb-menu');
    const item = (label, ic, run) => {
      const b = h('button', 'rb-menu-item', `${icon(ic, 16)}<span>${label}</span>`);
      b.onclick = () => {
        closePopup();
        run();
      };
      m.append(b);
    };
    item('Filtered rows as CSV…', 'grid', () => exportCsv('filtered'));
    item('Marked rows as CSV…', 'mark', () => exportCsv('marked'));
    if (sendToSheet) {
      item('Marked rows to a new sheet', 'table', () => toSheet('marked'));
      item('Filtered rows to a new sheet', 'table', () => toSheet('filtered'));
    }
    popup(anchor, m);
  }

  async function exportCsv(source) {
    if (!st.info) return;
    const count = source === 'marked' ? st.info.marked : st.info.filtered;
    if (!count) return toast(source === 'marked' ? 'No rows are marked' : 'No rows pass the filters');
    const base = st.info.name.replace(/\.[^.]+(\s*\(.*\))?$/, '');
    const w = await window.office.data.beginWrite({ name: `${base}-${source}.csv`, filters: [{ name: 'CSV', extensions: ['csv'] }] });
    if (!w || w.error) return w?.error && toast(w.error, 'error');
    let start = 0;
    try {
      setLoading(`Exporting ${fmtInt(count)} rows…`, 0);
      await window.office.data.write(w.writer, '﻿');
      for (;;) {
        const chunk = await client.call('csv', source, start, 50000);
        await window.office.data.write(w.writer, chunk.text);
        start = chunk.next;
        setLoading(`Exporting ${fmtInt(count)} rows…`, start / Math.max(1, chunk.total));
        if (start >= chunk.total) break;
      }
      await window.office.data.endWrite(w.writer);
      toast(`Exported ${fmtInt(start)} rows to ${w.name}`);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoading(null);
    }
    return undefined;
  }

  async function toSheet(source) {
    const limit = 10000;
    const res = await client.call('rows', 0, limit, source);
    if (!res.total) return toast(source === 'marked' ? 'No rows are marked' : 'No rows pass the filters');
    sendToSheet([res.columns, ...res.rows], `${source === 'marked' ? 'Marked' : 'Filtered'} rows`);
    if (res.total > limit) toast(`Sent the first ${fmtInt(limit)} of ${fmtInt(res.total)} rows. Export as CSV to get all of them.`);
    return undefined;
  }

  async function exportPlot(kind) {
    const v = st.active;
    if (!v) return toast('Select a plot first');
    const name = (v.spec.title || autoTitle(v.spec)).replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'plot';
    let res;
    if (kind === 'png') {
      const blob = await v.toPng(3);
      res = await window.office.data.saveBytes({ name: `${name}.png`, filters: [{ name: 'PNG image', extensions: ['png'] }], data: new Uint8Array(await blob.arrayBuffer()) });
    } else if (kind === 'svg') {
      res = await window.office.data.saveBytes({ name: `${name}.svg`, filters: [{ name: 'SVG image', extensions: ['svg'] }], data: v.toSvg() });
    } else {
      const { w, h: ht } = v.size();
      res = await window.office.data.savePdf({ svg: v.toSvg(w, ht), width: w, height: ht, name: `${name}.pdf` });
    }
    if (res?.error) toast(res.error, 'error');
    else if (res) toast(`Saved ${res.name}`);
    return undefined;
  }

  // ---------- project ----------
  function projectState() {
    return {
      app: 'Plot analysis',
      version: 2,
      source: st.source?.kind === 'file' ? { path: st.source.path, name: st.source.name, ext: st.source.ext, sheet: st.source.sheet } : st.source ? { rows: st.source.rows, name: st.source.name } : null,
      steps: st.steps.map((x) => ({ kind: x.kind, name: x.name, opts: x.opts, source: { path: x.source.path, name: x.source.name, ext: x.source.ext, sheet: x.source.sheet } })),
      calculated: st.calculated,
      pages: st.pages.map((pg) => ({ title: pg.title, plots: pg.plots.map((v) => v.spec) })),
      page: st.page,
      table: { open: st.table.open, source: st.table.source, height: st.table.height },
    };
  }

  async function saveProject(saveAs = false) {
    if (!st.info) return false;
    const state = projectState();
    state.filters = await client.call('filterState');
    const base = st.info.name.replace(/\.[^.]+(\s*\(.*\))?$/, '');
    const res = await window.office.data.saveProject({ name: `${base}.workplot`, path: saveAs ? null : st.projectPath, data: JSON.stringify(state, null, 1) });
    if (res?.error) {
      toast(res.error, 'error');
      return false;
    }
    if (!res) return false;
    st.projectPath = res.path;
    toast(`Saved ${res.name}`);
    return true;
  }

  async function restoreProject({ project, projectPath, handle, stepHandles = [] }) {
    st.projectPath = projectPath;
    project = { ...project, stepHandles };
    if (project.source?.rows) {
      const info = await client.call('fromRows', project.source.rows, project.source.name || 'Sheet');
      st.source = { kind: 'sheet', name: project.source.name, rows: project.source.rows };
      await afterLoad(info, project);
      return;
    }
    if (!handle) {
      toast(`Can't find the data file ${project.source?.path || ''}. Open it again with Open Data.`, 'error');
      return;
    }
    await loadSource(handle, { sheet: project.source?.sheet ?? null, restore: project });
    await refitAll();
  }

  // ---------- tool rail ----------
  const VIZ_MENU = [
    ['scatter', 'chartScatter', 'Scatter'], ['line', 'chartLine', 'Line'], ['bar', 'chartBar', 'Bar'],
    ['histogram', 'chartHist', 'Histogram'], ['box', 'chartBox', 'Box plot'], ['heatmap', 'chartHeat', 'Heat map'],
    ['pie', 'chartPie', 'Pie'], ['table', 'chartTable', 'Cross table'], ['multi', 'chartMulti', 'Two-axis line'],
  ];

  function vizMenu(anchor) {
    const m = h('div', 'rb-menu an-viz-menu');
    m.append(h('div', 'an-viz-menu-head', 'Add a visualization'));
    const grid = h('div', 'an-viz-grid');
    for (const [type, ic, label] of VIZ_MENU) {
      const b = h('button', 'an-viz-pick', `${icon(ic, 26)}<span>${label}</span>`);
      b.onclick = () => {
        closePopup();
        addPlot(newSpec(type));
      };
      grid.append(b);
    }
    m.append(grid);
    popup(anchor, m);
  }

  function dataMenu(anchor) {
    const m = h('div', 'rb-menu');
    const item = (label, ic, run, enabled = true, note = '') => {
      const b = h('button', 'rb-menu-item', `${icon(ic, 16)}<span>${label}${note ? `<small>${note}</small>` : ''}</span>`);
      b.disabled = !enabled;
      b.onclick = () => {
        closePopup();
        run();
      };
      m.append(b);
    };
    item('Open data file…', 'database', () => openData());
    item('Use this sheet’s data', 'table', () => useSheet());
    item('Add rows…', 'addRows', () => addData('rows'), !!st.info, 'Stack another file under this data');
    item('Add columns…', 'addColumns', () => addData('columns'), !!st.info, 'Join another file on matching keys');
    item('Data tables…', 'dataTables', () => dataTables(), !!st.info, 'Sources and the steps applied to them');
    popup(anchor, m);
  }

  function renderRail() {
    rail.innerHTML = '';
    const btn = (ic, tip, run, on = null) => {
      const b = h('button', `an-rail-btn${on?.() ? ' on' : ''}`, icon(ic, 20));
      b.title = tip;
      b.onclick = () => run(b);
      rail.append(b);
      return b;
    };
    btn('database', 'Files and data', (b) => dataMenu(b));
    btn('vizTypes', 'Add a visualization', (b) => vizMenu(b));
    rail.append(h('span', 'an-rail-sep'));
    btn('panelLeft', 'Data panel', () => togglePanel('left'), () => st.panels.left);
    btn('filter', 'Filters', () => togglePanel('right'), () => st.panels.right);
    btn('details', 'Details table', () => togglePanel('table'), () => st.table.open);
    rail.append(h('span', 'an-rail-sep'));
    btn('fitCurve', 'Fit a curve to the selected plot', (b) => fitMenu(b));
    btn('sparkle', 'Ask Claude to build plots and filters', () => shell.claude?.runQuick(aiQuick));
    rail.append(h('span', 'an-spacer'));
    btn('save', 'Save the analysis', () => saveProject());
  }

  // ---------- combining data ----------
  async function pickSide() {
    const picked = await window.office.data.openDialog();
    if (picked?.error) {
      toast(picked.error, 'error');
      return null;
    }
    if (!picked) return null;
    return readSide(picked);
  }

  async function readSide(src, sheet = null) {
    let opts = { ext: src.ext };
    if ((src.ext === 'xlsx' || src.ext === 'xlsm') && sheet == null) {
      const sheets = await client.call('sheets', { handle: src.handle, size: src.size, name: src.name });
      if (sheets.length > 1) {
        const pick = await dialog({ title: 'Choose a sheet', fields: [{ name: 'sheet', label: 'Sheet', type: 'select', options: sheets.map((x, i) => ({ value: String(i), label: x.name })) }], ok: 'Open' });
        if (!pick) return null;
        sheet = Number(pick.sheet);
      }
    }
    if (sheet != null) opts = { ...opts, sheet };
    setLoading(`Reading ${src.name}…`, 0);
    try {
      const side = await client.callWith({ onProgress: (p) => setLoading(`Reading ${src.name}…`, p.fraction, p.rows) }, 'loadSide', { handle: src.handle, size: src.size, name: src.name }, opts);
      return { side, source: { handle: src, path: src.path, name: src.name, ext: src.ext, sheet: opts.sheet ?? null } };
    } finally {
      setLoading(null);
    }
  }

  const ownColumns = () => st.info.columns.filter((c) => !c.expr);

  function rowsDialogBody(side) {
    const body = h('div', 'an-combine');
    body.append(h('p', 'muted', `${escapeHtml(side.name)} has ${fmtInt(side.rows)} rows. Match each of its columns to a column here; unmatched columns become new columns.`));
    const table = h('div', 'an-map');
    table.append(h('div', 'an-map-row an-map-head', '<span>Column in the new file</span><span>Goes into</span>'));
    const options = [{ value: '\u0000new', label: '(new column)' }, { value: '\u0000skip', label: '(leave out)' }, ...ownColumns().map((c) => ({ value: c.name, label: c.name }))];
    const selects = side.match.map((m) => {
      const col = side.columns.find((c) => c.name === m.from);
      const row = h('div', 'an-map-row', `<span>${icon(TYPE_ICON[col.type], 13)} ${escapeHtml(m.from)}</span>`);
      const sel = select(options, m.to ?? '\u0000new', () => {});
      row.append(sel);
      table.append(row);
      return { from: m.from, sel };
    });
    body.append(table);
    const src = h('div', 'an-combine-source');
    const on = h('input');
    on.type = 'checkbox';
    on.checked = true;
    const name = h('input');
    name.value = 'Source';
    const a = h('input');
    a.value = st.steps.length ? 'Original data' : st.info.name;
    const b = h('input');
    b.value = side.name;
    const label = h('label', 'an-check');
    label.append(on, document.createTextNode(' Add a column that tells which file each row came from'));
    src.append(label, field('Column name', name), field('Label for the rows already here', a), field('Label for the new rows', b));
    body.append(src);
    body.read = () => ({
      mapping: selects.map(({ from, sel }) => ({ from, to: sel.value === '\u0000new' ? null : sel.value === '\u0000skip' ? '' : sel.value })),
      source: on.checked ? { name: name.value.trim() || 'Source', base: a.value || 'Original', add: b.value || side.name } : null,
    });
    return body;
  }

  function columnsDialogBody(side) {
    const body = h('div', 'an-combine');
    body.append(h('p', 'muted', `${escapeHtml(side.name)} has ${fmtInt(side.rows)} rows. Rows are matched where the key columns have equal values.`));
    const keysBox = h('div', 'an-keys');
    const mine = ownColumns();
    const keyRow = (k = {}) => {
      const row = h('div', 'an-key-row');
      const guess = k.base || mine.find((c) => side.columns.some((x) => x.name.toLowerCase() === c.name.toLowerCase()))?.name || mine[0]?.name;
      const a = select(mine.map((c) => ({ value: c.name, label: c.name })), guess, () => {});
      const otherGuess = k.add || side.columns.find((x) => x.name.toLowerCase() === String(guess).toLowerCase())?.name || side.columns[0].name;
      const b = select(side.columns.map((c) => ({ value: c.name, label: c.name })), otherGuess, () => {});
      const rm = h('button', 'btn an-x', icon('close', 12));
      rm.type = 'button';
      rm.title = 'Remove this key';
      rm.onclick = () => {
        if (keysBox.querySelectorAll('.an-key-row').length > 1) row.remove();
      };
      row.append(a, h('span', 'an-key-eq', '='), b, rm);
      row.read = () => ({ base: a.value, add: b.value });
      keysBox.append(row);
    };
    keysBox.append(h('div', 'an-map-row an-map-head', '<span>Column here</span><span>Column in the new file</span>'));
    keyRow();
    const more = h('button', 'btn an-small', `${icon('plus', 12)} Add key column`);
    more.type = 'button';
    more.onclick = () => {
      keyRow();
      keysBox.append(more);
    };
    keysBox.append(more);
    body.append(h('b', '', 'Match rows on'), keysBox);
    const how = select(Object.entries(side.joins).map(([value, label]) => ({ value, label })), 'left', () => {});
    body.append(field('Join', how));
    const list = h('div', 'an-values an-bring');
    const checks = side.columns.map((c) => {
      const l = h('label', 'an-value an-bring-col');
      const box = h('input');
      box.type = 'checkbox';
      box.checked = true;
      l.append(box, h('span', '', `${icon(TYPE_ICON[c.type], 12)} ${escapeHtml(c.name)}`));
      list.append(l);
      return { name: c.name, box };
    });
    body.append(h('b', '', 'Columns to add'), list);
    const syncKeys = () => {
      const used = new Set([...keysBox.querySelectorAll('.an-key-row')].map((r) => r.read().add));
      for (const c of checks) c.box.closest('label').hidden = used.has(c.name);
    };
    keysBox.addEventListener('change', syncKeys);
    keysBox.addEventListener('click', () => setTimeout(syncKeys, 0));
    syncKeys();
    body.read = () => {
      const keys = [...keysBox.querySelectorAll('.an-key-row')].map((r) => r.read());
      return { keys, how: how.value, include: checks.filter((c) => c.box.checked).map((c) => c.name) };
    };
    return body;
  }

  async function addData(kind) {
    if (!st.info) return toast('Open a data file first');
    let got;
    try {
      got = await pickSide();
    } catch (err) {
      return toast(err.message, 'error');
    }
    if (!got) return undefined;
    const body = kind === 'rows' ? rowsDialogBody(got.side) : columnsDialogBody(got.side);
    const ok = await dialog({ title: kind === 'rows' ? `Add rows from ${got.side.name}` : `Add columns from ${got.side.name}`, body, wide: true, ok: kind === 'rows' ? 'Add rows' : 'Add columns' });
    if (!ok) {
      client.call('dropSide').catch(() => {});
      return undefined;
    }
    const opts = body.read();
    const step = { kind, source: got.source, opts, name: got.side.name };
    try {
      await applyStep(step);
    } catch (err) {
      toast(err.message, 'error');
    }
    return undefined;
  }

  async function applyStep(step, { quiet = false } = {}) {
    const before = st.info.rows;
    const beforeCols = st.info.columns.length;
    const res = await client.call(step.kind === 'rows' ? 'addRows' : 'addColumns', step.opts);
    st.info = res.info;
    step.summary = step.kind === 'rows'
      ? `+${fmtInt(res.info.rows - before)} rows`
      : `${res.info.columns.length - beforeCols >= 0 ? '+' : ''}${res.info.columns.length - beforeCols} columns, ${JOINS_SHORT[step.opts.how] || step.opts.how} join on ${step.opts.keys.map((k) => k.base).join(', ')} → ${fmtInt(res.info.rows)} rows`;
    st.steps.push(step);
    if (quiet) return;
    renderAll();
    refreshPlots();
    renderFilters();
    toast(step.kind === 'rows' ? `Added ${fmtInt(res.info.rows - before)} rows from ${step.name}` : `Added columns from ${step.name}; ${fmtInt(res.info.rows)} rows now`);
  }
  const JOINS_SHORT = { left: 'left', inner: 'inner', right: 'right', full: 'full' };

  // Reopens the original data and runs the steps again (project restore, step removal).
  async function replaySteps(steps, handles = []) {
    st.steps = [];
    for (const [i, step] of steps.entries()) {
      const src = step.source.handle || handles[i];
      if (!src) {
        toast(`Can't find ${step.source.name || 'a file'} that this analysis adds data from`, 'error');
        continue;
      }
      try {
        const got = await readSide(src, step.source.sheet);
        if (!got) continue;
        await applyStep({ ...step, source: { ...step.source, handle: src } }, { quiet: true });
      } catch (err) {
        toast(`${step.name}: ${err.message}`, 'error');
      }
    }
  }

  async function removeStep(i) {
    const keep = st.steps.filter((_, k) => k !== i);
    const src = st.source;
    try {
      if (src.kind === 'sheet') st.info = await client.call('fromRows', src.rows, src.name);
      else {
        setLoading(`Opening ${src.name}…`, 0);
        st.info = await client.callWith({ onProgress: (p) => setLoading(`Opening ${src.name}…`, p.fraction, p.rows) }, 'load', { handle: src.handle.handle, size: src.handle.size, name: src.name }, { ext: src.ext, sheet: src.sheet ?? undefined });
        setLoading(null);
      }
      await replaySteps(keep);
      for (const c of st.calculated) st.info = (await client.call('addCalculated', c.name, c.expr).catch(() => ({ info: st.info }))).info;
    } catch (err) {
      setLoading(null);
      toast(err.message, 'error');
    }
    renderAll();
    refreshPlots();
    renderFilters();
  }

  async function dataTables() {
    if (!st.info) return;
    const body = h('div', 'an-tables');
    const src = st.source;
    const list = h('div', 'an-steps');
    list.append(h('div', 'an-step', `${icon('database', 16)}<div><b>${escapeHtml(src?.name || st.info.name)}</b><small>${src?.kind === 'sheet' ? 'From the sheet' : escapeHtml(src?.path || '')}</small></div>`));
    st.steps.forEach((step, i) => {
      const row = h('div', 'an-step', `${icon(step.kind === 'rows' ? 'addRows' : 'addColumns', 16)}<div><b>${step.kind === 'rows' ? 'Add rows' : 'Add columns'} from ${escapeHtml(step.name)}</b><small>${escapeHtml(step.summary || '')}</small></div>`);
      const rm = h('button', 'btn an-small', 'Remove');
      rm.type = 'button';
      rm.onclick = () => {
        body.closest('form')?.requestSubmit();
        removeStep(i);
      };
      row.append(rm);
      list.append(row);
    });
    for (const c of st.calculated) list.append(h('div', 'an-step', `${icon('colCalc', 16)}<div><b>Calculated column ${escapeHtml(c.name)}</b><small><code>${escapeHtml(c.expr)}</code></small></div>`));
    body.append(list, h('p', 'muted', `Result: ${fmtInt(st.info.rows)} rows × ${st.info.columns.length} columns.`));
    const actions = h('div', 'an-tables-actions');
    const addR = h('button', 'btn', `${icon('addRows', 14)} Add rows…`);
    const addC = h('button', 'btn', `${icon('addColumns', 14)} Add columns…`);
    addR.type = addC.type = 'button';
    addR.onclick = () => {
      body.closest('form')?.requestSubmit();
      addData('rows');
    };
    addC.onclick = () => {
      body.closest('form')?.requestSubmit();
      addData('columns');
    };
    actions.append(addR, addC);
    body.append(actions);
    await dialog({ title: 'Data tables', body, wide: true, ok: 'Close', cancel: null });
  }

  // ---------- panels ----------
  function applyPanels() {
    root.classList.toggle('no-left', !st.panels.left);
    root.classList.toggle('no-right', !st.panels.right);
    tableWrap.hidden = !st.table.open || !st.info;
    tableWrap.style.height = `${st.table.height}px`;
    for (const v of st.plots) v.onResize();
  }

  function togglePanel(which) {
    if (which === 'table') {
      st.table.open = !st.table.open;
      applyPanels();
      tableRender();
    } else {
      st.panels[which] = !st.panels[which];
      applyPanels();
    }
    renderRail();
    shell.refresh?.();
  }

  function renderStatus() {
    if (!st.info) {
      statusEl.textContent = '';
      return;
    }
    const i = st.info;
    statusEl.textContent = `${fmtInt(i.rows)} rows · ${i.columns.length} columns${i.filtered !== i.rows ? `    Filtered: ${fmtInt(i.filtered)}` : ''}${i.marked ? `    Marked: ${fmtInt(i.marked)}` : ''}`;
  }

  function renderAll() {
    renderRail();
    renderPages();
    renderLeft();
    renderRight();
    renderTableHead();
    applyPanels();
    colWidths = [];
    tableReset();
    renderStatus();
    shell.refresh?.();
  }

  // ---------- properties, menus and shortcuts ----------
  const props = createProps({
    active: () => st.active,
    info: () => st.info,
    client,
    setProp: (fn) => setProp(fn),
    setLook: (fn) => setLook(fn),
    fitMenu: (anchor) => fitMenu(anchor),
    removeFit: (v, f) => {
      v.spec.fits = v.spec.fits.filter((g) => g !== f);
      v.draw();
      renderProps();
      renderFits();
    },
    duplicate: () => duplicateViz(),
    remove: () => st.active && removePlot(st.active),
    close: () => closeProps(),
  });
  center.append(props.el);

  function openProps(v = st.active, tab = null) {
    if (v && v !== st.active) setActive(v);
    if (!st.active) return toast('Select a visualization first');
    props.open(tab);
    root.classList.add('props-open');
    for (const x of st.plots) x.onResize();
    return undefined;
  }

  function closeProps() {
    props.close();
    root.classList.remove('props-open');
    for (const x of st.plots) x.onResize();
  }

  async function markAll(mode) {
    if (!st.info) return;
    st.info = await client.call('markAll', mode);
    afterMark();
  }

  async function filterMarked(mode) {
    if (!st.info?.marked) return toast('Mark some rows first by dragging across a plot');
    await afterFilter(await client.call('setRowset', mode));
    renderFilters();
    return undefined;
  }

  async function resetAllFilters() {
    await afterFilter(await client.call('resetFilters'));
    renderFilters();
  }

  async function copyMarkedRows() {
    if (!st.info?.marked) return toast('Mark some rows first by dragging across a plot');
    const limit = 100000;
    const res = await client.call('rows', 0, limit, 'marked');
    const clean = (x) => String(x ?? '').replace(/[\t\r\n]+/g, ' ');
    await navigator.clipboard.writeText([res.columns, ...res.rows].map((r) => r.map(clean).join('\t')).join('\n'));
    toast(res.total > limit ? `Copied the first ${fmtInt(limit)} of ${fmtInt(res.total)} marked rows` : `Copied ${fmtInt(res.total)} marked rows`);
    return undefined;
  }

  async function copyVizImage(v = st.active) {
    if (!v) return toast('Select a visualization first');
    try {
      const blob = await v.toPng(2);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Visualization copied as a picture');
    } catch (err) {
      toast(err.message || String(err), 'error');
    }
    return undefined;
  }

  const vizTypeGrid = (v) => {
    const grid = h('div', 'an-ctx-types');
    for (const [type, ic, label] of VIZ_MENU) {
      if (type === 'multi') continue;
      const b = h('button', `an-ctx-type${v?.spec.type === type ? ' on' : ''}`, icon(ic, 18));
      b.title = v ? `Change to ${label.toLowerCase()}` : `New ${label.toLowerCase()}`;
      b.onclick = () => {
        closePopup();
        if (v) {
          setActive(v);
          changeType(type);
        } else addPlot(newSpec(type));
      };
      grid.append(b);
    }
    return grid;
  };

  // Switches the selected visualization to another type, keeping its columns.
  function changeType(t) {
    setProp((x) => {
      x.type = t;
      if (AGGED.includes(t) && !x.agg) x.agg = x.y?.[0]?.col ? 'mean' : 'count';
      if (['bar', 'box', 'heatmap', 'histogram', 'pie', 'table'].includes(t)) x.y = (x.y || []).slice(0, 1);
      if (t === 'histogram') x.y = [];
      if (['scatter', 'line', 'box', 'heatmap'].includes(t) && !x.y?.[0]?.col) {
        const y = st.info.columns.find((c) => c.type !== 'string' && c.name !== x.x);
        if (y) x.y = [{ col: y.name }];
      }
      if (['scatter', 'line', 'histogram', 'heatmap'].includes(t) && st.info.columns.find((c) => c.name === x.x)?.type === 'string') {
        x.x = st.info.columns.find((c) => c.type !== 'string')?.name || x.x;
      }
    });
  }

  function columnItems(pick, current, filter = () => true) {
    return [
      { label: '(none)', icon: current ? null : 'mark', run: () => pick(null) },
      ...st.info.columns.filter(filter).slice(0, 60).map((c) => ({ label: c.name, icon: c.name === current ? 'mark' : TYPE_ICON[c.type], run: () => pick(c.name) })),
    ];
  }

  function vizContextMenu(v, x, y) {
    if (!st.info) return;
    setActive(v);
    const s = v.spec;
    const xy = ['scatter', 'line'].includes(s.type);
    const marked = !!st.info.marked;
    menuAt(x, y, [
      { head: s.title || autoTitle(s) },
      { node: vizTypeGrid(v) },
      { label: 'Properties…', icon: 'settings', kbd: 'Alt+Enter', run: () => openProps(v) },
      { label: 'Duplicate to a new page', icon: 'duplicate', kbd: kbd('Ctrl+D'), run: () => duplicateViz(v) },
      '-',
      { label: 'Trellis by', icon: 'grid', items: [...columnItems((name) => setProp((sp) => { sp.trellis = name ? { ...(sp.trellis || {}), mode: 'panels', by: name } : null; }), s.trellis?.by), '-', { label: 'Trellis settings…', icon: 'settings', run: () => openProps(v, 'trellis') }], enabled: s.type !== 'table' },
      { label: 'Color by', icon: 'theme', items: columnItems((name) => setProp((sp) => { sp.color = name; }), s.color), enabled: ['scatter', 'line', 'bar', 'histogram', 'table'].includes(s.type) && (s.y || []).length <= 1 },
      xy ? { label: 'Marker', icon: 'chartScatter', items: [
        { label: 'Marker settings…', icon: 'settings', run: () => openProps(v, 'marker') },
        { label: 'Size by…', icon: 'chartScatter', items: columnItems((name) => setProp((sp) => { sp.marker = { ...(sp.marker || {}), sizeBy: name }; }), s.marker?.sizeBy) },
        { label: 'Shape by…', icon: 'shape', items: columnItems((name) => setProp((sp) => { sp.marker = { ...(sp.marker || {}), shapeBy: name }; }), s.marker?.shapeBy) },
      ], enabled: s.type === 'scatter' || s.markers } : null,
      s.type === 'scatter' ? { label: 'Connect points by', icon: 'chartMulti', items: [
        { label: s.connect?.on ? 'Stop connecting' : 'Connect in X order', icon: 'chartLine', run: () => setProp((sp) => { sp.connect = { ...(sp.connect || {}), on: !sp.connect?.on }; }) },
        '-',
        ...st.info.columns.slice(0, 60).map((c) => ({ label: c.name, icon: s.connect?.on && s.connect.by === c.name ? 'mark' : TYPE_ICON[c.type], run: () => setProp((sp) => { sp.connect = { ...(sp.connect || {}), on: true, by: c.name }; }) })),
      ] } : null,
      xy ? { label: 'Fit curve', icon: 'fitCurve', items: Object.entries(MODELS).map(([id, m]) => ({ label: `${m.label}${id === 'poly' || id === 'custom' ? '…' : ''}`, icon: 'fitCurve', run: () => addFit(id) })) } : null,
      { label: 'Filters for this visualization…', icon: 'filter', run: () => openProps(v, 'data') },
      '-',
      { label: 'Mark all rows', icon: 'mark', kbd: kbd('Ctrl+A'), run: () => markAll('replace') },
      { label: 'Unmark all', icon: 'markClear', kbd: kbd('Ctrl+E'), run: () => clearMark(), enabled: marked },
      { label: 'Invert marking', icon: 'refresh', kbd: kbd('Ctrl+I'), run: () => markAll('toggle') },
      { label: 'Filter to marked', icon: 'markFilter', kbd: kbd('Ctrl+M'), run: () => filterMarked('marked'), enabled: marked },
      { label: 'Filter out marked', icon: 'filterOff', kbd: kbd('Ctrl+Shift+M'), run: () => filterMarked('unmarked'), enabled: marked },
      { label: 'Copy marked rows', icon: 'copy', kbd: kbd('Ctrl+C'), run: () => copyMarkedRows(), enabled: marked },
      '-',
      { label: 'Copy as picture', icon: 'image', kbd: kbd('Ctrl+Shift+C'), run: () => copyVizImage(v) },
      { label: 'Export', icon: 'export', items: [
        { label: 'Plot as PNG…', icon: 'image', run: () => exportPlot('png') },
        { label: 'Plot as SVG…', icon: 'export', run: () => exportPlot('svg') },
        { label: 'Plot as PDF…', icon: 'pdf', kbd: kbd('Ctrl+P'), run: () => exportPlot('pdf') },
        { label: 'Marked rows as CSV…', icon: 'mark', run: () => exportCsv('marked') },
        { label: 'Filtered rows as CSV…', icon: 'grid', run: () => exportCsv('filtered') },
      ] },
      { label: 'Send to Present…', icon: 'toPresent', run: () => sendToPresent({ st, client, showPage, refreshPlots, setLoading }) },
      '-',
      { label: 'Rename…', icon: 'textbox', run: () => viewCtx.rename(v) },
      { label: 'Show all data', icon: 'fitView', run: () => v.resetView() },
      { label: 'Remove visualization', icon: 'trash', run: () => removePlot(v) },
    ]);
  }

  function pageContextMenu(x, y) {
    menuAt(x, y, [
      { head: 'Add a visualization' },
      { node: vizTypeGrid(null) },
      { label: 'New page', icon: 'slideNew', kbd: kbd('Ctrl+N'), run: () => addPage() },
      { label: 'Duplicate page', icon: 'duplicate', kbd: kbd('Ctrl+Shift+D'), run: () => addPage(st.pages[st.page], st.page + 1) },
      '-',
      { label: 'Reset all filters', icon: 'filterOff', kbd: kbd('Ctrl+R'), run: () => resetAllFilters() },
      { label: 'Unmark all', icon: 'markClear', kbd: kbd('Ctrl+E'), run: () => clearMark(), enabled: !!st.info?.marked },
      '-',
      { label: 'Keyboard shortcuts', icon: 'key', kbd: 'F1', run: () => showShortcuts() },
    ]);
  }

  function filterContextMenu(name, x, y) {
    menuAt(x, y, [
      { head: name },
      { label: 'Reset this filter', icon: 'filterOff', run: async () => { await setFilter(name, null); renderFilters(); }, enabled: !!filterSpecs[name] },
      { label: 'Reset all filters', icon: 'filterOff', kbd: kbd('Ctrl+R'), run: () => resetAllFilters() },
      '-',
      st.active ? { label: 'Use only in the selected visualization', icon: 'filter', note: 'Moves this filter into its properties', run: async () => {
        const spec = filterSpecs[name];
        if (!spec) return openProps(st.active, 'data');
        setProp((sp) => { sp.vizFilters = { ...(sp.vizFilters || {}), [name]: spec }; });
        await setFilter(name, null);
        renderFilters();
        return openProps(st.active, 'data');
      } } : null,
      { label: 'Collapse all filters', icon: 'up', run: () => { openFilters.clear(); renderFilters(); } },
    ]);
  }

  function tableContextMenu(x, y) {
    menuAt(x, y, [
      { label: 'Copy marked rows', icon: 'copy', kbd: kbd('Ctrl+C'), run: () => copyMarkedRows(), enabled: !!st.info?.marked },
      { label: 'Filter to marked', icon: 'markFilter', kbd: kbd('Ctrl+M'), run: () => filterMarked('marked'), enabled: !!st.info?.marked },
      { label: 'Unmark all', icon: 'markClear', kbd: kbd('Ctrl+E'), run: () => clearMark(), enabled: !!st.info?.marked },
      '-',
      { label: 'Marked rows as CSV…', icon: 'mark', run: () => exportCsv('marked') },
      { label: 'Filtered rows as CSV…', icon: 'grid', run: () => exportCsv('filtered') },
      { label: 'Hide the details table', icon: 'close', kbd: kbd('Ctrl+1'), run: () => togglePanel('table') },
    ]);
  }
  tableWrap.addEventListener('contextmenu', (e) => {
    if (!st.info) return;
    e.preventDefault();
    tableContextMenu(e.clientX, e.clientY);
  });

  function stepPage(d) {
    if (st.pages.length < 2) return;
    switchPage((st.page + d + st.pages.length) % st.pages.length);
  }

  const NEW_VIZ = { 2: 'table', 3: 'bar', 5: 'line', 6: 'multi', 7: 'pie', 8: 'scatter', 9: 'histogram', 0: 'box' };

  // The workspace's shortcuts (see SHORTCUTS for the list people see).
  function onKey(e) {
    if (!root.isConnected || !root.offsetParent || document.querySelector('.modal-back')) return;
    const t = e.target;
    const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const code = e.code || '';
    const take = (run) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      closePopup();
      run();
    };
    if (k === 'F1' && !ctrl) return take(() => showShortcuts());
    if (typing) return;
    if (ctrl && !e.altKey && k === 'o') return take(() => openData());
    if (!st.info) return;
    const digit = code.startsWith('Digit') ? Number(code.slice(5)) : null;
    if (ctrl && !e.altKey) {
      if (k === 'd') return take(() => (e.shiftKey ? addPage(st.pages[st.page], st.page + 1) : duplicateViz()));
      if (k === 'n') return take(() => addPage());
      if (k === 'p') return take(() => exportPlot('pdf'));
      if (k === 'a') return take(() => markAll('replace'));
      if (k === 'e') return take(() => clearMark());
      if (k === 'i') return take(() => markAll('toggle'));
      if (k === 'm') return take(() => filterMarked(e.shiftKey ? 'unmarked' : 'marked'));
      if (k === 'r') return take(() => resetAllFilters());
      if (k === 'f') return take(() => {
        st.panels.right = true;
        applyPanels();
        renderRail();
        right.querySelector('.an-filter-search')?.focus();
      });
      if (k === 'c' && e.shiftKey) return take(() => copyVizImage());
      if (k === 'c' && !String(window.getSelection?.() || '')) return take(() => copyMarkedRows());
      if (k === 'Tab' || k === 'PageDown' || k === 'PageUp') return take(() => stepPage(k === 'PageUp' || e.shiftKey ? -1 : 1));
      if (k === 'ArrowRight' || k === 'ArrowLeft') return take(() => stepPage(k === 'ArrowLeft' ? -1 : 1));
      if (digit === 1 && !e.shiftKey) return take(() => togglePanel('table'));
      if (digit === 3 && e.shiftKey) return take(() => addPlot(newSpec('heatmap')));
      if (digit != null && !e.shiftKey && NEW_VIZ[digit]) return take(() => addPlot(newSpec(NEW_VIZ[digit])));
    }
    if (e.altKey && k === 'Enter') return take(() => openProps());
    if (e.shiftKey && k === 'F10' && st.active) return take(() => {
      const r = st.active.el.getBoundingClientRect();
      vizContextMenu(st.active, r.left + 40, r.top + 40);
    });
    if (k === 'Delete' && !ctrl && st.info.marked) return take(() => filterMarked('unmarked'));
    return undefined;
  }
  document.addEventListener('keydown', onKey, true);

  // ---------- AI ----------
  async function aiContext() {
    if (!st.info) return '<analysis>No data is open in the analysis workspace yet.</analysis>';
    const summary = await client.call('summary').catch(() => []);
    const filters = await client.call('filterState').catch(() => ({}));
    const cols = summary.map((c) => {
      const base = `- ${c.name} (${c.type}${c.expr ? `, calculated = ${c.expr}` : ''}${c.missing ? `, ${c.missing} empty` : ''})`;
      if (c.type === 'string') return `${base}: ${c.distinct} distinct; most common ${c.top.map(([v, n]) => `"${v}" (${n})`).join(', ')}`;
      return `${base}: min ${c.min}, max ${c.max}${c.mean != null ? `, mean ${c.mean}` : ''}`;
    }).join('\n');
    const plots = st.plots.map((v, i) => `${i + 1}. ${v.spec.type}${v === st.active ? ' (selected)' : ''}: ${JSON.stringify({ title: v.spec.title || autoTitle(v.spec), x: v.spec.x, y: v.spec.y, color: v.spec.color, agg: v.spec.agg, fits: (v.spec.fits || []).filter((f) => f.result).map((f) => `${f.result.label || f.model} ${fitText(f.result)}`) })}`).join('\n') || '(none)';
    return `<analysis dataset="${escapeHtml(st.info.name)}" rows="${st.info.rows}" filtered="${st.info.filtered}" marked="${st.info.marked}">
<columns>
${cols}
</columns>
<filters>${JSON.stringify(filters.columns || {})}${filters.expressions?.length ? ` formula: ${filters.expressions.join(' and ')}` : ''}</filters>
<plots>
${plots}
</plots>
</analysis>`;
  }

  async function applyPlan(plan) {
    const before = { plots: st.plots.map((v) => JSON.parse(JSON.stringify(v.spec))), filters: await client.call('filterState').catch(() => null), calculated: [...st.calculated] };
    const notes = [];
    for (const c of plan.calculated || []) {
      if (!c.name || !c.expression) continue;
      try {
        const res = await client.call('addCalculated', c.name, c.expression);
        st.calculated = st.calculated.filter((x) => x.name !== res.name);
        st.calculated.push({ name: res.name, expr: c.expression });
        st.info = res.info;
      } catch (err) {
        notes.push(`Column ${c.name}: ${err.message}`);
      }
    }
    for (const f of plan.filters || []) {
      try {
        if (f.kind === 'reset') st.info = await client.call('resetFilters');
        else if (f.kind === 'expression' && f.expression) st.info = await client.call('setExpressionFilters', [f.expression]);
        else if (f.kind === 'range' && f.column) {
          const col = st.info.columns.find((c) => c.name.toLowerCase() === f.column.toLowerCase());
          const parse = (t) => (t === '' || t == null ? null : col?.type === 'date' ? Date.parse(t) : Number(t));
          st.info = await client.call('setFilter', col?.name || f.column, { kind: 'range', min: parse(f.min), max: parse(f.max), missing: false });
        } else if (f.kind === 'values' && f.column) st.info = await client.call('setFilter', f.column, f.values?.length ? { kind: 'values', values: f.values } : null);
        else if (f.kind === 'clear' && f.column) st.info = await client.call('setFilter', f.column, null);
      } catch (err) {
        notes.push(`Filter on ${f.column || 'rows'}: ${err.message}`);
      }
    }
    if (plan.clearPlots) clearPlots();
    const made = [];
    for (const p of plan.plots || []) {
      const ys = [...(p.y || []).map((col) => ({ col })), ...(p.rightAxis || []).map((col) => ({ col, axis: 'right' }))];
      const spec = { type: p.type, title: p.title || null, x: p.x || null, y: ys, color: p.color || null, agg: p.agg || (['bar', 'pie', 'table'].includes(p.type) ? (ys.length ? 'mean' : 'count') : undefined), bins: p.bins || null, z: p.value || null, logX: !!p.logX, logY: !!p.logY };
      const v = addPlot(spec, { quiet: true });
      if (v) made.push(v);
    }
    renderAll();
    refreshPlots();
    for (const fit of plan.fits || []) {
      const target = fit.plot >= 1 ? made[fit.plot - 1] : st.active;
      if (!target) continue;
      setActive(target);
      await addFit(fit.model, { degree: fit.degree || 2, equation: fit.equation || undefined, series: 0, markedOnly: false });
    }
    await renderFilters();
    st.undo = before;
    if (notes.length) toast(notes.join(' · '), 'error');
  }

  async function undoPlan() {
    const u = st.undo;
    if (!u) return;
    st.undo = null;
    for (const c of st.calculated) {
      if (!u.calculated.find((x) => x.name === c.name)) st.info = await client.call('removeColumn', c.name).catch(() => st.info);
    }
    st.calculated = u.calculated;
    if (u.filters) st.info = await client.call('restoreFilters', u.filters);
    clearPlots();
    for (const s of u.plots) addPlot(s, { quiet: true });
    renderAll();
    refreshPlots();
    toast('Undid the AI changes');
  }

  const PLAN_SCHEMA = {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'Short Markdown answer for the user: what you did and what the plots show, or the answer to their question.' },
      calculated: { type: 'array', description: 'New calculated columns, created before plots and filters.', items: { type: 'object', properties: { name: { type: 'string' }, expression: { type: 'string' } }, required: ['name', 'expression'], additionalProperties: false } },
      filters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['range', 'values', 'expression', 'clear', 'reset'] },
            column: { type: 'string', description: 'Column name for range, values and clear; empty otherwise.' },
            min: { type: 'string', description: 'Lower bound (number or ISO date); empty for none.' },
            max: { type: 'string', description: 'Upper bound (number or ISO date); empty for none.' },
            values: { type: 'array', items: { type: 'string' }, description: 'Values to keep for a text column.' },
            expression: { type: 'string', description: 'Filter formula for kind expression, e.g. [Temp] > 20 and [Site] == "B".' },
          },
          required: ['kind', 'column', 'min', 'max', 'values', 'expression'],
          additionalProperties: false,
        },
      },
      clearPlots: { type: 'boolean', description: 'True to remove the existing plots first.' },
      plots: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['scatter', 'line', 'bar', 'histogram', 'box', 'heatmap', 'pie', 'table'] },
            title: { type: 'string' },
            x: { type: 'string', description: 'X column (category column for bar and box; empty for none).' },
            y: { type: 'array', items: { type: 'string' }, description: 'Y columns on the left axis. Empty for histogram, or for a bar chart of row counts.' },
            rightAxis: { type: 'array', items: { type: 'string' }, description: 'Y columns on a second axis on the right (line or scatter).' },
            color: { type: 'string', description: 'Column to color or group by; empty for none.' },
            agg: { type: 'string', enum: ['count', 'sum', 'mean', 'median', 'min', 'max', 'std'] },
            bins: { type: 'integer', description: 'Histogram or heat map bins; 0 for automatic.' },
            value: { type: 'string', description: 'Heat map value column (averaged per cell); empty to count rows.' },
            logX: { type: 'boolean' },
            logY: { type: 'boolean' },
          },
          required: ['type', 'title', 'x', 'y', 'rightAxis', 'color', 'agg', 'bins', 'value', 'logX', 'logY'],
          additionalProperties: false,
        },
      },
      fits: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            plot: { type: 'integer', description: '1-based index into the plots you create here, or 0 for the selected existing plot.' },
            model: { type: 'string', enum: Object.keys(MODELS) },
            degree: { type: 'integer', description: 'Polynomial degree (2-9); 0 otherwise.' },
            equation: { type: 'string', description: 'Custom equation such as y = a*exp(-x/b)+c; empty otherwise.' },
          },
          required: ['plot', 'model', 'degree', 'equation'],
          additionalProperties: false,
        },
      },
    },
    required: ['reply', 'calculated', 'filters', 'clearPlots', 'plots', 'fits'],
    additionalProperties: false,
  };

  const aiQuick = {
    label: 'Make plots and filters',
    icon: 'chartScatter',
    working: 'Planning the analysis',
    prompt: [
      'You are helping in the analysis workspace of Plot. The open dataset is described in <analysis>. Answer the request below by returning a plan.',
      'Use exact column names from <columns>. Formulas refer to columns as [Column name] and support + - * / ^, comparisons, and, or, not, if(c, a, b), abs, sqrt, exp, ln, log10, round, min, max, mean, std, cumsum, diff, lag, movavg and contains.',
      'Only create plots, filters, calculated columns or fits the request asks for or clearly needs; leave lists empty otherwise. For a plain question, answer it in reply and leave everything else empty.',
      'Plot types: scatter and line (x and y numeric or date; a line can take several y columns and rightAxis for a second y axis), bar (category x and an aggregated y, or row counts), histogram (one numeric x), box (numeric y grouped by an optional category x), heatmap (x and y, optional value), pie (slices by category x, sized by an aggregated y or row counts) and table (a cross table: rows by category x, columns by the color column, cells an aggregated y or counts).',
      'Fit models: linear, poly (with degree), exp, expdecay, power, log, gauss, lorentz, boltzmann, logistic, michaelis, custom (with equation). Fits only apply to scatter or line plots.',
    ].join('\n'),
    format: PLAN_SCHEMA,
    autoApply: true,
    summary: (d) => d.reply || 'Done.',
    history: (d) => `${d.reply}\n(Applied: ${d.plots.length} plots, ${d.filters.length} filters, ${d.calculated.length} calculated columns, ${d.fits.length} fits.)`,
    actions: (d) => [
      { label: 'Apply', icon: 'chartScatter', run: () => applyPlan(d) },
      ...(d.plots.length || d.filters.length || d.calculated.length || d.fits.length ? [{ label: 'Undo these changes', icon: 'undo', run: () => undoPlan() }] : []),
    ],
  };

  // ---------- ribbon ----------
  const needData = () => !!st.info;
  const hasPlot = () => !!st.active;
  const ribbonTab = {
    id: 'analyze',
    label: 'Analyze',
    groups: [
      { label: 'Data', items: [
        { type: 'big', icon: 'database', label: 'Open Data', title: 'Open a large CSV, TSV, Parquet or Excel file', run: () => openData() },
        { type: 'stack', items: [
          { type: 'small', icon: 'table', label: 'Use Sheet Data', run: () => useSheet() },
          { type: 'small', icon: 'colCalc', label: 'Calculated Column', run: () => calculatedColumn(), enabled: needData },
          { type: 'menu', icon: 'export', label: 'Export Data', items: () => [
            { label: 'Filtered rows as CSV…', icon: 'grid', run: () => exportCsv('filtered') },
            { label: 'Marked rows as CSV…', icon: 'mark', run: () => exportCsv('marked') },
            ...(sendToSheet ? [{ label: 'Marked rows to a new sheet', icon: 'table', run: () => toSheet('marked') }, { label: 'Filtered rows to a new sheet', icon: 'table', run: () => toSheet('filtered') }] : []),
          ] },
        ] },
        { type: 'stack', items: [
          { type: 'small', icon: 'addRows', label: 'Add Rows', title: 'Stack another file under this data', run: () => addData('rows'), enabled: needData },
          { type: 'small', icon: 'addColumns', label: 'Add Columns', title: 'Join another file on matching key columns', run: () => addData('columns'), enabled: needData },
          { type: 'small', icon: 'dataTables', label: 'Data Tables', title: 'Sources and the steps applied to them', run: () => dataTables(), enabled: needData },
        ] },
      ] },
      { label: 'Visualizations', items: [
        { type: 'big', icon: 'chartScatter', label: 'Scatter', run: () => addPlot(newSpec('scatter')), enabled: needData },
        { type: 'big', icon: 'chartLine', label: 'Line', run: () => addPlot(newSpec('line')), enabled: needData },
        { type: 'big', icon: 'chartBar', label: 'Bar', run: () => addPlot(newSpec('bar')), enabled: needData },
        { type: 'stack', items: [
          { type: 'small', icon: 'chartHist', label: 'Histogram', run: () => addPlot(newSpec('histogram')), enabled: needData },
          { type: 'small', icon: 'chartBox', label: 'Box Plot', run: () => addPlot(newSpec('box')), enabled: needData },
          { type: 'small', icon: 'chartHeat', label: 'Heat Map', run: () => addPlot(newSpec('heatmap')), enabled: needData },
        ] },
        { type: 'stack', items: [
          { type: 'small', icon: 'chartPie', label: 'Pie', run: () => addPlot(newSpec('pie')), enabled: needData },
          { type: 'small', icon: 'chartTable', label: 'Cross Table', run: () => addPlot(newSpec('table')), enabled: needData },
          { type: 'small', icon: 'chartMulti', label: 'Two-Axis Line', title: 'Line plot with a second Y axis', run: () => addPlot(newSpec('multi')), enabled: needData },
        ] },
        { type: 'big', icon: 'slideNew', label: 'New Page', title: `Add a page of visualizations (${kbd('Ctrl+N')})`, run: () => addPage(), enabled: needData },
        { type: 'stack', items: [
          { type: 'small', icon: 'settings', label: 'Properties', title: 'Every setting of the selected visualization (Alt+Enter)', run: () => openProps(), enabled: hasPlot },
          { type: 'small', icon: 'duplicate', label: 'Duplicate', title: `Copy the selected visualization onto a new page (${kbd('Ctrl+D')})`, run: () => duplicateViz(), enabled: hasPlot },
          { type: 'small', icon: 'grid', label: 'Trellis', title: 'Split the selected visualization into panels', run: () => openProps(st.active, 'trellis'), enabled: hasPlot },
        ] },
      ] },
      { label: 'Filter & Mark', items: [
        { type: 'stack', items: [
          { type: 'small', icon: 'filterOff', label: 'Reset Filters', run: async () => { await afterFilter(await client.call('resetFilters')); renderFilters(); }, enabled: needData },
          { type: 'small', icon: 'markFilter', label: 'Filter to Marked', run: async () => { if (!st.info?.marked) return toast('Mark some rows first by dragging across a plot'); await afterFilter(await client.call('setRowset', 'marked')); renderFilters(); return undefined; }, enabled: needData },
          { type: 'small', icon: 'filterOff', label: 'Remove Marked', run: async () => { if (!st.info?.marked) return toast('Mark some rows first by dragging across a plot'); await afterFilter(await client.call('setRowset', 'unmarked')); renderFilters(); return undefined; }, enabled: needData },
        ] },
        { type: 'big', icon: 'markClear', label: 'Clear Marking', title: 'Clear marking (Esc)', run: () => clearMark(), enabled: () => !!st.info?.marked },
      ] },
      { label: 'Analysis', items: [
        { type: 'menu', big: true, icon: 'fitCurve', label: 'Fit Curve', items: () => Object.entries(MODELS).map(([id, m]) => ({ label: `${m.label}${id === 'poly' || id === 'custom' ? '…' : ''}`, icon: 'fitCurve', run: () => addFit(id) })) },
      ] },
      { label: 'Export', items: [
        { type: 'stack', items: [
          { type: 'small', icon: 'image', label: 'Plot as PNG', run: () => exportPlot('png'), enabled: hasPlot },
          { type: 'small', icon: 'export', label: 'Plot as SVG', run: () => exportPlot('svg'), enabled: hasPlot },
          { type: 'small', icon: 'pdf', label: 'Plot as PDF', run: () => exportPlot('pdf'), enabled: hasPlot },
        ] },
        { type: 'big', icon: 'toPresent', label: 'Send to Present', title: 'Put the plots you pick, and a table of rows if you like, on a slide in a new presentation', run: () => sendToPresent({ st, client, showPage, refreshPlots, setLoading }), enabled: needData },
        { type: 'big', icon: 'save', label: 'Save Analysis', title: 'Save plots, filters and formulas as a .workplot file', run: () => saveProject(), enabled: needData },
      ] },
      { label: 'Show', items: [
        { type: 'stack', items: [
          { type: 'small', icon: 'panelLeft', label: 'Data Panel', run: () => togglePanel('left'), active: () => st.panels.left },
          { type: 'small', icon: 'panel', label: 'Filters', run: () => togglePanel('right'), active: () => st.panels.right },
          { type: 'small', icon: 'details', label: 'Details', run: () => togglePanel('table'), active: () => st.table.open },
        ] },
        { type: 'big', icon: 'key', label: 'Shortcuts', title: 'Keyboard shortcuts (F1)', run: () => showShortcuts() },
      ] },
      { label: 'AI', items: [{ type: 'big', icon: 'sparkle', label: 'Ask AI', title: 'Describe the plots or filters you want', run: () => shell.claude?.runQuick(aiQuick) }] },
    ],
  };

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && root.isConnected && root.offsetParent && st.info?.marked && !document.querySelector('.modal-back')) clearMark();
  });

  async function startFromLaunch(analysis) {
    onShow?.();
    const handle = analysis.path ? await window.office.data.launch() : null;
    if (handle?.error) return toast(handle.error, 'error');
    if (analysis.project) {
      const stepHandles = [];
      for (let i = 0; i < (analysis.project.steps || []).length; i += 1) {
        const got = await window.office.data.launch(i);
        stepHandles.push(got && !got.error ? got : null);
      }
      return restoreProject({ project: analysis.project, projectPath: analysis.projectPath, handle, stepHandles });
    }
    if (handle) return loadSource(handle);
    return undefined;
  }

  return {
    el: root,
    statusEl,
    ribbonTab,
    aiQuick,
    aiContext,
    hasData: () => !!st.info,
    openData,
    useSheet,
    startFromLaunch,
    saveProject,
    resize: () => applyPanels(),
  };
}
