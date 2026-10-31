// Start screen: create a new file, start with Claude, or reopen a recent file.
import '../shared/ui.css';
import './home.css';
import { icon } from '../shared/icons.js';
import { APPS, escapeHtml, h, latexTile, latexZipTile, notesTile, settingsForm, startApp } from '../shared/shell.js';
import { CLOUDS, cloudSettings, openFromCloud } from '../shared/cloud.js';
import { ClaudePane } from '../shared/claude-pane.js';
import { MAKE, SYSTEM } from './make.js';
import { accountSwitcher, accountsSection } from '../shared/accounts.js';
import { aiSettings } from '../shared/ai-settings.js';
import { updateSettings, watchUpdates } from '../shared/updates.js';
import { openCiteDialog } from '../shared/cite.js';

const info = await window.office.launchInfo();
watchUpdates();
document.documentElement.dataset.platform = info.platform;
document.documentElement.style.setProperty('--accent', '#3b4a6b');

const root = h('div', 'home');
root.innerHTML = `
  <header class="titlebar"><div class="titlebar-mark">${icon('appSuite', 20)}</div><div class="titlebar-title">Work${info.account.count > 1 ? ` · ${escapeHtml(info.account.name)}` : ''}</div></header>
  <div class="home-body">
    <nav class="home-nav">
      <button data-view="start" class="active">${icon('home', 18)}<span>Home</span></button>
      <button data-view="claude">${icon('sparkle', 18)}<span>Claude</span></button>
      <button data-view="open">${icon('open', 18)}<span>Open</span></button>
      <button data-view="options">${icon('settings', 18)}<span>Options</span></button>
      <div class="home-version">Version ${escapeHtml(info.version)}</div>
    </nav>
    <main class="home-main"></main>
  </div>`;
document.body.append(root);
const main = root.querySelector('.home-main');
root.querySelector('.home-version').before(accountSwitcher(info.account, () => show('options').then(() => main.querySelector('.acct-settings')?.scrollIntoView())));

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

// One Claude conversation for the window, kept while switching views.
const claudeHost = h('div', 'home-claude');
let pane = null;
function claudePane() {
  pane ||= new ClaudePane(claudeHost, {
    shell: { root: claudeHost },
    intro: 'Tell me what you need and I’ll make it: a presentation, a spreadsheet or a document, opened in the right app. Attach PDFs, images, Word or Excel files and I’ll work from them.',
    placeholder: 'Make a 10-slide pitch deck for… / Build a budget for… / Summarize the attached PDF…',
    system: SYSTEM,
    quick: [MAKE.deck, MAKE.sheet, MAKE.doc, MAKE.notes],
    defaultQuick: MAKE.auto,
  });
  return pane;
}

function askBox() {
  const box = h('form', 'home-ask');
  box.innerHTML = `${icon('sparkle', 22)}<input placeholder="Ask Claude to make a deck, a spreadsheet or a document…"><button class="btn primary" type="submit">Make it</button>`;
  box.onsubmit = (e) => {
    e.preventDefault();
    const text = box.querySelector('input').value.trim();
    show('claude');
    if (text) claudePane().ask(text);
  };
  return box;
}

// Cite a paper: pick a PDF or Word file, or search by DOI or title, and copy its reference.
function citeTile() {
  const t = h('button', 'bs-tile bs-tile-cite', `<div class="bs-tile-preview">${icon('cite', 44)}</div><span>Cite a paper</span><small>APA, IEEE, BibTeX…</small>`);
  t.title = 'Get the reference for a paper from its PDF, DOI, arXiv id or title, ready to copy';
  t.onclick = () => openCiteDialog();
  return t;
}

async function show(view) {
  root.querySelectorAll('.home-nav button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  main.innerHTML = '';
  main.classList.toggle('chat', view === 'claude');
  if (view === 'claude') {
    claudePane();
    main.append(claudeHost);
    claudeHost.querySelector('textarea')?.focus();
    return;
  }
  if (view === 'start') {
    main.append(h('h1', '', greeting()), askBox());
    const tiles = h('div', 'bs-tiles');
    for (const [id, m] of Object.entries(APPS)) {
      const t = h('button', `bs-tile bs-tile-${id}`, `<div class="bs-tile-preview">${icon(m.mark, 44)}</div><span>${m.newLabel}</span><small>${m.title}</small>`);
      t.onclick = () => startApp(id);
      tiles.append(t);
    }
    tiles.append(notesTile(44), latexTile(44), latexZipTile(44));
    tiles.append(citeTile());
    main.append(h('h2', '', 'New'), tiles);
    main.append(h('h2', '', 'Recent'), await recent());
  } else if (view === 'open') {
    main.append(h('h1', '', 'Open'));
    const browse = h('button', 'bs-browse', `${icon('open', 28)}<span>Browse for a file…</span>`);
    browse.onclick = () => window.office.openDialog(null);
    const places = h('div', 'bs-places');
    for (const cl of CLOUDS) {
      const b = h('button', 'bs-browse', `${icon(cl.icon, 28)}<span>${cl.label}</span>`);
      b.onclick = () => openFromCloud(cl.id, null);
      places.append(b);
    }
    const texFolder = h('button', 'bs-browse', `${icon('texFile', 28)}<span>LaTeX project folder…</span>`);
    texFolder.onclick = () => window.office.latex.openFolder();
    const texZip = h('button', 'bs-browse', `${icon('zip', 28)}<span>LaTeX project from a .zip…</span>`);
    texZip.onclick = () => window.office.latex.openZip();
    places.append(texFolder, texZip);
    main.append(browse, places, h('p', 'muted', 'Opens .docx, .html, .md, .txt and .tex in Write, .xlsx and .csv in Plot, .reaslides in Present, and PDFs in Read. From Google Drive, Google Sheets and Docs open too.'));
    main.append(h('h2', '', 'Recent'), await recent());
  } else if (view === 'options') {
    main.append(h('h1', '', 'Options'), await settingsForm(() => show('options')), await aiSettings(() => pane?.loadSettings()), await cloudSettings(), await accountsSection(), await updateSettings());
  }
}

root.querySelectorAll('.home-nav button[data-view]').forEach((b) => {
  b.onclick = () => show(b.dataset.view);
});
show('start');
