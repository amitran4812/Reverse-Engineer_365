// Font picker shared by every app: the fonts Work ships, the fonts installed
// on this computer, and the ones used lately, searchable, each shown in its
// own face.

import fontData from '../../common/fonts.js';

export const { BUNDLED, COMMON, GROUPS, firstFamily, fontStack } = fontData;

const RECENT_KEY = 'recentFonts';
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

export function recentFonts() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]').filter((f) => typeof f === 'string').slice(0, 8);
  } catch {
    return [];
  }
}

export function useFont(name) {
  const n = firstFamily(name);
  if (!n) return;
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify([n, ...recentFonts().filter((f) => f.toLowerCase() !== n.toLowerCase())].slice(0, 8)));
  } catch {}
}

// The computer's font families. Reading them needs a click, so the picker
// asks when it opens and keeps the answer.
let installed = null;
export async function installedFonts() {
  if (installed) return installed;
  try {
    const list = await window.queryLocalFonts();
    const names = [...new Set(list.map((f) => f.family).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    if (names.length) installed = names;
  } catch {}
  return installed || [];
}

// Waits for a font's files so canvas drawing uses it.
export async function loadFont(name, size = 32) {
  try {
    await document.fonts.load(`${size}px ${fontStack(name)}`);
  } catch {}
}

// The picker list. pick(name) gets the chosen family; filter limits the
// sections (e.g. to monospace for a code editor).
export function fontMenu(pick, { current = '', filter = null, sample = null } = {}) {
  const wrap = el('div', 'font-menu');
  const search = el('input', 'font-search');
  search.placeholder = 'Search fonts, or type any font name';
  search.spellcheck = false;
  const list = el('div', 'font-list');
  wrap.append(search, list);
  const ok = (name, group) => !filter || filter(name, group);
  let local = [];
  const sections = () => {
    const shipped = new Set(BUNDLED.map((f) => f.family.toLowerCase()));
    const own = (local.length ? local : COMMON).filter((n) => !shipped.has(n.toLowerCase()));
    return [
      ['Recently used', recentFonts().map((n) => [n, null])],
      ...GROUPS.map(([g, label]) => [`${label} · included`, BUNDLED.filter((f) => f.group === g).map((f) => [f.family, g])]),
      [local.length ? 'On this computer' : 'Common fonts', own.map((n) => [n, null])],
    ];
  };
  const choose = (name) => {
    const n = name.trim();
    if (!n) return;
    useFont(n);
    pick(n);
  };
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    list.innerHTML = '';
    let first = null;
    for (const [title, items] of sections()) {
      const shown = items.filter(([n, g]) => ok(n, g) && (!q || n.toLowerCase().includes(q)));
      if (!shown.length) continue;
      list.append(el('div', 'font-head', title));
      for (const [n] of shown) {
        const b = el('button', `font-item${n.toLowerCase() === current.toLowerCase() ? ' on' : ''}`);
        const face = el('span', 'font-face', sample || n);
        face.style.fontFamily = fontStack(n);
        b.append(face);
        if (sample) b.append(el('small', 'font-name', n));
        b.title = n;
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => choose(n);
        list.append(b);
        first ||= n;
      }
    }
    if (q && !first) list.append(el('div', 'font-empty', `Press Enter to use “${search.value.trim()}”`));
    return first;
  };
  search.oninput = draw;
  search.onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const q = search.value.trim();
    if (!q) return;
    const exact = sections().flatMap(([, items]) => items).find(([n]) => n.toLowerCase() === q.toLowerCase());
    choose(exact ? exact[0] : draw() || q);
  };
  draw();
  installedFonts().then((names) => {
    if (!names.length) return;
    local = names;
    draw();
  });
  setTimeout(() => search.focus(), 0);
  return wrap;
}
