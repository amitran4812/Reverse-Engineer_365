// Ribbon toolbar: tabs -> groups -> controls, built from plain config objects.
//
// Control types:
//   big     large icon over a label           { type:'big', icon, label, run }
//   small   small icon + label (stack in cols) { type:'small', icon, label, run }
//   icon    icon-only button                  { type:'icon', icon, title, run }
//   text    text glyph button (B / I / U)     { type:'text', text, style, title, run }
//   stack   column of small controls          { type:'stack', items:[...] }
//   row     row of icon/text controls         { type:'row', items:[...] }
//   select  dropdown                          { type:'select', options:[{value,label}], value(), change(v), width }
//   color   colour picker                     { type:'color', icon, title, pick(color) }
//   menu    button with a dropdown list       { type:'menu', icon, label, big, items:[{label, run, icon}] }
//   gallery tiles (styles, themes, layouts)   { type:'gallery', items:[{label, html, run, active()}] }
// Any control may define active() and enabled() for refresh().

import { icon } from './icons.js';

export const PALETTE = [
  '#000000', '#434343', '#666666', '#999999', '#cccccc', '#ffffff',
  '#c0392b', '#e67e22', '#f1c40f', '#27ae60', '#16a085', '#2980b9',
  '#8e44ad', '#d35400', '#2c3e50', '#1f5fa6', '#1b7a4b', '#b83b5e',
  '#f8d7da', '#fde2c8', '#fff3bf', '#d3f9d8', '#d0ebff', '#e5dbff',
];

const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

let openPopup = null;
function closePopup() {
  openPopup?.remove();
  openPopup = null;
}
document.addEventListener('mousedown', (e) => {
  if (openPopup && !openPopup.contains(e.target) && !e.target.closest('.rb-dropdown-trigger')) closePopup();
});
window.addEventListener('blur', closePopup);

export function popup(anchor, content) {
  closePopup();
  const r = anchor.getBoundingClientRect();
  const p = el('div', 'rb-popup');
  p.append(content);
  document.body.append(p);
  const w = p.offsetWidth;
  p.style.left = `${Math.max(6, Math.min(r.left, window.innerWidth - w - 6))}px`;
  // Keep the popup inside the window: open upward when there is more room
  // above the anchor, and cap the height so the rest scrolls.
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const up = p.offsetHeight > below && above > below;
  p.style.maxHeight = `${Math.max(120, up ? above : below)}px`;
  if (up) p.style.bottom = `${window.innerHeight - r.top + 2}px`;
  else p.style.top = `${Math.min(r.bottom + 2, window.innerHeight - 128)}px`;
  openPopup = p;
  return p;
}
export { closePopup };

export function colorGrid(pick, { allowNone = false } = {}) {
  const wrap = el('div', 'rb-colors');
  if (allowNone) {
    const none = el('button', 'rb-color-none', 'No color');
    none.onclick = () => {
      closePopup();
      pick(null);
    };
    wrap.append(none);
  }
  const grid = el('div', 'rb-color-grid');
  for (const c of PALETTE) {
    const b = el('button', 'rb-swatch');
    b.style.background = c;
    b.title = c;
    b.onclick = () => {
      closePopup();
      pick(c);
    };
    grid.append(b);
  }
  wrap.append(grid);
  const custom = el('label', 'rb-color-custom', 'More colors… <input type="color">');
  custom.querySelector('input').onchange = (e) => {
    closePopup();
    pick(e.target.value);
  };
  wrap.append(custom);
  return wrap;
}

export class Ribbon {
  constructor(host, { tabs, onFile, accent, onSelect }) {
    this.onSelect = onSelect;
    this.host = host;
    this.tabs = tabs;
    this.controls = [];
    this.lastColor = {};
    host.classList.add('ribbon');
    if (accent) host.style.setProperty('--accent', accent);

    this.tabBar = el('div', 'rb-tabs');
    const file = el('button', 'rb-tab rb-file', 'File');
    file.onclick = onFile;
    this.tabBar.append(file);
    this.panels = el('div', 'rb-panels');
    this.tabButtons = {};
    for (const t of tabs) {
      const b = el('button', `rb-tab${t.special ? ' rb-tab-special' : ''}`, t.special ? `${icon('sparkle', 14)}<span>${t.label}</span>` : t.label);
      b.dataset.tab = t.id;
      b.onclick = () => this.select(t.id);
      this.tabButtons[t.id] = b;
      this.tabBar.append(b);
      const panel = el('div', 'rb-panel');
      panel.dataset.tab = t.id;
      for (const g of t.groups) panel.append(this.group(g));
      this.panels.append(panel);
    }
    this.collapseBtn = el('button', 'rb-collapse', icon('chevronDown', 14));
    this.collapseBtn.title = 'Collapse the ribbon (Ctrl+F1)';
    this.collapseBtn.onclick = () => this.toggleCollapsed();
    this.tabBar.append(el('div', 'rb-spacer'), this.collapseBtn);
    host.append(this.tabBar, this.panels);
    this.select(tabs[0].id);
  }

  toggleCollapsed() {
    this.host.classList.toggle('collapsed');
  }

  select(id) {
    this.current = id;
    for (const [tid, b] of Object.entries(this.tabButtons)) b.classList.toggle('active', tid === id);
    for (const p of this.panels.children) p.classList.toggle('active', p.dataset.tab === id);
    if (this.host.classList.contains('collapsed')) this.host.classList.add('peek');
    this.refresh();
    this.onSelect?.(id);
  }

  group(g) {
    const box = el('div', 'rb-group');
    const body = el('div', 'rb-group-body');
    for (const item of g.items) body.append(this.control(item));
    box.append(body, el('div', 'rb-group-label', g.label));
    return box;
  }

  register(node, item) {
    if (item.active || item.enabled || item.value) this.controls.push({ node, item });
    return node;
  }

  button(item, cls, inner) {
    const b = el('button', `rb-btn ${cls}`, inner);
    b.title = item.title || item.label || '';
    if (item.shortcut) b.title += ` (${item.shortcut})`;
    b.onmousedown = (e) => e.preventDefault(); // keep focus/selection in the document
    b.onclick = (e) => item.run?.(e, b);
    return this.register(b, item);
  }

  control(item) {
    switch (item.type) {
      case 'big':
        return this.button(item, 'rb-big', `${icon(item.icon, 32)}<span>${item.label}</span>`);
      case 'small':
        return this.button(item, 'rb-small', `${icon(item.icon, 16)}<span>${item.label}</span>`);
      case 'icon':
        return this.button(item, 'rb-icon', icon(item.icon, 16));
      case 'text': {
        const b = this.button(item, 'rb-icon rb-text', `<span style="${item.style || ''}">${item.text}</span>`);
        return b;
      }
      case 'stack': {
        const s = el('div', 'rb-stack');
        item.items.forEach((i) => s.append(this.control(i)));
        return s;
      }
      case 'row': {
        const r = el('div', 'rb-row');
        item.items.forEach((i) => r.append(this.control(i)));
        return r;
      }
      case 'select': {
        const s = el('select', 'rb-select');
        s.title = item.title || '';
        if (item.width) s.style.width = `${item.width}px`;
        for (const o of item.options) {
          const opt = el('option', '', o.label);
          opt.value = o.value;
          if (o.style) opt.style.cssText = o.style;
          s.append(opt);
        }
        s.onchange = () => item.change(s.value);
        return this.register(s, item);
      }
      case 'color': {
        const wrap = el('div', 'rb-split');
        const main = el('button', 'rb-btn rb-icon', icon(item.icon, 16));
        main.title = item.title;
        const start = item.initial || '#c0392b';
        this.lastColor[item.title] = start;
        main.querySelector('.sw')?.setAttribute('fill', start);
        main.onmousedown = (e) => e.preventDefault();
        main.onclick = () => item.pick(this.lastColor[item.title]);
        const drop = el('button', 'rb-btn rb-drop rb-dropdown-trigger', icon('chevronDown', 10));
        drop.title = `${item.title} options`;
        drop.onmousedown = (e) => e.preventDefault();
        drop.onclick = () => popup(drop, colorGrid((c) => {
          if (c) {
            this.lastColor[item.title] = c;
            main.querySelector('.sw')?.setAttribute('fill', c);
          }
          item.pick(c);
        }, { allowNone: item.allowNone }));
        wrap.append(main, drop);
        return wrap;
      }
      case 'menu': {
        const cls = item.big ? 'rb-big rb-dropdown-trigger' : 'rb-small rb-dropdown-trigger';
        const inner = item.big ? `${icon(item.icon, 32)}<span>${item.label} ▾</span>` : `${icon(item.icon, 16)}<span>${item.label} ▾</span>`;
        const b = this.button({ ...item, run: null }, cls, inner);
        b.onclick = () => {
          const list = el('div', 'rb-menu');
          const items = typeof item.items === 'function' ? item.items() : item.items;
          for (const mi of items) {
            if (mi === '-') {
              list.append(el('div', 'rb-menu-sep'));
              continue;
            }
            const m = el('button', 'rb-menu-item', `${mi.icon ? icon(mi.icon, 16) : '<span class="ico"></span>'}<span>${mi.label}</span>`);
            if (mi.html) m.innerHTML = mi.html;
            m.onmousedown = (e) => e.preventDefault();
            m.onclick = () => {
              closePopup();
              mi.run();
            };
            list.append(m);
          }
          popup(b, list);
        };
        return b;
      }
      case 'gallery': {
        const g = el('div', 'rb-gallery');
        for (const gi of item.items) {
          const t = this.button(gi, 'rb-tile', gi.html);
          t.title = gi.label;
          g.append(t);
        }
        return g;
      }
      case 'sep':
        return el('div', 'rb-sep');
      default:
        return el('span', '', '?');
    }
  }

  refresh() {
    for (const { node, item } of this.controls) {
      if (item.active) node.classList.toggle('on', !!item.active());
      if (item.enabled) node.disabled = !item.enabled();
      if (item.value && document.activeElement !== node) {
        const v = item.value();
        if (v != null) node.value = v;
      }
    }
  }
}
