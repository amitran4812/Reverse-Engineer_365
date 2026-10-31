// Light, dark or system theme. Main sets Electron's theme source, so every
// window gets the same prefers-color-scheme; dark.css holds the dark colors.

import { icon } from './icons.js';
import { closePopup, popup } from './ribbon.js';
import { h } from './shell.js';

export const THEME_CHOICES = [
  { id: 'system', label: 'System default', detail: 'Follows your computer’s light or dark setting.', icon: 'themeSystem' },
  { id: 'light', label: 'Light', detail: 'Light ribbon, panes and pages.', icon: 'themeLight' },
  { id: 'dark', label: 'Dark', detail: 'Easy on the eyes at night.', icon: 'themeDark' },
];

const query = window.matchMedia('(prefers-color-scheme: dark)');
export const isDark = () => query.matches;

// Charts and other canvas drawings repaint when the theme changes.
export function onThemeChange(cb) {
  query.addEventListener('change', () => cb(query.matches));
}

let current = 'system';
const listeners = new Set();
async function load() {
  current = (await window.office.settings.get()).theme || 'system';
  return current;
}
async function setTheme(id) {
  current = (await window.office.settings.set({ theme: id })).theme || id;
  for (const l of listeners) l(current);
}

// The title bar button: a sun, moon or screen, with the three choices.
export function themeButton() {
  const btn = h('button', 'titlebar-theme');
  const draw = () => {
    const c = THEME_CHOICES.find((t) => t.id === current) || THEME_CHOICES[0];
    btn.innerHTML = icon(c.icon, 16);
    btn.title = `Theme: ${c.label}`;
  };
  load().then(draw);
  listeners.add(draw);
  // Another window may have changed it.
  onThemeChange(() => load().then(draw));
  btn.onclick = async () => {
    await load();
    draw();
    const menu = h('div', 'rb-menu theme-menu');
    for (const t of THEME_CHOICES) {
      const item = h('button', `rb-menu-item${t.id === current ? ' on' : ''}`, `${icon(t.icon, 16)}<span>${t.label}</span>${t.id === current ? '<b class="theme-check">✓</b>' : ''}`);
      item.onclick = () => {
        closePopup();
        setTheme(t.id);
      };
      menu.append(item);
    }
    popup(btn, menu);
  };
  return btn;
}

// The Options section.
export async function themeSettings() {
  const wrap = h('div', 'cloud-settings theme-settings');
  const draw = () => {
    wrap.innerHTML = `<h2>${icon('themeDark', 18)} Appearance</h2><p class="muted">Choose how Write, Plot, Present and the rest of Work look. Your slides, printouts and exported files keep their own colors.</p>`;
    const row = h('div', 'theme-choices');
    for (const t of THEME_CHOICES) {
      const b = h('button', `theme-choice theme-choice-${t.id}${t.id === current ? ' on' : ''}`, `<span class="theme-sample"><i></i><i></i><i></i></span><span class="theme-choice-label">${icon(t.icon, 16)}<b>${t.label}</b></span><small>${t.detail}</small>`);
      b.type = 'button';
      b.onclick = () => setTheme(t.id);
      row.append(b);
    }
    wrap.append(row);
  };
  await load();
  draw();
  const redraw = () => (wrap.isConnected ? draw() : listeners.delete(redraw));
  listeners.add(redraw);
  return wrap;
}
