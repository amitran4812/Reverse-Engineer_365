// Send to Present: pick charts from any page of the analysis, a Present
// template and an optional table of rows, and open them as a new
// presentation, all on one slide or with each chart on a slide of its own.

import { dialog, escapeHtml, h, toast } from '../../shared/shell.js';
import { themePicker } from '../../shared/themes.js';
import { PLOT_TYPES, autoTitle } from './plot.js';
import { buildSlide, planSlide } from './slide.js';

const MAX_CHARTS = 12; // on one slide
const MAX_SLIDES = 60; // one chart each
const last = { theme: 'paper', each: false, table: false, source: 'filtered', where: '', columns: null, limit: 15 };

const frame = () => new Promise((r) => requestAnimationFrame(() => r()));
const dataUrl = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

function check(label, checked, extra = '') {
  const l = h('label', 'an-value');
  const box = h('input');
  box.type = 'checkbox';
  box.checked = checked;
  l.append(box, h('span', '', label), ...(extra ? [h('em', '', extra)] : []));
  return { el: l, box };
}

function yearHint(columns) {
  const c = columns.find((x) => /year|yr/i.test(x.name)) || columns.find((x) => x.type === 'number');
  return c ? `[${c.name}] >= 2020 and [${c.name}] <= 2022` : '[Column] > 0';
}

export async function sendToPresent({ st, client, showPage, refreshPlots, setLoading }) {
  const pages = st.pages.map((pg, i) => ({ index: i, title: pg.title, plots: pg.plots })).filter((pg) => pg.plots.length);
  const columns = st.info.columns;
  const base = st.info.name.replace(/\.[^.]+(\s*\(.*\))?$/, '');

  const body = h('div', 'an-combine an-present');
  const titleInput = h('input');
  titleInput.value = base;
  const titleRow = h('label', 'an-field');
  titleRow.append(h('span', '', 'Slide title'), titleInput);
  body.append(titleRow);

  const list = h('div', 'an-values an-bring an-present-plots');
  const picks = [];
  for (const pg of pages) {
    if (pages.length > 1) list.append(h('b', 'an-present-page', escapeHtml(pg.title)));
    for (const v of pg.plots) {
      const c = check(escapeHtml(v.spec.title || autoTitle(v.spec)), true, escapeHtml(PLOT_TYPES[v.spec.type]?.label || v.spec.type));
      list.append(c.el);
      picks.push({ page: pg.index, view: v, box: c.box });
    }
  }
  if (!picks.length) list.append(h('p', 'muted', 'There are no plots yet. You can still send a table.'));
  const head = h('div', 'an-present-head');
  const count = h('span', 'muted');
  const all = h('button', 'btn an-small', 'All');
  const none = h('button', 'btn an-small', 'None');
  all.type = 'button';
  none.type = 'button';
  const recount = () => {
    count.textContent = `${picks.filter((p) => p.box.checked).length} of ${picks.length} selected`;
  };
  all.onclick = () => { picks.forEach((p) => { p.box.checked = true; }); recount(); };
  none.onclick = () => { picks.forEach((p) => { p.box.checked = false; }); recount(); };
  list.addEventListener('change', recount);
  recount();
  head.append(h('b', '', 'Plots'), count, h('span', 'an-spacer'), all, none);
  body.append(head, list);

  const each = h('select');
  for (const [value, label] of [['one', 'All on one slide'], ['each', 'One slide for each plot']]) {
    const o = h('option', '', label);
    o.value = value;
    each.append(o);
  }
  each.value = last.each ? 'each' : 'one';
  const eachRow = h('label', 'an-field');
  eachRow.append(h('span', '', 'Slides'), each);
  body.append(eachRow);

  body.append(h('b', '', 'Template'));
  const themes = themePicker(last.theme);
  body.append(themes);

  const tableOn = check('Add a table of rows', last.table);
  tableOn.el.classList.add('an-present-toggle');
  body.append(tableOn.el);
  const tbl = h('div', 'an-present-table');
  const source = h('select');
  for (const [value, label] of [['filtered', 'Rows that pass the filters'], ['marked', `Marked rows (${(st.info.marked || 0).toLocaleString()})`], ['all', 'All rows']]) {
    const o = h('option', '', escapeHtml(label));
    o.value = value;
    o.disabled = value === 'marked' && !st.info.marked;
    source.append(o);
  }
  source.value = last.source === 'marked' && !st.info.marked ? 'filtered' : last.source;
  const where = h('input');
  where.placeholder = yearHint(columns);
  where.value = last.where;
  where.spellcheck = false;
  const limit = h('input');
  limit.type = 'number';
  limit.min = 1;
  limit.max = 40;
  limit.value = last.limit;
  const row = (label, control) => {
    const l = h('label', 'an-field');
    l.append(h('span', '', label), control);
    return l;
  };
  const colBox = h('div', 'an-checks an-present-cols');
  const keep = new Set(last.columns?.filter((n) => columns.some((c) => c.name === n)) || columns.slice(0, 5).map((c) => c.name));
  const colChecks = columns.map((c) => {
    const x = check(`${escapeHtml(c.name)}`, keep.has(c.name));
    x.el.className = 'an-check';
    colBox.append(x.el);
    return { name: c.name, box: x.box };
  });
  tbl.append(
    row('Rows', source),
    row('Only rows where (optional formula)', where),
    h('p', 'muted an-present-tip', 'For particular years write, for example, <code>[Year] == 2021 or [Year] == 2023</code>.'),
    h('span', 'an-present-label', 'Columns'),
    colBox,
    row('At most this many rows', limit),
  );
  body.append(tbl);
  const syncTable = () => { tbl.hidden = !tableOn.box.checked; };
  tableOn.box.onchange = syncTable;
  syncTable();

  let chosen;
  let table = null;
  for (;;) {
    const got = await dialog({ title: 'Send to Present', body, wide: true, ok: 'Make slide' });
    if (!got) return;
    chosen = picks.filter((p) => p.box.checked);
    table = null;
    if (chosen.length > (each.value === 'each' ? MAX_SLIDES : MAX_CHARTS)) {
      toast(each.value === 'each' ? `Pick at most ${MAX_SLIDES} plots.` : `Pick at most ${MAX_CHARTS} plots for one slide, or choose one slide for each plot.`, 'error');
      continue;
    }
    if (tableOn.box.checked) {
      const cols = colChecks.filter((c) => c.box.checked).map((c) => c.name);
      if (!cols.length) {
        toast('Pick at least one column for the table.', 'error');
        continue;
      }
      const max = Math.max(1, Math.min(40, Number(limit.value) || 15));
      try {
        const res = await client.call('tableRows', { source: source.value, columns: cols, where: where.value, limit: max });
        if (!res.total) {
          toast('No rows match, so the table would be empty. Change the rows or the formula.', 'error');
          continue;
        }
        if (res.total > res.rows.length) toast(`The table shows the first ${res.rows.length} of ${res.total.toLocaleString()} matching rows.`);
        table = res;
      } catch (err) {
        toast(`Row formula: ${err.message}`, 'error');
        continue;
      }
      Object.assign(last, { source: source.value, where: where.value, columns: cols, limit: max });
    }
    if (!chosen.length && !table) {
      toast('Pick at least one plot or add a table.', 'error');
      continue;
    }
    break;
  }
  last.theme = themes.read();
  last.table = tableOn.box.checked;
  last.each = each.value === 'each' && chosen.length > 1;

  // With a slide for each plot, the table gets a slide of its own at the end.
  const plan = planSlide({ count: last.each ? 1 : chosen.length, table: last.each ? null : table });
  const cellFor = (i) => plan.cells[last.each ? 0 : i];
  const charts = [];
  const start = st.page;
  setLoading('Making the slide…');
  try {
    for (const pi of [...new Set(chosen.map((p) => p.page))]) {
      if (pi !== st.page) showPage(pi);
      const views = chosen.filter((p) => p.page === pi).map((p) => p.view);
      await Promise.all(views.map((v) => v.fetch()));
      await frame();
      await frame();
      for (const v of views) {
        const cell = cellFor(charts.length);
        const blob = await v.toPng(3, cell.image.w, cell.image.h);
        charts.push({ src: await dataUrl(blob), caption: v.spec.title || autoTitle(v.spec) });
      }
    }
  } catch (err) {
    toast(err.message || String(err), 'error');
    return;
  } finally {
    if (st.page !== start) {
      showPage(start);
      refreshPlots();
    }
    setLoading(null);
  }
  const title = titleInput.value.trim() || base;
  // A chart on a slide of its own takes its own title, without the caption above it.
  const slides = last.each
    ? [
      ...charts.map((c) => buildSlide({ title: c.caption || title, plan, charts: [{ ...c, caption: '' }] })),
      ...(table ? [buildSlide({ title, plan: planSlide({ count: 0, table }), charts: [], table })] : []),
    ]
    : [buildSlide({ title, plan, charts, table })];
  const res = await window.office.newWith({ kind: 'deck', title, theme: last.theme, slides });
  if (res?.error) toast(res.error, 'error');
  else toast(`Opened ${slides.length === 1 ? 'the slide' : `${slides.length} slides`} in Present. Save as .pptx from File › Save As.`);
}
