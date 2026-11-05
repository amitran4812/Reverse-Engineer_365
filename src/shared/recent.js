// Recent files, in every app: the File screen's Recent section, the title bar's
// Recent button and the start screen all draw rows from here. Files opened from
// a cloud drive reopen from their cached copy (see main/main.js openPath).

import { icon } from './icons.js';
import { popup, closePopup } from './ribbon.js';
import recent from '../../common/recent.js';

const { VIEWS, filterRecent, nameOf, placeOf, whenOf } = recent;

const MARKS = {
  docs: { mark: 'appDocs', accent: '#2f5aa8' },
  notes: { mark: 'notes', accent: '#2f5aa8' },
  latex: { mark: 'texFile', accent: '#2f5aa8' },
  sheets: { mark: 'appSheets', accent: '#1b7a4b' },
  slides: { mark: 'appSlides', accent: '#c2532d' },
  pdf: { mark: 'appRead', accent: '#0f7b87' },
};
const CLOUD_ICON = { google: 'cloudGoogle', onedrive: 'cloudOne' };

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// One row per file. extra(row, entry) lets a caller add its own button.
export function recentRows(items, { onOpen, onChange, extra, compact = false, empty } = {}) {
  const list = el('div', `bs-recent${compact ? ' compact' : ''}`);
  if (!items.length) list.append(el('div', 'bs-empty', esc(empty || 'Files you open or save show up here, including ones from Google Drive and OneDrive.')));
  for (const r of items) {
    const m = MARKS[r.kind] || MARKS[r.app] || MARKS.docs;
    const where = r.cloud ? `${icon(CLOUD_ICON[r.cloud.provider] || 'cloud', 13)}${esc(placeOf(r))}` : esc(placeOf(r));
    const row = el('button', `bs-recent-row${r.pinned ? ' pinned' : ''}`, `${icon(m.mark, compact ? 18 : 22)}<div><b>${esc(nameOf(r))}</b><span>${where}</span></div><time>${esc(whenOf(r.at))}</time>`);
    row.title = r.cloud ? `${nameOf(r)} (${r.cloud.label || 'cloud'}): opens the copy on this computer and checks for a newer one` : r.path;
    row.style.setProperty('--accent', m.accent);
    row.onclick = () => {
      onOpen?.(r);
      window.office.openPath(r.path);
    };
    if (!compact) {
      const tools = el('span', 'bs-recent-tools');
      const pin = el('span', 'bs-recent-tool', icon('pin', 15));
      pin.title = r.pinned ? 'Unpin' : 'Pin to the top of Recent';
      pin.classList.toggle('on', Boolean(r.pinned));
      const drop = el('span', 'bs-recent-tool', icon('close', 13));
      drop.title = 'Remove from Recent';
      for (const [b, patch] of [[pin, { pinned: !r.pinned }], [drop, null]]) {
        b.setAttribute('role', 'button');
        b.onclick = async (e) => {
          e.stopPropagation();
          await window.office.editRecent(r.path, patch);
          onChange?.();
        };
      }
      tools.append(pin, drop);
      row.querySelector('time').before(tools);
    }
    extra?.(row, r);
    list.append(row);
  }
  return list;
}

// Recent with a filter per app (and Write's Notes and LaTeX modes) and a search box.
export async function recentSection({ view = 'all', onOpen, extra, limit = 0 } = {}) {
  const wrap = el('div', 'recent-section');
  const bar = el('div', 'recent-bar');
  const chips = el('div', 'recent-chips');
  const search = el('input', 'recent-search');
  search.placeholder = 'Search recent files';
  search.spellcheck = false;
  bar.append(chips, search);
  let items = await window.office.recent();
  let current = view;
  let list = el('div');
  wrap.append(bar, list);
  const draw = () => {
    chips.innerHTML = '';
    for (const v of VIEWS) {
      const n = v.id === 'all' ? items.length : filterRecent(items, v.id).length;
      if (v.id !== 'all' && v.id !== current && !n) continue;
      const c = el('button', `recent-chip${v.id === current ? ' active' : ''}`, `${esc(v.label)}<small>${n}</small>`);
      c.type = 'button';
      c.onclick = () => {
        current = v.id;
        draw();
      };
      chips.append(c);
    }
    let shown = filterRecent(items, current, search.value);
    if (limit) shown = shown.slice(0, limit);
    const label = VIEWS.find((v) => v.id === current)?.label;
    const next = recentRows(shown, {
      onOpen,
      extra,
      empty: search.value.trim() ? 'No recent files match.' : current === 'all' ? null : `No recent ${label} files yet. Files you open or save in ${label} show up here.`,
      onChange: async () => {
        items = await window.office.recent();
        draw();
      },
    });
    list.replaceWith(next);
    list = next;
  };
  search.oninput = draw;
  draw();
  return wrap;
}

// Title bar button: this app's latest files, one click away.
export function recentButton({ view, openAll }) {
  const btn = el('button', 'qa-btn rb-dropdown-trigger', icon('clock', 16));
  btn.title = 'Recent files';
  btn.onmousedown = (e) => e.preventDefault();
  btn.onclick = async () => {
    if (document.querySelector('.rb-popup.recent-pop')) return closePopup();
    const all = await window.office.recent();
    const v = typeof view === 'function' ? view() : view;
    const mine = filterRecent(all, v);
    const label = VIEWS.find((x) => x.id === v)?.label || 'All';
    const box = el('div', 'recent-pop-body');
    box.append(el('div', 'recent-pop-head', mine.length ? `Recent in ${esc(label)}` : 'Recent'));
    box.append(recentRows((mine.length ? mine : filterRecent(all)).slice(0, 8), { compact: true, onOpen: closePopup }));
    const more = el('button', 'recent-pop-more', `${icon('clock', 14)}<span>All recent files…</span>`);
    more.onclick = () => {
      closePopup();
      openAll();
    };
    box.append(more);
    popup(btn, box).classList.add('recent-pop');
  };
  return btn;
}
