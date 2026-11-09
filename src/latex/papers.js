// Citing the papers of the Project this LaTeX project belongs to: every PDF in
// the Project is looked up once (DOI, arXiv id or title, through the Cite
// lookup) and kept, so citing it is one step. The picker also lists the .bib
// entries and My Library, like a reference manager's quick-cite bar.

import cite from '../../common/cite.js';
import { citeKeyFor, citedKeys } from '../../common/latex.js';
import { openCiteDialog } from '../shared/cite.js';
import { addToProject } from '../shared/projects.js';
import { dialog, escapeHtml, h, toast } from '../shared/shell.js';
import { icon } from '../shared/icons.js';

let reader = null;
function pdfReader() {
  const url = './pdftext.js';
  reader ||= import(url).catch((err) => {
    reader = null;
    throw err;
  });
  return reader;
}

const FIGURE_DIR = /(^|\/)(fig|figs|figures|images|img|imgs|pictures|plots|graphics)\//i;
const slash = (p) => String(p || '').replace(/\\/g, '/');

// host: { root, mainPath, index(), files(), texts(), addToBib(item, opts) -> key, insertCite(keys), shell }
export function projectPapers(host) {
  let projects = [];
  let papers = []; // { project, path, rel, name, key, ref, match, edited, busy, failed }
  let library = [];
  const listeners = new Set();
  const changed = () => listeners.forEach((fn) => fn());
  const queue = [];
  let running = 0;

  // PDFs inside the LaTeX folder that are its own output or its figures aren't papers.
  function isPaper(p) {
    const root = slash(host.root).replace(/\/$/, '');
    const path = slash(p.path);
    if (!path.startsWith(`${root}/`)) return true;
    const rel = path.slice(root.length + 1);
    if (FIGURE_DIR.test(rel)) return false;
    const base = rel.replace(/\.pdf$/i, '');
    if (host.files().some((f) => f.kind === 'tex' && f.path.replace(/\.tex$/i, '') === base)) return false;
    const graphics = new Set();
    for (const { text } of host.texts()) for (const m of text.matchAll(/\\(?:includegraphics|includepdf)\*?(?:\s*\[[^\]]*\])?\s*\{([^{}]+)\}/g)) graphics.add(m[1].trim().replace(/\.pdf$/i, ''));
    return !graphics.has(base);
  }

  async function load() {
    const seen = new Map();
    for (const file of [host.root, host.mainPath].filter(Boolean)) {
      for (const p of await window.office.projects.forPath(file)) seen.set(p.id, p);
    }
    projects = [...seen.values()];
    const next = [];
    for (const p of projects) {
      const list = await window.office.projects.papers(p.id);
      if (!Array.isArray(list)) continue;
      for (const f of list) {
        if (next.some((x) => x.path === f.path)) continue;
        // The same paper keeps its object, so a lookup under way still lands on it.
        const old = papers.find((x) => x.path === f.path && x.key === f.key);
        if (old) next.push(Object.assign(old, f, { project: p, ref: f.ref || old.ref, match: f.ref ? f.match : old.match }));
        else next.push({ ...f, project: p, busy: false, failed: false });
      }
    }
    papers = next.filter(isPaper);
    try {
      library = (await window.office.library.list()).items || [];
    } catch {
      library = [];
    }
    for (const p of papers) if (!p.ref && !p.busy && !p.failed) lookup(p);
    changed();
  }

  function lookup(p) {
    p.busy = true;
    return new Promise((resolve) => {
      queue.push({ p, resolve });
      pump();
    });
  }

  function pump() {
    while (running < 2 && queue.length) {
      const { p, resolve } = queue.shift();
      running++;
      resolveRef(p)
        .catch((err) => {
          console.warn('paper lookup', p.name, err);
          p.failed = true;
        })
        .finally(() => {
          p.busy = false;
          running--;
          changed();
          resolve(p);
          pump();
        });
    }
  }

  async function resolveRef(p) {
    const got = await window.office.projects.pdfBytes(p.project.id, p.path);
    if (got?.error) throw new Error(got.error);
    const { readPdf } = await pdfReader();
    const read = await readPdf(got.data, 2);
    const info = {};
    for (const [k, v] of Object.entries(read.info || {})) if (typeof v === 'string' && v.length < 2000) info[k] = v;
    const res = await window.office.cite.lookup({ text: read.text.slice(0, 30000), info, metadata: String(read.metadata || '').slice(0, 60000), fileName: p.name });
    if (res?.error) throw new Error(res.error);
    const item = res.items?.[0] || cite.fromFileInfo({ info, fileName: p.name });
    if (!item?.title) throw new Error('No title found.');
    p.ref = item;
    p.match = res.match || 'file';
    p.failed = false;
    await window.office.projects.saveRef(p.project.id, p.path, item, { match: p.match });
  }

  // The key a reference has in the .bib, or would get when cited.
  function keyOf(item) {
    return citeKeyFor(cite.bibKey(item), { doi: item.DOI, title: item.title, year: item.issued?.[0] }, host.index().bib);
  }

  async function refFor(p) {
    if (!p.ref) await (p.busy ? new Promise((r) => {
      const check = () => !p.busy && (listeners.delete(check), r());
      listeners.add(check);
    }) : lookup(p));
    if (!p.ref) throw new Error(`Couldn’t find the details of ${p.name}.`);
    return p.ref;
  }

  // Rows for the picker and for suggestions after \cite{.
  function rows() {
    const bib = host.index().bib;
    const used = new Set();
    const out = [];
    for (const p of papers) {
      const k = p.ref ? keyOf(p.ref) : null;
      if (k?.known) used.add(k.key);
      out.push({ source: 'project', paper: p, item: p.ref, key: k?.key || null, inBib: !!k?.known, title: p.ref?.title || p.name.replace(/\.pdf$/i, ''), who: who(p.ref), year: p.ref?.issued?.[0] || '', venue: p.ref?.['container-title'] || '' });
    }
    for (const b of bib) {
      if (used.has(b.key)) continue;
      used.add(b.key);
      out.push({ source: 'bib', key: b.key, inBib: true, title: tidy(b.title) || b.key, who: tidy(b.author).split(/ and /)[0].split(',')[0], year: b.year, venue: b.file });
    }
    for (const it of library) {
      const k = keyOf(it);
      if (used.has(k.key)) continue;
      used.add(k.key);
      out.push({ source: 'library', item: it, key: k.key, inBib: k.known, title: it.title, who: who(it), year: it.issued?.[0] || '', venue: it['container-title'] || '' });
    }
    return out;
  }

  // Makes sure the row's reference is in the .bib and returns its key.
  async function keyForRow(row) {
    if (row.source === 'bib') return row.key;
    const item = row.source === 'project' ? await refFor(row.paper) : row.item;
    return host.addToBib(item, { insert: false, quiet: true });
  }

  async function citeRows(list) {
    const keys = [];
    for (const r of list) {
      try {
        keys.push(await keyForRow(r));
      } catch (err) {
        toast(err.message || String(err), 'error');
      }
    }
    if (!keys.length) return;
    host.insertCite(keys);
    const added = list.filter((r) => !r.inBib).length;
    toast(`Cited ${keys.join(', ')}${added ? ` (${added} added to the .bib)` : ''}`);
  }

  async function addAll() {
    const todo = rows().filter((r) => r.source === 'project' && !r.inBib);
    let n = 0;
    for (const r of todo) {
      try {
        await keyForRow(r);
        n++;
      } catch (err) {
        toast(err.message || String(err), 'error');
      }
    }
    toast(n ? `Added ${n} paper${n === 1 ? '' : 's'} to the .bib` : 'Every paper in the project is already in the .bib');
  }

  async function editPaper(p) {
    const start = p.ref || cite.fromFileInfo({ fileName: p.name });
    let saved = null;
    await openCiteDialog({ item: { ...start }, fileName: p.name }, {
      style: 'bibtex',
      title: 'Paper details',
      actions: [{ label: 'Use these details', icon: 'check', run: (item) => (saved = item) }],
    });
    if (!saved) return;
    p.ref = saved;
    p.match = 'edited';
    p.edited = true;
    await window.office.projects.saveRef(p.project.id, p.path, saved, { match: 'edited', edited: true });
    changed();
  }

  // ---- Suggestions after \cite{ ----
  function suggestions() {
    return rows().filter((r) => r.source !== 'bib' && r.key && !r.inBib).map((r) => ({
      key: r.key,
      detail: `${[r.who, r.year].filter(Boolean).join(' ')} · ${r.source === 'project' ? 'paper in project' : 'My Library'}`,
      info: [r.title, r.venue, r.source === 'project' ? `Adds it to the .bib: ${r.paper.rel}` : 'Adds it to the .bib from My Library'].filter(Boolean).join('\n'),
      add: () => keyForRow(r).catch((err) => toast(err.message || String(err), 'error')),
    }));
  }

  // The project paper or reference a key stands for, for the hover card.
  function forKey(key) {
    return rows().find((r) => r.key === key) || null;
  }

  // ---- The picker ----
  function openPicker() {
    const back = h('div', 'modal-back');
    const box = h('div', 'modal wide tex-cite');
    const names = projects.map((p) => p.name);
    box.innerHTML = `
      <div class="modal-title">${icon('cite', 18)}<span>Cite</span><small class="tex-cite-proj"></small><button class="btn tex-cite-online" type="button" title="Find any paper by DOI, arXiv id, title or a PDF">${icon('find', 14)}<span>Find online…</span></button></div>
      <div class="tex-cite-bar">
        <input class="tex-cite-q" placeholder="Search by title, author, year or key" spellcheck="false">
        <select class="tex-cite-cmd" title="Citation command"></select>
      </div>
      <div class="tex-cite-rows" role="listbox"></div>
      <div class="modal-actions">
        <span class="muted tex-cite-hint">Enter cites the highlighted paper. Tick several to cite them together.</span>
        <span class="cite-grow"></span>
        <button class="btn primary tex-cite-go" type="button">Cite</button>
        <button class="btn tex-cite-close" type="button">Close</button>
      </div>`;
    back.append(box);
    document.body.append(back);
    const $ = (s) => box.querySelector(s);
    const input = $('.tex-cite-q');
    const list = $('.tex-cite-rows');
    const cmd = $('.tex-cite-cmd');
    for (const c of ['cite', 'citep', 'citet', 'parencite', 'textcite', 'autocite']) cmd.append(Object.assign(h('option', '', `\\${c}`), { value: c }));
    cmd.value = host.citeCommand();
    cmd.onchange = () => host.setCiteCommand(cmd.value);
    $('.tex-cite-proj').innerHTML = names.length ? `${icon('project', 12)} ${escapeHtml(names.join(', '))}` : '';
    const chosen = new Set();
    let active = 0;
    let shown = [];
    let cited = new Map();

    const label = (r) => `${r.source}:${r.paper?.path || r.key || r.title}`;
    const matches = (r, q) => !q || q.split(/\s+/).every((w) => `${r.title} ${r.who} ${r.year} ${r.venue} ${r.key || ''} ${r.paper?.name || ''}`.toLowerCase().includes(w));

    function draw() {
      const q = input.value.trim().toLowerCase();
      cited = new Map();
      for (const { text } of host.texts()) for (const [k, n] of citedKeys(text)) cited.set(k, (cited.get(k) || 0) + n);
      const all = rows();
      shown = all.filter((r) => matches(r, q));
      active = Math.min(active, Math.max(0, shown.length - 1));
      list.innerHTML = '';
      const sections = [
        ['project', projects.length ? `Papers in ${names.length === 1 ? `“${names[0]}”` : 'your projects'}` : 'Papers in a project'],
        ['bib', 'In your .bib'],
        ['library', 'My Library'],
      ];
      let i = 0;
      for (const [src, title] of sections) {
        const part = shown.filter((r) => r.source === src);
        const total = all.filter((r) => r.source === src).length;
        if (src === 'project') {
          const head = h('div', 'tex-cite-head', `<span>${escapeHtml(title)} <em>${total}</em></span>`);
          const busy = papers.filter((p) => p.busy).length;
          if (busy) head.append(h('span', 'tex-cite-busy', `<span class="cite-spin"></span>Finding the details of ${busy} paper${busy === 1 ? '' : 's'}…`));
          if (all.some((r) => r.source === 'project' && !r.inBib)) {
            const b = h('button', 'btn tex-cite-all', `${icon('bibFile', 13)}<span>Add all to .bib</span>`);
            b.type = 'button';
            b.onclick = async () => {
              b.disabled = true;
              await addAll();
              draw();
            };
            head.append(b);
          }
          list.append(head);
          if (!projects.length) {
            const empty = h('div', 'tex-cite-empty muted', 'This LaTeX project isn’t in a Project yet. Put it in a Project with your papers (PDFs), and every paper there can be cited from here in one step.');
            const add = h('button', 'btn', `${icon('project', 13)}<span>Add to a project…</span>`);
            add.type = 'button';
            add.onclick = async () => {
              const p = await addToProject(dialog, host.root, { name: `${host.root.split(/[\\/]/).pop()} (LaTeX project folder)` });
              if (p) await load();
            };
            empty.append(add);
            list.append(empty);
            continue;
          }
          if (!total) {
            list.append(h('div', 'tex-cite-empty muted', 'No PDFs in this project yet. Add papers on the project’s page in Home, and they show up here.'));
            continue;
          }
        } else {
          if (!total) continue;
          list.append(h('div', 'tex-cite-head', `<span>${escapeHtml(title)} <em>${total}</em></span>`));
        }
        if (!part.length) list.append(h('div', 'tex-cite-empty muted', 'None match.'));
        for (const r of part) list.append(rowEl(r, i++));
      }
      const n = chosen.size;
      $('.tex-cite-go').textContent = n > 1 ? `Cite ${n}` : 'Cite';
      $('.tex-cite-go').disabled = !shown.length;
      list.querySelector('.tex-cite-row.active')?.scrollIntoView({ block: 'nearest' });
    }

    function rowEl(r, i) {
      const row = h('div', `tex-cite-row${i === active ? ' active' : ''}${chosen.has(label(r)) ? ' on' : ''}`);
      row.setAttribute('role', 'option');
      const chk = h('input');
      chk.type = 'checkbox';
      chk.checked = chosen.has(label(r));
      chk.onclick = (e) => {
        e.stopPropagation();
        if (chk.checked) chosen.add(label(r));
        else chosen.delete(label(r));
        draw();
      };
      const p = r.paper;
      const meta = [r.who, r.year, r.venue].filter(Boolean).map((x) => escapeHtml(String(x))).join(' · ');
      const badges = [];
      if (p?.busy && !p.ref) badges.push('<span class="tex-cite-badge wait">Looking up…</span>');
      else if (p && !p.ref) badges.push('<span class="tex-cite-badge warn">Not found</span>');
      else if (p && (p.match === 'file' || p.match === 'search') && !p.edited) badges.push(`<span class="tex-cite-badge warn" title="${p.match === 'search' ? 'Matched by its title' : 'Built from the file’s own details'}: check it">Check details</span>`);
      if (r.key && cited.get(r.key)) badges.push(`<span class="tex-cite-badge ok">Cited ${cited.get(r.key)}×</span>`);
      else if (r.inBib) badges.push(`<span class="tex-cite-badge">In .bib</span>`);
      const info = h('div', 'tex-cite-info', `<b>${escapeHtml(r.title)}</b><span>${meta || (p ? escapeHtml(p.rel) : '')}</span>${r.key ? `<code>${escapeHtml(r.key)}</code>` : ''}`);
      const acts = h('div', 'tex-cite-acts', badges.join(''));
      if (p) {
        const open = h('button', 'btn icon-btn', icon('pdf', 14));
        open.type = 'button';
        open.title = `Open ${p.name}`;
        open.onclick = (e) => {
          e.stopPropagation();
          window.office.projects.openFile(p.path);
        };
        const edit = h('button', 'btn icon-btn', icon('pen', 14));
        edit.type = 'button';
        edit.title = 'Check or fix the details';
        edit.onclick = async (e) => {
          e.stopPropagation();
          await editPaper(p);
          draw();
        };
        acts.append(open, edit);
      }
      row.append(chk, info, acts);
      row.onmousemove = () => {
        if (active !== i) {
          active = i;
          list.querySelectorAll('.tex-cite-row').forEach((el, k) => el.classList.toggle('active', k === i));
        }
      };
      row.onclick = () => go([r]);
      return row;
    }

    async function go(fallback) {
      const picked = shown.filter((r) => chosen.has(label(r)));
      const list = picked.length ? picked : fallback || (shown[active] ? [shown[active]] : []);
      if (!list.length) return;
      box.classList.add('busy');
      close();
      await citeRows(list);
    }

    const sub = () => box.isConnected && draw();
    listeners.add(sub);
    function close() {
      listeners.delete(sub);
      back.remove();
      host.focus();
    }
    input.oninput = () => {
      active = 0;
      draw();
    };
    input.onkeydown = (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'ArrowDown' ? 1 : -1)));
        draw();
      } else if (e.key === 'Enter' && (e.shiftKey || e.ctrlKey || e.metaKey) && shown[active]) {
        e.preventDefault();
        const k = label(shown[active]);
        if (chosen.has(k)) chosen.delete(k);
        else chosen.add(k);
        draw();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        go();
      }
    };
    $('.tex-cite-go').onclick = () => go();
    $('.tex-cite-close').onclick = close;
    $('.tex-cite-online').onclick = () => {
      close();
      host.citeOnline();
    };
    back.addEventListener('mousedown', (e) => e.target === back && close());
    back.addEventListener('keydown', (e) => e.key === 'Escape' && close());
    draw();
    input.focus();
    load();
  }

  return {
    load,
    openPicker,
    suggestions,
    forKey,
    onChange: (fn) => listeners.add(fn),
    get projects() {
      return projects;
    },
    get papers() {
      return papers;
    },
  };
}

function who(item) {
  const a = item?.author || [];
  if (!a.length) return '';
  const name = (p) => p.literal || p.family || '';
  return a.length === 1 ? name(a[0]) : a.length === 2 ? `${name(a[0])} & ${name(a[1])}` : `${name(a[0])} et al.`;
}

function tidy(s) {
  return String(s || '').replace(/\\[a-zA-Z]+\s*/g, '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}
