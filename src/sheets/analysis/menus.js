// Right-click menus for the analysis workspace, and its keyboard shortcuts.

import { icon } from '../../shared/icons.js';
import { dialog, escapeHtml, h } from '../../shared/shell.js';
import { closePopup, popup } from '../../shared/ribbon.js';

// items: { label, icon, run, enabled, kbd, note } | '-' | { head } |
// { label, icon, items: [...] } (a flyout) | { node } (any element).
export function buildMenu(items) {
  const m = h('div', 'rb-menu an-ctx');
  for (const it of items) {
    if (!it) continue;
    if (it === '-') {
      if (m.lastChild && !m.lastChild.classList.contains('rb-menu-sep')) m.append(h('div', 'rb-menu-sep'));
      continue;
    }
    if (it.head) {
      m.append(h('div', 'an-ctx-head', escapeHtml(it.head)));
      continue;
    }
    if (it.node) {
      m.append(it.node);
      continue;
    }
    const b = h('button', 'rb-menu-item', `${it.icon ? icon(it.icon, 16) : '<span class="ico"></span>'}<span>${escapeHtml(it.label)}${it.note ? `<small>${escapeHtml(it.note)}</small>` : ''}</span>${it.kbd ? `<kbd>${escapeHtml(kbd(it.kbd))}</kbd>` : ''}${it.items ? icon('chevronDown', 10) : ''}`);
    b.disabled = it.enabled === false;
    if (it.items) {
      const wrap = h('div', 'an-sub');
      const fly = buildMenu(it.items);
      fly.classList.add('an-flyout');
      b.type = 'button';
      b.onclick = (e) => {
        e.stopPropagation();
        wrap.classList.toggle('open');
      };
      wrap.append(b, fly);
      wrap.onmouseenter = () => {
        const r = wrap.getBoundingClientRect();
        wrap.classList.toggle('left', r.right + 230 > window.innerWidth);
        fly.style.maxHeight = `${Math.max(160, window.innerHeight - r.top - 12)}px`;
      };
      m.append(wrap);
      continue;
    }
    b.onclick = () => {
      closePopup();
      it.run();
    };
    m.append(b);
  }
  while (m.lastChild?.classList.contains('rb-menu-sep')) m.lastChild.remove();
  return m;
}

// Opens a menu at a point on the screen, kept inside the window.
export function menuAt(x, y, items) {
  const anchor = h('div', 'an-anchor');
  Object.assign(anchor.style, { position: 'fixed', left: `${x}px`, top: `${y}px`, width: '0', height: '0' });
  document.body.append(anchor);
  const p = popup(anchor, buildMenu(items));
  anchor.remove();
  p.style.bottom = '';
  p.style.maxHeight = '';
  p.style.top = `${y}px`;
  const r = p.getBoundingClientRect();
  if (r.bottom > window.innerHeight - 6) p.style.top = `${Math.max(6, window.innerHeight - r.height - 6)}px`;
  if (r.right > window.innerWidth - 6) p.style.left = `${Math.max(6, window.innerWidth - r.width - 6)}px`;
  p.style.maxHeight = `${window.innerHeight - 12}px`;
  return p;
}

const mod = navigator.platform?.startsWith('Mac') ? '⌘' : 'Ctrl';
export const kbd = (s) => s.replaceAll('Ctrl', mod);

// The analysis shortcuts, as shown in the list. Most follow the usual
// analytics-tool keys; the handler lives in the workspace.
export const SHORTCUTS = [
  { group: 'Pages and visualizations', items: [
    ['Ctrl+D', 'Copy the selected visualization onto a new page after this one'],
    ['Ctrl+Shift+D', 'Duplicate this page'],
    ['Ctrl+N', 'New page'],
    ['Ctrl+Tab / Ctrl+Shift+Tab', 'Next / previous page'],
    ['Ctrl+→ / Ctrl+←', 'Next / previous page'],
    ['Alt+Enter', 'Properties of the selected visualization'],
    ['Shift+F10', 'Menu of the selected visualization'],
    ['Ctrl+Shift+C', 'Copy the selected visualization as a picture'],
    ['Ctrl+P', 'Save the selected visualization as PDF'],
  ] },
  { group: 'New visualization', items: [
    ['Ctrl+1', 'Show or hide the details table'],
    ['Ctrl+2', 'Cross table'],
    ['Ctrl+3', 'Bar chart'],
    ['Ctrl+5', 'Line chart'],
    ['Ctrl+6', 'Two-axis line chart'],
    ['Ctrl+7', 'Pie chart'],
    ['Ctrl+8', 'Scatter plot'],
    ['Ctrl+9', 'Histogram'],
    ['Ctrl+0', 'Box plot'],
    ['Ctrl+Shift+3', 'Heat map'],
  ] },
  { group: 'Marking and filtering', items: [
    ['Ctrl+A', 'Mark all rows that pass the filters'],
    ['Ctrl+E or Esc', 'Unmark all'],
    ['Ctrl+I', 'Invert the marking'],
    ['Ctrl+M', 'Filter to the marked rows'],
    ['Ctrl+Shift+M or Delete', 'Filter out the marked rows'],
    ['Ctrl+R', 'Reset all filters'],
    ['Ctrl+F', 'Find a filter'],
    ['Ctrl+C', 'Copy the marked rows as text'],
  ] },
  { group: 'In a visualization', items: [
    ['Drag', 'Mark rows (Ctrl adds, Alt removes)'],
    ['Right-click', 'Visualization menu'],
    ['Right-drag or middle-drag', 'Pan'],
    ['Mouse wheel', 'Zoom (Shift: X only)'],
    ['Double-click', 'Show all data again'],
  ] },
  { group: 'File', items: [
    ['Ctrl+O', 'Open a data file'],
    ['Ctrl+S', 'Save the analysis'],
    ['F1', 'This list of shortcuts'],
  ] },
];

export function showShortcuts() {
  const body = h('div', 'an-keys-list');
  for (const g of SHORTCUTS) {
    body.append(h('b', '', escapeHtml(g.group)));
    const t = h('table', 'an-keys-table');
    t.innerHTML = g.items.map(([k, what]) => `<tr><td>${k.split(' / ').map((part) => part.split(' or ').map((x) => `<kbd>${escapeHtml(kbd(x))}</kbd>`).join(' or ')).join(' / ')}</td><td>${escapeHtml(what)}</td></tr>`).join('');
    body.append(t);
  }
  return dialog({ title: 'Keyboard shortcuts', body, wide: true, ok: 'Close', cancel: null });
}
