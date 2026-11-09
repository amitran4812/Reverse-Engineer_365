// Version history for LaTeX projects: every saved version, what changed in
// it, side by side with the version before or with the project now, and
// restoring one file or the whole version.

import diff from '../../common/diff.js';
import { dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

const { lineDiff, wordChanges } = diff;
const CONTEXT = 3;

const REASONS = { save: 'Saved', open: 'Opened', 'before-restore': 'Before restoring', restore: 'Restored', named: 'Named version', git: 'Synced with Git' };

function dayLabel(t) {
  const d = new Date(t);
  const today = new Date();
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

const time = (t) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

function summaryText(s) {
  const n = s.added.length + s.removed.length + s.changed.length;
  if (!n) return 'No changes';
  const parts = [];
  if (s.changed.length) parts.push(s.changed.length === 1 ? s.changed[0] : `${s.changed.length} files changed`);
  if (s.added.length) parts.push(s.added.length === 1 ? `${s.added[0]} added` : `${s.added.length} added`);
  if (s.removed.length) parts.push(s.removed.length === 1 ? `${s.removed[0]} deleted` : `${s.removed.length} deleted`);
  return parts.join(' · ');
}

// Lines of one changed line pair with the changed words marked.
function markWords(a, b) {
  const ch = wordChanges(a, b);
  const paint = (text, ranges) => {
    let out = '';
    let at = 0;
    for (const [from, to] of ranges) {
      out += escapeHtml(text.slice(at, from)) + `<mark>${escapeHtml(text.slice(from, to))}</mark>`;
      at = to;
    }
    return out + escapeHtml(text.slice(at));
  };
  return [paint(a, ch.map((c) => [c.aFrom, c.aTo])), paint(b, ch.map((c) => [c.from, c.to]))];
}

export function renderDiff(a, b) {
  const box = h('div', 'hx-diff');
  if (a === b) {
    box.append(h('div', 'hx-note', 'No differences.'));
    return box;
  }
  const hunks = lineDiff(a, b);
  const row = (cls, aNo, bNo, html) => box.append(h('div', `hx-line ${cls}`, `<span class="hx-no">${aNo ?? ''}</span><span class="hx-no">${bNo ?? ''}</span><span class="hx-sign">${cls === 'del' ? '−' : cls === 'add' ? '+' : ''}</span><code>${html || '&nbsp;'}</code>`));
  hunks.forEach((hk, i) => {
    if (hk.type === 'same') {
      const n = hk.lines.length;
      const first = i === 0;
      const last = i === hunks.length - 1;
      const head = first ? 0 : CONTEXT;
      const tail = last ? 0 : CONTEXT;
      if (n <= head + tail + 2) {
        hk.lines.forEach((l, j) => row('same', hk.aLine + j, hk.bLine + j, escapeHtml(l)));
        return;
      }
      for (let j = 0; j < head; j++) row('same', hk.aLine + j, hk.bLine + j, escapeHtml(hk.lines[j]));
      box.append(h('div', 'hx-gap', `⋯ ${n - head - tail} unchanged line${n - head - tail === 1 ? '' : 's'}`));
      for (let j = n - tail; j < n; j++) row('same', hk.aLine + j, hk.bLine + j, escapeHtml(hk.lines[j]));
      return;
    }
    if (hk.type === 'del' && hunks[i + 1]?.type === 'add') {
      const next = hunks[i + 1];
      const pairs = Math.min(hk.lines.length, next.lines.length);
      hk.marked = [];
      next.marked = [];
      for (let j = 0; j < pairs; j++) {
        const [x, y] = markWords(hk.lines[j], next.lines[j]);
        hk.marked[j] = x;
        next.marked[j] = y;
      }
    }
    hk.lines.forEach((l, j) => row(hk.type, hk.type === 'del' ? hk.aLine + j : null, hk.type === 'add' ? hk.bLine + j : null, hk.marked?.[j] ?? escapeHtml(l)));
  });
  return box;
}

export async function openHistory({ api, host, beforeOpen, onRestored }) {
  await beforeOpen?.();
  const hist = api.history;
  const el = h('div', 'hx');
  el.innerHTML = `
    <div class="hx-side">
      <div class="hx-side-head"><b>${icon('history', 16)} History</b></div>
      <div class="hx-side-tools"></div>
      <div class="hx-list"></div>
    </div>
    <div class="hx-main">
      <div class="hx-bar"></div>
      <div class="hx-files"></div>
      <div class="hx-view"></div>
    </div>`;
  const list = el.querySelector('.hx-list');
  const bar = el.querySelector('.hx-bar');
  const filesEl = el.querySelector('.hx-files');
  const viewEl = el.querySelector('.hx-view');
  const sideTools = el.querySelector('.hx-side-tools');
  host.append(el);

  let versions = [];
  let picked = null;
  let against = 'previous';
  let diffs = [];
  let file = null;
  let onlyNamed = false;

  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !document.querySelector('.modal-back')) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const nameBtn = h('button', 'btn', `${icon('label', 14)} Name this version`);
  nameBtn.title = 'Keep the project as it is now as a named version, such as “Sent to supervisor”';
  nameBtn.onclick = async () => {
    const v = await dialog({ title: 'Name this version', fields: [{ name: 'label', label: 'Name', value: '' }], ok: 'Save version' });
    if (!v?.label?.trim()) return;
    await beforeOpen?.();
    const res = await hist.snapshot({ label: v.label.trim(), reason: 'named' });
    if (res?.error) return toast(res.error, 'error');
    toast(`Saved the version “${v.label.trim()}”`);
    await load(res.id);
  };
  const filter = h('label', 'hx-filter', '<input type="checkbox"> Named versions only');
  filter.querySelector('input').onchange = (e) => {
    onlyNamed = e.target.checked;
    drawList();
  };
  sideTools.append(nameBtn, filter);

  async function load(select) {
    const res = await hist.list();
    if (res?.error) return toast(res.error, 'error');
    versions = res;
    drawList();
    const want = versions.find((v) => v.id === select) || versions[0];
    if (want) pick(want);
    else {
      bar.innerHTML = '';
      viewEl.innerHTML = '';
      viewEl.append(h('div', 'hx-note', 'No versions yet. Each time you save, Work keeps a version here.'));
    }
  }

  function drawList() {
    list.innerHTML = '';
    let day = '';
    const shown = versions.filter((v) => !onlyNamed || v.label);
    shown.forEach((v) => {
      const d = dayLabel(v.time);
      if (d !== day) {
        day = d;
        list.append(h('div', 'hx-day', escapeHtml(d)));
      }
      const row = h('button', `hx-item${picked?.id === v.id ? ' on' : ''}`, `
        <div class="hx-item-top"><span>${time(v.time)}</span>${v.label ? `<span class="hx-label">${escapeHtml(v.label)}</span>` : `<span class="hx-reason">${escapeHtml(REASONS[v.reason] || 'Saved')}</span>`}</div>
        <div class="hx-sum">${escapeHtml(summaryText(v.summary))}</div>`);
      row.onclick = () => pick(v);
      list.append(row);
    });
    if (!shown.length) list.append(h('div', 'tex-empty-small', onlyNamed ? 'No named versions yet.' : 'No versions yet.'));
  }

  async function pick(v) {
    picked = v;
    drawList();
    drawBar();
    viewEl.innerHTML = '<div class="hx-note">Loading…</div>';
    const res = await hist.compare(v.id, against);
    if (res?.error) return toast(res.error, 'error');
    diffs = res;
    file = diffs.find((d) => d.path === file?.path) || diffs.find((d) => /\.tex$/i.test(d.path)) || diffs[0] || null;
    drawFiles();
    drawView();
  }

  function drawBar() {
    bar.innerHTML = '';
    const v = picked;
    const title = h('div', 'hx-title', `<b>${v.label ? escapeHtml(v.label) : `${dayLabel(v.time)}, ${time(v.time)}`}</b><span>${v.files.length} file${v.files.length === 1 ? '' : 's'}</span>`);
    const seg = h('div', 'hx-seg');
    for (const [id, label] of [['previous', 'Changes in this version'], ['current', 'Compare with now']]) {
      const b = h('button', against === id ? 'on' : '', label);
      b.onclick = () => {
        against = id;
        pick(picked);
      };
      seg.append(b);
    }
    const restoreFile = h('button', 'btn', `${icon('undo', 14)} Restore this file`);
    restoreFile.onclick = () => restore([file?.path].filter(Boolean));
    restoreFile.disabled = !file || !v.files.includes(file?.path);
    const restoreAll = h('button', 'btn primary', `${icon('history', 14)} Restore this version`);
    restoreAll.onclick = () => restore(null);
    const more = h('button', 'tex-tool', icon('label', 16));
    more.title = 'Rename this version';
    more.onclick = async () => {
      const r = await dialog({ title: 'Name this version', fields: [{ name: 'label', label: 'Name', value: v.label || '' }], ok: 'Save' });
      if (!r) return;
      const res = await hist.rename(v.id, r.label);
      if (res?.error) return toast(res.error, 'error');
      await load(v.id);
    };
    const zip = h('button', 'tex-tool', icon('zip', 16));
    zip.title = 'Download this version as a .zip';
    zip.onclick = async () => {
      const res = await hist.exportZip(v.id, v.label || new Date(v.time).toISOString().slice(0, 16).replace('T', ' ').replace(':', '.'));
      if (res?.error) return toast(res.error, 'error');
      if (res?.name) toast(`Saved ${res.name}`);
    };
    const x = h('button', 'tex-tool', icon('close', 16));
    x.title = 'Close History (Esc)';
    x.onclick = close;
    bar.append(title, seg, h('span', 'tex-grow'), more, zip, restoreFile, restoreAll, x);
    picked.restoreFileBtn = restoreFile;
  }

  function drawFiles() {
    filesEl.innerHTML = '';
    if (!diffs.length) return;
    for (const d of diffs) {
      const b = h('button', `hx-file${d === file ? ' on' : ''}`, `<span class="hx-st ${d.status.split(' ')[0]}">${escapeHtml(d.status)}</span>${escapeHtml(d.path)}`);
      b.onclick = () => {
        file = d;
        drawFiles();
        drawView();
        if (picked.restoreFileBtn) picked.restoreFileBtn.disabled = !picked.files.includes(d.path);
      };
      filesEl.append(b);
    }
  }

  function drawView() {
    viewEl.innerHTML = '';
    if (!diffs.length) {
      viewEl.append(h('div', 'hx-note', against === 'current' ? 'The project now is the same as this version.' : 'Nothing changed in this version.'));
      return;
    }
    if (!file) return;
    if (file.binary) {
      viewEl.append(h('div', 'hx-note', `${escapeHtml(file.path)} isn’t text, so it can’t be compared here. It was ${escapeHtml(file.status)}.`));
      return;
    }
    const legend = against === 'current' ? '<span class="del">− this version</span><span class="add">+ now</span>' : '<span class="del">− before</span><span class="add">+ this version</span>';
    viewEl.append(h('div', 'hx-legend', legend), renderDiff(file.a || '', file.b || ''));
  }

  async function restore(paths) {
    const what = paths ? paths[0] : 'every file in this version';
    const ok = await dialog({ title: paths ? `Restore ${paths[0]}?` : 'Restore this version?', body: `<p>${escapeHtml(what)} will go back to how ${paths ? 'it was' : 'they were'} in this version. The project as it is now is kept in History first, so you can undo this.</p>${paths ? '' : '<p class="muted">Files added after this version stay in the project.</p>'}`, ok: 'Restore' });
    if (!ok) return;
    const res = await hist.restore(picked.id, paths);
    if (res?.error) return toast(res.error, 'error');
    toast(`Restored ${res.restored.length} file${res.restored.length === 1 ? '' : 's'}`);
    await onRestored?.(res.restored);
    await load();
  }

  await load();
  return { close };
}
