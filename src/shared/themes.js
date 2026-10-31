// Present's slide templates. Plot and Write use them too when they make slides.
// Besides the built-in ones, users can upload their own PowerPoint templates;
// those live in the account's Templates folder and are listed here as well.
import { dialog, escapeHtml, h, toast } from './shell.js';

export const THEMES = {
  paper: { label: 'Paper', bg: '#ffffff', text: '#2b2f36', title: '#1f2328', accent: '#c2532d', font: 'Calibri' },
  slate: { label: 'Slate', bg: '#f1f3f5', text: '#343a40', title: '#1c64c4', accent: '#1c64c4', font: 'Segoe UI' },
  midnight: { label: 'Midnight', bg: '#15213b', text: '#d9e1f2', title: '#ffffff', accent: '#4cc9f0', font: 'Segoe UI' },
  sunrise: { label: 'Sunrise', bg: '#fff4e6', text: '#4a2c17', title: '#b7410e', accent: '#f08c00', font: 'Georgia' },
  forest: { label: 'Forest', bg: '#1f3d2b', text: '#e2efe6', title: '#ffffff', accent: '#9bd35a', font: 'Trebuchet MS' },
  berry: { label: 'Berry', bg: '#ffffff', text: '#2b2d42', title: '#6a2bb8', accent: '#6a2bb8', font: 'Verdana', band: true },
};

// Uploaded templates by id, filled by loadTemplates().
export const UPLOADED = {};

export async function loadTemplates() {
  const got = (await window.office.templates?.list().catch(() => [])) || [];
  for (const id of Object.keys(UPLOADED)) delete UPLOADED[id];
  for (const t of Array.isArray(got) ? got : []) UPLOADED[t.id] = t;
  return UPLOADED;
}

export const allThemes = () => ({ ...THEMES, ...UPLOADED });

// Opens the file picker; returns the templates that were added.
export async function uploadTemplates() {
  const res = await window.office.templates.upload();
  if (res?.error) {
    toast(res.error, 'error');
    return [];
  }
  for (const f of res.failed || []) toast(`${f.name}: ${f.error}`, 'error');
  for (const t of res.added || []) UPLOADED[t.id] = t;
  if (res.added?.length) toast(res.added.length === 1 ? `Added the template “${res.added[0].label}”.` : `Added ${res.added.length} templates.`);
  return res.added || [];
}

export async function removeTemplate(id) {
  const t = UPLOADED[id];
  if (!t) return false;
  const ok = await dialog({ title: 'Remove template', body: `<p>Remove “${escapeHtml(t.label)}” from your templates? Presentations already made with it keep their look.</p>`, ok: 'Remove' });
  if (!ok) return false;
  const res = await window.office.templates.remove(id);
  if (res?.error) {
    toast(res.error, 'error');
    return false;
  }
  delete UPLOADED[id];
  return true;
}

// CSS background for a slide in this template.
export function slideBackground(t, color) {
  if (color || !t.bgImage) return color || t.bg;
  return `${t.bg} url("${t.bgImage}") center / 100% 100% no-repeat`;
}

// A small preview of a template: the background, the master's pictures and
// boxes, then lines for the title and text.
export function themeArt(t) {
  const pct = (v, of) => `${((v / of) * 100).toFixed(2)}%`;
  const decor = (t.decor || []).map((d) => {
    const pos = `left:${pct(d.x, 960)};top:${pct(d.y, 540)};width:${pct(d.w, 960)};height:${pct(d.h, 540)}`;
    return d.type === 'image'
      ? `<img class="deco" src="${escapeHtml(d.src)}" style="${pos}" alt="">`
      : `<i class="deco" style="${pos};background:${d.fill};border-radius:${d.shape === 'ellipse' ? '50%' : '0'}"></i>`;
  }).join('');
  const back = escapeHtml(slideBackground(t));
  return `<span class="theme-art" style="background:${back}">${decor}${t.band ? `<i class="band" style="background:${t.accent}"></i>` : ''}<i class="t" style="background:${t.title}"></i><i class="a" style="background:${t.accent}"></i><i class="b" style="background:${t.text}"></i><i class="b2" style="background:${t.text}"></i></span>`;
}

// A row of template thumbnails to pick from, with the user's uploaded
// templates and an Upload tile; read() gives the chosen id.
export function themePicker(value) {
  const wrap = h('div', 'theme-picks');
  let current = value;

  const draw = () => {
    const themes = allThemes();
    if (!themes[current]) current = THEMES[value] ? value : 'paper';
    wrap.innerHTML = '';
    for (const [id, t] of Object.entries(themes)) {
      const b = h('button', `theme-pick${id === current ? ' on' : ''}`, `${themeArt(t)}<span class="theme-name">${escapeHtml(t.label)}</span>`);
      b.type = 'button';
      b.title = t.custom ? `${t.label} (uploaded from ${t.source || 'a PowerPoint file'})` : `${t.label} template`;
      b.onclick = () => {
        current = id;
        for (const x of wrap.querySelectorAll('.theme-pick')) x.classList.toggle('on', x === b);
      };
      if (t.custom) {
        const x = h('span', 'theme-remove', '×');
        x.title = 'Remove this template';
        x.onclick = async (e) => {
          e.stopPropagation();
          if (await removeTemplate(id)) draw();
        };
        b.append(x);
      }
      wrap.append(b);
    }
    const up = h('button', 'theme-pick theme-upload', `<span class="theme-art">+</span><span>Upload…</span>`);
    up.type = 'button';
    up.title = 'Upload a PowerPoint template (.pptx or .potx). It is kept for next time.';
    up.onclick = async () => {
      const added = await uploadTemplates();
      if (added.length) current = added[added.length - 1].id;
      draw();
    };
    wrap.append(up);
  };
  draw();
  loadTemplates().then(draw);
  wrap.read = () => current;
  return wrap;
}
