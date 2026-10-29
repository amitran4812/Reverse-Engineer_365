// Start screen: create a new file, start with Claude, or reopen a recent file.
import '../shared/ui.css';
import './home.css';
import { icon } from '../shared/icons.js';
import { APPS, escapeHtml, h, settingsForm } from '../shared/shell.js';

const info = await window.office.launchInfo();
document.documentElement.dataset.platform = info.platform;
document.documentElement.style.setProperty('--accent', '#3b4a6b');

const root = h('div', 'home');
root.innerHTML = `
  <header class="titlebar"><div class="titlebar-mark">${icon('appSuite', 20)}</div><div class="titlebar-title">Rea Office</div></header>
  <div class="home-body">
    <nav class="home-nav">
      <button data-view="start" class="active">${icon('home', 18)}<span>Home</span></button>
      <button data-view="open">${icon('open', 18)}<span>Open</span></button>
      <button data-view="options">${icon('settings', 18)}<span>Options</span></button>
      <div class="home-version">Version ${escapeHtml(info.version)}</div>
    </nav>
    <main class="home-main"></main>
  </div>`;
document.body.append(root);
const main = root.querySelector('.home-main');

function greeting() {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
}

async function recent() {
  const list = h('div', 'bs-recent');
  const items = await window.office.recent();
  if (!items.length) list.append(h('div', 'bs-empty', 'Nothing here yet. Files you open or save will show up here.'));
  for (const r of items) {
    const m = APPS[r.app] || APPS.docs;
    const name = r.path.split(/[\\/]/).pop();
    const row = h('button', 'bs-recent-row', `${icon(m.mark, 22)}<div><b>${escapeHtml(name)}</b><span>${escapeHtml(r.path)}</span></div><time>${new Date(r.at).toLocaleDateString()}</time>`);
    row.style.setProperty('--accent', m.accent);
    row.onclick = () => window.office.openPath(r.path);
    list.append(row);
  }
  return list;
}

async function show(view) {
  root.querySelectorAll('.home-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  main.innerHTML = '';
  if (view === 'start') {
    main.append(h('h1', '', greeting()));
    const tiles = h('div', 'bs-tiles');
    for (const [id, m] of Object.entries(APPS)) {
      const t = h('button', `bs-tile bs-tile-${id}`, `<div class="bs-tile-preview">${icon(m.mark, 44)}</div><span>${m.newLabel}</span><small>${m.title}</small>`);
      t.onclick = () => window.office.newWindow(id);
      tiles.append(t);
    }
    main.append(h('h2', '', 'New'), tiles);
    main.append(h('h2', '', 'Recent'), await recent());
  } else if (view === 'open') {
    main.append(h('h1', '', 'Open'));
    const browse = h('button', 'bs-browse', `${icon('open', 28)}<span>Browse for a file…</span>`);
    browse.onclick = () => window.office.openDialog(null);
    main.append(browse, h('p', 'muted', 'Opens .docx, .html, .md and .txt in Docs, .xlsx and .csv in Sheets, and .reaslides in Slides.'));
    main.append(h('h2', '', 'Recent'), await recent());
  } else if (view === 'options') {
    main.append(h('h1', '', 'Options'), await settingsForm());
  }
}

root.querySelectorAll('.home-nav button').forEach((b) => {
  b.onclick = () => show(b.dataset.view);
});
show('start');
