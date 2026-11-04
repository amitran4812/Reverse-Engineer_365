// Projects on the start screen: a list of projects, and a project's page with
// its files on the left and a Claude chat that reads all of them on the right.

import { icon } from '../shared/icons.js';
import { dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { ClaudePane } from '../shared/claude-pane.js';
import { newProjectDialog, preparePdfs } from '../shared/projects.js';
import { MAKE } from './make.js';

const KIND_ICON = { pdf: 'pdf', document: 'appDocs', spreadsheet: 'appSheets', presentation: 'appSlides', image: 'imageFile', latex: 'texFile', text: 'file', other: 'file', folder: 'folder' };

const SYSTEM = [
  'You are Claude, built into Work, a desktop suite with Write (documents), Plot (spreadsheets), Present (presentations) and Read (PDFs).',
  'The user keeps the files for one piece of work together in a project: research papers, drafts, LaTeX sources, data, slides. You have all of them.',
  'Answer from the files: summarize, compare, find where something is said, draft text, check a LaTeX draft against the papers, and so on. Name the files (and pages or sections when you can) you draw on.',
  'Answer in Markdown. For LaTeX, give code in ```latex blocks; for BibTeX, ```bibtex.',
].join('\n');

const QUICK = [
  { label: 'What’s in this project', icon: 'summarize', prompt: 'Give me an overview of this project: what each file is (one line each, grouped sensibly), what the work is about, and what seems to be in progress or missing.' },
  { label: 'Compare the papers', icon: 'dataTables', prompt: 'Compare the research papers in this project in a table: paper, question, method, data, main findings, limitations. Then a short paragraph on where they agree and disagree.' },
  { label: 'Literature review', icon: 'appDocs', prompt: 'Write a literature review (kind "document") from the papers in this project, with themes as headings and the papers cited by author and year:' },
  { label: 'Make a deck', icon: 'appSlides', prompt: 'Make a presentation (kind "presentation") of this project:' },
];

function size(n) {
  if (!n) return '';
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const when = (t) => (t ? new Date(t).toLocaleDateString() : '');

export async function projectsList(main, openProject) {
  main.append(h('h1', '', 'Projects'));
  main.append(h('p', 'muted pj-lead', 'Keep the files for one piece of work together: papers, notes, data, a LaTeX project. Claude reads all of them when you chat in the project, and you can add files any time, including ones you made earlier.'));
  const bar = h('div', 'pj-bar');
  const make = h('button', 'btn primary', `${icon('plus', 16)}<span>New project</span>`);
  make.onclick = async () => {
    const p = await newProjectDialog(dialog);
    if (p) openProject(p.id);
  };
  bar.append(make);
  main.append(bar);
  const list = await window.office.projects.list();
  const grid = h('div', 'pj-grid');
  if (!list.length) grid.append(h('div', 'bs-empty', 'No projects yet. Make one, then add your papers, drafts and data to it.'));
  for (const p of list) {
    const card = h('button', 'pj-card', `${icon('project', 28)}<b>${escapeHtml(p.name)}</b><span>${p.items} item${p.items === 1 ? '' : 's'} · ${when(p.updated)}</span>${p.instructions ? `<small>${escapeHtml(p.instructions.slice(0, 140))}</small>` : ''}`);
    card.onclick = () => openProject(p.id);
    grid.append(card);
  }
  main.append(grid);
}

// The project page. Returns nothing; draws into main.
export async function projectPage(main, id, { back, panes }) {
  let p = await window.office.projects.get(id);
  if (p?.error) {
    toast(p.error, 'error');
    return back();
  }
  main.classList.add('chat');
  const page = h('div', 'pj-page');
  const side = h('section', 'pj-side');
  const chatHost = h('div', 'home-claude pj-chat');
  page.append(side, chatHost);
  main.append(page);

  // One conversation per project for as long as the window is open.
  let pane = panes.get(id);
  if (pane) chatHost.replaceWith(pane.host);
  else {
    pane = new ClaudePane(chatHost, {
      shell: { root: chatHost },
      intro: `Ask anything about “${p.name}”. I read every file in the project with each message, so I can summarize, compare, find things and help you write.`,
      placeholder: 'Ask about the files in this project…',
      system: SYSTEM,
      project: { id, name: p.name },
      fixedProject: true,
      quick: QUICK.map((q) => (/kind "document"/.test(q.prompt) ? { ...MAKE.doc, label: q.label, icon: q.icon, prompt: q.prompt, input: null } : /kind "presentation"/.test(q.prompt) ? { ...MAKE.deck, label: q.label, icon: q.icon, prompt: q.prompt, input: null } : q)),
      actions: (text) => [{ label: 'Open in Write', icon: 'appDocs', once: false, run: () => window.office.newWith({ kind: 'document', title: p.name, markdown: text, summary: '', sheets: [], slides: [], theme: 'paper' }) }],
    });
    panes.set(id, pane);
  }

  const reload = async () => {
    p = await window.office.projects.get(id);
    if (p?.error) return toast(p.error, 'error');
    pane.setProject({ id, name: p.name });
    draw();
  };

  const draw = () => {
    side.innerHTML = '';
    const top = h('div', 'pj-top');
    const backBtn = h('button', 'pj-back', `${icon('back', 18)}<span>Projects</span>`);
    backBtn.onclick = back;
    top.append(backBtn);
    const title = h('div', 'pj-title', `${icon('project', 24)}<h1>${escapeHtml(p.name)}</h1>`);
    const rename = h('button', 'cp-icon', icon('textbox', 16));
    rename.title = 'Rename';
    rename.onclick = async () => {
      const got = await dialog({ title: 'Rename project', fields: [{ name: 'name', label: 'Name', value: p.name }], ok: 'Rename' });
      if (got?.name?.trim()) {
        await window.office.projects.update(id, { name: got.name });
        reload();
      }
    };
    title.append(rename);
    side.append(top, title);

    const about = h('label', 'pj-about');
    about.append(h('span', '', 'What this project is about (Claude reads this first)'));
    const ta = h('textarea');
    ta.rows = 3;
    ta.placeholder = 'For example: My thesis on … These are the papers I cite; main.tex is my draft. Use British spelling.';
    ta.value = p.instructions || '';
    ta.onchange = async () => {
      await window.office.projects.update(id, { instructions: ta.value });
      p.instructions = ta.value;
      toast('Saved');
    };
    about.append(ta);
    side.append(about);

    const tools = h('div', 'pj-tools');
    const add = (label, ico, folder, tip) => {
      const b = h('button', 'btn', `${icon(ico, 16)}<span>${label}</span>`);
      b.title = tip;
      b.onclick = async () => {
        const res = await window.office.projects.addDialog(id, folder);
        if (res?.error) toast(res.error, 'error');
        else if (res.added.length) {
          toast(`Added ${res.added.length === 1 ? res.added[0].name : `${res.added.length} items`}`);
          await reload();
          readPdfs();
        }
      };
      return b;
    };
    tools.append(
      add('Add files', 'plus', false, 'Copy files into the project: papers, documents, data, pictures, anything'),
      add('Add folder', 'folderOpen', true, 'Link a folder, such as a LaTeX project: Claude reads the files in it as they are now'),
    );
    const more = h('button', 'cp-icon', icon('chevronDown', 16));
    more.title = 'More';
    more.onclick = async () => {
      const got = await dialog({
        title: 'Project options',
        fields: [{ name: 'more', label: 'How much Claude reads', type: 'select', value: p.more ? 'large' : 'standard', options: [{ value: 'standard', label: 'Standard (about 150k tokens of text)' }, { value: 'large', label: 'Large (about 600k tokens, for 1M-token models)' }] }],
        ok: 'Save',
      });
      if (got) {
        await window.office.projects.update(id, { more: got.more === 'large' });
        reload();
      }
    };
    const reveal = h('button', 'cp-icon', icon('folder', 16));
    reveal.title = 'Show the project’s files folder';
    reveal.onclick = () => window.office.projects.reveal(id);
    const del = h('button', 'cp-icon', icon('trash', 16));
    del.title = 'Delete project';
    del.onclick = async () => {
      const ok = await dialog({ title: `Delete “${p.name}”?`, body: '<p>Files copied into the project are deleted with it. Linked files and folders stay where they are.</p>', ok: 'Delete' });
      if (!ok) return;
      await window.office.projects.remove(id);
      panes.delete(id);
      back();
    };
    tools.append(h('div', 'pj-fill'), reveal, more, del);
    side.append(tools);

    const files = h('div', 'pj-files');
    const byItem = new Map();
    for (const f of p.files) {
      if (!byItem.has(f.item)) byItem.set(f.item, []);
      byItem.get(f.item).push(f);
    }
    if (!p.items.length) files.append(h('div', 'pj-drop-hint', `${icon('upload', 28)}<b>Drop files here</b><span>or use Add files. PDFs, Word, Excel, slides, LaTeX, pictures, code and text all work.</span>`));
    for (const it of p.items) {
      const list = byItem.get(it.id) || [];
      if (it.type === 'folder') {
        const head = h('div', 'pj-folder', `${icon('folder', 18)}<b>${escapeHtml(it.name)}</b><span>${list[0]?.missing ? 'folder not found' : `${list.length} file${list.length === 1 ? '' : 's'} · linked`}</span>`);
        head.title = it.path;
        head.append(removeBtn(it));
        files.append(head);
        for (const f of list.filter((x) => !x.missing)) files.append(fileRow(f, null, true));
      } else {
        for (const f of list) files.append(fileRow(f, it));
      }
    }
    side.append(files);
    const total = p.files.filter((f) => !f.missing && f.kind !== 'folder').length;
    side.append(h('div', 'pj-foot muted', `${total} file${total === 1 ? '' : 's'} · Claude reads ${p.more ? 'up to about 600k' : 'up to about 150k'} tokens of text from them`));
  };

  function removeBtn(it) {
    const x = h('button', 'cp-icon pj-x', icon('close', 14));
    x.title = it.type === 'file' ? 'Remove from the project (deletes the copy)' : 'Remove from the project (the original stays)';
    x.onclick = async (e) => {
      e.stopPropagation();
      await window.office.projects.removeItem(id, it.id);
      reload();
    };
    return x;
  }

  function fileRow(f, it, nested = false) {
    const status = f.missing ? 'missing' : f.kind === 'pdf' && !f.hasText ? 'not read yet' : it?.type === 'link' ? 'linked' : '';
    const row = h('div', `pj-file${nested ? ' nested' : ''}${f.missing ? ' missing' : ''}`, `${icon(KIND_ICON[f.kind] || 'file', 18)}<div><b>${escapeHtml(nested ? f.rel.split('/').slice(1).join('/') : f.name)}</b><span>${[size(f.size), when(f.modified), status].filter(Boolean).join(' · ')}</span></div>`);
    row.title = f.path;
    row.tabIndex = 0;
    row.ondblclick = () => !f.missing && window.office.projects.openFile(f.path);
    row.onkeydown = (e) => e.key === 'Enter' && row.ondblclick();
    const actions = h('div', 'pj-file-actions');
    if (!f.missing) {
      const open = h('button', 'cp-icon', icon('open', 14));
      open.title = 'Open';
      open.onclick = () => window.office.projects.openFile(f.path);
      const show = h('button', 'cp-icon', icon('folderOpen', 14));
      show.title = 'Show in folder';
      show.onclick = () => window.office.projects.reveal(id, f.path);
      actions.append(open, show);
    }
    if (it) actions.append(removeBtn(it));
    row.append(actions);
    return row;
  }

  // PDFs are read to text in the background so the first question is quick.
  let reading = false;
  async function readPdfs() {
    if (reading) return;
    reading = true;
    const foot = () => side.querySelector('.pj-foot');
    try {
      const n = await preparePdfs(id, (done, total) => {
        if (total && foot()) foot().textContent = `Reading PDFs for Claude… ${done} of ${total}`;
      });
      if (n) await reload();
    } finally {
      reading = false;
    }
  }

  page.addEventListener('dragover', (e) => {
    if ([...(e.dataTransfer?.types || [])].includes('Files') && side.contains(e.target)) {
      e.preventDefault();
      side.classList.add('pj-dropping');
    }
  });
  side.addEventListener('dragleave', (e) => {
    if (!side.contains(e.relatedTarget)) side.classList.remove('pj-dropping');
  });
  side.addEventListener('drop', async (e) => {
    side.classList.remove('pj-dropping');
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    e.stopPropagation();
    const res = await window.office.projects.addFiles(id, e.dataTransfer.files);
    if (res?.error) return toast(res.error, 'error');
    if (res.added.length) toast(`Added ${res.added.length === 1 ? res.added[0].name : `${res.added.length} items`}`);
    await reload();
    readPdfs();
  });

  draw();
  readPdfs();
}
