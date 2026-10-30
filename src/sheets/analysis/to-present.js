// Send to Present: pick charts from any page of the analysis, a Present
// template and an optional table of rows, and open them as a new
// presentation with everything on one slide.

import { dialog, escapeHtml, h, toast } from '../../shared/shell.js';
import { themePicker } from '../../shared/themes.js';
import { PLOT_TYPES, autoTitle } from './plot.js';
import { buildSlide, planSlide } from './slide.js';

const MAX_CHARTS = 12;
const last = { theme: 'paper', table: false, source: 'filtered', where: '', columns: null, limit: 15 };

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
    if (chosen.length > MAX_CHARTS) {
      toast(`Pick at most ${MAX_CHARTS} plots for one slide.`, 'error');
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

  const plan = planSlide({ count: chosen.length, table });
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
        const cell = plan.cells[charts.length];
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
  const slide = buildSlide({ title, plan, charts, table });
  const res = await window.office.newWith({ kind: 'deck', title, theme: last.theme, slides: [slide] });
  if (res?.error) toast(res.error, 'error');
  else toast(`Opened the slide in Present. Save it as .pptx from File › Save As.`);
}
