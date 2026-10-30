// Present's slide templates. Plot and Write use them too when they make slides.
import { escapeHtml, h } from './shell.js';

export const THEMES = {
  paper: { label: 'Paper', bg: '#ffffff', text: '#2b2f36', title: '#1f2328', accent: '#c2532d', font: 'Calibri' },
  slate: { label: 'Slate', bg: '#f1f3f5', text: '#343a40', title: '#1c64c4', accent: '#1c64c4', font: 'Segoe UI' },
  midnight: { label: 'Midnight', bg: '#15213b', text: '#d9e1f2', title: '#ffffff', accent: '#4cc9f0', font: 'Segoe UI' },
  sunrise: { label: 'Sunrise', bg: '#fff4e6', text: '#4a2c17', title: '#b7410e', accent: '#f08c00', font: 'Georgia' },
  forest: { label: 'Forest', bg: '#1f3d2b', text: '#e2efe6', title: '#ffffff', accent: '#9bd35a', font: 'Trebuchet MS' },
  berry: { label: 'Berry', bg: '#ffffff', text: '#2b2d42', title: '#6a2bb8', accent: '#6a2bb8', font: 'Verdana', band: true },
};

// A row of template thumbnails to pick from; read() gives the chosen id.
export function themePicker(value) {
  const wrap = h('div', 'theme-picks');
  let current = THEMES[value] ? value : 'paper';
  for (const [id, t] of Object.entries(THEMES)) {
    const b = h('button', `theme-pick${id === current ? ' on' : ''}`, `
      <span class="theme-art" style="background:${t.bg}">${t.band ? `<i class="band" style="background:${t.accent}"></i>` : ''}<i class="t" style="background:${t.title}"></i><i class="a" style="background:${t.accent}"></i><i class="b" style="background:${t.text}"></i><i class="b2" style="background:${t.text}"></i></span>
      <span>${escapeHtml(t.label)}</span>`);
    b.type = 'button';
    b.title = `${t.label} template`;
    b.onclick = () => {
      current = id;
      for (const x of wrap.children) x.classList.toggle('on', x === b);
    };
    wrap.append(b);
  }
  wrap.read = () => current;
  return wrap;
}
