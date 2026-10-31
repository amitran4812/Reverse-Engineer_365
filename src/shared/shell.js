// Application frame shared by Write, Plot and Present: title bar with quick
// access buttons, ribbon, File backstage, status bar, Claude pane, dialogs and
// the open/save lifecycle.

import { icon } from './icons.js';
import { Ribbon } from './ribbon.js';
import { ClaudePane } from './claude-pane.js';
import { accountChip, accountsSection } from './accounts.js';
import { aiSettings, pasteCopiedKey } from './ai-settings.js';
import { updateSettings, watchUpdates } from './updates.js';
import { themeButton, themeSettings } from './theme.js';
import { CLOUDS, cloudBrowser, cloudSettings, ensureConnected, openFromCloud, shareDialog } from './cloud.js';

export const APPS = {
  docs: { title: 'Write', accent: '#2f5aa8', kind: 'Document', mark: 'appDocs', newLabel: 'Blank document' },
  sheets: { title: 'Plot', accent: '#1b7a4b', kind: 'Workbook', mark: 'appSheets', newLabel: 'Blank workbook' },
  slides: { title: 'Present', accent: '#c2532d', kind: 'Presentation', mark: 'appSlides', newLabel: 'Blank presentation' },
  pdf: { title: 'Read', accent: '#0f7b87', kind: 'PDF', mark: 'appRead', newLabel: 'Open a PDF' },
};

// Read has no blank file: its tile opens a PDF.
export const startApp = (id) => (id === 'pdf' ? window.office.openDialog('pdf') : window.office.newWindow(id));

// "New LaTeX project" tile for the start screens: opens Write's LaTeX mode.
export function latexTile(size = 40, appName = true) {
  const t = h('button', 'bs-tile bs-tile-docs', `<div class="bs-tile-preview">${icon('texFile', size)}</div><span>LaTeX project</span>${appName ? '<small>Write</small>' : ''}`);
  t.title = 'Pick a folder for a new LaTeX project, or one that already has .tex files';
  t.onclick = () => window.office.latex.openFolder({ create: true });
  return t;
}

// "Notes" tile: a new Write window that starts in notes mode.
export function notesTile(size = 40, appName = true, after = null) {
  const t = h('button', 'bs-tile bs-tile-docs', `<div class="bs-tile-preview">${icon('notes', size)}</div><span>Notes</span>${appName ? '<small>Write</small>' : ''}`);
  t.title = 'Quick notes: every line a bullet, checklists, drawings, and AI summaries';
  t.onclick = () => {
    after?.();
    window.office.newWindow('docs', { notes: true });
  };
  return t;
}

// "Upload project (.zip)" tile: unpacks a zipped LaTeX project and opens it.
export function latexZipTile(size = 40, appName = true) {
  const t = h('button', 'bs-tile bs-tile-docs', `<div class="bs-tile-preview">${icon('zip', size)}</div><span>Upload LaTeX (.zip)</span>${appName ? '<small>Write</small>' : ''}`);
  t.title = 'Open a zipped LaTeX project: it is unpacked next to the .zip and compiled';
  t.onclick = () => window.office.latex.openZip();
  return t;
}

export const h = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(message, kind = 'info') {
  const t = h('div', `toast toast-${kind}`, escapeHtml(message));
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 300);
  }, 2600);
}

// Small modal dialog. fields: [{name, label, type, value, options}]
export function dialog({ title, body, fields = [], ok = 'OK', cancel = 'Cancel', wide = false }) {
  return new Promise((resolve) => {
    const back = h('div', 'modal-back');
    const box = h('form', `modal${wide ? ' wide' : ''}`);
    box.append(h('div', 'modal-title', escapeHtml(title)));
    if (body) box.append(typeof body === 'string' ? h('div', 'modal-body', body) : body);
    const inputs = {};
    for (const f of fields) {
      const row = h('label', 'modal-field');
      row.append(h('span', '', escapeHtml(f.label)));
      let input;
      if (f.type === 'select') {
        input = h('select');
        for (const o of f.options) {
          const opt = h('option', '', escapeHtml(o.label));
          opt.value = o.value;
          input.append(opt);
        }
      } else if (f.type === 'textarea') {
        input = h('textarea');
        input.rows = f.rows || 4;
      } else {
        input = h('input');
        input.type = f.type || 'text';
        if (f.min != null) input.min = f.min;
        if (f.max != null) input.max = f.max;
        if (f.placeholder) input.placeholder = f.placeholder;
      }
      if (f.value != null) input.value = f.value;
      inputs[f.name] = input;
      row.append(input);
      box.append(row);
    }
    const actions = h('div', 'modal-actions');
    const okBtn = h('button', 'btn primary', escapeHtml(ok));
    okBtn.type = 'submit';
    actions.append(okBtn);
    if (cancel) {
      const c = h('button', 'btn', escapeHtml(cancel));
      c.type = 'button';
      c.onclick = () => done(null);
      actions.append(c);
    }
    box.append(actions);
    back.append(box);
    document.body.append(back);
    const first = Object.values(inputs)[0];
    (first || okBtn).focus();
    first?.select?.();
    function done(v) {
      back.remove();
      resolve(v);
    }
    box.onsubmit = (e) => {
      e.preventDefault();
      const out = {};
      for (const [k, i] of Object.entries(inputs)) out[k] = i.value;
      done(out);
    };
    back.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') done(null);
    });
  });
}

export async function createShell(opts) {
  const meta = APPS[opts.app];
  const info = await window.office.launchInfo();
  document.documentElement.dataset.platform = info.platform;
  document.documentElement.style.setProperty('--accent', meta.accent);
  document.title = meta.title;
  watchUpdates();

  const state = {
    path: info.file?.path || null,
    name: info.file?.name || `${meta.kind}1`,
    dirty: false,
  };

  const root = h('div', `app app-${opts.app}`);
  const titlebar = h('header', 'titlebar');
  const qa = h('div', 'qa');
  const mark = h('div', 'titlebar-mark', icon(meta.mark, 20));
  const qaButtons = [
    { icon: 'save', title: 'Save (Ctrl+S)', run: () => shell.save() },
    { icon: 'undo', title: 'Undo (Ctrl+Z)', run: () => opts.undo?.() },
    { icon: 'redo', title: 'Redo (Ctrl+Y)', run: () => opts.redo?.() },
  ];
  for (const b of qaButtons) {
    const btn = h('button', 'qa-btn', icon(b.icon, 16));
    btn.title = b.title;
    btn.onmousedown = (e) => e.preventDefault();
    btn.onclick = b.run;
    qa.append(btn);
  }
  const titleText = h('div', 'titlebar-title');
  const search = h('div', 'titlebar-search', `${icon('sparkle', 14)}<input placeholder="Ask Claude or search commands" spellcheck="false">`);
  const shareBtn = h('button', 'titlebar-share', `${icon('share', 16)}<span>Share</span>`);
  shareBtn.title = 'Share with people by email';
  shareBtn.onclick = () => shareDialog(shell);
  titlebar.append(...[mark, qa, titleText, search, accountChip(info.account), shareBtn, themeButton(), h('div', 'titlebar-spacer')].filter(Boolean));

  const ribbonHost = h('div');
  const tabs = [...opts.tabs, ...(opts.claudeTab ? [opts.claudeTab] : [])];
  const workspaceRow = h('div', 'workspace-row');
  const workspace = h('main', 'workspace');
  const paneHost = h('aside', 'claude-host');
  workspaceRow.append(workspace, paneHost);
  const status = h('footer', 'statusbar');
  const statusLeft = h('div', 'status-left');
  const statusRight = h('div', 'status-right');
  status.append(statusLeft, statusRight);
  root.append(titlebar, ribbonHost, workspaceRow, status);
  document.body.append(root);

  const shell = {
    info,
    state,
    root,
    workspace,
    statusLeft,
    statusRight,
    toast,
    dialog,
    get ribbon() {
      return ribbon;
    },
    setTitle() {
      titleText.textContent = `${state.name}${state.dirty ? ' •' : ''} — ${meta.title}`;
      document.title = `${state.name} - ${meta.title}`;
      window.office.setTitle(document.title);
    },
    markDirty() {
      if (!state.dirty) {
        state.dirty = true;
        window.office.setDirty(true);
        shell.setTitle();
      }
    },
    markClean() {
      state.dirty = false;
      window.office.setDirty(false);
      shell.setTitle();
    },
    async save({ saveAs = false, ext } = {}) {
      if (saveAs && !ext && opts.customSaveAs) return opts.customSaveAs();
      if (!saveAs && !ext && opts.customSave && (await opts.customSave())) return true;
      const payload = await opts.getSaveData();
      const baseName = state.name.replace(/\.[^.]+$/, '');
      const res = await window.office.save({
        app: opts.app,
        payload,
        path: ext ? null : state.path,
        saveAs: saveAs || !!ext,
        suggestedName: ext ? `${baseName}.${ext}` : state.path || `${baseName}.${opts.defaultExt}`,
      });
      if (!res) return false;
      if (res.exported) {
        toast(`Exported ${res.name}`);
        return true;
      }
      state.path = res.path;
      state.name = res.name;
      shell.markClean();
      toast(res.cloud ? `Saved ${res.name} to ${res.cloud}` : `Saved ${res.name}`);
      return true;
    },
    async saveToCloud(provider) {
      if (!(await ensureConnected(provider))) return false;
      const picked = await cloudBrowser(provider, { mode: 'save' });
      if (!picked) return false;
      const baseName = state.name.replace(/\.[^.]+$/, '');
      const got = await dialog({ title: 'Save as', fields: [{ name: 'name', label: 'File name', value: `${baseName}.${opts.defaultExt}` }], ok: 'Save' });
      if (!got?.name?.trim()) return false;
      let name = got.name.trim();
      if (!/\.[a-z0-9]+$/i.test(name)) name += `.${opts.defaultExt}`;
      const payload = await opts.getSaveData();
      const res = await window.office.cloud.saveNew({ provider, folder: picked.folder, name, app: opts.app, payload });
      if (res?.error) {
        toast(res.error, 'error');
        return false;
      }
      state.path = res.path;
      state.name = res.name;
      shell.markClean();
      toast(`Saved ${res.name} to ${res.cloud}`);
      return true;
    },
    async exportPdf() {
      if (opts.exportPdf) return opts.exportPdf();
      document.body.classList.add('printing');
      opts.beforePrint?.();
      try {
        const file = await window.office.exportPdf({ suggestedName: state.name.replace(/\.[^.]+$/, ''), ...(opts.pdfOptions?.() || {}) });
        if (file) toast(`Saved ${file.split(/[\\/]/).pop()}`);
      } catch (err) {
        toast(String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), 'error');
      } finally {
        document.body.classList.remove('printing');
        opts.afterPrint?.();
      }
    },
    async print() {
      if (opts.print) return opts.print();
      document.body.classList.add('printing');
      opts.beforePrint?.();
      await window.office.print();
      setTimeout(() => {
        document.body.classList.remove('printing');
        opts.afterPrint?.();
      }, 500);
    },
    openBackstage(section = 'home') {
      backstage.open(section);
    },
    refresh() {
      ribbon.refresh();
    },
  };

  const ribbon = new Ribbon(ribbonHost, { tabs, accent: meta.accent, onFile: () => shell.openBackstage(), onSelect: (id) => opts.onTab?.(id) });
  const backstage = new Backstage(shell, opts, meta);
  root.append(backstage.node);

  if (opts.claude) {
    shell.claude = new ClaudePane(paneHost, { ...opts.claude, shell });
    const input = search.querySelector('input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        shell.claude.show();
        shell.claude.ask(input.value.trim());
        input.value = '';
      }
      if (e.key === 'Escape') input.blur();
    });
  } else {
    search.remove();
  }

  window.office.onSaveAndClose(async () => {
    if (await shell.save()) window.office.close();
  });

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'F1' && mod) {
      e.preventDefault();
      ribbon.toggleCollapsed();
      return;
    }
    if (!mod) return;
    const k = e.key.toLowerCase();
    if (k === 's') {
      e.preventDefault();
      shell.save({ saveAs: e.shiftKey });
    } else if (k === 'o') {
      e.preventDefault();
      window.office.openDialog(opts.app);
    } else if (k === 'n') {
      e.preventDefault();
      window.office.newWindow(opts.app);
    } else if (k === 'p') {
      e.preventDefault();
      shell.print();
    } else if (k === 'j' || (k === 'k' && e.shiftKey)) {
      e.preventDefault();
      shell.claude?.toggle();
    }
  });

  shell.setTitle();
  return shell;
}

class Backstage {
  constructor(shell, opts, meta) {
    this.shell = shell;
    this.opts = opts;
    this.meta = meta;
    this.node = h('div', 'backstage');
    this.nav = h('nav', 'bs-nav');
    this.content = h('section', 'bs-content');
    this.node.append(this.nav, this.content);
    const items = [
      { id: 'back', label: '', icon: 'back', run: () => this.close() },
      { id: 'home', label: 'Home', icon: 'home' },
      { id: 'new', label: 'New', icon: 'newFile' },
      { id: 'open', label: 'Open', icon: 'open' },
      '-',
      { id: 'save', label: 'Save', icon: 'save', run: () => this.close() || shell.save() },
      { id: 'saveas', label: 'Save As', icon: 'saveAs' },
      { id: 'export', label: 'Export', icon: 'export' },
      { id: 'print', label: 'Print', icon: 'print', run: () => this.close() || shell.print() },
      '-',
      { id: 'options', label: 'Options', icon: 'settings' },
      { id: 'close', label: 'Close', icon: 'close', run: () => window.office.close() },
    ];
    this.buttons = {};
    for (const it of items) {
      if (it === '-') {
        this.nav.append(h('div', 'bs-sep'));
        continue;
      }
      const b = h('button', `bs-item${it.id === 'back' ? ' bs-back' : ''}`, `${icon(it.icon, 18)}<span>${it.label}</span>`);
      b.onclick = () => (it.run ? it.run() : this.open(it.id));
      this.buttons[it.id] = b;
      this.nav.append(b);
    }
    this.node.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
    });
  }

  close() {
    this.node.classList.remove('open');
  }

  async open(section) {
    this.node.classList.add('open');
    for (const [id, b] of Object.entries(this.buttons)) b.classList.toggle('active', id === section);
    this.content.innerHTML = '';
    const c = this.content;
    const appTiles = () => {
      const row = h('div', 'bs-tiles');
      for (const [id, m] of Object.entries(APPS)) {
        const t = h('button', `bs-tile bs-tile-${id}`, `<div class="bs-tile-preview">${icon(m.mark, 40)}</div><span>${m.newLabel}</span>`);
        t.onclick = () => {
          this.close();
          startApp(id);
        };
        row.append(t);
      }
      row.append(notesTile(40, false, () => this.close()), latexTile(40, false), latexZipTile(40, false));
      return row;
    };
    if (section === 'home' || section === 'new') {
      c.append(h('h1', '', section === 'home' ? 'Good to see you' : 'New'));
      c.append(h('h2', '', 'Start something new'));
      c.append(appTiles());
      c.append(h('h2', '', 'Recent'));
      c.append(await recentList(() => this.close()));
    } else if (section === 'open') {
      c.append(h('h1', '', 'Open'));
      const browse = h('button', 'bs-browse', `${icon('open', 28)}<span>Browse…</span>`);
      browse.onclick = () => {
        this.close();
        window.office.openDialog(null);
      };
      const texFolder = h('button', 'bs-browse', `${icon('texFile', 28)}<span>LaTeX project folder…</span>`);
      texFolder.onclick = () => {
        this.close();
        window.office.latex.openFolder();
      };
      const texZip = h('button', 'bs-browse', `${icon('zip', 28)}<span>LaTeX project from a .zip…</span>`);
      texZip.onclick = () => {
        this.close();
        window.office.latex.openZip();
      };
      const places = cloudPlaces((id) => {
        this.close();
        openFromCloud(id, null);
      });
      places.append(texFolder, texZip);
      c.append(browse, places, h('h2', '', 'Recent'), await recentList(() => this.close()));
    } else if (section === 'saveas') {
      c.append(h('h1', '', 'Save As'));
      const browse = h('button', 'bs-browse', `${icon('saveAs', 28)}<span>This PC: browse…</span>`);
      browse.onclick = () => {
        this.close();
        this.shell.save({ saveAs: true });
      };
      c.append(browse, cloudPlaces((id) => {
        this.close();
        this.shell.saveToCloud(id);
      }));
    } else if (section === 'export') {
      c.append(h('h1', '', 'Export'));
      const list = h('div', 'bs-exports');
      const exports = [{ label: 'PDF document', detail: 'Fixed layout that looks the same everywhere.', icon: 'pdf', run: () => this.shell.exportPdf() }, ...(this.opts.exports || [])];
      for (const ex of exports) {
        const b = h('button', 'bs-export', `${icon(ex.icon || 'export', 32)}<div><b>${escapeHtml(ex.label)}</b><span>${escapeHtml(ex.detail || '')}</span></div>`);
        b.onclick = () => {
          this.close();
          if (ex.run) ex.run();
          else this.shell.save({ ext: ex.ext });
        };
        list.append(b);
      }
      c.append(list);
    } else if (section === 'options') {
      c.append(h('h1', '', 'Options'), await themeSettings());
      const mount = async () => {
        const form = await settingsForm(() => {
          mount();
          this.shell.claude?.loadSettings?.();
        });
        const prev = c.querySelector('.settings-form');
        if (prev) prev.replaceWith(form);
        else c.append(form);
      };
      await mount();
      c.append(await aiSettings(() => this.shell.claude?.loadSettings?.()), await cloudSettings(), await accountsSection(), await updateSettings());
    }
  }
}

function cloudPlaces(run) {
  const row = h('div', 'bs-places');
  for (const cl of CLOUDS) {
    const b = h('button', 'bs-browse', `${icon(cl.icon, 28)}<span>${cl.label}</span>`);
    b.onclick = () => run(cl.id);
    row.append(b);
  }
  return row;
}

async function recentList(onOpen) {
  const list = h('div', 'bs-recent');
  const items = await window.office.recent();
  if (!items.length) list.append(h('div', 'bs-empty', 'Files you open or save show up here.'));
  for (const r of items) {
    const m = APPS[r.app] || APPS.docs;
    const name = r.path.split(/[\\/]/).pop();
    const row = h('button', 'bs-recent-row', `${icon(m.mark, 22)}<div><b>${escapeHtml(name)}</b><span>${escapeHtml(r.path)}</span></div><time>${new Date(r.at).toLocaleDateString()}</time>`);
    row.style.setProperty('--accent', m.accent);
    row.onclick = () => {
      onOpen?.();
      window.office.openPath(r.path);
    };
    list.append(row);
  }
  return list;
}

export async function settingsForm(onSaved) {
  const s = await window.office.settings.get();
  const form = h('form', 'settings-form');
  const status = s.keyFromEnv ? 'Connected through the ANTHROPIC_API_KEY environment variable.' : s.hasKey ? 'Connected. Your key is saved on this computer.' : 'Not connected yet.';
  form.innerHTML = `
    <h2>${icon('sparkle', 18)} Connect Claude</h2>
    <p class="settings-status ${s.hasKey ? 'ok' : ''}" data-status>${escapeHtml(status)}</p>
    <ol class="connect-steps">
      <li><b>Sign in to your Anthropic account.</b> <button class="btn" type="button" data-link="https://console.anthropic.com/settings/keys">${icon('key', 16)} Sign in and create a key</button>
        <span class="muted">Opens the Anthropic Console in your browser. Create a key there and copy it, then come back: Work fills it in for you.</span></li>
      <li><b>Paste the key here.</b>
        <label class="modal-field"><span>Anthropic API key</span>
          <input name="apiKey" type="password" autocomplete="off" placeholder="${s.hasKey ? '•••••••• (saved)' : 'sk-ant-…'}" ${s.keyFromEnv ? 'disabled' : ''}>
        </label></li>
    </ol>
    <p class="muted">The key is checked with Anthropic, then stored encrypted on this computer. It is only ever sent to Anthropic.</p>
    <label class="modal-field"><span>Model</span><select name="model">${s.models.map((m) => `<option value="${m.id}" ${m.id === s.model ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}</select></label>
    <label class="modal-field"><span>Thinking effort</span><select name="effort">${['low', 'medium', 'high', 'xhigh', 'max'].map((e) => `<option ${e === s.effort ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
    <div class="modal-actions"><button class="btn primary" type="submit">${s.hasKey ? 'Save settings' : 'Connect'}</button>${s.hasKey ? '<button class="btn" type="button" data-test>Test connection</button>' : ''}${s.hasKey && !s.keyFromEnv ? '<button class="btn" type="button" data-remove>Sign out</button>' : ''}</div>`;
  const statusEl = form.querySelector('[data-status]');
  const setStatus = (text, ok) => {
    statusEl.textContent = text;
    statusEl.className = `settings-status ${ok === true ? 'ok' : ok === false ? 'bad' : ''}`;
  };
  form.querySelector('[data-link]').onclick = (e) => {
    e.preventDefault();
    if (!s.keyFromEnv) pasteCopiedKey('anthropic', form.apiKey, () => {
      setStatus('Found the key you copied. Connecting…');
      form.requestSubmit();
    });
    window.office.openExternal(e.currentTarget.dataset.link);
  };
  form.querySelector('[data-test]')?.addEventListener('click', async () => {
    setStatus('Checking…');
    const r = await window.office.claude.verify();
    setStatus(r.ok ? 'Connected. Claude is ready.' : r.message, r.ok);
  });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const patch = { model: fd.get('model'), effort: fd.get('effort') };
    const key = fd.get('apiKey');
    if (key) {
      setStatus('Checking your key with Anthropic…');
      const r = await window.office.claude.verify(key);
      if (!r.ok) {
        setStatus(r.message, false);
        return;
      }
      patch.apiKey = key;
    } else if (!s.hasKey) {
      setStatus('Paste your Anthropic API key first.', false);
      return;
    }
    const next = await window.office.settings.set(patch);
    toast(key ? 'Claude is connected' : 'Settings saved');
    onSaved?.(next);
  };
  form.querySelector('[data-remove]')?.addEventListener('click', async () => {
    const next = await window.office.settings.set({ apiKey: '' });
    toast('Signed out of Claude');
    onSaved?.(next);
  });
  return form;
}
